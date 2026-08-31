import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Kpi,
  CalculationLevel,
  AggregationMethod,
} from '../../../database/entities/kpi.entity';
import { FormulaParserService, ParsedFormula } from './formula-parser.service';
import {
  RAG_CARRIER_KPI_CODE,
  RAG_EXCLUSION_SCOPE_KPI_CODE,
  RAG_NOT_APPLICABLE,
  RAG_QUADRANT_PROFIT_AXIS_KPI_CODE,
  RAG_QUADRANT_TURNOVER_AXIS_KPI_CODE,
  RagExclusionReason,
  RagQuadrantOutcome,
  resolveRagQuadrant,
} from '../../../common/kpi/rag-quadrant';

export interface SkuCalculationContext {
  // User inputs & master data.
  // BRD: missing master data (e.g. SKU has no COGS configured yet) must
  // propagate as null so dependent KPIs (GP, ROI, RAG) resolve to null
  // instead of silently defaulting to 0 (which would fabricate a fake
  // 100%/GREEN result). See T-027.
  BASE_VOL: number | null;
  PLAN_VOL: number | null;
  BPTT: number | null; // Base Price To Trade (unit price)
  COGS: number | null; // Cost of Goods Sold per unit
  // Tactic values (injected from FU level)
  [tacticCode: string]: number | null | undefined;
}

export interface FuCalculationContext {
  skuResults: Array<Record<string, number | null>>;
  tactics: Record<string, number>;
}

export interface CalculationResult {
  kpiCode: string;
  value: number | null;
  displayFormat: string;
  decimalPlaces: number;
  ragStatus?: 'RED' | 'AMBER' | 'GREEN' | null;
  /**
   * `T-342` / `Z68 §2` — **TANIMLI-YOKLUK.** `ragStatus === null` iki ayrı
   * gerçeği anlatabilir ve ikisi karıştırılmamalıdır:
   *
   * ```
   * ragExclusionReason = null        "değerlendirilemedi" — eksik/kısmi veri
   *                                  (taşıyıcısı `value === null` + `coverageRatio`)
   * ragExclusionReason = 'LTA_ONLY'  "değerlendirme DIŞI" — meşru yokluk,
   *                                  plan bir promosyon değerlendirmesi değil
   * ```
   *
   * ⛔ `ragStatus` dolu iken bu alan **her zaman** `null`'dır.
   */
  ragExclusionReason?: RagExclusionReason | null;
  /**
   * T-177: only set on results produced by rolling up a set of children
   * (SKU→FU, FU→Plan) — fraction of those children whose value was
   * non-null and therefore contributed to `value`. 1 = every child
   * resolved; e.g. 0.5 = half the children were null and silently
   * excluded from the aggregate (§2.5: the exclusion itself must never be
   * silent — this field is what makes it visible to the caller/UI).
   * `null` when there were no children to aggregate at all (empty FU/plan
   * — not the same as "zero coverage of some children").
   * Undefined for SKU-level results and for FU/PLAN-level formula KPIs
   * that are computed directly (not rolled up from an array of children).
   */
  coverageRatio?: number | null;
}

@Injectable()
export class KpiEngineService {
  private readonly logger = new Logger(KpiEngineService.name);
  private kpiCache: Map<string, Kpi[]> = new Map();
  private formulaCache: Map<string, ParsedFormula> = new Map();

  constructor(
    @InjectRepository(Kpi)
    private readonly kpiRepo: Repository<Kpi>,
    private readonly formulaParser: FormulaParserService,
  ) {}

