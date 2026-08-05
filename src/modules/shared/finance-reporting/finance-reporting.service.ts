import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, SelectQueryBuilder } from 'typeorm';
import { Plan, PlanStatus } from '../../../database/entities/plan.entity';
import { PlanFu, PlanSku } from '../../../database/entities/plan.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { BudgetAllocation } from '../../../database/entities/budget-allocation.entity';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../../../database/entities/budget-envelope.entity';
import { UserRole } from '../../../database/entities/user.entity';
import { BudgetAllocationService } from '../budget/budget-allocation.service';
import { BudgetRepository } from '../budget/budget.repository';
import {
  BudgetThresholdService,
  BudgetThresholds,
} from '../budget/budget-threshold.service';
import { AccessScopeService } from '../access-scope/access-scope.service';
import {
  ReportFilters,
  PaginationParams,
  ReportGranularity,
  ComparisonType,
} from './dto/report-filters.dto';
import {
  BudgetUtilizationReport,
  BudgetSummary,
  UtilizationStatus,
} from './dto/budget-utilization.dto';
import { TrendReport, TrendDataPoint } from './dto/trend-report.dto';
import {
  CompositionReport,
  CompositionSlice,
} from './dto/composition-report.dto';
import {
  PaginatedPlanReport,
  PlanPerformanceRow,
} from './dto/plan-performance.dto';
import { RiskReport, RiskPlan } from './dto/risk-report.dto';
import {
  MechanicReport,
  MechanicEffectiveness,
} from './dto/mechanic-effectiveness.dto';
import { VarianceReport, VarianceItem } from './dto/variance-report.dto';
import { CashFlowReport, CashFlowProjection } from './dto/cash-flow-report.dto';
import {
  BudgetVarianceReport,
  BudgetVarianceItem,
  BudgetVarianceGroup,
  BudgetVarianceQueryDto,
} from './dto/budget-variance-report.dto';
import {
  moneyFromNumericString,
  moneyToMajorUnits,
} from '../../../common/numeric/money';

/**
 * A `numeric(18,2)` column value as a number in TRY — T-093.
 *
 * These columns declare no transformer, so TypeORM hands back a STRING even
 * though TypeScript types them `number`. `0 + "100.00"` is concatenation, and
 * with two rows an accumulator became `"0100.0050.00"` — a string in a numeric
 * DTO field, on two live GET routes (`/finance-reporting/spend-trend` and
 * `/finance-reporting/budget-at-risk`). With a SINGLE row it worked by accident,
 * because `Number("0100.00")` is 100; the corruption needed a second row. Same
 * shape as T-089 and T-091.
 *
 * "This is Domain B so float is fine" does NOT excuse it. The Domain A/B split
 * is about representation PRECISION — `10.1799` where `10.18` was meant. A
 * concatenated string is not an imprecise number, it is not a number at all, and
 * Domain B expects numbers just as much as Domain A does.
 *
 * The `|| 0` that used to sit at each of these call sites is gone rather than
 * ported: all three columns are NOT NULL (measured), so it could never fire —
 * it was dead code in the shape CLAUDE.md §2.5 forbids, quietly promising a
 * default that no path could reach.
 *
 * Parsed via `moneyFromNumericString` rather than `Number()`: it reads the
 * decimal text digit-wise and throws on anything it cannot represent instead of
 * yielding a silent NaN. All three columns are scale 2 (measured), so it cannot
 * throw on legitimate data.
 */
function spendOf(raw: number | string): number {
  return moneyToMajorUnits(moneyFromNumericString(String(raw)));
}

@Injectable()
export class FinanceReportingService {
  private readonly logger = new Logger(FinanceReportingService.name);

  constructor(
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(PlanFu)
    private readonly planFuRepository: Repository<PlanFu>,
    @InjectRepository(PlanMechanicValue)
    private readonly planMechanicValueRepository: Repository<PlanMechanicValue>,
    @InjectRepository(MechanicSpendBreakdown)
    private readonly mechanicSpendBreakdownRepository: Repository<MechanicSpendBreakdown>,
    @InjectRepository(BudgetAllocation)
    private readonly budgetAllocationRepository: Repository<BudgetAllocation>,
    @InjectRepository(BudgetEnvelope)
    private readonly budgetEnvelopeRepository: Repository<BudgetEnvelope>,
    private readonly budgetAllocationService: BudgetAllocationService,
    private readonly budgetThresholdService: BudgetThresholdService,
    private readonly budgetRepository: BudgetRepository,
    private readonly accessScopeService: AccessScopeService,
  ) {}

