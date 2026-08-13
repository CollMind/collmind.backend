import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BudgetEnvelope, BudgetSpendType } from './budget-envelope.entity';
import { Tenant } from './tenant.entity';

// B dalgası / S10 (K-2.3.13): "işlem tipi" (defter kaydının ne yaptığı) — bu enum sekiz
// kanonik değerin altısını taşıyordu (TAHSİS/REZERVE/TAAHHÜT/İADE/TRANSFER/DÜZELTME ↔
// ALLOCATE/RESERVE/COMMIT/RELEASE/TRANSFER/ADJUST, birebir). `ACCRUE`/`CONSUME`
// (TAHAKKUK/TÜKETİM) EKLENDİ — sekizi tamamlıyor. ⚠️ Yorum, ölçüm: bu iki değer bugün
// hiçbir yazma yolunda kullanılmıyor (0 satır) — kolon açık, üretici servis ayrı iş.
export enum BudgetTransactionType {
  ALLOCATE = 'ALLOCATE', // Initial envelope creation — TAHSİS
  COMMIT = 'COMMIT', // Planning-First: Plan approved — TAAHHÜT
  RESERVE = 'RESERVE', // Actuals-First: Agreement approved — REZERVE
  RELEASE = 'RELEASE', // Agreement cancelled (free reserved budget) — İADE
  TRANSFER = 'TRANSFER', // Move budget between envelopes — TRANSFER
  ADJUST = 'ADJUST', // Manual correction (admin only) — DÜZELTME
  ACCRUE = 'ACCRUE', // Periodic obligation accrues (K-2.13.25) — TAHAKKUK
  CONSUME = 'CONSUME', // Realized spend finalizes — TÜKETİM
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

  // T-019 Faz 1 (ADR 0004): sınıflandırma boyutu — NULL = untyped/UNSPLIT
  // (ALLOCATE, T-019-öncesi satırlar, agreement.spendType='BOTH', ve
  // plan.service.ts#submit'in geriye-uyumlu TOTAL kovası). Tutarı/yönü
  // DEĞİŞTİRMEZ, yalnız audit/idempotency kovasını belirler.
  @Column({
    name: 'spend_type',
    type: 'enum',
    enum: BudgetSpendType,
    enumName: 'budget_spend_type_enum',
    nullable: true,
  })
  spendType?: BudgetSpendType | null;

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
  // ADR 0012 / T-188 (migration 1802000000000): finansal kayıt — eskiden CASCADE.
  @ManyToOne(() => BudgetEnvelope, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'envelope_id' })
  envelope!: BudgetEnvelope;

  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
