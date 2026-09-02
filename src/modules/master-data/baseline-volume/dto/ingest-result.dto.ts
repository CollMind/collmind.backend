/**
 * `BL-2` (`docs/process/BL2_GIRIS_BRIEF.md`) — baseline hacim import'unun HTTP
 * cevap şekli.
 *
 * ⚠️ `§4`'ün gereği: "reddedilen satırların SAYISI ve KİMLİĞİ kaybolmadan
 * BL-3'e ulaşmalı… bir VERİ YAPISI, bir ekran metni değil." Bu dosya o veri
 * yapısıdır.
 *
 * ⛔ İKİ AYRI RED SINIFI — KARIŞTIRILMAZ (bkz. baseline-volume.service.ts
 * JSDoc'u, "iki red sınıfı" bölümü):
 *
 *   `formatRejectedRows`   — anahtarlar (tenant/sku/cpl/period) ÇÖZÜLDÜ, ama
 *                            değer geçersiz (biçim/negatif/yinelenen-grain).
 *                            `main.baseline_volumes`'a `REJECTED` satır
 *                            olarak YAZILIR (`reason` NOT NULL CHECK) —
 *                            KALICI, `BL-3` doğrudan bu tablodan sorgular.
 *
 *   `keyUnresolvedRows`    — SKU/CPL kodu katalogda YOK ya da zorunlu bir
 *                            anahtar alanı (sku/cpl/period) hiç okunamadı.
 *                            `baseline_volumes`'a bir SATIR OLARAK GİREMEZ
 *                            (dört anahtar NOT NULL FK). Bugün YALNIZ bu HTTP
 *                            cevabında taşınır — KALICI bir ev YOK (migration
 *                            gerektirir, `BL-2` kapsamı dışı, bkz. rapor `§5`).
 *                            ⚠️ Bu satırların KİMLİĞİ, bu response tüketilip
 *                            atılırsa KAYBOLUR — DUR noktası, Team Lead'e
 *                            bildirildi.
 */

export interface BaselineVolumeRowIssue {
  rowNumber: number;
  /** Kısa, makine-okunur kod — `baseline_volumes.reason` ile AYNI sözlük
   *  (ör. `'INVALID_VOLUME_FORMAT'`, `'NEGATIVE_VOLUME'`, `'DUPLICATE_GRAIN'`,
   *  `'MISSING_REQUIRED_FIELD'`, `'SKU_NOT_FOUND'`, `'CPL_NOT_FOUND'`,
   *  `'INVALID_PERIOD'`). */
  reasonCode: string;
  field?: string;
  message: string;
  originalRowData?: Record<string, unknown>;
}

export interface IngestBaselineVolumeResultDto {
  batchId: string;
  totalRows: number;
  /** `acceptance_status = 'ACCEPTED'` olarak YAZILAN satır sayısı. */
  acceptedRows: number;
  /** `acceptance_status = 'REJECTED'` olarak YAZILAN satır sayısı (anahtarlar
   *  çözüldü, değer reddedildi) — KALICI, `baseline_volumes`'ta okunabilir. */
  formatRejectedRows: BaselineVolumeRowIssue[];
  /** Anahtarı ÇÖZÜLEMEYEN, tabloya HİÇ GİRMEYEN satırlar — bkz. dosya-üstü
   *  JSDoc. GEÇİCİ: yalnız bu response'ta yaşar. */
  keyUnresolvedRows: BaselineVolumeRowIssue[];
}
