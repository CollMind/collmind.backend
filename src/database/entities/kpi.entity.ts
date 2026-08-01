import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum FormulaType {
  EXPRESSION = 'expression',
  CONDITIONAL = 'conditional',
  USER_INPUT = 'user_input',
  EXTERNAL = 'external',
  JAVASCRIPT = 'javascript',
}

export enum CalculationLevel {
  SKU = 'sku',
  FU = 'fu',
  PLAN = 'plan',
}

export enum DisplayFormat {
  NUMBER = 'number',
  CURRENCY = 'currency',
  PERCENTAGE = 'percentage',
}

export enum AggregationMethod {
  SUM = 'sum',
  AVG = 'avg',
  MIN = 'min',
  MAX = 'max',
  WEIGHTED_AVG = 'weighted_avg',
}

@Entity({ name: 'kpis', schema: 'main' })
@Index(['tenantId', 'kpiCode'], { unique: true })
@Index(['calculationOrder'])
@Index(['kpiGroup'])
export class Kpi extends BaseEntity {
  @Column({ name: 'kpi_code', length: 50 })
  kpiCode!: string; // e.g., 'INCR_VOL', 'GP_ROI_PCT'

  @Column({ name: 'kpi_name', length: 200 })
  kpiName!: string; // Display name

  @Column({ name: 'kpi_group', length: 100 })
  kpiGroup!: string; // 'Volume', 'Profit', 'ROI'

  @Column({ name: 'kpi_description', type: 'text', nullable: true })
  kpiDescription?: string;

  // Formula Configuration (Critical!)
  @Column({
    name: 'formula_type',
    type: 'enum',
    enum: FormulaType,
  })
  formulaType!: FormulaType;

  @Column({ name: 'formula_text', type: 'text' })
  formulaText!: string; // e.g., "PLANNED_VOL - BASE_VOL"

  @Column({ name: 'depends_on_kpis', type: 'jsonb', nullable: true })
  dependsOnKpis?: string[]; // Array of KPI codes this depends on

  // Calculation Sequence
  @Column({ name: 'calculation_order', type: 'int' })
  calculationOrder!: number; // 1-50

  @Column({
    name: 'calculation_level',
    type: 'enum',
    enum: CalculationLevel,
  })
  calculationLevel!: CalculationLevel; // 'sku' | 'fu' | 'plan'

  // Display Configuration
  @Column({
    name: 'display_format',
    type: 'enum',
    enum: DisplayFormat,
  })
  displayFormat!: DisplayFormat;

  @Column({ name: 'decimal_places', type: 'int', default: 2 })
  decimalPlaces!: number;

  @Column({ name: 'show_in_grid', type: 'boolean', default: true })
  showInGrid!: boolean;

  @Column({ name: 'column_order', type: 'int', nullable: true })
  columnOrder?: number; // Position in planning grid

  // Aggregation (for rolling up SKU → FU)
  @Column({
    name: 'aggregation_method_fu',
    type: 'enum',
    enum: AggregationMethod,
    nullable: true,
  })
  aggregationMethodFu?: AggregationMethod;

  // RAG Configuration (for KPIs that use thresholds)
  @Column({
    name: 'rag_green_threshold',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  ragGreenThreshold?: number;

  @Column({
    name: 'rag_amber_threshold',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  ragAmberThreshold?: number;

  // Status
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // T-039: manual optimistic-locking version (same mechanism as T-034 —
  // `docs/analysis/0005-optimistic-locking-design.md` K1 — NOT
  // `@VersionColumn`). `KpiService#update` uses `save()` on a fully-loaded
  // entity today, so `@VersionColumn` would technically increment on write;
  // however TypeORM's `OptimisticLockVersionMismatchError` conflict check is
  // only raised by `.setLock('optimistic', expectedVersion)` at SELECT time
  // (see `node_modules/typeorm/query-builder/SelectQueryBuilder.js`), not by
  // `save()` itself — so bolting `@VersionColumn` onto the existing
  // findOne()+Object.assign()+save() path would silently NOT protect against
  // concurrent writes (version would bump, but two racing updates would both
  // succeed, last-write-wins) unless the read path were retrofitted with an
  // explicit optimistic-lock SELECT, which is itself a two-step
  // check-then-write with a TOCTOU window. The manual `version` + atomic
  // conditional UPDATE (`applyVersionedUpdate`) checks and writes in a single
  // SQL statement, closing that window, and keeps one locking mechanism
  // across the codebase instead of two. Additive rollout (T-039, unlike
  // T-034's strict mode): `version` is optional on `UpdateKpiDto` — omitted
  // -> `KpiRepository#updateUnversioned` (bumps, does not check); provided ->
  // `KpiRepository#updateVersioned` (CAS). See kpi.service.ts#update.
  @Column({ type: 'integer', default: 1 })
  version!: number;
}
