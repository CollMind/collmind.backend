import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { Cpl } from './cpl.entity';
import { Channel } from './channel.entity';
import { Category } from './category.entity';
import { Region } from './region.entity';
import { ForecastingUnit } from './forecasting-unit.entity';
import { Sku } from './sku.entity';

export enum PlanStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PENDING_FINANCE_REVIEW = 'PENDING_FINANCE_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  /**
   * B dalgası / S15 (K-2.5.10b, K-2.5.10e): enum değeri BUGÜN eklenir, davranışı
   * (otomatik zaman aşımı) Faz 2'de gelir. Geçiş: `PENDING_APPROVAL → EXPIRED` →
   * yeniden gönderilebilir (içerik değişmeden). Bu migration yalnız enum değerini açar;
   * geçiş tetikleyicisi (zamanlanmış iş) servis/Faz-2 tarafı işidir.
   */
  EXPIRED = 'EXPIRED',
}

@Entity({ name: 'plans', schema: 'main' })
@Index(['tenantId', 'planCode'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'cplId', 'status'])
@Index(['tenantId', 'categoryId', 'status'])
@Index(['tenantId', 'periodMonth', 'status'])
@Index(['approvalRequestId'], { where: '"approval_request_id" IS NOT NULL' })
export class Plan extends BaseEntity {
  // Plan identification
  @Column({ name: 'plan_code', length: 50 })
  planCode!: string; // e.g., "PLAN-2026-Q1-001"

  @Column({ name: 'plan_name', length: 200 })
  planName!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // Customer & scope
  @Column({ name: 'cpl_id', type: 'uuid' })
  cplId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({ name: 'region_id', type: 'uuid', nullable: true })
  regionId?: string;

  // Product scope
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  // Period
  @Column({ name: 'start_date', type: 'date' })
  startDate!: Date;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: Date;

  @Column({ name: 'period_month', length: 7 })
  periodMonth!: string; // YYYY-MM (for budget tracking)

  // Status
  @Column({
    type: 'enum',
    enum: PlanStatus,
    default: PlanStatus.DRAFT,
  })
  status!: PlanStatus;

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

  // Comments
  @Column({ type: 'text', nullable: true })
  comments?: string; // Planner comments for approver

