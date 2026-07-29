import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { Cpl } from './cpl.entity';
import { Channel } from './channel.entity';
import { Category } from './category.entity';
import { GenericUnit } from './generic-unit.entity';
import { ForecastingUnit } from './forecasting-unit.entity';
import { Tactic } from './tactic.entity';
import { Mechanic } from './mechanic.entity';
import { Region } from './region.entity';

export enum AgreementType {
  STA = 'STA', // Short-Term Agreement (≤30 days)
  LTA = 'LTA', // Long-Term Agreement (>30 days)
}

export enum AgreementStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum SpendType {
  ON_INVOICE = 'ON_INVOICE',
  OFF_INVOICE = 'OFF_INVOICE',
  BOTH = 'BOTH',
}

export enum MechanicType {
  PERCENT = 'PERCENT',
  AMOUNT = 'AMOUNT',
  AMOUNT_PER_UNIT = 'AMOUNT_PER_UNIT',
}

export enum ReconciliationPeriod {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

@Entity({ name: 'agreements', schema: 'main' })
@Index(['tenantId', 'agreementCode'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'cplId', 'status'])
@Index(['tenantId', 'periodMonth', 'status'])
@Index(['tenantId', 'categoryId'])
@Index(['approvalRequestId'], { where: '"approval_request_id" IS NOT NULL' })
export class Agreement extends BaseEntity {
  // Agreement identification
  @Column({ name: 'agreement_code', length: 50 })
  agreementCode!: string; // e.g., "STA-2026-025"

  @Column({ name: 'agreement_name', length: 200, nullable: true })
  agreementName?: string;

  @Column({ type: 'text', nullable: true })
  description?: string; // Agreement scope and details

  @Column({
    name: 'agreement_type',
    type: 'enum',
    enum: AgreementType,
  })
  agreementType!: AgreementType;

  // Customer & scope
  @Column({ name: 'cpl_id', type: 'uuid' })
  cplId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string; // Changed from string to UUID reference

  @Column({ name: 'region_id', type: 'uuid', nullable: true })
  regionId?: string;

  // Product scope
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string; // Category (Hair Care, Skin Care, etc.)

  @Column({ name: 'gu_id', type: 'uuid', nullable: true })
  guId?: string; // Generic Unit (optional)

  @Column({ name: 'fu_id', type: 'uuid' })
  fuId!: string; // Forecasting Unit (required per BRD)

  @Column({ name: 'sku_scope', length: 20, default: 'FU' })
  skuScope!: string; // 'GU' | 'FU' | 'SKU' | 'ALL'

  // Tactic & mechanic
  @Column({ name: 'tactic_id', type: 'uuid' })
  tacticId!: string;

  @Column({ name: 'mechanic_id', type: 'uuid' })
  mechanicId!: string;

  // Financial terms
  @Column({
    name: 'mechanic_value',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  mechanicValue?: number; // e.g., 15.00 (TL per unit) or 10.5 (%)

  @Column({
    name: 'mechanic_type',
    type: 'enum',
    enum: MechanicType,
    nullable: true,
  })
  mechanicType?: MechanicType;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  // Budget
  @Column({
    name: 'cap_total_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  capTotalAmount!: number; // Budget ceiling for this agreement

  @Column({
    name: 'spend_type',
    type: 'enum',
    enum: SpendType,
    nullable: true,
  })
  spendType?: SpendType;

  // Period
  @Column({ name: 'start_date', type: 'date' })
  startDate!: Date;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: Date;

  @Column({ name: 'period_month', length: 7 })
  periodMonth!: string; // YYYY-MM (for budget tracking)

  @Column({
    name: 'reconciliation_period',
    type: 'enum',
    enum: ReconciliationPeriod,
    nullable: true,
  })
  reconciliationPeriod?: ReconciliationPeriod; // Monthly, Weekly, Quarterly, Yearly

  // Justification
  @Column({ type: 'text' })
  justification!: string; // Mandatory business rationale

  @Column({ type: 'text', nullable: true })
  notes?: string; // Additional notes for approver

  // Status
  @Column({
    type: 'enum',
    enum: AgreementStatus,
    default: AgreementStatus.DRAFT,
  })
  status!: AgreementStatus;

  // Approval
  @Column({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedById?: string;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  rejectedAt?: Date;

  @Column({ name: 'rejected_by', type: 'uuid', nullable: true })
  rejectedById?: string;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  // Settlement / Close
  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closedAt?: Date;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy?: string;

  // Budget tracking (computed)
  @Column({
    name: 'consumed_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  consumedAmount!: number; // Sum of ledger entries

  // Price simulation (STA only)
  @Column({
    name: 'current_price',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  currentPrice?: number;

  @Column({
    name: 'expected_price',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  expectedPrice?: number;

  @Column({
    name: 'competitor_price',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  competitorPrice?: number;

  @Column({ name: 'competitor_name', length: 200, nullable: true })
  competitorName?: string;

  // Dynamic parameters for specific tactics
  @Column({ name: 'additional_params', type: 'jsonb', nullable: true })
  additionalParams?: Record<string, any>;

  // KPI Calculation Results
  @Column({ name: 'kpi_results', type: 'jsonb', nullable: true })
  kpiResults?: Record<string, any>;

  // T-034: manual optimistic-locking version (NOT @VersionColumn — every
  // mutation here goes through repo.update()/queryRunner.manager.update(),
  // which @VersionColumn never checks/bumps; see
  // docs/analysis/0005-optimistic-locking-design.md K1). Bumped only by the
  // CAS-guarded DRAFT-edit write (AgreementRepository#updateVersioned);
  // derived (kpiResults recalc) and state-transition writes go through
  // #updateUnversioned/#updateStatus and leave this untouched.
  @Column({ type: 'integer', default: 1 })
  version!: number;

  // Relations
  @ManyToOne(() => Cpl)
  @JoinColumn({ name: 'cpl_id' })
  cpl!: Cpl;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel!: Channel;

  @ManyToOne(() => Region, { nullable: true })
  @JoinColumn({ name: 'region_id' })
  region?: Region;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category?: Category;

  @ManyToOne(() => GenericUnit, { nullable: true })
  @JoinColumn({ name: 'gu_id' })
  genericUnit?: GenericUnit;

  @ManyToOne(() => ForecastingUnit)
  @JoinColumn({ name: 'fu_id' })
  forecastingUnit!: ForecastingUnit;

  @ManyToOne(() => Tactic)
  @JoinColumn({ name: 'tactic_id' })
  tactic!: Tactic;

  @ManyToOne(() => Mechanic)
  @JoinColumn({ name: 'mechanic_id' })
  mechanic!: Mechanic;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy?: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'rejected_by' })
  rejectedBy?: User;
}
