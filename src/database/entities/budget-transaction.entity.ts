import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BudgetEnvelope } from './budget-envelope.entity';
import { Tenant } from './tenant.entity';

export enum BudgetTransactionType {
  ALLOCATE = 'ALLOCATE', // Initial envelope creation
  COMMIT = 'COMMIT', // Planning-First: Plan approved
  RESERVE = 'RESERVE', // Actuals-First: Agreement approved
  RELEASE = 'RELEASE', // Agreement cancelled (free reserved budget)
  TRANSFER = 'TRANSFER', // Move budget between envelopes
  ADJUST = 'ADJUST', // Manual correction (admin only)
}

export enum BudgetTransactionStatus {
  PENDING = 'PENDING',
  POSTED = 'POSTED',
  CANCELLED = 'CANCELLED',
}

export enum BudgetTransactionSourceType {
  AGREEMENT = 'AGREEMENT',
  PLAN = 'PLAN',
  MANUAL = 'MANUAL',
  TRANSFER = 'TRANSFER',
  ADJUSTMENT = 'ADJUSTMENT',
}

@Entity({ name: 'budget_transactions', schema: 'main' })
@Index(['tenantId', 'idempotencyKey'], { unique: true })
@Index(['tenantId', 'envelopeId', 'txType'])
@Index(['tenantId', 'sourceType', 'sourceId'])
@Index(['tenantId', 'txType', 'txStatus'])
export class BudgetTransaction extends BaseEntity {
  // Envelope reference
  @Column({ name: 'envelope_id', type: 'uuid' })
  envelopeId!: string;

  // Transaction type
  @Column({
    name: 'tx_type',
    type: 'enum',
    enum: BudgetTransactionType,
  })
  txType!: BudgetTransactionType;

  @Column({
    name: 'tx_status',
    type: 'enum',
    enum: BudgetTransactionStatus,
    default: BudgetTransactionStatus.POSTED,
  })
  txStatus!: BudgetTransactionStatus;

  // Source reference
  @Column({
    name: 'source_type',
    type: 'enum',
    enum: BudgetTransactionSourceType,
    nullable: true,
  })
  sourceType?: BudgetTransactionSourceType;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId?: string; // Agreement.id for RESERVE type

  // Amount
  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: number;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  // Idempotency
  @Column({ name: 'idempotency_key', length: 200 })
  idempotencyKey!: string; // Format: 'RESERVE|AGREEMENT|{agreement_id}|{envelope_id}'

  // Description
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => BudgetEnvelope)
  @JoinColumn({ name: 'envelope_id' })
  envelope!: BudgetEnvelope;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