  /**
   * Calculate all KPIs for a single SKU.
   *
   * ⚠️ Bu motor **hangi paydanın** kullanıldığını BİLMEZ ve bilmemelidir:
   * `GP_ROI_PCT`'nin formülü veri-güdümlüdür (`main.kpis.formula_text`).
   * Aşağıdaki yorumlar bir dönem paydayı `TOTAL_PLANNED_SPEND` diye
   * ANLATIYORDU; [[T-334]] / `Z66 §1` paydayı `INCR_PROMO_SPEND`'e
   * bölünce o anlatım **yanlış** kaldı (davranış değil — metin). Review
   * `N1`. Paydanın tek kanonik yeri: `src/common/kpi/roi-denominator.ts`.
   */
  async calculateSku(
    tenantId: string,
    context: SkuCalculationContext,
  ): Promise<Record<string, CalculationResult>> {
    const kpis = await this.getActiveKpis(tenantId);
    const skuKpis = kpis.filter(
      (k) => k.calculationLevel === CalculationLevel.SKU,
    );

    const results: Record<string, CalculationResult> = {};
    const contextMap: Record<string, any> = { ...context };

    // Process KPIs in calculation order
    for (const kpi of skuKpis) {
      const formula = this.getOrParseFormula(kpi);
      const value = formula.execute(contextMap);

      // Store in context for dependent KPIs
      contextMap[kpi.kpiCode] = value;

      // RAG: taşıyıcı KPI **kadrandan** (`Z66 §2`), diğerleri eşikten.
      const rag = this.resolveRagFor(kpi, results);

      results[kpi.kpiCode] = {
        kpiCode: kpi.kpiCode,
        value,
        displayFormat: kpi.displayFormat,
        decimalPlaces: kpi.decimalPlaces,
        ragStatus: rag.ragStatus,
        ragExclusionReason: rag.ragExclusionReason,
      };
    }

    return results;
  }

