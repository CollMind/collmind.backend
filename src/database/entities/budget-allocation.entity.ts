import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Cpl } from './cpl.entity';

export enum PeriodType {
  YEARLY = 'yearly',
  QUARTERLY = 'quarterly',
  MONTHLY = 'monthly',
}

@Entity({ name: 'budget_allocations', schema: 'main' })
@Index(
  [
    'tenantId',
    'periodType',
    'periodStart',
    'periodEnd',
    'cplId',
    'channel',
    'category',
  ],
  {
    unique: true,
    where: 'deleted_at IS NULL',
  },
)
@Index(['periodType', 'fiscalYear'])
@Index(['cplId'])
@Index(['periodStart', 'periodEnd'])
export class BudgetAllocation extends BaseEntity {
  @Column({
    name: 'period_type',
    type: 'enum',
    enum: PeriodType,
  })
  periodType!: PeriodType; // 'yearly', 'quarterly', 'monthly'

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: Date;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: Date;

  @Column({ name: 'fiscal_year', type: 'int' })
  fiscalYear!: number;

  @Column({ name: 'cpl_id', type: 'uuid', nullable: true })
  cplId?: string; // Nullable - tüm CPL'ler için genel bütçe

  @Column({ name: 'channel', length: 50, nullable: true })
  channel?: string; // Nullable - tüm kanallar için

  @Column({ name: 'category', length: 100, nullable: true })
  category?: string; // Nullable - tüm kategoriler için

  // Budget amounts
  @Column({
    name: 'on_invoice_budget',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  onInvoiceBudget!: number;

  @Column({
    name: 'off_invoice_budget',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  offInvoiceBudget!: number;

  // Total budget (computed: on + off)
  @Column({
    name: 'total_budget',
    type: 'decimal',
    precision: 15,
    scale: 2,
    generatedType: 'STORED',
    asExpression: 'on_invoice_budget + off_invoice_budget',
  })
  totalBudget!: number;

  // Utilization tracking
  @Column({
    name: 'on_invoice_utilized',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  onInvoiceUtilized!: number;

  @Column({
    name: 'off_invoice_utilized',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  offInvoiceUtilized!: number;

  // Reservation tracking (pending approval plans)
  @Column({
    name: 'on_invoice_reserved',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  onInvoiceReserved!: number;

  @Column({
    name: 'off_invoice_reserved',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  offInvoiceReserved!: number;

  // Available budget (computed: budget - utilized - reserved)
  @Column({
    name: 'on_invoice_available',
    type: 'decimal',
    precision: 15,
    scale: 2,
    generatedType: 'STORED',
    asExpression:
      'on_invoice_budget - on_invoice_utilized - on_invoice_reserved',
  })
  onInvoiceAvailable!: number;

  @Column({
    name: 'off_invoice_available',
    type: 'decimal',
    precision: 15,
    scale: 2,
    generatedType: 'STORED',
    asExpression:
      'off_invoice_budget - off_invoice_utilized - off_invoice_reserved',
  })
  offInvoiceAvailable!: number;

  // Alert configuration
  @Column({ name: 'alert_threshold_80', type: 'boolean', default: true })
  alertThreshold80!: boolean;

  @Column({ name: 'alert_threshold_95', type: 'boolean', default: true })
  alertThreshold95!: boolean;

  @Column({ name: 'alert_threshold_100', type: 'boolean', default: true })
  alertThreshold100!: boolean;

  @Column({ name: 'alert_recipients', type: 'jsonb', nullable: true })
  alertRecipients?: string[]; // Email listesi

  // Hard limit mode (block on 100% vs soft limit - warning only)
  @Column({ name: 'hard_limit_mode', type: 'boolean', default: false })
  hardLimitMode!: boolean;

  // Carry forward configuration
  @Column({ name: 'allow_carry_forward', type: 'boolean', default: false })
  allowCarryForward!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Cpl, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  cpl?: Cpl;

  @OneToMany('BudgetTransactionLog', 'budgetAllocation', { cascade: true })
  transactions!: any[];
}
