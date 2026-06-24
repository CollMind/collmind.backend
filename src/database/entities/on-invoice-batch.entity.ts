import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { OnInvoiceEntry } from './on-invoice-entry.entity';

export enum OnInvoiceBatchStatus {
  PENDING = 'PENDING',
  VALIDATING = 'VALIDATING',
  VALIDATED = 'VALIDATED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity({ name: 'on_invoice_batches', schema: 'main' })
@Index(['tenantId', 'batchCode'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'fiscalPeriod'])
export class OnInvoiceBatch extends BaseEntity {
  @Column({ name: 'batch_code', length: 100 })
  batchCode!: string; // e.g., "BATCH-ON-2026-001"

  @Column({
    type: 'enum',
    enum: OnInvoiceBatchStatus,
    default: OnInvoiceBatchStatus.PENDING,
  })
  status!: OnInvoiceBatchStatus;

  @Column({ name: 'fiscal_period', length: 7 })
  fiscalPeriod!: string; // YYYY-MM

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows!: number;

  @Column({ name: 'valid_rows', type: 'int', default: 0 })
  validRows!: number;

  @Column({ name: 'error_rows', type: 'int', default: 0 })
  errorRows!: number;

  @Column({
    name: 'total_discount_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalDiscountAmount!: number;

  @Column({ name: 'affected_envelopes_count', type: 'int', default: 0 })
  affectedEnvelopesCount!: number;

  @Column({ name: 'file_name', length: 255, nullable: true })
  fileName?: string;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize?: number; // bytes

  @Column({ type: 'jsonb', nullable: true })
  validationSummary?: {
    lineAnalysis?: {
      total: number;
      valid: number;
      errors: number;
    };
    financialSummary?: {
      totalDiscount: number;
    };
    discountDistribution?: {
      cppOnInvoice?: { amount: number; percentage: number };
      ltaOnInvoice?: { amount: number; percentage: number };
      promoDiscount?: { amount: number; percentage: number };
    };
    budgetImpact?: Array<{
      envelopeCode: string;
      current: number;
      thisUpload: number;
      after: number;
      status: 'GREEN' | 'YELLOW' | 'RED';
    }>;
    errors?: Array<{
      rowNumber: number;
      message: string;
      field?: string;
    }>;
  };

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @OneToMany(() => OnInvoiceEntry, (entry) => entry.batch)
  entries!: OnInvoiceEntry[];

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