  /**
   * Aggregate SKU results up to FU level
   */
  async calculateFu(
    tenantId: string,
    skuResults: Array<Record<string, CalculationResult>>,
    tactics: Record<string, number>,
  ): Promise<Record<string, CalculationResult>> {
    const kpis = await this.getActiveKpis(tenantId);
    const results: Record<string, CalculationResult> = {};

    for (const kpi of kpis) {
      if (
        kpi.calculationLevel === CalculationLevel.SKU &&
        kpi.aggregationMethodFu === AggregationMethod.WEIGHTED_AVG
      ) {
        // T-177 step 2: a ratio KPI (UPLIFT_PCT, GP_ROI_PCT, GP_MARGIN_PCT —
        // kpi.seed.ts) is NOT averaged across SKUs. mean(ratio) !=
        // Σnumerator/Σdenominator.
        //
        // T-177 BLOCKER (2026-08-11): re-deriving it from the
        // already-aggregated `results` map was ITSELF wrong — each
        // dependency in `results` was summed over its OWN non-null subset
        // of SKUs (INCR_GP over the 4/170 SKUs with COGS, the ROI
        // denominator over all 170), so the ratio divided two populations
        // (measured: 42x too low on production-shaped data). Recompute
        // directly from the raw `skuResults` instead — see
        // recomputeRatioFromChildren doc comment for the intersection rule.
        const { value, coverageRatio } = this.recomputeRatioFromChildren(
          kpi,
          skuResults,
          tactics,
        );

        // T-177 S4 (2026-08-11, documented per code-reviewer/Team Lead
        // finding — behaviour, not just this comment, predates this note):
        // a ratio KPI's FU-level RAG is determined by applying the
        // threshold to ITS OWN recomputed value, not by taking the worst
        // RAG among its child SKUs (the "FU RAG: use worst-case from SKUs"
        // rule a few lines below, which is for SUM/AVG-aggregated KPIs).
        // Worst-of-children is meaningless for a ratio: the FU's GP_ROI_PCT
        // is Σ numerator / Σ denominator, a single number with its
        // own meaning independent of any one SKU's ratio — a SKU can be
        // RED (low individual ROI, small spend) while the FU as a whole is
        // GREEN (dominated by a large, high-ROI SKU), and that FU value is
        // the correct one to grade, not the worst input into it.
        //
        // ⛔ `T-342`: taşıyıcı KPI için `coverageRatio === 1 && value !== null`
        // kapısı **artık doğru kapı değil.** Kadran `GP_ROI_PCT`'nin DEĞERİNE
        // bakmaz; `iTO`/`iGP`'ye bakar — ve payda `0` iken değer meşru olarak
        // `null`'dır (`HÜCRE 4`, ölçüldü). Kapsama kapısı **eksen bazına**
        // taşındı (`resolveCarrierRag`), yani gevşemedi: her eksen için
        // ayrı ayrı `coverageRatio === 1` aranıyor.
        const rag = this.resolveRagFor(kpi, results);

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus: rag.ragStatus,
          ragExclusionReason: rag.ragExclusionReason,
          coverageRatio,
        };
      } else if (kpi.calculationLevel === CalculationLevel.SKU) {
        // T-177: aggregate SKU values to FU. `values` silently drops any
        // SKU whose value is null/undefined (e.g. missing COGS, T-027) —
        // that silence used to be untracked. `coverageRatio` makes it a
        // visible result field instead: 1 = every SKU resolved, <1 = the
        // value below was derived from a strict subset (§2.5 — the subset
        // itself is never a fabricated number, but which subset it is must
        // not be silent either).
        const totalSkuCount = skuResults.length;
        const values = skuResults
          .map((sr) => sr[kpi.kpiCode]?.value)
          .filter((v): v is number => v !== null && v !== undefined);
        const coverageRatio =
          totalSkuCount === 0 ? null : values.length / totalSkuCount;
        // `T-343`: eski `fullCoverage` kapısı KALKTI — RAG yalnız
        // taşıyıcıda doğuyor (`Z71 §1`), bu daldaki KPI'lar renk taşımıyor.

        const aggregated = this.aggregate(
          values,
          kpi.aggregationMethodFu || AggregationMethod.SUM,
        );

        // T-177 (product owner, 2026-08-11): RAG is only ever assigned on
        // FULL coverage. A partial rollup still surfaces `value` (computed
        // from the calculable subset) and `coverageRatio`, but never a
        // color — a color implies a judgement over the whole set, and a
        // judgement over 3% of SKUs (docs/analysis/0016: 4/170 have COGS)
        // is not a judgement over the FU.
        // `T-343`/`Z71 §1`: RAG **yalnız taşıyıcıda** doğar. Buradaki eski
        // *"çocukların en kötüsü"* yayılımı eşik-RAG'a bağlıydı ve o model
        // öldü — taşıyıcı bugün `WEIGHTED_AVG` olduğu için bu dala düşmez,
        // yine de kadran burada da uygulanır ki `aggregationMethodFu`
        // konfigürasyonla değişirse renk modeli **sessizce başka bir şeye
        // dönmesin** (`§2.7`: iki dal aynı soruyu farklı cevaplamasın).
        const rag: RagQuadrantOutcome =
          kpi.kpiCode === RAG_CARRIER_KPI_CODE
            ? this.resolveCarrierRag(results)
            : RAG_NOT_APPLICABLE;

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value: aggregated,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus: rag.ragStatus,
          ragExclusionReason: rag.ragExclusionReason,
          coverageRatio,
        };
      } else if (kpi.calculationLevel === CalculationLevel.FU) {
        // FU-level KPIs (calculated from aggregated SKU values + tactics)
        const contextMap: Record<string, any> = { ...tactics };

        // Add aggregated SKU values to context
        for (const [code, result] of Object.entries(results)) {
          contextMap[code] = result.value;
        }

        const formula = this.getOrParseFormula(kpi);
        const value = formula.execute(contextMap);

        const rag = this.resolveRagFor(kpi, results);

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus: rag.ragStatus,
          ragExclusionReason: rag.ragExclusionReason,
        };
      }
    }

    return results;
  }

  /**
   * Aggregate FU results to Plan level
   */
  async calculatePlan(
    tenantId: string,
    fuResults: Array<Record<string, CalculationResult>>,
  ): Promise<Record<string, CalculationResult>> {
    const kpis = await this.getActiveKpis(tenantId);
    const results: Record<string, CalculationResult> = {};

    for (const kpi of kpis) {
      if (kpi.calculationLevel === CalculationLevel.PLAN) {
        // Plan-level KPIs get aggregated FU values as context
        const contextMap: Record<string, any> = {};

        // Sum all FU values for each KPI
        for (const fuResult of fuResults) {
          for (const [code, result] of Object.entries(fuResult)) {
            if (contextMap[code] === undefined) contextMap[code] = 0;
            contextMap[code] += result.value || 0;
          }
        }

        const formula = this.getOrParseFormula(kpi);
        const value = formula.execute(contextMap);

        const rag = this.resolveRagFor(kpi, results);

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus: rag.ragStatus,
          ragExclusionReason: rag.ragExclusionReason,
        };
      } else if (kpi.aggregationMethodFu === AggregationMethod.WEIGHTED_AVG) {
        // T-177 step 2: same re-derivation as calculateFu's WEIGHTED_AVG
        // branch, one level up — Σ numerator / Σ denominator across
        // FUs (intersection of FUs where both resolved), not
        // mean(FU-level GP_ROI_PCT).
        //
        // ⚠️ B1 IS NOT CLOSED AT THIS LEVEL. The intersection here is over
        // FUs, but B1 is about SKUs: each `fuResults[i][dep]` was already
        // summed over that dep's OWN non-null SKU subset (the SUM branch at
        // :188-191 filters per kpiCode). So this ratio still divides two
        // independently-summed SKU populations, and an FU whose SKUs are
        // partially covered contributes a mismatched numerator/denominator
        // pair that no FU-level intersection can undo.
        //
        // Measured 2026-08-11 (single FU, 170 SKUs, 4 with COGS, equal
        // spend): plan value identical before and after this commit. Closing
        // it needs the FU result to carry its intersection sums, which it
        // does not today — see T-191.
        const { value, coverageRatio } = this.recomputeRatioFromChildren(
          kpi,
          fuResults,
          {},
        );

        // T-177 S4: same rationale as calculateFu's WEIGHTED_AVG branch —
        // the plan's RAG for a ratio KPI grades the plan's own recomputed
        // value, not the worst RAG among its FUs (see comment there).
        // `T-342`: taşıyıcı için kapı artık **eksen kapsaması** (bkz.
        // `resolveCarrierRag`) — plan seviyesindeki `INCR_TO`/`INCR_GP`/
        // `INCR_PROMO_SPEND` bu noktada zaten toplanmıştır
        // (`calculationOrder` ASC: 27 · 46 · 13 < 48).
        const rag = this.resolveRagFor(kpi, results);

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus: rag.ragStatus,
          ragExclusionReason: rag.ragExclusionReason,
          coverageRatio,
        };
      } else {
        // T-177: aggregate from FU level — same coverage discipline as the
        // SKU→FU rollup in calculateFu (see comment there).
        const totalFuCount = fuResults.length;
        const values = fuResults
          .map((fr) => fr[kpi.kpiCode]?.value)
          .filter((v): v is number => v !== null && v !== undefined);
        const coverageRatio =
          totalFuCount === 0 ? null : values.length / totalFuCount;
        // `T-343`: eski `fullCoverage` kapısı KALKTI — RAG yalnız
        // taşıyıcıda doğuyor (`Z71 §1`), bu daldaki KPI'lar renk taşımıyor.

        const aggregated = this.aggregate(
          values,
          kpi.aggregationMethodFu || AggregationMethod.SUM,
        );

        // `T-343`/`Z71 §1`: bkz. `calculateFu`'nun aynı dalındaki not —
        // RAG yalnız taşıyıcıda doğar, FU renklerinin yayılımı yok.
        const rag: RagQuadrantOutcome =
          kpi.kpiCode === RAG_CARRIER_KPI_CODE
            ? this.resolveCarrierRag(results)
            : RAG_NOT_APPLICABLE;

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value: aggregated,
          coverageRatio,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus: rag.ragStatus,
          ragExclusionReason: rag.ragExclusionReason,
        };
      }
    }

    return results;
  }

  /**
   * Bir KPI'nın RAG'ını çözer — **TEK KARAR NOKTASI** (`T-342`/`T-343`).
   *
   * ```
   * taşıyıcı KPI (GP_ROI_PCT)  → İKİ EKSENLİ KADRAN     (Z66 §2 / Z68 §1)
   * diğer her KPI              → RAG YOK
   * ```
   *
   * ⛔ **`Z71 §1`: KADRAN TEK OTORİTEDİR.** Eşik tabanlı RAG yolu
   * (`determineRagStatus` + FU/plan seviyesindeki *"çocukların en kötüsü"*
   * yayılımı) `T-343` ile **kaldırıldı**. Gerekçe iki katmanlı:
   *
   * ```
   * 1  ragAmberThreshold ÖLDÜ (Z70 §2) ⇒ üç bantlı eşik iki banda düşerdi
   * 2  kalan alan artık `targetRoiThreshold` — semantiği RAG değil HEDEF.
   *    Onunla rastgele bir KPI'yı RED/GREEN boyamak KAVRAM HATASI olurdu.
   * ```
   *
   * ⚠️ **Ve bu bir yetenek kaybı değil, ölü kod kaldırma** — ölçüldü
   * (`T-342` kapanış turu, `rg`): taşıyıcı DIŞINDA bir KPI'nın `ragStatus`'unu
   * okuyan **sıfır** tüketici var; FE'nin dört `RAGCell` çağrısının dördü de
   * `calculatedKpis['GP_ROI_PCT']` okuyor. Kataloğda eşiği olan tek KPI da
   * zaten taşıyıcıydı.
   */
  private resolveRagFor(
    kpi: Kpi,
    results: Record<string, CalculationResult>,
  ): RagQuadrantOutcome {
    if (kpi.kpiCode === RAG_CARRIER_KPI_CODE) {
      return this.resolveCarrierRag(results);
    }
    return RAG_NOT_APPLICABLE;
  }

  /**
   * Taşıyıcı KPI'nın RAG'ı — **kadran** + **tanımlı-yokluk**.
   *
   * Eksenler (`INCR_TO` · `INCR_GP`) ve kapsam kalemi (`INCR_PROMO_SPEND`)
   * `results`'tan okunur; üçünün de `calculationOrder`'ı taşıyıcınınkinden
   * küçüktür (27 · 46 · 13 < 48, `kpi.seed.ts`), yani `getActiveKpis`'in
   * ASC sıralaması bu noktada üçünün de hesaplanmış olmasını **garanti eder**.
   *
   * ⛔ Bir eksen kataloğda yoksa/pasifse renk **üretilmez** (`§2.5`: eksik
   * girdi sessizce bir renge çökmez). Aynı şekilde kısmi kapsamada da renk
   * yoktur — ve o durumda **dışlama sebebi de yazılmaz**: kısmi veriyle
   * *"değerlendirme dışı"* demek, *"değerlendirilemedi"*yi meşru bir
   * yoklukmuş gibi göstermek olurdu.
   */
  private resolveCarrierRag(
    results: Record<string, CalculationResult>,
  ): RagQuadrantOutcome {
    const to = results[RAG_QUADRANT_TURNOVER_AXIS_KPI_CODE];
    const gp = results[RAG_QUADRANT_PROFIT_AXIS_KPI_CODE];
    const promo = results[RAG_EXCLUSION_SCOPE_KPI_CODE];

    if (!to || !gp || !promo) {
      this.logger.warn(
        `RAG kadranı uygulanamadı: eksen/kapsam KPI'ı sonuçlarda yok ` +
          `(${RAG_QUADRANT_TURNOVER_AXIS_KPI_CODE}=${!!to}, ` +
          `${RAG_QUADRANT_PROFIT_AXIS_KPI_CODE}=${!!gp}, ` +
          `${RAG_EXCLUSION_SCOPE_KPI_CODE}=${!!promo}) — renk üretilmedi.`,
      );
      return RAG_NOT_APPLICABLE;
    }

    for (const axis of [to, gp, promo]) {
      if (axis.coverageRatio !== undefined && axis.coverageRatio !== 1) {
        return RAG_NOT_APPLICABLE;
      }
    }

    return resolveRagQuadrant(to.value, gp.value, promo.value);
  }

  /**
   * Aggregate an array of values using specified method
   */
  private aggregate(
    values: number[],
    method: AggregationMethod,
  ): number | null {
    if (values.length === 0) return null;

    switch (method) {
      case AggregationMethod.SUM:
        return values.reduce((a, b) => a + b, 0);
      case AggregationMethod.AVG:
        return values.reduce((a, b) => a + b, 0) / values.length;
      case AggregationMethod.MIN:
        return Math.min(...values);
      case AggregationMethod.MAX:
        return Math.max(...values);
      case AggregationMethod.WEIGHTED_AVG:
        // T-177 step 2: WEIGHTED_AVG must never reach here. A ratio KPI
        // (aggregationMethodFu = WEIGHTED_AVG) is re-derived by
        // recomputeRatioFromChildren BEFORE this method is called —
        // mean(ratio) != Σnum/Σden, and averaging the raw per-child
        // ratios here (the previous behaviour) is exactly the bug this
        // task closes. Throwing (instead of silently falling back to a
        // naive average again) turns any future code path that skips the
        // recompute step into a loud failure instead of a silently wrong
        // number (§2.5).
        throw new Error(
          `KpiEngineService.aggregate() received WEIGHTED_AVG directly — ` +
            `this method must be re-derived via ` +
            `recomputeRatioFromChildren(), not averaged as raw ` +
            `values (T-177).`,
        );
      default:
        return values.reduce((a, b) => a + b, 0);
    }
  }

  /**
   * T-177 step 2 / BLOCKER (2026-08-11): re-derive a ratio KPI
   * (calculationLevel SKU, aggregationMethodFu = WEIGHTED_AVG —
   * UPLIFT_PCT/GP_ROI_PCT/GP_MARGIN_PCT, kpi.seed.ts) by re-running its own
   * formula against dependency values summed over the INTERSECTION of
   * children for which every dependency resolved — not against the
   * independently-aggregated `results` map used by the first cut of this
   * fix.
   *
   * Why the first cut was wrong: `results[dep].value` for each dependency
   * was summed over THAT dependency's own non-null subset of children
   * (e.g. INCR_GP over the 4/170 SKUs with COGS configured, the ROI
   * denominator over all 170 — both are legitimately SUM-aggregated
   * on their own). Dividing those two sums produces the ratio of two
   * DIFFERENT populations, not a defined quantity. Measured on
   * production-shaped data (170 SKUs, 4 with COGS): reported 0.588%,
   * honest 4-SKU subset 25% — 42x off, and worse than the mean(ratio) bug
   * this task originally set out to fix.
   *
   * The product owner's shortcut — "Σ INCR_GP / Σ payda
   * (hesaplanabilen SKU'lar üzerinden)" — reads as one subset, applied to
   * both sums: a child counts toward numerator and denominator together or
   * not at all. `coverageRatio = |intersection| / |children|` is then
   * single-valued and well-defined; `Math.min` over independently-tracked
   * dependency coverages (the prior approach) is no longer needed because
   * there is only one coverage to report.
   *
   * `extraContext` (FU-wide tactic values, constant across every SKU) is
   * excluded from the intersection filter — a dependency resolved via
   * `extraContext` is available to every child by construction and never
   * gates coverage.
   *
   * Precondition (unchanged from the first cut): every per-child
   * dependency this formula references is already present in `children`
   * (i.e. either a raw SKU-level KPI result, T-177's earlier SKU→FU
   * rollup already applied to `sku` fields is NOT relied upon here — this
   * reads straight off `child[dep].value`, which for a calculationLevel
   * SKU dependency is exactly what `calculateSku`/an FU's aggregated
   * result carries). `calculationOrder` ASC ordering (kpi.entity.ts) still
   * guarantees every dependency has already been computed by the time this
   * KPI is reached, for whichever level (`skuResults` for calculateFu's
   * call, `fuResults` for calculatePlan's).
   */
  private recomputeRatioFromChildren(
    kpi: Kpi,
    children: Array<Record<string, CalculationResult>>,
    extraContext: Record<string, any>,
  ): { value: number | null; coverageRatio: number | null } {
    const formula = this.getOrParseFormula(kpi);

    // Dependencies already resolved by extraContext (FU-wide tactic
    // values) are constant across every child — they never gate coverage
    // and are not summed per-child.
    const childDeps = formula.dependencies.filter(
      (dep) => extraContext[dep] === undefined,
    );

    const totalCount = children.length;
    if (totalCount === 0) {
      return { value: null, coverageRatio: null };
    }

    const validChildren = children.filter((child) =>
      childDeps.every((dep) => {
        const v = child[dep]?.value;
        return v !== null && v !== undefined;
      }),
    );

    const coverageRatio = validChildren.length / totalCount;

    if (validChildren.length === 0) {
      return { value: null, coverageRatio };
    }

    const contextMap: Record<string, any> = { ...extraContext };
    for (const dep of childDeps) {
      contextMap[dep] = validChildren.reduce(
        (sum, child) => sum + (child[dep]!.value as number),
        0,
      );
    }

    const value = formula.execute(contextMap);

    return { value, coverageRatio };
  }

  /**
   * Get or parse formula from cache
   */
  private getOrParseFormula(kpi: Kpi): ParsedFormula {
    const cacheKey = `${kpi.id}:${kpi.formulaText}`;

    if (!this.formulaCache.has(cacheKey)) {
      const formula = this.formulaParser.parseFormula(
        kpi.formulaText,
        kpi.formulaType,
      );
      this.formulaCache.set(cacheKey, formula);
    }

    return this.formulaCache.get(cacheKey)!;
  }

  /**
   * Get active KPIs for tenant (cached)
   */
  private async getActiveKpis(tenantId: string): Promise<Kpi[]> {
    // Simple cache with 60-second TTL
    const cacheKey = `kpis:${tenantId}`;

    if (!this.kpiCache.has(cacheKey)) {
      const kpis = await this.kpiRepo.find({
        where: { tenantId, isActive: true },
        order: { calculationOrder: 'ASC' },
      });
      this.kpiCache.set(cacheKey, kpis);

      // Clear cache after 60 seconds
      setTimeout(() => this.kpiCache.delete(cacheKey), 60000);
    }

    return this.kpiCache.get(cacheKey)!;
  }

  /**
   * Get a single KPI config record for a tenant (uses the same cache as
   * getActiveKpis so no extra DB round-trips when called after recalc).
   * Returns null if the KPI code is not found or is inactive.
   */
  async getKpiConfig(tenantId: string, kpiCode: string): Promise<Kpi | null> {
    const kpis = await this.getActiveKpis(tenantId);
    return kpis.find((k) => k.kpiCode === kpiCode) ?? null;
  }

  /**
   * Clear the KPI cache (call after KPI updates)
   */
  clearCache(tenantId?: string): void {
    if (tenantId) {
      this.kpiCache.delete(`kpis:${tenantId}`);
    } else {
      this.kpiCache.clear();
    }
    this.formulaCache.clear();
  }
}
