import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan, PlanStatus } from '../../../../database/entities/plan.entity';
import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from '../../../../database/entities/plan-approval-history.entity';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { BudgetService } from '../../../shared/budget/budget.service';
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
  ) {}

  /**
   * Pre-submission validation and submission
   */
  async submitForApproval(
    planId: string,
    tenantId: string,
    userId: string,
    dto: SubmitForApprovalDto,
  ): Promise<SubmissionResult> {
    const plan = await this.planRepo.findById(planId, tenantId);
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be submitted');
    }

    // Pre-submission validations
    const validationErrors: string[] = [];
    const warnings: string[] = [];

    // 1. Check required mechanics/tactics.
    // SpendCalculationService reads planMechanicValues (enteredValue) as its authoritative
    // source. Validation must use the same source to stay consistent: if no mechanic values
    // are entered, SpendCalc will return zero spend for that FU — an invalid plan.
    // We accept either planMechanicValues with at least one enteredValue, OR a non-empty
    // tactics JSONB (legacy/planning-first flow) so that both modes are covered.
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

    // Update plan status
    await this.planRepo.updateStatus(
      planId,
      tenantId,
      PlanStatus.PENDING_APPROVAL,
      {
        approvalRequestId: approvalRequest.id,
        submissionNotes: dto.submissionNotes,
        submittedAt: new Date(),
        submittedById: userId,
        onInvoiceSpend: spendBreakdown.onInvoice,
        offInvoiceSpend: spendBreakdown.offInvoice,
        updatedBy: userId,
      },
    );

    // Reserve budget (soft reservation - will be committed on approval)
    try {
      // Reserve On-Invoice budget
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
        );
      }

      // Reserve Off-Invoice budget
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
        );
      }
    } catch (error) {
      // If budget reservation fails, rollback plan status
      await this.planRepo.updateStatus(planId, tenantId, PlanStatus.DRAFT, {
        updatedBy: userId,
      });
      throw new BadRequestException(
        `Budget reservation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Create history entry.
    // NOTE: PlanRepository/BudgetService/approvalHistoryRepo do not currently share a
    // single QueryRunner/EntityManager, so this cannot be wrapped in a real DB
    // transaction without a broader refactor (tracked as an open point). To avoid
    // leaving the plan in a PENDING_APPROVAL "limbo" state (status updated + budget
    // reserved, but no audit trail and the client receiving a 500), we treat history
    // write failure as fatal and compensate: release the reserved budget and revert
    // the plan back to DRAFT before propagating the error to the client.
    try {
      await this.createHistoryEntry(
        planId,
        tenantId,
        userId,
        ApprovalHistoryAction.SUBMITTED,
        dto.submissionNotes,
      );
    } catch (error) {
      this.logger.error(
        `createHistoryEntry failed after status update + budget reservation for plan ${planId}; compensating (release budget, revert to DRAFT): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      try {
        await this.releaseBudgetForPlan(planId, tenantId, userId);
      } catch (releaseError) {
        this.logger.error(
          `Compensation failed: could not release budget for plan ${planId} after history write failure: ${
            releaseError instanceof Error
              ? releaseError.message
              : 'Unknown error'
          }`,
        );
      }
      // Consistent with the existing budget-reservation-failure rollback above:
      // revert status to DRAFT. approvalRequestId/submittedAt/submittedById are left
      // as-is (same as the existing rollback branch) — they get overwritten on the
      // next successful submitForApproval call.
      await this.planRepo.updateStatus(planId, tenantId, PlanStatus.DRAFT, {
        updatedBy: userId,
      });
      throw new InternalServerErrorException(
        'Failed to record approval history for plan submission; submission has been rolled back to DRAFT.',
      );
    }

    return {
      success: true,
      planId: plan.id,
      status: PlanStatus.PENDING_APPROVAL,
      budgetCheck: {
        ...budgetCheck,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
      approvalRequestId: approvalRequest.id,
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

    // Self-approval prevention
    if (plan.submittedById === reviewerId) {
      throw new ForbiddenException('You cannot review your own submission');
    }

    const channelCode = plan.channel?.code || '';

    switch (dto.decision) {
      case ReviewDecision.APPROVE:
        return await this.approvePlan(plan, tenantId, reviewerId, dto.comments);

      case ReviewDecision.REJECT:
        if (!dto.rejectionReason) {
          throw new BadRequestException('Rejection reason is required');
        }
        return await this.rejectPlan(
          plan,
          tenantId,
          reviewerId,
          dto.rejectionReason,
          dto.comments,
        );

      case ReviewDecision.REQUEST_CHANGES:
        if (!dto.comments) {
          throw new BadRequestException(
            'Comments are required when requesting changes',
          );
        }
        return await this.requestChanges(
          plan,
          tenantId,
          reviewerId,
          dto.comments,
          dto.specificChanges,
        );

      case ReviewDecision.ESCALATE:
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

      default:
        throw new BadRequestException(`Invalid decision: ${dto.decision}`);
    }
  }

  /**
   * Approve plan
   */
  private async approvePlan(
    plan: Plan,
    tenantId: string,
    approverId: string,
    comments?: string,
  ): Promise<ReviewResult> {
    const channelCode = plan.channel?.code || '';

    // Commit budget (reserved → utilized)
    try {
      // Commit On-Invoice budget
      if (plan.onInvoiceSpend > 0) {
        await this.commitBudgetForPlan(
          plan.id,
          plan.onInvoiceSpend,
          channelCode,
          plan.periodMonth,
          'TRY',
          tenantId,
          approverId,
          'ON_INVOICE',
        );
      }

      // Commit Off-Invoice budget
      if (plan.offInvoiceSpend > 0) {
        await this.commitBudgetForPlan(
          plan.id,
          plan.offInvoiceSpend,
          channelCode,
          plan.periodMonth,
          'TRY',
          tenantId,
          approverId,
          'OFF_INVOICE',
        );
      }
    } catch (error) {
      throw new BadRequestException(
        `Budget commit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Update approval request
    if (plan.approvalRequestId) {
      await this.approvalService.approve(
        plan.approvalRequestId,
        tenantId,
        approverId,
        { comments },
      );
    }

    // Update plan status
    await this.planRepo.updateStatus(plan.id, tenantId, PlanStatus.APPROVED, {
      approvedAt: new Date(),
      approvedById: approverId,
      updatedBy: approverId,
    });

    // Create history entry
    await this.createHistoryEntry(
      plan.id,
      tenantId,
      approverId,
      ApprovalHistoryAction.APPROVED,
      comments,
    );

    return {
      success: true,
      planId: plan.id,
      newStatus: PlanStatus.APPROVED,
      message: 'Plan approved successfully',
    };
  }

  /**
   * Reject plan
   */
  private async rejectPlan(
    plan: Plan,
    tenantId: string,
    rejectorId: string,
    reason: string,
    comments?: string,
  ): Promise<ReviewResult> {
    // Release reserved budget
    await this.releaseBudgetForPlan(plan.id, tenantId, rejectorId);

    // Update approval request
    if (plan.approvalRequestId) {
      await this.approvalService.reject(
        plan.approvalRequestId,
        tenantId,
        rejectorId,
        { reason },
      );
    }

    // Update plan status
    await this.planRepo.updateStatus(plan.id, tenantId, PlanStatus.REJECTED, {
      rejectedAt: new Date(),
      rejectedById: rejectorId,
      rejectionReason: reason,
      updatedBy: rejectorId,
    });

    // Create history entry
    await this.createHistoryEntry(
      plan.id,
      tenantId,
      rejectorId,
      ApprovalHistoryAction.REJECTED,
      comments,
      reason,
    );

    return {
      success: true,
      planId: plan.id,
      newStatus: PlanStatus.REJECTED,
      message: 'Plan rejected',
    };
  }

  /**
   * Request changes (return to draft)
   */
  private async requestChanges(
    plan: Plan,
    tenantId: string,
    reviewerId: string,
    comments: string,
    specificChanges?: string[],
  ): Promise<ReviewResult> {
    // Release reserved budget
    await this.releaseBudgetForPlan(plan.id, tenantId, reviewerId);

    // Update plan status to DRAFT
    await this.planRepo.updateStatus(plan.id, tenantId, PlanStatus.DRAFT, {
      comments: comments,
      updatedBy: reviewerId,
    });

    // Create history entry
    await this.createHistoryEntry(
      plan.id,
      tenantId,
      reviewerId,
      ApprovalHistoryAction.REQUEST_CHANGES,
      comments,
      undefined,
      specificChanges,
    );

    return {
      success: true,
      planId: plan.id,
      newStatus: PlanStatus.DRAFT,
      message: 'Plan returned to draft for changes',
    };
  }

  /**
   * Escalate to Finance Manager
   */
  async escalateToFinance(
    planId: string,
    tenantId: string,
    escalatedById: string,
    reason: string,
    comments?: string,
  ): Promise<void> {
    const plan = await this.planRepo.findById(planId, tenantId);
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    if (plan.status !== PlanStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL plans can be escalated',
      );
    }

    // Update plan status
    await this.planRepo.updateStatus(
      plan.id,
      tenantId,
      PlanStatus.PENDING_FINANCE_REVIEW,
      {
        pendingFinanceReview: true,
        escalationReason: reason,
        escalatedAt: new Date(),
        escalatedById: escalatedById,
        comments: comments,
        updatedBy: escalatedById,
      },
    );

    // Create history entry
    await this.createHistoryEntry(
      plan.id,
      tenantId,
      escalatedById,
      ApprovalHistoryAction.ESCALATED,
      comments,
      undefined,
      undefined,
      reason,
    );
  }

  /**
   * Get approval queue for a user
   */
  async getApprovalQueue(
    userId: string,
    tenantId: string,
    filters: ApprovalFilters = {},
  ): Promise<PendingPlan[]> {
    // TODO: Implement role-based filtering
    // For now, return all pending plans (both PENDING_APPROVAL and PENDING_FINANCE_REVIEW)
    const statusFilter =
      filters.status && filters.status.length > 0
        ? filters.status
        : [PlanStatus.PENDING_APPROVAL, PlanStatus.PENDING_FINANCE_REVIEW];

    const allPlans: Plan[] = [];
    const seenPlanIds = new Set<string>();
    for (const status of statusFilter) {
      const plans = await this.planRepo.findAll(tenantId, {
        status: status as PlanStatus,
        ...(filters.categoryId && { categoryId: filters.categoryId }),
        ...(filters.channelId && { channelId: filters.channelId }),
        ...(filters.cplId && { cplId: filters.cplId }),
      });
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
  ): Promise<PlanApprovalHistory[]> {
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
    // TODO: Implement separate On-Invoice and Off-Invoice budget envelopes
    // For now, use total budget
    const envelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      periodMonth,
    );

    if (!envelope) {
      return {
        onInvoice: {
          available: 0,
          requested: onInvoiceAmount,
          sufficient: false,
        },
        offInvoice: {
          available: 0,
          requested: offInvoiceAmount,
          sufficient: false,
        },
        overallSufficient: false,
      };
    }

    const budgetStatus = await this.budgetService.getBudgetStatus(
      tenantId,
      channelCode,
      undefined,
      periodMonth,
    );

    const totalRequested = onInvoiceAmount + offInvoiceAmount;
    const sufficient = budgetStatus.available >= totalRequested;

    return {
      onInvoice: {
        available: budgetStatus.available,
        requested: onInvoiceAmount,
        sufficient: budgetStatus.available >= onInvoiceAmount,
      },
      offInvoice: {
        available: budgetStatus.available,
        requested: offInvoiceAmount,
        sufficient: budgetStatus.available >= offInvoiceAmount,
      },
      overallSufficient: sufficient,
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
  ): Promise<void> {
    // Use existing reserveForPlan but with metadata to track On/Off Invoice
    await this.budgetService.reserveForPlan(
      planId,
      amount,
      channel,
      periodMonth,
      currency,
      tenantId,
      userId,
    );
  }

  private async commitBudgetForPlan(
    planId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    spendType: 'ON_INVOICE' | 'OFF_INVOICE',
  ): Promise<void> {
    // Budget commit: Convert RESERVE to COMMIT
    // For now, we use reserveForPlan which creates COMMIT transactions for plans
    // The actual commit happens when plan is approved (reserved budget becomes utilized)
    await this.budgetService.reserveForPlan(
      planId,
      amount,
      channel,
      periodMonth,
      currency,
      tenantId,
      userId,
    );
  }

  private async releaseBudgetForPlan(
    planId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await this.budgetService.releaseForPlan(planId, tenantId);
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
  ): Promise<PlanApprovalHistory> {
    const history = this.approvalHistoryRepo.create({
      planId,
      tenantId,
      actionedById: userId,
      action,
      comments,
      rejectionReason,
      specificChanges,
      escalationReason,
    });

    return this.approvalHistoryRepo.save(history);
  }
}
