import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tactic } from './tactic.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

export enum MechanicType {
  PERCENT = 'PERCENT',
  AMOUNT = 'AMOUNT',
  AMOUNT_PER_UNIT = 'AMOUNT_PER_UNIT',
}

export enum SpendingType {
  ON_INVOICE = 'on_invoice',
  OFF_INVOICE = 'off_invoice',
  BOTH = 'both',
}

export enum MechanicCategory {
  ON_INVOICE_DISCOUNT = 'on_invoice_discount',
  OFF_INVOICE_DISCOUNT = 'off_invoice_discount',
  PER_UNIT_SUPPORT = 'per_unit_support',
  LUMPSUM_SPEND = 'lumpsum_spend',
  LONG_TERM_AGREEMENT = 'long_term_agreement',
}

export enum InputType {
  PERCENTAGE = 'percentage',
  CURRENCY = 'currency',
  UNITS = 'units',
  BOOLEAN = 'boolean',
}

export enum BudgetType {
  ON_INVOICE = 'on_invoice',
  OFF_INVOICE = 'off_invoice',
  BOTH = 'both',
  NONE = 'none',
}

export enum FormulaValidationStatus {
  PENDING = 'pending',
  VALID = 'valid',
  INVALID = 'invalid',
  ERROR = 'error',
}

// B dalgası / S1 (K-2.13.14f, K-2.13.14g): kanıt sınıfı — mekanik tanımının bir alanı.
export enum EvidenceClass {
  OBSERVED = 'OBSERVED', // GÖZLENEN
  DERIVABLE = 'DERIVABLE', // TÜRETİLEBİLİR
  CONTRACTUAL = 'CONTRACTUAL', // SÖZLEŞMESEL
}

// B dalgası / S1 (K-2.1.13, K-2.1.14): hesaplaşma davranışını kadans belirler, süre değil.
export enum SettlementCadence {
  SINGLE = 'SINGLE', // TEK
  PERIODIC = 'PERIODIC', // DÖNEMSEL
}

// B dalgası / S1 (K-2.1.13): kadans PERIODIC ise tahakkuk takvimi.
export enum AccrualSchedule {
  NONE = 'NONE', // YOK
  MONTHLY = 'MONTHLY', // AYLIK
}

// B dalgası / S1 (K-2.13.14h3): oran bazlı mekaniklerin tabanı. Varsayılan NET.
export enum MechanicBase {
  GROSS = 'GROSS', // BRÜT
  NET = 'NET', // NET
}

