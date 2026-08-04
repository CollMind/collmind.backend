import {
  enteredColumnFor,
  readEnteredValue,
} from '../../../common/numeric/mechanic-input';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PlanFu, PlanSku } from '../../../database/entities/plan.entity';
import {
  Mechanic,
  MechanicCategory,
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
import {
  DistributionResult,
  DistributionStatus,
  SKUDistribution,
  FUDistributionBreakdown,
  DistributionValidationResult,
} from './dto/distribution-result.dto';

@Injectable()
export class SpendDistributionService {
  private readonly logger = new Logger(SpendDistributionService.name);
  private readonly ROUNDING_TOLERANCE = 0.01; // 1 cent tolerance for rounding errors

  constructor(
    @InjectRepository(PlanFu)
    private readonly planFuRepository: Repository<PlanFu>,
    @InjectRepository(PlanSku)
    private readonly planSkuRepository: Repository<PlanSku>,
    @InjectRepository(Mechanic)
    private readonly mechanicRepository: Repository<Mechanic>,
    @InjectRepository(PlanMechanicValue)
    private readonly planMechanicValueRepository: Repository<PlanMechanicValue>,
    @InjectRepository(MechanicSpendBreakdown)
    private readonly mechanicSpendBreakdownRepository: Repository<MechanicSpendBreakdown>,
  ) {}

  /**
   * Distribute mechanic spend from FU level to SKUs
   */
  async distributeMechanicSpend(
    tenantId: string,
    planFuId: string,
    mechanicId: string,
  ): Promise<DistributionResult> {
    // Get FU with SKUs
    const planFu = await this.planFuRepository.findOne({
      where: { id: planFuId, tenantId },
      relations: [
        'planSkus',
        'planSkus.sku',
        'planMechanicValues',
        'planMechanicValues.mechanic',
      ],
    });

    if (!planFu) {
      throw new NotFoundException(`Plan FU with ID ${planFuId} not found`);
    }

    // Get mechanic
    const mechanic = await this.mechanicRepository.findOne({
      where: { id: mechanicId, tenantId },
    });

    if (!mechanic) {
      throw new NotFoundException(`Mechanic with ID ${mechanicId} not found`);
    }

    // Get or create PlanMechanicValue
    let planMechanicValue = await this.planMechanicValueRepository.findOne({
      where: { planFuId, mechanicId },
    });

    if (!planMechanicValue) {
      planMechanicValue = this.planMechanicValueRepository.create({
        tenantId,
        planFuId,
        mechanicId,
        // F2/C2b: the entry now lives in the column that matches this
        // mechanic's scale. Column choice comes from the same derivation point
        // the JSONB path uses (enteredColumnFor -> toMechanicInput), so the two
        // layers cannot disagree about what a mechanic means.
        [enteredColumnFor(mechanic)]: 0,
        calculatedSpend: 0,
        onInvoiceAmount: 0,
        offInvoiceAmount: 0,
        distributionMethod: this.determineDistributionMethod(mechanic),
      });
      await this.planMechanicValueRepository.save(planMechanicValue);
    }

    const enteredValue = readEnteredValue(planMechanicValue, mechanic);
    if (enteredValue === 0) {
      // Clear existing breakdowns
      await this.mechanicSpendBreakdownRepository.delete({
        planMechanicValueId: planMechanicValue.id,
      });
      return {
        status: DistributionStatus.SUCCESS,
        totalSpend: 0,
        distributedTotal: 0,
        difference: 0,
        skuDistributions: [],
      };
    }

    // Get all SKUs for this FU
    const planSkus = planFu.planSkus || [];
    if (planSkus.length === 0) {
      throw new BadRequestException(`No SKUs found for FU ${planFuId}`);
    }

    // Determine distribution strategy
    const distributionMethod =
      planMechanicValue.distributionMethod ||
      this.determineDistributionMethod(mechanic);
    const skuDistributions = await this.calculateDistribution(
      planSkus,
      mechanic,
      enteredValue,
      distributionMethod,
    );

    // Calculate totals
    const distributedTotal = skuDistributions.reduce(
      (sum, dist) => sum + dist.amount,
      0,
    );
    const difference = Math.abs(enteredValue - distributedTotal);

    // Validate and adjust for rounding errors
    const adjustedDistributions = this.adjustForRounding(
      skuDistributions,
      enteredValue,
      distributedTotal,
    );

    // Save breakdowns
    await this.saveBreakdowns(
      tenantId,
      planMechanicValue.id,
      mechanicId,
      adjustedDistributions,
      distributionMethod,
    );

    // Update PlanMechanicValue with calculated spend
    planMechanicValue.calculatedSpend = distributedTotal;
    if (mechanic.category === MechanicCategory.ON_INVOICE_DISCOUNT) {
      planMechanicValue.onInvoiceAmount = distributedTotal;
      planMechanicValue.offInvoiceAmount = 0;
    } else {
      planMechanicValue.onInvoiceAmount = 0;
      planMechanicValue.offInvoiceAmount = distributedTotal;
    }
    planMechanicValue.distributionMethod = distributionMethod;
    await this.planMechanicValueRepository.save(planMechanicValue);

    const status =
      difference <= this.ROUNDING_TOLERANCE
        ? DistributionStatus.SUCCESS
        : difference <= 1.0
          ? DistributionStatus.PARTIAL
          : DistributionStatus.FAILED;

    return {
      status,
      totalSpend: enteredValue,
      distributedTotal,
      difference,
      skuDistributions: adjustedDistributions,
      warnings:
        difference > this.ROUNDING_TOLERANCE
          ? [
              `Distribution difference: ${difference.toFixed(2)}. Adjusted to match total.`,
            ]
          : undefined,
    };
  }

  /**
   * Recalculate distribution when volume changes
   */
  async recalculateDistributionOnVolumeChange(
    tenantId: string,
    skuId: string,
    newVolume: number,
  ): Promise<void> {
    // Find all breakdowns for this SKU
    const breakdowns = await this.mechanicSpendBreakdownRepository.find({
      where: { planSkuId: skuId },
      relations: ['planMechanicValue', 'planMechanicValue.mechanic', 'planSku'],
    });

    // Group by mechanic
    const breakdownsByMechanic = new Map<string, typeof breakdowns>();
    for (const breakdown of breakdowns) {
      const mechanicId = breakdown.mechanicId;
      if (!breakdownsByMechanic.has(mechanicId)) {
        breakdownsByMechanic.set(mechanicId, []);
      }
      breakdownsByMechanic.get(mechanicId)!.push(breakdown);
    }

    // Recalculate each mechanic
    for (const [
      mechanicId,
      mechanicBreakdowns,
    ] of breakdownsByMechanic.entries()) {
      const firstBreakdown = mechanicBreakdowns[0];
      const planMechanicValue = firstBreakdown.planMechanicValue;
      const mechanic = planMechanicValue.mechanic;

      // Get all SKUs for this FU
      const planFu = await this.planFuRepository.findOne({
        where: { id: planMechanicValue.planFuId, tenantId },
        relations: ['planSkus', 'planSkus.sku'],
      });

      if (!planFu) continue;

      const planSkus = planFu.planSkus || [];
      const enteredValue = planMechanicValue.enteredValue || 0;

      if (enteredValue === 0) continue;

      // Recalculate distribution
      const distributionMethod =
        planMechanicValue.distributionMethod ||
        this.determineDistributionMethod(mechanic);
      const skuDistributions = await this.calculateDistribution(
        planSkus,
        mechanic,
        enteredValue,
        distributionMethod,
      );

      // Save updated breakdowns
      await this.saveBreakdowns(
        tenantId,
        planMechanicValue.id,
        mechanicId,
        skuDistributions,
        distributionMethod,
      );

      // Update calculated spend
      const distributedTotal = skuDistributions.reduce(
        (sum, dist) => sum + dist.amount,
        0,
      );
      planMechanicValue.calculatedSpend = distributedTotal;
      await this.planMechanicValueRepository.save(planMechanicValue);
    }
  }

  /**
   * Get distribution breakdown for a FU
   */
  async getDistributionBreakdown(
    tenantId: string,
    planFuId: string,
  ): Promise<FUDistributionBreakdown> {
    const planFu = await this.planFuRepository.findOne({
      where: { id: planFuId, tenantId },
      relations: [
        'planMechanicValues',
        'planMechanicValues.mechanic',
        'planMechanicValues.spendBreakdowns',
      ],
    });

    if (!planFu) {
      throw new NotFoundException(`Plan FU with ID ${planFuId} not found`);
    }

    const mechanics: Record<string, any> = {};
    let totalOnInvoice = 0;
    let totalOffInvoice = 0;

    for (const pmv of planFu.planMechanicValues || []) {
      const mechanic = pmv.mechanic;
      if (!mechanic) continue;

      const breakdowns = pmv.spendBreakdowns || [];
      const skuDistributions: SKUDistribution[] = breakdowns.map((b: any) => ({
        skuId: b.planSkuId,
        skuCode: b.planSku?.sku?.code || 'N/A',
        amount: Number(b.calculatedAmount) || 0,
        ratio: 0, // Will be calculated
        basis: b.distributionBasis || 'unknown',
      }));

      // Calculate ratios
      const total = skuDistributions.reduce((sum, d) => sum + d.amount, 0);
      skuDistributions.forEach((d) => {
        d.ratio = total > 0 ? d.amount / total : 0;
      });

      const distributedTotal = skuDistributions.reduce(
        (sum, d) => sum + d.amount,
        0,
      );
      const isValid =
        Math.abs((pmv.enteredValue || 0) - distributedTotal) <=
        this.ROUNDING_TOLERANCE;

      mechanics[mechanic.code] = {
        mechanicCode: mechanic.code,
        mechanicName: mechanic.name,
        fuValue: pmv.enteredValue || 0,
        distributionMethod: pmv.distributionMethod || 'unknown',
        skuDistributions,
        totalDistributed: distributedTotal,
        isValid,
      };

      if (mechanic.category === MechanicCategory.ON_INVOICE_DISCOUNT) {
        totalOnInvoice += distributedTotal;
      } else {
        totalOffInvoice += distributedTotal;
      }
    }

    return {
      planFuId,
      mechanics,
      totalOnInvoice,
      totalOffInvoice,
    };
  }

  /**
   * Validate distribution for a FU
   */
  async validateDistribution(
    tenantId: string,
    planFuId: string,
  ): Promise<DistributionValidationResult> {
    const breakdown = await this.getDistributionBreakdown(tenantId, planFuId);
    const planFu = await this.planFuRepository.findOne({
      where: { id: planFuId, tenantId },
      relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
    });

    if (!planFu) {
      throw new NotFoundException(`Plan FU with ID ${planFuId} not found`);
    }

    const invalidMechanics: string[] = [];
    const adjustments: Record<string, number> = {};
    let totalFuSpend = 0;
    let totalSkuDistributed = 0;

    for (const pmv of planFu.planMechanicValues || []) {
      const mechanic = pmv.mechanic;
      if (!mechanic) continue;

      const mechanicBreakdown = breakdown.mechanics[mechanic.code];
      if (!mechanicBreakdown) continue;

      const fuValue = pmv.enteredValue || 0;
      const distributed = mechanicBreakdown.totalDistributed;
      const difference = Math.abs(fuValue - distributed);

      totalFuSpend += fuValue;
      totalSkuDistributed += distributed;

      if (difference > this.ROUNDING_TOLERANCE) {
        invalidMechanics.push(mechanic.code);
        adjustments[mechanic.code] = distributed - fuValue;
      }
    }

    const totalDifference = Math.abs(totalFuSpend - totalSkuDistributed);
    const isValid =
      totalDifference <= this.ROUNDING_TOLERANCE &&
      invalidMechanics.length === 0;

    return {
      isValid,
      fuTotalSpend: totalFuSpend,
      skuTotalDistributed: totalSkuDistributed,
      difference: totalDifference,
      tolerance: this.ROUNDING_TOLERANCE,
      invalidMechanics:
        invalidMechanics.length > 0 ? invalidMechanics : undefined,
      adjustments:
        Object.keys(adjustments).length > 0 ? adjustments : undefined,
    };
  }

  /**
   * Calculate distribution based on method
   */
  private async calculateDistribution(
    planSkus: PlanSku[],
    mechanic: Mechanic,
    enteredValue: number,
    distributionMethod: DistributionMethod,
  ): Promise<SKUDistribution[]> {
    const distributions: SKUDistribution[] = [];

    switch (distributionMethod) {
      case DistributionMethod.PERCENTAGE:
        return this.distributeByPercentage(planSkus, enteredValue);

      case DistributionMethod.PER_UNIT:
        return this.distributeByPerUnit(planSkus, enteredValue);

      case DistributionMethod.LUMPSUM:
      case DistributionMethod.PROPORTIONAL:
        return this.distributeByLumpsum(planSkus, enteredValue);

      default:
        // Auto-detect based on mechanic type
        if (mechanic.mechanicType === MechanicType.PERCENT) {
          return this.distributeByPercentage(planSkus, enteredValue);
        } else if (mechanic.mechanicType === MechanicType.AMOUNT_PER_UNIT) {
          return this.distributeByPerUnit(planSkus, enteredValue);
        } else {
          return this.distributeByLumpsum(planSkus, enteredValue);
        }
    }
  }

  /**
   * Distribute by percentage (each SKU gets same percentage)
   */
  private distributeByPercentage(
    planSkus: PlanSku[],
    percentage: number,
  ): SKUDistribution[] {
    const distributions: SKUDistribution[] = [];

    for (const planSku of planSkus) {
      const plannedVolume = Number(planSku.plannedVolume) || 0;
      const listPrice = Number(planSku.sku?.unitPrice) || 0;
      const plannedGsv = plannedVolume * listPrice;

      // Apply percentage to SKU GSV
      const amount = (plannedGsv * percentage) / 100;
      const ratio = planSkus.length > 0 ? 1 / planSkus.length : 0; // Equal ratio for percentage

      distributions.push({
        skuId: planSku.skuId,
        skuCode: planSku.sku?.code || 'N/A',
        amount,
        ratio,
        basis: 'percentage',
      });
    }

    return distributions;
  }

  /**
   * Distribute by per-unit value
   */
  private distributeByPerUnit(
    planSkus: PlanSku[],
    perUnitValue: number,
  ): SKUDistribution[] {
    const distributions: SKUDistribution[] = [];
    const totalVolume = planSkus.reduce(
      (sum, sku) => sum + (Number(sku.plannedVolume) || 0),
      0,
    );

    for (const planSku of planSkus) {
      const plannedVolume = Number(planSku.plannedVolume) || 0;
      const amount = perUnitValue * plannedVolume;
      const ratio = totalVolume > 0 ? plannedVolume / totalVolume : 0;

      distributions.push({
        skuId: planSku.skuId,
        skuCode: planSku.sku?.code || 'N/A',
        amount,
        ratio,
        basis: 'per_unit',
      });
    }

    return distributions;
  }

  /**
   * Distribute lumpsum by base volume ratio (or planned volume if base is 0)
   */
  private distributeByLumpsum(
    planSkus: PlanSku[],
    lumpsumTotal: number,
  ): SKUDistribution[] {
    const distributions: SKUDistribution[] = [];

    // Calculate total base volume
    const totalBaseVolume = planSkus.reduce(
      (sum, sku) => sum + (Number(sku.baseVolume) || 0),
      0,
    );
    const totalPlannedVolume = planSkus.reduce(
      (sum, sku) => sum + (Number(sku.plannedVolume) || 0),
      0,
    );

    // Use base volume if available, otherwise planned volume
    const useBaseVolume = totalBaseVolume > 0;
    const totalVolume = useBaseVolume ? totalBaseVolume : totalPlannedVolume;

    // If both are 0, use equal distribution
    if (totalVolume === 0) {
      const equalAmount = lumpsumTotal / planSkus.length;
      return planSkus.map((planSku) => ({
        skuId: planSku.skuId,
        skuCode: planSku.sku?.code || 'N/A',
        amount: equalAmount,
        ratio: 1 / planSkus.length,
        basis: 'equal',
      }));
    }

    // Distribute by volume ratio
    for (const planSku of planSkus) {
      const skuVolume = useBaseVolume
        ? Number(planSku.baseVolume) || 0
        : Number(planSku.plannedVolume) || 0;
      const ratio = totalVolume > 0 ? skuVolume / totalVolume : 0;
      const amount = lumpsumTotal * ratio;

      distributions.push({
        skuId: planSku.skuId,
        skuCode: planSku.sku?.code || 'N/A',
        amount,
        ratio,
        basis: useBaseVolume
          ? DistributionBasis.BASE_VOLUME_RATIO
          : DistributionBasis.PLANNED_VOLUME_RATIO,
      });
    }

    return distributions;
  }

  /**
   * Adjust distributions to match total (fix rounding errors)
   */
  private adjustForRounding(
    distributions: SKUDistribution[],
    targetTotal: number,
    currentTotal: number,
  ): SKUDistribution[] {
    const difference = targetTotal - currentTotal;

    if (Math.abs(difference) <= this.ROUNDING_TOLERANCE) {
      return distributions;
    }

    // Sort by amount (descending) to adjust largest first
    const sorted = [...distributions].sort((a, b) => b.amount - a.amount);

    // Add difference to largest SKU
    if (sorted.length > 0) {
      sorted[0].amount += difference;
      // Recalculate ratio
      const newTotal = sorted.reduce((sum, d) => sum + d.amount, 0);
      sorted.forEach((d) => {
        d.ratio = newTotal > 0 ? d.amount / newTotal : 0;
      });
    }

    return sorted;
  }

  /**
   * Save breakdowns to database
   */
  private async saveBreakdowns(
    tenantId: string,
    planMechanicValueId: string,
    mechanicId: string,
    distributions: SKUDistribution[],
    distributionMethod: DistributionMethod,
  ): Promise<void> {
    // Delete existing breakdowns
    await this.mechanicSpendBreakdownRepository.delete({
      planMechanicValueId,
    });

    // Create new breakdowns
    const breakdowns = distributions.map((dist) => {
      let distributionBasis: DistributionBasis;
      if (dist.basis === 'base_volume_ratio') {
        distributionBasis = DistributionBasis.BASE_VOLUME_RATIO;
      } else if (dist.basis === 'planned_volume_ratio') {
        distributionBasis = DistributionBasis.PLANNED_VOLUME_RATIO;
      } else {
        distributionBasis = DistributionBasis.EQUAL;
      }

      return this.mechanicSpendBreakdownRepository.create({
        tenantId,
        planSkuId: dist.skuId,
        mechanicId,
        planMechanicValueId,
        calculatedAmount: dist.amount,
        distributionBasis,
      });
    });

    await this.mechanicSpendBreakdownRepository.save(breakdowns);
  }

  /**
   * Determine distribution method based on mechanic
   */
  private determineDistributionMethod(mechanic: Mechanic): DistributionMethod {
    if (mechanic.mechanicType === MechanicType.PERCENT) {
      return DistributionMethod.PERCENTAGE;
    } else if (mechanic.mechanicType === MechanicType.AMOUNT_PER_UNIT) {
      return DistributionMethod.PER_UNIT;
    } else if (mechanic.category === MechanicCategory.LUMPSUM_SPEND) {
      return DistributionMethod.LUMPSUM;
    } else {
      return DistributionMethod.PROPORTIONAL;
    }
  }
}