  /**
   * Get budget utilization report
   */
  async getBudgetUtilization(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<BudgetUtilizationReport> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    // Fetch thresholds once outside any loop (config-driven, tenant-scoped)
    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    // Get budget allocations for the period
    const allocations = await this.budgetAllocationRepository.find({
      where: {
        tenantId,
        periodStart: Between(startDate, endDate),
        ...(filters.cplIds && filters.cplIds.length > 0
          ? { cplId: In(filters.cplIds) }
          : {}),
        ...(filters.channels && filters.channels.length > 0
          ? { channel: In(filters.channels) }
          : {}),
        ...(filters.categories && filters.categories.length > 0
          ? { category: In(filters.categories) }
          : {}),
      },
    });

    // Aggregate totals
    let totalOnInvoiceAllocated = 0;
    let totalOnInvoiceUtilized = 0;
    let totalOnInvoiceReserved = 0;
    let totalOffInvoiceAllocated = 0;
    let totalOffInvoiceUtilized = 0;
    let totalOffInvoiceReserved = 0;

    for (const allocation of allocations) {
      totalOnInvoiceAllocated += Number(allocation.onInvoiceBudget) || 0;
      totalOnInvoiceUtilized += Number(allocation.onInvoiceUtilized) || 0;
      totalOnInvoiceReserved += Number(allocation.onInvoiceReserved) || 0;
      totalOffInvoiceAllocated += Number(allocation.offInvoiceBudget) || 0;
      totalOffInvoiceUtilized += Number(allocation.offInvoiceUtilized) || 0;
      totalOffInvoiceReserved += Number(allocation.offInvoiceReserved) || 0;
    }

    const onInvoiceAvailable =
      totalOnInvoiceAllocated - totalOnInvoiceUtilized - totalOnInvoiceReserved;
    const offInvoiceAvailable =
      totalOffInvoiceAllocated -
      totalOffInvoiceUtilized -
      totalOffInvoiceReserved;
    const onInvoiceUtilizationPercent =
      totalOnInvoiceAllocated > 0
        ? ((totalOnInvoiceUtilized + totalOnInvoiceReserved) /
            totalOnInvoiceAllocated) *
          100
        : 0;
    const offInvoiceUtilizationPercent =
      totalOffInvoiceAllocated > 0
        ? ((totalOffInvoiceUtilized + totalOffInvoiceReserved) /
            totalOffInvoiceAllocated) *
          100
        : 0;

    const onInvoice: BudgetSummary = {
      allocated: totalOnInvoiceAllocated,
      utilized: totalOnInvoiceUtilized,
      reserved: totalOnInvoiceReserved,
      available: onInvoiceAvailable,
      utilizationPercent: onInvoiceUtilizationPercent,
      status: this.getUtilizationStatus(
        onInvoiceUtilizationPercent,
        thresholds,
      ),
    };

    const offInvoice: BudgetSummary = {
      allocated: totalOffInvoiceAllocated,
      utilized: totalOffInvoiceUtilized,
      reserved: totalOffInvoiceReserved,
      available: offInvoiceAvailable,
      utilizationPercent: offInvoiceUtilizationPercent,
      status: this.getUtilizationStatus(
        offInvoiceUtilizationPercent,
        thresholds,
      ),
    };

    const totalUtilizationPercent =
      totalOnInvoiceAllocated + totalOffInvoiceAllocated > 0
        ? ((totalOnInvoiceUtilized +
            totalOnInvoiceReserved +
            totalOffInvoiceUtilized +
            totalOffInvoiceReserved) /
            (totalOnInvoiceAllocated + totalOffInvoiceAllocated)) *
          100
        : 0;

    const total: BudgetSummary = {
      allocated: totalOnInvoiceAllocated + totalOffInvoiceAllocated,
      utilized: totalOnInvoiceUtilized + totalOffInvoiceUtilized,
      reserved: totalOnInvoiceReserved + totalOffInvoiceReserved,
      available: onInvoiceAvailable + offInvoiceAvailable,
      utilizationPercent: totalUtilizationPercent,
      status: this.getUtilizationStatus(totalUtilizationPercent, thresholds),
    };

    // Breakdown by dimensions (if requested)
    const byCpl =
      filters.cplIds && filters.cplIds.length > 0
        ? undefined
        : this.aggregateByCpl(allocations, thresholds);
    const byChannel =
      filters.channels && filters.channels.length > 0
        ? undefined
        : this.aggregateByChannel(allocations, thresholds);
    const byCategory =
      filters.categories && filters.categories.length > 0
        ? undefined
        : this.aggregateByCategory(allocations, thresholds);

    return {
      onInvoice,
      offInvoice,
      total,
      periodStart: startDate.toISOString().split('T')[0],
      periodEnd: endDate.toISOString().split('T')[0],
      byCpl,
      byChannel,
      byCategory,
    };
  }

  /**
   * Get spend trend report
   */
  async getSpendTrend(
    tenantId: string,
    filters: ReportFilters,
    granularity: ReportGranularity,
  ): Promise<TrendReport> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    // Get plans in the period
    const plans = await this.getFilteredPlans(tenantId, filters);

    // Group by granularity
    const dataPoints: TrendDataPoint[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const periodStart = new Date(currentDate);
      let periodEnd: Date;

      if (granularity === ReportGranularity.DAILY) {
        periodEnd = new Date(currentDate);
        periodEnd.setDate(periodEnd.getDate() + 1);
        currentDate.setDate(currentDate.getDate() + 1);
      } else if (granularity === ReportGranularity.WEEKLY) {
        periodEnd = new Date(currentDate);
        periodEnd.setDate(periodEnd.getDate() + 7);
        currentDate.setDate(currentDate.getDate() + 7);
      } else {
        // Monthly
        periodEnd = new Date(currentDate);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      // Calculate spends for this period
      const periodPlans = plans.filter(
        (p) =>
          new Date(p.startDate) < periodEnd &&
          new Date(p.endDate) >= periodStart,
      );

      let onInvoice = 0;
      let offInvoice = 0;
      let ltaOnInvoice = 0;
      let ltaOffInvoice = 0;
      let promoOnInvoice = 0;
      let promoOffInvoice = 0;

      for (const plan of periodPlans) {
        const planFus = await this.planFuRepository.find({
          where: { planId: plan.id },
          relations: [
            'planSkus',
            'planMechanicValues',
            'planMechanicValues.mechanic',
          ],
        });

        for (const planFu of planFus) {
          for (const pmv of planFu.planMechanicValues || []) {
            const mechanic = pmv.mechanic;
            if (!mechanic) continue;

            const spend = spendOf(pmv.calculatedSpend);
            if (mechanic.category === 'on_invoice_discount') {
              onInvoice += spend;
              promoOnInvoice += spend;
            } else {
              offInvoice += spend;
              promoOffInvoice += spend;
            }
          }

          // Add LTA spends from SKUs
          for (const planSku of planFu.planSkus || []) {
            const ltaOn = spendOf(planSku.plannedLtaOnInvoiceSpend);
            const ltaOff = spendOf(planSku.plannedLtaOffInvoiceSpend);
            ltaOnInvoice += ltaOn;
            ltaOffInvoice += ltaOff;
            onInvoice += ltaOn;
            offInvoice += ltaOff;
          }
        }
      }

      dataPoints.push({
        date: periodStart.toISOString().split('T')[0],
        onInvoice,
        offInvoice,
        total: onInvoice + offInvoice,
        ltaOnInvoice,
        ltaOffInvoice,
        promoOnInvoice,
        promoOffInvoice,
      });
    }

    const totalOnInvoice = dataPoints.reduce(
      (sum, dp) => sum + dp.onInvoice,
      0,
    );
    const totalOffInvoice = dataPoints.reduce(
      (sum, dp) => sum + dp.offInvoice,
      0,
    );
    const days = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const avgDailyOnInvoice = days > 0 ? totalOnInvoice / days : 0;
    const avgDailyOffInvoice = days > 0 ? totalOffInvoice / days : 0;

    return {
      granularity,
      dataPoints,
      totalOnInvoice,
      totalOffInvoice,
      avgDailyOnInvoice,
      avgDailyOffInvoice,
    };
  }

