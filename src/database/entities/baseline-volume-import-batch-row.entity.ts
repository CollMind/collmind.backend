import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { Sku } from './sku.entity';
import { Cpl } from './cpl.entity';
import { BaselineVolumeImportBatch } from './baseline-volume-import-batch.entity';

export enum ImportBatchRowStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

// `Z87 §F12` (2026-09-02) — REVİZE: `BL-2`'nin GERÇEK sözlüğü (7 kod),
// ÖLÇÜLMÜŞ uyuşmazlık üzerine ürün sahibi tarafından kapatıldı (bkz. sınıf
// JSDoc'u, "reason ENUM DEĞERLERİ" bölümü — eski 5'lik karar ÜSTÜ ÇİZİLİ,
// silinmedi). `INVALID_VALUE`/`DUPLICATE` ÖLÜR (hiç üretilmiyordu, İlke 1).
export enum ImportBatchRowReason {
  SKU_NOT_FOUND = 'SKU_NOT_FOUND',
  CPL_NOT_FOUND = 'CPL_NOT_FOUND',
  INVALID_PERIOD = 'INVALID_PERIOD',
  INVALID_VOLUME_FORMAT = 'INVALID_VOLUME_FORMAT',
  NEGATIVE_VOLUME = 'NEGATIVE_VOLUME',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  DUPLICATE_GRAIN = 'DUPLICATE_GRAIN',
}

