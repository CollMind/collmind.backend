import {
  Injectable,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Plan, PlanStatus } from '../../../../database/entities/plan.entity';
import { UserRole } from '../../../../database/entities/user.entity';
import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from '../../../../database/entities/plan-approval-history.entity';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { BudgetSpendType } from '../../../../database/entities/budget-envelope.entity';
import { PlanReservationReleaseReason } from '../../../shared/budget/budget-reservation.service';
import { SpendCalculationService } from '../../../shared/spend-calculation/spend-calculation.service';
import { PlanRepository } from './plan.repository';
import {
  SubmitForApprovalDto,
  SubmissionResult,
} from './dto/submit-for-approval.dto';
import {
  ReviewPlanDto,
  ReviewDecision,
  ReviewResult,
} from './dto/review-plan.dto';
import { ApprovalFilters, PendingPlan } from './dto/approval-queue.dto';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { PlanActor } from './plan.service';
import {
  missingVersionConflict,
  staleVersionConflict,
} from '../../../shared/persistence/versioned-update.helper';

@Injectable()
export class ApprovalWorkflowService {
  private readonly logger = new Logger(ApprovalWorkflowService.name);

  constructor(
    private readonly planRepo: PlanRepository,
    private readonly approvalService: ApprovalService,
    private readonly budgetService: BudgetService,
    private readonly spendCalc: SpendCalculationService,
    @InjectRepository(PlanApprovalHistory)
    private readonly approvalHistoryRepo: Repository<PlanApprovalHistory>,
    private readonly accessScope: AccessScopeService,
    // T-034b: this is the SECOND canonical plan-state-transition path (see
    // plan.service.ts submit/approve/reject/returnToDraft — "İki kanonik
    // yol" in the task description). Same real-transaction + FOR UPDATE +
    // status-CAS treatment (docs/analysis/0005 §4), same DataSource
    // mechanism.
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Pre-submission validation and submission
   */
  async submitForApproval(
    planId: string,
    tenantId: string,
    userId: string,
    dto: SubmitForApprovalDto,
    actor?: PlanActor,
  ): Promise<SubmissionResult> {
    const plan = await this.planRepo.findById(planId, tenantId);
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    // T-028c: this is a PLANNER-only route (@Roles(ADMIN, PLANNER)) that
    // resolves the plan directly via planRepo (bypassing PlanService's
    // scope-aware findById) — an out-of-scope PLANNER could otherwise
    // submit-for-approval a plan outside their assigned CPL+Category.
    // Out-of-scope -> 404 (varlık sızdırma yok, same as PlanService#findById).
    if (actor) {
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
          message: `Plan with ID ${planId} not found`,
          code: 'OUT_OF_SCOPE',
        });
      }
    }

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be submitted');
    }

    // Pre-submission validations
    const validationErrors: string[] = [];
    const warnings: string[] = [];

    // 1. Check required mechanics/tactics.
    // T-052: SpendCalculationService now reads BOTH sources (planMechanicValues
    // AND plan_fus.tactics, merged via SpendCalculationService#buildMechanicValues
    // — see its doc comment for why both exist and which wins on collision).
    // Validation must use the same two sources to stay consistent: if neither is
    // populated for a FU, SpendCalc will return zero spend for it — an invalid plan.
    // We accept either planMechanicValues with at least one enteredValue, OR a non-empty
    // tactics JSONB (the ONLY UI-reachable entry point today, PATCH .../tactics)
    // so that both are covered.
    if (!plan.planFus || plan.planFus.length === 0) {
      validationErrors.push('Plan must have at least one FU');
    } else {
      for (const planFu of plan.planFus) {
        const hasMechanicValues =
          planFu.planMechanicValues &&
          planFu.planMechanicValues.some(
            (pmv: any) =>
              pmv.enteredValue !== null && pmv.enteredValue !== undefined,
          );
        const hasTactics =
          planFu.tactics && Object.keys(planFu.tactics).length > 0;

        if (!hasMechanicValues && !hasTactics) {
          validationErrors.push(
            `FU ${planFu.fu?.code || planFu.fuId} has no mechanic values or tactics defined`,
          );
        }
      }
    }

    // 2. Check RAG status
    if (plan.ragStatus === 'RED') {
      warnings.push(
        'Plan has RED RAG status. Please review before submission.',
      );
    }

    // 3. Calculate On-Invoice/Off-Invoice spend breakdown
    const spendBreakdown = await this.calculateSpendBreakdown(plan, tenantId);
    plan.onInvoiceSpend = spendBreakdown.onInvoice;
    plan.offInvoiceSpend = spendBreakdown.offInvoice;

    // 4. Budget availability check
    const channelCode = plan.channel?.code || '';
    const budgetCheck = await this.checkBudgetAvailability(
      tenantId,
      channelCode,
      plan.periodMonth,
      spendBreakdown.onInvoice,
      spendBreakdown.offInvoice,
    );

    if (!budgetCheck.overallSufficient) {
      validationErrors.push(
        `Insufficient budget. On-Invoice: ${budgetCheck.onInvoice.available} available, ${budgetCheck.onInvoice.requested} requested. ` +
          `Off-Invoice: ${budgetCheck.offInvoice.available} available, ${budgetCheck.offInvoice.requested} requested.`,
      );
    }

    if (validationErrors.length > 0) {
      return {
        success: false,
        planId: plan.id,
        status: plan.status,
        budgetCheck,
        validationErrors,
      } as SubmissionResult;
    }

    // T-034b (docs/analysis/0005 §4): real transaction + `FOR UPDATE` +
    // status-CAS, replacing the old compensate-on-failure pattern. The
    // validation/spend-calc work above is read-only and pre-transaction
    // (heavy KPI/SpendCalc calls do not belong inside a locked write
    // transaction — see T-034c's advisory-lock scope note in the design
    // doc for the same "don't widen the lock window" concern); only the
    // state transition + its budget/audit side effects need to be atomic.
    let approvalRequestId = '';
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const locked = await this.planRepo.findByIdForUpdate(
        planId,
        tenantId,
        queryRunner.manager,
      );
      if (!locked) {
        throw new NotFoundException(`Plan with ID ${planId} not found`);
      }
      if (locked.status !== PlanStatus.DRAFT) {
        throw new BadRequestException('Only DRAFT plans can be submitted');
      }

      // T-034b (code-review fix): K5 exception — submitForApproval() is the
      // SAME transition as PlanService#submit and must validate
      // plans.version identically (see SubmitForApprovalDto#version).
      if (dto.version === undefined || dto.version === null) {
        throw missingVersionConflict({ entity: 'PLAN', entityId: planId });
      }
      if (locked.version !== dto.version) {
        throw staleVersionConflict({
          entity: 'PLAN',
          entityId: planId,
          expectedVersion: dto.version,
          currentVersion: locked.version,
          current: {
            totalSpend: Number(locked.totalSpend),
            updatedBy: locked.updatedBy,
            updatedAt: locked.updatedAt,
          },
        });
      }

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
      approvalRequestId = approvalRequest.id;

      // Reserve budget (soft reservation - will be committed on approval).
      if (spendBreakdown.onInvoice > 0) {
        await this.reserveBudgetForPlan(
          planId,
          spendBreakdown.onInvoice,
          channelCode,
          plan.periodMonth,
          'TRY',
          tenantId,
          userId,
          'ON_INVOICE',
          queryRunner.manager,
        );
      }
      if (spendBreakdown.offInvoice > 0) {
        await this.reserveBudgetForPlan(
          planId,
          spendBreakdown.offInvoice,
          channelCode,
          plan.periodMonth,
          'TRY',
          tenantId,
          userId,
          'OFF_INVOICE',
          queryRunner.manager,
        );
      }

      const affected = await this.planRepo.updateStatusCas(
        queryRunner.manager,
        planId,
        tenantId,
        PlanStatus.DRAFT,
        {
          status: PlanStatus.PENDING_APPROVAL,
          approvalRequestId: approvalRequest.id,
          submissionNotes: dto.submissionNotes,
          submittedAt: new Date(),
          submittedById: userId,
          onInvoiceSpend: spendBreakdown.onInvoice,
          offInvoiceSpend: spendBreakdown.offInvoice,
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

      await this.createHistoryEntry(
        planId,
        tenantId,
        userId,
        ApprovalHistoryAction.SUBMITTED,
        dto.submissionNotes,
        undefined,
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

    return {
      success: true,
      planId: plan.id,
      status: PlanStatus.PENDING_APPROVAL,
      budgetCheck: {
        ...budgetCheck,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
      approvalRequestId,
    };
  }

  /**
   * Review plan (Category Manager or Finance Manager)
   */
  async reviewPlan(
    planId: string,
    tenantId: string,
    reviewerId: string,
    dto: ReviewPlanDto,
    reviewerRole?: UserRole,
  ): Promise<ReviewResult> {
    const plan = await this.planRepo.findById(planId, tenantId);
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    // Check if reviewer has permission
    if (
      plan.status !== PlanStatus.PENDING_APPROVAL &&
      plan.status !== PlanStatus.PENDING_FINANCE_REVIEW
    ) {
      throw new BadRequestException(
        `Plan is not in a reviewable state. Current status: ${plan.status}`,
      );
    }

    // ADR 0002 (docs/decisions/0002-finance-manager-escalation-onayi.md):
    // FINANCE_MANAGER may only review plans that were explicitly escalated to
    // finance (PENDING_FINANCE_REVIEW). The normal PENDING_APPROVAL queue is
    // Category Manager's — FM must get 403, not silently fall through the
    // RolesGuard's coarse @Roles() check (@Roles only knows the route allows
    // ADMIN|CATEGORY_MANAGER|FINANCE_MANAGER, not the plan's current status).
    if (
      reviewerRole === UserRole.FINANCE_MANAGER &&
      plan.status !== PlanStatus.PENDING_FINANCE_REVIEW
    ) {
      throw new ForbiddenException(
        'Finance Manager can only review plans escalated to finance (PENDING_FINANCE_REVIEW)',
      );
    }

    // Self-approval prevention
    if (plan.submittedById === reviewerId) {
      throw new ForbiddenException('You cannot review your own submission');
    }

    // T-028b: CM kategori-scoped onay — kesişim yoksa 403 (§3, §9 N4).
    if (reviewerRole === UserRole.CATEGORY_MANAGER) {
      const scope = await this.accessScope.resolveScope(
        tenantId,
        reviewerId,
        reviewerRole,
      );
      this.accessScope.assertEntityInScope(scope, {
        categoryId: plan.categoryId,
      });
    }

    // T-034b (docs/analysis/0005 §4): real transaction + `FOR UPDATE` +
    // status-CAS for the three decisions that write plan state
    // (APPROVE/REJECT/REQUEST_CHANGES) — ESCALATE is dispatched to the
    // separate `escalateToFinance` public method, which opens its own
    // lock/transaction (same pattern, different entrypoint). The two
    // "decision requires field X" validations stay pre-lock (cheap
    // fail-fast, no side effects to roll back).
    if (dto.decision === ReviewDecision.ESCALATE) {
      if (!dto.escalationReason) {
        throw new BadRequestException('Escalation reason is required');
      }
      await this.escalateToFinance(
        plan.id,
        tenantId,
        reviewerId,
        dto.escalationReason,
        dto.comments,
      );
      return {
        success: true,
        planId: plan.id,
        newStatus: PlanStatus.PENDING_FINANCE_REVIEW,
        message: 'Plan escalated to Finance Manager',
      };
    }
    if (dto.decision === ReviewDecision.REJECT && !dto.rejectionReason) {
      throw new BadRequestException('Rejection reason is required');
    }
    if (dto.decision === ReviewDecision.REQUEST_CHANGES && !dto.comments) {
      throw new BadRequestException(
        'Comments are required when requesting changes',
      );
    }
    if (
      dto.decision !== ReviewDecision.APPROVE &&
      dto.decision !== ReviewDecision.REJECT &&
      dto.decision !== ReviewDecision.REQUEST_CHANGES
    ) {
      throw new BadRequestException(`Invalid decision: ${dto.decision}`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let result: ReviewResult;
    try {
      // T-034b step 1: lock the row before deciding/writing anything.
      const locked = await this.planRepo.findByIdForUpdate(
        planId,
        tenantId,
        queryRunner.manager,
      );
      if (!locked) {
        throw new NotFoundException(`Plan with ID ${planId} not found`);
      }
      if (
        locked.status !== PlanStatus.PENDING_APPROVAL &&
        locked.status !== PlanStatus.PENDING_FINANCE_REVIEW
      ) {
        throw new BadRequestException(
          `Plan is not in a reviewable state. Current status: ${locked.status}`,
        );
      }

      switch (dto.decision) {
        case ReviewDecision.APPROVE:
          result = await this.approvePlan(
            locked,
            tenantId,
            reviewerId,
            dto.comments,
            queryRunner.manager,
          );
          break;
        case ReviewDecision.REJECT:
          result = await this.rejectPlan(
            locked,
            tenantId,
            reviewerId,
            dto.rejectionReason as string,
            dto.comments,
            queryRunner.manager,
          );
          break;
        case ReviewDecision.REQUEST_CHANGES:
          result = await this.requestChanges(
            locked,
            tenantId,
            reviewerId,
            dto.comments as string,
            dto.specificChanges,
            queryRunner.manager,
          );
          break;
        default:
          // Unreachable — validated above — but keeps TS control-flow happy.
          throw new BadRequestException(`Invalid decision: ${dto.decision}`);
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    return result;
  }

  /**
   * Approve plan. `plan` MUST be the `FOR UPDATE`-locked row from
   * `reviewPlan`; `manager` is that same lock's transaction manager — every
   * side effect below (budget COMMIT, approval-request decision, status
   * write, history) lands on it, so any failure rolls back the whole
   * decision atomically (T-034b — replaces the old unconditional-throw
   * "Budget commit failed" wrapping, which is no longer needed: an error
   * here now simply propagates and rolls back, same as everywhere else).
   */
  private async approvePlan(
    plan: Plan,
    tenantId: string,
    approverId: string,
    comments: string | undefined,
    manager: EntityManager,
  ): Promise<ReviewResult> {
    const channelCode = plan.channel?.code || '';

    // T-019/T-048 cross-path fix: this is one of TWO canonical approve
    // routes (see plan.service.ts#approve for the other) — the plan may
    // have been submitted via EITHER canonical submit route (this class's
    // own submitForApproval, ON/OFF buckets, OR plan.service.ts#submit's
    // 'TOTAL' bucket). Two separate bucket-specific commit calls here
    // (pre-fix) blindly assumed ON/OFF buckets exist; if the plan was
    // instead submitted via the 'TOTAL' path, neither call would find its
    // bucket's RESERVE and each would fall through to a fresh direct
    // COMMIT — double-encumbering the envelope on top of the still-
    // outstanding TOTAL RESERVE. commitAllReservedForPlan discovers and
    // commits whichever bucket(s) actually have an outstanding RESERVE
    // (see its JSDoc on BudgetService).
    await this.commitAllBudgetForPlan(
      plan.id,
      Number(plan.onInvoiceSpend) + Number(plan.offInvoiceSpend),
      channelCode,
      plan.periodMonth,
      'TRY',
      tenantId,
      approverId,
      manager,
    );

    // Update approval request
    if (plan.approvalRequestId) {
      await this.approvalService.approve(
        plan.approvalRequestId,
        tenantId,
        approverId,
        { comments },
        manager,
      );
    }

    // T-034b: status-CAS write — `plan.status` is the FOR-UPDATE-locked
    // status read by `reviewPlan` (PENDING_APPROVAL or
    // PENDING_FINANCE_REVIEW — both are valid predecessors of APPROVED).
    const affected = await this.planRepo.updateStatusCas(
      manager,
      plan.id,
      tenantId,
      plan.status,
      {
        status: PlanStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: approverId,
        updatedBy: approverId,
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

    // Create history entry
    await this.createHistoryEntry(
      plan.id,
      tenantId,
      approverId,
      ApprovalHistoryAction.APPROVED,
      comments,
      undefined,
      undefined,
      undefined,
      manager,
    );

    return {
      success: true,
      planId: plan.id,
      newStatus: PlanStatus.APPROVED,
      message: 'Plan approved successfully',
    };
  }

  /**
   * Reject plan. `plan`/`manager` — see `approvePlan`'s header comment.
   */
  private async rejectPlan(
    plan: Plan,
    tenantId: string,
    rejectorId: string,
    reason: string,
    comments: string | undefined,
    manager: EntityManager,
  ): Promise<ReviewResult> {
    // Release reserved budget — now inside the same transaction as the
    // status/history writes below (T-034b "asıl ödül": a release failure
    // rolls back the whole rejection instead of leaving a silent
    // REJECTED-but-still-reserved inconsistency, same rationale as
    // plan.service.ts#reject).
    await this.releaseBudgetForPlan(
      plan.id,
      tenantId,
      rejectorId,
      'REJECT',
      manager,
    );

    // Update approval request
    if (plan.approvalRequestId) {
      await this.approvalService.reject(
        plan.approvalRequestId,
        tenantId,
        rejectorId,
        { reason },
        manager,
      );
    }

    // T-034b: status-CAS write.
    const affected = await this.planRepo.updateStatusCas(
      manager,
      plan.id,
      tenantId,
      plan.status,
      {
        status: PlanStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedById: rejectorId,
        rejectionReason: reason,
        updatedBy: rejectorId,
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

    // Create history entry
    await this.createHistoryEntry(
      plan.id,
      tenantId,
      rejectorId,
      ApprovalHistoryAction.REJECTED,
      comments,
      reason,
      undefined,
      undefined,
      manager,
    );

    return {
      success: true,
      planId: plan.id,
      newStatus: PlanStatus.REJECTED,
      message: 'Plan rejected',
    };
  }

  /**
   * Request changes (return to draft). `plan`/`manager` — see
   * `approvePlan`'s header comment.
   */
  private async requestChanges(
    plan: Plan,
    tenantId: string,
    reviewerId: string,
    comments: string,
    specificChanges: string[] | undefined,
    manager: EntityManager,
  ): Promise<ReviewResult> {
    // Release reserved budget
    await this.releaseBudgetForPlan(
      plan.id,
      tenantId,
      reviewerId,
      'REQUEST_CHANGES',
      manager,
    );

    // T-034b: status-CAS write.
    const affected = await this.planRepo.updateStatusCas(
      manager,
      plan.id,
      tenantId,
      plan.status,
      {
        status: PlanStatus.DRAFT,
        comments: comments,
        updatedBy: reviewerId,
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

    // Create history entry
    await this.createHistoryEntry(
      plan.id,
      tenantId,
      reviewerId,
      ApprovalHistoryAction.REQUEST_CHANGES,
      comments,
      undefined,
      specificChanges,
      undefined,
      manager,
    );

    return {
      success: true,
      planId: plan.id,
      newStatus: PlanStatus.DRAFT,
      message: 'Plan returned to draft for changes',
    };
  }

  /**
   * Escalate to Finance Manager. T-034b: real transaction + `FOR UPDATE` +
   * status-CAS — same treatment as approve/reject/requestChanges, even
   * though this transition does not move money: it still races with
   * approve/reject (two reviewers deciding on the same plan concurrently),
   * and the status write + history entry must stay atomic.
   */
  async escalateToFinance(
    planId: string,
    tenantId: string,
    escalatedById: string,
    reason: string,
    comments?: string,
    actor?: PlanActor,
  ): Promise<void> {
    // Pre-transaction: 404 + CM scope check (categoryId is immutable once a
    // plan exists — safe to check pre-lock).
    const initial = await this.planRepo.findById(planId, tenantId);
    if (!initial) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }
    if (actor?.role === UserRole.CATEGORY_MANAGER) {
      const scope = await this.accessScope.resolveScope(
        tenantId,
        actor.userId,
        actor.role,
      );
      this.accessScope.assertEntityInScope(scope, {
        categoryId: initial.categoryId,
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const plan = await this.planRepo.findByIdForUpdate(
        planId,
        tenantId,
        queryRunner.manager,
      );
      if (!plan) {
        throw new NotFoundException(`Plan with ID ${planId} not found`);
      }
      if (plan.status !== PlanStatus.PENDING_APPROVAL) {
        throw new BadRequestException(
          'Only PENDING_APPROVAL plans can be escalated',
        );
      }

      const affected = await this.planRepo.updateStatusCas(
        queryRunner.manager,
        plan.id,
        tenantId,
        PlanStatus.PENDING_APPROVAL,
        {
          status: PlanStatus.PENDING_FINANCE_REVIEW,
          pendingFinanceReview: true,
          escalationReason: reason,
          escalatedAt: new Date(),
          escalatedById: escalatedById,
          comments: comments,
          updatedBy: escalatedById,
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

      await this.createHistoryEntry(
        plan.id,
        tenantId,
        escalatedById,
        ApprovalHistoryAction.ESCALATED,
        comments,
        undefined,
        undefined,
        reason,
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get approval queue for a user
   */
  async getApprovalQueue(
    userId: string,
    tenantId: string,
    filters: ApprovalFilters = {},
    role?: UserRole,
  ): Promise<PendingPlan[]> {
    // F3 fix (docs/analysis/0004-rbac-brd-alignment.md §1/§3): PENDING_APPROVAL
    // AND kategori kesişimi for CATEGORY_MANAGER (was previously unfiltered —
    // any CM saw the entire tenant's queue). Other roles unaffected (scope
    // resolves to undefined -> PlanRepository#findAll no-ops the filter).
    const scope =
      role === UserRole.CATEGORY_MANAGER
        ? await this.accessScope.resolveScope(tenantId, userId, role)
        : undefined;

    const statusFilter =
      filters.status && filters.status.length > 0
        ? filters.status
        : [PlanStatus.PENDING_APPROVAL, PlanStatus.PENDING_FINANCE_REVIEW];

    const allPlans: Plan[] = [];
    const seenPlanIds = new Set<string>();
    for (const status of statusFilter) {
      const plans = await this.planRepo.findAll(
        tenantId,
        {
          status: status as PlanStatus,
          ...(filters.categoryId && { categoryId: filters.categoryId }),
          ...(filters.channelId && { channelId: filters.channelId }),
          ...(filters.cplId && { cplId: filters.cplId }),
        },
        scope,
      );
      // Filter out duplicates (in case a plan appears in multiple status searches)
      for (const plan of plans) {
        if (!seenPlanIds.has(plan.id)) {
          seenPlanIds.add(plan.id);
          allPlans.push(plan);
        }
      }
    }

    const pendingPlans: PendingPlan[] = [];

    for (const plan of allPlans) {
      if (!plan.submittedAt) continue;

      const daysInQueue = Math.floor(
        (Date.now() - plan.submittedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      pendingPlans.push({
        id: plan.id,
        planCode: plan.planCode,
        planName: plan.planName,
        status: plan.status,
        category: {
          id: plan.category.id,
          name: plan.category.name,
          code: plan.category.code,
        },
        channel: {
          id: plan.channel.id,
          name: plan.channel.name,
          code: plan.channel.code,
        },
        cpl: {
          id: plan.cpl.id,
          name: plan.cpl.name,
          code: plan.cpl.code,
        },
        periodMonth: plan.periodMonth,
        totalSpend: Number(plan.totalSpend),
        onInvoiceSpend: Number(plan.onInvoiceSpend || 0),
        offInvoiceSpend: Number(plan.offInvoiceSpend || 0),
        overallRoi: plan.overallRoi ? Number(plan.overallRoi) : undefined,
        ragStatus: plan.ragStatus ?? undefined,
        submittedAt: plan.submittedAt,
        submittedBy: {
          id: plan.submittedBy?.id || '',
          name: plan.submittedBy?.fullName || '',
          email: plan.submittedBy?.email || '',
        },
        daysInQueue,
        pendingFinanceReview: plan.pendingFinanceReview,
      });
    }

    return pendingPlans;
  }

  /**
   * Get plan approval history
   */
  async getPlanApprovalHistory(
    planId: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<PlanApprovalHistory[]> {
    // T-028b (CM) / T-028c (PLANNER, generalized): scope-aware read —
    // kapsam dışı plan -> 404 (varlık sızdırma yok, §3/§5 tablosu
    // "approval-history: R(c)/R(s) — kategori/CPL-scoped okuma").
    if (actor) {
      const plan = await this.planRepo.findById(planId, tenantId);
      if (!plan) {
        throw new NotFoundException(`Plan with ID ${planId} not found`);
      }
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
          message: `Plan with ID ${planId} not found`,
          code: 'OUT_OF_SCOPE',
        });
      }
    }

    return this.approvalHistoryRepo.find({
      where: { planId, tenantId },
      relations: ['actionedBy'],
      order: { createdAt: 'ASC' },
    });
  }

  // Private helper methods

  /**
   * T-017: Delegates on/off-invoice spend breakdown to SpendCalculationService.
   * Eliminates `tacticCode.includes(...)` string-hack (BRD violation).
   * Classification is now driven by Mechanic.category (ON_INVOICE_DISCOUNT /
   * OFF_INVOICE_DISCOUNT / PER_UNIT_SUPPORT / LUMPSUM_SPEND) via SpendCalc.
   *
   * FUs with no mechanics/tactics will return zero spend from SpendCalc
   * (planMechanicValues empty → all enteredValues = 0 → no spend calculated).
   */
  private async calculateSpendBreakdown(
    plan: Plan,
    tenantId: string,
  ): Promise<{ onInvoice: number; offInvoice: number }> {
    let onInvoice = 0;
    let offInvoice = 0;

    for (const planFu of plan.planFus || []) {
      try {
        const fuBreakdown = await this.spendCalc.calculateAllSpendsForFU(
          tenantId,
          planFu.id,
        );
        onInvoice += fuBreakdown?.aggregatedPlanned?.totalOnInvoice ?? 0;
        offInvoice += fuBreakdown?.aggregatedPlanned?.totalOffInvoice ?? 0;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `calculateSpendBreakdown failed for FU [fuId=${planFu.id}, planId=${plan.id}]: ${message}`,
        );
        throw new InternalServerErrorException(
          `Spend calculation failed for FU ${planFu.id}: ${message}`,
        );
      }
    }

    return { onInvoice, offInvoice };
  }

  /**
   * T-019b (Faz 2, docs/analysis/0008 §5.5, ADR 0004 Karar 2 kapsam
   * netleştirmesi 2026-08-02): ON and OFF envelopes are resolved
   * INDEPENDENTLY (`BudgetService#findEnvelopeByDimensions` with an
   * explicit `spendType` — typed match preferred, UNSPLIT/NULL envelope as
   * fallback, §5.1).
   *
   * Two regimes:
   *  - UNSPLIT (legacy): both lookups fall back to the SAME envelope
   *    (`onEnvelope.id === offEnvelope.id`) — the two requested amounts
   *    share ONE pool, so they must be measured TOGETHER
   *    (`on + off <= available`), not independently (§5.5 "birleşik kural",
   *    R3: two amounts that individually fit can together overshoot).
   *  - SPLIT: each type has its OWN envelope/available — measured
   *    independently.
   *
   * Product-owner scope (ADR 0004 Karar 2 eki, 2026-08-02): the threshold
   * check only considers types the plan ACTUALLY spends. A zero amount for
   * a type is trivially sufficient regardless of that type's envelope state
   * (a plan that spends 0 off-invoice is never blocked by a full/over-spent
   * off-invoice envelope). When the plan spends BOTH types, Karar 2's
   * atomicity is unchanged: if either exceeds, the ENTIRE request is
   * rejected — no partial reservation (enforced by the caller checking
   * `overallSufficient` BEFORE either `reserveBudgetForPlan` call).
   *
   * Mimari kural (§5.7, bağlayıcı): this method only READS/compares
   * envelope availability — the on/off split of the plan's OWN spend was
   * already decided by `SpendCalculationService` (`calculateSpendBreakdown`
   * above); this method does not re-derive or override that decision.
   */
  private async checkBudgetAvailability(
    tenantId: string,
    channelCode: string,
    periodMonth: string,
    onInvoiceAmount: number,
    offInvoiceAmount: number,
  ): Promise<{
    onInvoice: { available: number; requested: number; sufficient: boolean };
    offInvoice: { available: number; requested: number; sufficient: boolean };
    overallSufficient: boolean;
  }> {
    const [onEnvelope, offEnvelope] = await Promise.all([
      this.budgetService.findEnvelopeByDimensions(
        tenantId,
        channelCode,
        periodMonth,
        undefined,
        BudgetSpendType.ON_INVOICE,
      ),
      this.budgetService.findEnvelopeByDimensions(
        tenantId,
        channelCode,
        periodMonth,
        undefined,
        BudgetSpendType.OFF_INVOICE,
      ),
    ]);

    const unsplitSharedEnvelope =
      !!onEnvelope && !!offEnvelope && onEnvelope.id === offEnvelope.id;

    let onAvailable = 0;
    let offAvailable = 0;
    let onSufficient = true;
    let offSufficient = true;
    let overallSufficient: boolean;

    if (unsplitSharedEnvelope) {
      // §5.5 birleşik kural — ONE pool, both amounts measured TOGETHER for
      // the GATE (`overallSufficient`). The per-leg `sufficient` flags below
      // stay INFORMATIONAL (does this amount alone fit the shared pool?) —
      // this is the pre-existing display contract (§7 T3: an on=60/off=60
      // request against a 100-available pool reports EACH leg sufficient
      // individually while the atomic combined gate still rejects the
      // request as a whole; a UI can show "on: OK, off: OK, but together:
      // insufficient").
      const combined = await this.budgetService.checkEnvelopeAvailability(
        tenantId,
        onEnvelope!.id,
        onInvoiceAmount + offInvoiceAmount,
      );
      onAvailable = combined.available;
      offAvailable = combined.available;
      onSufficient =
        onInvoiceAmount > 0 ? combined.available >= onInvoiceAmount : true;
      offSufficient =
        offInvoiceAmount > 0 ? combined.available >= offInvoiceAmount : true;
      overallSufficient = combined.sufficient;
    } else {
      if (onInvoiceAmount > 0) {
        if (!onEnvelope) {
          onAvailable = 0;
          onSufficient = false;
        } else {
          const r = await this.budgetService.checkEnvelopeAvailability(
            tenantId,
            onEnvelope.id,
            onInvoiceAmount,
          );
          onAvailable = r.available;
          onSufficient = r.sufficient;
        }
      } else if (onEnvelope) {
        onAvailable = (
          await this.budgetService.checkEnvelopeAvailability(
            tenantId,
            onEnvelope.id,
            0,
          )
        ).available;
      }

      if (offInvoiceAmount > 0) {
        if (!offEnvelope) {
          offAvailable = 0;
          offSufficient = false;
        } else {
          const r = await this.budgetService.checkEnvelopeAvailability(
            tenantId,
            offEnvelope.id,
            offInvoiceAmount,
          );
          offAvailable = r.available;
          offSufficient = r.sufficient;
        }
      } else if (offEnvelope) {
        offAvailable = (
          await this.budgetService.checkEnvelopeAvailability(
            tenantId,
            offEnvelope.id,
            0,
          )
        ).available;
      }
      // SPLIT regime: each type has its own envelope — the atomic gate IS
      // the per-leg sufficiency (Karar 2: reject entirely if either
      // actually-spent type exceeds its OWN envelope).
      overallSufficient = onSufficient && offSufficient;
    }

    return {
      onInvoice: {
        available: onAvailable,
        requested: onInvoiceAmount,
        sufficient: onSufficient,
      },
      offInvoice: {
        available: offAvailable,
        requested: offInvoiceAmount,
        sufficient: offSufficient,
      },
      overallSufficient,
    };
  }

  private async reserveBudgetForPlan(
    planId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    spendType: 'ON_INVOICE' | 'OFF_INVOICE',
    manager?: EntityManager,
  ): Promise<void> {
    // T-048 FIX (was): `spendType` used to be silently dropped here — the
    // comment claimed "with metadata to track On/Off Invoice" but no
    // metadata was ever passed, so both the ON_INVOICE and OFF_INVOICE
    // calls below landed in the SAME (envelope-only) idempotency/net bucket.
    // The second call then saw the first call's still-outstanding RESERVE,
    // treated itself as an idempotent no-op, and never wrote its own
    // RESERVE — off-invoice spend was silently never encumbered (see
    // docs/analysis/0008 §2.4 / T-048). Now forwarded so reserveForPlan can
    // do kova-farkındalı (bucket-aware) net/idempotency accounting.
    await this.budgetService.reserveForPlan(
      planId,
      amount,
      channel,
      periodMonth,
      currency,
      tenantId,
      userId,
      spendType,
      manager,
    );
  }

  private async commitAllBudgetForPlan(
    planId: string,
    fallbackAmount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    // T-029: Convert the outstanding RESERVE(s) (created at submitForApproval
    // OR at plan.service.ts#submit) into COMMIT(s) — actual budget
    // consumption on approval (BRD: Approved → COMMIT). T-019/T-048
    // cross-path fix: delegates to BudgetService#commitAllReservedForPlan,
    // which discovers and converts whichever bucket(s) (TOTAL, ON_INVOICE,
    // OFF_INVOICE) actually have an outstanding RESERVE, instead of this
    // caller blindly assuming ON/OFF buckets exist (see that method's JSDoc
    // for why a bucket-blind call double-encumbers a plan submitted via the
    // OTHER canonical route).
    await this.budgetService.commitAllReservedForPlan(
      planId,
      fallbackAmount,
      channel,
      periodMonth,
      currency,
      tenantId,
      userId,
      manager,
    );
  }

  private async releaseBudgetForPlan(
    planId: string,
    tenantId: string,
    userId: string,
    reason: PlanReservationReleaseReason = 'REJECT',
    manager?: EntityManager,
  ): Promise<void> {
    await this.budgetService.releaseForPlan(
      planId,
      tenantId,
      userId,
      reason,
      manager,
    );
  }

  private async createHistoryEntry(
    planId: string,
    tenantId: string,
    userId: string,
    action: ApprovalHistoryAction,
    comments?: string,
    rejectionReason?: string,
    specificChanges?: string[],
    escalationReason?: string,
    manager?: EntityManager,
  ): Promise<PlanApprovalHistory> {
    // T-034b: see plan.service.ts#createHistoryEntry — same rationale.
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
      specificChanges,
      escalationReason,
    });

    return repo.save(history);
  }
}
