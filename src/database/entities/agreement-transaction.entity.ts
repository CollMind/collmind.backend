import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Agreement } from './agreement.entity';
import { Customer } from './customer.entity';
import { Tenant } from './tenant.entity';

@Entity({ name: 'agreement_transactions', schema: 'main' })
@Index(['tenantId', 'idempotencyKey'], { unique: true })
@Index(['tenantId', 'agreementId'])
@Index(['tenantId', 'invoiceNo', 'invoiceDate'])
export class AgreementTransaction extends BaseEntity {
  // Agreement reference
  @Column({ name: 'agreement_id', type: 'uuid' })
  agreementId!: string;

  // Invoice details
  @Column({ name: 'invoice_no', length: 100 })
  invoiceNo!: string;

  @Column({ name: 'invoice_date', type: 'date' })
  invoiceDate!: Date;

  // Fiscal period for budget deduction (YYYY-MM format)
  @Column({ name: 'fiscal_period', length: 7, nullable: true })
  fiscalPeriod?: string; // YYYY-MM format, used for budget deduction

  // Amount
  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: number;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  // Customer reference
  @Column({ name: 'cpl_id', type: 'uuid', nullable: true })
  cplId?: string;

  // Batch reference (for Phase 1 batch import)
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId?: string;

  @Column({ name: 'row_number', type: 'int', nullable: true })
  rowNumber?: number;

  // Idempotency
  @Column({ name: 'idempotency_key', length: 200 })
  idempotencyKey!: string; // Format: '{agreement_id}|{invoice_no}|{invoice_date}'

  // Reversal flag — set to true after a successful reversal; immutable
  @Column({ name: 'is_reversed', type: 'boolean', default: false })
  isReversed!: boolean;

  // Metadata
  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  // ADR 0012 / T-188 (migration 1802000000000): finansal kayıt — eskiden CASCADE.
  @ManyToOne(() => Agreement, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agreement_id' })
  agreement!: Agreement;

  // 📌 Kapsam dışı (ADR 0012): müşteri finansal kayıt değil — SET NULL korunuyor.
  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  customer?: Customer;

  // ADR 0012: eskiden CASCADE — offboarding yolu T-195'te tanımlanana kadar RESTRICT.
  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  // ⚠️ created_by/updated_by → users FK'ları (RESTRICT, ADR 0012) BaseEntity'nin düz
  // uuid kolonları üzerinde — TypeORM ilişkisi olarak MODELLENMİYOR (bu migration'dan
  // önce de öyleydi, `1704067820000-CreateAgreementTransactions.ts` ham SQL ile
  // eklemişti). Entity/DB parite boşluğu bu migration'ın YARATTIĞI bir şey değil.
}
