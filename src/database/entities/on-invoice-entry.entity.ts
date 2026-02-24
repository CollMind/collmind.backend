import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Customer } from './customer.entity';
import { Sku } from './sku.entity';
import { BudgetEnvelope } from './budget-envelope.entity';
import { OnInvoiceBatch } from './on-invoice-batch.entity';
import { Tenant } from './tenant.entity';

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
  @Column({ type: 'decimal', precision: 18, scale: 3 })
  quantity!: number;

  @Column({ name: 'list_price', type: 'decimal', precision: 18, scale: 4 })
  listPrice!: number; // Liste fiyatı

  @Column({ name: 'actual_price', type: 'decimal', precision: 18, scale: 4 })
  actualPrice!: number; // İndirimli birim fiyat

  @Column({ type: 'decimal', precision: 18, scale: 2 })
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

  // Idempotency
  @Column({ name: 'idempotency_key', length: 200 })
  idempotencyKey!: string; // Format: '{customer_code}|{invoice_no}|{invoice_date}|{sku_code}|{row_number}'

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => OnInvoiceBatch, (batch) => batch.entries)
  @JoinColumn({ name: 'batch_id' })
  batch!: OnInvoiceBatch;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @ManyToOne(() => Sku)
  @JoinColumn({ name: 'sku_id' })
  sku!: Sku;

  @ManyToOne(() => BudgetEnvelope, { nullable: true })
  @JoinColumn({ name: 'budget_envelope_id' })
  budgetEnvelope?: BudgetEnvelope;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
