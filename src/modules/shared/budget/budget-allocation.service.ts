import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  BudgetAllocation,
  PeriodType,
} from '../../../database/entities/budget-allocation.entity';
import {
  BudgetTransactionLog,
  BudgetTransactionType,
} from '../../../database/entities/budget-transaction-log.entity';
import { CreateBudgetAllocationDto } from './dto/create-budget-allocation.dto';
import {
  BudgetCheckContext,
  AvailabilityResult,
} from './dto/budget-check-context.dto';
import {
  BudgetReportFilters,
  BudgetReport,
  ForecastContext,
  BudgetForecast,
} from './dto/budget-report.dto';
import { SpendBreakdown } from '../spend-calculation/dto/spend-breakdown.dto';
import { Plan } from '../../../database/entities/plan.entity';
import { BudgetThresholdService } from './budget-threshold.service';
import {
  moneyFromNumericString,
  moneyToMajorUnits,
} from '../../../common/numeric/money';

@Injectable()
export class BudgetAllocationService {
  private readonly logger = new Logger(BudgetAllocationService.name);

  constructor(
    @InjectRepository(BudgetAllocation)
    private readonly budgetAllocationRepository: Repository<BudgetAllocation>,
    @InjectRepository(BudgetTransactionLog)
    private readonly budgetTransactionLogRepository: Repository<BudgetTransactionLog>,
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    private readonly budgetThresholdService: BudgetThresholdService,
  ) {}

  /**
   * Create a new budget allocation
   */
  async createAllocation(
    tenantId: string,
    userId: string,
    dto: CreateBudgetAllocationDto,
  ): Promise<BudgetAllocation> {
    // Validate at least one dimension is specified
    if (!dto.cplId && !dto.channel && !dto.category) {
      throw new BadRequestException(
        'At least one dimension (CPL, Channel, or Category) must be specified',
      );
    }

    // Validate date range
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);

    if (periodEnd <= periodStart) {
      throw new BadRequestException('Period end must be after period start');
    }

    // Check for overlapping allocations
    const overlapping = await this.budgetAllocationRepository
      .createQueryBuilder('ba')
      .where('ba.tenantId = :tenantId', { tenantId })
      .andWhere('ba.periodType = :periodType', { periodType: dto.periodType })
      .andWhere('ba.fiscalYear = :fiscalYear', { fiscalYear: dto.fiscalYear })
      .andWhere(
        `(
          (ba.periodStart <= :periodStart AND ba.periodEnd >= :periodStart)
          OR
          (ba.periodStart <= :periodEnd AND ba.periodEnd >= :periodEnd)
          OR
          (ba.periodStart >= :periodStart AND ba.periodEnd <= :periodEnd)
        )`,
        { periodStart, periodEnd },
      )
      .andWhere(
        '(ba.cplId = :cplId OR (ba.cplId IS NULL AND :cplId IS NULL))',
        {
          cplId: dto.cplId || null,
        },
      )
      .andWhere(
        '(ba.channel = :channel OR (ba.channel IS NULL AND :channel IS NULL))',
        {
          channel: dto.channel || null,
        },
      )
      .andWhere(
        '(ba.category = :category OR (ba.category IS NULL AND :category IS NULL))',
        {
          category: dto.category || null,
        },
      )
      .andWhere('ba.deletedAt IS NULL')
      .getMany();

    if (overlapping.length > 0) {
      throw new ConflictException(
        'A budget allocation already exists for this CPL/Channel/Category/Period combination',
      );
    }

    // Create allocation
    const allocation = this.budgetAllocationRepository.create({
      tenantId,
      periodType: dto.periodType,
      periodStart,
      periodEnd,
      fiscalYear: dto.fiscalYear,
      cplId: dto.cplId,
      channel: dto.channel,
      category: dto.category,
      onInvoiceBudget: dto.onInvoiceBudget,
      offInvoiceBudget: dto.offInvoiceBudget,
      alertThreshold80: dto.alertThreshold80 ?? true,
      alertThreshold95: dto.alertThreshold95 ?? true,
      alertThreshold100: dto.alertThreshold100 ?? true,
      alertRecipients: dto.alertRecipients,
      hardLimitMode: dto.hardLimitMode ?? false,
      allowCarryForward: dto.allowCarryForward ?? false,
      createdBy: userId,
    });

