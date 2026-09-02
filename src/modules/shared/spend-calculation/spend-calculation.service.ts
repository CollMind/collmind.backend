import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanSku, PlanFu } from '../../../database/entities/plan.entity';
import {
  Mechanic,
  MechanicCategory,
  SpendingType,
} from '../../../database/entities/mechanic.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { LTAAgreementService } from '../lta/lta-agreement.service';
import { LTAContext } from '../lta/dto/lta-context.dto';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';
import {
  SpendBreakdown,
  ValidationResult,
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
import {
  MechanicInput,
  toMechanicInput,
  rawOf,
  readEnteredRaw,
} from '../../../common/numeric/mechanic-input';

/**
 * THE single producer of the UNKNOWN_MECHANIC_CODE 400.
 *
 * Why it names the code, the FU, and the known codes: before this error
 * existed, `if (val != null)` accepted anything and the value then sat in the
 * map UNREAD, because the calculation loops iterate over MECHANICS, not over
 * tactic keys. A typo produced no spend and no message. A planner who mistyped
 * must be able to read the error and fix it themselves.
 *
 * Extracted from `buildMechanicValues` (its original and still primary caller)
 * when F2/C3 added the second raiser — the write-side gate in
 * `PlanService#updateFuTactic`. Two call sites, one body: a client must not be
 * able to tell "rejected at the write" from "rejected during recalc" by the
 * shape of the error, and the only way to keep that true is to build it here.
 */
export function unknownMechanicCodeError(
  code: string,
  planFuId: string | undefined,
  knownByCode: Map<string, Mechanic>,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'UNKNOWN_MECHANIC_CODE',
    message:
      `Unknown or inactive mechanic code "${code}" on FU ` +
      `${planFuId ?? '<unknown>'}. It carries no spend and cannot be ` +
      `interpreted. Known active codes: ${[...knownByCode.keys()].sort().join(', ')}.`,
  });
}

/**
 * THE single producer of the MECHANIC_DEACTIVATED 400 — T-083a.
 *
 * Distinct from UNKNOWN_MECHANIC_CODE because it is a DIFFERENT PROBLEM with a
 * different actor and a different remedy:
 *
 *   UNKNOWN_MECHANIC_CODE  the planner mistyped a code. They can fix it, so the
 *                          message names the code and lists the valid ones.
 *   MECHANIC_DEACTIVATED   an admin deactivated or deleted a mechanic that a
 *                          plan already carried a value for. The planner did
 *                          nothing wrong and can do nothing about it. Listing
 *                          "valid codes" here would be actively misleading.
 *
 * Before this existed, the second case produced the first case's message and the
 * plan was simply stuck: every edit and every submit returned a 400 about a
 * "typo" the planner had never made.
 */
export function orphanedMechanicCodeError(
  code: string,
  planFuId: string | undefined,
  mechanic: Mechanic,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'MECHANIC_DEACTIVATED',
    message:
      `Mechanic "${code}" (${mechanic.name}) has been deactivated or removed, ` +
      `but FU ${planFuId ?? '<unknown>'} still carries a value for it. That ` +
      `value can no longer be interpreted. This is not something you can fix ` +
      `from the plan — please contact support.`,
    mechanicCode: code,
  });
}

/**
 * `T-334` / `Z65 §1` · Excel `§1` *"TABAN HİYERARŞİSİ"* — **PLANNED NIV'İN
 * TEK TÜRETME NOKTASI.**
 *
 * ```
 * PlannedPromoNIV = PlannedPromoGSV − PlannedPromoTotalSpendOn
 *                 = GSV − LTA_On − Σ promo_on
 * ```
 * Bu **tek sayı** iki tabanı birden besler ve ikisi de kanonda AYNIDIR:
 *   `Q8` `PlannedPromoLTAOffInvoice = LTAOffPct × PlannedPromoNIV`
 *   `Q5` off-invoice %-mekanik tabanı `= PlannedPromoNIV`
 *
 * ⛔ Önceden **iki yerde ayrı ayrı** ve **iki farklı şekilde** yazılıydı
 * (`GSV − LTA_On` ve `GSV − LTA_On − LTA_Off − Σpromo_on`) — `§7`/`§7.1`
 * (*"aynı yetenek birden çok kez yazıldı"*). Tek nokta o yüzden burada.
 *
 * ⚠️ `LTA_Off` bu tabandan **DÜŞÜLMEZ** (`Q5`): NIV tanımı gereği yalnız
 * **on-invoice** kalemler düşer.
 */
