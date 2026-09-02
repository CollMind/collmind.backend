import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { Sku } from './sku.entity';
import { Cpl } from './cpl.entity';
import { BaselineVolumeImportBatch } from './baseline-volume-import-batch.entity';
import { DecimalTransformer } from '../transformers/decimal.transformer';

export enum BaselineVolumeSourceType {
  IMPORT = 'IMPORT',
  COMPUTED = 'COMPUTED',
}

export enum BaselineVolumeAcceptanceStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/**
 * BaselineVolume — `main.baseline_volumes` (`T-357` / `Z84`,
 * migration `1822000000000`). Excel'in *"Base Volume · Master Data · piece"*
 * satırının CTPM karşılığı — `Faz-2`'nin ilk gerçek-veri tablosu.
 *
 * GRAIN: `tenant × sku × cpl × period`, UNIQUE (dört anahtar da NOT NULL —
 * kısmi-tuple yok, `NULLS NOT DISTINCT` gerekmiyor).
 *
 * `period`: `character varying(7)`, `'YYYY-MM'` — mevcut TÜM dönem-etiketi
 * taşıyan tabloların konvansiyonuyla birebir (`fiscal_periods.kod` ile aynı
 * `CHECK` regex'i; o tabloya bilinçli olarak FK YOK, bkz. migration JSDoc'u).
 * Bir Date/timestamp DEĞİL — bu yüzden `T-333`'ün TZ-round-trip riskini
 * TAŞIMIYOR.
 *
 * `acceptanceStatus`/`reason`: `BL-3`'ün `≥%95` kapsam kapısı (`D4`) BUNDAN
 * okuyacak. `reason` reddedildiğinde ZORUNLU (DB `CHECK`), kısa bir KOD
 * (serbest metin değil) — Postgres ENUM olarak kilitlenmedi (kategori kümesi
 * henüz netleşmedi). ⚠️ Bu tablo yalnız anahtarları (tenant/sku/cpl/period)
 * ÇÖZÜLMÜŞ satırları taşıyabilir; "SKU eşleşmedi" türü red burada bir satır
 * değildir (bkz. migration JSDoc'u).
 *
 * `sourceType`/`importBatchId`/`importedAt`: provenance üçlüsü, DB `CHECK`
 * ile bağlı (`IMPORT` ⇒ ikisi de dolu, `COMPUTED` ⇒ ikisi de NULL).
 * `importedAt` bu tablodaki TEK gerçek zaman-noktası kolonu.
 *
 * `baseVolume`: birim PIECE, `numeric(18,3)` (`sales_actuals.volume` ile aynı
 * hassasiyet). UOM dönüşümü BU TABLODA YAŞAMAZ — gösterim/import katmanının
 * işi (Excel deseni, S12/K-2.1.12c ile aynı sınır).
 *
 * KAPSAM DIŞI: kanal (CPL'den türer) · kategori (SKU'dan türer) — kolon
 * olarak TUTULMAZ (`INV-B-009` kopya-kolon sınıfı).
 */
@Entity({ name: 'baseline_volumes', schema: 'main' })
@Index(
  'UQ_baseline_volumes_tenant_sku_cpl_period',
  ['tenantId', 'skuId', 'cplId', 'period'],
  { unique: true },
)
@Index('IDX_baseline_volumes_sku', ['skuId'])
@Index('IDX_baseline_volumes_cpl', ['cplId'])
@Index('IDX_baseline_volumes_import_batch', ['importBatchId'])
@Index('IDX_baseline_volumes_tenant_period_acceptance', [
  'tenantId',
  'period',
  'acceptanceStatus',
])
export class BaselineVolume extends BaseEntity {
  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ name: 'cpl_id', type: 'uuid' })
  cplId!: string;

  /** YYYY-MM. CHECK (migration): `period ~ '^\d{4}-(0[1-9]|1[0-2])$'`. */
  @Column({ length: 7 })
  period!: string;

  /**
   * Birim PIECE. NULLABLE — `ACCEPTED` satır için NOT NULL zorunluluğu DB
   * `CHECK`'i ile bağlıdır (bir kabul edilmiş satırın hacmi boş olamaz);
   * `REJECTED` satırlarda (ör. biçim hatası) NULL olabilir.
   */
  @Column({
    name: 'base_volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    nullable: true,
    transformer: DecimalTransformer,
  })
  baseVolume?: number;

  @Column({
    name: 'source_type',
    type: 'enum',
    enum: BaselineVolumeSourceType,
    enumName: 'baseline_volume_source_type_enum',
  })
  sourceType!: BaselineVolumeSourceType;

  /** `sourceType === IMPORT` ⇒ NOT NULL (DB CHECK); `COMPUTED` ⇒ NULL. */
  @Column({ name: 'import_batch_id', type: 'uuid', nullable: true })
  importBatchId?: string;

  @Column({
    name: 'acceptance_status',
    type: 'enum',
    enum: BaselineVolumeAcceptanceStatus,
    enumName: 'baseline_volume_acceptance_status_enum',
  })
  acceptanceStatus!: BaselineVolumeAcceptanceStatus;

  /**
   * Kısa, makine-okunur KOD (ör. `'INVALID_VOLUME_FORMAT'`) — serbest metin
   * DEĞİL. `acceptanceStatus === REJECTED` ⇒ NOT NULL (DB CHECK).
   */
  @Column({ type: 'text', nullable: true })
  reason?: string;

  /** Gerçek zaman-noktası — bu tabloda YALNIZ burada. `sourceType === IMPORT` ⇒ NOT NULL. */
  @Column({ name: 'imported_at', type: 'timestamptz', nullable: true })
  importedAt?: Date;

  // `foreignKeyConstraintName` + `onUpdate: 'NO ACTION'` dördü de: migration
  // katalogla BİREBİR eşlensin, `migration:generate` gerekçesiz DROP/ADD
  // önermesin (T-101/1815/1817 dersi — entity susarsa TypeORM varsayılan
  // hash-adlı FK + `onUpdate` farkı üretir, `migration:generate` her turda
  // "drift" görür). Ölçüldü: bu dört satır olmadan throwaway drift +34 satır
  // (yalnız bu tabloya ait); eklendikten sonra 0 (bkz. task raporu §5).
  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_baseline_volumes_tenant',
  })
  tenant!: Tenant;

  @ManyToOne(() => Sku, { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'sku_id',
    foreignKeyConstraintName: 'FK_baseline_volumes_sku',
  })
  sku!: Sku;

  @ManyToOne(() => Cpl, { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'cpl_id',
    foreignKeyConstraintName: 'FK_baseline_volumes_cpl',
  })
  cpl!: Cpl;

  @ManyToOne(() => BaselineVolumeImportBatch, {
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'import_batch_id',
    foreignKeyConstraintName: 'FK_baseline_volumes_import_batch',
  })
  importBatch?: BaselineVolumeImportBatch;
}
