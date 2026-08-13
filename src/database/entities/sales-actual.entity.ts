import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { SalesActualBatch } from './sales-actual-batch.entity';
import { DecimalTransformer } from '../transformers/decimal.transformer';

/**
 * SalesActual — CPL x Kategori x Kanal x Dönem granülaritesinde gerçekleşen
 * satış TUTAR agregası (T-020).
 *
 * ⚠️ B dalgası / S14 (K-2.1.8a, K-2.1.8a1, [[T-206]]): FU/SKU ve hacim kolonları
 * eklendi — hepsi NULLABLE. Wella (bugünkü pilot) actuals CSV'sinde `fu_code`/`volume`
 * yok, ama bu ürün kuralı DEĞİL, ölçülmüş bir MÜŞTERİ PROFİLİ (`İlke 5`): kardeş ürün
 * (TTM) aynı veriyi `validateRow`'da zorunlu tutuyor ve kanonik şablonuyla topluyor
 * (`docs/analysis/0070 §B1`). Hacimsiz alım tenant'a özgü kalabilir; kolonun kendisi
 * yeni tenant'lar için zorunlu OLMALI değil, yalnız MÜMKÜN olmalı.
 *
 * `A2`/`K-2.1.8a`'nın dağıtım tabanı bu kolonlar doluyken çalışır; boşken (bugünkü
 * pilot) devre dışı kalır — sessiz sıfır üretmez, veri yoksa dağıtım da yoktur.
 *
 * `volume` = converted adet; `rawVolumeInput`/`volumeConversionFactor` çevrim izidir
 * (K-2.1.12d) — ham değer + çarpan sonuçla birlikte saklanır.
 *
 * ⚠️ `sku_id`/`fu_id` `cplId`/`categoryId`/`channelId` ile AYNI stili izler: salt UUID
 * kolonu, TypeORM `@ManyToOne` ilişkisi YOK, ve — ölçüldü, `1785000000000-
 * CreateSalesActualsTables.ts` — DB seviyesinde FK de YOK. Bu tablo bilinçli olarak
 * diğer modüllerden yalıtık (bkz. yukarı, `SalesActualsModule` import sınırı); yeni
 * kolonlar bu yalıtımı BOZMAZ.
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

  /**
   * B dalgası / S14 (K-2.1.8a, K-2.1.8a1): SKU kırılımı + hacim. Nullable —
   * `A2`'nin dağıtım tabanının önkoşuludur, ama pilot profili (hacimsiz tenant)
   * hâlâ meşru (`İlke 5`); kolon var olmak zorunda, dolu olmak zorunda değil.
   */
  @Column({ name: 'fu_id', type: 'uuid', nullable: true })
  fuId?: string;

  @Column({ name: 'sku_id', type: 'uuid', nullable: true })
  skuId?: string;

  @Column({
    name: 'volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    nullable: true,
    transformer: DecimalTransformer,
  })
  volume?: number;

  /**
   * B dalgası / S2 (K-2.1.12d): çevrim izi — ham değer ve uygulanan çarpan, sonuçla
   * (yukarıdaki `volume`) BİRLİKTE saklanır. Satış birimi zaten adetse çarpan 1,
   * ham değer = sonuç.
   */
  @Column({
    name: 'raw_volume_input',
    type: 'decimal',
    precision: 18,
    scale: 3,
    nullable: true,
    transformer: DecimalTransformer,
  })
  rawVolumeInput?: number;

  @Column({
    name: 'volume_conversion_factor',
    type: 'decimal',
    precision: 9,
    scale: 4,
    nullable: true,
  })
  volumeConversionFactor?: number;

  @Column({ name: 'source_row_number', type: 'int' })
  sourceRowNumber!: number;

  /** Ham CSV satırı — ayrı staging tablosu yok, kanıt burada saklanır. */
  @Column({ name: 'raw_row', type: 'jsonb' })
  rawRow!: Record<string, string>;

  // ADR 0012 / T-188 (migration 1802000000000): kaynak veri (saklama yükümlülüğü) —
  // eskiden CASCADE, şimdi RESTRICT.
  @ManyToOne(() => SalesActualBatch, (batch) => batch.rows, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'batch_id' })
  batch!: SalesActualBatch;

  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  // ⚠️ created_by/updated_by → users FK'ları (RESTRICT, ADR 0012) BaseEntity'nin düz
  // uuid kolonları üzerinde — TypeORM ilişkisi olarak MODELLENMİYOR (ham SQL ile
  // eklenmişti, bu migration'ın YARATTIĞI bir parite boşluğu değil).
}