/**
 * BaselineVolumeImportBatchRow — `main.baseline_volume_import_batch_rows`
 * (`T-358` / `Z87`, migration `1823000000000`).
 *
 * `BL-3`'ün teşhis raporunun KAYNAĞI ve `sourceMatchRatio`'nun (eşleşen satır
 * / dosya satırı, batch-düzeyi teşhis metriği) PAYDASININ EVİ — HTTP cevabı
 * uçucudur (sayfa kapanınca kaybolur), bu tablo kalıcı izdir (`Z87`).
 *
 * ⛔ `ACCEPTED` satırlar da burada YAŞAR — yalnız red kaydedilirse
 * `sourceMatchRatio`'nun paydası kaybolur (bkz. yukarı). Köprü: bir kabul
 * edilen satırın `main.baseline_volumes`'taki karşılığı `batch_id` + `row_no`
 * üzerinden izlenir (o tabloda bu ikisi tutulmuyor bugün — köprü YÖNÜ bu
 * tablodan `baseline_volumes`'a, uygulama katmanının işi, `BL-3` ADIM 2/3).
 *
 * ⛔ ÖZET KOLON YOK (`INV-B-009`) — `coverageRatio`/`sourceMatchRatio` İKİSİ
 * DE bu tablo + `main.baseline_volumes` üzerinde SORGUYLA türer, burada
 * `accepted_count`/`rejected_count`/`match_ratio` gibi senkronsuz bir kopya
 * kolon YOK.
 *
 * ── AD KONVANSİYONU — ÖLÇÜLDÜ, TERCİH DEĞİL ──────────────────────────────
 * `Z87`/task metni ürün dilinde `import_batch_rows` diyor. Bu repoda BUGÜN
 * paylaşılan/genel bir "import_batches" (ya da "import_batch_rows") kavramı
 * YOK — her import-domain'in KENDİ batch tablosu var (`sales_actual_batches`,
 * `on_invoice_batches`, `baseline_volume_import_batches`, bkz. migration
 * `1822`'nin JSDoc'u). O ayrımı BU tabloda bozup jenerik `import_batch_rows`
 * adını kullanmak, tam da `1822`'nin reddettiği "paylaşılan genel kavram"
 * yanılsamasını GERİ getirirdi — `F8` ailesi (aynı kavramın iki temsili).
 * ⇒ Sapma: tablo adı kardeşiyle (`baseline_volume_import_batches`) BİREBİR
 * ÖNEK taşıyacak şekilde `baseline_volume_import_batch_rows` seçildi.
 *
 * ── `reason` ENUM DEĞERLERİ — `Z87 §F12` (2026-09-02) İLE REVİZE ────────
 * ~~`Z87` (ilk hüküm): `SKU_NOT_FOUND, CPL_NOT_FOUND, INVALID_PERIOD,
 * INVALID_VALUE, DUPLICATE` (5 değer) — BİREBİR uygulanmıştı.~~ ÖLÇÜLEN
 * uyuşmazlık (bu 5'in `BL-2`'nin GERÇEK ürettiği kümeyle örtüşmemesi)
 * ürün sahibine bildirildi; `F12` KAPATTI: enum artık `BL-2`'nin gerçek
 * sözlüğü — **7 DEĞER**:
 *   `SKU_NOT_FOUND` · `CPL_NOT_FOUND` · `INVALID_PERIOD` ·
 *   `INVALID_VOLUME_FORMAT` · `NEGATIVE_VOLUME` · `MISSING_REQUIRED_FIELD` ·
 *   `DUPLICATE_GRAIN`
 * `INVALID_VALUE`/`DUPLICATE` ÖLÜR — hiç üretilmiyordu (İlke 1). Taşıyıcı
 * gerekçe: teşhis raporu `NEGATIVE_VOLUME` (veri hatası) ile
 * `INVALID_VOLUME_FORMAT`'ı (format hatası) AYIRT ETMELİ — `INVALID_VALUE`
 * altında birleştirmek raporu körleştirirdi.
 *
 * ⛔ **`F12`'nin İKİNCİ hükmü — `ADIM 2` için, ama enum'u BUGÜN bağlıyor:**
 * İKİ KANAL (parser `error_type`, servis `reasonCode`) → TEK SÖZLÜK. Parser
 * -özel kodlar (`INVALID_PERIOD`, `INVALID_VOLUME_FORMAT`) enum'un ÜYESİ
 * olarak PARSER'DAN çıkar — servis onları BAŞKA bir koda ÇEVİRMEZ (`F8`).
 * Hangi kodun hangi katmanda doğduğu `ADIM 2`'nin ölçüm işi.
 *
 * ── `resolved_sku_id` / `resolved_cpl_id` — REASON'A BAĞLI ŞEKİL ─────────
 * `BL-2`'nin BUGÜNKÜ kontrol akışı KODDAN ÖLÇÜLEREK kuruldu
 * (`baseline-volume.service.ts` `ingest()` ADIM 1/2, `...file-parser.
 * service.ts` `getPeriodValue`) — tahminden DEĞİL:
 *
 *   ACCEPTED                    ⇒ ikisi de NOT NULL (kabul edilen satırın
 *                                  anahtarları ÇÖZÜLMÜŞ OLMAK ZORUNDA).
 *   REJECTED + SKU_NOT_FOUND    ⇒ resolved_sku_id VE resolved_cpl_id İKİSİ
 *                                  DE ZORUNLU NULL — ölçüldü: `service.ts`
 *                                  ADIM 1, `sku = index.skuByCode.get(...)`
 *                                  bulunamazsa `continue` İLE CPL LOOKUP'A
 *                                  HİÇ ULAŞILMAZ (satır 139-149). CPL'in de
 *                                  hiç aranmadığı bir SKU-red DEĞİL, bir
 *                                  "hiçbir anahtar çözülmedi" satırıdır.
 *   REJECTED + CPL_NOT_FOUND    ⇒ resolved_sku_id NOT NULL (SKU zaten
 *                                  bulunmuştu, CPL lookup'a o yüzden
 *                                  ulaşıldı) · resolved_cpl_id ZORUNLU
 *                                  NULL — ölçüldü: satır 151-160, `cpl`
 *                                  lookup'ı yalnız `sku` bulunduktan SONRA
 *                                  çalışır. SKU_NOT_FOUND'un simetriği
 *                                  DEĞİL — CPL_NOT_FOUND'da SKU YARISI
 *                                  ZATEN ÇÖZÜLMÜŞTÜR.
 *   REJECTED + INVALID_PERIOD   ⇒ resolved_sku_id VE resolved_cpl_id İKİSİ
 *                                  DE ZORUNLU NULL — ölçüldü: `period`
 *                                  denetimi ADIM 1'in `missing`/parseError
 *                                  KAPISINDA, SKU/CPL lookup'ının HER
 *                                  İKİSİNDEN DE ÖNCE (satır 110-137);
 *                                  period başarısız olduğunda satır
 *                                  `continue` ile döngüden çıkar, SKU/CPL
 *                                  hiç aranmaz.
 *   REJECTED + {INVALID_VOLUME_FORMAT, NEGATIVE_VOLUME, DUPLICATE_GRAIN}
 *                                ⇒ ikisi de NOT NULL — ölçüldü: üçü de
 *                                  yalnız `acceptedOrRejected` dizisi
 *                                  ÜZERİNDE ÜRETİLİYOR (satır 201-265,
 *                                  286-309) ve bu dizinin HER ÜYESİ ADIM
 *                                  1'i SKU + CPL + period ÜÇÜ DE ÇÖZÜLEREK
 *                                  geçmiştir (satır 163-168) — TANIM GEREĞİ
 *                                  anahtar-SONRASI red sınıfı.
 *   REJECTED + MISSING_REQUIRED_FIELD
 *                                ⇒ **UNCONSTRAINED** (CHECK bu kodda
 *                                  resolved_*'a HİÇ dokunmaz) — ölçüldü, ve
 *                                  BU EN TEHLİKELİ KOD: `service.ts` bu
 *                                  reasonCode'u İKİ FARKLI AŞAMADA, TERS
 *                                  anahtar-durumlarıyla üretiyor:
 *                                    (a) ADIM 1, satır 128-137: sku_code/
 *                                        cpl_code hücresi BOŞ ⇒ SKU/CPL
 *                                        HİÇ ARANMADI ⇒ resolved_* NULL
 *                                        OLMALI.
 *                                    (b) ADIM 2, satır 220-242:
 *                                        `acceptedOrRejected` dizisi
 *                                        İÇİNDE, yalnız `base_volume`
 *                                        hücresi boş ⇒ SKU/CPL ZATEN
 *                                        ÇÖZÜLMÜŞ ⇒ resolved_* NOT NULL
 *                                        OLMALI.
 *                                  CHECK bu ikisini `reason` tek başına
 *                                  AYIRT EDEMEZ (hangi ALAN eksikti bilgisi
 *                                  şemada YOK) — uydurma bir kısıt yanlış
 *                                  bir invaryant olurdu (`§2.5`: gevşek
 *                                  bırakıp gerekçe yazmak, uydurma bir
 *                                  kısıttan İYİDİR). `ADIM 2/3` bu iki
 *                                  durumu ayırt etmek isterse (ör. `field`
 *                                  bilgisini ayrı taşıyarak) bu CHECK'i
 *                                  GENİŞLETİR — bu migration'ın kapsamı
 *                                  DEĞİL.
 *
 * DB `CHECK` ile bağlı (`CHK_baseline_volume_import_batch_rows_acceptance_
 * shape`) — sekiz durumun (1 ACCEPTED + 7 REJECTED/reason) DIŞINDA bir
 * kombinasyon INSERT'te reddedilir.
 *
 * ⛔ **CHECK'İN KENDİSİ `CASE` İLE YAZILDI, OR-zinciri İLE DEĞİL** — ölçülmüş
 * bir hata sınıfını kapatmak için: `status='REJECTED' AND reason IS NULL`
 * satırı, `OR`'lu eşitlik zincirinde (`reason = 'X'`) HER dal NULL'a
 * collapse olduğu için (`NULL = 'X'` → NULL, FALSE DEĞİL) TÜM `OR` ifadesi
 * NULL kalıyordu — Postgres bir CHECK'in NULL sonucunu GEÇERLİ sayar
 * (yalnız kesin FALSE reddeder). Negatif kontrolle YAKALANDI: bu satır
 * yanlışlıkla KABUL ediliyordu. `CASE` (basit form) NULL/eşleşmeyen girdide
 * `ELSE`'e düşer — kesin `FALSE`, asla `NULL` — bu sınıfı KÖKTEN kapatır.
 *
 * `raw`: hücre-ham `jsonb`, HER satırda NOT NULL (kabul/red fark etmez —
 * teşhis raporunun "hangi ham veri" sorusunun cevabı).
 *
 * `batch_id` + `row_no`: UNIQUE — bir batch içinde bir satır numarası bir
 * kez var olabilir (fiziksel kimlik, dosyanın satır sırası).
 *
 * GRANT: `SELECT` + `INSERT` — ⛔ `UPDATE`/`DELETE` YOK, satır IMMUTABLE
 * (düzeltme = yeni batch, `ADR 0012` ruhu).
 *
 * RLS: `Z85 §2` ÜÇÜNCÜ ŞEKİL — gerçek fail-closed politika TANIMLI,
 * `ENABLE`/`FORCE` YAZILMADI (KADEME 2, RLS-aktivasyon dalgasının işi).
 */
