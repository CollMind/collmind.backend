import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanSku, PlanFu } from '../../../database/entities/plan.entity';
import {
  Mechanic,
  MechanicCategory,
  SpendingType,
  MechanicType,
} from '../../../database/entities/mechanic.entity';
import {
  PlanMechanicValue,
  DistributionMethod,
} from '../../../database/entities/plan-mechanic-value.entity';
import {
  MechanicSpendBreakdown,
  DistributionBasis,
} from '../../../database/entities/mechanic-spend-breakdown.entity';
import { LTAAgreementService } from '../lta/lta-agreement.service';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';
import {
  SpendBreakdown,
  FUSpendBreakdown,
  SKUSpendDistribution,
  ValidationResult,
  BaseSpendBreakdown,
  PlannedSpendBreakdown,
  IncrementalSpendBreakdown,
  PromoOnInvoiceSpend,
  PromoOffInvoiceSpend,
} from './dto/spend-breakdown.dto';
import { CalculationContext, SKUContext } from './dto/calculation-context.dto';
import {
  CompleteSKUFinancialMetrics,
  NIVMetrics,
  TurnoverMetrics,
  COGSMetrics,
  ProfitMetrics,
  ROIMetrics,
  MarginMetrics,
} from './dto/financial-metrics.dto';

@Injectable()
export class SpendCalculationService {
  private readonly logger = new Logger(SpendCalculationService.name);
  private calculationCache: Map<string, any> = new Map();

  constructor(
    @InjectRepository(PlanSku)
    private readonly planSkuRepository: Repository<PlanSku>,
    @InjectRepository(PlanFu)
    private readonly planFuRepository: Repository<PlanFu>,
    @InjectRepository(Mechanic)
    private readonly mechanicRepository: Repository<Mechanic>,
    @InjectRepository(PlanMechanicValue)
    private readonly planMechanicValueRepository: Repository<PlanMechanicValue>,
    @InjectRepository(MechanicSpendBreakdown)
    private readonly mechanicSpendBreakdownRepository: Repository<MechanicSpendBreakdown>,
    private readonly ltaAgreementService: LTAAgreementService,
  ) {}

  /**
   * Calculate spend for a specific mechanic
   */
  async calculateMechanicSpend(
    tenantId: string,
    mechanicCode: string,
    context: CalculationContext,
    skuContext: SKUContext,
    allOnInvoicePromoSpends?: Record<string, number>,
  ): Promise<number> {
    const mechanic = await this.mechanicRepository.findOne({
      where: { tenantId, code: mechanicCode, isActive: true },
    });

    if (!mechanic) {
      this.logger.warn(`Mechanic ${mechanicCode} not found or inactive`);
      return 0;
    }

    const enteredValue = context.mechanicValues[mechanicCode] || 0;
    if (!enteredValue) {
      return 0;
    }

    // Get base values
    const plannedGsv = skuContext.plannedVolume * skuContext.listPrice;

    // Get LTA values (already calculated)
    const ltaContext = await this.ltaAgreementService.getLTAForPlanContext(
      tenantId,
      {
        cplId: skuContext.cplId,
        channelCode: skuContext.channelCode,
        categoryCode: skuContext.categoryCode,
      },
      context.planId,
    );

    const plannedLtaOnInv =
      (plannedGsv * (ltaContext?.finalOnInvoicePct || 0)) / 100;
    const plannedLtaOffInv =
      ((plannedGsv - plannedLtaOnInv) * (ltaContext?.finalOffInvoicePct || 0)) /
      100;

    // Calculate based on mechanic category and type
    switch (mechanic.category) {
      case MechanicCategory.ON_INVOICE_DISCOUNT:
        return this.calculateOnInvoiceDiscount(
          mechanic,
          enteredValue,
          plannedGsv,
          plannedLtaOnInv,
        );

      case MechanicCategory.OFF_INVOICE_DISCOUNT:
        return this.calculateOffInvoiceDiscount(
          mechanic,
          enteredValue,
          plannedGsv,
          plannedLtaOnInv,
          plannedLtaOffInv,
          context,
          allOnInvoicePromoSpends || {},
        );

      case MechanicCategory.PER_UNIT_SUPPORT:
        return this.calculatePerUnitSupport(
          mechanic,
          enteredValue,
          skuContext.plannedVolume,
        );

      case MechanicCategory.LUMPSUM_SPEND:
        // Lumpsum is calculated at FU level and distributed
        return 0; // Will be handled in distributeSpendToSKUs

      default:
        this.logger.warn(`Unknown mechanic category: ${mechanic.category}`);
        return 0;
    }
  }

