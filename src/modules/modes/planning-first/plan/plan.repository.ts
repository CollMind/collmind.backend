import { Injectable, NotFoundException } from '@nestjs/common';
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
   */
  async updateUnversioned(
    id: string,
    tenantId: string,
    data: Partial<Plan>,
  ): Promise<Plan> {
    await this.planRepo.update({ id, tenantId }, data);
    const updated = await this.findById(id, tenantId);
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
  async addFu(
    planId: string,
    fuId: string,
    tenantId: string,
    userId: string,
    tactics?: Record<string, number>,
  ): Promise<PlanFu> {
    const planFu = this.planFuRepo.create({
      planId,
      fuId,
      tenantId,
      createdBy: userId,
      tactics,
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
   */
  async updatePlanFuUnversioned(
    planFuId: string,
    tenantId: string,
    data: Partial<PlanFu>,
  ): Promise<PlanFu> {
    await this.planFuRepo.update({ id: planFuId, tenantId }, data);
    const updated = await this.planFuRepo.findOne({
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
      throw staleVersionConflict({
        entity: 'PLAN_FU',
        entityId: planFuId,
        expectedVersion,
        currentVersion: current.version,
        current: { tactics: current.tactics, updatedBy: current.updatedBy },
      });
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

  /** T-034 §1.5: tenantId predicate added (see #findPlanFu). */
  async findPlanSku(
    planFuId: string,
    skuId: string,
    tenantId: string,
  ): Promise<PlanSku | null> {
    return this.planSkuRepo.findOne({
      where: { planFuId, skuId, tenantId },
      relations: ['sku', 'planFu'],
    });
  }

  /**
   * T-034: deliberate CAS bypass (see #updatePlanFuUnversioned). Used by
   * `recalculatePlanWithKpiEngine` — plannedGp/gpRoi/ragStatus/calculatedKpis
   * etc. are derived outputs, never a user's direct edit.
   */
  async updatePlanSkuUnversioned(
    planSkuId: string,
    tenantId: string,
    data: Partial<PlanSku>,
  ): Promise<PlanSku> {
    await this.planSkuRepo.update({ id: planSkuId, tenantId }, data);
    const updated = await this.planSkuRepo.findOne({
      where: { id: planSkuId, tenantId },
      relations: ['sku', 'planFu'],
    });
    if (!updated) {
      throw new Error('PlanSKU not found after update');
    }
    return updated;
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
