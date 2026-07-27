import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { SalesActualBatch } from './sales-actual-batch.entity';
import { DecimalTransformer } from '../transformers/decimal.transformer';

/**
 * SalesActual — CPL x Kategori x Kanal x Dönem granülaritesinde gerçekleşen
 * satış TUTAR agregası (T-020). FU/SKU ve hacim boyutu YOKTUR — Wella actuals
 * CSV'sinde `fu_code`/`volume` kolonları bulunmuyor (bkz. tasarım doküman §
 * "Kritik bulgu").
 *
 * ⚠️ LEDGER/BÜTÇE SINIRI: `budgetEnvelopeId`/`ledgerEntryId`/`agreementId`
 * kolonu YOKTUR. `discountAmount` satış iskontosudur — asla bütçeye/ledger'a/
 * spend'e yazılmaz, salt bilgi amaçlıdır. On-invoice indirimiyle ekonomik
 * olarak örtüşebilir; on-invoice zaten kendi akışında ledger'a yazıyor,
 * burada tekrar kullanılırsa çift sayım olur (T-003/T-017 kökü buydu).
 *
 * Satır seviyesinde unique constraint YOKTUR — aynı scope'ta birden fazla
 * satır meşrudur (örn. CSV'de aynı CPL/kategori/kanal için iki satır).
 * Tekillik "güncel gerçek" tanımını ACTIVE batch üzerinden sağlar.
 */
@Entity({ name: 'sales_actuals', schema: 'main' })
@Index('ix_sa_tenant_batch', ['tenantId', 'batchId'])
@Index('ix_sa_tenant_dims', [
  'tenantId',
  'fiscalPeriod',
  'cplId',
  'categoryId',
  'channelId',
])
export class SalesActual extends BaseEntity {
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  // Denormalize boyutlar (batch ile aynı scope; sorgu kolaylığı için satırda da tutulur)
  @Column({ name: 'fiscal_period', length: 7 })
  fiscalPeriod!: string;

  @Column({ name: 'cpl_id', type: 'uuid' })
  cplId!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  // Display denormalizasyonu (on-invoice-entry pattern)
  @Column({ name: 'cpl_code', length: 50 })
  cplCode!: string;

  @Column({ name: 'category_name', length: 200 })
  categoryName!: string;

  @Column({ name: 'channel_code', length: 50 })
  channelCode!: string;

  @Column({
    name: 'gross_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: DecimalTransformer,
  })
  grossAmount!: number;

  @Column({
    name: 'net_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: DecimalTransformer,
  })
  netAmount?: number;

  /**
   * ⚠️ Satış iskontosu — asla bütçeye/ledger'a/spend'e yazılmaz, salt bilgi.
   * Bkz. entity JSDoc üstü.
   */
  @Column({
    name: 'discount_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: DecimalTransformer,
  })
  discountAmount?: number;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  @Column({ name: 'source_row_number', type: 'int' })
  sourceRowNumber!: number;

  /** Ham CSV satırı — ayrı staging tablosu yok, kanıt burada saklanır. */
  @Column({ name: 'raw_row', type: 'jsonb' })
  rawRow!: Record<string, string>;

  @ManyToOne(() => SalesActualBatch, (batch) => batch.rows)
  @JoinColumn({ name: 'batch_id' })
  batch!: SalesActualBatch;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
