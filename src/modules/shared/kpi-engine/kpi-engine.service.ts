import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kpi, FormulaType, CalculationLevel, AggregationMethod } from '../../../database/entities/kpi.entity';
import { FormulaParserService, ParsedFormula } from './formula-parser.service';

export interface SkuCalculationContext {
  // User inputs & master data
  BASE_VOL: number;
  PLAN_VOL: number;
  BPTT: number; // Base Price To Trade (unit price)
  COGS: number; // Cost of Goods Sold per unit
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
    const skuKpis = kpis.filter(k => k.calculationLevel === CalculationLevel.SKU);
    
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
      if (kpi.ragGreenThreshold !== undefined && kpi.ragGreenThreshold !== null && value !== null) {
        ragStatus = this.determineRagStatus(value, kpi.ragGreenThreshold, kpi.ragAmberThreshold);
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
      if (kpi.calculationLevel === CalculationLevel.SKU) {
        // Aggregate SKU values to FU using aggregation method
        const values = skuResults
          .map(sr => sr[kpi.kpiCode]?.value)
          .filter((v): v is number => v !== null && v !== undefined);

        const aggregated = this.aggregate(values, kpi.aggregationMethodFu || AggregationMethod.SUM);

        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        if (kpi.ragGreenThreshold !== undefined && kpi.ragGreenThreshold !== null && aggregated !== null) {
          // FU RAG: use worst-case from SKUs
          const skuRags = skuResults
            .map(sr => sr[kpi.kpiCode]?.ragStatus)
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
        if (kpi.ragGreenThreshold !== undefined && kpi.ragGreenThreshold !== null && value !== null) {
          ragStatus = this.determineRagStatus(value, kpi.ragGreenThreshold, kpi.ragAmberThreshold);
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
        if (kpi.ragGreenThreshold !== undefined && kpi.ragGreenThreshold !== null && value !== null) {
          ragStatus = this.determineRagStatus(value, kpi.ragGreenThreshold, kpi.ragAmberThreshold);
        }

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value,
          displayFormat: kpi.displayFormat,
          decimalPlaces: kpi.decimalPlaces,
          ragStatus,
        };
      } else {
        // Aggregate from FU level
        const values = fuResults
          .map(fr => fr[kpi.kpiCode]?.value)
          .filter((v): v is number => v !== null && v !== undefined);

        const aggregated = this.aggregate(values, kpi.aggregationMethodFu || AggregationMethod.SUM);

        // Plan RAG: aggregate from FU RAGs
        let ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null;
        const fuRags = fuResults
          .map(fr => fr[kpi.kpiCode]?.ragStatus)
          .filter(Boolean) as string[];
        
        if (fuRags.includes('RED')) ragStatus = 'RED';
        else if (fuRags.includes('AMBER')) ragStatus = 'AMBER';
        else if (fuRags.length > 0) ragStatus = 'GREEN';

        results[kpi.kpiCode] = {
          kpiCode: kpi.kpiCode,
          value: aggregated,
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
    if (greenThreshold !== undefined && greenThreshold !== null && value >= Number(greenThreshold)) {
      return 'GREEN';
    }
    if (amberThreshold !== undefined && amberThreshold !== null && value >= Number(amberThreshold)) {
      return 'AMBER';
    }
    return 'RED';
  }

  /**
   * Aggregate an array of values using specified method
   */
  private aggregate(values: number[], method: AggregationMethod): number | null {
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
        // Default to simple average if no weights
        return values.reduce((a, b) => a + b, 0) / values.length;
      default:
        return values.reduce((a, b) => a + b, 0);
    }
  }

  /**
   * Get or parse formula from cache
   */
  private getOrParseFormula(kpi: Kpi): ParsedFormula {
    const cacheKey = `${kpi.id}:${kpi.formulaText}`;
    
    if (!this.formulaCache.has(cacheKey)) {
      const formula = this.formulaParser.parseFormula(kpi.formulaText, kpi.formulaType);
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