  /**
   * Calculate on-invoice discount spend
   */
  private calculateOnInvoiceDiscount(
    mechanic: Mechanic,
    enteredValue: number,
    plannedGsv: number,
    plannedLtaOnInv: number,
  ): number {
    // On-invoice mekanikler: (PLANNED_GSV - PLANNED_LTA_ON_INV) * PCT / 100
    const baseAmount = plannedGsv - plannedLtaOnInv;
    return (baseAmount * enteredValue) / 100;
  }

  /**
   * Calculate off-invoice discount spend
   */
  private calculateOffInvoiceDiscount(
    mechanic: Mechanic,
    enteredValue: number,
    plannedGsv: number,
    plannedLtaOnInv: number,
    plannedLtaOffInv: number,
    context: CalculationContext,
    allOnInvoicePromoSpends: Record<string, number>,
  ): number {
    // Off-invoice mekanikler: (PLANNED_GSV - PLANNED_LTA_ON_INV - PLANNED_LTA_OFF_INV - On-Invoice Promos) * PCT / 100
    const totalOnInvoicePromos = Object.values(allOnInvoicePromoSpends).reduce(
      (a, b) => a + b,
      0,
    );
    const baseAmount =
      plannedGsv - plannedLtaOnInv - plannedLtaOffInv - totalOnInvoicePromos;
    return (baseAmount * enteredValue) / 100;
  }

  /**
   * Calculate per-unit support spend
   */
  private calculatePerUnitSupport(
    mechanic: Mechanic,
    enteredValue: number,
    plannedVolume: number,
  ): number {
    // Per-unit: PRICE_SUPPORT_PER_UNIT * PLANNED_VOLUME
    return enteredValue * plannedVolume;
  }

  /**
   * Distribute spend to SKUs based on distribution method
   */
  async distributeSpendToSKUs(
    tenantId: string,
    fuId: string,
    mechanicId: string,
    totalSpend: number,
    distributionMethod: DistributionMethod,
  ): Promise<SKUSpendDistribution[]> {
    const planFu = await this.planFuRepository.findOne({
      where: { id: fuId },
      relations: ['planSkus', 'planSkus.sku'],
    });

    if (!planFu || !planFu.planSkus) {
      return [];
    }

    const distributions: SKUSpendDistribution[] = [];

    switch (distributionMethod) {
      case DistributionMethod.PERCENTAGE:
        // Each SKU gets same percentage - distribute based on GSV
        const totalGsv = planFu.planSkus.reduce(
          (sum, ps) =>
            sum +
            (Number(ps.plannedVolume) || 0) * (Number(ps.sku?.unitPrice) || 0),
          0,
        );

        for (const planSku of planFu.planSkus) {
          const skuGsv =
            (Number(planSku.plannedVolume) || 0) *
            (Number(planSku.sku?.unitPrice) || 0);
          const ratio = totalGsv > 0 ? skuGsv / totalGsv : 0;
          distributions.push({
            skuId: planSku.skuId,
            amount: totalSpend * ratio,
            ratio,
          });
        }
        break;

      case DistributionMethod.PER_UNIT:
        // Distribute based on planned volume
        const totalVolume = planFu.planSkus.reduce(
          (sum, ps) => sum + (Number(ps.plannedVolume) || 0),
          0,
        );

        for (const planSku of planFu.planSkus) {
          const skuVolume = Number(planSku.plannedVolume) || 0;
          const ratio = totalVolume > 0 ? skuVolume / totalVolume : 0;
          distributions.push({
            skuId: planSku.skuId,
            amount: totalSpend * ratio,
            ratio,
          });
        }
        break;

      case DistributionMethod.LUMPSUM:
      case DistributionMethod.PROPORTIONAL:
        // Distribute based on base volume ratio
        const totalBaseVolume = planFu.planSkus.reduce(
          (sum, ps) => sum + (Number(ps.baseVolume) || 0),
          0,
        );

        for (const planSku of planFu.planSkus) {
          const skuBaseVolume = Number(planSku.baseVolume) || 0;
          const ratio =
            totalBaseVolume > 0 ? skuBaseVolume / totalBaseVolume : 0;
          distributions.push({
            skuId: planSku.skuId,
            amount: totalSpend * ratio,
            ratio,
          });
        }
        break;
    }

    return distributions;
  }

