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

  // Reversal support
  /** ID of the original ledger entry this entry reverses. NULL for normal entries. */
  @Column({ name: 'reverses_entry_id', type: 'uuid', nullable: true })
  reversesEntryId?: string;

  /**
   * True when this entry has been reversed by a later credit entry.
   * Immutable once set — never reset to false.
   */
  @Column({ name: 'is_reversed', type: 'boolean', default: false })
  isReversed!: boolean;

  // Description
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  // ADR 0012 / T-188 (migration 1802000000000): finansal kayıt — RESTRICT.
  // agreement_id: bugüne kadar FK'sız; bu migration ekledi.
  @ManyToOne(() => Agreement, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agreement_id' })
  agreement?: Agreement;

  /** Self-referential: the original entry that this entry reverses. */
  @ManyToOne(() => LedgerEntry, { nullable: true })
  @JoinColumn({ name: 'reverses_entry_id' })
  reversesEntry?: LedgerEntry;

  // ADR 0012: eskiden SET NULL — tüketilmiş bir zarf artık silinemez.
  @ManyToOne(() => BudgetEnvelope, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'budget_envelope_id' })
  budgetEnvelope?: BudgetEnvelope;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  customer?: Customer;

  // ADR 0012: eskiden CASCADE — tenant offboarding yolu T-195'te tanımlanana kadar
  // ledger satırları tenant silinerek imha edilemez.
  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
