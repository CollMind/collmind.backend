import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { BudgetRepository } from './budget.repository';
import { BudgetThresholdService } from './budget-threshold.service';
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
   * Reserve budget for an approved plan
   * Creates COMMIT transaction with idempotency
   * Automatically finds the matching envelope by dimensions
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
    // Check for existing COMMIT transaction for this plan (true idempotency)
    const existingReserveTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.PLAN,
        planId,
      );

    const existingReserve = existingReserveTransactions.find(
      (tx) =>
        tx.txType === BudgetTransactionType.COMMIT &&
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

    // Check availability using view
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

    // Generate idempotency key
    const idempotencyKey = `COMMIT|PLAN|${planId}|${envelope.id}`;

    // Create COMMIT transaction
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId: envelope.id,
      txType: BudgetTransactionType.COMMIT,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.PLAN,
      sourceId: planId,
      amount,
      currency: currency || 'TRY',
      idempotencyKey,
      description: `Budget commit for plan ${planId}`,
      createdBy: userId,
    });

    return transaction;
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
   * Release budget reservation when agreement is cancelled
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

  async releaseForPlan(planId: string, tenantId: string): Promise<void> {
    // Find all COMMIT transactions for this plan
    const transactions = await this.budgetRepository.findTransactionsBySource(
      tenantId,
      BudgetTransactionSourceType.PLAN,
      planId,
    );

    const commitTransactions = transactions.filter(
      (tx) =>
        tx.txType === BudgetTransactionType.COMMIT &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    // Release each COMMIT transaction
    for (const commitTx of commitTransactions) {
      const idempotencyKey = `RELEASE|PLAN|${planId}|${commitTx.envelopeId}`;

      // Check if already released (idempotency)
      const existing =
        await this.budgetRepository.findTransactionByIdempotencyKey(
          tenantId,
          idempotencyKey,
        );
      if (existing) {
        continue;
      }

      // Create RELEASE transaction
      await this.budgetRepository.createTransaction({
        tenantId,
        envelopeId: commitTx.envelopeId,
        txType: BudgetTransactionType.RELEASE,
        amount: commitTx.amount,
        currency: commitTx.currency,
        txStatus: BudgetTransactionStatus.POSTED,
        sourceType: BudgetTransactionSourceType.PLAN,
        sourceId: planId,
        idempotencyKey,
        description: `Budget release for deleted plan ${planId}`,
      });
    }
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
