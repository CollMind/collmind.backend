import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Kpi,
  FormulaType,
  CalculationLevel,
  AggregationMethod,
} from '../../../database/entities/kpi.entity';
import { FormulaParserService, ParsedFormula } from './formula-parser.service';

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
   * Calculate all KPIs for a single SKU
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

      // Determine RAG status if thresholds defined
      let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
      if (
        kpi.ragGreenThreshold !== undefined &&
        kpi.ragGreenThreshold !== null &&
        value !== null
      ) {
        ragStatus = this.determineRagStatus(
          value,
          kpi.ragGreenThreshold,
          kpi.ragAmberThreshold,
        );
      }

      results[kpi.kpiCode] = {
        kpiCode: kpi.kpiCode,
        value,
        displayFormat: kpi.displayFormat,
        decimalPlaces: kpi.decimalPlaces,
        ragStatus,
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
        // Σnumerator/Σdenominator — re-run the KPI's own formula against the
        // ALREADY-aggregated dependency values instead (results[dep] is
        // guaranteed populated: kpis are processed in calculationOrder ASC
        // and every dependency of a WEIGHTED_AVG ratio has a lower order —
        // see recomputeRatioFromAggregatedContext doc comment).
        const { value, coverageRatio } =
          this.recomputeRatioFromAggregatedContext(kpi, results, tactics);

        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        if (
          coverageRatio === 1 &&
          value !== null &&
          kpi.ragGreenThreshold !== undefined &&
          kpi.ragGreenThreshold !== null
        ) {
          ragStatus = this.determineRagStatus(
            value,
            kpi.ragGreenThreshold,
            kpi.ragAmberThreshold,
          );
        }

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus,
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
        const fullCoverage = coverageRatio === 1;

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
        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        if (
          fullCoverage &&
          kpi.ragGreenThreshold !== undefined &&
          kpi.ragGreenThreshold !== null &&
          aggregated !== null
        ) {
          // FU RAG: use worst-case from SKUs
          const skuRags = skuResults
            .map((sr) => sr[kpi.kpiCode]?.ragStatus)
            .filter(Boolean) as string[];

          if (skuRags.includes('RED')) ragStatus = 'RED';
          else if (skuRags.includes('AMBER')) ragStatus = 'AMBER';
          else if (skuRags.length > 0) ragStatus = 'GREEN';
        }

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value: aggregated,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus,
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

        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        if (
          kpi.ragGreenThreshold !== undefined &&
          kpi.ragGreenThreshold !== null &&
          value !== null
        ) {
          ragStatus = this.determineRagStatus(
            value,
            kpi.ragGreenThreshold,
            kpi.ragAmberThreshold,
          );
        }

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus,
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

        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        if (
          kpi.ragGreenThreshold !== undefined &&
          kpi.ragGreenThreshold !== null &&
          value !== null
        ) {
          ragStatus = this.determineRagStatus(
            value,
            kpi.ragGreenThreshold,
            kpi.ragAmberThreshold,
          );
        }

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus,
        };
      } else if (kpi.aggregationMethodFu === AggregationMethod.WEIGHTED_AVG) {
        // T-177 step 2: same re-derivation as calculateFu's WEIGHTED_AVG
        // branch, one level up — Σ INCR_GP / Σ TOTAL_PLANNED_SPEND across
        // FUs, not mean(FU-level GP_ROI_PCT). `results` already holds every
        // FU-summed dependency by the time a ratio KPI's calculationOrder
        // is reached (same ordering guarantee as calculateFu).
        const { value, coverageRatio } =
          this.recomputeRatioFromAggregatedContext(kpi, results, {});

        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        if (
          coverageRatio === 1 &&
          value !== null &&
          kpi.ragGreenThreshold !== undefined &&
          kpi.ragGreenThreshold !== null
        ) {
          ragStatus = this.determineRagStatus(
            value,
            kpi.ragGreenThreshold,
            kpi.ragAmberThreshold,
          );
        }

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus,
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
        const fullCoverage = coverageRatio === 1;

        const aggregated = this.aggregate(
          values,
          kpi.aggregationMethodFu || AggregationMethod.SUM,
        );

        // Plan RAG: aggregate from FU RAGs — only on full coverage (T-177,
        // product owner 2026-08-11; see calculateFu for the rationale).
        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        if (fullCoverage) {
          const fuRags = fuResults
            .map((fr) => fr[kpi.kpiCode]?.ragStatus)
            .filter(Boolean) as string[];

          if (fuRags.includes('RED')) ragStatus = 'RED';
          else if (fuRags.includes('AMBER')) ragStatus = 'AMBER';
          else if (fuRags.length > 0) ragStatus = 'GREEN';
        }

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value: aggregated,
          coverageRatio,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus,
        };
      }
    }

    return results;
  }

  /**
   * Determine RAG status based on configurable thresholds
   */
  private determineRagStatus(
    value: number,
    greenThreshold?: number,
    amberThreshold?: number,
  ): 'RED' | 'AMBER' | 'GREEN' {
    if (
      greenThreshold !== undefined &&
      greenThreshold !== null &&
      value >= Number(greenThreshold)
    ) {
      return 'GREEN';
    }
    if (
      amberThreshold !== undefined &&
      amberThreshold !== null &&
      value >= Number(amberThreshold)
    ) {
      return 'AMBER';
    }
    return 'RED';
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
        // recomputeRatioFromAggregatedContext BEFORE this method is called
        // — mean(ratio) != Σnum/Σden, and averaging the raw per-child
        // ratios here (the previous behaviour) is exactly the bug this
        // task closes. Throwing (instead of silently falling back to a
        // naive average again) turns any future code path that skips the
        // recompute step into a loud failure instead of a silently wrong
        // number (§2.5).
        throw new Error(
          `KpiEngineService.aggregate() received WEIGHTED_AVG directly — ` +
            `this method must be re-derived via ` +
            `recomputeRatioFromAggregatedContext(), not averaged as raw ` +
            `values (T-177).`,
        );
      default:
        return values.reduce((a, b) => a + b, 0);
    }
  }

  /**
   * T-177 step 2: re-derive a ratio KPI (calculationLevel SKU,
   * aggregationMethodFu = WEIGHTED_AVG — UPLIFT_PCT/GP_ROI_PCT/GP_MARGIN_PCT,
   * kpi.seed.ts) from its own formula run against the ALREADY-aggregated
   * dependency values, instead of averaging the per-child ratio values.
   * A ratio's mean is not the ratio of the sums; e.g.
   * GP_ROI_PCT = INCR_GP / TOTAL_PLANNED_SPEND * 100 must be
   * Σ INCR_GP / Σ TOTAL_PLANNED_SPEND * 100, not mean(per-SKU GP_ROI_PCT).
   *
   * Precondition: `results` already contains every dependency this
   * formula references. This holds because `getActiveKpis` orders by
   * `calculationOrder` ASC and every WEIGHTED_AVG ratio KPI's dependencies
   * have a strictly lower calculationOrder (verified against kpi.seed.ts:
   * UPLIFT_PCT(21) <- PLAN_VOL(2)/BASE_VOL(1); GP_ROI_PCT(48) <-
   * INCR_GP(46)/TOTAL_PLANNED_SPEND(9); GP_MARGIN_PCT(49) <-
   * PLANNED_GP(36)/PLANNED_TO(26)) — so by the time the caller's `kpis`
   * loop reaches this KPI, every dependency has already been written into
   * `results` in this same loop.
   *
   * `coverageRatio` is the minimum coverage across the formula's own
   * dependencies (as already aggregated into `results`) — a ratio built
   * from a numerator with 40% SKU coverage is itself only as trustworthy
   * as that 40%, even if the denominator has 100%.
   */
  private recomputeRatioFromAggregatedContext(
    kpi: Kpi,
    results: Record<string, CalculationResult>,
    extraContext: Record<string, any>,
  ): { value: number | null; coverageRatio: number | null } {
    const formula = this.getOrParseFormula(kpi);

    const contextMap: Record<string, any> = { ...extraContext };
    for (const [code, result] of Object.entries(results)) {
      contextMap[code] = result.value;
    }

    const value = formula.execute(contextMap);

    const depCoverages = formula.dependencies
      .map((dep) => results[dep]?.coverageRatio)
      .filter((c): c is number => c !== null && c !== undefined);
    const coverageRatio =
      depCoverages.length > 0 ? Math.min(...depCoverages) : null;

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
