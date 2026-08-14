import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, IsNull } from 'typeorm';
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
    // T-096/2: needed to put a balance write and its transaction log inside ONE
    // transaction. See the block comment on `createTransaction`.
    private readonly dataSource: DataSource,
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

    // T-096/2: balance write + log in ONE transaction — see reserveBudget.
    const saved = await this.dataSource.transaction(async (m) => {
      const row = await m.getRepository(BudgetAllocation).save(allocation);
      await this.createTransaction(
        tenantId,
        userId,
        row.id,
        BudgetTransactionType.ALLOCATION,
        dto.onInvoiceBudget,
        dto.offInvoiceBudget,
        null,
        'Initial budget allocation',
        undefined,
        m,
      );
      return row;
    });

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

    // T-096/2: balance write + logs in ONE transaction — see reserveBudget.
    //
    // T-096/3: the save now runs BEFORE the ADJUSTMENT logs, matching the other
    // five methods. It used to run last.
    //
    // Inside a transaction this is behaviourally neutral — either everything
    // lands or nothing does, in any order — and that neutrality is the whole
    // evidence for this change: no test moved. It is corrected anyway for two
    // reasons. A log records something that HAS happened; writing it before the
    // thing happens is backwards on its own terms. And one method doing the
    // same job in the opposite order is the small-scale form of §7 — a reader
    // who notices the difference has to stop and look for a reason that does not
    // exist. If a later refactor ever lifts these out of the transaction, the
    // wrong order becomes a real defect again.
    return this.dataSource.transaction(async (m) => {
      // Apply the field changes, capturing what each one adjusts.
      const adjustments: Array<{
        onInvoice: number;
        offInvoice: number;
        label: string;
      }> = [];

      if (dto.onInvoiceBudget !== undefined) {
        const adjustment = dto.onInvoiceBudget - allocation.onInvoiceBudget;
        allocation.onInvoiceBudget = dto.onInvoiceBudget;
        if (adjustment !== 0) {
          adjustments.push({
            onInvoice: adjustment,
            offInvoice: 0,
            label: `On-invoice budget adjustment: ${adjustment > 0 ? '+' : ''}${adjustment}`,
          });
        }
      }

      if (dto.offInvoiceBudget !== undefined) {
        const adjustment = dto.offInvoiceBudget - allocation.offInvoiceBudget;
        allocation.offInvoiceBudget = dto.offInvoiceBudget;
        if (adjustment !== 0) {
          adjustments.push({
            onInvoice: 0,
            offInvoice: adjustment,
            label: `Off-invoice budget adjustment: ${adjustment > 0 ? '+' : ''}${adjustment}`,
          });
        }
      }

      const saved = await this.applyAllocationSettings(
        allocation,
        dto,
        userId,
        m,
      );

      for (const a of adjustments) {
        await this.createTransaction(
          tenantId,
          userId,
          allocation.id,
          BudgetTransactionType.ADJUSTMENT,
          a.onInvoice,
          a.offInvoice,
          null,
          a.label,
          undefined,
          m,
        );
      }

      return saved;
    });
  }

  /** T-096/2: tail of `updateAllocation`, extracted so the transaction body stays readable. */
  private async applyAllocationSettings(
    allocation: BudgetAllocation,
    dto: Partial<CreateBudgetAllocationDto>,
    userId: string,
    m: EntityManager,
  ): Promise<BudgetAllocation> {
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
    return m.getRepository(BudgetAllocation).save(allocation);
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
    // T-096/2: the balance write and its log are ONE transaction. Before this,
    // the balance persisted and the log write could still fail — money moved,
    // nothing recorded it, and the caller got a 500 saying nothing happened.
    // ADR 0003 settled the same question for agreement reservations.
    allocation.onInvoiceReserved += amounts.planned.totalOnInvoice;
    allocation.offInvoiceReserved += amounts.planned.totalOffInvoice;
    const idempotencyKey = `RESERVE|PLAN|${planId}|${allocation.id}`;
    await this.dataSource.transaction(async (m) => {
      await m.getRepository(BudgetAllocation).save(allocation);
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
        m,
      );
    });

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
    // `reservation.*` (budget_transaction_logs) carried none and arrived as
    // STRINGS at the time this was written. That mismatch made the two lines
    // below behave differently despite looking identical:
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
    //
    // T-197/T-221 ikinci yarı (2026-08-14): `budget_transaction_logs.on_invoice_amount`/
    // `off_invoice_amount` now carry MoneyTransformer too (`BudgetTransactionLog`
    // entity), so `reservation.*` arrives as a NUMBER as well. This wrapping is no
    // longer load-bearing for that reason, but it is left in place: `String(number)`
    // round-trips cleanly through `moneyFromNumericString` (verified —
    // `decimalPlaces`-style digit-wise parse handles both `"100"` and `"100.00"`),
    // so removing it would only be a cosmetic simplification, not a correctness
    // fix, and touching it is out of this task's scope (entity-level only).
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

    // T-096/2: balance write + log in ONE transaction — see reserveBudget.
    const idempotencyKey = `COMMIT|PLAN|${planId}|${allocation.id}`;
    await this.dataSource.transaction(async (m) => {
      await m.getRepository(BudgetAllocation).save(allocation);
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
        m,
      );
    });

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
    // already correct historically (subtraction coerces a string numerically),
    // but they go through the same conversion so the file has ONE rule rather
    // than two — "correct by coincidence of the operator" is not a property
    // worth keeping.
    //
    // ⚠️ STALE PREMISE, CORRECTED (review, T-197/T-221, 2026-08-15):
    // `reservation.*` is no longer a string either way — see the note on
    // `commitBudget` above (`budget_transaction_logs.on/off_invoice_amount`
    // now carry `MoneyTransformer`). "Subtraction coerces the string" describes
    // what USED TO make this correct, not what makes it correct today; the
    // conversion is kept for the same reason as `commitBudget`'s — removing it
    // would only be a cosmetic simplification, out of this task's scope.
    allocation.onInvoiceReserved -= moneyToMajorUnits(
      moneyFromNumericString(String(reservation.onInvoiceAmount)),
    );
    allocation.offInvoiceReserved -= moneyToMajorUnits(
      moneyFromNumericString(String(reservation.offInvoiceAmount)),
    );

    // T-096/2: balance write + log in ONE transaction — see reserveBudget.
    const idempotencyKey = `RELEASE|PLAN|${planId}|${allocation.id}`;
    await this.dataSource.transaction(async (m) => {
      await m.getRepository(BudgetAllocation).save(allocation);
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
        m,
      );
    });
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

    // T-096/2: balance write + log in ONE transaction — see reserveBudget.
    await this.dataSource.transaction(async (m) => {
      await m.getRepository(BudgetAllocation).save(allocation);
      await this.createTransaction(
        tenantId,
        userId,
        allocation.id,
        BudgetTransactionType.ADJUSTMENT,
        onInvoiceDiff,
        offInvoiceDiff,
        planId,
        `Budget adjustment for plan ${planId}: ${reason}`,
        undefined,
        m,
      );
    });
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
    /**
     * T-096/2: when supplied, the log row is written through the caller's open
     * transaction instead of the default connection.
     *
     * WHY THIS PARAMETER EXISTS AT ALL
     * Every caller here does the same two things: move money on the allocation,
     * then record what it did. Those were two independent writes. If the second
     * failed, the first stayed — the balance had moved and nothing recorded it,
     * while the caller received a 500 saying nothing had happened. That is
     * worse than a wrong number: the error message told the opposite of the
     * truth.
     *
     * ADR 0003 settled this exact question for agreement reservations ("RELEASE
     * must be written inside close()'s QueryRunner transaction — outside, it
     * would commit even when close rolled back"). The lesson had simply never
     * been applied here. `BudgetRepository` already takes `manager?` on five
     * methods for the same reason; this service just never used it.
     */
    manager?: EntityManager,
  ): Promise<BudgetTransactionLog> {
    const repo = manager
      ? manager.getRepository(BudgetTransactionLog)
      : this.budgetTransactionLogRepository;

    // T-095: read-before-write on the idempotency key, the same shape the other
    // three tables that carry this column already use (ledger.repository.ts:32,
    // agreement-transaction.repository.ts:42, on-invoice.repository.ts:115).
    // Making the fourth one different would repeat the pattern this task exists
    // to close: a later table quietly dropping a guarantee its siblings hold.
    //
    // THE TWO LAYERS DO DIFFERENT JOBS AND NEITHER REPLACES THE OTHER.
    // This read gives the normal path a clean answer — "already written, no-op"
    // — instead of a raw 23505 that every caller would have to catch. The
    // partial unique index (migration 1798) is the last line, for the race this
    // read cannot see: two writers can both read "absent" and both proceed.
    // They have separate tests and separate mutation proofs for that reason.
    //
    // Guarded by `if (idempotencyKey)` rather than run unconditionally: ALLOCATION
    // and ADJUSTMENT rows legitimately carry no key, and looking one up by
    // `undefined` would match arbitrary rows. That is also exactly why the index
    // is partial — the rule is about rows that carry a key, not about the column.
    if (idempotencyKey) {
      const existing = await repo.findOne({
        where: { idempotencyKey, tenantId, deletedAt: IsNull() },
      });
      if (existing) return existing;
    }

    const transaction = repo.create({
      tenantId,
      budgetAllocationId: allocationId,
      transactionType: type,
      onInvoiceAmount,
      offInvoiceAmount,
      planId: planId || undefined,
      description,
      idempotencyKey,
      createdBy: userId,
    });

    return repo.save(transaction);
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
