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

  // Metadata
  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Agreement)
  @JoinColumn({ name: 'agreement_id' })
  agreement!: Agreement;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  customer?: Customer;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}