@Entity({ name: 'baseline_volume_import_batch_rows', schema: 'main' })
@Index(
  'UQ_baseline_volume_import_batch_rows_batch_row_no',
  ['batchId', 'rowNo'],
  { unique: true },
)
@Index('IDX_baseline_volume_import_batch_rows_tenant', ['tenantId'])
@Index('IDX_baseline_volume_import_batch_rows_batch', ['batchId'])
@Index('IDX_baseline_volume_import_batch_rows_batch_status_reason', [
  'batchId',
  'status',
  'reason',
])
export class BaselineVolumeImportBatchRow extends BaseEntity {
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  /** Dosyanın satır sırası — 1'den başlar (`CHECK (row_no > 0)`). */
  @Column({ name: 'row_no', type: 'integer' })
  rowNo!: number;

  /** Hücre-ham. Kabul/red fark etmeksizin HER satırda dolu. */
  @Column({ type: 'jsonb' })
  raw!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: ImportBatchRowStatus,
    enumName: 'baseline_volume_import_batch_row_status_enum',
  })
  status!: ImportBatchRowStatus;

  /** `status === REJECTED` ⇒ NOT NULL (DB CHECK); `ACCEPTED` ⇒ NULL. */
  @Column({
    type: 'enum',
    enum: ImportBatchRowReason,
    enumName: 'baseline_volume_import_batch_row_reason_enum',
    nullable: true,
  })
  reason?: ImportBatchRowReason;

  /**
   * `status === ACCEPTED` ⇒ NOT NULL. `reason ∈ {SKU_NOT_FOUND,
   * INVALID_PERIOD}` ⇒ ZORUNLU NULL. `reason === MISSING_REQUIRED_FIELD`
   * ⇒ UNCONSTRAINED (bkz. sınıf JSDoc'u — iki aşamalı, ters durumlar).
   * Diğer red sınıflarında NOT NULL.
   */
  @Column({ name: 'resolved_sku_id', type: 'uuid', nullable: true })
  resolvedSkuId?: string;

  /**
   * `status === ACCEPTED` ⇒ NOT NULL. `reason ∈ {SKU_NOT_FOUND,
   * CPL_NOT_FOUND, INVALID_PERIOD}` ⇒ ZORUNLU NULL. `reason ===
   * MISSING_REQUIRED_FIELD` ⇒ UNCONSTRAINED (bkz. sınıf JSDoc'u). Diğer
   * red sınıflarında NOT NULL.
   */
  @Column({ name: 'resolved_cpl_id', type: 'uuid', nullable: true })
  resolvedCplId?: string;

  // `foreignKeyConstraintName` + `onUpdate: 'NO ACTION'` dördü de: migration
  // katalogla BİREBİR eşlensin, `migration:generate` gerekçesiz DROP/ADD
  // önermesin (T-101/1815/1817/1822 dersi).
  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'FK_baseline_volume_import_batch_rows_tenant',
  })
  tenant!: Tenant;

  @ManyToOne(() => BaselineVolumeImportBatch, {
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'batch_id',
    foreignKeyConstraintName: 'FK_baseline_volume_import_batch_rows_batch',
  })
  batch!: BaselineVolumeImportBatch;

  @ManyToOne(() => Sku, { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'resolved_sku_id',
    foreignKeyConstraintName:
      'FK_baseline_volume_import_batch_rows_resolved_sku',
  })
  resolvedSku?: Sku;

  @ManyToOne(() => Cpl, { onDelete: 'RESTRICT', onUpdate: 'NO ACTION' })
  @JoinColumn({
    name: 'resolved_cpl_id',
    foreignKeyConstraintName:
      'FK_baseline_volume_import_batch_rows_resolved_cpl',
  })
  resolvedCpl?: Cpl;
}