  /**
   * Get spend composition report
   */
  async getSpendComposition(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<CompositionReport> {
    const plans = await this.getFilteredPlans(tenantId, filters);

    const onInvoiceMap = new Map<
      string,
      { amount: number; planCount: number; totalRoi: number; roiCount: number }
    >();
    const offInvoiceMap = new Map<
      string,
      { amount: number; planCount: number; totalRoi: number; roiCount: number }
    >();

    for (const plan of plans) {
      const planFus = await this.planFuRepository.find({
        where: { planId: plan.id },
        relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
      });

      for (const planFu of planFus) {
        for (const pmv of planFu.planMechanicValues || []) {
          const mechanic = pmv.mechanic;
          if (!mechanic) continue;

          const spend = spendOf(pmv.calculatedSpend);
          const map =
            mechanic.category === 'on_invoice_discount'
              ? onInvoiceMap
              : offInvoiceMap;

          if (!map.has(mechanic.code)) {
            map.set(mechanic.code, {
              amount: 0,
              planCount: 0,
              totalRoi: 0,
              roiCount: 0,
            });
          }

          const entry = map.get(mechanic.code)!;
          entry.amount += spend;
          if (spend > 0) {
            entry.planCount += 1;
          }

          // Add ROI if available
          if (planFu.gpRoi) {
            entry.totalRoi += Number(planFu.gpRoi);
            entry.roiCount += 1;
          }
        }
      }
    }

    const totalOnInvoice = Array.from(onInvoiceMap.values()).reduce(
      (sum, e) => sum + e.amount,
      0,
    );
    const totalOffInvoice = Array.from(offInvoiceMap.values()).reduce(
      (sum, e) => sum + e.amount,
      0,
    );

    const onInvoice: CompositionSlice[] = Array.from(
      onInvoiceMap.entries(),
    ).map(([code, data]) => ({
      mechanicCode: code,
      mechanicName: code, // Will be resolved from mechanic entity
      amount: data.amount,
      percentage: totalOnInvoice > 0 ? (data.amount / totalOnInvoice) * 100 : 0,
      planCount: data.planCount,
      avgRoi: data.roiCount > 0 ? data.totalRoi / data.roiCount : undefined,
    }));

    const offInvoice: CompositionSlice[] = Array.from(
      offInvoiceMap.entries(),
    ).map(([code, data]) => ({
      mechanicCode: code,
      mechanicName: code,
      amount: data.amount,
      percentage:
        totalOffInvoice > 0 ? (data.amount / totalOffInvoice) * 100 : 0,
      planCount: data.planCount,
      avgRoi: data.roiCount > 0 ? data.totalRoi / data.roiCount : undefined,
    }));

    return {
      onInvoice,
      offInvoice,
      totalOnInvoice,
      totalOffInvoice,
    };
  }

  /**
   * Get plan performance report
   */
  async getPlanPerformance(
    tenantId: string,
    filters: ReportFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedPlanReport> {
    const query = this.planRepository
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .leftJoinAndSelect('plan.cpl', 'cpl')
      .leftJoinAndSelect('plan.channel', 'channel')
      .leftJoinAndSelect('plan.category', 'category');

    // Apply filters
    if (filters.startDate) {
      query.andWhere('plan.startDate >= :startDate', {
        startDate: filters.startDate,
      });
    }
    if (filters.endDate) {
      query.andWhere('plan.endDate <= :endDate', { endDate: filters.endDate });
    }
    if (filters.cplIds && filters.cplIds.length > 0) {
      query.andWhere('plan.cplId IN (:...cplIds)', { cplIds: filters.cplIds });
    }
    if (filters.channels && filters.channels.length > 0) {
      query.andWhere('plan.channel.code IN (:...channels)', {
        channels: filters.channels,
      });
    }
    if (filters.categories && filters.categories.length > 0) {
      query.andWhere('plan.category.code IN (:...categories)', {
        categories: filters.categories,
      });
    }
    if (filters.planStatuses && filters.planStatuses.length > 0) {
      query.andWhere('plan.status IN (:...statuses)', {
        statuses: filters.planStatuses,
      });
    }
    if (filters.ragStatuses && filters.ragStatuses.length > 0) {
      query.andWhere('plan.ragStatus IN (:...ragStatuses)', {
        ragStatuses: filters.ragStatuses,
      });
    }

    // Sorting
    if (pagination.sortBy) {
      const sortField =
        pagination.sortBy === 'planName'
          ? 'plan.planName'
          : `plan.${pagination.sortBy}`;
      query.orderBy(sortField, pagination.sortOrder || 'DESC');
    } else {
      query.orderBy('plan.createdAt', 'DESC');
    }

    // Pagination
    const page = pagination.page || 1;
    const limit = pagination.limit || 50;
    const skip = (page - 1) * limit;

    const [plans, total] = await query.skip(skip).take(limit).getManyAndCount();

    // Build rows
    const rows: PlanPerformanceRow[] = await Promise.all(
      plans.map(async (plan) => {
        const planFus = await this.planFuRepository.find({
          where: { planId: plan.id },
          relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
        });

        let totalSpend = 0;
        let onInvoiceSpend = 0;
        let offInvoiceSpend = 0;

        for (const planFu of planFus) {
          for (const pmv of planFu.planMechanicValues || []) {
            const spend = spendOf(pmv.calculatedSpend);
            totalSpend += spend;
            if (pmv.mechanic?.category === 'on_invoice_discount') {
              onInvoiceSpend += spend;
            } else {
              offInvoiceSpend += spend;
            }
          }
        }

        const onInvoicePercent =
          totalSpend > 0 ? (onInvoiceSpend / totalSpend) * 100 : 0;
        const offInvoicePercent =
          totalSpend > 0 ? (offInvoiceSpend / totalSpend) * 100 : 0;

        return {
          planId: plan.id,
          planName: plan.planName,
          planCode: plan.planCode,
          cplName: plan.cpl?.name || 'N/A',
          channel: plan.channel?.name || 'N/A',
          category: plan.category?.name || 'N/A',
          totalSpend,
          onInvoiceSpend,
          offInvoiceSpend,
          onInvoicePercent,
          offInvoicePercent,
          gpRoi: plan.overallRoi || 0,
          ragStatus: plan.ragStatus || 'GREEN',
          status: plan.status,
          startDate: plan.startDate.toISOString().split('T')[0],
          endDate: plan.endDate.toISOString().split('T')[0],
        };
      }),
    );

    return {
      rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get budget at risk analysis
   */
  async getBudgetAtRisk(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<RiskReport> {
    const plans = await this.getFilteredPlans(tenantId, {
      ...filters,
      ragStatuses: ['RED', 'AMBER'],
    });

    const redPlans: RiskPlan[] = [];
    const amberPlans: RiskPlan[] = [];
    let redPlansSpend = 0;
    let amberPlansSpend = 0;

    for (const plan of plans) {
      const planFus = await this.planFuRepository.find({
        where: { planId: plan.id },
        relations: ['planMechanicValues'],
      });

      let totalSpend = 0;
      for (const planFu of planFus) {
        for (const pmv of planFu.planMechanicValues || []) {
          totalSpend += spendOf(pmv.calculatedSpend);
        }
      }

      const riskPlan: RiskPlan = {
        planId: plan.id,
        planName: plan.planName,
        ragStatus: plan.ragStatus || 'GREEN',
        totalSpend,
        gpRoi: plan.overallRoi || 0,
        riskLevel: plan.ragStatus === 'RED' ? 'HIGH' : 'MEDIUM',
      };

      if (plan.ragStatus === 'RED') {
        redPlans.push(riskPlan);
        redPlansSpend += totalSpend;
      } else if (plan.ragStatus === 'AMBER') {
        amberPlans.push(riskPlan);
        amberPlansSpend += totalSpend;
      }
    }

    const totalAtRisk = redPlansSpend + amberPlansSpend;

    // Get total budget for risk percentage
    const budgetReport = await this.getBudgetUtilization(tenantId, filters);
    const totalBudget = budgetReport.total.allocated;
    const riskPercentage =
      totalBudget > 0 ? (totalAtRisk / totalBudget) * 100 : 0;

    const recommendations: string[] = [];
    if (redPlans.length > 0) {
      recommendations.push(
        `${redPlans.length} RED status plans should be reviewed and potentially revised`,
      );
    }
    if (amberPlans.length > 0) {
      recommendations.push(
        `${amberPlans.length} AMBER status plans should be monitored closely`,
      );
    }

    return {
      redPlansSpend,
      amberPlansSpend,
      totalAtRisk,
      riskPercentage,
      redPlans,
      amberPlans,
      recommendations,
    };
  }

  /**
   * Get mechanic effectiveness report
   */
  async getMechanicEffectiveness(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<MechanicReport> {
    const composition = await this.getSpendComposition(tenantId, filters);

    const allMechanics = [...composition.onInvoice, ...composition.offInvoice];

    const mechanics: MechanicEffectiveness[] = allMechanics.map((slice) => {
      const efficiencyScore = slice.avgRoi
        ? slice.avgRoi *
          (slice.amount / composition.totalOnInvoice +
            composition.totalOffInvoice)
        : 0;

      return {
        mechanicCode: slice.mechanicCode,
        mechanicName: slice.mechanicName,
        totalSpend: slice.amount,
        planCount: slice.planCount,
        avgGpRoi: slice.avgRoi || 0,
        avgToRoi: 0, // TODO: Calculate TO ROI
        totalIncrementalGp: 0, // TODO: Calculate from plan data
        efficiencyScore,
        insights: slice.avgRoi
          ? [
              `Average GP ROI: ${slice.avgRoi.toFixed(1)}%`,
              `Used in ${slice.planCount} plans`,
            ]
          : undefined,
      };
    });

    // Sort by efficiency score
    mechanics.sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    return {
      mechanics,
      totalSpend: composition.totalOnInvoice + composition.totalOffInvoice,
      mostEfficient: mechanics.length > 0 ? mechanics[0].mechanicCode : '',
      leastEfficient:
        mechanics.length > 0
          ? mechanics[mechanics.length - 1].mechanicCode
          : '',
    };
  }

  /**
   * Get variance analysis report
   */
  async getVarianceAnalysis(
    tenantId: string,
    filters: ReportFilters,
    comparisonType: ComparisonType,
  ): Promise<VarianceReport> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    // Get actual spends
    const actualTrend = await this.getSpendTrend(
      tenantId,
      filters,
      ReportGranularity.MONTHLY,
    );
    const actualOnInvoice = actualTrend.totalOnInvoice;
    const actualOffInvoice = actualTrend.totalOffInvoice;
    const actualTotal = actualOnInvoice + actualOffInvoice;

    let plannedOnInvoice = 0;
    let plannedOffInvoice = 0;
    let plannedTotal = 0;

    if (comparisonType === ComparisonType.BUDGET_VS_ACTUAL) {
      const budgetReport = await this.getBudgetUtilization(tenantId, filters);
      plannedOnInvoice = budgetReport.onInvoice.allocated;
      plannedOffInvoice = budgetReport.offInvoice.allocated;
      plannedTotal = plannedOnInvoice + plannedOffInvoice;
    } else if (comparisonType === ComparisonType.PREVIOUS_PERIOD) {
      // Calculate previous period
      const periodDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const prevStartDate = new Date(startDate);
      prevStartDate.setDate(prevStartDate.getDate() - periodDays);
      const prevEndDate = new Date(startDate);

      const prevTrend = await this.getSpendTrend(
        tenantId,
        {
          ...filters,
          startDate: prevStartDate.toISOString().split('T')[0],
          endDate: prevEndDate.toISOString().split('T')[0],
        },
        ReportGranularity.MONTHLY,
      );
      plannedOnInvoice = prevTrend.totalOnInvoice;
      plannedOffInvoice = prevTrend.totalOffInvoice;
      plannedTotal = plannedOnInvoice + plannedOffInvoice;
    }

    const variances: VarianceItem[] = [
      {
        category: 'On-Invoice',
        planned: plannedOnInvoice,
        actual: actualOnInvoice,
        variance: actualOnInvoice - plannedOnInvoice,
        variancePercent:
          plannedOnInvoice > 0
            ? ((actualOnInvoice - plannedOnInvoice) / plannedOnInvoice) * 100
            : 0,
      },
      {
        category: 'Off-Invoice',
        planned: plannedOffInvoice,
        actual: actualOffInvoice,
        variance: actualOffInvoice - plannedOffInvoice,
        variancePercent:
          plannedOffInvoice > 0
            ? ((actualOffInvoice - plannedOffInvoice) / plannedOffInvoice) * 100
            : 0,
      },
      {
        category: 'Total',
        planned: plannedTotal,
        actual: actualTotal,
        variance: actualTotal - plannedTotal,
        variancePercent:
          plannedTotal > 0
            ? ((actualTotal - plannedTotal) / plannedTotal) * 100
            : 0,
      },
    ];

    return {
      comparisonType,
      periodStart: startDate.toISOString().split('T')[0],
      periodEnd: endDate.toISOString().split('T')[0],
      variances,
      totalVariance: actualTotal - plannedTotal,
      totalVariancePercent:
        plannedTotal > 0
          ? ((actualTotal - plannedTotal) / plannedTotal) * 100
          : 0,
    };
  }

  /**
   * Get cash flow projection
   */
  async getCashFlowProjection(
    tenantId: string,
    filters: ReportFilters,
    months: number,
  ): Promise<CashFlowReport> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);

    const plans = await this.getFilteredPlans(tenantId, {
      ...filters,
      endDate: endDate.toISOString().split('T')[0],
    });

    const projectionsMap = new Map<string, CashFlowProjection>();

    for (const plan of plans) {
      const planFus = await this.planFuRepository.find({
        where: { planId: plan.id },
        relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
      });

      let onInvoiceSpend = 0;
      let offInvoiceSpend = 0;

      for (const planFu of planFus) {
        for (const pmv of planFu.planMechanicValues || []) {
          const spend = spendOf(pmv.calculatedSpend);
          if (pmv.mechanic?.category === 'on_invoice_discount') {
            onInvoiceSpend += spend;
          } else {
            offInvoiceSpend += spend;
          }
        }
      }

      // On-Invoice: Payment date = Promotion period start (immediate)
      const onInvoiceMonth = new Date(plan.startDate).toISOString().slice(0, 7); // YYYY-MM

      // Off-Invoice: Payment date = Period end + payment terms (assume 30 days)
      const paymentDate = new Date(plan.endDate);
      paymentDate.setDate(paymentDate.getDate() + 30);
      const offInvoiceMonth = paymentDate.toISOString().slice(0, 7);

      // Add to projections
      if (!projectionsMap.has(onInvoiceMonth)) {
        projectionsMap.set(onInvoiceMonth, {
          month: onInvoiceMonth,
          onInvoiceOutflow: 0,
          offInvoiceOutflow: 0,
          totalOutflow: 0,
          planBreakdown: [],
        });
      }

      if (!projectionsMap.has(offInvoiceMonth)) {
        projectionsMap.set(offInvoiceMonth, {
          month: offInvoiceMonth,
          onInvoiceOutflow: 0,
          offInvoiceOutflow: 0,
          totalOutflow: 0,
          planBreakdown: [],
        });
      }

      const onInvoiceProj = projectionsMap.get(onInvoiceMonth)!;
      onInvoiceProj.onInvoiceOutflow += onInvoiceSpend;
      onInvoiceProj.totalOutflow += onInvoiceSpend;
      onInvoiceProj.planBreakdown?.push({
        planId: plan.id,
        planName: plan.planName,
        onInvoice: onInvoiceSpend,
        offInvoice: 0,
        paymentDate: plan.startDate.toISOString().split('T')[0],
      });

      const offInvoiceProj = projectionsMap.get(offInvoiceMonth)!;
      offInvoiceProj.offInvoiceOutflow += offInvoiceSpend;
      offInvoiceProj.totalOutflow += offInvoiceSpend;
      offInvoiceProj.planBreakdown?.push({
        planId: plan.id,
        planName: plan.planName,
        onInvoice: 0,
        offInvoice: offInvoiceSpend,
        paymentDate: paymentDate.toISOString().split('T')[0],
      });
    }

    const projections = Array.from(projectionsMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    );

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      projections,
      totalOnInvoiceOutflow: projections.reduce(
        (sum, p) => sum + p.onInvoiceOutflow,
        0,
      ),
      totalOffInvoiceOutflow: projections.reduce(
        (sum, p) => sum + p.offInvoiceOutflow,
        0,
      ),
      totalOutflow: projections.reduce((sum, p) => sum + p.totalOutflow, 0),
    };
  }

  /**
   * T-023 — Bütçe varyansı raporu: allocated (tahsis) vs consumed (GERÇEKLEŞEN)
   * karşılaştırması, kanal/kategori/dönem kırılımıyla.
   *
   * Kapsam (ürün sahibi, 2026-08-01): hacim/KPI varyansı (plan vs gerçek satış)
   * KAPSAM DIŞI. Yalnızca bütçe zarfı (budget_envelopes) bazında tahsis vs
   * gerçekleşen.
   *
   * Doğruluk ilkeleri:
   *   - `v_budget_summary` (BudgetSummaryView) tek doğruluk kaynağı — reserved
   *     (RESERVE+COMMIT-RELEASE) ve consumed (ledger DEBIT-CREDIT) burada
   *     YENİDEN HESAPLANMAZ, view'dan okunur (no-recompute, T-005 ilkesi).
   *   - Varyans SADECE consumed'dan hesaplanır (BRD "Actual vs. budget").
   *     `reserved` ayrı gösterilir, karıştırılmaz.
   *   - allocated=0 → variancePercent/utilizationPercent/status = null
   *     (division-by-zero guard; Infinity/NaN/0 DEĞİL).
   *   - Eşik durumu (`status`) BudgetThresholdService'ten (tenant-scoped,
   *     config-driven %80/%95/%100+) — hardcode YOK.
   *   - Scope: AccessScopeService (CM yalnız kendi kategorisini görür;
   *     ADMIN/FINANCE_MANAGER/READONLY tenant-wide). BudgetEnvelope'ta cplId
   *     kolonu yok — yalnızca categoryId boyutunda scope uygulanır (CM zaten
   *     yalnızca kategori boyutunda scope'lu; PLANNER bu rapora erişemez).
   */
  async getBudgetVarianceReport(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    filters: BudgetVarianceQueryDto,
  ): Promise<BudgetVarianceReport> {
    const scope = await this.accessScopeService.resolveScope(
      tenantId,
      userId,
      userRole,
    );

    const qb = this.budgetEnvelopeRepository
      .createQueryBuilder('envelope')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.status = :status', {
        status: filters.status || BudgetEnvelopeStatus.ACTIVE,
      });

    // Scope kısıtı — UNRESTRICTED ise no-op; SCOPED (CM) ise categoryId
    // OR-grubu; scope satırı yoksa fail-closed (1=0).
    this.accessScopeService.applyToQueryBuilder(qb, 'envelope', scope);

    if (filters.fiscalYear) {
      qb.andWhere('envelope.fiscalYear = :fiscalYear', {
        fiscalYear: filters.fiscalYear,
      });
    }
    if (filters.periods && filters.periods.length > 0) {
      qb.andWhere('envelope.period IN (:...periods)', {
        periods: filters.periods,
      });
    }
    if (filters.channels && filters.channels.length > 0) {
      qb.andWhere('envelope.channel IN (:...channels)', {
        channels: filters.channels,
      });
    }
    if (filters.categories && filters.categories.length > 0) {
      qb.andWhere('envelope.category IN (:...categories)', {
        categories: filters.categories,
      });
    }

    const envelopes = await qb.getMany();

    if (envelopes.length === 0) {
      const emptyGroup = this.toVarianceGroup('ALL', []);
      return {
        items: [],
        byChannel: [],
        byCategory: [],
        byPeriod: [],
        total: emptyGroup,
      };
    }

    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    // v_budget_summary tek doğruluk kaynağı — no-recompute (T-005 ilkesi).
    // Tenant için tüm summary'ler bir kerede çekilir, envelopeId ile eşlenir
    // (N+1 önlenir); yalnızca scope+filter'dan geçen zarfların satırları
    // rapora dahil edilir.
    const allSummaries =
      await this.budgetRepository.getAllBudgetSummaries(tenantId);
    const summaryByEnvelopeId = new Map(
      allSummaries.map((s) => [s.envelopeId, s]),
    );

    const items: BudgetVarianceItem[] = [];
    for (const envelope of envelopes) {
      const summary = summaryByEnvelopeId.get(envelope.id);
      if (!summary) {
        this.logger.warn(
          `Envelope ${envelope.id} (${envelope.code}) has no v_budget_summary row — skipping from variance report`,
        );
        continue;
      }

      const allocated = Number(summary.allocatedAmount) || 0;
      const reserved = Number(summary.reservedAmount) || 0;
      const consumed = Number(summary.consumedAmount) || 0;
      const available = Number(summary.availableAmount) || 0;

      const variance = consumed - allocated;
      const variancePercent =
        allocated > 0 ? (variance / allocated) * 100 : null;
      const utilizationPercent =
        allocated > 0 ? ((reserved + consumed) / allocated) * 100 : null;
      const status =
        utilizationPercent === null
          ? null
          : this.budgetThresholdService.toStatus(
              utilizationPercent,
              thresholds,
            );

      items.push({
        envelopeId: envelope.id,
        code: envelope.code,
        name: envelope.name,
        fiscalYear: envelope.fiscalYear,
        period: envelope.period,
        channel: envelope.channel ?? null,
        category: envelope.category ?? null,
        allocated,
        reserved,
        consumed,
        available,
        variance,
        variancePercent,
        utilizationPercent,
        status,
      });
    }

    const byChannel = this.groupBy(
      items,
      (i) => i.channel ?? 'UNSPECIFIED',
      thresholds,
    );
    const byCategory = this.groupBy(
      items,
      (i) => i.category ?? 'UNSPECIFIED',
      thresholds,
    );
    const byPeriod = this.groupBy(
      items,
      (i) => `${i.fiscalYear}/${i.period}`,
      thresholds,
    );
    const total = this.toVarianceGroup('ALL', items, thresholds);

    return { items, byChannel, byCategory, byPeriod, total };
  }

