import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  Plan,
  PlanStatus,
  PlanFu,
  PlanSku,
} from '../../../../database/entities/plan.entity';
import {
  AccessScopeService,
  EffectiveScope,
} from '../../../shared/access-scope/access-scope.service';
import {
  applyVersionedUpdate,
  staleVersionConflict,
} from '../../../shared/persistence/versioned-update.helper';

/**
 * T-034c (docs/analysis/0005 §3, R4): fixed private namespace for the
 * `pg_advisory_xact_lock(classid, objid)` two-int form used by
 * `acquireRecalcLock`. `hashtext()` collapses this string to a stable
 * 32-bit `classid` — any *other* future advisory-lock user picks its own
 * namespace string and can never collide with plan-recalc's lock space,
 * no matter what `objid` (planId hash) it happens to compute.
 */
export const PLAN_RECALC_LOCK_NAMESPACE = 'collmind:plan-recalc';

/**
 * THE single producer of the PLAN_FU 409 body.
 *
 * Two call sites now raise this conflict: the real CAS in
 * `updatePlanFuVersioned` below, and the cheap pre-check in
 * `PlanService#updateFuTactic` (C3). A client must not be able to tell which
 * one fired — same `code`, same `currentVersion`, same body shape — and the
 * only way to keep that true is for both to build it here. Constructing the
 * same error by hand in two places is the small-scale form of the divergence
 * this repo has recorded seven times.
 */
export function planFuStaleConflict(
  current: PlanFu,
  expectedVersion: number,
): ConflictException {
  return staleVersionConflict({
    entity: 'PLAN_FU',
    entityId: current.id,
    expectedVersion,
    currentVersion: current.version,
    current: { tactics: current.tactics, updatedBy: current.updatedBy },
  });
}