    const saved = await this.budgetAllocationRepository.save(allocation);

    // Create initial ALLOCATION transaction
    await this.createTransaction(
      tenantId,
      userId,
      saved.id,
      BudgetTransactionType.ALLOCATION,
      dto.onInvoiceBudget,
      dto.offInvoiceBudget,
      null,
      'Initial budget allocation',
    );

    return saved;
  }

  /**
   * Update budget allocation
   */
  async updateAllocation(
    tenantId: string,
    userId: string,
    id: string,
    dto: Partial<CreateBudgetAllocationDto>,
  ): Promise<BudgetAllocation> {
    const allocation = await this.budgetAllocationRepository.findOne({
      where: { tenantId, id },
    });

    if (!allocation) {
      throw new NotFoundException(`Budget allocation with ID ${id} not found`);
    }

    // Check if utilized < current budget (can only increase if utilized < current)
    if (dto.onInvoiceBudget !== undefined) {
      if (
        dto.onInvoiceBudget <
        allocation.onInvoiceUtilized + allocation.onInvoiceReserved
      ) {
        throw new BadRequestException(
          `New on-invoice budget (${dto.onInvoiceBudget}) cannot be less than utilized + reserved (${allocation.onInvoiceUtilized + allocation.onInvoiceReserved})`,
        );
      }
    }

    if (dto.offInvoiceBudget !== undefined) {
      if (
        dto.offInvoiceBudget <
        allocation.offInvoiceUtilized + allocation.offInvoiceReserved
      ) {
        throw new BadRequestException(
          `New off-invoice budget (${dto.offInvoiceBudget}) cannot be less than utilized + reserved (${allocation.offInvoiceUtilized + allocation.offInvoiceReserved})`,
        );
      }
    }

    // Update fields
    if (dto.onInvoiceBudget !== undefined) {
      const adjustment = dto.onInvoiceBudget - allocation.onInvoiceBudget;
      allocation.onInvoiceBudget = dto.onInvoiceBudget;
      if (adjustment !== 0) {
        await this.createTransaction(
          tenantId,
          userId,
          allocation.id,
          BudgetTransactionType.ADJUSTMENT,
          adjustment,
          0,
          null,
          `On-invoice budget adjustment: ${adjustment > 0 ? '+' : ''}${adjustment}`,
        );
      }
    }

    if (dto.offInvoiceBudget !== undefined) {
      const adjustment = dto.offInvoiceBudget - allocation.offInvoiceBudget;
      allocation.offInvoiceBudget = dto.offInvoiceBudget;
      if (adjustment !== 0) {
        await this.createTransaction(
          tenantId,
          userId,
          allocation.id,
          BudgetTransactionType.ADJUSTMENT,
          0,
          adjustment,
          null,
          `Off-invoice budget adjustment: ${adjustment > 0 ? '+' : ''}${adjustment}`,
        );
      }
    }

    if (dto.alertThreshold80 !== undefined)
      allocation.alertThreshold80 = dto.alertThreshold80;
    if (dto.alertThreshold95 !== undefined)
      allocation.alertThreshold95 = dto.alertThreshold95;
    if (dto.alertThreshold100 !== undefined)
      allocation.alertThreshold100 = dto.alertThreshold100;
    if (dto.alertRecipients !== undefined)
      allocation.alertRecipients = dto.alertRecipients;
    if (dto.hardLimitMode !== undefined)
      allocation.hardLimitMode = dto.hardLimitMode;
    if (dto.allowCarryForward !== undefined)
      allocation.allowCarryForward = dto.allowCarryForward;

    allocation.updatedBy = userId;
    return this.budgetAllocationRepository.save(allocation);
  }

  /**
   * Check budget availability for a plan
   */
  async checkAvailability(
    tenantId: string,
    context: BudgetCheckContext,
  ): Promise<AvailabilityResult> {
    // Find matching budget allocation
    const allocation = await this.findMatchingAllocation(tenantId, context);

    if (!allocation) {
      return {
        onInvoiceAvailable: 0,
        offInvoiceAvailable: 0,
        onInvoiceSufficient: false,
        offInvoiceSufficient: false,
        onInvoiceShortfall: context.estimatedOnInvoiceSpend,
        offInvoiceShortfall: context.estimatedOffInvoiceSpend,
        suggestions: ['No budget allocation found for this context'],
      };
    }

    const onInvoiceAvailable = Number(allocation.onInvoiceAvailable) || 0;
    const offInvoiceAvailable = Number(allocation.offInvoiceAvailable) || 0;

    const onInvoiceSufficient =
      onInvoiceAvailable >= context.estimatedOnInvoiceSpend;
    const offInvoiceSufficient =
      offInvoiceAvailable >= context.estimatedOffInvoiceSpend;

    const onInvoiceShortfall = Math.max(
      0,
      context.estimatedOnInvoiceSpend - onInvoiceAvailable,
    );
    const offInvoiceShortfall = Math.max(
      0,
      context.estimatedOffInvoiceSpend - offInvoiceAvailable,
    );

    const suggestions: string[] = [];
    if (!onInvoiceSufficient) {
      const reduction = (
        (onInvoiceShortfall / context.estimatedOnInvoiceSpend) *
        100
      ).toFixed(1);
      suggestions.push(
        `Reduce On-Invoice spend by ${reduction}% to fit budget`,
      );
    }
    if (!offInvoiceSufficient) {
      const reduction = (
        (offInvoiceShortfall / context.estimatedOffInvoiceSpend) *
        100
      ).toFixed(1);
      suggestions.push(
        `Reduce Off-Invoice spend by ${reduction}% to fit budget`,
      );
    }

    return {
      onInvoiceAvailable,
      offInvoiceAvailable,
      onInvoiceSufficient,
      offInvoiceSufficient,
      onInvoiceShortfall,
      offInvoiceShortfall,
      suggestions,
      budgetAllocationId: allocation.id,
    };
  }

  /**
   * Reserve budget for a plan (pending approval)
   */
  async reserveBudget(
    tenantId: string,
    userId: string,
    planId: string,
    amounts: SpendBreakdown,
  ): Promise<void> {
    const plan = await this.planRepository.findOne({
      where: { tenantId, id: planId },
      relations: ['cpl', 'channel', 'category'],
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID ${planId} not found`);
    }

    // Find matching allocation
    const context: BudgetCheckContext = {
      cplId: plan.cplId || '',
      channel: plan.channel?.code || '',
      category: plan.category?.code || '',
      periodStart:
        plan.startDate?.toISOString().split('T')[0] ||
        new Date().toISOString().split('T')[0],
      periodEnd:
        plan.endDate?.toISOString().split('T')[0] ||
        new Date().toISOString().split('T')[0],
      estimatedOnInvoiceSpend: amounts.planned.totalOnInvoice,
      estimatedOffInvoiceSpend: amounts.planned.totalOffInvoice,
    };

    const allocation = await this.findMatchingAllocation(tenantId, context);

    if (!allocation) {
      throw new NotFoundException(
        'No budget allocation found for this plan context',
      );
    }

    // Check availability
    const availability = await this.checkAvailability(tenantId, context);
    if (
      !availability.onInvoiceSufficient ||
      !availability.offInvoiceSufficient
    ) {
      if (allocation.hardLimitMode) {
        throw new BadRequestException(
          `Insufficient budget. On-Invoice shortfall: ${availability.onInvoiceShortfall}, Off-Invoice shortfall: ${availability.offInvoiceShortfall}`,
        );
      } else {
        this.logger.warn(
          `Budget shortfall for plan ${planId}: On-Invoice ${availability.onInvoiceShortfall}, Off-Invoice ${availability.offInvoiceShortfall}`,
        );
      }
    }

    // Update reserved amounts
    allocation.onInvoiceReserved += amounts.planned.totalOnInvoice;
    allocation.offInvoiceReserved += amounts.planned.totalOffInvoice;
    await this.budgetAllocationRepository.save(allocation);

    // Create RESERVATION transaction
    const idempotencyKey = `RESERVE|PLAN|${planId}|${allocation.id}`;
    await this.createTransaction(
      tenantId,
      userId,
      allocation.id,
      BudgetTransactionType.RESERVATION,
      amounts.planned.totalOnInvoice,
      amounts.planned.totalOffInvoice,
      planId,
      `Budget reservation for plan ${planId}`,
      idempotencyKey,
    );

    // Schedule auto-release after 7 days (configurable)
    // This would be handled by a scheduled job/cron
  }

  /**
   * Commit budget (plan approved - reserved → utilized)
   */
  async commitBudget(
    tenantId: string,
    userId: string,
    planId: string,
  ): Promise<void> {
    // T-094: `tenantId` predicate. It was missing while the method HAD the
    // tenantId in hand and used it only when writing the audit row — the data
    // was there, the query just did not use it. SYSTEM_INVARIANTS INV-T-001
    // ("no financial query runs without a tenant_id predicate") was being
    // violated on a path that MOVES MONEY.
    //
    // Not defence in depth for its own sake: relying on the caller having
    // scoped `planId` is exactly the reasoning T-034 §1.5 rejected in
    // plan.repository.ts ("not a real defense layer on its own").
    const reservation = await this.budgetTransactionLogRepository.findOne({
      where: {
        tenantId,
        planId,
        transactionType: BudgetTransactionType.RESERVATION,
      },
      relations: ['budgetAllocation'],
    });

    if (!reservation) {
      throw new NotFoundException(
        `No budget reservation found for plan ${planId}`,
      );
    }

    const allocation = reservation.budgetAllocation;

    // T-091: ONE conversion per amount, shared by the `-=` and the `+=`.
    //
    // `allocation.*` carry a DecimalTransformer and arrive as NUMBERS.
    // `reservation.*` (budget_transaction_logs) carry none and arrive as
    // STRINGS. That mismatch made the two lines below behave differently
    // despite looking identical:
    //
    //   number - string  ->  numeric coercion   ->  `-=` was CORRECT
    //   number + string  ->  concatenation      ->  `+=` was BROKEN
    //
    //   utilized 500, amount "100.00"  ->  "500100.00"  ->  saved as 500100
    //                                                        (should be 600)
    //
    // And this one is written to disk: the `save()` below persists it, on the
    // plan-approval path, so every approval corrupted the envelope's utilised
    // figure and every later threshold check, sufficiency test and report read
    // the corrupted number. Measured: no rows exist yet, so nothing is damaged
    // today — the defect was latent, waiting for the first real approval.
    //
    // Why it hid so well: `-=` and `+=` sit on adjacent lines with the same
    // operands. A reader sees "same types, same operation" and moves on. The
    // asymmetry is invisible without knowing which side has a transformer.
    //
    // Converting ONCE and using the result for both operations is what makes
    // that asymmetry impossible to reintroduce.
    const committedOnInvoice = moneyToMajorUnits(
      moneyFromNumericString(String(reservation.onInvoiceAmount)),
    );
    const committedOffInvoice = moneyToMajorUnits(
      moneyFromNumericString(String(reservation.offInvoiceAmount)),
    );

    // Move reserved to utilized
    allocation.onInvoiceReserved -= committedOnInvoice;
    allocation.onInvoiceUtilized += committedOnInvoice;
    allocation.offInvoiceReserved -= committedOffInvoice;
    allocation.offInvoiceUtilized += committedOffInvoice;

    await this.budgetAllocationRepository.save(allocation);

    // Create COMMIT transaction
    const idempotencyKey = `COMMIT|PLAN|${planId}|${allocation.id}`;
    await this.createTransaction(
      tenantId,
      userId,
      allocation.id,
      BudgetTransactionType.COMMIT,
      reservation.onInvoiceAmount,
      reservation.offInvoiceAmount,
      planId,
      `Budget commit for approved plan ${planId}`,
      idempotencyKey,
    );

    // Check alert thresholds
    await this.checkAndSendAlerts(tenantId, allocation);
  }

  /**
   * Release reserved budget (plan rejected/withdrawn)
   */
  async releaseBudget(
    tenantId: string,
    userId: string,
    planId: string,
  ): Promise<void> {
    // T-094: see commitBudget above for why this predicate is required.
    const reservation = await this.budgetTransactionLogRepository.findOne({
      where: {
        tenantId,
        planId,
        transactionType: BudgetTransactionType.RESERVATION,
      },
      relations: ['budgetAllocation'],
    });

    if (!reservation) {
      this.logger.warn(
        `No budget reservation found for plan ${planId} to release`,
      );
      return;
    }

    const allocation = reservation.budgetAllocation;

    // Release reserved amounts. T-091: these two are `-=` and were therefore
    // already correct (subtraction coerces the string numerically), but they go
    // through the same conversion so the file has ONE rule rather than two —
    // "correct by coincidence of the operator" is not a property worth keeping.
    allocation.onInvoiceReserved -= moneyToMajorUnits(
      moneyFromNumericString(String(reservation.onInvoiceAmount)),
    );
    allocation.offInvoiceReserved -= moneyToMajorUnits(
      moneyFromNumericString(String(reservation.offInvoiceAmount)),
    );

    await this.budgetAllocationRepository.save(allocation);

    // Create RELEASE transaction
    const idempotencyKey = `RELEASE|PLAN|${planId}|${allocation.id}`;
    await this.createTransaction(
      tenantId,
      userId,
      allocation.id,
      BudgetTransactionType.RELEASE,
      -reservation.onInvoiceAmount,
      -reservation.offInvoiceAmount,
      planId,
      `Budget release for plan ${planId}`,
      idempotencyKey,
    );
  }

  /**
   * Adjust utilization (plan revised)
   */
  async adjustUtilization(
    tenantId: string,
    userId: string,
    planId: string,
    newAmounts: SpendBreakdown,
    reason: string,
  ): Promise<void> {
    // Find existing commit transaction
    // T-094: see commitBudget above. This one was NOT in the original report —
    // the review named commitBudget and releaseBudget; the sweep found a third.
    const existingCommit = await this.budgetTransactionLogRepository.findOne({
      where: {
        tenantId,
        planId,
        transactionType: BudgetTransactionType.COMMIT,
      },
      relations: ['budgetAllocation'],
    });

    if (!existingCommit) {
      throw new NotFoundException(
        `No committed budget found for plan ${planId}`,
      );
    }

    const allocation = existingCommit.budgetAllocation;

    // Calculate difference
    const onInvoiceDiff =
      newAmounts.planned.totalOnInvoice - existingCommit.onInvoiceAmount;
    const offInvoiceDiff =
      newAmounts.planned.totalOffInvoice - existingCommit.offInvoiceAmount;

    // Adjust utilization
    allocation.onInvoiceUtilized += onInvoiceDiff;
    allocation.offInvoiceUtilized += offInvoiceDiff;

    await this.budgetAllocationRepository.save(allocation);

    // Create ADJUSTMENT transaction
    await this.createTransaction(
      tenantId,
      userId,
      allocation.id,
      BudgetTransactionType.ADJUSTMENT,
      onInvoiceDiff,
      offInvoiceDiff,
      planId,
      `Budget adjustment for plan ${planId}: ${reason}`,
    );
  }

  /**
   * Get budget utilization report
   */
  async getBudgetUtilizationReport(
    tenantId: string,
    filters: BudgetReportFilters,
  ): Promise<BudgetReport> {
    const query = this.budgetAllocationRepository
      .createQueryBuilder('ba')
      .where('ba.tenantId = :tenantId', { tenantId })
      .andWhere('ba.deletedAt IS NULL');

    if (filters.periodType) {
      query.andWhere('ba.periodType = :periodType', {
        periodType: filters.periodType,
      });
    }
    if (filters.fiscalYear) {
      query.andWhere('ba.fiscalYear = :fiscalYear', {
        fiscalYear: filters.fiscalYear,
      });
    }
    if (filters.cplId) {
      query.andWhere('ba.cplId = :cplId', { cplId: filters.cplId });
    }
    if (filters.channel) {
      query.andWhere('ba.channel = :channel', { channel: filters.channel });
    }
    if (filters.category) {
      query.andWhere('ba.category = :category', { category: filters.category });
    }
    if (filters.periodStart && filters.periodEnd) {
      query.andWhere(
        'ba.periodStart >= :periodStart AND ba.periodEnd <= :periodEnd',
        {
          periodStart: filters.periodStart,
          periodEnd: filters.periodEnd,
        },
      );
    }

    const allocations = await query.getMany();

    // Aggregate breakdown
    const breakdown = allocations.reduce(
      (acc, alloc) => {
        const onBudget = Number(alloc.onInvoiceBudget) || 0;
        const offBudget = Number(alloc.offInvoiceBudget) || 0;
        const onUtilized = Number(alloc.onInvoiceUtilized) || 0;
        const offUtilized = Number(alloc.offInvoiceUtilized) || 0;
        const onReserved = Number(alloc.onInvoiceReserved) || 0;
        const offReserved = Number(alloc.offInvoiceReserved) || 0;

        acc.onInvoice.budget += onBudget;
        acc.onInvoice.utilized += onUtilized;
        acc.onInvoice.reserved += onReserved;
        acc.onInvoice.available += onBudget - onUtilized - onReserved;

        acc.offInvoice.budget += offBudget;
        acc.offInvoice.utilized += offUtilized;
        acc.offInvoice.reserved += offReserved;
        acc.offInvoice.available += offBudget - offUtilized - offReserved;

        return acc;
      },
      {
        onInvoice: {
          budget: 0,
          utilized: 0,
          reserved: 0,
          available: 0,
          utilizationPercent: 0,
        },
        offInvoice: {
          budget: 0,
          utilized: 0,
          reserved: 0,
          available: 0,
          utilizationPercent: 0,
        },
        total: {
          budget: 0,
          utilized: 0,
          reserved: 0,
          available: 0,
          utilizationPercent: 0,
        },
      },
    );

    breakdown.total.budget =
      breakdown.onInvoice.budget + breakdown.offInvoice.budget;
    breakdown.total.utilized =
      breakdown.onInvoice.utilized + breakdown.offInvoice.utilized;
    breakdown.total.reserved =
      breakdown.onInvoice.reserved + breakdown.offInvoice.reserved;
    breakdown.total.available =
      breakdown.onInvoice.available + breakdown.offInvoice.available;

    // Calculate utilization percentages
    breakdown.onInvoice.utilizationPercent =
      breakdown.onInvoice.budget > 0
        ? (breakdown.onInvoice.utilized / breakdown.onInvoice.budget) * 100
        : 0;
    breakdown.offInvoice.utilizationPercent =
      breakdown.offInvoice.budget > 0
        ? (breakdown.offInvoice.utilized / breakdown.offInvoice.budget) * 100
        : 0;
    breakdown.total.utilizationPercent =
      breakdown.total.budget > 0
        ? (breakdown.total.utilized / breakdown.total.budget) * 100
        : 0;

    // Get top consuming plans
    const topPlans = await this.budgetTransactionLogRepository
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.budgetAllocation', 'ba')
      .where('ba.tenantId = :tenantId', { tenantId })
      .andWhere('tx.transactionType = :type', {
        type: BudgetTransactionType.COMMIT,
      })
      .andWhere('tx.planId IS NOT NULL')
      .orderBy('tx.onInvoiceAmount + tx.offInvoiceAmount', 'DESC')
      .limit(10)
      .getMany();

    const topConsumingPlans = topPlans.map((tx) => ({
      planId: tx.planId || '',
      planName: `Plan ${tx.planId?.substring(0, 8)}`,
      onInvoiceSpend: Number(tx.onInvoiceAmount) || 0,
      offInvoiceSpend: Number(tx.offInvoiceAmount) || 0,
      totalSpend: Number(tx.onInvoiceAmount) + Number(tx.offInvoiceAmount),
    }));

    return {
      period: {
        type: filters.periodType || PeriodType.MONTHLY,
        start: filters.periodStart ? new Date(filters.periodStart) : new Date(),
        end: filters.periodEnd ? new Date(filters.periodEnd) : new Date(),
        fiscalYear: filters.fiscalYear || new Date().getFullYear(),
      },
      breakdown,
      topConsumingPlans,
    };
  }

  /**
   * Get budget forecast
   */
  async getForecastReport(
    tenantId: string,
    context: ForecastContext,
  ): Promise<BudgetForecast> {
    const allocation = await this.findMatchingAllocation(tenantId, {
      ...context,
      estimatedOnInvoiceSpend: 0,
      estimatedOffInvoiceSpend: 0,
    });

    if (!allocation) {
      throw new NotFoundException(
        'No budget allocation found for forecast context',
      );
    }

    // Get pending plans (reserved but not committed)
    const pendingReservations = await this.budgetTransactionLogRepository
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.budgetAllocation', 'ba')
      .where('ba.id = :allocationId', { allocationId: allocation.id })
      .andWhere('tx.transactionType = :type', {
        type: BudgetTransactionType.RESERVATION,
      })
      .andWhere('tx.planId IS NOT NULL')
      .getMany();

    const plannedSpend = pendingReservations.reduce(
      (acc, tx) => {
        acc.onInvoice += Number(tx.onInvoiceAmount) || 0;
        acc.offInvoice += Number(tx.offInvoiceAmount) || 0;
        acc.total += Number(tx.onInvoiceAmount) + Number(tx.offInvoiceAmount);
        return acc;
      },
      { onInvoice: 0, offInvoice: 0, total: 0 },
    );

    const forecastedRemaining = {
      onInvoice: Number(allocation.onInvoiceAvailable) - plannedSpend.onInvoice,
      offInvoice:
        Number(allocation.offInvoiceAvailable) - plannedSpend.offInvoice,
      total:
        Number(allocation.onInvoiceAvailable) +
        Number(allocation.offInvoiceAvailable) -
        plannedSpend.total,
    };

    // Estimate additional plans (simplified - average plan size)
    const avgPlanSize =
      pendingReservations.length > 0
        ? plannedSpend.total / pendingReservations.length
        : 10000; // Default estimate

    const estimatedAdditionalPlans = {
      onInvoice: Math.floor(forecastedRemaining.onInvoice / (avgPlanSize / 2)),
      offInvoice: Math.floor(
        forecastedRemaining.offInvoice / (avgPlanSize / 2),
      ),
      conservative: Math.floor(
        Math.min(
          forecastedRemaining.onInvoice,
          forecastedRemaining.offInvoice,
        ) / avgPlanSize,
      ),
    };

    // Budget at risk (RED status plans - would need plan status check)
    const budgetAtRisk = {
      onInvoice: 0,
      offInvoice: 0,
      total: 0,
      plans: [] as Array<{
        planId: string;
        planName: string;
        riskAmount: number;
      }>,
    };

    return {
      current: {
        onInvoice: {
          budget: Number(allocation.onInvoiceBudget),
          utilized: Number(allocation.onInvoiceUtilized),
          reserved: Number(allocation.onInvoiceReserved),
          available: Number(allocation.onInvoiceAvailable),
          utilizationPercent:
            Number(allocation.onInvoiceBudget) > 0
              ? (Number(allocation.onInvoiceUtilized) /
                  Number(allocation.onInvoiceBudget)) *
                100
              : 0,
        },
        offInvoice: {
          budget: Number(allocation.offInvoiceBudget),
          utilized: Number(allocation.offInvoiceUtilized),
          reserved: Number(allocation.offInvoiceReserved),
          available: Number(allocation.offInvoiceAvailable),
          utilizationPercent:
            Number(allocation.offInvoiceBudget) > 0
              ? (Number(allocation.offInvoiceUtilized) /
                  Number(allocation.offInvoiceBudget)) *
                100
              : 0,
        },
        total: {
          budget: Number(allocation.totalBudget),
          utilized:
            Number(allocation.onInvoiceUtilized) +
            Number(allocation.offInvoiceUtilized),
          reserved:
            Number(allocation.onInvoiceReserved) +
            Number(allocation.offInvoiceReserved),
          available:
            Number(allocation.onInvoiceAvailable) +
            Number(allocation.offInvoiceAvailable),
          utilizationPercent:
            Number(allocation.totalBudget) > 0
              ? ((Number(allocation.onInvoiceUtilized) +
                  Number(allocation.offInvoiceUtilized)) /
                  Number(allocation.totalBudget)) *
                100
              : 0,
        },
      },
      plannedSpend,
      forecastedRemaining,
      estimatedAdditionalPlans,
      budgetAtRisk,
    };
  }

  /**
   * Helper: Find matching budget allocation
   */
  private async findMatchingAllocation(
    tenantId: string,
    context: BudgetCheckContext,
  ): Promise<BudgetAllocation | null> {
    const periodStart = new Date(context.periodStart);
    const periodEnd = new Date(context.periodEnd);

    return this.budgetAllocationRepository
      .createQueryBuilder('ba')
      .where('ba.tenantId = :tenantId', { tenantId })
      .andWhere('ba.periodStart <= :periodEnd', { periodEnd })
      .andWhere('ba.periodEnd >= :periodStart', { periodStart })
      .andWhere('(ba.cplId = :cplId OR ba.cplId IS NULL)', {
        cplId: context.cplId || null,
      })
      .andWhere('(ba.channel = :channel OR ba.channel IS NULL)', {
        channel: context.channel || null,
      })
      .andWhere('(ba.category = :category OR ba.category IS NULL)', {
        category: context.category || null,
      })
      .andWhere('ba.deletedAt IS NULL')
      .orderBy('ba.periodStart', 'DESC')
      .getOne();
  }

  /**
   * Helper: Create transaction log
   */
  private async createTransaction(
    tenantId: string,
    userId: string,
    allocationId: string,
    type: BudgetTransactionType,
    onInvoiceAmount: number,
    offInvoiceAmount: number,
    planId: string | null,
    description: string,
    idempotencyKey?: string,
  ): Promise<BudgetTransactionLog> {
    const transaction = this.budgetTransactionLogRepository.create({
      tenantId,
      budgetAllocationId: allocationId,
      transactionType: type,
      onInvoiceAmount,
      offInvoiceAmount,
      planId: planId || undefined,
      description,
      idempotencyKey,
      createdById: userId,
    });

    return this.budgetTransactionLogRepository.save(transaction);
  }

  /**
   * Check and send alerts based on thresholds
   * alertThreshold80/95/100 on-off switches are preserved; actual percent values
   * come from config-driven BudgetThresholdService.
   */
  private async checkAndSendAlerts(
    tenantId: string,
    allocation: BudgetAllocation,
  ): Promise<void> {
    const onUtilizationPercent =
      Number(allocation.onInvoiceBudget) > 0
        ? (Number(allocation.onInvoiceUtilized) /
            Number(allocation.onInvoiceBudget)) *
          100
        : 0;
    const offUtilizationPercent =
      Number(allocation.offInvoiceBudget) > 0
        ? (Number(allocation.offInvoiceUtilized) /
            Number(allocation.offInvoiceBudget)) *
          100
        : 0;

    // Fetch thresholds once (tenant-scoped, cached)
    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    // Check warning threshold (alertThreshold80 switch preserved)
    if (
      allocation.alertThreshold80 &&
      (onUtilizationPercent >= thresholds.warning ||
        offUtilizationPercent >= thresholds.warning)
    ) {
      this.logger.warn(
        `Budget warning threshold (${thresholds.warning}%) reached for allocation ${allocation.id}. On: ${onUtilizationPercent.toFixed(1)}%, Off: ${offUtilizationPercent.toFixed(1)}%`,
      );
      // TODO: Send email to Finance Manager
    }

    // Check critical threshold (alertThreshold95 switch preserved)
    if (
      allocation.alertThreshold95 &&
      (onUtilizationPercent >= thresholds.critical ||
        offUtilizationPercent >= thresholds.critical)
    ) {
      this.logger.error(
        `Budget critical threshold (${thresholds.critical}%) reached for allocation ${allocation.id}. On: ${onUtilizationPercent.toFixed(1)}%, Off: ${offUtilizationPercent.toFixed(1)}%`,
      );
      // TODO: Send critical alert to Finance Manager + Category Manager
    }

    // Check exceeded threshold (alertThreshold100 switch preserved)
    if (
      allocation.alertThreshold100 &&
      (this.budgetThresholdService.isExceeded(
        onUtilizationPercent,
        thresholds,
      ) ||
        this.budgetThresholdService.isExceeded(
          offUtilizationPercent,
          thresholds,
        ))
    ) {
      this.logger.error(
        `Budget exceeded threshold (${thresholds.exceeded}%) for allocation ${allocation.id}. On: ${onUtilizationPercent.toFixed(1)}%, Off: ${offUtilizationPercent.toFixed(1)}%`,
      );
      // TODO: Send immediate alert + block plan submission if hard limit mode
    }
  }
}