  private groupBy(
    items: BudgetVarianceItem[],
    keyFn: (item: BudgetVarianceItem) => string,
    thresholds: BudgetThresholds,
  ): BudgetVarianceGroup[] {
    const map = new Map<string, BudgetVarianceItem[]>();
    for (const item of items) {
      const key = keyFn(item);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([key, groupItems]) =>
      this.toVarianceGroup(key, groupItems, thresholds),
    );
  }

  private toVarianceGroup(
    key: string,
    items: BudgetVarianceItem[],
    thresholds?: BudgetThresholds,
  ): BudgetVarianceGroup {
    const allocated = items.reduce((sum, i) => sum + i.allocated, 0);
    const reserved = items.reduce((sum, i) => sum + i.reserved, 0);
    const consumed = items.reduce((sum, i) => sum + i.consumed, 0);
    const available = items.reduce((sum, i) => sum + i.available, 0);
    const variance = consumed - allocated;
    const variancePercent = allocated > 0 ? (variance / allocated) * 100 : null;
    const utilizationPercent =
      allocated > 0 ? ((reserved + consumed) / allocated) * 100 : null;
    const status =
      utilizationPercent === null || !thresholds
        ? null
        : this.budgetThresholdService.toStatus(utilizationPercent, thresholds);

    return {
      key,
      envelopeCount: items.length,
      allocated,
      reserved,
      consumed,
      available,
      variance,
      variancePercent,
      utilizationPercent,
      status,
    };
  }

