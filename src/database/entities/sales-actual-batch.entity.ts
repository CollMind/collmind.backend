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
import { Cpl } from './cpl.entity';
import { Category } from './category.entity';
import { Channel } from './channel.entity';
import { SalesActual } from './sales-actual.entity';
import { DecimalTransformer } from '../transformers/decimal.transformer';

export enum SalesActualBatchStatus {
  ACTIVE = 'ACTIVE',
  REPLACED = 'REPLACED',
}

export enum SalesActualSourceType {
  FILE_UPLOAD = 'FILE_UPLOAD',
  SEED = 'SEED',
}

/**
 * SalesActualBatch — bir (period, cpl, category, channel) scope'u için
 * gerçekleşen satış yüklemesinin "kabı". T-020 (0002-actuals-port-design.md).
 *
 * ⚠️ LEDGER/BÜTÇE SINIRI: Bu tablo bilerek `budget_envelope_id`, `ledger_entry_id`,
 * `agreement_id` kolonu İÇERMEZ. Actuals satış cirosudur, harcama/spend DEĞİLDİR.
 * `v_budget_summary` view'ı bu tabloyu görmez — çift sayım fiziksel olarak
 * imkânsızdır (G1). `SalesActualsModule` LedgerModule/BudgetModule/KpiEngineModule
 * import ETMEZ (G2, sales-actuals.module.spec.ts ile kilitli).
 *
 * Immutable audit (BRD): REPLACE hard-delete yapmaz. Eski ACTIVE batch
 * `REPLACED` durumuna geçer, `replacedByBatchId` ile yeni batch'e işaret eder;
 * satırları DB'de kalır.
 */
@Entity({ name: 'sales_actual_batches', schema: 'main' })
@Index('ix_sab_tenant_period', ['tenantId', 'fiscalPeriod'])
@Index('ix_sab_tenant_status', ['tenantId', 'status'])
export class SalesActualBatch extends BaseEntity {
  @Column({ name: 'fiscal_period', length: 7 })
  fiscalPeriod!: string; // YYYY-MM

  @Column({ name: 'cpl_id', type: 'uuid' })
  cplId!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({
    type: 'enum',
    enum: SalesActualBatchStatus,
    default: SalesActualBatchStatus.ACTIVE,
  })
  status!: SalesActualBatchStatus;

  @Column({
    name: 'source_type',
    type: 'enum',
    enum: SalesActualSourceType,
    default: SalesActualSourceType.FILE_UPLOAD,
  })
  sourceType!: SalesActualSourceType;

  @Column({ name: 'file_name', length: 255, nullable: true })
  fileName?: string;

  /** sha256 hex — idempotency anahtarının parçası. */
  @Column({ name: 'file_hash', type: 'char', length: 64 })
  fileHash!: string;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows!: number;

  @Column({ name: 'valid_rows', type: 'int', default: 0 })
  validRows!: number;

  @Column({ name: 'error_rows', type: 'int', default: 0 })
  errorRows!: number;

  @Column({
    name: 'gross_total',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: DecimalTransformer,
  })
  grossTotal!: number;

  @Column({
    name: 'net_total',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: DecimalTransformer,
  })
  netTotal!: number;

  /**
   * ⚠️ Satış iskontosu — asla bütçeye/ledger'a/spend'e yazılmaz, salt bilgi.
   * On-invoice indirimiyle ekonomik olarak örtüşebilir ama on-invoice zaten
   * ledger'a yazıyor; burada tekrar yazılırsa çift sayım olur (T-003/T-017 kökü).
   */
  @Column({
    name: 'discount_total',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: DecimalTransformer,
  })
  discountTotal!: number;

  /** Versiyon zinciri: bu batch REPLACED ise onu değiştiren batch'in id'si. */
  @Column({ name: 'replaced_by_batch_id', type: 'uuid', nullable: true })
  replacedByBatchId?: string;

  @Column({ name: 'replaced_at', type: 'timestamptz', nullable: true })
  replacedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  validationSummary?: {
    errors: Array<{
      rowNumber: number;
      code: string;
      field?: string;
      message: string;
    }>;
    warnings?: Array<{
      rowNumber: number;
      code: string;
      field?: string;
      message: string;
    }>;
  };

  @OneToMany(() => SalesActual, (row) => row.batch)
  rows!: SalesActual[];

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne(() => Cpl)
  @JoinColumn({ name: 'cpl_id' })
  cpl!: Cpl;

  @ManyToOne(() => Category)
  @JoinColumn({ name: 'category_id' })
  category!: Category;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel!: Channel;
}
