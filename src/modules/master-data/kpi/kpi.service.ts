import {
  Injectable,
  ConflictException,
  Inject,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { KpiRepository } from './kpi.repository';
import { CreateKpiDto } from './dto/create-kpi.dto';
import { UpdateKpiDto } from './dto/update-kpi.dto';
import {
  Kpi,
  FormulaType,
  CalculationLevel,
  DisplayFormat,
  AggregationMethod,
} from '../../../database/entities/kpi.entity';
import {
  PlanService,
  PlanActor,
} from '../../modes/planning-first/plan/plan.service';
import { KpiEngineService } from '../../shared/kpi-engine/kpi-engine.service';
import {
  GP_ROI_PCT_FORMULA,
  GP_ROI_PCT_DESCRIPTION,
  GP_ROI_PCT_DEPENDS_ON,
} from '../../../common/kpi/roi-denominator';

@Injectable()
export class KpiService {
  constructor(
    private readonly kpiRepository: KpiRepository,
    @Inject(forwardRef(() => PlanService))
    private readonly planService: PlanService,
    private readonly kpiEngineService: KpiEngineService,
  ) {}

  async create(tenantId: string, createKpiDto: CreateKpiDto): Promise<Kpi> {
    const existing = await this.kpiRepository.findByCode(
      tenantId,
      createKpiDto.kpiCode,
    );
    if (existing) {
      throw new ConflictException('Bu KPI kodu zaten mevcut');
    }

    // Auto-extract dependencies from formula if not provided
    const dependsOnKpis =
      createKpiDto.dependsOnKpis ||
      this.extractDependencies(createKpiDto.formulaText);

    const kpi = this.kpiRepository.create({
      ...createKpiDto,
      dependsOnKpis,
      tenantId,
      isActive: createKpiDto.isActive ?? true,
      showInGrid: createKpiDto.showInGrid ?? true,
      decimalPlaces: createKpiDto.decimalPlaces ?? 2,
    });

    const saved = await this.kpiRepository.save(kpi);
    // T-039: a new KPI can be inactive-toggled/referenced immediately by a
    // subsequent recalc; also cheap insurance against a stale `false ->
    // getActiveKpis` cache miss race. Formula-affecting mutations must never
    // be served from a bayat (stale) engine cache — see kpi-engine.service.ts
    // getActiveKpis 60s TTL.
    this.kpiEngineService.clearCache(tenantId);
    return saved;
  }

  async findAll(tenantId: string, activeOnly = false): Promise<Kpi[]> {
    return this.kpiRepository.findAllByTenant(tenantId, activeOnly);
  }

  async findOne(tenantId: string, id: string): Promise<Kpi> {
    const kpi = await this.kpiRepository.findOne({
      where: { tenantId, id },
    });

    if (!kpi) {
      throw new NotFoundException(`KPI with ID ${id} not found`);
    }

    return kpi;
  }

  async findGridKpis(tenantId: string): Promise<Kpi[]> {
    return this.kpiRepository.findGridKpis(tenantId);
  }

  async getGridKpisForPlan(
    planId: string,
    tenantId: string,
    actor?: PlanActor,
  ): Promise<Kpi[]> {
    // Get plan information. T-028c SHOULD-FIX: routed through PlanService
    // (not the raw repository) so an out-of-scope PLANNER's assertReadScope
    // 404 applies here too — otherwise this endpoint would still leak plan
    // existence via a 200-vs-404 oracle even though it never returns plan
    // content (grid KPI defs only).
    await this.planService.findById(planId, tenantId, actor);

    // Get KPIs that should be shown in grid
    // show_in_grid = true olanları getir
    // column_order'a göre sırala
    const kpis = await this.kpiRepository.find({
      where: {
        tenantId,
        isActive: true,
        showInGrid: true,
      },
      order: {
        columnOrder: 'ASC',
        calculationOrder: 'ASC',
      },
    });

    // İsteğe bağlı: Plan'ın channel/category'sine göre filtreleme
    // (şimdilik tüm aktif KPI'ları döndür)

    return kpis;
  }

  async findCalculableKpis(tenantId: string): Promise<Kpi[]> {
    return this.kpiRepository.findCalculableKpis(tenantId);
  }

  async update(
    tenantId: string,
    id: string,
    updateKpiDto: UpdateKpiDto,
  ): Promise<Kpi> {
    const kpi = await this.findOne(tenantId, id);

    if (updateKpiDto.kpiCode && updateKpiDto.kpiCode !== kpi.kpiCode) {
      const existing = await this.kpiRepository.findByCode(
        tenantId,
        updateKpiDto.kpiCode,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException('Bu KPI kodu zaten mevcut');
      }
    }

    // Auto-extract dependencies if formula changed
    if (updateKpiDto.formulaText && !updateKpiDto.dependsOnKpis) {
      updateKpiDto.dependsOnKpis = this.extractDependencies(
        updateKpiDto.formulaText,
      );
    }

    // T-039: `version` is the optimistic-locking CAS token, not a KPI
    // column to persist — strip it out of the write payload.
    const { version: expectedVersion, ...updateFields } = updateKpiDto;

    const updated =
      expectedVersion !== undefined
        ? await this.kpiRepository.updateVersioned(
            tenantId,
            id,
            expectedVersion,
            updateFields as Partial<Kpi>,
          )
        : await this.kpiRepository.updateUnversioned(
            tenantId,
            id,
            updateFields as Partial<Kpi>,
          );

    // T-039: this is THE fix for the dynamic-formula-cache staleness bug —
    // `KpiEngineService#getActiveKpis` caches the tenant's active KPI list
    // (formula_text + rag thresholds included) for up to 60s and nothing
    // invalidated it on write before this change (`clearCache` had zero
    // non-test callers). Without this, an Admin's formula/threshold edit
    // could silently keep driving calculations off the OLD formula for up
    // to 60 seconds after a 200 response — a direct violation of the BRD's
    // "hesaplamalar dinamiktir" principle.
    this.kpiEngineService.clearCache(tenantId);

    return updated;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const kpi = await this.findOne(tenantId, id);
    await this.kpiRepository.softRemove(kpi);
    this.kpiEngineService.clearCache(tenantId);
  }

  /**
   * Validate a formula string and return validation result
   */
  validateFormula(
    formula: string,
    formulaType: string,
  ): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    dependencies: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!formula || formula.trim().length === 0) {
      errors.push('Formül boş olamaz');
      return { isValid: false, errors, warnings, dependencies: [] };
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      'eval',
      'require',
      'import',
      'process',
      'global',
      'window',
    ];
    for (const pattern of dangerousPatterns) {
      if (formula.toLowerCase().includes(pattern)) {
        errors.push(`Güvenlik: "${pattern}" kullanılamaz`);
      }
    }

    // Check balanced parentheses
    let parenCount = 0;
    for (const char of formula) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) break;
    }
    if (parenCount !== 0) {
      errors.push('Parantezler dengeli değil');
    }

    const dependencies = this.extractDependencies(formula);
    if (dependencies.length === 0 && formulaType === 'expression') {
      warnings.push('Formülde hiç KPI referansı bulunamadı');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      dependencies,
    };
  }

  /**
   * Seed default KPI definitions per BRD document.
   * Uses upsert semantics: inserts if not found, updates formula_text if found.
   * This ensures existing tenants always have BRD-correct formulas.
   *
   * Calculation dependency order (MUST be respected — engine executes in this order):
   *   Inputs/external (1-10) → GSV/LTA/TO (11-30) → COGS/GP (31-45) → INCR (46-47) → ROI (48-49)
   *   All values must satisfy constraint CHK_KPIS_CALCULATION_ORDER: > 0 AND <= 50
   */
  async seedDefaults(tenantId: string): Promise<Kpi[]> {
    // Fields that are safe to upsert (formula_text always updated to BRD value)
    const UPSERT_FORMULA_FIELDS: Array<keyof Kpi> = [
      'formulaText',
      'formulaType',
      'kpiName',
      'kpiDescription',
      'calculationOrder',
      'dependsOnKpis',
    ];

    const defaults: Array<Partial<Kpi>> = [
      // ── LEVEL 1: User inputs ─────────────────────────────────────────────
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
      // ── LEVEL 2: External values injected by recalc context ──────────────
      // These are computed by SpendCalculationService and fed into the engine.
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
      // ── LEVEL 5: Turnover (BRD NIV semantics — T-008 fix) ────────────────
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
      // ── LEVEL 6: COGS (BRD: BASE_COGS=BASE_VOL*COGS ; PLANNED_COGS=PLAN_VOL*COGS) ──
      {
        kpiCode: 'BASE_COGS',
        kpiName: 'Base COGS',
        kpiGroup: 'Cost',
        kpiDescription:
          'Base cost of goods sold: BASE_VOL * COGS (BRD formula)',
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
        kpiDescription:
          'Planned cost of goods sold: PLAN_VOL * COGS (BRD formula)',
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
      // ── LEVEL 7: Gross Profit (BRD: BASE_GP=BASE_TO-BASE_COGS ; PLANNED_GP=PLANNED_TO-PLANNED_COGS) ──
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
      // ── LEVEL 8: Incremental GP (BRD: INCR_GP=PLANNED_GP-BASE_GP) ─────────
      {
        kpiCode: 'INCR_GP',
        kpiName: 'Incremental Gross Profit',
        kpiGroup: 'Profit',
        kpiDescription:
          'Incremental gross profit: PLANNED_GP - BASE_GP (BRD formula) — MUST be calculated before GP_ROI_PCT',
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
      // ── LEVEL 9: CPP_ON_SPEND (BRD: CPP_ON_SPEND=(PLANNED_GSV-PLANNED_LTA_ON)*(CPP_ON_PCT/100)) ──
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

    const upserted: Kpi[] = [];
    for (const def of defaults) {
      const existing = await this.kpiRepository.findByCode(
        tenantId,
        def.kpiCode!,
      );
      if (!existing) {
        const kpi = this.kpiRepository.create({
          ...def,
          tenantId,
        });
        const saved = await this.kpiRepository.save(kpi);
        upserted.push(saved);
      } else {
        // Upsert: update BRD-critical fields so existing tenants get correct formulas
        let changed = false;
        for (const field of UPSERT_FORMULA_FIELDS) {
          if (def[field] !== undefined) {
            // Use JSON.stringify for array/object fields to avoid always-truthy
            // reference inequality (e.g. dependsOnKpis is a JS array).
            const defVal = def[field];
            const existVal = (existing as any)[field];
            const isDifferent =
              Array.isArray(defVal) ||
              (defVal !== null && typeof defVal === 'object')
                ? JSON.stringify(existVal) !== JSON.stringify(defVal)
                : existVal !== defVal;
            if (isDifferent) {
              (existing as any)[field] = defVal;
              changed = true;
            }
          }
        }
        if (changed) {
          const saved = await this.kpiRepository.save(existing);
          upserted.push(saved);
        }
      }
    }

    if (upserted.length > 0) {
      // T-039: seedDefaults upserts formula_text on existing KPIs too — same
      // staleness risk as `update()`.
      this.kpiEngineService.clearCache(tenantId);
    }

    return upserted;
  }

  /**
   * Extract KPI code dependencies from a formula text
   * Matches UPPERCASE_WITH_UNDERSCORES patterns, excluding known functions
   */
  private extractDependencies(formulaText: string): string[] {
    const functionNames = new Set([
      'IF',
      'SUM',
      'AVG',
      'MIN',
      'MAX',
      'ABS',
      'ROUND',
      'FLOOR',
      'CEIL',
    ]);
    const variablePattern = /\b([A-Z][A-Z0-9_]+)\b/g;
    const matches = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = variablePattern.exec(formulaText)) !== null) {
      const varName = match[1];
      if (!functionNames.has(varName)) {
        matches.add(varName);
      }
    }

    return Array.from(matches);
  }
}