  /**
   * Calculate all spends for a single SKU
   */
  async calculateAllSpendsForSKU(
    tenantId: string,
    skuContext: SKUContext,
    context: CalculationContext,
  ): Promise<SpendBreakdown> {
    const startTime = Date.now();

    // SEVIYE 1: Base values
    const baseGsv = skuContext.baseVolume * skuContext.listPrice;
    const plannedGsv = skuContext.plannedVolume * skuContext.listPrice;

    // SEVIYE 2: LTA calculations
    const ltaContext = await this.ltaAgreementService.getLTAForPlanContext(
      tenantId,
      {
        cplId: skuContext.cplId,
        channelCode: skuContext.channelCode,
        categoryCode: skuContext.categoryCode,
      },
      context.planId,
    );

    const ltaOnInvoicePct = ltaContext?.finalOnInvoicePct || 0;
    const ltaOffInvoicePct = ltaContext?.finalOffInvoicePct || 0;

    const baseLtaOnInv = (baseGsv * ltaOnInvoicePct) / 100;
    const baseLtaOffInv = ((baseGsv - baseLtaOnInv) * ltaOffInvoicePct) / 100;

    const plannedLtaOnInv = (plannedGsv * ltaOnInvoicePct) / 100;
    const plannedLtaOffInv =
      ((plannedGsv - plannedLtaOnInv) * ltaOffInvoicePct) / 100;

    // SEVIYE 3: Promo Mechanic Spend calculations
    // First pass: Calculate all on-invoice spends
    const promoOnInvoice: PromoOnInvoiceSpend = {};
    const promoOffInvoice: PromoOffInvoiceSpend = {};

    // Get all active mechanics for this FU
    const mechanics = await this.mechanicRepository.find({
      where: { tenantId, isActive: true },
    });

    let totalPromoOnInv = 0;
    let totalPromoOffInv = 0;

    // First pass: Calculate on-invoice spends
    for (const mechanic of mechanics) {
      const enteredValue = context.mechanicValues[mechanic.code] || 0;
      if (!enteredValue) continue;

      if (
        mechanic.spendingType === SpendingType.ON_INVOICE ||
        mechanic.category === MechanicCategory.ON_INVOICE_DISCOUNT
      ) {
        const spend = await this.calculateMechanicSpend(
          tenantId,
          mechanic.code,
          context,
          skuContext,
        );
        promoOnInvoice[mechanic.code] = spend;
        totalPromoOnInv += spend;
      }
    }

    // Second pass: Calculate off-invoice spends (needs all on-invoice spends)
    for (const mechanic of mechanics) {
      const enteredValue = context.mechanicValues[mechanic.code] || 0;
      if (!enteredValue) continue;

      if (
        mechanic.spendingType === SpendingType.OFF_INVOICE ||
        mechanic.category === MechanicCategory.OFF_INVOICE_DISCOUNT ||
        mechanic.category === MechanicCategory.PER_UNIT_SUPPORT ||
        mechanic.category === MechanicCategory.LUMPSUM_SPEND
      ) {
        // Filter out undefined values from promoOnInvoice for type compatibility
        const filteredPromoOnInvoice: Record<string, number> = {};
        for (const [key, value] of Object.entries(promoOnInvoice)) {
          if (value !== undefined) {
            filteredPromoOnInvoice[key] = value;
          }
        }
        const spend = await this.calculateMechanicSpend(
          tenantId,
          mechanic.code,
          context,
          skuContext,
          filteredPromoOnInvoice,
        );
        promoOffInvoice[mechanic.code] = spend;
        totalPromoOffInv += spend;
      }
    }

    // SEVIYE 4: Total Spend calculations
    const totalPlannedOnInv = plannedLtaOnInv + totalPromoOnInv;
    const totalPlannedOffInv = plannedLtaOffInv + totalPromoOffInv;
    const totalPlannedSpend = totalPlannedOnInv + totalPlannedOffInv;

    const baseTotalOnInv = baseLtaOnInv; // No promo in base
    const baseTotalOffInv = baseLtaOffInv;
    const baseTotalSpend = baseTotalOnInv + baseTotalOffInv;

    const incrementalOnInv = totalPlannedOnInv - baseTotalOnInv;
    const incrementalOffInv = totalPlannedOffInv - baseTotalOffInv;
    const incrementalSpend = totalPlannedSpend - baseTotalSpend;

    // Build result
    const breakdown: SpendBreakdown = {
      skuId: skuContext.skuId,
      base: {
        ltaOnInvoice: baseLtaOnInv,
        ltaOffInvoice: baseLtaOffInv,
        totalOnInvoice: baseTotalOnInv,
        totalOffInvoice: baseTotalOffInv,
        totalSpend: baseTotalSpend,
      },
      planned: {
        ltaOnInvoice: plannedLtaOnInv,
        ltaOffInvoice: plannedLtaOffInv,
        promoOnInvoice,
        promoOffInvoice,
        totalPromoOnInvoice: totalPromoOnInv,
        totalPromoOffInvoice: totalPromoOffInv,
        totalOnInvoice: totalPlannedOnInv,
        totalOffInvoice: totalPlannedOffInv,
        totalSpend: totalPlannedSpend,
      },
      incremental: {
        onInvoice: incrementalOnInv,
        offInvoice: incrementalOffInv,
        total: incrementalSpend,
      },
    };

    const duration = Date.now() - startTime;
    if (duration > 50) {
      this.logger.warn(
        `SKU spend calculation took ${duration}ms (target: <50ms)`,
      );
    }

    return breakdown;
  }