@Injectable()
export class PlanRepository {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(PlanFu)
    private readonly planFuRepo: Repository<PlanFu>,
    @InjectRepository(PlanSku)
    private readonly planSkuRepo: Repository<PlanSku>,
    private readonly accessScope: AccessScopeService,
  ) {}

  async create(data: Partial<Plan>): Promise<Plan> {
    const plan = this.planRepo.create(data);
    return this.planRepo.save(plan);
  }

  /**
   * T-034b: optional trailing `manager` — when supplied, the read runs
   * through the caller's open QueryRunner transaction (same snapshot as any
   * writes already made on that manager, e.g. after `findByIdForUpdate`
   * locked the row). Omitted -> unchanged pre-existing behaviour (injected
   * repo, default connection).
   */
  async findById(
    id: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Plan | null> {
    const repo = manager ? manager.getRepository(Plan) : this.planRepo;
    return repo.findOne({
      where: { id, tenantId },
      relations: [
        'cpl',
        'channel',
        'category',
        'region',
        'planFus',
        'planFus.fu',
        'planFus.planSkus',
        'planFus.planSkus.sku',
        'planFus.planMechanicValues',
        'approvedBy',
        'rejectedBy',
        // 'submittedBy', // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
        // 'escalatedBy', // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
      ],
    });
  }

  /**
   * T-034b (docs/analysis/0005 §4): row lock for state transitions
   * (submit/approve/reject/returnToDraft) — must be taken BEFORE any
   * decision is made or budget side effect runs, not just CAS'd after the
   * fact (budget commit/reserve historically ran before the status write —
   * a version-CAS on the final write alone would not stop two concurrent
   * approves from both moving money). No relations: Postgres rejects
   * `FOR UPDATE` combined with the nullable side of a LEFT JOIN (this
   * entity's `findById` uses several), so this is a minimal, join-free
   * projection — same pattern as
   * `settlement-close.service.ts#closeAgreement` step 1. Callers that need
   * joined data (channel code, planFus) read it separately through the same
   * `manager` (same transaction snapshot, safe) or capture it from an
   * earlier unlocked read for fields that cannot change concurrently in a
   * way that matters here (see PlanService#submit/#approve for the exact
   * split).
   */
  async findByIdForUpdate(
    id: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<Plan | null> {
    return manager.findOne(Plan, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * T-034b: status-CAS write, the second defense layer after the
   * `findByIdForUpdate` lock+precondition-check above (the lock already
   * serializes concurrent transitions — this predicate additionally guards
   * against a caller bug that decided without holding the lock).
   * `WHERE id AND tenantId AND status = :expectedStatus` — `affected === 0`
   * means the precondition no longer held at write time; the caller decides
   * what to surface (mirrors `applyVersionedUpdate`'s 0-affected contract,
   * but keyed on `status`, not `version` — state transitions are
   * pessimistic per K5, not CAS'd by version. `submit()` is the sole
   * documented exception and validates `version` itself, separately, before
   * calling this). `data.version` may include the raw-SQL bump expression
   * `() => '"version" + 1'` (same idiom `applyVersionedUpdate` uses) so a
   * completed transition always produces a fresh version for the next
   * reader — safe here because PENDING_APPROVAL/REJECTED plans are
   * BRD-immutable to grid edits, so there is no in-flight grid CAS token
   * this could invalidate.
   */
  async updateStatusCas(
    manager: EntityManager,
    id: string,
    tenantId: string,
    expectedStatus: PlanStatus,
    data: Partial<Plan>,
  ): Promise<number> {
    const result = await manager.update(
      Plan,
      { id, tenantId, status: expectedStatus } as any,
      data as any,
    );
    return result.affected ?? 0;
  }

  /**
   * T-034c (docs/analysis/0005 §3): serializes
   * `PlanService#recalculatePlanWithKpiEngine` per plan — "lost
   * recalculation" (two concurrent recalcs interleaving their SKU -> FU ->
   * plan aggregate writes) is NOT a lost-update; version-CAS cannot see it
   * because neither transaction's own row is stale, only the cross-row
   * aggregate is. `pg_advisory_xact_lock` is transaction-scoped: it MUST be
   * acquired on an already-open transaction's `manager` (a bare
   * `pg_advisory_xact_lock` call outside a transaction is a no-op-ish
   * session lock that never releases the way this code assumes) and is
   * released automatically at COMMIT/ROLLBACK — no matching unlock call, no
   * leak on crash/timeout. See `PLAN_RECALC_LOCK_NAMESPACE` doc comment for
   * why the two-int form is used instead of a single
   * `hashtextextended(planId)` key.
   */
  async acquireRecalcLock(
    planId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [PLAN_RECALC_LOCK_NAMESPACE, planId],
    );
  }

  async findByCode(code: string, tenantId: string): Promise<Plan | null> {
    return this.planRepo.findOne({
      where: { planCode: code, tenantId },
    });
  }

  async findAll(
    tenantId: string,
    filters?: {
      status?: PlanStatus;
      cplId?: string;
      channelId?: string;
      categoryId?: string;
    },
    /**
     * T-028b: CM kategori-scoped okuma (docs/analysis/0004-rbac-brd-alignment.md
     * §3). Yalnızca çağıran taraf (PlanService) SCOPED bir scope geçtiğinde
     * uygulanır — UNRESTRICTED için no-op, undefined için de no-op (geriye
     * uyumlu; PLANNER enforcement T-028c'nin işi, burada bilerek dokunulmadı).
     */
    scope?: EffectiveScope,
  ): Promise<Plan[]> {
    const query = this.planRepo
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .andWhere('plan.deletedAt IS NULL');

    if (filters?.status) {
      query.andWhere('plan.status = :status', { status: filters.status });
    }
    if (filters?.cplId) {
      query.andWhere('plan.cplId = :cplId', { cplId: filters.cplId });
    }
    if (filters?.channelId) {
      query.andWhere('plan.channelId = :channelId', {
        channelId: filters.channelId,
      });
    }
    if (filters?.categoryId) {
      query.andWhere('plan.categoryId = :categoryId', {
        categoryId: filters.categoryId,
      });
    }
    if (scope) {
      this.accessScope.applyToQueryBuilder(query, 'plan', scope);
    }

    return (
      query
        .leftJoinAndSelect('plan.cpl', 'cpl')
        .leftJoinAndSelect('plan.channel', 'channel')
        .leftJoinAndSelect('plan.category', 'category')
        // .leftJoinAndSelect('plan.submittedBy', 'submittedBy') // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
        // .leftJoinAndSelect('plan.escalatedBy', 'escalatedBy') // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
        .leftJoinAndSelect('plan.approvedBy', 'approvedBy')
        .leftJoinAndSelect('plan.rejectedBy', 'rejectedBy')
        .leftJoinAndSelect('plan.planFus', 'planFus')
        .leftJoinAndSelect('planFus.fu', 'fu')
        .leftJoinAndSelect('planFus.planSkus', 'planSkus')
        .leftJoinAndSelect('planSkus.sku', 'sku')
        .orderBy('plan.createdAt', 'DESC')
        .getMany()
    );
  }

  /**
   * T-034: deliberate CAS bypass — see versioned-update.helper.ts header
   * comment. Used by (a) state-transition writes via #updateStatus
   * (submit/approve/reject/returnToDraft/approval-workflow — status-CAS is
   * T-034b's job, not this task's) and (b) recalc/compensation writes
   * (`recalculatePlanWithKpiEngine`, submit/approve/reject's own rollback
   * branches) where the held-in-memory `plan` is expected to be behind the
   * version a preceding forward write already bumped — a CAS there would
   * fail every single time. Grep-able on purpose (T-034 acceptance
   * criteria / code-reviewer checklist item).
   *
   * T-034c: optional trailing `manager` — `recalculatePlanWithKpiEngine`'s
   * final plan-level write must run on the SAME transaction/connection as
   * its `acquireRecalcLock` call and its FU/SKU writes (otherwise "wrap it
   * in a transaction" is theater: the write would go out on the pool's
   * default connection, outside the lock, and could still interleave with
   * a concurrent recalc). Omitted -> unchanged pre-existing behaviour.
   *
   * T-046a: optional `skipReadback` — the mandatory post-UPDATE full-tree
   * `findById` (9-relation plan, ~50ms measured, docs/analysis/0007 §2.3
   * item C #5) exists solely to return the fresh `Plan` to callers that
   * use it. `recalculatePlanWithKpiEngine`'s own final call discards the
   * return value entirely (it's the last statement of the method) — pass
   * `true` there to skip the readback. Defaults to `false` (unchanged
   * behaviour) because `#updateStatus` and any other caller may rely on
   * the returned `Plan`. When skipped, the resolved value is a
   * `Pick<Plan, 'id' | 'tenantId'>`-only stub, not a real hydrated `Plan`
   * — never use the return value when passing `skipReadback: true`.
   */
  async updateUnversioned(
    id: string,
    tenantId: string,
    data: Partial<Plan>,
    manager?: EntityManager,
    skipReadback = false,
  ): Promise<Plan> {
    const repo = manager ? manager.getRepository(Plan) : this.planRepo;
    await repo.update({ id, tenantId }, data);
    if (skipReadback) {
      return { id, tenantId } as Plan;
    }
    const updated = await this.findById(id, tenantId, manager);
    if (!updated) {
      throw new Error('Plan not found after update');
    }
    return updated;
  }

  /**
   * T-034: CAS write for the user-input plan-header edit path
   * (PlanService#update) and the plan.version bump gate used by structural
   * changes (addFu/removeFu — see PlanService). `affected === 0` means
   * either not-found or stale; a version-less re-read tells the two apart.
   */
  async updateVersioned(
    id: string,
    tenantId: string,
    expectedVersion: number,
    data: Partial<Plan>,
  ): Promise<Plan> {
    const affected = await applyVersionedUpdate(
      this.planRepo,
      { id, tenantId },
      expectedVersion,
      data as any,
    );
    if (affected === 0) {
      const current = await this.planRepo.findOne({ where: { id, tenantId } });
      if (!current) {
        throw new NotFoundException(`Plan with ID ${id} not found`);
      }
      throw staleVersionConflict({
        entity: 'PLAN',
        entityId: id,
        expectedVersion,
        currentVersion: current.version,
        current: {
          planName: current.planName,
          description: current.description,
          startDate: current.startDate,
          endDate: current.endDate,
          updatedBy: current.updatedBy,
          updatedAt: current.updatedAt,
        },
      });
    }
    const updated = await this.findById(id, tenantId);
    if (!updated) {
      throw new Error('Plan not found after update');
    }
    return updated;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: PlanStatus,
    additionalFields?: Partial<Plan>,
  ): Promise<Plan> {
    const updateData = { status, ...additionalFields };
    return this.updateUnversioned(id, tenantId, updateData);
  }

  /**
   * T-034 (code-review follow-up, 2026-07-29): destructive — the delete
   * path was found entirely exempt from optimistic locking (a silent gap,
   * not a documented bypass). CAS via the same helper as every other
   * user-input write: `affected === 0` -> stale/not-found, decided by a
   * version-less re-read (see #updateVersioned for the identical pattern).
   * Sets `deletedAt` directly rather than calling `Repository#softDelete`
   * (which builds its own UPDATE and cannot carry the version predicate).
   */
  async softDeleteVersioned(
    id: string,
    tenantId: string,
    expectedVersion: number,
  ): Promise<void> {
    const affected = await applyVersionedUpdate(
      this.planRepo,
      { id, tenantId },
      expectedVersion,
      { deletedAt: new Date() } as any,
    );
    if (affected === 0) {
      const current = await this.planRepo.findOne({ where: { id, tenantId } });
      if (!current) {
        throw new NotFoundException(`Plan with ID ${id} not found`);
      }
      throw staleVersionConflict({
        entity: 'PLAN',
        entityId: id,
        expectedVersion,
        currentVersion: current.version,
        current: {
          planName: current.planName,
          updatedBy: current.updatedBy,
          updatedAt: current.updatedAt,
        },
      });
    }
  }

  async generatePlanCode(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    const prefix = `PLAN-${year}-Q${quarter}-`;

    // Find the highest sequence number for this quarter and year
    const plans = await this.planRepo
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .andWhere('plan.planCode LIKE :prefix', { prefix: `${prefix}%` })
      .andWhere('plan.deletedAt IS NULL')
      .orderBy('plan.planCode', 'DESC')
      .limit(1)
      .getOne();

    let sequence = 1;
    if (plans && plans.planCode) {
      const lastCode = plans.planCode;
      // Handle both formats: PLAN-2026-Q1-001 and PLAN-2026-Q1-001-1234
      const codeWithoutSuffix = lastCode.split('-').slice(0, 4).join('-');
      const parts = codeWithoutSuffix.split('-');
      if (parts.length >= 4) {
        const lastSequence = parseInt(parts[3], 10);
        if (!isNaN(lastSequence)) {
          sequence = lastSequence + 1;
        }
      }
    }

    // Add timestamp suffix to ensure uniqueness (last 4 digits)
    const timestamp = Date.now().toString().slice(-4);
    const sequenceStr = String(sequence).padStart(3, '0');
    return `${prefix}${sequenceStr}-${timestamp}`;
  }

  // PlanFU methods
  /**
   * T-079: the `tactics` parameter was removed along with `AddFuDto.tactics`.
   * Leaving an unused parameter here would keep the dead write path alive one
   * layer down — the endpoint would be closed while the repository still
   * offered the door to any future caller.
   *
   * A new FU is born with no tactics. They arrive through
   * `updatePlanFuVersioned`, the one scale-validated write path (F2/C3).
   */
  async addFu(
    planId: string,
    fuId: string,
    tenantId: string,
    userId: string,
  ): Promise<PlanFu> {
    const planFu = this.planFuRepo.create({
      planId,
      fuId,
      tenantId,
      createdBy: userId,
      totalPlannedVolume: 0,
      totalSpend: 0,
      totalGp: 0,
    });
    return this.planFuRepo.save(planFu);
  }

  /**
   * T-034 §1.5: tenantId predicate added (was `{ planId, fuId }` only —
   * relied entirely on the caller having already tenant-scoped `planId` via
   * `findById`; not a real defense layer on its own).
   */
  async findPlanFu(
    planId: string,
    fuId: string,
    tenantId: string,
  ): Promise<PlanFu | null> {
    return this.planFuRepo.findOne({
      where: { planId, fuId, tenantId },
      relations: ['fu', 'planSkus', 'planSkus.sku'],
    });
  }

  /**
   * T-034: deliberate CAS bypass (see #updateUnversioned on the plan
   * header). Used by `recalculatePlanWithKpiEngine` — FU-level totals are a
   * derived aggregate of its SKUs, never a user's direct edit.
   *
   * T-034c: optional trailing `manager` — same reason as
   * #updateUnversioned's.
   */
  async updatePlanFuUnversioned(
    planFuId: string,
    tenantId: string,
    data: Partial<PlanFu>,
    manager?: EntityManager,
  ): Promise<PlanFu> {
    const repo = manager ? manager.getRepository(PlanFu) : this.planFuRepo;
    await repo.update({ id: planFuId, tenantId }, data);
    const updated = await repo.findOne({
      where: { id: planFuId, tenantId },
      relations: ['fu', 'planSkus', 'planSkus.sku'],
    });
    if (!updated) {
      throw new Error('PlanFU not found after update');
    }
    return updated;
  }

  /**
   * T-034: CAS write for the grid-cell tactic edit (PlanService#updateFuTactic).
   */
  async updatePlanFuVersioned(
    planFuId: string,
    tenantId: string,
    expectedVersion: number,
    data: Partial<PlanFu>,
  ): Promise<PlanFu> {
    const affected = await applyVersionedUpdate(
      this.planFuRepo,
      { id: planFuId, tenantId },
      expectedVersion,
      data as any,
    );
    if (affected === 0) {
      const current = await this.planFuRepo.findOne({
        where: { id: planFuId, tenantId },
      });
      if (!current) {
        throw new NotFoundException(`FU ${planFuId} not found in this plan`);
      }
      throw planFuStaleConflict(current, expectedVersion);
    }
    const updated = await this.planFuRepo.findOne({
      where: { id: planFuId, tenantId },
      relations: ['fu', 'planSkus', 'planSkus.sku'],
    });
    if (!updated) {
      throw new Error('PlanFU not found after update');
    }
    return updated;
  }

  /** T-034 §1.5: tenantId predicate added (see #findPlanFu). */
  async removeFu(planFuId: string, tenantId: string): Promise<void> {
    await this.planFuRepo.delete({ id: planFuId, tenantId });
  }

  // PlanSKU methods
  async addSku(
    planFuId: string,
    skuId: string,
    tenantId: string,
    userId: string,
    baseVolume?: number,
    plannedVolume?: number,
  ): Promise<PlanSku> {
    const planSku = this.planSkuRepo.create({
      planFuId,
      skuId,
      tenantId,
      createdBy: userId,
      baseVolume,
      plannedVolume,
      incrementalVolume:
        plannedVolume && baseVolume ? plannedVolume - baseVolume : 0,
    });
    return this.planSkuRepo.save(planSku);
  }

  /**
   * T-034 §1.5: tenantId predicate added (see #findPlanFu).
   * T-034c: optional trailing `manager` — `recalculatePlanWithKpiEngine`'s
   * FU-aggregation step re-reads each just-updated planSku to sum
   * volume/GP; it must read through the recalc's own transaction (same
   * snapshot as the write just made on it), not the injected repo's
   * default connection, or it would either block on the still-open write
   * lock or (worse, on some isolation levels) read a stale pre-update row.
   */
  async findPlanSku(
    planFuId: string,
    skuId: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<PlanSku | null> {
    const repo = manager ? manager.getRepository(PlanSku) : this.planSkuRepo;
    return repo.findOne({
      where: { planFuId, skuId, tenantId },
      relations: ['sku', 'planFu'],
    });
  }

  /**
   * T-034: deliberate CAS bypass (see #updatePlanFuUnversioned). Used by
   * `recalculatePlanWithKpiEngine` — plannedGp/gpRoi/ragStatus/calculatedKpis
   * etc. are derived outputs, never a user's direct edit.
   *
   * T-034c: optional trailing `manager` — same reason as
   * #updateUnversioned's.
   *
   * T-045: no longer reads the row back after the UPDATE. Grep-verified
   * (2026-07-30) that the sole caller (`PlanService#recalculatePlanWithKpiEngineLocked`)
   * never used the previous return value — the read-back was a pure-waste
   * extra SELECT per SKU (52/recalc). If a future caller needs the updated
   * row, re-fetch explicitly via `findPlanSku` rather than reintroducing an
   * implicit read-back here.
   */
  async updatePlanSkuUnversioned(
    planSkuId: string,
    tenantId: string,
    data: Partial<PlanSku>,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(PlanSku) : this.planSkuRepo;
    await repo.update({ id: planSkuId, tenantId }, data);
  }

  /**
   * T-045: batched equivalent of calling `updatePlanSkuUnversioned` once per
   * SKU in a loop — same CAS-bypass semantics (derived recalc output, `version`
   * column untouched, no lost-update risk introduced), but a single
   * multi-row `UPDATE ... FROM (VALUES ...)` round-trip instead of N.
   *
   * Always scoped to `tenantId` (multi-tenant isolation) and MUST be routed
   * through the caller's lock-holding transaction `manager` — same
   * requirement as `updatePlanSkuUnversioned` (T-034c).
   *
   * No-op on an empty array (recalc of a plan with an empty FU is possible
   * upstream, though callers currently only reach this with >=1 row).
   */
  async batchUpdatePlanSkusUnversioned(
    updates: Array<{
      planSkuId: string;
      data: Pick<
        PlanSku,
        | 'incrementalVolume'
        | 'plannedTurnover'
        | 'tacticSpend'
        | 'plannedGp'
        | 'gpRoi'
        | 'ragStatus'
        | 'calculatedKpis'
      >;
    }>,
    tenantId: string,
    manager: EntityManager,
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    const rowsSql: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    for (const { planSkuId, data } of updates) {
      rowsSql.push(
        `($${i++}::uuid, $${i++}::decimal, $${i++}::decimal, $${i++}::decimal, $${i++}::decimal, $${i++}::decimal, $${i++}::varchar, $${i++}::jsonb)`,
      );
      params.push(
        planSkuId,
        data.incrementalVolume ?? null,
        data.plannedTurnover ?? null,
        data.tacticSpend ?? null,
        data.plannedGp ?? null,
        data.gpRoi ?? null,
        data.ragStatus ?? null,
        data.calculatedKpis ? JSON.stringify(data.calculatedKpis) : null,
      );
    }

    const tenantParamIndex = i;
    params.push(tenantId);

    // Schema-qualify the table the same way TypeORM does internally
    // (`DB_SCHEMA` env, defaults to "main") — raw `manager.query()` calls,
    // unlike repo methods, are NOT auto-scoped to the configured schema.
    const tableName = manager.getRepository(PlanSku).metadata.tablePath;

    await manager.query(
      `
      UPDATE ${tableName} AS ps
      SET
        incremental_volume = v.incremental_volume,
        planned_turnover = v.planned_turnover,
        tactic_spend = v.tactic_spend,
        planned_gp = v.planned_gp,
        gp_roi = v.gp_roi,
        rag_status = v.rag_status,
        calculated_kpis = v.calculated_kpis,
        updated_at = NOW()
      FROM (VALUES ${rowsSql.join(', ')}) AS v(
        id, incremental_volume, planned_turnover, tactic_spend,
        planned_gp, gp_roi, rag_status, calculated_kpis
      )
      WHERE ps.id = v.id AND ps.tenant_id = $${tenantParamIndex}::uuid
      `,
      params,
    );
  }

  /**
   * T-034: CAS write for the grid-cell volume edit
   * (PlanService#updateSkuVolume). Single atomic UPDATE — no extra query
   * turn on this hot path (BRD <500ms).
   */
  async updatePlanSkuVersioned(
    planSkuId: string,
    tenantId: string,
    expectedVersion: number,
    data: Partial<PlanSku>,
  ): Promise<PlanSku> {
    const affected = await applyVersionedUpdate(
      this.planSkuRepo,
      { id: planSkuId, tenantId },
      expectedVersion,
      data as any,
    );
    if (affected === 0) {
      const current = await this.planSkuRepo.findOne({
        where: { id: planSkuId, tenantId },
      });
      if (!current) {
        throw new NotFoundException(`SKU ${planSkuId} not found in this plan`);
      }
      throw staleVersionConflict({
        entity: 'PLAN_SKU',
        entityId: planSkuId,
        expectedVersion,
        currentVersion: current.version,
        current: {
          baseVolume: current.baseVolume,
          plannedVolume: current.plannedVolume,
          updatedBy: current.updatedBy,
        },
      });
    }
    const updated = await this.planSkuRepo.findOne({
      where: { id: planSkuId, tenantId },
      relations: ['sku', 'planFu'],
    });
    if (!updated) {
      throw new Error('PlanSKU not found after update');
    }
    return updated;
  }

  /** T-034 §1.5: tenantId predicate added (see #findPlanFu). */
  async removeSku(planSkuId: string, tenantId: string): Promise<void> {
    await this.planSkuRepo.delete({ id: planSkuId, tenantId });
  }
}
