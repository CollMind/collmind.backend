import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { KpiRepository } from './kpi.repository';
import { CreateKpiDto } from './dto/create-kpi.dto';
import { UpdateKpiDto } from './dto/update-kpi.dto';
import { Kpi, FormulaType, CalculationLevel, DisplayFormat, AggregationMethod } from '../../../database/entities/kpi.entity';

@Injectable()
export class KpiService {
  constructor(private readonly kpiRepository: KpiRepository) {}

  async create(tenantId: string, createKpiDto: CreateKpiDto): Promise<Kpi> {
    const existing = await this.kpiRepository.findByCode(tenantId, createKpiDto.kpiCode);
    if (existing) {
      throw new ConflictException('Bu KPI kodu zaten mevcut');
    }

    // Auto-extract dependencies from formula if not provided
    const dependsOnKpis = createKpiDto.dependsOnKpis || this.extractDependencies(createKpiDto.formulaText);

    const kpi = this.kpiRepository.create({
      ...createKpiDto,
      dependsOnKpis,
      tenantId,
      isActive: createKpiDto.isActive ?? true,
      showInGrid: createKpiDto.showInGrid ?? true,
      decimalPlaces: createKpiDto.decimalPlaces ?? 2,
    });

    return this.kpiRepository.save(kpi);
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

  async findCalculableKpis(tenantId: string): Promise<Kpi[]> {
    return this.kpiRepository.findCalculableKpis(tenantId);
  }

  async update(tenantId: string, id: string, updateKpiDto: UpdateKpiDto): Promise<Kpi> {
    const kpi = await this.findOne(tenantId, id);

    if (updateKpiDto.kpiCode && updateKpiDto.kpiCode !== kpi.kpiCode) {
      const existing = await this.kpiRepository.findByCode(tenantId, updateKpiDto.kpiCode);
      if (existing && existing.id !== id) {
        throw new ConflictException('Bu KPI kodu zaten mevcut');
      }
    }

    // Auto-extract dependencies if formula changed
    if (updateKpiDto.formulaText && !updateKpiDto.dependsOnKpis) {
      updateKpiDto.dependsOnKpis = this.extractDependencies(updateKpiDto.formulaText);
    }

    Object.assign(kpi, updateKpiDto);
    return this.kpiRepository.save(kpi);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const kpi = await this.findOne(tenantId, id);
    await this.kpiRepository.softRemove(kpi);
  }

  /**
   * Validate a formula string and return validation result
   */
  validateFormula(formula: string, formulaType: string): {
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
    const dangerousPatterns = ['eval', 'require', 'import', 'process', 'global', 'window'];
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
   * Seed default KPI definitions per BRD document
   */
  async seedDefaults(tenantId: string): Promise<Kpi[]> {
    const defaults: Array<Partial<Kpi>> = [
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
      {
        kpiCode: 'INCR_VOL',
        kpiName: 'Incremental Volume',
        kpiGroup: 'Volume',
        kpiDescription: 'Planned minus base volume',
        formulaType: FormulaType.EXPRESSION,
        formulaText: 'PLAN_VOL - BASE_VOL',
        calculationOrder: 3,
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
        kpiDescription: 'Volume uplift percentage',
        formulaType: FormulaType.EXPRESSION,
        formulaText: '(PLAN_VOL - BASE_VOL) / BASE_VOL * 100',
        calculationOrder: 4,
        calculationLevel: CalculationLevel.SKU,
        displayFormat: DisplayFormat.PERCENTAGE,
        decimalPlaces: 1,
        showInGrid: true,
        columnOrder: 4,
        aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
        isActive: true,
      },
      {
        kpiCode: 'PLAN_TURNOVER',
        kpiName: 'Planned Turnover',
        kpiGroup: 'Revenue',
        kpiDescription: 'Planned volume x unit price',
        formulaType: FormulaType.EXPRESSION,
        formulaText: 'PLAN_VOL * BPTT',
        calculationOrder: 5,
        calculationLevel: CalculationLevel.SKU,
        displayFormat: DisplayFormat.CURRENCY,
        decimalPlaces: 2,
        showInGrid: true,
        columnOrder: 5,
        aggregationMethodFu: AggregationMethod.SUM,
        isActive: true,
      },
      {
        kpiCode: 'TACTIC_SPEND',
        kpiName: 'Tactic Spend',
        kpiGroup: 'Spend',
        kpiDescription: 'Total tactic spend allocated to SKU',
        formulaType: FormulaType.EXTERNAL,
        formulaText: 'TACTIC_SPEND',
        calculationOrder: 6,
        calculationLevel: CalculationLevel.SKU,
        displayFormat: DisplayFormat.CURRENCY,
        decimalPlaces: 2,
        showInGrid: true,
        columnOrder: 6,
        aggregationMethodFu: AggregationMethod.SUM,
        isActive: true,
      },
      {
        kpiCode: 'GP',
        kpiName: 'Gross Profit',
        kpiGroup: 'Profit',
        kpiDescription: 'Turnover minus COGS minus tactic spend',
        formulaType: FormulaType.EXPRESSION,
        formulaText: '(PLAN_VOL * BPTT) - (PLAN_VOL * COGS) - TACTIC_SPEND',
        calculationOrder: 7,
        calculationLevel: CalculationLevel.SKU,
        displayFormat: DisplayFormat.CURRENCY,
        decimalPlaces: 2,
        showInGrid: true,
        columnOrder: 7,
        aggregationMethodFu: AggregationMethod.SUM,
        isActive: true,
      },
      {
        kpiCode: 'GP_ROI_PCT',
        kpiName: 'GP ROI %',
        kpiGroup: 'ROI',
        kpiDescription: 'Gross Profit ROI as percentage',
        formulaType: FormulaType.EXPRESSION,
        formulaText: 'GP / TACTIC_SPEND * 100',
        calculationOrder: 8,
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
        kpiDescription: 'GP as percentage of turnover',
        formulaType: FormulaType.EXPRESSION,
        formulaText: 'GP / PLAN_TURNOVER * 100',
        calculationOrder: 9,
        calculationLevel: CalculationLevel.SKU,
        displayFormat: DisplayFormat.PERCENTAGE,
        decimalPlaces: 1,
        showInGrid: false,
        aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
        isActive: true,
      },
    ];

    const created: Kpi[] = [];
    for (const def of defaults) {
      const existing = await this.kpiRepository.findByCode(tenantId, def.kpiCode!);
      if (!existing) {
        const kpi = this.kpiRepository.create({
          ...def,
          tenantId,
        });
        const saved = await this.kpiRepository.save(kpi);
        created.push(saved);
      }
    }

    return created;
  }

  /**
   * Extract KPI code dependencies from a formula text
   * Matches UPPERCASE_WITH_UNDERSCORES patterns, excluding known functions
   */
  private extractDependencies(formulaText: string): string[] {
    const functionNames = new Set(['IF', 'SUM', 'AVG', 'MIN', 'MAX', 'ABS', 'ROUND', 'FLOOR', 'CEIL']);
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
