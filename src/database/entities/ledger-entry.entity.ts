import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Agreement } from './agreement.entity';
import { BudgetEnvelope } from './budget-envelope.entity';
import { Customer } from './customer.entity';
import { Tenant } from './tenant.entity';

export enum LedgerEntryDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum SpendType {
  ON_INVOICE = 'ON_INVOICE',
  OFF_INVOICE = 'OFF_INVOICE',
  ADJUSTMENT = 'ADJUSTMENT',
  ACCRUAL = 'ACCRUAL',
}

@Entity({ name: 'ledger_entries', schema: 'main' })
@Index(['tenantId', 'idempotencyKey'], { unique: true })
@Index(['tenantId', 'agreementId'])
@Index(['tenantId', 'budgetEnvelopeId'])
@Index(['tenantId', 'periodMonth'])
@Index(['tenantId', 'spendType'])
export class LedgerEntry extends BaseEntity {
  // Source reference
  @Column({ name: 'source_type', length: 50 })
  sourceType!: string; // 'AGREEMENT', 'PLAN', 'MANUAL'

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string; // Agreement.id or Plan.id

  // Agreement reference (for Actuals-First)
  @Column({ name: 'agreement_id', type: 'uuid', nullable: true })
  agreementId?: string;

  // Spend type
  @Column({
    name: 'spend_type',
    type: 'enum',
    enum: SpendType,
  })
  spendType!: SpendType;

  // Entry direction
  @Column({
    name: 'entry_direction',
    type: 'enum',
    enum: LedgerEntryDirection,
    default: LedgerEntryDirection.DEBIT,
  })
  entryDirection!: LedgerEntryDirection;

  // Amount
  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: number;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  // Period
  @Column({ name: 'period_month', length: 7 })
  periodMonth!: string; // YYYY-MM

  @Column({ name: 'posting_date', type: 'date' })
  postingDate!: Date;

  // Dimensions
  @Column({ length: 30, nullable: true })
  channel?: string;

  @Column({ name: 'cpl_id', type: 'uuid', nullable: true })
  cplId?: string;

  @Column({ name: 'fu_id', type: 'uuid', nullable: true })
  fuId?: string;

  @Column({ name: 'tactic_id', type: 'uuid', nullable: true })
  tacticId?: string;

  @Column({ name: 'mechanic_id', type: 'uuid', nullable: true })
  mechanicId?: string;

  // Budget link
  @Column({ name: 'budget_envelope_id', type: 'uuid', nullable: true })
  budgetEnvelopeId?: string;

  // Idempotency
  @Column({ name: 'idempotency_key', length: 200 })
  idempotencyKey!: string; // Format: 'LEDGER|AGREEMENT|{agreement_id}|{transaction_id}'

  // Description
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Agreement, { nullable: true })
  @JoinColumn({ name: 'agreement_id' })
  agreement?: Agreement;

  @ManyToOne(() => BudgetEnvelope, { nullable: true })
  @JoinColumn({ name: 'budget_envelope_id' })
  budgetEnvelope?: BudgetEnvelope;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  customer?: Customer;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}


