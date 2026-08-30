/**
 * KPI Seed — BRD Kanonik Formül Listesi
 *
 * Idempotent upsert: INSERT if not found, UPDATE formula_text (and key fields)
 * if found. This ensures existing tenants always get BRD-correct formulas.
 *
 * Dependency order follows KPI calculation_order (engine executes ASC):
 *   Inputs (1-11) → GSV (15-16) → Volume (20-21) → TO (25-26) →
 *   COGS (30-31) → GP (35-36) → INCR_GP (46) → CPP (47) → ROI (48-49)
 */
import { DataSource, Repository } from 'typeorm';
import {
  GP_ROI_PCT_FORMULA,
  GP_ROI_PCT_DESCRIPTION,
  GP_ROI_PCT_DEPENDS_ON,
} from '../../common/kpi/roi-denominator';
import {
  Kpi,
  FormulaType,
  CalculationLevel,
  DisplayFormat,
  AggregationMethod,
} from '../entities/kpi.entity';

export type KpiSeedRow = Omit<Partial<Kpi>, 'tenantId'>;

/** Fields always overwritten when an existing row is found (upsert). */
const UPSERT_FIELDS: Array<keyof KpiSeedRow> = [
  'formulaText',
  'formulaType',
  'kpiName',
  'kpiDescription',
  'calculationOrder',
  'dependsOnKpis',
];