  /**
   * Calculate all spends for a FU
   */
  async calculateAllSpendsForFU(
    tenantId: string,
    fuId: string,
  ): Promise<FUSpendBreakdown> {
    const startTime = Date.now();

    const planFu = await this.planFuRepository.findOne({
      where: { id: fuId },
      relations: [
        'plan',
        'planSkus',
        'planSkus.sku',
        'planMechanicValues',
        'planMechanicValues.mechanic',
      ],
    });

    if (!planFu) {
      throw new Error(`Plan FU with ID ${fuId} not found`);
    }

    // Build context
    const mechanicValues: Record<string, number> = {};
    for (const pmv of planFu.planMechanicValues || []) {
      if (pmv.enteredValue) {
        mechanicValues[pmv.mechanic.code] = pmv.enteredValue;
      }
    }

    // Get plan context for LTA
    const planContext: PlanContextDto = {
      cplId: planFu.plan?.cplId,
      channelCode: planFu.plan?.channel?.code,
      categoryCode: planFu.plan?.category?.code,
    };

    const context: CalculationContext = {
      planId: planFu.planId,
      fuId: planFu.id,
      skuContexts: [],
      mechanicValues,
    };

    // Calculate for each SKU
    const skuBreakdowns: SpendBreakdown[] = [];

    for (const planSku of planFu.planSkus || []) {
      const skuContext: SKUContext = {
        skuId: planSku.skuId,
        baseVolume: Number(planSku.baseVolume) || 0,
        plannedVolume: Number(planSku.plannedVolume) || 0,
        listPrice: Number(planSku.sku?.unitPrice) || 0,
        cogsPerUnit: Number(planSku.sku?.cogs) || 0,
        channelCode: planFu.plan?.channel?.code,
        categoryCode: planFu.plan?.category?.code,
        cplId: planFu.plan?.cplId,
      };

      const breakdown = await this.calculateAllSpendsForSKU(
        tenantId,
        skuContext,
        context,
      );
      skuBreakdowns.push(breakdown);
    }

    // Aggregate to FU level
    const aggregatedBase: BaseSpendBreakdown = {
      ltaOnInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.base.ltaOnInvoice,
        0,
      ),
      ltaOffInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.base.ltaOffInvoice,
        0,
      ),
      totalOnInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.base.totalOnInvoice,
        0,
      ),
      totalOffInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.base.totalOffInvoice,
        0,
      ),
      totalSpend: skuBreakdowns.reduce((sum, b) => sum + b.base.totalSpend, 0),
    };

    const aggregatedPlanned: PlannedSpendBreakdown = {
      ltaOnInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.planned.ltaOnInvoice,
        0,
      ),
      ltaOffInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.planned.ltaOffInvoice,
        0,
      ),
      promoOnInvoice: {},
      promoOffInvoice: {},
      totalPromoOnInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.planned.totalPromoOnInvoice,
        0,
      ),
      totalPromoOffInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.planned.totalPromoOffInvoice,
        0,
      ),
      totalOnInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.planned.totalOnInvoice,
        0,
      ),
      totalOffInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.planned.totalOffInvoice,
        0,
      ),
      totalSpend: skuBreakdowns.reduce(
        (sum, b) => sum + b.planned.totalSpend,
        0,
      ),
    };

    // Aggregate mechanic spends
    for (const breakdown of skuBreakdowns) {
      for (const [code, value] of Object.entries(
        breakdown.planned.promoOnInvoice,
      )) {
        if (value) {
          aggregatedPlanned.promoOnInvoice[code] =
            (aggregatedPlanned.promoOnInvoice[code] || 0) + value;
        }
      }
      for (const [code, value] of Object.entries(
        breakdown.planned.promoOffInvoice,
      )) {
        if (value) {
          aggregatedPlanned.promoOffInvoice[code] =
            (aggregatedPlanned.promoOffInvoice[code] || 0) + value;
        }
      }
    }

    const aggregatedIncremental: IncrementalSpendBreakdown = {
      onInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.incremental.onInvoice,
        0,
      ),
      offInvoice: skuBreakdowns.reduce(
        (sum, b) => sum + b.incremental.offInvoice,
        0,
      ),
      total: skuBreakdowns.reduce((sum, b) => sum + b.incremental.total, 0),
    };

    const duration = Date.now() - startTime;
    if (duration > 100) {
      this.logger.warn(
        `FU spend calculation took ${duration}ms (target: <100ms)`,
      );
    }

    return {
      fuId: planFu.id,
      skuBreakdowns,
      aggregatedBase,
      aggregatedPlanned,
      aggregatedIncremental,
    };
  }

  /**
   * Validate spend calculations for a plan
   */
  async validateSpendCalculations(
    tenantId: string,
    planId: string,
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Get all FUs for the plan
    const planFus = await this.planFuRepository.find({
      where: { planId },
      relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
    });

    for (const planFu of planFus) {
      // Validate mechanic values
      for (const pmv of planFu.planMechanicValues || []) {
        const mechanic = pmv.mechanic;
        if (!mechanic) continue;

        // Check min/max constraints
        if (pmv.enteredValue !== null && pmv.enteredValue !== undefined) {
          if (
            mechanic.minValue !== null &&
            pmv.enteredValue < mechanic.minValue
          ) {
            errors.push(
              `Mechanic ${mechanic.code} value ${pmv.enteredValue} is below minimum ${mechanic.minValue} for FU ${planFu.id}`,
            );
          }
          if (
            mechanic.maxValue !== null &&
            pmv.enteredValue > mechanic.maxValue
          ) {
            errors.push(
              `Mechanic ${mechanic.code} value ${pmv.enteredValue} exceeds maximum ${mechanic.maxValue} for FU ${planFu.id}`,
            );
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Calculate complete financial metrics for a SKU (SEVIYE 5-7)
   */
  async calculateCompleteSKUFinancialMetrics(
    tenantId: string,
    skuContext: SKUContext,
    context: CalculationContext,
  ): Promise<CompleteSKUFinancialMetrics> {
    // Get spend breakdown first
    const spendBreakdown = await this.calculateAllSpendsForSKU(
      tenantId,
      skuContext,
      context,
    );

    // SEVIYE 5: NIV and Turnover calculations
    const baseGsv = skuContext.baseVolume * skuContext.listPrice;
    const plannedGsv = skuContext.plannedVolume * skuContext.listPrice;

    const niv: NIVMetrics = {
      baseNiv: baseGsv - spendBreakdown.base.ltaOnInvoice,
      plannedNiv: plannedGsv - spendBreakdown.planned.totalOnInvoice,
      incrementalNiv: 0, // Will calculate below
    };
    niv.incrementalNiv = niv.plannedNiv - niv.baseNiv;

    const turnover: TurnoverMetrics = {
      baseTo: niv.baseNiv - spendBreakdown.base.ltaOffInvoice,
      plannedTo: niv.plannedNiv - spendBreakdown.planned.totalOffInvoice,
      incrementalTo: 0, // Will calculate below
    };
    turnover.incrementalTo = turnover.plannedTo - turnover.baseTo;

    // SEVIYE 6: Profit calculations
    const cogs: COGSMetrics = {
      baseCogs: skuContext.baseVolume * skuContext.cogsPerUnit,
      plannedCogs: skuContext.plannedVolume * skuContext.cogsPerUnit,
      incrementalCogs: 0, // Will calculate below
    };
    cogs.incrementalCogs = cogs.plannedCogs - cogs.baseCogs;

    const profit: ProfitMetrics = {
      baseGp: turnover.baseTo - cogs.baseCogs,
      plannedGp: turnover.plannedTo - cogs.plannedCogs,
      incrementalGp: 0, // Will calculate below
    };
    profit.incrementalGp = profit.plannedGp - profit.baseGp;

    // SEVIYE 7: ROI and Margin calculations
    const roi: ROIMetrics = {
      gpRoiPct:
        spendBreakdown.incremental.total > 0
          ? (profit.incrementalGp / spendBreakdown.incremental.total) * 100
          : null,
      toRoiPct:
        spendBreakdown.incremental.total > 0
          ? (turnover.incrementalTo / spendBreakdown.incremental.total) * 100
          : null,
    };

    const margin: MarginMetrics = {
      plannedGmPct:
        turnover.plannedTo > 0
          ? (profit.plannedGp / turnover.plannedTo) * 100
          : null,
      incrementalGmPct:
        turnover.incrementalTo > 0
          ? (profit.incrementalGp / turnover.incrementalTo) * 100
          : null,
    };

    return {
      skuId: skuContext.skuId,
      spendBreakdown,
      niv,
      turnover,
      cogs,
      profit,
      roi,
      margin,
    };
  }
}
