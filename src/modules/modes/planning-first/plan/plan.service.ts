import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PlanRepository } from './plan.repository';
import {
  CreatePlanDto,
  UpdatePlanDto,
  AddFuDto,
  UpdateFuTacticDto,
  UpdateSkuVolumeDto,
} from './dto';
import {
  Plan,
  PlanStatus,
  PlanFu,
  PlanSku,
} from '../../../../database/entities/plan.entity';
import { BudgetService } from '../../../shared/budget/budget.service';
import { BudgetEnvelopeStatus } from '../../../../database/entities/budget-envelope.entity';
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
import { Repository } from 'typeorm';
import { ForecastingUnit } from '../../../../database/entities/forecasting-unit.entity';
import { Sku } from '../../../../database/entities/sku.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';
import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from '../../../../database/entities/plan-approval-history.entity';
import { UserRole } from '../../../../database/entities/user.entity';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';

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
 * T-027: Convert a raw (possibly string-typed decimal column, null, or
 * undefined) value into a strict number-or-null. Distinguishes "genuinely
 * absent" master/user data (null/undefined/NaN) from a legitimately entered
 * 0, which callers must NOT coalesce together — BRD requires missing data to
 * propagate as null through the KPI engine, never silently become 0.
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
  ) {}

  /**
   * T-028b (CM) + T-028c (PLANNER, generalized): scope-aware read guard,
   * used by findById. AccessScopeService.resolveScope already encodes the
   * per-role semantics (ADMIN/FM/READONLY -> UNRESTRICTED, CM -> category-
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
  ): Promise<PlanApprovalHistory> {
    const history = this.approvalHistoryRepo.create({
      planId,
      tenantId,
      actionedById: userId,
      action,
      comments,
      rejectionReason,
    });
    return this.approvalHistoryRepo.save(history);
  }

  async create(
    dto: CreatePlanDto,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    // T-028c: PLANNER may only create plans within their assigned CPL+
    // Category scope (BRD "Planner sadece yetkili CPL+Category"). ADMIN is
    // always UNRESTRICTED (route also allows only ADMIN|PLANNER). Flag-
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
   * READONLY this is a cheap no-DB-query UNRESTRICTED result (see
   * AccessScopeService.resolveScope), so resolving unconditionally whenever
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

    const {
      startDate: dtoStartDate,
      endDate: dtoEndDate,
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

    return this.planRepo.update(id, tenantId, updateData);
  }

  async addFu(
    planId: string,
    dto: AddFuDto,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
  ): Promise<PlanFu> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

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
    const existing = await this.planRepo.findPlanFu(planId, dto.fuId);
    if (existing) {
      throw new ConflictException('FU already added to this plan');
    }

    // Add FU to plan
    const planFu = await this.planRepo.addFu(
      planId,
      dto.fuId,
      tenantId,
      userId,
      dto.tactics,
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
    await this.recalculatePlanWithKpiEngine(planId, tenantId);

    return this.planRepo.findPlanFu(planId, dto.fuId) as Promise<PlanFu>;
  }

  async updateFuTactic(
    planId: string,
    fuId: string,
    dto: UpdateFuTacticDto,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<PlanFu> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    // Update tactics
    await this.planRepo.updatePlanFu(planFu.id, {
      tactics: dto.tactics || planFu.tactics,
    });

    // Recalculate using KPI engine
    await this.recalculatePlanWithKpiEngine(planId, tenantId);

    return this.planRepo.findPlanFu(planId, fuId) as Promise<PlanFu>;
  }

  async updateSkuVolume(
    planId: string,
    fuId: string,
    skuId: string,
    dto: UpdateSkuVolumeDto,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<PlanSku> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    const planSku = await this.planRepo.findPlanSku(planFu.id, skuId);
    if (!planSku) {
      throw new NotFoundException('SKU not found in this plan');
    }

    // Update volumes
    const incrementalVolume =
      dto.plannedVolume && dto.baseVolume
        ? dto.plannedVolume - dto.baseVolume
        : dto.plannedVolume && planSku.baseVolume
          ? dto.plannedVolume - planSku.baseVolume
          : planSku.incrementalVolume;

    await this.planRepo.updatePlanSku(planSku.id, {
      baseVolume: dto.baseVolume ?? planSku.baseVolume,
      plannedVolume: dto.plannedVolume ?? planSku.plannedVolume,
      incrementalVolume,
    });

    // Recalculate using KPI engine
    await this.recalculatePlanWithKpiEngine(planId, tenantId);

    return this.planRepo.findPlanSku(planFu.id, skuId) as Promise<PlanSku>;
  }

  async removeFu(
    planId: string,
    fuId: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<void> {
    const plan = await this.findById(planId, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    await this.planRepo.removeFu(planFu.id);
    await this.recalculatePlanWithKpiEngine(planId, tenantId);
  }

  async submit(
    id: string,
    tenantId: string,
    userId: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    const plan = await this.findById(id, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be submitted');
    }

    if (!plan.planFus || plan.planFus.length === 0) {
      throw new BadRequestException(
        'Plan must have at least one FU before submission',
      );
    }

    // Create approval request
    const approvalRequest = await this.approvalService.createRequest(
      {
        requestType: ApprovalRequestType.PLAN,
        entityType: 'PLAN',
        entityId: plan.id,
      },
      tenantId,
      userId,
    );

    const updated = await this.planRepo.updateStatus(
      id,
      tenantId,
      PlanStatus.PENDING_APPROVAL,
      {
        approvalRequestId: approvalRequest.id,
        // F7 fix: submittedById must be recorded here too — approve()/reject()
        // self-approval guard (docs/analysis/0004 §1/§9 N12) relies on it and
        // this legacy /submit path previously left it unset, silently
        // disabling the guard for any plan submitted this way.
        submittedById: userId,
        submittedAt: new Date(),
        updatedBy: userId,
      },
    );

    // T-029 (SORUN 2): BRD plan state machine — Pending Approval → RESERVE.
    // Best-effort: only reserves if a budget envelope already exists for this
    // channel/period (auto-create-on-approve, via approve()'s autoCreateBudget
    // flag, remains supported for plans submitted before any envelope exists —
    // matches pre-existing checkBudget()/approve() permissiveness, this does
    // not newly block submission when there is simply no envelope yet).
    const channelCode = plan.channel?.code || '';
    let reserved = false;
    if (Number(plan.totalSpend) > 0) {
      const envelope = await this.budgetService.findEnvelopeByDimensions(
        tenantId,
        channelCode,
        plan.periodMonth,
      );
      if (envelope) {
        try {
          await this.budgetService.reserveForPlan(
            id,
            plan.totalSpend,
            channelCode,
            plan.periodMonth,
            'TRY',
            tenantId,
            userId,
          );
          reserved = true;
        } catch (error) {
          // Compensate: revert to DRAFT so the plan is not left PENDING with
          // no reservation and no audit trail.
          await this.planRepo.updateStatus(id, tenantId, PlanStatus.DRAFT, {
            updatedBy: userId,
          });
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          throw new BadRequestException(
            `Budget reservation failed: ${message}`,
          );
        }
      }
    }

    // T-029 (SORUN 1): audit immutable — submit must be recorded in
    // PlanApprovalHistory. Same compensate-on-failure pattern as T-026
    // (ApprovalWorkflowService#submitForApproval): PlanRepository/BudgetService/
    // approvalHistoryRepo do not share a single QueryRunner, so this is not a
    // real DB transaction — on history-write failure we release any
    // reservation just made and revert status to DRAFT rather than leave the
    // plan PENDING_APPROVAL with no audit trail.
    try {
      await this.createHistoryEntry(
        id,
        tenantId,
        userId,
        ApprovalHistoryAction.SUBMITTED,
      );
    } catch (error) {
      this.logger.error(
        `createHistoryEntry failed after submit for plan ${id}; compensating (release budget if reserved, revert to DRAFT): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      if (reserved) {
        try {
          await this.budgetService.releaseForPlan(
            id,
            tenantId,
            userId,
            'SUBMIT_COMPENSATION',
          );
        } catch (releaseError) {
          this.logger.error(
            `Compensation failed: could not release budget for plan ${id} after history write failure: ${
              releaseError instanceof Error
                ? releaseError.message
                : 'Unknown error'
            }`,
          );
        }
      }
      await this.planRepo.updateStatus(id, tenantId, PlanStatus.DRAFT, {
        updatedBy: userId,
      });
      throw new InternalServerErrorException(
        'Failed to record approval history for plan submission; submission has been rolled back to DRAFT.',
      );
    }

    return updated;
  }

  /**
   * Check budget availability for a plan before approval
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
  }> {
    const plan = await this.findById(id, tenantId, actor);
    const channelCode = plan.channel?.code || '';
    const channelName = plan.channel?.name || channelCode;

    const envelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      plan.periodMonth,
    );

    if (!envelope) {
      return {
        hasBudget: false,
        planTotalSpend: Number(plan.totalSpend),
        channel: channelCode,
        channelName,
        period: plan.periodMonth,
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
    };
  }

  async approve(
    id: string,
    tenantId: string,
    userId: string,
    comments?: string,
    autoCreateBudget?: boolean,
    budgetAmount?: number,
    actor?: PlanActor,
  ): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL plans can be approved',
      );
    }

    if (!plan.approvalRequestId) {
      throw new BadRequestException('Approval request not found');
    }

    // F7 (docs/analysis/0004-rbac-brd-alignment.md §1/§9 N12): legacy/kanonik
    // approve() had no self-approval guard — a Planner+Admin dual account
    // could bypass "Planner cannot approve their own plan". Mirrors the
    // check already present in ApprovalWorkflowService#reviewPlan.
    if (plan.submittedById === userId) {
      throw new ForbiddenException('You cannot approve your own submission');
    }

    // T-028b: CM kategori-scoped onay — kesişim yoksa 403 (§3, §9 N4).
    await this.assertCmDecisionScope(plan, tenantId, actor);

    const channelCode = plan.channel?.code || '';

    // Check if budget envelope exists
    const existingEnvelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      plan.periodMonth,
    );

    if (!existingEnvelope && autoCreateBudget) {
      // Auto-create budget envelope
      const allocatedAmount =
        budgetAmount || Math.max(Number(plan.totalSpend) * 2, 100000);
      const periodLabel = plan.periodMonth; // e.g., "2026-01"
      const fiscalYear = plan.periodMonth.substring(0, 4);

      await this.budgetService.createEnvelope(tenantId, {
        code: `${channelCode}/${periodLabel}`,
        name: `${plan.channel?.name || channelCode} - ${periodLabel} Bütçesi`,
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
      });
    } else if (!existingEnvelope && !autoCreateBudget) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channelCode}, period: ${plan.periodMonth}. Use autoCreateBudget to create one automatically.`,
      );
    }

    // T-029 (SORUN 2): BRD plan state machine — Approved → COMMIT. Converts
    // the RESERVE created at submit() (if any) into a COMMIT; falls back to a
    // fresh direct COMMIT for plans that reached PENDING_APPROVAL without a
    // prior reservation (e.g. envelope created only now via autoCreateBudget
    // above). Idempotent — repeat approve calls do not double-commit.
    try {
      await this.budgetService.commitReservedForPlan(
        plan.id,
        plan.totalSpend,
        channelCode,
        plan.periodMonth,
        'TRY',
        tenantId,
        userId,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(`Budget commit failed: ${errorMessage}`);
    }

    // Update approval request
    await this.approvalService.approve(
      plan.approvalRequestId,
      tenantId,
      userId,
      { comments },
    );

    const updated = await this.planRepo.updateStatus(
      id,
      tenantId,
      PlanStatus.APPROVED,
      {
        approvedAt: new Date(),
        approvedById: userId,
        updatedBy: userId,
      },
    );

    // T-029 (SORUN 1): audit immutable — approve must be recorded. On
    // history-write failure, compensate by releasing the just-created COMMIT
    // and reverting status back to PENDING_APPROVAL (approvalService.approve
    // itself is not compensated — its own audit trail already correctly
    // records the approval action; only the plan-status/budget side effects
    // introduced by this call are unwound, same limited-compensation
    // trade-off documented in T-026 for submit).
    try {
      await this.createHistoryEntry(
        id,
        tenantId,
        userId,
        ApprovalHistoryAction.APPROVED,
        comments,
      );
    } catch (error) {
      this.logger.error(
        `createHistoryEntry failed after approve for plan ${id}; compensating (release COMMIT, revert to PENDING_APPROVAL): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      try {
        await this.budgetService.releaseForPlan(
          id,
          tenantId,
          userId,
          'APPROVE_COMPENSATION',
        );
      } catch (releaseError) {
        this.logger.error(
          `Compensation failed: could not release budget for plan ${id} after history write failure: ${
            releaseError instanceof Error
              ? releaseError.message
              : 'Unknown error'
          }`,
        );
      }
      await this.planRepo.updateStatus(
        id,
        tenantId,
        PlanStatus.PENDING_APPROVAL,
        { updatedBy: userId },
      );
      throw new InternalServerErrorException(
        'Failed to record approval history for plan approval; approval has been rolled back to PENDING_APPROVAL.',
      );
    }

    return updated;
  }

  async reject(
    id: string,
    tenantId: string,
    userId: string,
    reason: string,
    actor?: PlanActor,
  ): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL plans can be rejected',
      );
    }

    if (!plan.approvalRequestId) {
      throw new BadRequestException('Approval request not found');
    }

    // F7: same self-approval guard as approve() — a rejecter reviewing their
    // own submission is equally a bypass of "Planner cannot review their own
    // plan" (mirrors ApprovalWorkflowService#reviewPlan).
    if (plan.submittedById === userId) {
      throw new ForbiddenException('You cannot review your own submission');
    }

    // T-028b: CM kategori-scoped red — kesişim yoksa 403.
    await this.assertCmDecisionScope(plan, tenantId, actor);

    await this.approvalService.reject(
      plan.approvalRequestId,
      tenantId,
      userId,
      { reason },
    );

    const updated = await this.planRepo.updateStatus(
      id,
      tenantId,
      PlanStatus.REJECTED,
      {
        rejectedAt: new Date(),
        rejectedById: userId,
        rejectionReason: reason,
        updatedBy: userId,
      },
    );

    // T-029 (SORUN 1): audit immutable — reject must be recorded. Note the
    // ordering: budget release (below, after a successful history write) is
    // deliberately the LAST step. approvalService.reject + status→REJECTED
    // are recorded first; if the history write then fails we revert status
    // back to PENDING_APPROVAL (no budget has moved yet, so no release/
    // re-reserve compensation is needed — a real transaction would be
    // preferable, tracked as the same open point as T-026's submit path).
    try {
      await this.createHistoryEntry(
        id,
        tenantId,
        userId,
        ApprovalHistoryAction.REJECTED,
        undefined,
        reason,
      );
    } catch (error) {
      this.logger.error(
        `createHistoryEntry failed after reject for plan ${id}; compensating (revert to PENDING_APPROVAL, budget untouched): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      await this.planRepo.updateStatus(
        id,
        tenantId,
        PlanStatus.PENDING_APPROVAL,
        { updatedBy: userId },
      );
      throw new InternalServerErrorException(
        'Failed to record approval history for plan rejection; rejection has been rolled back to PENDING_APPROVAL.',
      );
    }

    // T-029 (SORUN 2): BRD plan state machine — Rejected → RELEASE. Releases
    // any outstanding RESERVE (submit()) and/or COMMIT (defensive — a plan
    // should not be PENDING_APPROVAL with a COMMIT, but releaseForPlan is a
    // no-op for whichever type is absent).
    try {
      await this.budgetService.releaseForPlan(id, tenantId, userId);
    } catch (error) {
      // Budget already correctly reflects a REJECTED plan's intent (nothing
      // should be encumbered); a release failure here is an ops-visible issue
      // (logged), not one that should un-reject an already-recorded,
      // immutably-audited rejection.
      this.logger.error(
        `Budget release failed after reject for plan ${id} (status/history already committed as REJECTED): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    return updated;
  }

  async delete(id: string, tenantId: string, actor?: PlanActor): Promise<void> {
    const plan = await this.findById(id, tenantId, actor);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be deleted');
    }

    if (plan.totalSpend > 0) {
      await this.budgetService.releaseForPlan(
        id,
        tenantId,
        undefined,
        'DELETE',
      );
    }

    await this.planRepo.softDelete(id, tenantId);
  }

  /**
   * Full KPI engine recalculation for the entire plan
   * Follows BRD hierarchy: SKU → FU → PLAN
   */
  async recalculatePlanWithKpiEngine(
    planId: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<void> {
    const plan = await this.findById(planId, tenantId, actor);
    if (!plan.planFus || plan.planFus.length === 0) return;

    const allFuResults: Array<Record<string, CalculationResult>> = [];

    for (const planFu of plan.planFus) {
      const skuResults: Array<Record<string, CalculationResult>> = [];

      // Build mechanic values map for this FU (needed by SpendCalc)
      const mechanicValues: Record<string, number> = {};
      for (const pmv of (planFu as any).planMechanicValues || []) {
        if (pmv.mechanic?.code && pmv.enteredValue != null) {
          mechanicValues[pmv.mechanic.code] = pmv.enteredValue;
        } else if (pmv.mechanicCode && pmv.enteredValue != null) {
          mechanicValues[pmv.mechanicCode] = pmv.enteredValue;
        }
      }
      // Also read tactic values if stored in planFu.tactics
      for (const [code, val] of Object.entries(planFu.tactics || {})) {
        if (val != null) mechanicValues[code] = val as number;
      }

      // Build SpendCalc CalculationContext for this FU
      const calcCtx: CalculationContext = {
        planId: plan.id,
        fuId: planFu.id,
        skuContexts: [],
        mechanicValues,
      };

      // Track FU-level totals (summed from per-SKU SpendCalc results)
      let fuTotalPlannedSpend = 0;

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
        fuTotalPlannedSpend += totalPlannedSpend;

        // ── Step 2: Build KPI engine context with BRD-required external values ──
        // BRD canonical fields (all must be present for GP_ROI_PCT to resolve):
        //   PLANNED_LTA_ON, PLANNED_LTA_OFF, BASE_LTA_ON, BASE_LTA_OFF,
        //   TOTAL_PLANNED_SPEND, BASE_TOTAL_SPEND, INCR_SPEND,
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

        await this.planRepo.updatePlanSku(planSku.id, {
          incrementalVolume,
          // T-027: write the (possibly null) values explicitly so a recalc
          // that newly discovers missing master data (e.g. COGS removed)
          // actually clears a previously-computed number rather than
          // silently leaving stale data behind (TypeORM `.update()` skips
          // `undefined` fields but persists explicit `null`).
          plannedTurnover,
          tacticSpend: totalPlannedSpend,
          plannedGp,
          gpRoi,
          ragStatus,
          calculatedKpis,
        });
      }

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

      // Aggregate SKU volumes/GP for FU-level persist
      let fuTotalPlannedVolume = 0;
      let fuTotalGp = 0;

      for (const planSku of planFu.planSkus || []) {
        const updated = await this.planRepo.findPlanSku(
          planFu.id,
          planSku.skuId,
        );
        if (updated) {
          fuTotalPlannedVolume += Number(updated.plannedVolume) || 0;
          fuTotalGp += Number(updated.plannedGp) || 0;
        }
      }

      // FU GP ROI and RAG come exclusively from engine (config-driven)
      const fuGpRoi = fuKpiResults['GP_ROI_PCT']?.value ?? null;
      const fuRagStatus = fuKpiResults['GP_ROI_PCT']?.ragStatus ?? null;

      // Convert FU KPI results to JSONB format
      const fuCalculatedKpis: Record<string, any> = {};
      for (const [kpiCode, result] of Object.entries(fuKpiResults)) {
        fuCalculatedKpis[kpiCode] = {
          value: result.value,
          displayFormat: result.displayFormat,
          decimalPlaces: result.decimalPlaces,
          ragStatus: result.ragStatus,
          calculatedAt: new Date().toISOString(),
        };
      }

      await this.planRepo.updatePlanFu(planFu.id, {
        totalPlannedVolume: fuTotalPlannedVolume,
        totalSpend: fuTotalPlannedSpend,
        totalGp: fuTotalGp,
        // T-027: persist null explicitly (not `undefined`) so a recalc that
        // newly discovers missing master data clears any stale prior value.
        gpRoi: fuGpRoi,
        ragStatus: fuRagStatus,
        calculatedKpis: fuCalculatedKpis,
      });

      allFuResults.push(fuKpiResults);
    }

    // Plan level aggregation
    let planTotalPlannedVolume = 0;
    let planTotalSpend = 0;
    let planTotalGp = 0;

    // Re-read FUs to get updated aggregations
    const updatedPlan = await this.findById(planId, tenantId, actor);
    for (const planFu of updatedPlan.planFus || []) {
      planTotalPlannedVolume += Number(planFu.totalPlannedVolume) || 0;
      planTotalSpend += Number(planFu.totalSpend) || 0;
      planTotalGp += Number(planFu.totalGp) || 0;
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

    await this.planRepo.update(planId, tenantId, {
      totalPlannedVolume: planTotalPlannedVolume,
      totalSpend: planTotalSpend,
      totalGp: planTotalGp,
      // T-027: persist null explicitly (not `undefined`) so a recalc that
      // newly discovers missing master data clears any stale prior value.
      overallRoi,
      ragStatus: planRagStatus,
    });
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
    await this.recalculatePlanWithKpiEngine(planId, tenantId, actor);

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
      status: 'BELOW_TARGET' | 'ON_TARGET' | 'ABOVE_TARGET';
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

    const currentRoi = plan.overallRoi ? Number(plan.overallRoi) : null;

    // B-1: Target ROI from GP_ROI_PCT KPI config (ragGreenThreshold) — NOT hardcoded.
    const gpRoiKpi = await this.kpiEngine.getKpiConfig(tenantId, 'GP_ROI_PCT');
    const targetRoi =
      gpRoiKpi?.ragGreenThreshold !== null &&
      gpRoiKpi?.ragGreenThreshold !== undefined
        ? Number(gpRoiKpi.ragGreenThreshold)
        : 20.0; // safe fallback only when KPI record is absent
    const status =
      currentRoi === null
        ? 'BELOW_TARGET'
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
