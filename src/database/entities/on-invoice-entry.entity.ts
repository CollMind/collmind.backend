import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Customer } from './customer.entity';
import { Sku } from './sku.entity';
import { BudgetEnvelope } from './budget-envelope.entity';
import { OnInvoiceBatch } from './on-invoice-batch.entity';
import { Tenant } from './tenant.entity';
import { Agreement } from './agreement.entity';
import {
  MoneyTransformer,
  UnitPriceTransformer,
} from '../transformers/decimal.transformer';

export enum OnInvoiceDiscountType {
  CPP_ON = 'CPP_ON', // CPP On-Invoice %
  LTA_ON = 'LTA_ON', // LTA Fatura Altı İskonto
  PROMO_DISCOUNT = 'PROMO_DISCOUNT', // Anında Fiyat İndirimi
}

export enum OnInvoiceEntryStatus {
  PENDING = 'PENDING',
  VALIDATED = 'VALIDATED',
  POSTED = 'POSTED',
  ERROR = 'ERROR',
}

@Entity({ name: 'on_invoice_entries', schema: 'main' })
@Index(['tenantId', 'idempotencyKey'], { unique: true })
@Index(['tenantId', 'batchId'])
@Index(['tenantId', 'customerId'])
@Index(['tenantId', 'skuId'])
@Index(['tenantId', 'invoiceNo', 'invoiceDate'])
@Index(['tenantId', 'fiscalPeriod'])
@Index(['tenantId', 'discountType'])
export class OnInvoiceEntry extends BaseEntity {
  // Batch reference
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  // Invoice details
  @Column({ name: 'invoice_no', length: 100 })
  invoiceNo!: string;

  @Column({ name: 'invoice_date', type: 'date' })
  invoiceDate!: Date;

  @Column({ name: 'fiscal_period', length: 7 })
  fiscalPeriod!: string; // YYYY-MM

  // Customer reference (CPL ile eşleşen müşteri)
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'customer_code', length: 50 })
  customerCode!: string; // Denormalized for display

  // SKU reference
  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ name: 'sku_code', length: 50 })
  skuCode!: string; // Denormalized for display

  // Quantity and pricing
  //
  // ⛔ `quantity` — transformer YOK, bilerek. Ne para ne birim fiyat: adet
  // (K-2.1.12a). İki transformer kararının (Money/UnitPrice) kapsamı dışında —
  // bu turda dokunulmadı, ayrı bulgu olarak raporlandı (T-197/T-221 ikinci yarı).
  @Column({ type: 'decimal', precision: 18, scale: 3 })
  quantity!: number;

  @Column({
    name: 'list_price',
    type: 'decimal',
    precision: 18,
    scale: 4,
    transformer: UnitPriceTransformer,
  })
  listPrice!: number; // Liste fiyatı

  @Column({
    name: 'actual_price',
    type: 'decimal',
    precision: 18,
    scale: 4,
    transformer: UnitPriceTransformer,
  })
  actualPrice!: number; // İndirimli birim fiyat

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: MoneyTransformer,
  })
  discount!: number; // Satır bazlı toplam indirim (₺)

  @Column({
    name: 'discount_type',
    type: 'enum',
    enum: OnInvoiceDiscountType,
  })
  discountType!: OnInvoiceDiscountType;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  // Status and validation
  @Column({
    type: 'enum',
    enum: OnInvoiceEntryStatus,
    default: OnInvoiceEntryStatus.PENDING,
  })
  status!: OnInvoiceEntryStatus;

  @Column({ name: 'validation_status', length: 20, nullable: true })
  validationStatus?: string; // VALID, WARNING, ERROR

  @Column({ name: 'validation_errors', type: 'jsonb', nullable: true })
  validationErrors?: Array<{
    field?: string;
    message: string;
    severity: 'ERROR' | 'WARNING';
  }>;

  @Column({ name: 'row_number', type: 'int' })
  rowNumber!: number; // Original row number in file

  // Budget envelope (after processing)
  @Column({ name: 'budget_envelope_id', type: 'uuid', nullable: true })
  budgetEnvelopeId?: string;

  /**
   * B dalgası / S9 (K-2.13.14l): kanıt merdiveninin ilk basamağı — gözlenen fatura-içi
   * kaydını hangi anlaşmaya bağlıyoruz. Nullable: geçmiş satırlar bağlanmamış kalabilir.
   */
  @Column({ name: 'agreement_id', type: 'uuid', nullable: true })
  agreementId?: string;

  // Idempotency
  @Column({ name: 'idempotency_key', length: 200 })
  idempotencyKey!: string; // Format: '{customer_code}|{invoice_no}|{invoice_date}|{sku_code}|{row_number}'

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  // ADR 0012 / T-188 (migration 1802000000000): finansal kayıt — hepsi eskiden CASCADE
  // (budgetEnvelope hariç, o SET NULL'dı), şimdi RESTRICT.
  @ManyToOne(() => OnInvoiceBatch, (batch) => batch.entries, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'batch_id' })
  batch!: OnInvoiceBatch;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @ManyToOne(() => Sku, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sku_id' })
  sku!: Sku;

  @ManyToOne(() => BudgetEnvelope, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'budget_envelope_id' })
  budgetEnvelope?: BudgetEnvelope;

  // B dalgası / S9: finansal-bitişik referans — RESTRICT (ADR 0012 deseniyle tutarlı).
  @ManyToOne(() => Agreement, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agreement_id' })
  agreement?: Agreement;

  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  // ⚠️ created_by/updated_by → users FK'ları (RESTRICT, ADR 0012) BaseEntity'nin düz
  // uuid kolonları üzerinde — TypeORM ilişkisi olarak MODELLENMİYOR (ham SQL ile
  // eklenmişti, bu migration'ın YARATTIĞI bir parite boşluğu değil).
}