@Entity({ name: 'mechanics', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['tacticId'])
export class Mechanic extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'tactic_id', type: 'uuid' })
  tacticId!: string;

  @Column({
    name: 'mechanic_type',
    type: 'enum',
    enum: MechanicType,
  })
  mechanicType!: MechanicType;

  @Column({ name: 'calculation_rules', type: 'jsonb', nullable: true })
  calculationRules?: Record<string, any>; // Formula definition

  @Column({
    name: 'spending_type',
    type: 'enum',
    enum: SpendingType,
    nullable: true,
  })
  spendingType?: SpendingType; // 'on_invoice', 'off_invoice', 'both'

  @Column({ name: 'calculation_formula', type: 'text', nullable: true })
  calculationFormula?: string; // Spend hesaplama formülü

  @Column({ name: 'applicability_rules', type: 'jsonb', nullable: true })
  applicabilityRules?: Record<string, any>; // Kanal ve kategori bazlı görünürlük kuralları

  @Column({ name: 'input_constraints', type: 'jsonb', nullable: true })
  inputConstraints?: Record<string, any>; // min/max değerler, validasyon kuralları

  // ⛔ Transformer YOK — bilerek, dört kolon birden (min/max/default_value,
  // step_increment). ADR 0007 Karar 4: `entered_value` ile AYNI polimorfizm —
  // `mechanics.input_type`'a bağlı olarak oran ya da birim fiyat. Kolon
  // bölünmeden (Karar 4'ün kendisi gibi) transformer eklenemez; bu turun
  // kapsamı dışında (T-197/T-221 ikinci yarı, DUR listesi maddesi 1).
  @Column({
    name: 'min_value',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  minValue?: number;

  @Column({
    name: 'max_value',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  maxValue?: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  // Category
  @Column({
    name: 'category',
    type: 'enum',
    enum: MechanicCategory,
    nullable: true,
  })
  category?: MechanicCategory;

  // Input Configuration
  @Column({
    name: 'input_type',
    type: 'enum',
    enum: InputType,
    nullable: true,
  })
  inputType?: InputType;

  @Column({
    name: 'default_value',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  defaultValue?: number;

  @Column({
    name: 'step_increment',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  stepIncrement?: number;

  @Column({ name: 'decimal_places', type: 'int', nullable: true })
  decimalPlaces?: number;

  @Column({ name: 'unit_symbol', length: 10, nullable: true })
  unitSymbol?: string; // %, $, pcs, etc.

  // Formula Management
  @Column({ name: 'formula_variables', type: 'jsonb', nullable: true })
  formulaVariables?: Record<string, any>; // Available variables list

  @Column({
    name: 'formula_validation_status',
    type: 'enum',
    enum: FormulaValidationStatus,
    default: FormulaValidationStatus.PENDING,
  })
  formulaValidationStatus!: FormulaValidationStatus;

  @Column({ name: 'test_data', type: 'jsonb', nullable: true })
  testData?: Record<string, any>; // Test data for formula validation

  // Applicability Rules
  @Column({ name: 'applicable_channels', type: 'jsonb', nullable: true })
  applicableChannels?: string[]; // NKA, Traditional Trade, E-Commerce, etc. or ["ALL"]

  @Column({ name: 'applicable_categories', type: 'jsonb', nullable: true })
  applicableCategories?: string[]; // Dairy, Beverages, etc. or ["ALL"]

  @Column({
    name: 'applicable_cpls',
    type: 'uuid',
    array: true,
    nullable: true,
  })
  applicableCpls?: string[]; // Specific CPL restrictions

  @Column({ name: 'exclusion_rules', type: 'jsonb', nullable: true })
  exclusionRules?: Record<string, any>; // Conditions when mechanic cannot be used

  // Visibility and Sorting
  @Column({ name: 'show_in_grid', type: 'boolean', default: true })
  showInGrid!: boolean;

  @Column({ name: 'grid_column_order', type: 'int', nullable: true })
  gridColumnOrder?: number;

  @Column({ name: 'grid_column_width', type: 'int', nullable: true })
  gridColumnWidth?: number; // px

  @Column({ name: 'group_header', length: 100, nullable: true })
  groupHeader?: string; // "On-Invoice Discounts", "Off-Invoice Rebates", etc.

  // Budget and Approval Rules
  @Column({ name: 'track_against_budget', type: 'boolean', default: true })
  trackAgainstBudget!: boolean;

  @Column({
    name: 'budget_type',
    type: 'enum',
    enum: BudgetType,
    nullable: true,
  })
  budgetType?: BudgetType;

  @Column({
    name: 'requires_approval_threshold',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: MoneyTransformer,
  })
  requiresApprovalThreshold?: number; // Amount threshold requiring approval

  @Column({ name: 'approval_flow', type: 'jsonb', nullable: true })
  approvalFlow?: Record<string, any>; // Who needs to approve

  // Combination and Constraint Rules
  @Column({
    name: 'mutually_exclusive_with',
    type: 'text',
    array: true,
    nullable: true,
  })
  mutuallyExclusiveWith?: string[]; // Mechanic codes that cannot be used together

  // ⛔ Transformer YOK — bilerek. ADR 0007 Errata E8: bu bir ORANDIR (Karar 5
  // kapsamına alındı, `entered_value` oran toplamıyla DOĞRUDAN karşılaştırılıyor
  // — `spend-validation.service.ts:325`), scale'i para değil. Alan B, T-228'ye
  // rapor edildi.
  @Column({
    name: 'max_combined_discount_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  maxCombinedDiscountPercentage?: number; // Total discount limit

  @Column({ name: 'combination_warnings', type: 'jsonb', nullable: true })
  combinationWarnings?: Record<string, any>; // Warnings for specific combinations

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // ── B dalgası / S1 (K-2.1.13, K-2.13.14f, K-2.13.14h3, K-2.1.16) ────────────────────
  // Kanıt sınıfı, kadans ve taban nullable: mevcut mekanikler için per-mekanik kategorizasyon
  // (K-2.1.14 "her mekanik görüşlü bir varsayılanla gelir") bir sonraki, servis/seed
  // tarafı task'ıdır — bu migration yalnız kolonu açar (S13 emsali).
  @Column({
    name: 'evidence_class',
    type: 'enum',
    enum: EvidenceClass,
    enumName: 'evidence_class_enum',
    nullable: true,
  })
  evidenceClass?: EvidenceClass;

  @Column({
    name: 'settlement_cadence',
    type: 'enum',
    enum: SettlementCadence,
    enumName: 'settlement_cadence_enum',
    nullable: true,
  })
  settlementCadence?: SettlementCadence;

  @Column({
    name: 'accrual_schedule',
    type: 'enum',
    enum: AccrualSchedule,
    enumName: 'accrual_schedule_enum',
    default: AccrualSchedule.NONE,
  })
  accrualSchedule!: AccrualSchedule;

  @Column({
    name: 'base',
    type: 'enum',
    enum: MechanicBase,
    enumName: 'mechanic_base_enum',
    default: MechanicBase.NET,
  })
  base!: MechanicBase;

  /** K-2.1.16: doğrular, sınıflandırmaz. */
  @Column({ name: 'max_duration_days', type: 'int', nullable: true })
  maxDurationDays?: number;

  // Relations
  @ManyToOne(() => Tactic, (tactic) => tactic.mechanics)
  @JoinColumn({ name: 'tactic_id' })
  tactic!: Tactic;
}