  // Submission details
  @Column({ name: 'submission_notes', type: 'text', nullable: true })
  submissionNotes?: string; // Notes from planner at submission

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true })
  submittedAt?: Date;

  @Column({ name: 'submitted_by', type: 'uuid', nullable: true })
  submittedById?: string;

  // Finance review
  @Column({ name: 'pending_finance_review', type: 'boolean', default: false })
  pendingFinanceReview!: boolean;

  @Column({ name: 'escalation_reason', type: 'text', nullable: true })
  escalationReason?: string; // Reason for escalation to Finance

  @Column({ name: 'escalated_at', type: 'timestamp', nullable: true })
  escalatedAt?: Date;

  @Column({ name: 'escalated_by', type: 'uuid', nullable: true })
  escalatedById?: string;

  // Budget breakdown (cached for approval workflow)
  @Column({
    name: 'on_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  onInvoiceSpend!: number;

  @Column({
    name: 'off_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  offInvoiceSpend!: number;

  // Calculated totals (cached for performance)
  @Column({
    name: 'total_planned_volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    default: 0,
  })
  totalPlannedVolume!: number;

  @Column({
    name: 'total_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalSpend!: number;

  @Column({
    name: 'total_gp',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalGp!: number; // Gross Profit

  @Column({
    name: 'overall_roi',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  overallRoi?: number | null; // Overall GP ROI %; null when a dependency (e.g. COGS) is missing

  @Column({ name: 'rag_status', type: 'varchar', length: 10, nullable: true })
  ragStatus?: string | null; // 'RED' | 'AMBER' | 'GREEN' | null

  // T-034: manual optimistic-locking version (NOT @VersionColumn — every
  // mutation here goes through repo.update()/queryRunner.manager.update(),
  // which @VersionColumn never checks/bumps; see
  // docs/analysis/0005-optimistic-locking-design.md K1). Bumped only by
  // CAS-guarded user-input writes (PlanRepository#updateVersioned); derived/
  // recalc/compensation writes go through #updateUnversioned and leave this
  // untouched.
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

  @ManyToOne(() => Category)
  @JoinColumn({ name: 'category_id' })
  category!: Category;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy?: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'rejected_by' })
  rejectedBy?: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'submitted_by' })
  submittedBy?: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'escalated_by' })
  escalatedBy?: User;

  @OneToMany(() => PlanFu, (planFu) => planFu.plan, { cascade: true })
  planFus!: PlanFu[];
}

@Entity({ name: 'plan_fus', schema: 'main' })
@Index(['planId'])
@Index(['fuId'])
@Index(['planId', 'fuId'], { unique: true })
export class PlanFu extends BaseEntity {
  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'fu_id', type: 'uuid' })
  fuId!: string;

  // Tactic values (stored as JSONB for flexibility)
  @Column({ type: 'jsonb', nullable: true })
  tactics?: Record<string, number>; // { 'CPP_ON_PCT': 10, 'DISPLAY_FEE': 5000, ... }

  // Calculated values (cached)
  @Column({
    name: 'total_planned_volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    default: 0,
  })
  totalPlannedVolume!: number;

  @Column({
    name: 'total_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalSpend!: number;

  @Column({
    name: 'total_gp',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalGp!: number;

  @Column({
    name: 'gp_roi',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  gpRoi?: number | null; // null when a dependency (e.g. COGS) is missing

  @Column({ name: 'rag_status', type: 'varchar', length: 10, nullable: true })
  ragStatus?: string | null; // 'RED' | 'AMBER' | 'GREEN' | null

  // Calculated KPIs (stored as JSONB)
  @Column({ name: 'calculated_kpis', type: 'jsonb', nullable: true })
  calculatedKpis?: Record<
    string,
    {
      value: number | null;
      displayFormat: string;
      decimalPlaces: number;
      ragStatus?: 'RED' | 'AMBER' | 'GREEN' | null;
      calculatedAt?: string;
      // T-177 S1 (2026-08-11): fraction of this KPI's children (SKUs, for
      // an FU-level rollup) that resolved and contributed to `value`. Only
      // set for KPIs whose value was produced by aggregating a set of
      // children (CalculationResult.coverageRatio — see kpi-engine.service.ts).
      // No schema change: this is a new key inside an existing JSONB
      // column, not a new column.
      coverageRatio?: number | null;
    }
  >;

  // T-034: optimistic-locking version (row-level; bumped only by CAS-guarded
  // grid-cell writes — updateFuTactic. Recalc/structural writes are
  // unversioned, see plan.entity.ts Plan#version comment).
  @Column({ type: 'integer', default: 1 })
  version!: number;

  // Relations
  @ManyToOne(() => Plan, (plan) => plan.planFus, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: Plan;

  @ManyToOne(() => ForecastingUnit)
  @JoinColumn({ name: 'fu_id' })
  fu!: ForecastingUnit;

  @OneToMany(() => PlanSku, (planSku) => planSku.planFu, { cascade: true })
  planSkus!: PlanSku[];

  @OneToMany('PlanMechanicValue', 'planFu', { cascade: true })
  planMechanicValues!: any[];
}

@Entity({ name: 'plan_skus', schema: 'main' })
@Index(['planFuId'])
@Index(['skuId'])
@Index(['planFuId', 'skuId'], { unique: true })
export class PlanSku extends BaseEntity {
  @Column({ name: 'plan_fu_id', type: 'uuid' })
  planFuId!: string;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  // Volume planning
  @Column({
    name: 'base_volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  baseVolume?: number; // Historical baseline

  @Column({
    name: 'planned_volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  plannedVolume?: number; // Planned volume for this SKU

  // Calculated values (cached)
  @Column({
    name: 'incremental_volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    default: 0,
  })
  incrementalVolume!: number; // plannedVolume - baseVolume

  @Column({
    name: 'planned_turnover',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    nullable: true,
  })
  plannedTurnover?: number | null; // PLANNED_TO from KPI engine; null when a
  // required master/user input (e.g. BPTT/unit price) is missing (T-027)

  @Column({
    name: 'tactic_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  tacticSpend!: number; // Distributed from FU level

  @Column({
    name: 'planned_gp',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    nullable: true,
  })
  plannedGp?: number | null; // PLANNED_GP from KPI engine; null when a
  // required master input (e.g. COGS) is missing — BRD: missing data → null,
  // never a fabricated 0 that masks GP_ROI_PCT as 100%/GREEN (T-027)

  @Column({
    name: 'gp_roi',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  gpRoi?: number | null; // GP ROI %; null when a dependency (e.g. COGS) is missing

  @Column({ name: 'rag_status', type: 'varchar', length: 10, nullable: true })
  ragStatus?: string | null; // 'RED' | 'AMBER' | 'GREEN' | null

  // Calculated KPIs (stored as JSONB)
  @Column({ name: 'calculated_kpis', type: 'jsonb', nullable: true })
  calculatedKpis?: Record<
    string,
    {
      value: number | null;
      displayFormat: string;
      decimalPlaces: number;
      ragStatus?: 'RED' | 'AMBER' | 'GREEN' | null;
      calculatedAt?: string;
    }
  >;

  // LTA spend alanları
  @Column({
    name: 'base_lta_on_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  baseLtaOnInvoiceSpend!: number;

  @Column({
    name: 'base_lta_off_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  baseLtaOffInvoiceSpend!: number;

  @Column({
    name: 'planned_lta_on_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  plannedLtaOnInvoiceSpend!: number;

  @Column({
    name: 'planned_lta_off_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  plannedLtaOffInvoiceSpend!: number;

  // Promo spend alanları (tüm on-invoice ve off-invoice mekaniklerin toplamı)
  @Column({
    name: 'promo_on_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  promoOnInvoiceSpend!: number;

  @Column({
    name: 'promo_off_invoice_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  promoOffInvoiceSpend!: number;

  // T-034: optimistic-locking version (row-level; bumped only by CAS-guarded
  // grid-cell writes — updateSkuVolume. Recalc writes are unversioned, see
  // plan.entity.ts Plan#version comment).
  @Column({ type: 'integer', default: 1 })
  version!: number;

  // Relations
  @ManyToOne(() => PlanFu, (planFu) => planFu.planSkus, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_fu_id' })
  planFu!: PlanFu;

  @ManyToOne(() => Sku)
  @JoinColumn({ name: 'sku_id' })
  sku!: Sku;

  @OneToMany('MechanicSpendBreakdown', 'planSku', { cascade: true })
  spendBreakdowns?: any[];
}