export function plannedPromoNiv(
  plannedGsv: number,
  plannedLtaOnInvoice: number,
  totalPromoOnInvoice: number,
): number {
  return plannedGsv - plannedLtaOnInvoice - totalPromoOnInvoice;
}

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

    const enteredValue = rawOf(context.mechanicValues[mechanicCode]);
    if (!enteredValue) {
      return 0;
    }

    // Get base values.
    // ⛔ `T-337`: `plannedVolume === null` ⇒ planlanan harcama TANIMSIZ.
    // Bu metot tek bir mekaniğin TUTARINI döner ve `null` taşıyamaz;
    // `calculateAllSpendsForSKU` bu dala HİÇ gelmez (planlanan tarafı
    // baştan atlar). Doğrudan/tekil bir çağıran için sessiz `0` yerine
    // AÇIK HATA (`§2.5`) — uydurulmuş bir tutar bütçeye girmemeli.
    if (skuContext.plannedVolume === null) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MECHANIC_SPEND_INPUT_INCOMPLETE',
        message:
          `SKU ${skuContext.skuId}: mechanic ${mechanicCode} spend requires ` +
          `PLAN_VOL, which is not entered.`,
      });
    }
    const plannedVolume = skuContext.plannedVolume;
    const plannedGsv = plannedVolume * skuContext.listPrice;

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
    // `T-334`/`Q5`: off-invoice tabanı NIV'dir ve `LTA_Off` ondan
    // DÜŞÜLMEZ ⇒ bu yolda `plannedLtaOffInv` artık HİÇ GEREKMİYOR
    // (eskiden hesaplanıp `calculateOffInvoiceDiscount`'a veriliyordu).

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
          context,
          allOnInvoicePromoSpends || {},
        );

      case MechanicCategory.PER_UNIT_SUPPORT:
        return this.calculatePerUnitSupport(
          mechanic,
          enteredValue,
          plannedVolume,
        );

      case MechanicCategory.LUMPSUM_SPEND:
        // T-062: lumpsum is a FU-level amount, distributed across sibling
        // SKUs by base volume (docs/decisions/0006) — this single-SKU
        // method has no visibility into siblings, so it cannot compute a
        // real share. `calculateAllSpendsForSKU` (the only production
        // caller that matters) never reaches this branch for
        // LUMPSUM_SPEND — it special-cases the category and reads
        // `context.lumpsumSharesBySku` (computed once per FU by
        // `computeLumpsumDistribution`) instead. This 0 only fires for a
        // standalone/direct call to `calculateMechanicSpend` outside that
        // FU-aware path (e.g. a future caller that queries a single
        // mechanic's spend in isolation) — documented, not silent.
        return 0;

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
    context: CalculationContext,
    allOnInvoicePromoSpends: Record<string, number>,
  ): number {
    // `T-334`/`Q5` (`Z65 §5`) — Excel `PlannedCPPOff = PlannedPromoNIV ×
    // CPPOffInvoicePCT / 100`. Taban **NIV**'dir; `LTA_Off` DÜŞÜLMEZ.
    // ⛔ ÖNCE `- plannedLtaOffInv` de vardı ⇒ taban KÜÇÜK ⇒ off-invoice
    // harcaması küçük ⇒ ROI **iyimser** (`Z65 §6`, üçüncü vaka).
    const totalOnInvoicePromos = Object.values(allOnInvoicePromoSpends).reduce(
      (a, b) => a + b,
      0,
    );
    const baseAmount = plannedPromoNiv(
      plannedGsv,
      plannedLtaOnInv,
      totalOnInvoicePromos,
    );
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
   * T-062: single derivation point for distributing a FU-level
   * LUMPSUM_SPEND mechanic's entered value across its SKUs.
   *
   * `PlanService#recalculatePlanWithKpiEngineLocked` — the only live per-FU
   * entry point since `T-350` (`Z79 §7`) deleted its sibling
   * (`calculateAllSpendsForFU`, zero production callers) — calls this ONCE
   * per FU, BEFORE looping over SKUs, and threads the result through
   * `CalculationContext.lumpsumSharesBySku` — never re-derived per SKU
   * (T-052 postmortem: two independent derivations of the same fact drift
   * apart). This replaces `distributeSpendToSKUs`, which existed since
   * this file's first commit but was NEVER wired to a production caller
   * (measured via `git log -S`, see T-062 report) — kept alive only by its
   * own unit tests, i.e. a second, permanently-unreachable source of the
   * same fact. Deleted rather than merged with the ALSO-unreachable-from-
   * the-UI `SpendDistributionService.distributeByLumpsum` (spend-
   * distribution.service.ts): that path writes to a disconnected table
   * (`mechanic_spend_breakdowns`) that never feeds `SpendBreakdown`/
   * `plan.totalSpend`/budget reservation, AND its null-base fallback
   * (planned-volume ratio, then equal split) violates ADR 0006 Karar 2 —
   * wiring it into this pipeline would be a materially larger
   * re-architecture than this bugfix's scope (see T-062 report).
   *
   * Rules (docs/decisions/0006-lumpsum-dagitimi.md):
   *  - Distribution base: base volume, proportional (Karar 2).
   *  - A SKU with null/zero base volume gets ZERO share (0001 Set C) — the
   *    formula does this naturally (0 numerator), no special-case needed.
   *  - If EVERY SKU in the FU has null/zero base volume and a lumpsum
   *    value > 0 was entered, there is no valid base to prorate against.
   *    Silently distributing 0 would silently under-reserve the budget by
   *    exactly the amount this task was opened to fix — so this throws a
   *    typed `BadRequestException` (ADR 0005 K3's "noisy reject over
   *    silent zero" precedent, same pattern as `plan.service.ts`'s
   *    `PLAN_SPEND_BREAKDOWN_STALE`/`_INCONSISTENT`) instead.
   *  - Exact-sum rounding: shares are rounded to 2 decimals and any
   *    remainder from that rounding is assigned to the SKU with the
   *    largest base volume, so `sum(shares) === enteredValue` to the cent
   *    (never a silent penny loss/gain against the FU total that has to
   *    reconcile with budget reservation).
   *
   * @returns `skuId -> mechanicCode -> distributedAmount` for every
   *   LUMPSUM_SPEND mechanic with `mechanicValues[code] > 0`. SKUs/
   *   mechanics with no entered value are simply absent (not zero-filled)
   *   — callers default missing keys to 0.
   */
  computeLumpsumDistribution(
    fuId: string,
    mechanicValues: Record<string, MechanicInput>,
    mechanics: Mechanic[],
    planSkus: Array<{ skuId: string; baseVolume?: number | null }>,
  ): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    if (planSkus.length === 0) {
      return result;
    }

    const lumpsumMechanics = mechanics.filter(
      (m) => m.category === MechanicCategory.LUMPSUM_SPEND,
    );

    for (const mechanic of lumpsumMechanics) {
      const enteredValue = rawOf(mechanicValues[mechanic.code]);
      if (!enteredValue) continue;

      const totalBaseVolume = planSkus.reduce(
        (sum, ps) => sum + (Number(ps.baseVolume) || 0),
        0,
      );

      if (totalBaseVolume <= 0) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'LUMPSUM_DISTRIBUTION_NO_BASE_VOLUME',
          message:
            `Cannot distribute lumpsum mechanic ${mechanic.code} ` +
            `(entered value ${enteredValue}) for FU ${fuId}: no SKU in ` +
            `this FU has a positive base volume to prorate against. ` +
            `Enter a base volume for at least one SKU, or remove the ` +
            `lumpsum value, before recalculating.`,
        });
      }

      // Raw proportional shares, rounded to cents.
      const rounded = planSkus.map((ps) => {
        const skuBaseVolume = Number(ps.baseVolume) || 0;
        const raw = (enteredValue * skuBaseVolume) / totalBaseVolume;
        return {
          skuId: ps.skuId,
          skuBaseVolume,
          amount: Math.round(raw * 100) / 100,
        };
      });

      // Exact-sum rounding: give the leftover cent(s) to the SKU with the
      // largest base volume (deterministic — first max in array order),
      // so the distributed total always equals `enteredValue` exactly.
      const distributedTotal = rounded.reduce((sum, r) => sum + r.amount, 0);
      const remainder =
        Math.round((enteredValue - distributedTotal) * 100) / 100;
      if (remainder !== 0) {
        let largestIdx = 0;
        for (let i = 1; i < rounded.length; i++) {
          if (rounded[i].skuBaseVolume > rounded[largestIdx].skuBaseVolume) {
            largestIdx = i;
          }
        }
        rounded[largestIdx].amount =
          Math.round((rounded[largestIdx].amount + remainder) * 100) / 100;
      }

      for (const r of rounded) {
        if (!result[r.skuId]) {
          result[r.skuId] = {};
        }
        result[r.skuId][mechanic.code] = r.amount;
      }
    }

    return result;
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

    // SEVIYE 1: Base values.
    // `T-337`/`Z77 §2`: `baseVolume` **`null` olabilir** ve bu bir eksik
    // veri olgusudur, bir `0` değil (`plan_skus.base_volume` NULLABLE,
    // `K1 §3`). Eskiden `?? 0` düşürülüyordu ⇒ `baseTotalSpend = 0` ⇒
    // `INCR_SPEND = planned − 0` **ŞİŞKİN** çıkıyordu. `plannedVolume` ve
    // `listPrice` ise resolver'ın garantisiyle daima sonlu sayıdır.
    const baseGsv =
      skuContext.baseVolume === null
        ? null
        : skuContext.baseVolume * skuContext.listPrice;
    // `T-337`: `plannedVolume` de **`null` olabilir** — ve bu TABANI
    // ETKİLEMEZ. İki eksen bağımsız (`SpendBreakdown` doc'undaki matris).
    const plannedGsv =
      skuContext.plannedVolume === null
        ? null
        : skuContext.plannedVolume * skuContext.listPrice;

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

    const baseLtaOnInv =
      baseGsv === null ? null : (baseGsv * ltaOnInvoicePct) / 100;
    // Excel `BaseLTASpendOff = LTAOffPct × BaseNIV`. `BaseNIV = BaseGSV −
    // BaseLTAOn`, çünkü **tabanda promo harcaması yoktur** — `SEVIYE 4`'te
    // `baseTotalOnInv = baseLtaOnInv` diye YAZILI. `Q8`'in taban vakası bu
    // yüzden planlanan tarafta doğuyor, tabanda değil.
    //
    // ⚠️ Üçüncü argümandaki `0` bir varsayılan DEĞİL, o satırın yazdığı
    // olgunun BURADAKİ KARŞILIĞIDIR (review `S2`): taban promo toplamı bir
    // gün sıfırdan farklı olursa `SEVIYE 4` ile bu satır **birlikte**
    // değişir. Aynı bağ `incrementalPromoSpend`'de de yazılıdır.
    const baseNiv =
      baseGsv === null || baseLtaOnInv === null
        ? null
        : plannedPromoNiv(baseGsv, baseLtaOnInv, 0);
    const baseLtaOffInv =
      baseNiv === null ? null : (baseNiv * ltaOffInvoicePct) / 100;

    // ⛔ `T-337` — PLANLANAN TARAF HESAPLANAMIYORSA BURADA DURULUR, AMA
    // TABAN TESLİM EDİLİR. `PLAN_VOL` yokluğu planlanan harcamayı
    // tanımsız kılar; `BASE_LTA_ON/OFF` ve `BASE_TO` zinciri ise yalnız
    // `BASE_VOL × BPTT`'ye bağlıdır ve KOŞMAYA DEVAM ETMELİDİR.
    // (Ölçüldü: ilk uygulama burada erken `null` breakdown dönüyordu ve
    // `lta-lifecycle-bond-and-base-chain` e2e'sinde `BASE_LTA_ON` düştü.)
    if (plannedGsv === null) {
      return {
        skuId: skuContext.skuId,
        base:
          baseLtaOnInv === null || baseLtaOffInv === null
            ? null
            : {
                ltaOnInvoice: baseLtaOnInv,
                ltaOffInvoice: baseLtaOffInv,
                totalOnInvoice: baseLtaOnInv,
                totalOffInvoice: baseLtaOffInv,
                totalSpend: baseLtaOnInv + baseLtaOffInv,
              },
        planned: null,
        incremental: null,
      };
    }

    const plannedLtaOnInv = (plannedGsv * ltaOnInvoicePct) / 100;
    // ⛔ `plannedLtaOffInv` BURADA HESAPLANAMAZ (`T-334`/`Q8`): kanonik
    // tabanı `PlannedPromoNIV`'dir, o da on-invoice PROMO toplamını
    // gerektirir — yani SEVIYE 3'ün birinci geçişinden SONRA. Aşağıda,
    // `plannedNiv` ile birlikte hesaplanıyor.
    //
    // ⚠️ SIRA GÜVENLİ: on-invoice %-mekaniklerin tabanı `GSV − LTA_On`'dur
    // (Excel `§1`), `LTA_Off`'a BAĞLI DEĞİLDİR ⇒ döngüsel bağımlılık yok.

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
      const enteredValue = rawOf(context.mechanicValues[mechanic.code]);
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

    // ── `T-334`/`Q8` — PLANNED NIV ve ONA BAĞLI `LTA_Off` ────────────
    // Excel `§1`: `PlannedPromoLTAOffInvoice = LTAOffPct ×
    // PlannedPromoNIV / 100`. ⛔ ÖNCE taban `(GSV − LTA_On)` idi, yani
    // **promo-on düşülmemişti** ⇒ taban BÜYÜK ⇒ `LTA_Off` BÜYÜK ⇒ toplam
    // harcama büyük ⇒ ROI **kötümser** (`Z66 §3`: `Z65 §6` yön-deseninin
    // ilk karşı-örneği; paket gerekçesi *"iyimserlik"* değil FORMÜL-KANON,
    // ve kanon YÖN-AGNOSTİKTİR).
    const plannedNiv = plannedPromoNiv(
      plannedGsv,
      plannedLtaOnInv,
      totalPromoOnInv,
    );
    const plannedLtaOffInv = (plannedNiv * ltaOffInvoicePct) / 100;

    // Second pass: Calculate off-invoice spends (needs all on-invoice spends).
    // Off-invoice mechanic categories: OFF_INVOICE_DISCOUNT, PER_UNIT_SUPPORT, LUMPSUM_SPEND.
    // SpendingType.BOTH with an off-invoice (or non-on-invoice) category is also routed here.
    // SpendingType.BOTH with no recognised category: warn and skip to avoid silent zero spend.
    for (const mechanic of mechanics) {
      const enteredValue = rawOf(context.mechanicValues[mechanic.code]);
      if (!enteredValue) continue;

      const alreadyOnInvoice = mechanic.code in promoOnInvoice;
      if (alreadyOnInvoice) continue; // already classified in first pass

      // T-062: LUMPSUM_SPEND is a FU-level amount distributed across SKUs
      // proportional to base volume (docs/decisions/0006). A single SKU's
      // `calculateMechanicSpend` call cannot compute this correctly — it
      // has no visibility into sibling SKUs' base volumes — so read the
      // pre-computed, exact-sum-rounded share from
      // `context.lumpsumSharesBySku` (populated once per FU by
      // `computeLumpsumDistribution`) instead of delegating to
      // `calculateMechanicSpend`, which still returns 0 for this category
      // when called directly/standalone (no FU context available).
      if (mechanic.category === MechanicCategory.LUMPSUM_SPEND) {
        const share =
          context.lumpsumSharesBySku?.[skuContext.skuId]?.[mechanic.code] ?? 0;
        promoOffInvoice[mechanic.code] = share;
        totalPromoOffInv += share;
        continue;
      }

      const isOffInvoiceCategory =
        mechanic.category === MechanicCategory.OFF_INVOICE_DISCOUNT ||
        mechanic.category === MechanicCategory.PER_UNIT_SUPPORT;
      const isOffInvoiceType =
        mechanic.spendingType === SpendingType.OFF_INVOICE;
      const isBoth = mechanic.spendingType === SpendingType.BOTH;

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

    const baseTotalOnInv = baseLtaOnInv; // No promo in base
    const baseTotalOffInv = baseLtaOffInv;
    // `T-337`: taban ya BÜTÜNÜYLE hesaplanır ya HİÇ — tek girdisi
    // `BASE_VOL × BPTT` olduğu için alanları bağımsız düşemez. Sessizce
    // `0` sayılmaz (`CLAUDE.md §2.5`).
    const base =
      baseTotalOnInv === null || baseTotalOffInv === null
        ? null
        : {
            ltaOnInvoice: baseTotalOnInv,
            ltaOffInvoice: baseTotalOffInv,
            totalOnInvoice: baseTotalOnInv,
            totalOffInvoice: baseTotalOffInv,
            totalSpend: baseTotalOnInv + baseTotalOffInv,
          };

    const incrementalOnInv =
      base === null ? null : totalPlannedOnInv - base.totalOnInvoice;
    const totalPlannedOffInv = plannedLtaOffInv + totalPromoOffInv;
    const totalPlannedSpend = totalPlannedOnInv + totalPlannedOffInv;
    const incrementalOffInv =
      base === null ? null : totalPlannedOffInv - base.totalOffInvoice;
    const incrementalSpend =
      base === null ? null : totalPlannedSpend - base.totalSpend;

    // `T-334`/`Q6` (`Z66 §1`) — ROI PAYDASI: *yalnız promo · LTA hariç ·
    // incremental*.
    //
    // ⛔ TABANDA PROMO HARCAMASI YOKTUR — ve bu bir varsayım değil, üç
    // satır YUKARIDA YAZILI olan şeydir: `baseTotalOnInv = baseLtaOnInv`
    // ve `baseTotalOffInv = baseLtaOffInv`. Yani taban promo harcaması
    // **cebirsel olarak özdeş sıfırdır.**
    //
    // ⚠️ Bu kod bir ara sürümde `baseTotalSpend − baseLtaOn − baseLtaOff`
    // yazıyordu ve yorumu *"tabana promo girerse kendiliğinden doğru
    // kalır"* iddia ediyordu. **KALMAZDI** — o ifade yukarıdaki iki
    // satırdan MEKANİK olarak türer ve daima `0`'dır; bir gerekçe değil,
    // bir totolojiydi (`DISIPLIN`: *"mekanik olarak türetilmiş bir değer
    // GEREKÇE değildir"* + *"yorum kirliliği iki yönde birden yanıltır"*).
    // Review `S2` yakaladı.
    //
    // DOĞRU BAĞLANTI ŞUDUR: tabana bir gün promo harcaması eklenirse
    // `baseTotalOnInv`/`baseTotalOffInv` **VE BURASI BİRLİKTE** değişmek
    // zorundadır. İkisi aynı olguyu yazar; ayrıştıkları gün bu sayı
    // sessizce yanlış olur.
    const incrementalPromoSpend = totalPromoOnInv + totalPromoOffInv;

    // Build result
    const breakdown: SpendBreakdown = {
      skuId: skuContext.skuId,
      base,
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
        promoTotal: incrementalPromoSpend,
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
   * through the real (tactics-PATCH) UI flow computed 0/0 spend through that
   * path, even though the OTHER path (`PlanService#submit`, via
   * `recalculatePlanWithKpiEngineLocked`) already merged both sources and
   * got a correct non-zero `plan.totalSpend`.
   *
   * ⛔ **`F12` — ÖNCÜL DÜZELTİLDİ (`T-337`, 2026-08-31; ölçüm `K1 §0`).**
   * Bu yorum *"`calculateAllSpendsForFU` … `ApprovalWorkflowService#
   * submitForApproval` tarafından kullanılıyor"* diyordu. **YANLIŞ:**
   * `approval-workflow.service.ts` `SpendCalculationService`'i **enjekte
   * bile etmiyor**; `src/` genelindeki tek üretim enjeksiyonu
   * `plan.service.ts:157`. ⇒ `calculateAllSpendsForFU`'nun bugün **SIFIR
   * üretim çağıranı** var (`Z75 §4`'ün dokuzuncu ölü-uç adayı, `Z77 §3c`).
   * Yorum SİLİNMEDİ, DÜZELTİLDİ: bir yanlış canlılık iddiası okuyucuya
   * *"bu yol korunuyor"* dedirtir (`T-084`: yanlış yorum KORUMA üretir).
   *
   * `T-350` (`Z79 §7`): the consumer-less sibling `calculateAllSpendsForFU`
   * was deleted. `recalculatePlanWithKpiEngineLocked` is now this method's
   * ONLY caller — still a single shared derivation point rather than each
   * caller re-implementing the merge (T-049 postmortem: independent
   * derivations of the same fact WILL drift apart over time).
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
  async buildMechanicValues(
    planFu: {
      id?: string;
      tactics?: Record<string, number> | null;
      planMechanicValues?: Array<{
        mechanic?: { code?: string };
        mechanicCode?: string;
        enteredRatePct?: number | null;
        enteredUnitAmount?: number | null;
        enteredTotalAmount?: number | null;
      }>;
    },
    mechanics: Mechanic[],
    /**
     * T-083a: required, NOT optional. An optional tenantId would silently fall
     * back to the typo message whenever a caller forgot it — i.e. the exact
     * defect this parameter exists to fix, reintroduced as a quiet default.
     */
    tenantId: string,
  ): Promise<Record<string, MechanicInput>> {
    const byCode = new Map(mechanics.map((m) => [m.code, m]));
    const values: Record<string, MechanicInput> = {};

    // T-083a: the first unresolvable code is remembered rather than thrown on
    // the spot, because telling "typo" from "deactivated" needs a DB round trip
    // and this function must not become async on its happy path. The lookup runs
    // once, after the loops, and ONLY when something was already going to fail —
    // so the recalc hot path (BRD <500ms) pays nothing.
    let unresolvedCode: string | undefined;

    const put = (code: string, raw: number): void => {
      const mechanic = byCode.get(code);
      if (!mechanic) {
        unresolvedCode ??= code;
        return;
      }
      values[code] = toMechanicInput(mechanic, raw);
    };

    for (const pmv of planFu.planMechanicValues || []) {
      const code = pmv.mechanic?.code ?? pmv.mechanicCode;
      if (!code) continue;
      // F2/C2b-1: the entry lives in the column matching the mechanic's scale.
      // Resolved through the shared derivation point so the column layer and
      // the JSONB layer cannot disagree about a mechanic.
      const mech = byCode.get(code);
      const raw = mech ? readEnteredRaw(pmv, mech) : undefined;
      if (raw != null) put(code, raw);
    }

    for (const [code, val] of Object.entries(planFu.tactics || {})) {
      if (val != null) put(code, val as number);
    }

    if (unresolvedCode !== undefined) {
      // ⚠️ TRANSACTION DISCIPLINE EXCEPTION, stated rather than left silent.
      // When this runs inside `recalculatePlanWithKpiEngineLocked`, that method's
      // rule is "every read/write goes through the given `manager`". This read
      // does not: it uses the injected repository, i.e. a second connection,
      // while the caller's transaction holds the first.
      //
      // Correctness is unaffected — master data is read, the result only picks
      // which message the 400 carries, and a rollback follows immediately. The
      // real risk is pool pressure: an admin deactivating a mechanic that many
      // plans use can push several concurrent recalcs into this branch at once,
      // each asking for a second connection while holding one.
      //
      // Accepted for now because the branch is a failure path and the alternative
      // (threading `manager` down through `buildMechanicValues` for the error
      // case only) would put transaction plumbing into a function whose happy
      // path needs none. If concurrent deactivation ever becomes a real load
      // shape, thread the manager — do not silently widen this exception.
      throw await this.describeUnresolvedMechanicCode(
        unresolvedCode,
        planFu.id,
        byCode,
        tenantId,
      );
    }

    return values;
  }

  /**
   * Which of the two failures is this? T-083a.
   *
   * PUBLIC because BOTH error branches need it — the read side
   * (`buildMechanicValues`, above) and the write side
   * (`PlanService#updateFuTactic`'s scale gate). Fixing only the read side
   * would have left the more visible half wrong: a planner re-entering a value
   * for a mechanic an admin just deactivated would still be told they made a
   * typo, on the very request they are trying to make. Two branches, one
   * resolver — the same discipline as the two error producers themselves.
   *
   * `getActiveMechanics` returns only `isActive: true` rows, so an absent code
   * means one of two very different things and the caller cannot tell them
   * apart. This resolves it — on the error path only.
   *
   * `withDeleted: true` is load-bearing: `MechanicService#remove` uses
   * `softRemove`, and `Mechanic extends BaseEntity` carries `@DeleteDateColumn`,
   * so TypeORM's default `find` does not see a deleted mechanic AT ALL. Without
   * `withDeleted` the `DELETE /mechanics/:id` half of this defect would still
   * report a typo — one of the two deactivation routes silently uncovered.
   */
  async describeUnresolvedMechanicCode(
    code: string,
    planFuId: string | undefined,
    knownByCode: Map<string, Mechanic>,
    tenantId: string,
  ): Promise<BadRequestException> {
    const deactivated = await this.mechanicRepository.findOne({
      where: { tenantId, code },
      withDeleted: true,
    });
    return deactivated
      ? orphanedMechanicCodeError(code, planFuId, deactivated)
      : unknownMechanicCodeError(code, planFuId, knownByCode);
  }

  /**
   * `calculateAllSpendsForFU` — **SİLİNDİ** (`T-350`, `Z79 §7`, `BL`-öncesi).
   * Dokuzuncu ölü-uç adayıydı (`Z75 §4`): üretim çağıranı hiç kazanmadı
   * (ölçüm: yalnız `*.spec.ts` çağırıyordu). Aynı FU-toplu hesabı CANLI
   * olarak `PlanService#recalculatePlanWithKpiEngineLocked` zaten yapıyor
   * (aynı paylaşılan `buildMechanicValues`/`computeLumpsumDistribution`
   * üzerinden) — `BL` (baseline-import) bu ikinci yola ihtiyaç duymuyor.
   */

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

        // Check min/max constraints.
        // F2/C2b-1: read from the semantic column via the shared derivation
        // point. `readEnteredRaw` (not `readEnteredValue`) because the null
        // check below IS the semantics here — collapsing null to 0 would
        // validate a value the planner never entered.
        const entered = readEnteredRaw(pmv, mechanic);
        if (entered !== null && entered !== undefined) {
          if (mechanic.minValue !== null && entered < mechanic.minValue) {
            errors.push(
              `Mechanic ${mechanic.code} value ${entered} is below minimum ${mechanic.minValue} for FU ${planFu.id}`,
            );
          }
          if (mechanic.maxValue !== null && entered > mechanic.maxValue) {
            errors.push(
              `Mechanic ${mechanic.code} value ${entered} exceeds maximum ${mechanic.maxValue} for FU ${planFu.id}`,
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

    // ⛔ `T-337` — BU METODUN `NOT_EVALUABLE` KANALI YOK.
    //
    // `SEVIYE 5-7`'nin tamamı tabana ve `COGS`'a bağlıdır ve dönüş tipi
    // (`CompleteSKUFinancialMetrics`) `null` taşıyamaz. `§2.5`'in kuralı
    // burada net: eksik girdi ⇒ **açık hata**, sessiz `0` değil. Bir
    // varsayılan koymak `INCR_GP`/`ROI`'yi uydurmak olurdu.
    //
    // ⚠️ Bu bir DAVRANIŞ DEĞİŞİKLİĞİ ve etkisi ölçüldü: bu metodun bugün
    // **sıfır üretim çağıranı** var (`K1 §0`; tek çağıranlar `*.spec.ts`),
    // yani canlı bir yol `500` almıyor. Bir tüketici kazandığı gün
    // (`Z75 §4` iki-yol kuralı) bu dal bir `NOT_EVALUABLE` kanalına
    // çevrilmelidir — `SpendBreakdown`'ın kazandığı şekle.
    const { baseVolume, plannedVolume, cogsPerUnit } = skuContext;
    if (baseVolume === null || plannedVolume === null || cogsPerUnit === null) {
      const missing = [
        ...(baseVolume === null ? ['BASE_VOL'] : []),
        ...(plannedVolume === null ? ['PLAN_VOL'] : []),
        ...(cogsPerUnit === null ? ['COGS'] : []),
      ];
      throw new BadRequestException({
        statusCode: 400,
        code: 'SKU_FINANCIAL_METRICS_INPUT_INCOMPLETE',
        message:
          `SKU ${skuContext.skuId}: complete financial metrics require ` +
          `${missing.join(', ')}, which are not set.`,
      });
    }
    /* istanbul ignore next -- yukarıdaki üç `!== null` kontrolü
       `base`/`planned`/`incremental`'ı da garanti eder (aynı olgular,
       `calculateAllSpendsForSKU`); derleyici bu bağı göremez. */
    if (
      spendBreakdown.base === null ||
      spendBreakdown.planned === null ||
      spendBreakdown.incremental === null
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SKU_FINANCIAL_METRICS_INPUT_INCOMPLETE',
        message: `SKU ${skuContext.skuId}: spend could not be evaluated.`,
      });
    }
    const base = spendBreakdown.base;
    const planned = spendBreakdown.planned;
    const incremental = spendBreakdown.incremental;

    // SEVIYE 5: NIV and Turnover calculations
    const baseGsv = baseVolume * skuContext.listPrice;
    const plannedGsv = plannedVolume * skuContext.listPrice;

    const niv: NIVMetrics = {
      baseNiv: baseGsv - base.ltaOnInvoice,
      plannedNiv: plannedGsv - planned.totalOnInvoice,
      incrementalNiv: 0, // Will calculate below
    };
    niv.incrementalNiv = niv.plannedNiv - niv.baseNiv;

    // `T-334` / `Z65 §1` — `TO` ve `NIV` **AYRI KAVRAMLARDIR**; bu metot
    // `1781` döneminde ikisini ÖZDEŞ sayıyordu (`baseTo = niv.baseNiv`).
    // Excel `§1`: `BaseTurnover = BaseGSV − BaseTradeSpend`,
    // `PlannedPromoTurnover = PlannedPromoGSV − PlannedPromoTotalSpend`
    // ⇒ on **ve** off düşülür; `migration 1818` ile aynı semantik.
    //
    // ⚠️ ÜRETİM ÇAĞRI YOLU: bu metodun bugün HTTP/zamanlanmış çağıranı
    // YOK (`A0' §4-7`; ölçüldü — yalnız `*.spec.ts`). ⛔ Yeni bir yetenek
    // EKLENMEDİ (`İlke 1` / `CLAUDE.md §4.2`): var olan bir formül
    // KANONA döndürüldü. Silme/ihya kararı `T-334` kapsamında DEĞİL —
    // yanlış bir ölü formül bırakmak, onu bir sözleşme gibi korur
    // (`§7.1` `T-084` emsali).
    const turnover: TurnoverMetrics = {
      baseTo: baseGsv - base.totalSpend,
      plannedTo: plannedGsv - planned.totalSpend,
      incrementalTo: 0, // Will calculate below
    };
    turnover.incrementalTo = turnover.plannedTo - turnover.baseTo;

    // SEVIYE 6: Profit calculations
    const cogs: COGSMetrics = {
      baseCogs: baseVolume * cogsPerUnit,
      plannedCogs: plannedVolume * cogsPerUnit,
      incrementalCogs: 0, // Will calculate below
    };
    cogs.incrementalCogs = cogs.plannedCogs - cogs.baseCogs;

    const profit: ProfitMetrics = {
      baseGp: turnover.baseTo - cogs.baseCogs,
      plannedGp: turnover.plannedTo - cogs.plannedCogs,
      incrementalGp: 0, // Will calculate below
    };
    profit.incrementalGp = profit.plannedGp - profit.baseGp;

    // SEVIYE 7: ROI and Margin calculations.
    // `T-334`/`Q6` (`Z66 §1`): ROI paydası **tek kalemdir** —
    // `incremental.promoTotal` (yalnız promo, LTA hariç). Burası eskiden
    // `incremental.total`'ı okuyordu, yani paydanın **DÖRDÜNCÜ** varyantı
    // (`A1 §5 Q6`). Kalem bölündü; bu yol da aynı kalemi okur.
    const roiDenominator = incremental.promoTotal;
    const roi: ROIMetrics = {
      gpRoiPct:
        roiDenominator > 0
          ? (profit.incrementalGp / roiDenominator) * 100
          : null,
      toRoiPct:
        roiDenominator > 0
          ? (turnover.incrementalTo / roiDenominator) * 100
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
