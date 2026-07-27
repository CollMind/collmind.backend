import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { BudgetRepository } from './budget.repository';
import { BudgetThresholdService } from './budget-threshold.service';
import {
  BudgetReservationService,
  PlanReservationReleaseReason,
} from './budget-reservation.service';
import { UtilizationStatus } from '../finance-reporting/dto/budget-utilization.dto';
import { CreateBudgetEnvelopeDto } from './dto/create-budget-envelope.dto';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../../../database/entities/budget-envelope.entity';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
  BudgetTransactionSourceType,
} from '../../../database/entities/budget-transaction.entity';

@Injectable()
export class BudgetService {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly budgetThresholdService: BudgetThresholdService,
    private readonly budgetReservationService: BudgetReservationService,
  ) {}

  async createEnvelope(
    tenantId: string,
    createDto: CreateBudgetEnvelopeDto,
  ): Promise<BudgetEnvelope> {
    // Auto-generate code and name if not provided
    const channel = createDto.channel || 'UNKNOWN';
    const category = createDto.category || 'GENERAL';
    const period =
      createDto.period || `${createDto.fiscalYear}-${createDto.month || '01'}`;

    const code = createDto.code || `${channel}/${category}/${period}`;
    const name =
      createDto.name ||
      `${channel} ${category.replace('_', ' ')} ${period} Budget`;

    // Check if code already exists
    const existing = await this.budgetRepository.findEnvelopeByCode(
      tenantId,
      code,
    );
    if (existing) {
      throw new ConflictException(
        'Budget envelope with this code already exists',
      );
    }

    const envelope = await this.budgetRepository.createEnvelope({
      ...createDto,
      code,
      name,
      period,
      channel,
      category,
      tenantId,
      availableAmount: createDto.allocatedAmount,
      consumedAmount: 0,
      status: createDto.status || BudgetEnvelopeStatus.DRAFT,
    });

    return envelope;
  }

  async findAllEnvelopes(tenantId: string): Promise<BudgetEnvelope[]> {
    return this.budgetRepository.findAllEnvelopes(tenantId);
  }

  async findEnvelopeById(
    tenantId: string,
    id: string,
  ): Promise<BudgetEnvelope> {
    const envelope = await this.budgetRepository.findEnvelopeById(tenantId, id);
    if (!envelope) {
      throw new NotFoundException(`Budget envelope with ID ${id} not found`);
    }
    return envelope;
  }

  // Budget reservation (Event-Sourced: BudgetTransaction with RESERVE type)
  async reserveBudget(
    tenantId: string,
    userId: string,
    agreementId: string,
    envelopeId: string,
    amount: number,
    currency: string = 'TRY',
  ): Promise<BudgetTransaction> {
    // Get envelope with pessimistic lock (MC-001: Same envelope serialized)
    const envelope = await this.budgetRepository.findEnvelopeWithLock(
      tenantId,
      envelopeId,
    );

    if (!envelope) {
      throw new NotFoundException(
        `Budget envelope with ID ${envelopeId} not found`,
      );
    }

    if (envelope.status !== BudgetEnvelopeStatus.ACTIVE) {
      throw new BadRequestException('Budget envelope is not active');
    }

    // Check idempotency (prevent duplicate reservations)
    const idempotencyKey = `RESERVE|AGREEMENT|${agreementId}|${envelopeId}`;
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      throw new ConflictException(
        'Budget reservation already exists for this agreement',
      );
    }

    // Check available amount using v_budget_summary view (BRD-compliant)
    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelopeId,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget available. Available: ${available}, Requested: ${amount}`,
      );
    }

    // Create RESERVE transaction (event-sourced)
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId: envelope.id,
      txType: BudgetTransactionType.RESERVE,
      txStatus: BudgetTransactionStatus.POSTED, // Immediate posting
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementId,
      amount,
      currency,
      idempotencyKey,
      description: `Budget reservation for agreement ${agreementId}`,
      createdBy: userId,
    });

    return transaction;
  }

  // Release reserved budget (create RELEASE transaction)
  async releaseBudget(
    tenantId: string,
    userId: string,
    agreementId: string,
    envelopeId: string,
    amount: number,
    currency: string = 'TRY',
  ): Promise<BudgetTransaction> {
    // Check idempotency
    const idempotencyKey = `RELEASE|AGREEMENT|${agreementId}|${envelopeId}`;
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      throw new ConflictException(
        'Budget release already exists for this agreement',
      );
    }

    // Create RELEASE transaction
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId,
      txType: BudgetTransactionType.RELEASE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementId,
      amount,
      currency,
      idempotencyKey,
      description: `Budget release for agreement ${agreementId}`,
      createdBy: userId,
    });

    return transaction;
  }

  // Get reserved amount for envelope (computed from transactions)
  async getReservedAmount(
    tenantId: string,
    envelopeId: string,
  ): Promise<number> {
    return this.budgetRepository.getReservedAmount(tenantId, envelopeId);
  }

  // Get transactions by envelope
  async getTransactionsByEnvelope(
    tenantId: string,
    envelopeId: string,
    txType?: BudgetTransactionType,
  ): Promise<BudgetTransaction[]> {
    return this.budgetRepository.findTransactionsByEnvelope(
      tenantId,
      envelopeId,
      txType,
    );
  }

  // Get transactions by source (e.g., agreement)
  async getTransactionsBySource(
    tenantId: string,
    sourceType: BudgetTransactionSourceType,
    sourceId: string,
  ): Promise<BudgetTransaction[]> {
    return this.budgetRepository.findTransactionsBySource(
      tenantId,
      sourceType,
      sourceId,
    );
  }

  /**
   * Reserve budget for an approved agreement
   * Creates RESERVE transaction with idempotency
   * Automatically finds the matching envelope by dimensions
   */
  async reserveForAgreement(
    agreementId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
  ): Promise<BudgetTransaction> {
    // Check for existing RESERVE transaction for this agreement (true idempotency)
    // Idempotency key should be based on agreementId only, not envelope ID
    // This ensures that retrying with different envelope lookups doesn't create duplicate transactions
    const existingReserveTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.AGREEMENT,
        agreementId,
      );

    const existingReserve = existingReserveTransactions.find(
      (tx) =>
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    if (existingReserve) {
      // Return existing transaction - true idempotency regardless of envelope lookup result
      return existingReserve;
    }

    // Find matching envelope by dimensions
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
    );

    if (!envelope) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channel}, period: ${periodMonth}`,
      );
    }

    // Check availability using view
    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelope.id,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget. Available: ${available}, Requested: ${amount}`,
      );
    }

    // Create RESERVE transaction with idempotency key based on agreement only
    // Note: envelope ID is not included in idempotency key to ensure true idempotency
    // even if envelope lookup returns different results on retry
    const idempotencyKey = `RESERVE|AGREEMENT|${agreementId}`;

    // Double-check idempotency (defensive check)
    const existingByIdempotency =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existingByIdempotency) {
      return existingByIdempotency;
    }

    // Create RESERVE transaction
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId: envelope.id,
      txType: BudgetTransactionType.RESERVE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementId,
      amount,
      currency: currency || 'TRY', // Use agreement currency, default to TRY if not provided
      idempotencyKey,
      description: `Budget reservation for agreement ${agreementId}`,
      createdBy: userId,
    });

    return transaction;
  }

  /**
   * T-029: Reserve budget for a plan submitted for approval.
   * Creates a RESERVE transaction (BRD state machine: Pending Approval → RESERVE).
   * Idempotent per plan (any existing POSTED RESERVE for this plan is returned as-is).
   *
   * NOTE (pre-T-029 bug, fixed here): this method used to create a COMMIT
   * transaction regardless of plan state, which meant GET /envelopes/:id/reserved
   * (RESERVE-only) always read 0 for plan-driven reservations, and approval never
   * actually converted anything (submit and approve both silently no-op'd into
   * the same COMMIT). See commitReservedForPlan() for the Approved→COMMIT step.
   */
  async reserveForPlan(
    planId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
  ): Promise<BudgetTransaction> {
    // Idempotency: an outstanding POSTED RESERVE for this plan already exists.
    const existingTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.PLAN,
        planId,
      );

    const existingReserve = existingTransactions.find(
      (tx) =>
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    if (existingReserve) {
      return existingReserve;
    }

    // Find matching envelope by dimensions
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
    );

    if (!envelope) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channel}, period: ${periodMonth}`,
      );
    }

    // Check availability using view (accounts for existing RESERVE+COMMIT-RELEASE)
    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelope.id,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget. Available: ${available}, Required: ${amount}`,
      );
    }

    const idempotencyKey = `RESERVE|PLAN|${planId}|${envelope.id}`;

    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId: envelope.id,
      txType: BudgetTransactionType.RESERVE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.PLAN,
      sourceId: planId,
      amount,
      currency: currency || 'TRY',
      idempotencyKey,
      description: `Budget reservation for plan ${planId} (submitted for approval)`,
      createdBy: userId,
    });

    return transaction;
  }

  /**
   * T-029: Convert a plan's outstanding RESERVE into a COMMIT on approval
   * (BRD state machine: Approved → COMMIT, budget actually consumed/earmarked).
   *
   * If an outstanding POSTED RESERVE exists for the plan, this releases it
   * (idempotency key suffixed `|CONVERT`, distinct from the plain reject/cancel
   * release key so both can coexist in the audit trail without key collision)
   * and creates a COMMIT transaction of the same amount — net encumbrance on
   * the envelope is unchanged (see v_budget_summary: reserved_amount now sums
   * RESERVE+COMMIT-RELEASE, migration 1789000000000), it merely moves the plan
   * from the "reserved" bucket to the "committed" bucket.
   *
   * Idempotent: if a COMMIT already exists for this plan, it is returned as-is
   * (no double release/commit on repeated approve calls).
   *
   * Falls back to a fresh direct COMMIT (legacy behaviour, availability
   * re-checked) if no prior RESERVE exists — covers plans approved without
   * having gone through the reserving submit path.
   */
  async commitReservedForPlan(
    planId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
  ): Promise<BudgetTransaction> {
    const existingTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.PLAN,
        planId,
      );

    const existingCommit = existingTransactions.find(
      (tx) =>
        tx.txType === BudgetTransactionType.COMMIT &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );
    if (existingCommit) {
      return existingCommit;
    }

    const outstandingReserve = existingTransactions.find(
      (tx) =>
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    if (outstandingReserve) {
      const envelopeId = outstandingReserve.envelopeId;
      const commitAmount = Number(outstandingReserve.amount);

      // Release the RESERVE as part of the conversion (idempotent).
      const releaseKey = `RELEASE|PLAN|${planId}|${envelopeId}|CONVERT`;
      const existingConvertRelease =
        await this.budgetRepository.findTransactionByIdempotencyKey(
          tenantId,
          releaseKey,
        );
      if (!existingConvertRelease) {
        await this.budgetRepository.createTransaction({
          tenantId,
          envelopeId,
          txType: BudgetTransactionType.RELEASE,
          txStatus: BudgetTransactionStatus.POSTED,
          sourceType: BudgetTransactionSourceType.PLAN,
          sourceId: planId,
          amount: commitAmount,
          currency: outstandingReserve.currency,
          idempotencyKey: releaseKey,
          description: `Release RESERVE (converted to COMMIT on approval) for plan ${planId}`,
          createdBy: userId,
        });
      }

      const commitKey = `COMMIT|PLAN|${planId}|${envelopeId}`;
      return this.budgetRepository.createTransaction({
        tenantId,
        envelopeId,
        txType: BudgetTransactionType.COMMIT,
        txStatus: BudgetTransactionStatus.POSTED,
        sourceType: BudgetTransactionSourceType.PLAN,
        sourceId: planId,
        amount: commitAmount,
        currency: outstandingReserve.currency,
        idempotencyKey: commitKey,
        description: `Budget commit for plan ${planId} (converted from RESERVE on approval)`,
        createdBy: userId,
      });
    }

    // Fallback: no prior RESERVE — commit directly (legacy / plan approved
    // without submit-for-approval reservation). Availability re-checked since
    // this is a fresh encumbrance, not a bucket transfer.
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
    );

    if (!envelope) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channel}, period: ${periodMonth}`,
      );
    }

    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelope.id,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget. Available: ${available}, Required: ${amount}`,
      );
    }

    const commitKey = `COMMIT|PLAN|${planId}|${envelope.id}`;
    return this.budgetRepository.createTransaction({
      tenantId,
      envelopeId: envelope.id,
      txType: BudgetTransactionType.COMMIT,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.PLAN,
      sourceId: planId,
      amount,
      currency: currency || 'TRY',
      idempotencyKey: commitKey,
      description: `Budget commit for plan ${planId}`,
      createdBy: userId,
    });
  }

  /**
   * Release budget spend for a reversed agreement transaction.
   *
   * Creates a RELEASE budget transaction scoped to the original agreementTransaction.
   * Idempotency key: 'REVERSAL|AGREEMENT|{transactionId}'
   *
   * Uses RELEASE type (no new enum value needed) to unwind spend from the envelope.
   * Callers must supply the envelopeId from the original ledger entry's budgetEnvelopeId.
   */
  async reverseForTransaction(
    agreementTransactionId: string,
    envelopeId: string,
    amount: number,
    currency: string,
    tenantId: string,
    userId: string,
  ): Promise<BudgetTransaction> {
    const idempotencyKey = `REVERSAL|AGREEMENT|${agreementTransactionId}`;

    // Idempotency check
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      return existing;
    }

    return this.budgetRepository.createTransaction({
      tenantId,
      envelopeId,
      txType: BudgetTransactionType.RELEASE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementTransactionId,
      amount: Math.abs(amount),
      currency: currency || 'TRY',
      idempotencyKey,
      description: `Budget release for reversed agreement transaction ${agreementTransactionId}`,
      createdBy: userId,
    });
  }

  /**
   * @deprecated T-030 — use BudgetReservationService.releaseAgreementReservation
   * instead. This method releases a caller-supplied `amount` against a
   * caller-supplied `envelopeId`, which is unsafe: callers historically
   * passed `agreement.capTotalAmount` (drifts from actual net reservation
   * if the cap was edited post-approval) and only the first RESERVE's
   * envelope (breaks for multi-envelope agreements, T-019). Kept only for
   * backward compatibility with any external callers; do not use in new code.
   */
  async releaseForAgreement(
    agreementId: string,
    envelopeId: string,
    amount: number,
    currency: string,
    tenantId: string,
    userId: string,
  ): Promise<BudgetTransaction> {
    const idempotencyKey = `RELEASE|AGREEMENT|${agreementId}|${envelopeId}`;

    // Check if already released (idempotency)
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      return existing;
    }

    // Create RELEASE transaction
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId,
      txType: BudgetTransactionType.RELEASE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementId,
      amount,
      currency: currency || 'TRY', // Use agreement currency, default to TRY if not provided
      idempotencyKey,
      description: `Budget release for cancelled agreement ${agreementId}`,
      createdBy: userId,
    });

    return transaction;
  }

  /**
   * T-029 (fixed by code-review, 2026-07-27): Release ALL outstanding budget
   * encumbrances for a plan — both RESERVE (Pending Approval rejected/
   * cancelled before approval) and COMMIT (Approved plan reverted/deleted).
   *
   * BUG FIXED (was): this method used to scan for POSTED RESERVE/COMMIT rows
   * by raw txType/txStatus and release each one found, with a per-type
   * idempotency key (`...|RESERVE`, `...|COMMIT`). That double-counted: when
   * a plan goes RESERVE → (approve) COMMIT, `commitReservedForPlan` already
   * releases the RESERVE as part of the conversion (key `...|CONVERT`) and
   * writes a COMMIT of the same amount — the original RESERVE row stays
   * POSTED forever (event-sourced ledger, rows are never mutated). The old
   * scan found that still-POSTED RESERVE again (under a *different* key,
   * `...|RESERVE`, so idempotency did not catch it) AND the COMMIT, releasing
   * both — net went negative (budget "refunded" twice). Real trigger: approve
   * succeeds, then the post-approve audit write fails and the compensation
   * path in `PlanService#approve` calls this method.
   *
   * FIX: delegate to `BudgetReservationService#releasePlanReservation`, which
   * computes the TRUE net (ΣRESERVE + ΣCOMMIT − ΣRELEASE, all prior RELEASEs
   * including CONVERT ones) per envelope and writes at most one RELEASE for
   * the residual — same net-based pattern already proven correct for
   * agreements (T-030). See that method's JSDoc for the full rationale;
   * kept as a single shared engine so this double-count bug class (already
   * seen once for agreements, F1/0003, and now for plans) cannot resurface
   * for a third source type without also being fixed here.
   */
  async releaseForPlan(
    planId: string,
    tenantId: string,
    userId?: string,
    reason: PlanReservationReleaseReason = 'REJECT',
  ): Promise<void> {
    await this.budgetReservationService.releasePlanReservation(
      planId,
      tenantId,
      userId,
      reason,
    );
  }

  /**
   * Find envelope by dimensions (exposed for use by other services)
   */
  async findEnvelopeByDimensions(
    tenantId: string,
    channel: string,
    periodMonth: string,
    category?: string,
  ): Promise<BudgetEnvelope | null> {
    return this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      category,
    );
  }

  /**
   * Get budget status for channel and category
   * Returns total allocation, available amount, and planned amount
   */
  async getBudgetStatus(
    tenantId: string,
    channel: string,
    categoryId?: string,
    periodMonth?: string,
  ): Promise<{
    totalAllocation: number;
    available: number;
    reserved: number;
    consumed: number;
    planned: number; // For current STA being created
    status: UtilizationStatus;
  }> {
    // Get current month if not provided
    if (!periodMonth) {
      const now = new Date();
      periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Fetch thresholds once (config-driven, tenant-scoped)
    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    // Find envelope by dimensions
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      categoryId,
    );

    if (!envelope) {
      return {
        totalAllocation: 0,
        available: 0,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: UtilizationStatus.GREEN,
      };
    }

    // Get budget summary
    const summary = await this.budgetRepository.getBudgetSummary(
      envelope.id,
      tenantId,
    );

    if (!summary) {
      return {
        totalAllocation: envelope.allocatedAmount,
        available: envelope.allocatedAmount,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: UtilizationStatus.GREEN,
      };
    }

    // Determine status based on usage (config-driven thresholds)
    const usagePercent =
      summary.allocatedAmount > 0
        ? ((summary.reservedAmount + summary.consumedAmount) /
            summary.allocatedAmount) *
          100
        : 0;

    return {
      totalAllocation: summary.allocatedAmount,
      available: summary.availableAmount,
      reserved: summary.reservedAmount,
      consumed: summary.consumedAmount,
      planned: 0, // Will be set by frontend for current STA
      status: this.budgetThresholdService.toStatus(usagePercent, thresholds),
    };
  }
}