// T-163 / ADR 0011: exported (read-only) so tests can pin the seed contract
// (the array's VALUES are untouched — only visibility changed) without
// re-implementing this list. seedKpis() is idempotent upsert and always
// overwrites formula_text — see UPSERT_FIELDS above — so a test that pins
// this array is the only thing standing between `npm run seed` and silently
// reverting ADR 0011.
export const KPI_DEFAULTS: KpiSeedRow[] = [
  // ── LEVEL 1: User inputs ───────────────────────────────────────────────
  {
    kpiCode: 'BASE_VOL',
    kpiName: 'Base Volume',
    kpiGroup: 'Volume',
    kpiDescription: 'Historical baseline volume (user input)',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'BASE_VOL',
    calculationOrder: 1,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.NUMBER,
    decimalPlaces: 0,
    showInGrid: true,
    columnOrder: 1,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'PLAN_VOL',
    kpiName: 'Planned Volume',
    kpiGroup: 'Volume',
    kpiDescription: 'Planned promotion volume (user input)',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'PLAN_VOL',
    calculationOrder: 2,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.NUMBER,
    decimalPlaces: 0,
    showInGrid: true,
    columnOrder: 2,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 2: External values injected by recalc context (SpendCalc) ────
  {
    kpiCode: 'PLANNED_LTA_ON',
    kpiName: 'Planned LTA On-Invoice',
    kpiGroup: 'Spend',
    kpiDescription:
      'Planned LTA on-invoice deduction (context-injected from SpendCalc)',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'PLANNED_LTA_ON',
    calculationOrder: 5,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'PLANNED_LTA_OFF',
    kpiName: 'Planned LTA Off-Invoice',
    kpiGroup: 'Spend',
    kpiDescription:
      'Planned LTA off-invoice deduction (context-injected from SpendCalc)',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'PLANNED_LTA_OFF',
    calculationOrder: 6,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'BASE_LTA_ON',
    kpiName: 'Base LTA On-Invoice',
    kpiGroup: 'Spend',
    kpiDescription:
      'Base LTA on-invoice deduction (context-injected from SpendCalc)',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'BASE_LTA_ON',
    calculationOrder: 7,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'BASE_LTA_OFF',
    kpiName: 'Base LTA Off-Invoice',
    kpiGroup: 'Spend',
    kpiDescription:
      'Base LTA off-invoice deduction (context-injected from SpendCalc)',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'BASE_LTA_OFF',
    calculationOrder: 8,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'TOTAL_PLANNED_SPEND',
    kpiName: 'Total Planned Spend',
    kpiGroup: 'Spend',
    kpiDescription:
      'Sum of all planned spend (LTA + promo); context-injected from SpendCalc',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'TOTAL_PLANNED_SPEND',
    calculationOrder: 9,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: true,
    columnOrder: 6,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'BASE_TOTAL_SPEND',
    kpiName: 'Base Total Spend',
    kpiGroup: 'Spend',
    kpiDescription:
      'Base total spend (LTA only, no promo); context-injected from SpendCalc',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'BASE_TOTAL_SPEND',
    calculationOrder: 10,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'INCR_SPEND',
    kpiName: 'Incremental Spend',
    kpiGroup: 'Spend',
    kpiDescription:
      'TOTAL_PLANNED_SPEND - BASE_TOTAL_SPEND; context-injected from SpendCalc',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'INCR_SPEND',
    calculationOrder: 11,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 3: GSV (BRD: BASE_GSV=BASE_VOL*BPTT ; PLANNED_GSV=PLAN_VOL*BPTT) ──
  {
    kpiCode: 'BASE_GSV',
    kpiName: 'Base GSV',
    kpiGroup: 'Revenue',
    kpiDescription:
      'Base Gross Sales Value: BASE_VOL * BPTT (BRD formula level 3)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'BASE_VOL * BPTT',
    dependsOnKpis: ['BASE_VOL', 'BPTT'],
    calculationOrder: 15,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'PLANNED_GSV',
    kpiName: 'Planned GSV',
    kpiGroup: 'Revenue',
    kpiDescription:
      'Planned Gross Sales Value: PLAN_VOL * BPTT (BRD formula level 3)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLAN_VOL * BPTT',
    dependsOnKpis: ['PLAN_VOL', 'BPTT'],
    calculationOrder: 16,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 4: Volume KPIs ──────────────────────────────────────────────
  {
    kpiCode: 'INCR_VOL',
    kpiName: 'Incremental Volume',
    kpiGroup: 'Volume',
    kpiDescription: 'Planned minus base volume: PLAN_VOL - BASE_VOL',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLAN_VOL - BASE_VOL',
    dependsOnKpis: ['PLAN_VOL', 'BASE_VOL'],
    calculationOrder: 20,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.NUMBER,
    decimalPlaces: 0,
    showInGrid: true,
    columnOrder: 3,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'UPLIFT_PCT',
    kpiName: 'Uplift %',
    kpiGroup: 'Volume',
    kpiDescription:
      'Volume uplift percentage: (PLAN_VOL - BASE_VOL) / BASE_VOL * 100',
    formulaType: FormulaType.EXPRESSION,
    formulaText: '(PLAN_VOL - BASE_VOL) / BASE_VOL * 100',
    dependsOnKpis: ['PLAN_VOL', 'BASE_VOL'],
    calculationOrder: 21,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.PERCENTAGE,
    decimalPlaces: 1,
    showInGrid: true,
    columnOrder: 4,
    aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
    isActive: true,
  },
  // ── LEVEL 4.5: On-invoice spend total (context-injected) ─────────────
  {
    kpiCode: 'PLANNED_ON_INVOICE_SPEND',
    kpiName: 'Planned On-Invoice Spend',
    kpiGroup: 'Spend',
    kpiDescription:
      'Total planned on-invoice deductions (LTA_ON + all on-invoice promo); context-injected from SpendCalc (T-008)',
    formulaType: FormulaType.EXTERNAL,
    formulaText: 'PLANNED_ON_INVOICE_SPEND',
    calculationOrder: 12,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 5: Turnover (BRD NIV semantics) ────────────────────────────
  // Only on-invoice deductions reduce Turnover/NIV (BRD T-008 fix).
  // Off-invoice spend (lumpsum VIS_LS, price-support-off, LTA_OFF) does NOT
  // reduce turnover; it is captured in GP via incremental spend.
  {
    kpiCode: 'BASE_TO',
    kpiName: 'Base Turnover',
    kpiGroup: 'Revenue',
    kpiDescription:
      'Base net turnover: BASE_GSV - BASE_LTA_ON (BRD NIV semantics — only on-invoice; T-008)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'BASE_GSV - BASE_LTA_ON',
    dependsOnKpis: ['BASE_GSV', 'BASE_LTA_ON'],
    calculationOrder: 25,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'PLANNED_TO',
    kpiName: 'Planned Turnover',
    kpiGroup: 'Revenue',
    kpiDescription:
      'Planned net turnover: PLANNED_GSV - PLANNED_ON_INVOICE_SPEND (BRD NIV semantics — only on-invoice deductions; T-008)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLANNED_GSV - PLANNED_ON_INVOICE_SPEND',
    dependsOnKpis: ['PLANNED_GSV', 'PLANNED_ON_INVOICE_SPEND'],
    calculationOrder: 26,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: true,
    columnOrder: 5,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 6: COGS (BRD) ───────────────────────────────────────────────
  {
    kpiCode: 'BASE_COGS',
    kpiName: 'Base COGS',
    kpiGroup: 'Cost',
    kpiDescription: 'Base cost of goods sold: BASE_VOL * COGS (BRD formula)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'BASE_VOL * COGS',
    dependsOnKpis: ['BASE_VOL', 'COGS'],
    calculationOrder: 30,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'PLANNED_COGS',
    kpiName: 'Planned COGS',
    kpiGroup: 'Cost',
    kpiDescription: 'Planned cost of goods sold: PLAN_VOL * COGS (BRD formula)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLAN_VOL * COGS',
    dependsOnKpis: ['PLAN_VOL', 'COGS'],
    calculationOrder: 31,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 7: Gross Profit (BRD) ───────────────────────────────────────
  {
    kpiCode: 'BASE_GP',
    kpiName: 'Base Gross Profit',
    kpiGroup: 'Profit',
    kpiDescription: 'Base gross profit: BASE_TO - BASE_COGS (BRD formula)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'BASE_TO - BASE_COGS',
    dependsOnKpis: ['BASE_TO', 'BASE_COGS'],
    calculationOrder: 35,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  {
    kpiCode: 'PLANNED_GP',
    kpiName: 'Planned Gross Profit',
    kpiGroup: 'Profit',
    kpiDescription:
      'Planned gross profit: PLANNED_TO - PLANNED_COGS (BRD formula)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLANNED_TO - PLANNED_COGS',
    dependsOnKpis: ['PLANNED_TO', 'PLANNED_COGS'],
    calculationOrder: 36,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 8: INCR_GP (BRD: INCR_GP=PLANNED_GP-BASE_GP) ──────────────
  {
    kpiCode: 'INCR_GP',
    kpiName: 'Incremental Gross Profit',
    kpiGroup: 'Profit',
    kpiDescription:
      'Incremental gross profit: PLANNED_GP - BASE_GP (BRD formula) — MUST be before GP_ROI_PCT',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLANNED_GP - BASE_GP',
    dependsOnKpis: ['PLANNED_GP', 'BASE_GP'],
    calculationOrder: 46,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: true,
    columnOrder: 7,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 9: CPP_ON_SPEND (BRD formula) ──────────────────────────────
  {
    kpiCode: 'CPP_ON_SPEND',
    kpiName: 'CPP On-Invoice Spend',
    kpiGroup: 'Spend',
    kpiDescription:
      'CPP on-invoice spend: (PLANNED_GSV - PLANNED_LTA_ON) * (CPP_ON_PCT / 100) (BRD formula)',
    formulaType: FormulaType.EXPRESSION,
    formulaText: '(PLANNED_GSV - PLANNED_LTA_ON) * CPP_ON_PCT / 100',
    dependsOnKpis: ['PLANNED_GSV', 'PLANNED_LTA_ON', 'CPP_ON_PCT'],
    calculationOrder: 47,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.CURRENCY,
    decimalPlaces: 2,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.SUM,
    isActive: true,
  },
  // ── LEVEL 10: ROI (BRD canonical: GP_ROI_PCT=INCR_GP/TOTAL_PLANNED_SPEND*100) ─
  // ADR 0011 (2026-08-10): payda INCR_SPEND'ten TOTAL_PLANNED_SPEND'e düzeltildi.
  // Bkz. docs/decisions/0011-gp-roi-paydasi-total-planned-spend.md ve
  // migration 1801000000000-FixGpRoiPctDenominator.
  // calculation_order 48/49: must be ≤50 (CHK_KPIS_CALCULATION_ORDER constraint)
  {
    kpiCode: 'GP_ROI_PCT',
    kpiName: 'GP ROI %',
    kpiGroup: 'ROI',
    kpiDescription: GP_ROI_PCT_DESCRIPTION,
    formulaType: FormulaType.EXPRESSION,
    // `Z62 §6-3` / `B4` — TEK NOKTA (src/common/kpi/roi-denominator.ts).
    // ⛔ Payda burada SABİTLENMEZ; dizge elle tekrarlanmaz.
    formulaText: GP_ROI_PCT_FORMULA,
    dependsOnKpis: [...GP_ROI_PCT_DEPENDS_ON],
    calculationOrder: 48,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.PERCENTAGE,
    decimalPlaces: 1,
    showInGrid: true,
    columnOrder: 8,
    aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
    ragGreenThreshold: 20,
    ragAmberThreshold: 10,
    isActive: true,
  },
  {
    kpiCode: 'GP_MARGIN_PCT',
    kpiName: 'GP Margin %',
    kpiGroup: 'Profit',
    kpiDescription:
      'Planned GP as percentage of planned turnover: PLANNED_GP / PLANNED_TO * 100',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLANNED_GP / PLANNED_TO * 100',
    dependsOnKpis: ['PLANNED_GP', 'PLANNED_TO'],
    calculationOrder: 49,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.PERCENTAGE,
    decimalPlaces: 1,
    showInGrid: false,
    aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
    isActive: true,
  },
];

/**
 * Seed KPI definitions for a given tenant.
 * Returns list of inserted/updated rows.
 */
export async function seedKpis(
  dataSource: DataSource,
  tenantId: string,
): Promise<Kpi[]> {
  const repo: Repository<Kpi> = dataSource.getRepository(Kpi);
  const upserted: Kpi[] = [];

  for (const def of KPI_DEFAULTS) {
    const existing = await repo.findOne({
      where: { tenantId, kpiCode: def.kpiCode },
    });

    if (!existing) {
      const entity = repo.create({ ...def, tenantId } as Kpi);
      const saved = await repo.save(entity);
      upserted.push(saved);
      console.log(`   [KPI] INSERT ${def.kpiCode}`);
    } else {
      let changed = false;
      for (const field of UPSERT_FIELDS) {
        const newVal = (def as any)[field];
        if (newVal !== undefined) {
          const existVal = (existing as any)[field];
          // Use JSON.stringify for array/object fields (e.g. dependsOnKpis) to
          // avoid always-truthy reference inequality on structurally equal arrays.
          const isDifferent =
            Array.isArray(newVal) ||
            (newVal !== null && typeof newVal === 'object')
              ? JSON.stringify(existVal) !== JSON.stringify(newVal)
              : existVal !== newVal;
          if (isDifferent) {
            (existing as any)[field] = newVal;
            changed = true;
          }
        }
      }
      if (changed) {
        const saved = await repo.save(existing);
        upserted.push(saved);
        console.log(`   [KPI] UPSERT ${def.kpiCode} (formula updated)`);
      }
    }
  }

  return upserted;
}
