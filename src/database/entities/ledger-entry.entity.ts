import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { ImmutableBaseEntity } from './immutable-base.entity';
import { Agreement } from './agreement.entity';
import { BudgetEnvelope } from './budget-envelope.entity';
import { Customer } from './customer.entity';
import { Tenant } from './tenant.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

export enum LedgerEntryDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

// B dalgası / S10 (K-2.3.14): harcama tipi ÜÇ değer alır. `ACCRUAL` (TAHAKKUK) BURADAN
// ÇIKARILDI — bir işlem tipidir (bkz. `budget-transaction.entity.ts` `BudgetTransactionType`
// `ACCRUE`), bir harcama tipi değil. `ACCRUAL` DB'de 0 satırda kullanılıyordu (ölçüldü,
// migration 1803000000000 öncesi) — veri göçü gerekmedi.
export enum SpendType {
  ON_INVOICE = 'ON_INVOICE',
  OFF_INVOICE = 'OFF_INVOICE',
  ADJUSTMENT = 'ADJUSTMENT',
}

// B dalgası / S10 (K-2.3.13a, K-2.3.13b, K-2.3.13c): `DÜZELTME` (spend_type=ADJUSTMENT)
// bir alt tür taşır, ayrı bir kolonda. Çift yönlü CHECK: ADJUSTMENT ⇔ alt tür dolu.
export enum LedgerAdjustmentSubtype {
  REVERSAL = 'REVERSAL', // TERS_KAYIT
  VARIANCE = 'VARIANCE', // FARK
  CAP_OVERAGE = 'CAP_OVERAGE', // TAVAN_AŞIMI
  TOLERANCE_VARIANCE = 'TOLERANCE_VARIANCE', // TOLERANS_FARKI
}

@Entity({ name: 'ledger_entries', schema: 'main' })
@Index(['tenantId', 'idempotencyKey'], { unique: true })
@Index(['tenantId', 'agreementId'])
@Index(['tenantId', 'budgetEnvelopeId'])
@Index(['tenantId', 'periodMonth'])
@Index(['tenantId', 'spendType'])
// B dalgası / R1 (K-2.3.4): `BaseEntity` DEĞİL — `deletedAt` yok (aşağıya bkz.).
export class LedgerEntry extends ImmutableBaseEntity {
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

  /**
   * B dalgası / S10 (K-2.3.13a/b/c). Çift yönlü CHECK (migration `1803000000000`):
   * `spend_type = 'ADJUSTMENT'` ⇔ bu kolon dolu. Backfill: bugün mevcut ters kayıtlar
   * (`reverses_entry_id IS NOT NULL`) `REVERSAL` ile işaretlenir VE `spend_type`
   * `ADJUSTMENT`'a çekilir — bu ortamda `ledger_entries` BOŞ (0 satır), yani backfill
   * bu migration'da no-op; ölçüldü, aşağıya bkz. migration yorumu.
   * ⚠️ Servis tarafı (`ledger.service.ts:125`, reversal `spendType: original.spendType`
   * kopyalıyor) bu kolonu HENÜZ yazmıyor — S13 emsaliyle aynı: şema açık, servis ayrı
   * task (Team Lead'e rapor edildi, bkz. T-211 dönüşü).
   */
  @Column({
    name: 'adjustment_subtype',
    type: 'enum',
    enum: LedgerAdjustmentSubtype,
    enumName: 'ledger_adjustment_subtype_enum',
    nullable: true,
  })
  adjustmentSubtype?: LedgerAdjustmentSubtype;

  // Entry direction
  @Column({
    name: 'entry_direction',
    type: 'enum',
    enum: LedgerEntryDirection,
    default: LedgerEntryDirection.DEBIT,
  })
  entryDirection!: LedgerEntryDirection;

  // Amount
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: MoneyTransformer,
  })
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
