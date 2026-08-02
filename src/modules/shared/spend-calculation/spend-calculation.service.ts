import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
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
import { LTAContext } from '../lta/dto/lta-context.dto';
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
   * Calculate spend for a specific mechanic.
   *
   * T-046a: accepts an optional `precomputed` bundle so callers that already
   * hold the resolved `Mechanic` row and/or LTA context for this SKU (e.g.
   * `calculateAllSpendsForSKU`, which resolves both exactly once per SKU
   * before looping over its mechanics) can pass them through instead of
   * this method re-querying per call — measured as +3000 queries / 1746ms
   * on a 500-SKU x 3-mechanic plan (docs/analysis/0007 §2.3). Omitted ->
   * unchanged pre-existing behaviour (own lookup), which is what the direct
   * unit tests of this method still exercise.
   *
   * Correctness note (docs/analysis/0007 §2.3 warning): `precomputed`, if
   * given, MUST correspond to this exact `mechanicCode` / this exact
   * `skuContext`'s (cplId, channelCode, categoryCode) — never a value
   * hoisted from a different SKU/mechanic without verifying those inputs
   * are actually invariant across the hoisted scope. Callers in this file
   * only hoist `ltaContext` across values that are provably identical
   * (plan-level cplId/channelCode/categoryCode), and only hoist `mechanic`
   * by iterating the exact same `Mechanic` object the code came from.
   */
  async calculateMechanicSpend(
    tenantId: string,
    mechanicCode: string,
    context: CalculationContext,
    skuContext: SKUContext,
    allOnInvoicePromoSpends?: Record<string, number>,
    precomputed?: {
      mechanic: Mechanic;
      ltaContext: LTAContext | null;
    },
  ): Promise<number> {
    const mechanic =
      precomputed?.mechanic ??
      (await this.mechanicRepository.findOne({
        where: { tenantId, code: mechanicCode, isActive: true },
      }));

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
    const ltaContext =
      precomputed !== undefined
        ? precomputed.ltaContext
        : await this.ltaAgreementService.getLTAForPlanContext(
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
      where: { id: fuId, tenantId },
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
   * Active mechanics for a tenant. Extracted so callers that loop over many
   * SKUs in a single request (e.g. plan recalc) can fetch this once and pass
   * it in via `calculateAllSpendsForSKU`'s `cachedActiveMechanics` param
   * instead of re-querying per SKU (T-045: this result is SKU-independent —
   * repeating it 52x per recalc was pure waste).
   */
  async getActiveMechanics(tenantId: string): Promise<Mechanic[]> {
    return this.mechanicRepository.find({
      where: { tenantId, isActive: true },
    });
  }

  /**
   * LTA context for a (cplId, channelCode, categoryCode, planId)
   * combination. Thin pass-through to `LTAAgreementService`, extracted so
   * callers that resolve this once per plan (the values come from the
   * *plan* record — `plan.cplId`/`plan.channel.code`/`plan.category.code`
   * — and are therefore identical for every SKU in a recalc) can fetch once
   * and pass the result into `calculateAllSpendsForSKU`'s
   * `cachedLtaContext` param instead of re-querying per SKU (T-046a,
   * docs/analysis/0007 §2.3: this call alone was 500 queries / 21% of a
   * 500-SKU recalc's DB time; the calculateMechanicSpend-internal N+1 on
   * top of it accounted for another 1500 queries / 52%). Same caching
   * discipline as `getActiveMechanics`: scope the result to a single
   * call/request, never store it on `this` (tenant leakage / stale-config
   * risk — see class-level guidance on `getActiveMechanics`).
   */
  async getLtaContextForPlan(
    tenantId: string,
    planContext: PlanContextDto,
    planId?: string,
  ): Promise<LTAContext | null> {
    return this.ltaAgreementService.getLTAForPlanContext(
      tenantId,
      planContext,
      planId,
    );
  }

  /**
   * Calculate all spends for a single SKU
   *
   * @param cachedActiveMechanics Optional pre-fetched result of
   *   `getActiveMechanics(tenantId)`. Callers iterating many SKUs within a
   *   single request should fetch once and pass it here (T-045). Must come
   *   from the same tenant/request — never share this across requests or
   *   tenants (the mechanics list can change at any time via Admin config
   *   and must reflect the tenant scope of the current call).
   * @param cachedLtaContext Optional pre-resolved result of
   *   `getLtaContextForPlan`/`ltaAgreementService.getLTAForPlanContext` for
   *   this exact (cplId, channelCode, categoryCode, planId) combination
   *   (T-046a). Only pass this when the caller has verified those inputs
   *   are identical to `skuContext`'s — e.g. `recalculatePlanWithKpiEngineLocked`
   *   resolves them once from the *plan* record (constant for every SKU in
   *   that recalc). `null` is a valid resolved value (no LTA agreement
   *   found) and is honoured — pass `undefined`/omit to force a fresh
   *   lookup instead.
   */
  async calculateAllSpendsForSKU(
    tenantId: string,
    skuContext: SKUContext,
    context: CalculationContext,
    cachedActiveMechanics?: Mechanic[],
    cachedLtaContext?: LTAContext | null,
  ): Promise<SpendBreakdown> {
    const startTime = Date.now();

    // SEVIYE 1: Base values
    const baseGsv = skuContext.baseVolume * skuContext.listPrice;
    const plannedGsv = skuContext.plannedVolume * skuContext.listPrice;

    // SEVIYE 2: LTA calculations. T-046a: reuse the caller's pre-resolved
    // context when provided instead of re-querying (docs/analysis/0007 §2.3 —
    // this call alone was 500 queries / 21% of a 500-SKU recalc even before
    // counting the calculateMechanicSpend N+1 below).
    const ltaContext =
      cachedLtaContext !== undefined
        ? cachedLtaContext
        : await this.ltaAgreementService.getLTAForPlanContext(
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

    // Get all active mechanics for this FU. T-045: reuse the caller's
    // pre-fetched list when provided (see `cachedActiveMechanics` doc above)
    // instead of re-querying — this result does not vary per SKU.
    const mechanics =
      cachedActiveMechanics ?? (await this.getActiveMechanics(tenantId));

    let totalPromoOnInv = 0;
    let totalPromoOffInv = 0;

    // First pass: Calculate on-invoice spends.
    // Mechanic is classified as on-invoice when:
    //   - spendingType === ON_INVOICE, OR
    //   - category === ON_INVOICE_DISCOUNT (explicit category wins regardless of spendingType)
    // SpendingType.BOTH without an explicit on-invoice category is routed to the
    // off-invoice pass below (category-driven routing takes precedence).
    for (const mechanic of mechanics) {
      const enteredValue = context.mechanicValues[mechanic.code] || 0;
      if (!enteredValue) continue;

      const isOnInvoiceCategory =
        mechanic.category === MechanicCategory.ON_INVOICE_DISCOUNT;
      const isOnInvoiceType = mechanic.spendingType === SpendingType.ON_INVOICE;
      const isBoth = mechanic.spendingType === SpendingType.BOTH;

      if (isOnInvoiceCategory || (!isBoth && isOnInvoiceType)) {
        const spend = await this.calculateMechanicSpend(
          tenantId,
          mechanic.code,
          context,
          skuContext,
          undefined,
          { mechanic, ltaContext },
        );
        promoOnInvoice[mechanic.code] = spend;
        totalPromoOnInv += spend;
      } else if (isBoth && isOnInvoiceCategory) {
        // BOTH + on-invoice category: route to on-invoice pass
        const spend = await this.calculateMechanicSpend(
          tenantId,
          mechanic.code,
          context,
          skuContext,
          undefined,
          { mechanic, ltaContext },
        );
        promoOnInvoice[mechanic.code] = spend;
        totalPromoOnInv += spend;
      }
    }

    // Second pass: Calculate off-invoice spends (needs all on-invoice spends).
    // Off-invoice mechanic categories: OFF_INVOICE_DISCOUNT, PER_UNIT_SUPPORT, LUMPSUM_SPEND.
    // SpendingType.BOTH with an off-invoice (or non-on-invoice) category is also routed here.
    // SpendingType.BOTH with no recognised category: warn and skip to avoid silent zero spend.
    for (const mechanic of mechanics) {
      const enteredValue = context.mechanicValues[mechanic.code] || 0;
      if (!enteredValue) continue;

      const isOffInvoiceCategory =
        mechanic.category === MechanicCategory.OFF_INVOICE_DISCOUNT ||
        mechanic.category === MechanicCategory.PER_UNIT_SUPPORT ||
        mechanic.category === MechanicCategory.LUMPSUM_SPEND;
      const isOffInvoiceType =
        mechanic.spendingType === SpendingType.OFF_INVOICE;
      const isBoth = mechanic.spendingType === SpendingType.BOTH;
      const alreadyOnInvoice = mechanic.code in promoOnInvoice;

      if (alreadyOnInvoice) continue; // already classified in first pass

      if (isOffInvoiceCategory || isOffInvoiceType) {
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
          { mechanic, ltaContext },
        );
        promoOffInvoice[mechanic.code] = spend;
        totalPromoOffInv += spend;
      } else if (isBoth) {
        // SpendingType.BOTH mechanic whose category is not a recognised spend category.
        // Route to off-invoice by category if possible; otherwise warn and skip —
        // adding full amount to both buckets would cause double-counting.
        this.logger.warn(
          `Mechanic [code=${mechanic.code}] has SpendingType.BOTH but no recognised spend category (category=${mechanic.category}). ` +
            `Skipping to avoid double-counting. Assign an explicit MechanicCategory to classify this mechanic.`,
        );
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
   * T-052: single derivation point for a FU's mechanic-code -> entered-value
   * map. There are TWO places a value can be entered today:
   *   1. `plan_mechanic_values.enteredValue` (normalized table) — the only
   *      writer is `POST /spend-calculation/distribute/:planFuId/:mechanicId`,
   *      which DISTRIBUTES an already-set value FU->SKU; it never SETS one.
   *   2. `plan_fus.tactics` (JSONB) — written by the ONLY UI-reachable entry
   *      point today, `PATCH /plans/:id/fus/:fuId/tactics` ->
   *      `PlanService#updateFuTactic`.
   * Before T-052, `calculateAllSpendsForFU` read ONLY (1), so a plan built
   * through the real (tactics-PATCH) UI flow computed 0/0 spend when it went
   * through `ApprovalWorkflowService#submitForApproval`, even though the
   * OTHER canonical path (`PlanService#submit`, via
   * `recalculatePlanWithKpiEngineLocked`) already merged both sources and
   * got a correct non-zero `plan.totalSpend`.
   *
   * Both canonical callers (`recalculatePlanWithKpiEngineLocked` here and
   * `calculateAllSpendsForFU` below) now call this ONE method instead of
   * each re-implementing the merge — T-049 postmortem: two independent
   * derivations of the same fact WILL drift apart over time.
   *
   * Precedence on key collision (same mechanic code present in both
   * sources): `tactics` wins, matching the pre-existing behaviour of
   * `recalculatePlanWithKpiEngineLocked` (tactics loop ran second,
   * unconditionally overwriting). This is a same-tenant, same-FU, legacy/
   * migration-only scenario (no current writer can produce it going
   * forward, given `plan_mechanic_values`'s only writer is the SKU-level
   * distribute endpoint) — values are never summed for a colliding code, so
   * this cannot double-count, only pick one source over the other.
   */
  buildMechanicValues(planFu: {
    tactics?: Record<string, number> | null;
    planMechanicValues?: Array<{
      mechanic?: { code?: string };
      mechanicCode?: string;
      enteredValue?: number;
    }>;
  }): Record<string, number> {
    const mechanicValues: Record<string, number> = {};

    for (const pmv of planFu.planMechanicValues || []) {
      if (pmv.mechanic?.code && pmv.enteredValue != null) {
        mechanicValues[pmv.mechanic.code] = pmv.enteredValue;
      } else if (pmv.mechanicCode && pmv.enteredValue != null) {
        mechanicValues[pmv.mechanicCode] = pmv.enteredValue;
      }
    }

    for (const [code, val] of Object.entries(planFu.tactics || {})) {
      if (val != null) {
        mechanicValues[code] = val as number;
      }
    }

    return mechanicValues;
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
      where: { id: fuId, tenantId },
      relations: [
        'plan',
        'planSkus',
        'planSkus.sku',
        'planMechanicValues',
        'planMechanicValues.mechanic',
      ],
    });

    if (!planFu) {
      this.logger.error(
        `calculateAllSpendsForFU: PlanFU not found [fuId=${fuId}, tenantId=${tenantId}]`,
      );
      throw new InternalServerErrorException(
        `Plan FU with ID ${fuId} not found for tenant ${tenantId}`,
      );
    }

    // Build context. T-052: merge `plan_mechanic_values.enteredValue` AND
    // `plan_fus.tactics` via the single shared derivation point (see
    // `buildMechanicValues` doc comment) — reading only the former left the
    // real (tactics-PATCH) UI flow computing 0/0 spend through this path.
    const mechanicValues = this.buildMechanicValues(planFu);

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

    // Calculate for each SKU. T-045: fetch the active-mechanics list once
    // for this call and reuse it across all SKUs below (SKU-independent).
    // T-046a: same for LTA context — `planContext`/`planFu.planId` above are
    // built from `planFu.plan`, constant for every SKU in this FU, so
    // resolve once and reuse (docs/analysis/0007 §2.3).
    const skuBreakdowns: SpendBreakdown[] = [];
    const activeMechanics = await this.getActiveMechanics(tenantId);
    const ltaContext = await this.getLtaContextForPlan(
      tenantId,
      planContext,
      planFu.planId,
    );

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
        activeMechanics,
        ltaContext,
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

    // T-017: BRD NIV semantics — Turnover is reduced ONLY by on-invoice deductions.
    // Off-invoice spend (LTA_OFF, lumpsum, per-unit support) does NOT reduce TO;
    // it enters GP calculation as incremental spend instead.
    // Aligns with migration 1781 (FixTurnoverOnInvoiceOnly):
    //   BASE_TO    = BASE_GSV - BASE_LTA_ON       → niv.baseNiv (already GSV - LTA_ON)
    //   PLANNED_TO = PLANNED_GSV - PLANNED_ON_INVOICE_SPEND → niv.plannedNiv
    const turnover: TurnoverMetrics = {
      baseTo: niv.baseNiv,
      plannedTo: niv.plannedNiv,
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