  // Helper methods

  private async getFilteredPlans(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<Plan[]> {
    const query = this.planRepository
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .andWhere('plan.status IN (:...statuses)', {
        statuses: ['APPROVED', 'PENDING_APPROVAL'], // Only approved or pending plans
      });

    if (filters.startDate) {
      query.andWhere('plan.startDate >= :startDate', {
        startDate: filters.startDate,
      });
    }
    if (filters.endDate) {
      query.andWhere('plan.endDate <= :endDate', { endDate: filters.endDate });
    }
    if (filters.cplIds && filters.cplIds.length > 0) {
      query.andWhere('plan.cplId IN (:...cplIds)', { cplIds: filters.cplIds });
    }
    if (filters.channels && filters.channels.length > 0) {
      query.andWhere('plan.channel.code IN (:...channels)', {
        channels: filters.channels,
      });
    }
    if (filters.categories && filters.categories.length > 0) {
      query.andWhere('plan.category.code IN (:...categories)', {
        categories: filters.categories,
      });
    }
    if (filters.planStatuses && filters.planStatuses.length > 0) {
      query.andWhere('plan.status IN (:...statuses)', {
        statuses: filters.planStatuses,
      });
    }
    if (filters.ragStatuses && filters.ragStatuses.length > 0) {
      query.andWhere('plan.ragStatus IN (:...ragStatuses)', {
        ragStatuses: filters.ragStatuses,
      });
    }

    return query.getMany();
  }

  private getUtilizationStatus(
    percent: number,
    thresholds: BudgetThresholds,
  ): UtilizationStatus {
    return this.budgetThresholdService.toStatus(percent, thresholds);
  }

  private aggregateByCpl(
    allocations: BudgetAllocation[],
    thresholds: BudgetThresholds,
  ): Array<{
    cplId: string;
    cplName: string;
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
  }> {
    const map = new Map<
      string,
      { onInvoice: number[]; offInvoice: number[] }
    >();

    for (const alloc of allocations) {
      if (!alloc.cplId) continue;
      if (!map.has(alloc.cplId)) {
        map.set(alloc.cplId, { onInvoice: [], offInvoice: [] });
      }
      const entry = map.get(alloc.cplId)!;
      entry.onInvoice.push(
        Number(alloc.onInvoiceBudget) || 0,
        Number(alloc.onInvoiceUtilized) || 0,
        Number(alloc.onInvoiceReserved) || 0,
      );
      entry.offInvoice.push(
        Number(alloc.offInvoiceBudget) || 0,
        Number(alloc.offInvoiceUtilized) || 0,
        Number(alloc.offInvoiceReserved) || 0,
      );
    }

    // TODO: Resolve CPL names from repository
    return Array.from(map.entries()).map(([cplId, data]) => {
      const onInvoiceAllocated = data.onInvoice
        .filter((_, i) => i % 3 === 0)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceUtilized = data.onInvoice
        .filter((_, i) => i % 3 === 1)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceReserved = data.onInvoice
        .filter((_, i) => i % 3 === 2)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceAvailable =
        onInvoiceAllocated - onInvoiceUtilized - onInvoiceReserved;
      const onInvoicePercent =
        onInvoiceAllocated > 0
          ? ((onInvoiceUtilized + onInvoiceReserved) / onInvoiceAllocated) * 100
          : 0;

      const offInvoiceAllocated = data.offInvoice
        .filter((_, i) => i % 3 === 0)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceUtilized = data.offInvoice
        .filter((_, i) => i % 3 === 1)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceReserved = data.offInvoice
        .filter((_, i) => i % 3 === 2)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceAvailable =
        offInvoiceAllocated - offInvoiceUtilized - offInvoiceReserved;
      const offInvoicePercent =
        offInvoiceAllocated > 0
          ? ((offInvoiceUtilized + offInvoiceReserved) / offInvoiceAllocated) *
            100
          : 0;

      return {
        cplId,
        cplName: cplId, // TODO: Resolve from CPL entity
        onInvoice: {
          allocated: onInvoiceAllocated,
          utilized: onInvoiceUtilized,
          reserved: onInvoiceReserved,
          available: onInvoiceAvailable,
          utilizationPercent: onInvoicePercent,
          status: this.getUtilizationStatus(onInvoicePercent, thresholds),
        },
        offInvoice: {
          allocated: offInvoiceAllocated,
          utilized: offInvoiceUtilized,
          reserved: offInvoiceReserved,
          available: offInvoiceAvailable,
          utilizationPercent: offInvoicePercent,
          status: this.getUtilizationStatus(offInvoicePercent, thresholds),
        },
      };
    });
  }

  private aggregateByChannel(
    allocations: BudgetAllocation[],
    thresholds: BudgetThresholds,
  ): Array<{
    channel: string;
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
  }> {
    // Similar to aggregateByCpl but by channel
    const map = new Map<
      string,
      { onInvoice: number[]; offInvoice: number[] }
    >();

    for (const alloc of allocations) {
      if (!alloc.channel) continue;
      if (!map.has(alloc.channel)) {
        map.set(alloc.channel, { onInvoice: [], offInvoice: [] });
      }
      const entry = map.get(alloc.channel)!;
      entry.onInvoice.push(
        Number(alloc.onInvoiceBudget) || 0,
        Number(alloc.onInvoiceUtilized) || 0,
        Number(alloc.onInvoiceReserved) || 0,
      );
      entry.offInvoice.push(
        Number(alloc.offInvoiceBudget) || 0,
        Number(alloc.offInvoiceUtilized) || 0,
        Number(alloc.offInvoiceReserved) || 0,
      );
    }

    return Array.from(map.entries()).map(([channel, data]) => {
      const onInvoiceAllocated = data.onInvoice
        .filter((_, i) => i % 3 === 0)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceUtilized = data.onInvoice
        .filter((_, i) => i % 3 === 1)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceReserved = data.onInvoice
        .filter((_, i) => i % 3 === 2)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceAvailable =
        onInvoiceAllocated - onInvoiceUtilized - onInvoiceReserved;
      const onInvoicePercent =
        onInvoiceAllocated > 0
          ? ((onInvoiceUtilized + onInvoiceReserved) / onInvoiceAllocated) * 100
          : 0;

      const offInvoiceAllocated = data.offInvoice
        .filter((_, i) => i % 3 === 0)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceUtilized = data.offInvoice
        .filter((_, i) => i % 3 === 1)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceReserved = data.offInvoice
        .filter((_, i) => i % 3 === 2)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceAvailable =
        offInvoiceAllocated - offInvoiceUtilized - offInvoiceReserved;
      const offInvoicePercent =
        offInvoiceAllocated > 0
          ? ((offInvoiceUtilized + offInvoiceReserved) / offInvoiceAllocated) *
            100
          : 0;

      return {
        channel,
        onInvoice: {
          allocated: onInvoiceAllocated,
          utilized: onInvoiceUtilized,
          reserved: onInvoiceReserved,
          available: onInvoiceAvailable,
          utilizationPercent: onInvoicePercent,
          status: this.getUtilizationStatus(onInvoicePercent, thresholds),
        },
        offInvoice: {
          allocated: offInvoiceAllocated,
          utilized: offInvoiceUtilized,
          reserved: offInvoiceReserved,
          available: offInvoiceAvailable,
          utilizationPercent: offInvoicePercent,
          status: this.getUtilizationStatus(offInvoicePercent, thresholds),
        },
      };
    });
  }

  private aggregateByCategory(
    allocations: BudgetAllocation[],
    thresholds: BudgetThresholds,
  ): Array<{
    category: string;
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
  }> {
    // Similar to aggregateByChannel but by category
    const map = new Map<
      string,
      { onInvoice: number[]; offInvoice: number[] }
    >();

    for (const alloc of allocations) {
      if (!alloc.category) continue;
      if (!map.has(alloc.category)) {
        map.set(alloc.category, { onInvoice: [], offInvoice: [] });
      }
      const entry = map.get(alloc.category)!;
      entry.onInvoice.push(
        Number(alloc.onInvoiceBudget) || 0,
        Number(alloc.onInvoiceUtilized) || 0,
        Number(alloc.onInvoiceReserved) || 0,
      );
      entry.offInvoice.push(
        Number(alloc.offInvoiceBudget) || 0,
        Number(alloc.offInvoiceUtilized) || 0,
        Number(alloc.offInvoiceReserved) || 0,
      );
    }

    return Array.from(map.entries()).map(([category, data]) => {
      const onInvoiceAllocated = data.onInvoice
        .filter((_, i) => i % 3 === 0)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceUtilized = data.onInvoice
        .filter((_, i) => i % 3 === 1)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceReserved = data.onInvoice
        .filter((_, i) => i % 3 === 2)
        .reduce((sum, v) => sum + v, 0);
      const onInvoiceAvailable =
        onInvoiceAllocated - onInvoiceUtilized - onInvoiceReserved;
      const onInvoicePercent =
        onInvoiceAllocated > 0
          ? ((onInvoiceUtilized + onInvoiceReserved) / onInvoiceAllocated) * 100
          : 0;

      const offInvoiceAllocated = data.offInvoice
        .filter((_, i) => i % 3 === 0)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceUtilized = data.offInvoice
        .filter((_, i) => i % 3 === 1)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceReserved = data.offInvoice
        .filter((_, i) => i % 3 === 2)
        .reduce((sum, v) => sum + v, 0);
      const offInvoiceAvailable =
        offInvoiceAllocated - offInvoiceUtilized - offInvoiceReserved;
      const offInvoicePercent =
        offInvoiceAllocated > 0
          ? ((offInvoiceUtilized + offInvoiceReserved) / offInvoiceAllocated) *
            100
          : 0;

      return {
        category,
        onInvoice: {
          allocated: onInvoiceAllocated,
          utilized: onInvoiceUtilized,
          reserved: onInvoiceReserved,
          available: onInvoiceAvailable,
          utilizationPercent: onInvoicePercent,
          status: this.getUtilizationStatus(onInvoicePercent, thresholds),
        },
        offInvoice: {
          allocated: offInvoiceAllocated,
          utilized: offInvoiceUtilized,
          reserved: offInvoiceReserved,
          available: offInvoiceAvailable,
          utilizationPercent: offInvoicePercent,
          status: this.getUtilizationStatus(offInvoicePercent, thresholds),
        },
      };
    });
  }
}
