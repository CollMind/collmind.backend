import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PlanRepository, planFuStaleConflict } from './plan.repository';
import { Mechanic } from '../../../../database/entities/mechanic.entity';
import {
  ScaleViolation,
  checkEnteredScale,
} from '../../../../common/numeric/mechanic-input';
import {
  CreatePlanDto,
  UpdatePlanDto,
  AddFuDto,
  RemoveFuDto,
  DeletePlanDto,
  UpdateFuTacticDto,
  UpdateSkuVolumeDto,
} from './dto';
import {
  missingVersionConflict,
  staleVersionConflict,
} from '../../../shared/persistence/versioned-update.helper';
import {
  Plan,
  PlanStatus,
  PlanFu,
  PlanSku,
} from '../../../../database/entities/plan.entity';
import {
  BudgetService,
  isSplitDimensionGuardError,
} from '../../../shared/budget/budget.service';
import {
  BudgetEnvelopeStatus,
  BudgetSpendType,
} from '../../../../database/entities/budget-envelope.entity';
import { ApprovalService } from '../../../shared/approval/approval.service';
import {
  KpiEngineService,
  CalculationResult,
  SkuCalculationContext,
} from '../../../shared/kpi-engine/kpi-engine.service';
import { SpendCalculationService } from '../../../shared/spend-calculation/spend-calculation.service';
import {
  SKUContext,
  CalculationContext,
} from '../../../shared/spend-calculation/dto/calculation-context.dto';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ForecastingUnit } from '../../../../database/entities/forecasting-unit.entity';
import { Sku } from '../../../../database/entities/sku.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';
import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from '../../../../database/entities/plan-approval-history.entity';
import { UserRole } from '../../../../database/entities/user.entity';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { ConfigService } from '@nestjs/config';
import { RecalcTelemetryContext } from '../../../../common/services/recalc-telemetry.service';

/**
 * T-028b: caller identity for scope-aware reads/decisions. Optional on
 * purpose — internal callers (e.g. addFu -> findById) that do not have an
 * actor keep today's unscoped behavior (PLANNER enforcement is T-028c's
 * job, not this one's).
 */
export interface PlanActor {
  userId: string;
  role: UserRole;
}

/**
 * T-046b (docs/analysis/0007 §4-T1) — which caller triggered a recalc, for
 * the structured telemetry log. Purely descriptive (never branches
 * behavior) — new callers may pass any string, but these cover today's
 * call sites.
 */
export type RecalcTrigger =
  | 'updateSkuVolume'
  | 'updateFuTactic'
  | 'addFu'
  | 'removeFu'
  | 'calculateKpis'
  | 'manual';

/**
 * T-041: sub-record mutations (addFu/updateFuTactic/updateSkuVolume/removeFu)
 * bump either `plans.version` (structural changes) or a child row's version
 * (tactic/volume edits) but historically only ever returned the child
 * entity — never the CURRENT `plans.version`. The frontend's multi-FU-add
 * flow compensated by guessing `version + 1` locally
 * (PlanningGridEnhanced.tsx:914), which breaks the moment another user's
 * edit lands in between. Every mutation below now additionally reports
 * `planVersion` — the plan's version AS OF the moment this mutation
 * returned (post-CAS-bump for addFu/removeFu, unchanged-but-accurate for
 * updateFuTactic/updateSkuVolume, which never touch `plans.version`) — so
 * the client can chain the next structural write off a value the server
 * actually confirmed, not one it predicted.
 */
export type PlanFuWithVersion = PlanFu & { planVersion: number };
export type PlanSkuWithVersion = PlanSku & { planVersion: number };

/**
 * T-027: Convert a raw (possibly string-typed decimal column, null, or
 * undefined) value into a strict number-or-null. Distinguishes "genuinely
 * absent" master/user data (null/undefined/NaN) from a legitimately entered
 * 0, which callers must NOT coalesce together — BRD requires missing data to
 * propagate as null through the KPI engine, never silently become 0.
 *
 * ⚠️ HAS A TWIN: `boundOf` in `mechanic.service.ts`. Do NOT merge them yet, and
 * read that function's comment before trying — the obvious move launders ratchet
 * debt (line 119 below is one of this file's 36 findings, and the destination
 * `src/common/numeric/` is exempt from the detector, so the finding would vanish
 * rather than move). T-086 makes the exemption per-file; T-087 then does the
 * merge honestly. This note lives here too because whoever attempts the merge
 * will most likely start from THIS file — it is the one under ratchet pressure.
 */
function toNullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private readonly planRepo: PlanRepository,
    private readonly budgetService: BudgetService,
    private readonly approvalService: ApprovalService,
    private readonly kpiEngine: KpiEngineService,
    private readonly spendCalc: SpendCalculationService,
    @InjectRepository(ForecastingUnit)
    private readonly fuRepo: Repository<ForecastingUnit>,
    @InjectRepository(Sku)
    private readonly skuRepo: Repository<Sku>,
    @InjectRepository(Tactic)
    private readonly tacticRepo: Repository<Tactic>,
    @InjectRepository(PlanApprovalHistory)
    private readonly approvalHistoryRepo: Repository<PlanApprovalHistory>,
    private readonly accessScope: AccessScopeService,
    // T-034b: state transitions (submit/approve/reject/returnToDraft) run
    // inside a real QueryRunner transaction — see docs/analysis/0005 §4 —
    // rather than the compensate-on-failure pattern the four methods used
    // before (T-026/T-029). DataSource is the standard NestJS/TypeORM way
    // to open one (same mechanism as SettlementCloseService).
    private readonly dataSource: DataSource,
    // T-046b (docs/analysis/0007 §4-T1): recalc's WARN threshold comes from
    // config, never hardcoded (BRD dynamic-config principle — RolesGuard/
    // budget-threshold/KPI config all follow the same rule; a perf
    // threshold is no different). `AccessScopeService` already establishes
    // the `ConfigService` injection pattern in this codebase
    // (SCOPE_ENFORCEMENT_ENABLED).
    private readonly configService: ConfigService,
    // T-046b (docs/analysis/0007 §4-T2): carries recalc timing/size out to
    // RecalcMetricsInterceptor for the `X-Recalc-Ms` response header — see
    // that service's doc comment for why this is safe as a singleton.
    private readonly recalcTelemetry: RecalcTelemetryContext,
  ) {}

  /**
   * T-028b (CM) + T-028c (PLANNER, generalized): scope-aware read guard,
   * used by findById. AccessScopeService.resolveScope already encodes the
   * per-role semantics (ADMIN/FM/READONLY -> UNRESTRICTED **only when a
   * wildcard user_scopes row exists** — Z30 H8, 2026-08-24: the code-branch
   * shortcut was removed, unrestrictedness now comes from data (K-2.6.4f);
   * CM -> category-
   * only pairs, PLANNER -> full cpl+category pairs, flag-gated) — so this
   * helper can stay role-agnostic: it just resolves whatever scope the
   * actor's role produces and checks the plan against it. Out-of-scope ->
   * 404 (varlık sızdırma yok — BRD/§9 N3/N8). No actor (internal callers,
   * e.g. recalculatePlanWithKpiEngine) -> unscoped, unchanged.
   */
  private async assertReadScope(
    plan: Plan,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<void> {
    if (!actor) return;
    const scope = await this.accessScope.resolveScope(
      tenantId,
      actor.userId,
      actor.role,
    );
    if (
      !this.accessScope.isInScope(scope, {
        cplId: plan.cplId,
        categoryId: plan.categoryId,
      })
    ) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Plan with ID ${plan.id} not found`,
        code: 'OUT_OF_SCOPE',
      });
    }
  }

  /**
   * T-028b: CM kategori-scoped karar (approve/reject). Kesişim yoksa 403 —
   * okumadan farklı olarak burada varlık zaten biliniyor (aksiyon denendi),
   * bu yüzden 404 değil 403 (§3 tablosu).
   */
  private async assertCmDecisionScope(
    plan: Plan,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<void> {
    if (!actor || actor.role !== UserRole.CATEGORY_MANAGER) return;
    const scope = await this.accessScope.resolveScope(
      tenantId,
      actor.userId,
      actor.role,
    );
    this.accessScope.assertEntityInScope(scope, {
      categoryId: plan.categoryId,
    });
  }

  /**
   * T-029: Write an immutable PlanApprovalHistory entry. Mirrors the pattern
   * already established in ApprovalWorkflowService#createHistoryEntry (same
   * entity/table) — duplicated here (not delegated cross-service) because
   * PlanService.submit/approve/reject are the endpoints actually wired to the
   * frontend (plans.endpoints.ts) and to the BRD-proven role-journey e2e flow
   * (`/plans/:id/submit`, `/approve`, `/reject`), so this is the canonical
   * path for those three actions. See T-029 task report for the full
   * canonical-implementation rationale.
   */
  private async createHistoryEntry(
    planId: string,
    tenantId: string,
    userId: string,
    action: ApprovalHistoryAction,
    comments?: string,
    rejectionReason?: string,
    manager?: EntityManager,
  ): Promise<PlanApprovalHistory> {
    // T-034b: when called from within a state-transition's QueryRunner
    // transaction, the history row must land on that SAME manager so it
    // commits/rolls back atomically with the status write + budget side
    // effect (real transactionality replaces the old compensate-on-failure
    // pattern this method used to require — see submit/approve/reject/
    // returnToDraft below).
    const repo = manager
      ? manager.getRepository(PlanApprovalHistory)
      : this.approvalHistoryRepo;
    const history = repo.create({
      planId,
      tenantId,
      actionedById: userId,
      action,
      comments,
      rejectionReason,
    });
    return repo.save(history);
  }

  async create(
    dto: CreatePlanDto,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    // T-028c: PLANNER may only create plans within their assigned CPL+
    // Category scope (BRD "Planner sadece yetkili CPL+Category"). ADMIN is
    // UNRESTRICTED via its wildcard user_scopes row (Z30 H8 — NOT "always";
    // the code-branch shortcut is gone, an ADMIN without that row resolves
    // to SCOPED{pairs:[]} and is denied. Route allows only ADMIN|PLANNER).
    // Flag-
    // gated inside AccessScopeService — no-op while SCOPE_ENFORCEMENT_ENABLED
    // is false.
    if (actor) {
      const scope = await this.accessScope.resolveScope(
        tenantId,
        actor.userId,
        actor.role,
      );
      this.accessScope.assertEntityInScope(scope, {
        cplId: dto.cplId,
        categoryId: dto.categoryId,
      });
    }

    // Calculate period month from start date
    const startDate = new Date(dto.startDate);
    const periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

    // Retry logic for plan code generation (handle race conditions)
    const maxAttempts = 10;
    let lastError: any;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Generate plan code
        let planCode = await this.planRepo.generatePlanCode(tenantId);

        // If not first attempt, add suffix to make it unique
        if (attempt > 0) {
          const timestamp = Date.now().toString().slice(-4);
          planCode = `${planCode}-${timestamp}`;
        }

        // Check if code already exists
        const existing = await this.planRepo.findByCode(planCode, tenantId);
        if (existing) {
          await new Promise((resolve) =>
            setTimeout(resolve, 50 * (attempt + 1)),
          );
          continue;
        }

        // Try to create plan
        const plan = await this.planRepo.create({
          ...dto,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          planCode,
          periodMonth,
          tenantId,
          status: PlanStatus.DRAFT,
          createdBy: userId,
          totalPlannedVolume: 0,
          totalSpend: 0,
          totalGp: 0,
        });

        return plan;
      } catch (error: any) {
        lastError = error;

        if (
          error.code === '23505' ||
          error.message?.includes('duplicate key')
        ) {
          if (attempt < maxAttempts - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * (attempt + 1)),
            );
            continue;
          }
        }

        if (
          attempt === maxAttempts - 1 ||
          (error.code !== '23505' && !error.message?.includes('duplicate key'))
        ) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      `Unable to create plan: ${lastError?.message || 'Unknown error'}`,
    );
  }

  async findById(
    id: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    const plan = await this.planRepo.findById(id, tenantId);
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${id} not found`);
    }
    // T-028b (CM) / T-028c (PLANNER): out-of-scope plan -> 404 (varlık
    // sızdırma yok, §9 N3/N8).
    await this.assertReadScope(plan, tenantId, actor);
    return plan;
  }

  async findAll(
    tenantId: string,
    filters?: {
      status?: PlanStatus;
      cplId?: string;
      channelId?: string;
      categoryId?: string;
    },
    actor?: PlanActor,
  ): Promise<Plan[]> {
    const scope = await this.resolveScopeForFilter(tenantId, actor);
    return this.planRepo.findAll(tenantId, filters, scope);
  }

  async findPendingApprovals(
    tenantId: string,
    actor?: PlanActor,
  ): Promise<Plan[]> {
    const scope = await this.resolveScopeForFilter(tenantId, actor);
    return this.planRepo.findAll(
      tenantId,
      { status: PlanStatus.PENDING_APPROVAL },
      scope,
    );
  }

  /**
   * T-028b (CM) / T-028c (PLANNER, generalized): resolves (and returns) the
   * actor's scope for list/queue filtering. For ADMIN/FINANCE_MANAGER/
   * READONLY this resolves to UNRESTRICTED via their wildcard user_scopes
   * row (Z30 H8: NO LONGER "no-DB-query" — resolveScope now reads rows for
   * every role; a 5s cache absorbs the cost), so resolving unconditionally
   * whenever
   * an actor is present is safe — PlanRepository#findAll treats an
   * UNRESTRICTED scope as a no-op filter. undefined actor (internal
   * callers) -> undefined scope -> no-op filter, unchanged.
   */
  private async resolveScopeForFilter(tenantId: string, actor?: PlanActor) {
    if (!actor) return undefined;
    return this.accessScope.resolveScope(tenantId, actor.userId, actor.role);
  }

  async update(
    id: string,
    dto: UpdatePlanDto,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    // T-028c: findById already throws 404 (OUT_OF_SCOPE) when actor is
    // out-of-scope PLANNER — threading actor here closes the write-path gap
    // (a PLANNER could otherwise reach an out-of-scope plan's mutation
    // endpoints via any of update/addFu/updateFuTactic/updateSkuVolume/
    // removeFu/delete/submit, all of which resolve the plan through
    // findById).
    const plan = await this.findById(id, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be edited');
    }

    // T-034: optimistic locking, strict mode — version is required; a
    // request that omits it is rejected with 409 MISSING_VERSION (not a
    // ValidationPipe 400 — see UpdatePlanDto#version).
    if (dto.version === undefined || dto.version === null) {
      throw missingVersionConflict({ entity: 'PLAN', entityId: id });
    }

    // T-034: strip `version` (CAS metadata, not a Plan column) before
    // spreading the rest of the DTO into the update payload.
    const {
      startDate: dtoStartDate,
      endDate: dtoEndDate,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      version: _version,
      ...dtoWithoutDates
    } = dto;
    const updateData: Partial<Plan> = { ...dtoWithoutDates, updatedBy: userId };

    if (dtoStartDate) {
      const startDate = new Date(dtoStartDate);
      updateData.periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
      updateData.startDate = startDate;
    }
    if (dtoEndDate) {
      updateData.endDate = new Date(dtoEndDate);
    }

    return this.planRepo.updateVersioned(id, tenantId, dto.version, updateData);
  }

  async addFu(
    planId: string,
    dto: AddFuDto,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
  ): Promise<PlanFuWithVersion> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    // T-034: adding an FU is a structural plan change — CAS-bump
    // plans.version BEFORE any insert happens (see docs/analysis/0005 §3).
    // Strict mode: missing planVersion -> 409 MISSING_VERSION.
    if (dto.planVersion === undefined || dto.planVersion === null) {
      throw missingVersionConflict({ entity: 'PLAN', entityId: planId });
    }
    // T-041: capture the POST-bump plan returned by updateVersioned (not
    // the pre-bump `plan` loaded above) — this is the value that must go
    // back to the caller, see PlanFuWithVersion's doc comment.
    const bumpedPlan = await this.planRepo.updateVersioned(
      planId,
      tenantId,
      dto.planVersion,
      { updatedBy: userId },
    );

    // Verify FU exists and is plannable
    const fu = await this.fuRepo.findOne({ where: { id: dto.fuId, tenantId } });
    if (!fu) {
      throw new NotFoundException(
        `Forecasting Unit with ID ${dto.fuId} not found`,
      );
    }
    if (!fu.isPlannable) {
      throw new BadRequestException(
        `Forecasting Unit ${fu.code} is not plannable`,
      );
    }

    // Check if FU already added
    const existing = await this.planRepo.findPlanFu(planId, dto.fuId, tenantId);
    if (existing) {
      throw new ConflictException('FU already added to this plan');
    }

    // Add FU to plan. T-079: no `tactics` argument — the field was removed from
    // AddFuDto because it was an ungated second write path to `plan_fus.tactics`
    // with zero callers. A new FU is born with no tactics; they are entered
    // through `PATCH .../tactics`, which is scale-validated (F2/C3).
    const planFu = await this.planRepo.addFu(
      planId,
      dto.fuId,
      tenantId,
      userId,
    );

    // Auto-add all SKUs for this FU
    const skus = await this.skuRepo.findBy({
      fuId: dto.fuId,
      tenantId,
      isActive: true,
    });
    for (const sku of skus) {
      await this.planRepo.addSku(planFu.id, sku.id, tenantId, userId);
    }

    // Recalculate plan totals using KPI engine
    await this.recalculatePlanWithKpiEngine(
      planId,
      tenantId,
      undefined,
      undefined,
      'addFu',
    );

    const savedPlanFu = (await this.planRepo.findPlanFu(
      planId,
      dto.fuId,
      tenantId,
    )) as PlanFu;
    return { ...savedPlanFu, planVersion: bumpedPlan.version };
  }

  async updateFuTactic(
    planId: string,
    fuId: string,
    dto: UpdateFuTacticDto,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<PlanFuWithVersion> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId, tenantId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    // T-034: optimistic locking, strict mode — plan_fus.version required.
    if (dto.version === undefined || dto.version === null) {
      throw missingVersionConflict({ entity: 'PLAN_FU', entityId: planFu.id });
    }

    // C3 step 1: the mechanics this request's tactic keys will be judged
    // against. Loaded ONCE here and handed to recalc below (step 5) instead
    // of letting recalc re-query them — `getActiveMechanics` is uncached by
    // design (tenant leakage / stale-config risk, see
    // spend-calculation.service.ts), so without threading it through, the
    // same request would issue the identical query twice.
    const mechanics = await this.spendCalc.getActiveMechanics(tenantId);

    // C3 step 2: version pre-check.
    //
    // ⚠️ THIS IS NOT THE RACE PROTECTION. The real compare-and-swap is the
    // `updatePlanFuVersioned` call below, and it must stay there: between
    // this read and that write another request can still land, in which case
    // the CAS returns affected=0 and raises the same 409. That outcome is
    // expected, not a hole.
    //
    // The only purpose of checking here is ORDERING: a stale request must not
    // have its body scale-validated. A stale write reaches no column, so
    // judging its values would report a 400 about numbers that were never
    // going to be stored — and would mask the 409 the client actually needs.
    // Do not delete the CAS below on the strength of this check.
    if (planFu.version !== dto.version) {
      throw planFuStaleConflict(planFu, dto.version);
    }

    // C3 step 3: scale validation — only for requests that got past step 2.
    // Every value written by THIS endpoint passes the gate, for the three
    // rules that have been decided (rate bound, kuruş on totals, finiteness);
    // a value failing one is rejected, never rounded (CLAUDE.md §2.5). What is
    // deliberately NOT judged is listed in checkEnteredScale's SCOPE note —
    // read it before treating this line as "scale is closed". The scale itself
    // comes from `toMechanicInput`, the same single derivation point the read
    // side uses.
    if (dto.tactics) {
      const byCode = new Map(mechanics.map((m) => [m.code, m]));
      const violations: ScaleViolation[] = [];
      for (const [code, raw] of Object.entries(dto.tactics)) {
        const mechanic = byCode.get(code);
        // An unresolvable code is rejected here, at the write, through the SAME
        // producers recalc uses (spend-calculation.service.ts) — not a second
        // error source.
        //
        // This is not a new decision: it was already made downstream. Skipping
        // the key here and letting recalc raise it is strictly worse, because
        // the two are not in one transaction. The write commits on its own
        // connection; recalc then throws and rolls back only ITS transaction.
        // The client sees 400 and the bad key stays on disk — after which every
        // later recalc AND submit for that plan hits the same 400 on the same
        // key. The plan becomes unopenable by the same error that was supposed
        // to be a typo message. Rejecting before the write is what keeps the
        // 400 recoverable.
        //
        // T-083a: which of the two failures this is — a typo, or a mechanic an
        // admin deactivated while the plan already carried it — is resolved by
        // the SAME helper the recalc path uses. Resolving it here too matters
        // more than on the read side: this is the request the planner is
        // actually making, so this is the message they actually read.
        //
        // This read goes through the injected repository, i.e. the DEFAULT
        // connection. That is deliberate and is NOT the recalc method's "every
        // read/write must go through the given manager" rule (see
        // `recalculatePlanWithKpiEngineLocked`): this call site holds no
        // transaction, and the row it reads is master data whose only effect is
        // which message the 400 carries. The same helper is also called from
        // inside the locked recalc, where the exception is narrower but real —
        // documented at that call site.
        if (!mechanic) {
          throw await this.spendCalc.describeUnresolvedMechanicCode(
            code,
            planFu.id,
            byCode,
            tenantId,
          );
        }
        const violation = checkEnteredScale(mechanic, raw);
        if (violation) violations.push(violation);
      }
      if (violations.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'INVALID_SCALE',
          message:
            'One or more entered values do not fit the scale of their mechanic.',
          violations,
        });
      }
    }

    // C3 step 4: the write. CAS against plan_fus.version — the real race
    // protection (see step 2).
    //
    // T-080: MERGE, not replace. This used to be `dto.tactics || planFu.tactics`,
    // which put the request body in place of the whole JSONB. The grid sends ONE
    // key per cell edit (`{ [mechanicCode]: value }`,
    // PlanningGridEnhanced.tsx:1031, the single call site), so entering a second
    // mechanic deleted the first. Silently: no error, no 409, the value simply
    // stopped existing. Nobody had hit it because `plan_fus` holds 0 rows.
    //
    // WHY THE TESTS WERE GREEN THROUGH ALL OF IT
    // Every pre-existing e2e case that covers multi-mechanic tactics sends its
    // mechanics in a SINGLE request — and there, replace and merge produce
    // identical results. Not one of them could tell the two semantics apart.
    // (No count is quoted: two independent recounts of "how many" disagreed,
    // and it moves with every test added. The property that matters is the
    // SHAPE — one request — and that is what made them all blind.)
    //
    // The gap was not missing coverage but wrongly SHAPED coverage. The tests
    // added with this change write two mechanics in two SEPARATE requests,
    // which is the only shape that distinguishes them.
    //
    // WHY MERGE AND NOT REPLACE, given replace also "worked"
    // Replace was not supporting a capability. Removing a tactic is not
    // expressible today at all: an emptied cell yields `parseFloat('') = NaN`,
    // and BOTH front-end entry paths drop the request on it —
    // PlanningGridEnhanced.tsx:1498-1499 (and the Enter twin at :1505-1509) and
    // grid-cells.tsx:78-79 (`EditableCell`, reached from :1567). So
    // replace deleted only by accident. Merge costs no capability, and the
    // deliberate "remove a key" path is T-083 — deferred because making `null`
    // mean "remove" would decide the nullity question that T-078/T-082 own, and
    // deciding it twice is how the two answers drift.
    //
    // Two shapes preserved on purpose:
    //   `tactics` omitted  → unchanged (as before)
    //   `tactics` is `{}`  → now a no-op; under replace it wiped every key
    //
    // The merge base cannot be stale: `planFu` was read above, and the CAS below
    // fails with 409 if anything changed the row in between — so the base is
    // always the row this write is actually applied to.
    await this.planRepo.updatePlanFuVersioned(
      planFu.id,
      tenantId,
      dto.version,
      {
        tactics: dto.tactics
          ? { ...(planFu.tactics ?? {}), ...dto.tactics }
          : planFu.tactics,
      },
    );

    // Recalculate using KPI engine. T-046a: this action doesn't change the
    // plan's FU count, so `plan` (loaded above, already scope-checked) is
    // still an accurate "does this plan have FUs" guard — pass it through
    // to skip recalc's own duplicate pre-transaction `findById`.
    // C3 step 5: hand recalc the mechanics already loaded at step 1 rather
    // than making it re-query them.
    await this.recalculatePlanWithKpiEngine(
      planId,
      tenantId,
      actor,
      plan,
      'updateFuTactic',
      mechanics,
    );

    const savedPlanFu = (await this.planRepo.findPlanFu(
      planId,
      fuId,
      tenantId,
    )) as PlanFu;
    // T-041: this mutation only CAS-bumps plan_fus.version, never
    // plans.version (see PlanFuWithVersion doc comment) — `plan` (loaded,
    // scope-checked, above) still reflects the current plan version.
    return { ...savedPlanFu, planVersion: plan.version };
  }

  async updateSkuVolume(
    planId: string,
    fuId: string,
    skuId: string,
    dto: UpdateSkuVolumeDto,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<PlanSkuWithVersion> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId, tenantId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    const planSku = await this.planRepo.findPlanSku(planFu.id, skuId, tenantId);
    if (!planSku) {
      throw new NotFoundException('SKU not found in this plan');
    }

    // T-034: optimistic locking, strict mode — plan_skus.version required.
    // Grid hot path (BRD <500ms) — this check + the CAS write below add no
    // extra round trip (single atomic UPDATE, see applyVersionedUpdate).
    if (dto.version === undefined || dto.version === null) {
      throw missingVersionConflict({
        entity: 'PLAN_SKU',
        entityId: planSku.id,
      });
    }

    // Update volumes
    const incrementalVolume =
      dto.plannedVolume && dto.baseVolume
        ? dto.plannedVolume - dto.baseVolume
        : dto.plannedVolume && planSku.baseVolume
          ? dto.plannedVolume - planSku.baseVolume
          : planSku.incrementalVolume;

    await this.planRepo.updatePlanSkuVersioned(
      planSku.id,
      tenantId,
      dto.version,
      {
        baseVolume: dto.baseVolume ?? planSku.baseVolume,
        plannedVolume: dto.plannedVolume ?? planSku.plannedVolume,
        incrementalVolume,
      },
    );

    // Recalculate using KPI engine. T-046a: this action doesn't change the
    // plan's FU count, so `plan` (loaded above, already scope-checked) is
    // still an accurate "does this plan have FUs" guard — pass it through
    // to skip recalc's own duplicate pre-transaction `findById` (the exact
    // duplication measured in docs/analysis/0007 §2.3 item C #1/#2, on
    // this exact endpoint — `PATCH .../volume` is the harness's measured
    // request).
    await this.recalculatePlanWithKpiEngine(
      planId,
      tenantId,
      actor,
      plan,
      'updateSkuVolume',
    );

    const savedPlanSku = (await this.planRepo.findPlanSku(
      planFu.id,
      skuId,
      tenantId,
    )) as PlanSku;
    // T-041: same rationale as updateFuTactic — only plan_skus.version is
    // CAS-bumped here, `plan.version` (loaded above) is unchanged.
    return { ...savedPlanSku, planVersion: plan.version };
  }

  async removeFu(
    planId: string,
    fuId: string,
    tenantId: string,
    dto?: RemoveFuDto,
    actor?: PlanActor,
  ): Promise<{ planVersion: number }> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId, tenantId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    // T-034: removing an FU is a structural plan change — CAS-bump
    // plans.version BEFORE the delete happens (see docs/analysis/0005 §3,
    // same pattern as addFu). Strict mode: missing planVersion -> 409
    // MISSING_VERSION.
    if (!dto || dto.planVersion === undefined || dto.planVersion === null) {
      throw missingVersionConflict({ entity: 'PLAN', entityId: planId });
    }
    const bumpedPlan = await this.planRepo.updateVersioned(
      planId,
      tenantId,
      dto.planVersion,
      {},
    );

    await this.planRepo.removeFu(planFu.id, tenantId);
    await this.recalculatePlanWithKpiEngine(
      planId,
      tenantId,
      undefined,
      undefined,
      'removeFu',
    );

    // T-041: 204 No Content has no body by HTTP convention (unlike
    // addFu/updateFuTactic/updateSkuVolume, which already return a JSON
    // entity) — the controller surfaces this via the `X-Plan-Version`
    // response header instead of changing the status code.
    return { planVersion: bumpedPlan.version };
  }

  /**
   * T-034b (docs/analysis/0005 §4): real transaction + `FOR UPDATE` +
   * status-CAS, replacing the old compensate-on-failure pattern (T-026/
   * T-029). Prior code committed budget side effects (reserveForPlan) BEFORE
   * the status write and separately ran history-write compensation
   * try/catches after — the version-CAS added in T-034 does not close this,
   * because two concurrent submits could both pass the initial
   * `status === DRAFT` check and both reserve budget before either wrote
   * status. A single QueryRunner transaction now makes the lock, the
   * precondition check, the budget RESERVE, and the status/history writes
   * atomic: any failure anywhere rolls back the whole thing, so no manual
   * compensation code is needed anymore.
   *
   * `expectedVersion` is the ONE state-transition version check (K5's
   * documented exception, see SubmitPlanDto) — reserveForPlan() below
   * commits `plan.totalSpend`, a value the submitter may not have actually
   * seen if someone else edited a SKU volume moments before submit.
   */
  async submit(
    id: string,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
    expectedVersion?: number,
  ): Promise<Plan> {
    // Cheap pre-transaction read: 404/OUT_OF_SCOPE (PlanActor scope) and the
    // channel code (channel does not participate in the money/status race
    // this task closes — it is effectively immutable once a plan exists in
    // practice, and even if it changed concurrently the worst case is an
    // envelope lookup against a momentarily-stale channel, not a lost
    // update or a double-spend).
    const initial = await this.findById(id, tenantId, actor);
    const channelCode = initial.channel?.code || '';

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // T-034b step 1: lock the row before deciding anything.
      const plan = await this.planRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!plan) {
        throw new NotFoundException(`Plan with ID ${id} not found`);
      }

      // T-034b step 2: precondition.
      if (plan.status !== PlanStatus.DRAFT) {
        throw new BadRequestException('Only DRAFT plans can be submitted');
      }

      // K5 exception: submit() also validates plans.version.
      if (expectedVersion === undefined || expectedVersion === null) {
        throw missingVersionConflict({ entity: 'PLAN', entityId: id });
      }
      if (plan.version !== expectedVersion) {
        throw staleVersionConflict({
          entity: 'PLAN',
          entityId: id,
          expectedVersion,
          currentVersion: plan.version,
          current: {
            totalSpend: Number(plan.totalSpend),
            updatedBy: plan.updatedBy,
            updatedAt: plan.updatedAt,
          },
        });
      }

      const fuCount = await queryRunner.manager.count(PlanFu, {
        where: { planId: id, tenantId },
      });
      if (fuCount === 0) {
        throw new BadRequestException(
          'Plan must have at least one FU before submission',
        );
      }

      // T-034b step 3: side effects, inside the same transaction.
      const approvalRequest = await this.approvalService.createRequest(
        {
          requestType: ApprovalRequestType.PLAN,
          entityType: 'PLAN',
          entityId: plan.id,
        },
        tenantId,
        userId,
        queryRunner.manager,
      );

      // T-056 adım 5 (docs/analysis/0009 §4.1-§4.2, §6 adım 5): canlı submit
      // yolu artık TOTAL kovaya değil, adım 3'ün `reserveTypedForPlan` tek
      // rezervasyon motoruna geçer — on/off ayrımı ilk kez üründe erişilebilir
      // olur (ADR 0005). Kaynak: adım 4'ün recalc'te yazdığı
      // `plan.onInvoiceSpend`/`offInvoiceSpend` kolonları — submit anında
      // yeniden hesaplama YAPILMAZ ([[T-046a]]'nın 1746 ms'lik yüzeyini canlı
      // submit'e taşımamak ve rezerve edilen tutarı kullanıcının ekranda
      // gördüğünden (`plan.totalSpend`, T-034f version CAS'ın koruduğu değer)
      // ayırmamak için — 0009 §4.2 karar B).
      if (Number(plan.totalSpend) > 0) {
        const totalSpend = Number(plan.totalSpend);
        const onInvoice = Number(plan.onInvoiceSpend) || 0;
        const offInvoice = Number(plan.offInvoiceSpend) || 0;

        // ADR 0005 K3 — bayat 0/0 → GÜRÜLTÜLÜ RED (sessiz onarım DEĞİL,
        // 0009 §4.2'nin ilk taslağının aksine): kolonlar yalnız recalc
        // koştuğunda yazılır (adım 4); hiç recalc edilmemiş/eski bir plan
        // `0/0` taşır. Sessizce 0 rezerve etmek bütçeyi eksik düşürür — bu
        // oturumda tekrar eden "sessiz sıfır" hata sınıfı (T-033/T-052/T-053).
        if (onInvoice === 0 && offInvoice === 0) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PLAN_SPEND_BREAKDOWN_STALE',
            message:
              `Plan ${id} has totalSpend=${totalSpend} but no on/off-invoice ` +
              `spend breakdown recorded (0/0). Recalculate the plan (POST ` +
              `/plans/${id}/recalculate) before submitting.`,
          });
        }

        // Özdeşlik kapısı: `on + off === totalSpend` adım 4'ün inşaat gereği
        // garanti ettiği bir değişmezdir (0009 §4.2/§2.5, tek türetim
        // noktası — `buildMechanicValues`). Tutmuyorsa kolonlar bayat/bozuk
        // demektir; sessizce farklı bir tutar rezerve etmek yerine reddet.
        if (Math.abs(onInvoice + offInvoice - totalSpend) > 0.01) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PLAN_SPEND_BREAKDOWN_INCONSISTENT',
            message:
              `Plan ${id} on/off-invoice breakdown (${onInvoice} + ` +
              `${offInvoice} = ${onInvoice + offInvoice}) does not match ` +
              `totalSpend (${totalSpend}). Recalculate the plan (POST ` +
              `/plans/${id}/recalculate) before submitting.`,
          });
        }

        // T-019/T-048/T-053 machinery, now reachable from the live UI route:
        // gate-before-write (ADR 0004 Karar 2), only actually-spent types,
        // deterministic ON→OFF order — all delegated to the single motor.
        await this.budgetService.reserveTypedForPlan(
          id,
          { onInvoice, offInvoice },
          channelCode,
          plan.periodMonth,
          'TRY',
          tenantId,
          userId,
          queryRunner.manager,
        );
      }

      // T-034b step 4: status-CAS write (second defense layer after the
      // FOR UPDATE lock above).
      const affected = await this.planRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        PlanStatus.DRAFT,
        {
          status: PlanStatus.PENDING_APPROVAL,
          approvalRequestId: approvalRequest.id,
          // F7 fix: submittedById must be recorded here too — approve()/
          // reject()'s self-approval guard (docs/analysis/0004 §1/§9 N12)
          // relies on it.
          submittedById: userId,
          submittedAt: new Date(),
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Plan status changed concurrently; retry.',
        });
      }

      // T-029 (SORUN 1): audit immutable — submit must be recorded.
      await this.createHistoryEntry(
        id,
        tenantId,
        userId,
        ApprovalHistoryAction.SUBMITTED,
        undefined,
        undefined,
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return (await this.planRepo.findById(id, tenantId)) as Plan;
  }

  /**
   * Check budget availability for a plan before approval
   *
   * T-057 madde 1 (docs/analysis/0008 §5.6, ADR 0004 Karar 5): this is the
   * ONE unqualified `findEnvelopeByDimensions` call proven to be consumed
   * live by the frontend (`BudgetApprovalModal.tsx` → `planEndpoints
   * .checkBudget`). Every pre-existing field below is preserved BYTE-FOR-
   * BYTE (same shape, same meaning) for the UNSPLIT case — the frontend is
   * NOT touched by this task. `bySpendType` is a purely ADDITIVE §5.6 block;
   * no existing consumer reads it, so adding it cannot break anything.
   *
   * Split-dimension handling (NEW — previously this call would 500/400
   * crash the moment any dimension was actually split, which is exactly
   * what ADR 0004 Karar 5 blocked `POST /budget/envelopes/:id/split` on):
   * split detection reuses T-056 adım 6's pattern — no second/independent
   * "is this split?" query — derived from THIS SAME unqualified call's own
   * guard error (`isSplitDimensionGuardError`, budget.repository.ts).
   */
  async checkBudget(
    id: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<{
    hasBudget: boolean;
    planTotalSpend: number;
    channel: string;
    channelName: string;
    period: string;
    envelope?: {
      id: string;
      code: string;
      name: string;
      allocatedAmount: number;
      availableAmount: number;
      currency: string;
    };
    sufficient?: boolean;
    // T-057 (§5.6, additive): per-type breakdown. Always present once an
    // envelope of EITHER type exists for the dimension (SPLIT or UNSPLIT —
    // typed lookups fall back to the UNSPLIT envelope, §5.1, so this is
    // populated even before any split has ever happened).
    bySpendType?: {
      onInvoice: {
        totalAllocation: number;
        available: number;
        reserved: number;
        consumed: number;
      };
      offInvoice: {
        totalAllocation: number;
        available: number;
        reserved: number;
        consumed: number;
      };
    };
    // T-057 S3 (code-reviewer, 2026-08-04, additive/geriye uyumlu): whether
    // the caller's (channel, periodMonth) dimension has actually been split
    // into distinct ON_INVOICE/OFF_INVOICE envelopes. When `false` (UNSPLIT,
    // legacy or never-split dimension), `bySpendType.onInvoice` and
    // `bySpendType.offInvoice` are the SAME underlying legacy envelope
    // reported TWICE (§5.1 typed lookups both fall back to the one UNSPLIT
    // envelope) — a UI must NOT treat `bySpendType` as evidence of a real
    // split without also checking this flag, or it double-counts a single
    // pool's allocation/available as if it were two independent pools. When
    // `true`, `bySpendType.onInvoice`/`offInvoice` are genuinely independent
    // envelopes.
    splitDimension: boolean;
  }> {
    const plan = await this.findById(id, tenantId, actor);
    const channelCode = plan.channel?.code || '';
    const channelName = plan.channel?.name || channelCode;

    let envelope: Awaited<
      ReturnType<typeof this.budgetService.findEnvelopeByDimensions>
    > = null;
    let splitDimension = false;
    try {
      envelope = await this.budgetService.findEnvelopeByDimensions(
        tenantId,
        channelCode,
        plan.periodMonth,
      );
    } catch (err) {
      if (isSplitDimensionGuardError(err)) {
        splitDimension = true;
      } else {
        throw err;
      }
    }

    if (!envelope && !splitDimension) {
      // No envelope of ANY type for this dimension — the unqualified lookup
      // above already covers BOTH typed and UNSPLIT candidates (§5.1's `OR
      // spend_type IS NULL`), so typed lookups below would be redundant
      // no-op queries returning null again. Zero-valued bySpendType, no
      // extra DB round trips — byte-for-byte the pre-existing early return,
      // plus the additive field.
      return {
        hasBudget: false,
        planTotalSpend: Number(plan.totalSpend),
        channel: channelCode,
        channelName,
        period: plan.periodMonth,
        bySpendType: {
          onInvoice: {
            totalAllocation: 0,
            available: 0,
            reserved: 0,
            consumed: 0,
          },
          offInvoice: {
            totalAllocation: 0,
            available: 0,
            reserved: 0,
            consumed: 0,
          },
        },
        splitDimension, // guard condition above already proves this is false
      };
    }

    // §5.6 typed lookups NEVER hit the guard (spendType is given) — safe to
    // run unconditionally at this point (an envelope of some kind is known
    // to exist, or the dimension is split), SPLIT or UNSPLIT alike (UNSPLIT:
    // both resolve to the same legacy envelope, §5.1).
    const [onStatus, offStatus] = await Promise.all([
      this.budgetService.getBudgetStatus(
        tenantId,
        channelCode,
        undefined,
        plan.periodMonth,
        BudgetSpendType.ON_INVOICE,
      ),
      this.budgetService.getBudgetStatus(
        tenantId,
        channelCode,
        undefined,
        plan.periodMonth,
        BudgetSpendType.OFF_INVOICE,
      ),
    ]);
    const bySpendType = {
      onInvoice: {
        totalAllocation: onStatus.totalAllocation,
        available: onStatus.available,
        reserved: onStatus.reserved,
        consumed: onStatus.consumed,
      },
      offInvoice: {
        totalAllocation: offStatus.totalAllocation,
        available: offStatus.available,
        reserved: offStatus.reserved,
        consumed: offStatus.consumed,
      },
    };

    if (splitDimension) {
      // No SINGLE envelope exists anymore for this dimension — `envelope`/
      // `sufficient` become a combined view built ONLY from numbers already
      // computed above (bySpendType) plus each typed envelope's OWN real id/
      // code/name (never fabricated) — deterministic ON-first identity, the
      // same ordering convention used everywhere else in this machinery
      // (ADR 0004 R4: "her zaman önce ON_INVOICE, sonra OFF_INVOICE").
      const [onEnvelope, offEnvelope] = await Promise.all([
        this.budgetService.findEnvelopeByDimensions(
          tenantId,
          channelCode,
          plan.periodMonth,
          undefined,
          BudgetSpendType.ON_INVOICE,
        ),
        this.budgetService.findEnvelopeByDimensions(
          tenantId,
          channelCode,
          plan.periodMonth,
          undefined,
          BudgetSpendType.OFF_INVOICE,
        ),
      ]);
      const identity = onEnvelope ?? offEnvelope;
      const combinedAllocated =
        onStatus.totalAllocation + offStatus.totalAllocation;
      const combinedAvailable = onStatus.available + offStatus.available;

      // T-057 S2 (code-reviewer, 2026-08-04): `sufficient` must be TYPE
      // BASED, not a sum of the two zarfs — ADR 0004 Karar 2 eki (§5.6)
      // evaluates thresholds per the plan's ACTUALLY-SPENT types
      // independently, the same rule `checkPlanBudgetAvailability` already
      // enforces at submit-time. Summing `onStatus.available +
      // offStatus.available` and comparing to `plan.totalSpend` let a plan
      // with a full off-invoice envelope but an OVER-COMMITTED on-invoice
      // envelope read "sufficient" here (green in the UI) purely because the
      // off-invoice slack masked the on-invoice shortfall, then get 400'd by
      // the real (type-based) gate at submit. `plan.onInvoiceSpend`/
      // `offInvoiceSpend` are the same recalc columns `checkPlanBudgetAvailability`'s
      // callers already pass as `onInvoiceAmount`/`offInvoiceAmount`
      // (adım 4, `onInvoiceSpend + offInvoiceSpend === totalSpend` by
      // construction — see line ~2421) — a zero-spent type is trivially
      // sufficient regardless of its own envelope's state (Karar 2 eki).
      const onSpend = Number(plan.onInvoiceSpend) || 0;
      const offSpend = Number(plan.offInvoiceSpend) || 0;
      const onTypeSufficient =
        onSpend > 0 ? onStatus.available >= onSpend : true;
      const offTypeSufficient =
        offSpend > 0 ? offStatus.available >= offSpend : true;

      return {
        hasBudget: !!identity,
        planTotalSpend: Number(plan.totalSpend),
        channel: channelCode,
        channelName,
        period: plan.periodMonth,
        envelope: identity
          ? {
              id: identity.id,
              code: identity.code,
              name: identity.name,
              allocatedAmount: combinedAllocated,
              availableAmount: combinedAvailable,
              currency: identity.currency,
            }
          : undefined,
        sufficient: identity
          ? onTypeSufficient && offTypeSufficient
          : undefined,
        bySpendType,
        splitDimension, // true here — the guard fired for this dimension
      };
    }

    if (!envelope) {
      // Unreachable at runtime (the `!envelope && !splitDimension` branch
      // above already returned) — kept as a type-narrowing safety net for
      // the `envelope.*` reads below (and as defensive coding, not load-
      // bearing behaviour).
      return {
        hasBudget: false,
        planTotalSpend: Number(plan.totalSpend),
        channel: channelCode,
        channelName,
        period: plan.periodMonth,
        bySpendType,
        splitDimension,
      };
    }

    // Check availability
    const budgetStatus = await this.budgetService.getBudgetStatus(
      tenantId,
      channelCode,
      undefined,
      plan.periodMonth,
    );

    return {
      hasBudget: true,
      planTotalSpend: Number(plan.totalSpend),
      channel: channelCode,
      channelName,
      period: plan.periodMonth,
      envelope: {
        id: envelope.id,
        code: envelope.code,
        name: envelope.name,
        allocatedAmount: Number(envelope.allocatedAmount),
        availableAmount: budgetStatus.available,
        currency: envelope.currency,
      },
      sufficient: budgetStatus.available >= Number(plan.totalSpend),
      bySpendType,
      splitDimension, // false here — UNSPLIT, bySpendType.onInvoice/offInvoice are the SAME legacy envelope reported twice
    };
  }

  /**
   * T-034b: real transaction + `FOR UPDATE` + status-CAS (docs/analysis/0005
   * §4). Prior code ran `commitReservedForPlan` (budget COMMIT) BEFORE the
   * status write — two concurrent approve() calls could both pass the
   * initial `status === PENDING_APPROVAL` check and both commit budget
   * before either wrote status=APPROVED (the exact gap this task closes,
   * see T-034b task description). No version check here (K5: PENDING plans
   * are BRD-immutable, so a version-CAS would only produce false-positive
   * 409s) — the FOR UPDATE lock + status-CAS write are the only barrier
   * needed. Real transactionality also replaces the old compensate-on-
   * failure pattern (release COMMIT + revert to PENDING_APPROVAL) — any
   * failure now rolls back budget + approval-request + status + history
   * together.
   */
  async approve(
    id: string,
    tenantId: string,
    userId: string,
    comments?: string,
    autoCreateBudget?: boolean,
    budgetAmount?: number,
    actor?: PlanActor,
  ): Promise<Plan> {
    // Cheap pre-transaction read: channel code + name for the
    // autoCreateBudget envelope label (not part of the money/status race —
    // same rationale as submit()'s channelCode capture above).
    const initial = await this.findById(id, tenantId);
    const channelCode = initial.channel?.code || '';
    const channelName = initial.channel?.name || channelCode;

    // T-028b: CM kategori-scoped onay — kesişim yoksa 403 (§3, §9 N4).
    // categoryId is immutable once a plan exists — safe to check pre-lock.
    await this.assertCmDecisionScope(initial, tenantId, actor);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const plan = await this.planRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!plan) {
        throw new NotFoundException(`Plan with ID ${id} not found`);
      }

      if (plan.status !== PlanStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          'Only PENDING_APPROVAL plans can be approved',
        );
      }

      if (!plan.approvalRequestId) {
        throw new BadRequestException('Approval request not found');
      }

      // F7 (docs/analysis/0004-rbac-brd-alignment.md §1/§9 N12): self-
      // approval guard.
      if (plan.submittedById === userId) {
        throw new ForbiddenException('You cannot approve your own submission');
      }

      // Check if budget envelope exists (read-only; not manager-scoped —
      // see BudgetService#reserveForPlan comment on envelope lookups).
      //
      // T-056 adım 6 (0009 §4.5 madde 2, §6 adım 6; ADR 0004 Karar 5 —
      // "[[T-056]], :1019'u da tipli hale getirmek zorundadır"): this
      // UNQUALIFIED (no spendType) call is exactly the "5 tipsiz çağrı
      // yerinden" biri that T-019b's split guard now protects. Once a
      // dimension has actually been split, this call throws
      // `SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION` — before this fix that
      // meant "submit works, approve breaks" (R9): submit (adım 5) already
      // resolves ON/OFF separately, but approve's existence-check/auto-
      // create block still asked for ONE untyped envelope and 400'd.
      //
      // Split detection uses NO second/independent query (tek türetim
      // noktası, budget.repository.ts §JSDoc) — it is derived from THIS
      // SAME call's own guard: if it throws that specific code, the
      // dimension is split and ON/OFF must be resolved (and, if missing,
      // created) INDEPENDENTLY below. If it does not throw, behaviour for
      // the UNSPLIT (today's) dimension is BYTE-FOR-BYTE unchanged — same
      // call, same branch, same auto-create logic as before this task.
      let existingEnvelope: Awaited<
        ReturnType<typeof this.budgetService.findEnvelopeByDimensions>
      > = null;
      let splitDimension = false;
      try {
        existingEnvelope = await this.budgetService.findEnvelopeByDimensions(
          tenantId,
          channelCode,
          plan.periodMonth,
        );
      } catch (err) {
        // T-057 S1 (code-reviewer, 2026-08-04): tek türetim noktası —
        // budget.repository.ts'in `isSplitDimensionGuardError` helper'ı
        // (line 991'de zaten kullanılan AYNI helper). Önceki inline
        // `instanceof` + `code` kopyası, helper'ın kendi JSDoc'unun bu
        // dosya için verdiği sözü (§ "plan.service.ts#approve recognise the
        // IDENTICAL error shape") tutmuyordu.
        if (isSplitDimensionGuardError(err)) {
          splitDimension = true;
        } else {
          throw err;
        }
      }

      const periodLabel = plan.periodMonth; // e.g., "2026-01"
      const fiscalYear = plan.periodMonth.substring(0, 4);

      if (splitDimension) {
        // ON_INVOICE and OFF_INVOICE resolved INDEPENDENTLY (typed lookup —
        // the guard never fires when spendType is given, §5.1). Missing
        // twin(s) are auto-created (or 400) PER TYPE — never a single
        // untyped envelope, which would silently re-create the exact
        // ambiguity the split guard exists to prevent.
        const [existingOnEnvelope, existingOffEnvelope] = await Promise.all([
          this.budgetService.findEnvelopeByDimensions(
            tenantId,
            channelCode,
            plan.periodMonth,
            undefined,
            BudgetSpendType.ON_INVOICE,
          ),
          this.budgetService.findEnvelopeByDimensions(
            tenantId,
            channelCode,
            plan.periodMonth,
            undefined,
            BudgetSpendType.OFF_INVOICE,
          ),
        ]);

        // Evidence-based per-type sizing (NOT a fabricated split of a
        // single total): adım 4's recalc already persisted the plan's REAL
        // on/off breakdown (`plan.onInvoiceSpend`/`offInvoiceSpend`,
        // 0009 §4.2) — each missing typed envelope reuses today's exact
        // heuristic (`budgetAmount || max(spend*2, 100000)`) applied to
        // its OWN type's spend, not an invented ratio of the total. An
        // explicit `budgetAmount` override (rare — untested even in the
        // UNSPLIT path) is applied AS-IS to whichever twin(s) are missing,
        // never divided — dividing it would itself be a fabricated ratio.
        const onSpend = Number(plan.onInvoiceSpend) || 0;
        const offSpend = Number(plan.offInvoiceSpend) || 0;

        if (!existingOnEnvelope && autoCreateBudget) {
          const onAllocatedAmount =
            budgetAmount || Math.max(onSpend * 2, 100000);
          await this.budgetService.createEnvelope(
            tenantId,
            {
              code: `${channelCode}/${periodLabel}-ON`,
              name: `${channelName} - ${periodLabel} Bütçesi (On-Invoice)`,
              fiscalYear,
              period: periodLabel,
              allocatedAmount: onAllocatedAmount,
              status: BudgetEnvelopeStatus.ACTIVE,
              currency: 'TRY',
              spendType: BudgetSpendType.ON_INVOICE,
              metadata: {
                channel: channelCode,
                autoCreated: true,
                createdForPlanId: plan.id,
              },
            },
            queryRunner.manager,
          );
        } else if (!existingOnEnvelope && !autoCreateBudget) {
          throw new BadRequestException(
            `No active ON_INVOICE budget envelope found for channel: ${channelCode}, period: ${plan.periodMonth}. Use autoCreateBudget to create one automatically.`,
          );
        }

        if (!existingOffEnvelope && autoCreateBudget) {
          const offAllocatedAmount =
            budgetAmount || Math.max(offSpend * 2, 100000);
          await this.budgetService.createEnvelope(
            tenantId,
            {
              code: `${channelCode}/${periodLabel}-OFF`,
              name: `${channelName} - ${periodLabel} Bütçesi (Off-Invoice)`,
              fiscalYear,
              period: periodLabel,
              allocatedAmount: offAllocatedAmount,
              status: BudgetEnvelopeStatus.ACTIVE,
              currency: 'TRY',
              spendType: BudgetSpendType.OFF_INVOICE,
              metadata: {
                channel: channelCode,
                autoCreated: true,
                createdForPlanId: plan.id,
              },
            },
            queryRunner.manager,
          );
        } else if (!existingOffEnvelope && !autoCreateBudget) {
          throw new BadRequestException(
            `No active OFF_INVOICE budget envelope found for channel: ${channelCode}, period: ${plan.periodMonth}. Use autoCreateBudget to create one automatically.`,
          );
        }
      } else if (!existingEnvelope && autoCreateBudget) {
        // UNSPLIT dimension — behaviour BYTE-FOR-BYTE unchanged (today's
        // single untyped envelope, T-056 adım 6 does not touch this branch).
        const allocatedAmount =
          budgetAmount || Math.max(Number(plan.totalSpend) * 2, 100000);

        await this.budgetService.createEnvelope(
          tenantId,
          {
            code: `${channelCode}/${periodLabel}`,
            name: `${channelName} - ${periodLabel} Bütçesi`,
            fiscalYear,
            period: periodLabel,
            allocatedAmount,
            status: BudgetEnvelopeStatus.ACTIVE,
            currency: 'TRY',
            metadata: {
              channel: channelCode,
              autoCreated: true,
              createdForPlanId: plan.id,
            },
          },
          queryRunner.manager,
        );
      } else if (!existingEnvelope && !autoCreateBudget) {
        throw new BadRequestException(
          `No active budget envelope found for channel: ${channelCode}, period: ${plan.periodMonth}. Use autoCreateBudget to create one automatically.`,
        );
      }

      // T-029 (SORUN 2): BRD plan state machine — Approved → COMMIT.
      // T-019/T-048 cross-path fix: this is one of TWO canonical approve
      // routes (see approval-workflow.service.ts#approvePlan for the
      // other) — the plan may have been submitted via EITHER canonical
      // submit route (plan.service.ts#submit's 'TOTAL' bucket, or
      // approval-workflow.service.ts#submitForApproval's ON/OFF buckets).
      // commitAllReservedForPlan discovers and commits whatever bucket(s)
      // actually have an outstanding RESERVE, instead of blindly assuming
      // 'TOTAL' — see its JSDoc for why a bucket-blind call here would
      // double-encumber (or strand) a plan submitted via the other route.
      // T-057 F4: evidence-based on/off breakdown for the legacy "never
      // reserved" fallback's split-dimension branch (§4.5's own recalc
      // columns, same source T-056 adım 6 uses for approve's auto-create —
      // no new derivation).
      await this.budgetService.commitAllReservedForPlan(
        plan.id,
        plan.totalSpend,
        channelCode,
        plan.periodMonth,
        'TRY',
        tenantId,
        userId,
        queryRunner.manager,
        {
          onInvoice: Number(plan.onInvoiceSpend) || 0,
          offInvoice: Number(plan.offInvoiceSpend) || 0,
        },
      );

      // Update approval request
      await this.approvalService.approve(
        plan.approvalRequestId,
        tenantId,
        userId,
        { comments },
        queryRunner.manager,
      );

      const affected = await this.planRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        PlanStatus.PENDING_APPROVAL,
        {
          status: PlanStatus.APPROVED,
          approvedAt: new Date(),
          approvedById: userId,
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Plan status changed concurrently; retry.',
        });
      }

      // T-029 (SORUN 1): audit immutable — approve must be recorded.
      await this.createHistoryEntry(
        id,
        tenantId,
        userId,
        ApprovalHistoryAction.APPROVED,
        comments,
        undefined,
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return (await this.planRepo.findById(id, tenantId)) as Plan;
  }

  async reject(
    id: string,
    tenantId: string,
    userId: string,
    reason: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    const initial = await this.findById(id, tenantId);

    // T-028b: CM kategori-scoped red — kesişim yoksa 403. categoryId is
    // immutable once a plan exists — safe to check pre-lock.
    await this.assertCmDecisionScope(initial, tenantId, actor);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const plan = await this.planRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!plan) {
        throw new NotFoundException(`Plan with ID ${id} not found`);
      }

      if (plan.status !== PlanStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          'Only PENDING_APPROVAL plans can be rejected',
        );
      }

      if (!plan.approvalRequestId) {
        throw new BadRequestException('Approval request not found');
      }

      // F7: same self-approval guard as approve().
      if (plan.submittedById === userId) {
        throw new ForbiddenException('You cannot review your own submission');
      }

      await this.approvalService.reject(
        plan.approvalRequestId,
        tenantId,
        userId,
        { reason },
        queryRunner.manager,
      );

      const affected = await this.planRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        PlanStatus.PENDING_APPROVAL,
        {
          status: PlanStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedById: userId,
          rejectionReason: reason,
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Plan status changed concurrently; retry.',
        });
      }

      // T-029 (SORUN 1): audit immutable — reject must be recorded.
      await this.createHistoryEntry(
        id,
        tenantId,
        userId,
        ApprovalHistoryAction.REJECTED,
        undefined,
        reason,
        queryRunner.manager,
      );

      // T-029 (SORUN 2): BRD plan state machine — Rejected → RELEASE. Now
      // INSIDE the same transaction (T-034b: "asıl ödül" — real atomicity
      // replaces the old best-effort/logged-only release). Previously a
      // release failure here was swallowed (logged, not thrown) so an
      // already-committed REJECTED status would never be rolled back for it
      // — that traded a silent budget/status inconsistency for a
      // non-reverted user-facing rejection. With a real transaction, a
      // release failure now rolls back the WHOLE rejection (status +
      // history + approval-request decision together) instead of leaving
      // that inconsistency on disk — strictly more correct, no more
      // "REJECTED but still reserved" states to reconcile manually.
      await this.budgetService.releaseForPlan(
        id,
        tenantId,
        userId,
        'REJECT',
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return (await this.planRepo.findById(id, tenantId)) as Plan;
  }

  /**
   * T-033: BRD plan state machine — Rejected → Draft (audit korunur).
   * Prior to this, a REJECTED plan had no way back to DRAFT: the only
   * existing Pending→Draft path (ApprovalWorkflowService#requestChanges) is
   * a DIFFERENT transition (a reviewer sending a still-pending plan back
   * before deciding), not the BRD-mandated Rejected→Draft transition that
   * lets the planner fix and resubmit a plan that was already reviewed and
   * turned down.
   *
   * Ownership: only the PLANNER who owns the plan (createdBy OR
   * submittedById — a plan may have been created by one PLANNER and
   * submitted by another in edge cases) or ADMIN may return it to DRAFT.
   * CATEGORY_MANAGER is blocked at the route (@Roles(ADMIN, PLANNER) only)
   * — BRD "CM plan düzenleyemez" — so RolesGuard already yields 403 before
   * this method runs; the ownership check below only needs to handle the
   * PLANNER-but-not-owner case, which mirrors the OUT_OF_SCOPE 404 pattern
   * used elsewhere (no varlık sızdırma — a PLANNER should not learn that a
   * plan they don't own exists via a differentiated 403 vs 404 response).
   */
  /**
   * T-034b: real transaction + `FOR UPDATE` + status-CAS. No budget side
   * effect here (unchanged — reject() already RELEASEd, see below), but the
   * old compensate-on-failure `updateUnversioned` revert-to-REJECTED branch
   * is replaced by a real rollback: any failure (including the history
   * write) now atomically undoes the status write.
   */
  async returnToDraft(
    id: string,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    // T-028c: scope-aware read — out-of-scope (wrong CPL/Category) PLANNER
    // -> 404 (OUT_OF_SCOPE), same as every other mutation entrypoint.
    const initial = await this.findById(id, tenantId, actor);

    if (initial.status !== PlanStatus.REJECTED) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Only REJECTED plans can be returned to draft',
        code: 'NOT_REJECTED',
      });
    }

    if (
      actor?.role === UserRole.PLANNER &&
      actor.userId !== initial.createdBy &&
      actor.userId !== initial.submittedById
    ) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Plan with ID ${id} not found`,
        code: 'OUT_OF_SCOPE',
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const plan = await this.planRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!plan) {
        throw new NotFoundException(`Plan with ID ${id} not found`);
      }

      if (plan.status !== PlanStatus.REJECTED) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Only REJECTED plans can be returned to draft',
          code: 'NOT_REJECTED',
        });
      }

      // Ownership re-check under the lock (defense-in-depth — cheap, mirrors
      // the pre-transaction check above).
      if (
        actor?.role === UserRole.PLANNER &&
        actor.userId !== plan.createdBy &&
        actor.userId !== plan.submittedById
      ) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Plan with ID ${id} not found`,
          code: 'OUT_OF_SCOPE',
        });
      }

      // T-033: Draft->Draft "current state" fields (rejection + the closed
      // submission/approval-request they belonged to) are cleared — the
      // REJECTED PlanApprovalHistory row written at reject() time already
      // immutably preserves the rejection reason/actor/timestamp (BRD
      // "audit korunur"), so nothing is lost.
      const affected = await this.planRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        PlanStatus.REJECTED,
        {
          status: PlanStatus.DRAFT,
          rejectedAt: null,
          rejectedById: null,
          rejectionReason: null,
          submittedAt: null,
          submittedById: null,
          approvalRequestId: null,
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Plan status changed concurrently; retry.',
        });
      }

      // T-033 (audit immutable): record the transition. Budget is
      // deliberately untouched here — reject() already RELEASEd any
      // outstanding RESERVE/COMMIT (T-029), and a fresh RESERVE is only
      // created on the next submit(), never here (BRD state machine: only
      // Pending Approval creates a reservation).
      await this.createHistoryEntry(
        id,
        tenantId,
        userId,
        ApprovalHistoryAction.RETURNED_TO_DRAFT,
        undefined,
        undefined,
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return (await this.planRepo.findById(id, tenantId)) as Plan;
  }

  async delete(
    id: string,
    tenantId: string,
    dto?: DeletePlanDto,
    actor?: PlanActor,
  ): Promise<void> {
    const plan = await this.findById(id, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be deleted');
    }

    // T-034 (code-review follow-up): delete is the most destructive
    // mutation path — a stale-view delete silently discards everything a
    // concurrent editor just added (FUs/SKUs, tactics, volumes). This was
    // found entirely unguarded and is closed the same way as every other
    // user-input write: strict-mode missing version -> 409 MISSING_VERSION.
    if (!dto || dto.version === undefined || dto.version === null) {
      throw missingVersionConflict({ entity: 'PLAN', entityId: id });
    }

    if (plan.totalSpend > 0) {
      await this.budgetService.releaseForPlan(
        id,
        tenantId,
        undefined,
        'DELETE',
      );
    }

    await this.planRepo.softDeleteVersioned(id, tenantId, dto.version);
  }

  /**
   * Full KPI engine recalculation for the entire plan
   * Follows BRD hierarchy: SKU → FU → PLAN
   *
   * T-034c (docs/analysis/0005 §3): this is the ONLY path that writes
   * plans/plan_fus/plan_skus derived aggregates, and it does so with 3
   * separate persist steps (SKU -> FU -> plan). Two concurrent recalcs of
   * the SAME plan can interleave those steps and each persist a
   * partial/mixed aggregate — "lost recalculation", distinct from a lost
   * update (version-CAS cannot catch it: neither writer's own row is
   * stale). Fix: the whole method now runs inside one `QueryRunner`
   * transaction, and the FIRST thing it does after opening that
   * transaction is take `pg_advisory_xact_lock(planId)` — serializing
   * concurrent recalcs of the same plan while leaving other plans'
   * recalcs to run fully in parallel. `pg_advisory_xact_lock` only means
   * anything INSIDE a transaction (a bare/session call would not release
   * the way this code assumes), so the lock and the transaction were
   * introduced together, not the lock alone.
   *
   * Lock-ordering / deadlock note: submit()/approve()/reject()/
   * returnToDraft() (T-034b) take a `FOR UPDATE` row lock on the SAME
   * `plans` row, but NONE of them call `recalculatePlanWithKpiEngine` from
   * inside their own transaction — recalc is only ever invoked from
   * update()/addFu()/updateFuTactic()/updateSkuVolume()/removeFu()
   * (grid-edit paths) AFTER their own CAS write has already committed, as
   * a separate top-level call. So this transaction never needs to acquire
   * a `FOR UPDATE` row lock while holding the advisory lock, and a
   * state-transition transaction never needs to acquire the advisory lock
   * while holding its row lock — there is no cycle between the two lock
   * types. (The two CAN still block each other in the ordinary
   * non-deadlocking sense: recalc's own final `updateUnversioned` write to
   * the `plans` row takes an implicit row lock, so it queues behind a
   * concurrent submit()'s `FOR UPDATE` the same way any two writers to the
   * same row would — this is expected serialization, not new interleaving
   * this task introduces.)
   *
   * Blocking vs try-lock: `pg_advisory_xact_lock` (blocking), not
   * `pg_try_advisory_xact_lock`. Recalc is only ever re-entrant for the
   * SAME plan when the SAME user is rapidly editing the SAME grid (or,
   * rarely, two users editing the same open plan) — queueing those a few
   * tens of ms behind each other is the correct UX (the second recalc's
   * result is what the client should see anyway); a try-lock would instead
   * have to surface a 409/skip to the caller for a condition that isn't a
   * real conflict from the user's point of view, and every grid-edit
   * caller (update/addFu/updateFuTactic/updateSkuVolume/removeFu) would
   * have to grow bespoke "recalc lock busy" handling. See the task report
   * for the measured lock-hold time this adds (BRD <500ms budget).
   *
   * CAS note: none of the writes below check or bump `version` — see
   * `updateUnversioned`/`updatePlanFuUnversioned`/`updatePlanSkuUnversioned`
   * doc comments (T-034 K4). That is unchanged by this task; only the
   * transaction/lock wrapper around them is new.
   */
  async recalculatePlanWithKpiEngine(
    planId: string,
    tenantId: string,
    actor?: PlanActor,
    /**
     * T-046a: optional already-loaded, already-scope-checked `Plan` tree
     * (docs/analysis/0007 §2.3, item C #1/#2 — this pre-transaction check
     * used to re-run the exact same `findById` query the caller had just
     * run moments earlier in the same request, measured as part of the
     * 251ms/5-query `findById` cost on a 500-SKU recalc).
     *
     * ONLY pass this when the caller's own `plan.planFus` set is
     * guaranteed still accurate at the moment recalc runs — i.e. the
     * caller's own action did not add/remove FUs after loading `plan`
     * (safe for `updateSkuVolume`/`updateFuTactic`, NOT safe for
     * `addFu`/`removeFu`, which change the FU count after their own
     * `findById` and must let this method re-read). When supplied, `actor`
     * is ignored for this check (the caller already performed the real
     * scope check when it loaded `preloadedPlan`) — this is purely a
     * "does this plan still have FUs" guard before opening the locked
     * transaction below, not a second authorization decision.
     */
    preloadedPlan?: Plan,
    /**
     * T-046b (docs/analysis/0007 §4-T1): which caller triggered this
     * recalc, for the structured telemetry log only — never branches
     * behavior. Defaults to `'manual'` (the `/plans/:id/recalculate`
     * endpoint and any other direct caller that doesn't pass one).
     */
    trigger: RecalcTrigger = 'manual',
    /**
     * C3: active mechanics the CALLER already loaded in this same request.
     *
     * Only `updateFuTactic` passes it — it must load them anyway to
     * scale-validate the incoming tactics before writing, and
     * `getActiveMechanics` is deliberately uncached (see
     * spend-calculation.service.ts), so without this parameter that one
     * request would run the identical query twice. The other five callers
     * have no such prior load and let the recalc fetch its own.
     *
     * Must be the ACTIVE mechanics for `tenantId` — this is a pass-through of
     * work already done, not a way to inject a different mechanic set.
     */
    mechanics?: Mechanic[],
  ): Promise<void> {
    // Pre-transaction scope check (mirrors submit()/approve()'s "cheap
    // pre-transaction read" pattern, T-034b): 404/OUT_OF_SCOPE must be
    // decided before we ever open the locked transaction below, so an
    // out-of-scope caller cannot even momentarily contend for the
    // advisory lock on a plan it cannot see.
    const scopeCheckedPlan =
      preloadedPlan ?? (await this.findById(planId, tenantId, actor));
    if (!scopeCheckedPlan.planFus || scopeCheckedPlan.planFus.length === 0) {
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // T-046b (docs/analysis/0007 §4-T1): timing starts here (transaction
    // open, BEFORE lock acquisition) so `durationMs` includes lock-wait,
    // per the design doc ("durationMs (lock alımı dahil)"), and is measured
    // in both the success and failure paths (try/catch below, not just
    // try/finally) — a recalc that throws still tells us how long it ran
    // before failing.
    const startedAt = Date.now();
    let lockWaitMs = 0;
    let skuCount = 0;
    let fuCount = 0;

    try {
      // T-034c step 1: serialize concurrent recalcs of THIS plan. Must be
      // acquired before any read below — otherwise two concurrent recalcs
      // could both pass their own snapshot read before either takes the
      // lock, defeating the point (see the method doc comment above).
      const lockStartedAt = Date.now();
      await this.planRepo.acquireRecalcLock(planId, queryRunner.manager);
      lockWaitMs = Date.now() - lockStartedAt;

      const plan = await this.planRepo.findById(
        planId,
        tenantId,
        queryRunner.manager,
      );
      if (!plan) {
        // Deleted between the pre-transaction scope check above and lock
        // acquisition — nothing to recalculate.
        await queryRunner.commitTransaction();
        this.logRecalcTelemetry({
          planId,
          tenantId,
          trigger,
          durationMs: Date.now() - startedAt,
          lockWaitMs,
          skuCount,
          fuCount,
          failed: false,
        });
        return;
      }
      if (!plan.planFus || plan.planFus.length === 0) {
        await queryRunner.commitTransaction();
        this.logRecalcTelemetry({
          planId,
          tenantId,
          trigger,
          durationMs: Date.now() - startedAt,
          lockWaitMs,
          skuCount,
          fuCount,
          failed: false,
        });
        return;
      }

      fuCount = plan.planFus.length;
      skuCount = plan.planFus.reduce(
        (sum, fu) => sum + (fu.planSkus?.length ?? 0),
        0,
      );

      await this.recalculatePlanWithKpiEngineLocked(
        plan,
        planId,
        tenantId,
        queryRunner.manager,
        mechanics,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logRecalcTelemetry({
        planId,
        tenantId,
        trigger,
        durationMs: Date.now() - startedAt,
        lockWaitMs,
        skuCount,
        fuCount,
        failed: true,
      });
      throw err;
    } finally {
      await queryRunner.release();
    }

    const durationMs = Date.now() - startedAt;
    this.logRecalcTelemetry({
      planId,
      tenantId,
      trigger,
      durationMs,
      lockWaitMs,
      skuCount,
      fuCount,
      failed: false,
    });
    // T-046b (docs/analysis/0007 §4-T2): hand off to
    // RecalcMetricsInterceptor for the `X-Recalc-Ms` response header. No-op
    // if this call isn't running inside a request wrapped by that
    // interceptor (e.g. a unit test, or a future non-HTTP caller) — see
    // RecalcTelemetryContext's doc comment.
    this.recalcTelemetry.record({ durationMs, skuCount });
  }

  /**
   * T-046b (docs/analysis/0007 §4-T1): structured (JSON, single line)
   * recalc telemetry via Nest's `Logger`. Deliberately NO new
   * infrastructure (no metrics store, no APM) — see the design doc's
   * explicit "izleme platformu kurmuyoruz" scope note. Threshold comes from
   * `ConfigService` (`PERF_RECALC_WARN_MS`, default 500ms) — never
   * hardcoded, matching this codebase's other dynamic-config thresholds
   * (e.g. `SCOPE_ENFORCEMENT_ENABLED` in AccessScopeService, budget
   * thresholds). Exceeding it produces ONLY a `warn` log — no timeout, no
   * cancellation: a slow-but-correct recalc is better than a fast-but-
   * incomplete one (BRD FR-3.2/FR-3.3 correctness requirement).
   *
   * Payload is deliberately identity + counters only (planId, tenantId,
   * trigger, counts, durations) — never plan/SKU content, prices, or
   * customer names (the exact leak class flagged for `calculationCache` in
   * docs/analysis/0007 §2.4).
   */
  private logRecalcTelemetry(entry: {
    planId: string;
    tenantId: string;
    trigger: RecalcTrigger;
    durationMs: number;
    lockWaitMs: number;
    skuCount: number;
    fuCount: number;
    failed: boolean;
  }): void {
    const configuredThreshold = this.configService.get<string | number>(
      'PERF_RECALC_WARN_MS',
      500,
    );
    const warnThresholdMs = Number(configuredThreshold);
    const threshold = Number.isFinite(warnThresholdMs) ? warnThresholdMs : 500;

    const payload = {
      event: 'plan_recalc',
      planId: entry.planId,
      tenantId: entry.tenantId,
      trigger: entry.trigger,
      durationMs: entry.durationMs,
      lockWaitMs: entry.lockWaitMs,
      skuCount: entry.skuCount,
      fuCount: entry.fuCount,
      failed: entry.failed,
      warnThresholdMs: threshold,
    };

    if (entry.durationMs > threshold) {
      this.logger.warn(JSON.stringify(payload));
    } else {
      this.logger.debug(JSON.stringify(payload));
    }
  }

  /**
   * T-034c: the actual SKU -> FU -> plan recalculation body, extracted out
   * of `recalculatePlanWithKpiEngine` so the transaction/lock wrapper above
   * stays readable. Every read/write here MUST go through the given
   * `manager` (the caller's open, lock-holding transaction) — routing any
   * of it through the injected repos' default connection would silently
   * step outside the lock and reintroduce the exact interleaving this task
   * closes.
   */
  private async recalculatePlanWithKpiEngineLocked(
    plan: Plan,
    planId: string,
    tenantId: string,
    manager: EntityManager,
    /** C3: see the same parameter on the public method above. */
    preloadedMechanics?: Mechanic[],
  ): Promise<void> {
    const allFuResults: Array<Record<string, CalculationResult>> = [];

    // T-045: active mechanics are tenant-scoped and SKU-independent — fetch
    // once for this recalc call and reuse across every SKU below instead of
    // re-querying per SKU (52x -> 1x for a 52-SKU plan). Scoped to this
    // single method invocation only (local variable, not stored on `this`)
    // so it can never leak across tenants/requests or serve stale data from
    // a previous recalc — see spend-calculation.service.ts doc comment.
    // C3: `preloadedMechanics` is the caller's copy of exactly this query,
    // taken moments earlier in the same request; same scoping discipline
    // applies either way (local to this invocation, never stored on `this`).
    const cachedActiveMechanics =
      preloadedMechanics ?? (await this.spendCalc.getActiveMechanics(tenantId));

    // T-046a: LTA context depends only on (cplId, channelCode, categoryCode,
    // planId), all read from `plan` itself below — identical for every SKU
    // in this recalc. Fetch once and reuse via `calculateAllSpendsForSKU`'s
    // `cachedLtaContext` param instead of re-querying per SKU (or, before
    // this fix, per SKU x mechanic inside `calculateMechanicSpend` — the
    // single largest measured cost in docs/analysis/0007 §2: +3000 queries
    // / 1746ms on a 500-SKU x 3-mechanic plan). Scoped to this single method
    // invocation only, same discipline as `cachedActiveMechanics` above.
    const cachedLtaContext = await this.spendCalc.getLtaContextForPlan(
      tenantId,
      {
        cplId: plan.cplId,
        channelCode: plan.channel?.code,
        categoryCode: plan.category?.code,
      },
      plan.id,
    );

    // T-046a: plan-level aggregates, accumulated in-loop from the same
    // per-FU totals computed below instead of re-reading the whole plan
    // tree afterwards (docs/analysis/0007 §2.3 item C #4 — that re-read
    // becomes unnecessary once these per-FU totals are already in memory).
    let planTotalPlannedVolume = 0;
    let planTotalSpend = 0;
    let planTotalGp = 0;
    // T-056 step 4: on/off-invoice breakdown, accumulated from the SAME
    // per-SKU `spendBreakdown` this loop already reads for
    // `plannedOnInvoiceSpend`/`totalPlannedSpend` (T-052's single
    // derivation point, `spend-calculation.service.ts` §"planned" —
    // see design 0009 §4.2 / §6 step 4). Summed on+off is mathematically
    // identical to `planTotalSpend` above by construction (both come from
    // the same `spendBreakdown.planned` object per SKU:
    // `totalSpend = totalOnInvoice + totalOffInvoice`,
    // `spend-calculation.service.ts:511-514`) — DO NOT derive off by
    // subtracting on from totalSpend (that's the F3 fallback bug this
    // step deliberately avoids, design 0009 §2.6/§4.2).
    let planTotalOnInvoiceSpend = 0;
    let planTotalOffInvoiceSpend = 0;

    for (const planFu of plan.planFus) {
      const skuResults: Array<Record<string, CalculationResult>> = [];

      // Build mechanic values map for this FU (needed by SpendCalc).
      // T-052: single shared derivation point — see
      // `SpendCalculationService#buildMechanicValues` doc comment.
      // `calculateAllSpendsForFU` (the OTHER canonical spend-derivation
      // path, used by `ApprovalWorkflowService#submitForApproval`) now
      // calls the exact same method, so the two can never diverge again
      // (T-049 postmortem: duplicate derivations of the same fact drift).
      const mechanicValues = await this.spendCalc.buildMechanicValues(
        planFu,
        cachedActiveMechanics,
        tenantId,
      );

      // T-062: FU-level LUMPSUM_SPEND distribution, computed ONCE per FU
      // (needs every sibling SKU's base volume — see
      // `SpendCalculationService#computeLumpsumDistribution` doc comment)
      // and threaded through the same `calcCtx` every SKU in this FU reads
      // below. `calculateAllSpendsForFU` (the OTHER canonical spend path)
      // computes this identically — same shared method, not re-derived.
      const lumpsumSharesBySku = this.spendCalc.computeLumpsumDistribution(
        planFu.id,
        mechanicValues,
        cachedActiveMechanics,
        planFu.planSkus || [],
      );

      // Build SpendCalc CalculationContext for this FU
      const calcCtx: CalculationContext = {
        planId: plan.id,
        fuId: planFu.id,
        skuContexts: [],
        mechanicValues,
        lumpsumSharesBySku,
      };

      // Track FU-level totals (summed from per-SKU SpendCalc results).
      // T-046a: `fuTotalPlannedVolume`/`fuTotalGp` used to be recomputed by
      // re-reading every just-written plan_sku row back from the DB after
      // the batch UPDATE below (docs/analysis/0007 §2.3 item B: 1006
      // queries / 496ms on a 500-SKU plan). Both values are already fully
      // known in-memory from this same loop (`planVol` is the loaded,
      // recalc-untouched volume; `plannedGp` is exactly what gets written
      // to `skuUpdatesForBatch` below) — accumulate them here instead.
      let fuTotalPlannedSpend = 0;
      let fuTotalPlannedVolume = 0;
      let fuTotalGp = 0;
      // T-056 step 4: FU-level on/off accumulators (see plan-level comment
      // above for the identity this preserves).
      let fuTotalOnInvoiceSpend = 0;
      let fuTotalOffInvoiceSpend = 0;

      // T-045: accumulate this FU's SKU writes and flush as a single
      // multi-row UPDATE after the loop, instead of one UPDATE per SKU.
      const skuUpdatesForBatch: Parameters<
        PlanRepository['batchUpdatePlanSkusUnversioned']
      >[0] = [];

      for (const planSku of planFu.planSkus || []) {
        const sku = planSku.sku;
        // T-027: distinguish "genuinely missing master/user data" (null/undefined
        // source) from "legitimately 0". SpendCalc's SKUContext has no null-safety
        // (raw arithmetic), so it keeps the 0-fallback numeric values below — a
        // missing input there degrades to 0 spend rather than crashing on NaN.
        // The KPI engine context (below) instead receives the nullable
        // (`*OrNull`) versions so missing COGS/BPTT/volume propagates as null
        // through PLANNED_GP/GP_ROI_PCT/RAG (BRD: missing data → null, never a
        // fabricated 100%/GREEN result).
        const baseVolOrNull = toNullableNumber(planSku.baseVolume);
        const planVolOrNull = toNullableNumber(planSku.plannedVolume);
        const unitPriceOrNull = toNullableNumber(sku.unitPrice);
        const cogsOrNull = toNullableNumber(sku.cogs);
        const baseVol = baseVolOrNull ?? 0;
        const planVol = planVolOrNull ?? 0;
        const unitPrice = unitPriceOrNull ?? 0;
        const cogs = cogsOrNull ?? 0;

        // ── Step 1: Call SpendCalculationService for this SKU ────────────
        // This is the single source of truth for LTA, promo spend breakdown.
        const skuCtx: SKUContext = {
          skuId: planSku.skuId,
          baseVolume: baseVol,
          plannedVolume: planVol,
          listPrice: unitPrice,
          cogsPerUnit: cogs,
          channelCode: plan.channel?.code,
          categoryCode: plan.category?.code,
          cplId: plan.cplId,
        };

        let spendBreakdown: Awaited<
          ReturnType<SpendCalculationService['calculateAllSpendsForSKU']>
        >;
        try {
          spendBreakdown = await this.spendCalc.calculateAllSpendsForSKU(
            tenantId,
            skuCtx,
            calcCtx,
            cachedActiveMechanics,
            cachedLtaContext,
          );
        } catch (spendErr) {
          this.logger.error(
            `SpendCalc failed for SKU ${planSku.skuId} in FU ${planFu.id}: ${spendErr}`,
          );
          throw spendErr; // surface the error — do not silently produce wrong values
        }

        const totalPlannedSpend = spendBreakdown.planned.totalSpend;
        const baseTotalSpend = spendBreakdown.base.totalSpend;
        const incrSpend = spendBreakdown.incremental.total;
        // BRD NIV semantics: only on-invoice deductions reduce Turnover.
        // plannedOnInvoiceSpend = LTA_ON + all on-invoice promo spends (CPP_ON etc.)
        const plannedOnInvoiceSpend = spendBreakdown.planned.totalOnInvoice;
        // T-056 step 4: off-invoice counterpart, SAME `spendBreakdown.planned`
        // object as `plannedOnInvoiceSpend` above (not derived by
        // subtraction — see plan-level comment on `planTotalOnInvoiceSpend`).
        const plannedOffInvoiceSpend = spendBreakdown.planned.totalOffInvoice;
        fuTotalPlannedSpend += totalPlannedSpend;
        fuTotalOnInvoiceSpend += plannedOnInvoiceSpend;
        fuTotalOffInvoiceSpend += plannedOffInvoiceSpend;

        // ── Step 2: Build KPI engine context with BRD-required external values ──
        // BRD canonical fields (all must be present for GP_ROI_PCT to resolve):
        //   PLANNED_LTA_ON, PLANNED_LTA_OFF, BASE_LTA_ON, BASE_LTA_OFF,
        //   TOTAL_PLANNED_SPEND, BASE_TOTAL_SPEND, INCR_SPEND,
        //   INCR_PROMO_SPEND (T-334: ROI paydası — promo-only, LTA hariç),
        //   PLANNED_ON_INVOICE_SPEND (T-008 fix: on-invoice only → used in PLANNED_TO)
        // Also inject tactic percentage codes for CPP_ON_SPEND formula.
        const context: SkuCalculationContext = {
          // User inputs — null when not yet entered (T-027: missing data → null)
          BASE_VOL: baseVolOrNull,
          PLAN_VOL: planVolOrNull,
          // Master data — null when not yet configured on the SKU (T-027:
          // e.g. Wella SKUs seeded without COGS must not silently become 0,
          // which would fabricate GP_ROI_PCT = 100% / RAG = GREEN)
          BPTT: unitPriceOrNull,
          COGS: cogsOrNull,
          // BRD external — from SpendCalc (BUG #2 / Gap G fix)
          PLANNED_LTA_ON: spendBreakdown.planned.ltaOnInvoice,
          PLANNED_LTA_OFF: spendBreakdown.planned.ltaOffInvoice,
          BASE_LTA_ON: spendBreakdown.base.ltaOnInvoice,
          BASE_LTA_OFF: spendBreakdown.base.ltaOffInvoice,
          TOTAL_PLANNED_SPEND: totalPlannedSpend,
          BASE_TOTAL_SPEND: baseTotalSpend,
          INCR_SPEND: incrSpend,
          // `T-334`/`Q6` (`Z66 §1`, `ADR 0011` F12) — ROI paydası AYRI
          // KALEM: *yalnız promo · LTA hariç · incremental*.
          // ⛔ `TOTAL_PLANNED_SPEND` (yukarıda) DEĞİŞMEDİ ve `plan.totalSpend`/
          // bütçe rezervasyonunu beslemeye devam ediyor — finansal yayılım SIFIR.
          INCR_PROMO_SPEND: spendBreakdown.incremental.promoTotal,
          // T-008: PLANNED_TO uses only on-invoice deductions (BRD NIV semantics)
          PLANNED_ON_INVOICE_SPEND: plannedOnInvoiceSpend,
          // Tactic percentage values (CPP_ON_SPEND formula needs CPP_ON_PCT etc.)
          ...mechanicValues,
        };

        // ── Step 3: KPI engine calculates all derived KPIs from context ──
        let kpiResults: Record<string, CalculationResult>;
        try {
          kpiResults = await this.kpiEngine.calculateSku(tenantId, context);
        } catch (kpiErr) {
          // Surface the error with context; do not silently return empty results
          // as that would persist null/wrong values.
          this.logger.error(
            `KPI engine failed for SKU ${planSku.skuId} in FU ${planFu.id}: ${kpiErr}`,
          );
          throw kpiErr;
        }

        skuResults.push(kpiResults);

        // ── Step 4: Persist SKU KPI results ─────────────────────────────
        // All values come from kpiResults; no fallback arithmetic here.
        // If a value is null, it persists as null (BRD: missing data → null).
        const incrementalVolume = planVol - baseVol;
        const plannedTurnover = kpiResults['PLANNED_TO']?.value ?? null;
        const plannedGp = kpiResults['PLANNED_GP']?.value ?? null;
        const gpRoi = kpiResults['GP_ROI_PCT']?.value ?? null;
        // RAG comes exclusively from kpi engine (config-driven thresholds)
        const ragStatus = kpiResults['GP_ROI_PCT']?.ragStatus ?? null;

        // T-046a: accumulate FU-level totals here (in-memory), replacing the
        // former post-batch re-read loop (see doc comment on
        // `fuTotalPlannedSpend` above). `planVol` is recalc's own loaded
        // value (never mutated by recalc itself); `plannedGp` is exactly
        // what's queued into `skuUpdatesForBatch` just below.
        fuTotalPlannedVolume += planVol;
        fuTotalGp += plannedGp ?? 0;

        // Convert KPI results to calculated_kpis JSONB format
        const calculatedKpis: Record<string, any> = {};
        for (const [kpiCode, result] of Object.entries(kpiResults)) {
          calculatedKpis[kpiCode] = {
            value: result.value,
            displayFormat: result.displayFormat,
            decimalPlaces: result.decimalPlaces,
            ragStatus: result.ragStatus,
            calculatedAt: new Date().toISOString(),
          };
        }

        // T-034: deliberate CAS bypass — derived KPI output, not a user
        // edit; a CAS here would fail every time against the version the
        // grid-cell write (updateSkuVolume) just bumped moments earlier.
        // T-034c/T-045: queued here, flushed in one batched UPDATE below —
        // must land inside this recalc's own lock-holding transaction (see
        // method doc comment), same as the individual write used to.
        skuUpdatesForBatch.push({
          planSkuId: planSku.id,
          data: {
            incrementalVolume,
            // T-027: write the (possibly null) values explicitly so a recalc
            // that newly discovers missing master data (e.g. COGS removed)
            // actually clears a previously-computed number rather than
            // silently leaving stale data behind (explicit `null` in the
            // batched UPDATE, same as TypeORM `.update()`'s prior behaviour).
            plannedTurnover,
            tacticSpend: totalPlannedSpend,
            plannedGp,
            gpRoi,
            ragStatus,
            calculatedKpis,
          },
        });
      }

      // T-045: single multi-row UPDATE for every SKU in this FU instead of
      // one UPDATE per SKU (52 -> 1 for a 52-SKU FU). Must run before Step 5
      // below, which re-reads these rows through the same `manager` and
      // needs the write already applied.
      await this.planRepo.batchUpdatePlanSkusUnversioned(
        skuUpdatesForBatch,
        tenantId,
        manager,
      );

      // ── Step 5: FU-level KPI aggregation ─────────────────────────────
      let fuKpiResults: Record<string, CalculationResult>;
      try {
        fuKpiResults = await this.kpiEngine.calculateFu(
          tenantId,
          skuResults,
          planFu.tactics || {},
        );
      } catch (kpiErr) {
        this.logger.error(
          `KPI engine (FU level) failed for FU ${planFu.id}: ${kpiErr}`,
        );
        throw kpiErr;
      }

      // FU GP ROI and RAG come exclusively from engine (config-driven)
      const fuGpRoi = fuKpiResults['GP_ROI_PCT']?.value ?? null;
      const fuRagStatus = fuKpiResults['GP_ROI_PCT']?.ragStatus ?? null;

      // Convert FU KPI results to JSONB format
      // T-177 S1 (2026-08-11): `coverageRatio` was previously computed by
      // the KPI engine and then dropped here — the "show coverage" half of
      // the product owner's decision had no consumer to persist it into,
      // while the "withdraw the color on partial coverage" half already
      // landed (kpi-engine.service.ts). Persist it so a future FU/plan grid
      // has the data to explain a missing/withdrawn RAG (frontend
      // consumption is out of scope here — grid-level → [[T-216a]],
      // plan-level → [[T-216b]]; [[T-172]] covers `overallRoi`'s collapse,
      // not `coverageRatio` consumption — corrected T-218, 2026-08-14).
      const fuCalculatedKpis: Record<string, any> = {};
      for (const [kpiCode, result] of Object.entries(fuKpiResults)) {
        fuCalculatedKpis[kpiCode] = {
          value: result.value,
          displayFormat: result.displayFormat,
          decimalPlaces: result.decimalPlaces,
          ragStatus: result.ragStatus,
          // Deliberately not defaulted to `null` when undefined: undefined
          // means "not an aggregate result at all" (FU-level formula KPI,
          // computed directly — CalculationResult doc comment), which is a
          // different fact than `null` ("aggregated over zero children").
          // JSON.stringify drops the key on `undefined`; the distinction
          // survives the round-trip as "key present" vs "key absent".
          coverageRatio: result.coverageRatio,
          calculatedAt: new Date().toISOString(),
        };
      }

      // T-034: deliberate CAS bypass — derived FU-level aggregate, not a
      // user edit (same rationale as updatePlanSkuUnversioned above).
      // T-034c: routed through `manager` (see method doc comment).
      await this.planRepo.updatePlanFuUnversioned(
        planFu.id,
        tenantId,
        {
          totalPlannedVolume: fuTotalPlannedVolume,
          totalSpend: fuTotalPlannedSpend,
          totalGp: fuTotalGp,
          // T-027: persist null explicitly (not `undefined`) so a recalc
          // that newly discovers missing master data clears any stale
          // prior value.
          gpRoi: fuGpRoi,
          ragStatus: fuRagStatus,
          calculatedKpis: fuCalculatedKpis,
        },
        manager,
      );

      allFuResults.push(fuKpiResults);

      // T-046a: plan-level totals accumulated here (in-memory) instead of
      // re-reading the entire plan tree afterwards (docs/analysis/0007
      // §2.3 item C #4 — this FU's `fuTotalPlannedVolume`/
      // `fuTotalPlannedSpend`/`fuTotalGp` are exactly what was just written
      // via `updatePlanFuUnversioned` above; the previous re-read existed
      // solely to sum these same numbers back out of the DB).
      planTotalPlannedVolume += fuTotalPlannedVolume;
      planTotalSpend += fuTotalPlannedSpend;
      planTotalGp += fuTotalGp;
      // T-056 step 4: same in-memory accumulation discipline as the three
      // totals above — no re-read, no re-derivation.
      planTotalOnInvoiceSpend += fuTotalOnInvoiceSpend;
      planTotalOffInvoiceSpend += fuTotalOffInvoiceSpend;
    }

    // ── Plan-level KPI aggregation ────────────────────────────────────────
    let planKpiResults: Record<string, CalculationResult>;
    try {
      planKpiResults = await this.kpiEngine.calculatePlan(
        tenantId,
        allFuResults,
      );
    } catch (kpiErr) {
      this.logger.error(
        `KPI engine (Plan level) failed for plan ${planId}: ${kpiErr}`,
      );
      throw kpiErr;
    }

    // Overall ROI and RAG come exclusively from engine (config-driven, no fallback)
    const overallRoi = planKpiResults['GP_ROI_PCT']?.value ?? null;
    const planRagStatus = planKpiResults['GP_ROI_PCT']?.ragStatus ?? null;
    // T-218: fraction of FUs that resolved into the value above
    // (recomputeRatioFromChildren's coverageRatio for GP_ROI_PCT —
    // kpi-engine.service.ts). Previously computed by the engine and
    // dropped here, same gap INV-N-004 records for the FU level (T-177
    // S1's comment a few lines up) — `plans` had no column to persist it
    // into until this migration.
    const planCoverageRatio =
      planKpiResults['GP_ROI_PCT']?.coverageRatio ?? null;

    // T-034: deliberate CAS bypass — derived plan-level aggregate, not a
    // user edit (same rationale as updatePlanSkuUnversioned above); also
    // must not bump plans.version (that would falsely invalidate an
    // in-flight grid edit's CAS token on an unrelated recalc).
    // T-034c: routed through `manager` — this is the write the advisory
    // lock exists to serialize (see method doc comment).
    // T-046a: `skipReadback: true` — this is the method's last statement,
    // the returned `Plan` was always discarded (docs/analysis/0007 §2.3
    // item C #5, ~50ms/call full-tree readback with no consumer).
    await this.planRepo.updateUnversioned(
      planId,
      tenantId,
      {
        totalPlannedVolume: planTotalPlannedVolume,
        totalSpend: planTotalSpend,
        totalGp: planTotalGp,
        // T-056 step 4: on/off-invoice breakdown, single derivation point
        // (SpendCalculationService via `buildMechanicValues` ->
        // `calculateAllSpendsForSKU`, T-052 chain) — same object recalc
        // already reads for `totalSpend` above. Identity by construction:
        // `onInvoiceSpend + offInvoiceSpend === totalSpend`
        // (spend-calculation.service.ts:511-514, "planned" bucket).
        // Consumed by nothing yet (design 0009 §6 step 4 is write-only;
        // `/submit`'s reservation still reads `plan.totalSpend` via the
        // TOTAL bucket until step 5).
        onInvoiceSpend: planTotalOnInvoiceSpend,
        offInvoiceSpend: planTotalOffInvoiceSpend,
        // T-027: persist null explicitly (not `undefined`) so a recalc
        // that newly discovers missing master data clears any stale prior
        // value.
        overallRoi,
        ragStatus: planRagStatus,
        // T-218: same explicit-null discipline as overallRoi/ragStatus
        // above — a recalc that newly loses full FU coverage must clear a
        // stale 1.0 rather than leave it behind.
        coverageRatio: planCoverageRatio,
      },
      manager,
      true,
    );
  }

  /**
   * Calculate KPIs for a plan and return results (API endpoint).
   * Triggers a full recalculation via recalculatePlanWithKpiEngine (which uses
   * SpendCalculationService as the authoritative spend/LTA source), then reads
   * the persisted calculatedKpis JSONB back from each FU/plan.
   */
  async calculateKpis(
    planId: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<{
    planKpis: Record<string, CalculationResult>;
    fuKpis: Array<{
      fuId: string;
      fuName: string;
      kpis: Record<string, CalculationResult>;
    }>;
  }> {
    // Trigger full recalculation (single authoritative path)
    await this.recalculatePlanWithKpiEngine(
      planId,
      tenantId,
      actor,
      undefined,
      'calculateKpis',
    );

    // Read stored KPI results (already computed above, no duplicate recalc)
    const plan = await this.findById(planId, tenantId, actor);

    const fuKpis: Array<{
      fuId: string;
      fuName: string;
      kpis: Record<string, CalculationResult>;
    }> = [];

    const allFuResults: Array<Record<string, CalculationResult>> = [];

    for (const planFu of plan.planFus || []) {
      // Convert stored JSONB calculatedKpis back to CalculationResult shape
      const fuKpiResults: Record<string, CalculationResult> = {};
      for (const [code, stored] of Object.entries(
        planFu.calculatedKpis || {},
      )) {
        fuKpiResults[code] = {
          kpiCode: code,
          value: (stored as any).value,
          displayFormat: (stored as any).displayFormat,
          decimalPlaces: (stored as any).decimalPlaces,
          ragStatus: (stored as any).ragStatus,
          // T-177 S1: read back what was persisted above — without this,
          // every reconstructed FU result silently lost its coverage
          // metadata on this round-trip.
          coverageRatio: (stored as any).coverageRatio,
        };
      }

      fuKpis.push({
        fuId: planFu.fuId,
        fuName: planFu.fu?.name || planFu.fuId,
        kpis: fuKpiResults,
      });
      allFuResults.push(fuKpiResults);
    }

    // Plan-level aggregation (re-run engine on stored FU results for plan shape)
    let planKpis: Record<string, CalculationResult>;
    try {
      planKpis = await this.kpiEngine.calculatePlan(tenantId, allFuResults);
    } catch (err) {
      this.logger.error(`Plan-level KPI aggregation failed: ${err}`);
      throw err;
    }

    return { planKpis, fuKpis };
  }

  async getAnalysis(
    planId: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<{
    gpRoiPerformance: {
      currentRoi: number | null;
      targetRoi: number;
      incrementalGp: number;
      // T-172: 'NOT_COMPUTABLE' is a fourth, distinct value — "no ROI could
      // be computed" (currentRoi === null) is a different fact from "ROI
      // computed and is below target" (BELOW_TARGET). Collapsing the two
      // was the measured bug (docs/analysis/0051 §4): a plan missing a
      // dependency (e.g. COGS) read as "below target" — a business
      // judgement the engine never made. See doc comment below.
      status: 'BELOW_TARGET' | 'ON_TARGET' | 'ABOVE_TARGET' | 'NOT_COMPUTABLE';
    };
    financialSummary: {
      totalSpend: number;
      plannedGp: number;
    };
    onOffSplit: {
      onInvoice: number;
      offInvoice: number;
      total: number;
    };
    fuRoiComparison: Array<{
      fuId: string;
      fuName: string;
      roi: number | null;
    }>;
    spendBreakdown: Array<{
      tacticCode: string;
      tacticName: string;
      spend: number;
      percentage: number;
    }>;
    volumeAnalysis: {
      baseVolume: number;
      plannedVolume: number;
      incrementalVolume: number;
      upliftPercentage: number;
      fuDetails: Array<{
        fuId: string;
        fuName: string;
        baseVolume: number;
        plannedVolume: number;
        uplift: number;
      }>;
    };
  }> {
    const plan = await this.findById(planId, tenantId, actor);

    // B-2: Read stored BASE_GP and INCR_GP from calculatedKpis JSONB —
    // no re-computation here. If recalc has not been run yet the values
    // may be null, which we surface as-is (BRD: missing data → null).
    let baseGp = 0;
    let baseVolume = 0;
    let storedIncrGp: number | null = null;
    let storedIncrGpFound = false;

    for (const planFu of plan.planFus || []) {
      // Accumulate base volume from SKUs (user-entered, not a calculated KPI)
      for (const planSku of planFu.planSkus || []) {
        baseVolume += Number(planSku.baseVolume) || 0;
      }

      // Sum BASE_GP from stored calculatedKpis across FUs
      const fuBaseGp = (planFu.calculatedKpis as Record<string, any> | null)?.[
        'BASE_GP'
      ]?.value;
      if (fuBaseGp !== null && fuBaseGp !== undefined) {
        baseGp += Number(fuBaseGp);
      }

      // Sum INCR_GP from stored calculatedKpis across FUs
      const fuIncrGp = (planFu.calculatedKpis as Record<string, any> | null)?.[
        'INCR_GP'
      ]?.value;
      if (fuIncrGp !== null && fuIncrGp !== undefined) {
        storedIncrGp = (storedIncrGp ?? 0) + Number(fuIncrGp);
        storedIncrGpFound = true;
      }
    }

    // Use stored INCR_GP if available; fallback to totalGp - baseGp only when
    // calculatedKpis have not been populated yet (first-run scenario).
    const incrementalGp = storedIncrGpFound
      ? (storedIncrGp ?? 0)
      : Number(plan.totalGp) - baseGp;

    // T-172: was `plan.overallRoi ? Number(...) : null` — a truthy check on
    // a DB-decimal value. AT THE TIME OF THE FIX it happened to work only
    // because this column had no transformer and Postgres handed back a
    // non-empty numeric STRING (e.g. "0.0000"), which is truthy; a real JS `0`
    // would have silently collapsed to `null` too.
    //
    // ⚠️ STALE PREMISE, CORRECTED (review, T-197/T-221, 2026-08-15):
    // `plan.overall_roi` now carries `transformer: DecimalTransformer`
    // (`plan.entity.ts`, commit 2ee4358, T-221 — all decimal columns on
    // this entity, including `gp_roi` ×2, `coverage_ratio` and the volume
    // columns, not only this field). The `Number(plan.overallRoi)` call below
    // is still correct — `Number()` on an already-`number` value is a
    // no-op — but the explicit null/undefined check (not a truthy check) is
    // what actually removes the fragility, and it does so regardless of
    // representation, which is why no code change was needed here — only this
    // comment's premise.
    const currentRoi =
      plan.overallRoi !== null && plan.overallRoi !== undefined
        ? Number(plan.overallRoi)
        : null;

    // B-1: Target ROI from GP_ROI_PCT KPI config (ragGreenThreshold) — NOT hardcoded.
    const gpRoiKpi = await this.kpiEngine.getKpiConfig(tenantId, 'GP_ROI_PCT');
    const targetRoi =
      gpRoiKpi?.ragGreenThreshold !== null &&
      gpRoiKpi?.ragGreenThreshold !== undefined
        ? Number(gpRoiKpi.ragGreenThreshold)
        : 20.0; // safe fallback only when KPI record is absent
    // T-172 / INV-N-004: `currentRoi === null` means the engine could not
    // compute a value at all (missing dependency, e.g. COGS — §2.3 edge
    // case) — a DIFFERENT fact from "computed and below target". The
    // previous code returned 'BELOW_TARGET' for both, so a Finance Manager
    // could not tell "this plan performs badly" from "this plan has
    // incomplete data" — opposite actions, same red badge. See the
    // `status` field's doc comment above.
    //
    // ⚠️ Known downstream consumer NOT updated in this change (backend-only
    // scope): collmind.frontend PlanAnalysis.tsx's `getRoiStatusBadge()`
    // only branches on 'BELOW_TARGET' / 'ON_TARGET', else renders the
    // ABOVE_TARGET (green "Hedef Üstü") badge — an unhandled
    // 'NOT_COMPUTABLE' will fall into that branch. This must land together
    // with a frontend fix (not assigned this turn) before deploy.
    const status:
      | 'BELOW_TARGET'
      | 'ON_TARGET'
      | 'ABOVE_TARGET'
      | 'NOT_COMPUTABLE' =
      currentRoi === null
        ? 'NOT_COMPUTABLE'
        : currentRoi >= targetRoi
          ? 'ABOVE_TARGET'
          : currentRoi >= targetRoi * 0.5
            ? 'ON_TARGET'
            : 'BELOW_TARGET';

    // B-3: ON/OFF invoice split from stored calculatedKpis (PLANNED_ON_INVOICE_SPEND
    // and TOTAL_PLANNED_SPEND), not from hardcoded tactic code pattern matching.
    // PLANNED_ON_INVOICE_SPEND is context-injected during recalc and stored per SKU
    // (aggregated to FU via SUM aggregation in calculateFu).
    let onInvoiceSpend = 0;
    let offInvoiceSpend = 0;
    const tacticSpendMap = new Map<string, { spend: number; name: string }>();

    const allTactics = await this.tacticRepo.find({
      where: { tenantId },
      select: ['code', 'name', 'spendType', 'tacticType'],
    });
    const tacticMap = new Map(allTactics.map((t) => [t.code, t]));

    for (const planFu of plan.planFus || []) {
      const fuKpis =
        (planFu.calculatedKpis as Record<string, any> | null) ?? {};

      // Read stored on-invoice and total spend from JSONB; do NOT recompute.
      const fuOnInvoice = fuKpis['PLANNED_ON_INVOICE_SPEND']?.value;
      const fuTotalSpend = fuKpis['TOTAL_PLANNED_SPEND']?.value;

      if (fuOnInvoice !== null && fuOnInvoice !== undefined) {
        const onInv = Number(fuOnInvoice);
        const totalSp =
          fuTotalSpend !== null && fuTotalSpend !== undefined
            ? Number(fuTotalSpend)
            : onInv;
        onInvoiceSpend += onInv;
        offInvoiceSpend += Math.max(0, totalSp - onInv);
      } else {
        // Fallback: stored KPIs not yet populated — use planFu.totalSpend as
        // on-invoice (conservative; recalc will correct on next trigger).
        onInvoiceSpend += Number(planFu.totalSpend) || 0;
      }

      // Tactic spend breakdown — tactic names from tacticMap (no amount re-calc).
      // Amounts come from stored per-tactic in tactics JSONB (raw user inputs) but
      // we label them only; the aggregate totals above are authoritative.
      if (planFu.tactics) {
        for (const [tacticCode, value] of Object.entries(planFu.tactics)) {
          const tactic = tacticMap.get(tacticCode);
          const tacticName = tactic?.name || tacticCode;
          // Use raw value for breakdown label; actual monetary impact is captured
          // in the on/off totals above (derived from engine-stored KPIs).
          const existing = tacticSpendMap.get(tacticCode);
          if (existing) {
            existing.spend += Number(value) || 0;
          } else {
            tacticSpendMap.set(tacticCode, {
              spend: Number(value) || 0,
              name: tacticName,
            });
          }
        }
      }
    }

    const fuRoiComparison = (plan.planFus || []).map((planFu) => ({
      fuId: planFu.fuId,
      fuName: planFu.fu?.name || planFu.fuId,
      roi: planFu.gpRoi ? Number(planFu.gpRoi) : null,
    }));

    const totalSpendForBreakdown = Array.from(tacticSpendMap.values()).reduce(
      (sum, val) => sum + val.spend,
      0,
    );
    const spendBreakdown = Array.from(tacticSpendMap.entries()).map(
      ([tacticCode, data]) => ({
        tacticCode,
        tacticName: data.name,
        spend: data.spend,
        percentage:
          totalSpendForBreakdown > 0
            ? (data.spend / totalSpendForBreakdown) * 100
            : 0,
      }),
    );

    let plannedVolume = 0;
    const fuDetails = (plan.planFus || []).map((planFu) => {
      let fuBaseVolume = 0;
      let fuPlannedVolume = 0;

      for (const planSku of planFu.planSkus || []) {
        fuBaseVolume += Number(planSku.baseVolume) || 0;
        fuPlannedVolume += Number(planSku.plannedVolume) || 0;
      }

      plannedVolume += fuPlannedVolume;

      return {
        fuId: planFu.fuId,
        fuName: planFu.fu?.name || planFu.fuId,
        baseVolume: fuBaseVolume,
        plannedVolume: fuPlannedVolume,
        uplift:
          fuBaseVolume > 0
            ? ((fuPlannedVolume - fuBaseVolume) / fuBaseVolume) * 100
            : 0,
      };
    });

    const incrementalVolume = plannedVolume - baseVolume;
    const upliftPercentage =
      baseVolume > 0 ? (incrementalVolume / baseVolume) * 100 : 0;

    return {
      gpRoiPerformance: {
        currentRoi,
        targetRoi,
        incrementalGp,
        status,
      },
      financialSummary: {
        totalSpend: Number(plan.totalSpend),
        plannedGp: Number(plan.totalGp),
      },
      onOffSplit: {
        onInvoice: onInvoiceSpend,
        offInvoice: offInvoiceSpend,
        total: onInvoiceSpend + offInvoiceSpend,
      },
      fuRoiComparison,
      spendBreakdown,
      volumeAnalysis: {
        baseVolume,
        plannedVolume,
        incrementalVolume,
        upliftPercentage,
        fuDetails,
      },
    };
  }
}
