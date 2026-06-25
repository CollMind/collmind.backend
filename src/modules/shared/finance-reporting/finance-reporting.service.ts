import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, SelectQueryBuilder } from 'typeorm';
import { Plan, PlanStatus } from '../../../database/entities/plan.entity';
import { PlanFu, PlanSku } from '../../../database/entities/plan.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { BudgetAllocation } from '../../../database/entities/budget-allocation.entity';
import { BudgetAllocationService } from '../budget/budget-allocation.service';
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
    private readonly budgetAllocationService: BudgetAllocationService,
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
      status: this.getUtilizationStatus(onInvoiceUtilizationPercent),
    };

    const offInvoice: BudgetSummary = {
      allocated: totalOffInvoiceAllocated,
      utilized: totalOffInvoiceUtilized,
      reserved: totalOffInvoiceReserved,
      available: offInvoiceAvailable,
      utilizationPercent: offInvoiceUtilizationPercent,
      status: this.getUtilizationStatus(offInvoiceUtilizationPercent),
    };

    const total: BudgetSummary = {
      allocated: totalOnInvoiceAllocated + totalOffInvoiceAllocated,
      utilized: totalOnInvoiceUtilized + totalOffInvoiceUtilized,
      reserved: totalOnInvoiceReserved + totalOffInvoiceReserved,
      available: onInvoiceAvailable + offInvoiceAvailable,
      utilizationPercent:
        totalOnInvoiceAllocated + totalOffInvoiceAllocated > 0
          ? ((totalOnInvoiceUtilized +
              totalOnInvoiceReserved +
              totalOffInvoiceUtilized +
              totalOffInvoiceReserved) /
              (totalOnInvoiceAllocated + totalOffInvoiceAllocated)) *
            100
          : 0,
      status: this.getUtilizationStatus(
        totalOnInvoiceAllocated + totalOffInvoiceAllocated > 0
          ? ((totalOnInvoiceUtilized +
              totalOnInvoiceReserved +
              totalOffInvoiceUtilized +
              totalOffInvoiceReserved) /
              (totalOnInvoiceAllocated + totalOffInvoiceAllocated)) *
              100
          : 0,
      ),
    };

    // Breakdown by dimensions (if requested)
    const byCpl =
      filters.cplIds && filters.cplIds.length > 0
        ? undefined
        : this.aggregateByCpl(allocations);
    const byChannel =
      filters.channels && filters.channels.length > 0
        ? undefined
        : this.aggregateByChannel(allocations);
    const byCategory =
      filters.categories && filters.categories.length > 0
        ? undefined
        : this.aggregateByCategory(allocations);

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

            if (mechanic.category === 'on_invoice_discount') {
              onInvoice += pmv.calculatedSpend || 0;
              promoOnInvoice += pmv.calculatedSpend || 0;
            } else {
              offInvoice += pmv.calculatedSpend || 0;
              promoOffInvoice += pmv.calculatedSpend || 0;
            }
          }

          // Add LTA spends from SKUs
          for (const planSku of planFu.planSkus || []) {
            ltaOnInvoice += planSku.plannedLtaOnInvoiceSpend || 0;
            ltaOffInvoice += planSku.plannedLtaOffInvoiceSpend || 0;
            onInvoice += planSku.plannedLtaOnInvoiceSpend || 0;
            offInvoice += planSku.plannedLtaOffInvoiceSpend || 0;
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

          const spend = pmv.calculatedSpend || 0;
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
            const spend = pmv.calculatedSpend || 0;
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
          totalSpend += pmv.calculatedSpend || 0;
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
          const spend = pmv.calculatedSpend || 0;
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

  private getUtilizationStatus(percent: number): UtilizationStatus {
    if (percent >= 95) return UtilizationStatus.RED;
    if (percent >= 80) return UtilizationStatus.AMBER;
    return UtilizationStatus.GREEN;
  }

  private aggregateByCpl(allocations: BudgetAllocation[]): Array<{
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
          status: this.getUtilizationStatus(onInvoicePercent),
        },
        offInvoice: {
          allocated: offInvoiceAllocated,
          utilized: offInvoiceUtilized,
          reserved: offInvoiceReserved,
          available: offInvoiceAvailable,
          utilizationPercent: offInvoicePercent,
          status: this.getUtilizationStatus(offInvoicePercent),
        },
      };
    });
  }

  private aggregateByChannel(allocations: BudgetAllocation[]): Array<{
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
          status: this.getUtilizationStatus(onInvoicePercent),
        },
        offInvoice: {
          allocated: offInvoiceAllocated,
          utilized: offInvoiceUtilized,
          reserved: offInvoiceReserved,
          available: offInvoiceAvailable,
          utilizationPercent: offInvoicePercent,
          status: this.getUtilizationStatus(offInvoicePercent),
        },
      };
    });
  }

  private aggregateByCategory(allocations: BudgetAllocation[]): Array<{
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
          status: this.getUtilizationStatus(onInvoicePercent),
        },
        offInvoice: {
          allocated: offInvoiceAllocated,
          utilized: offInvoiceUtilized,
          reserved: offInvoiceReserved,
          available: offInvoiceAvailable,
          utilizationPercent: offInvoicePercent,
          status: this.getUtilizationStatus(offInvoicePercent),
        },
      };
    });
  }
}
