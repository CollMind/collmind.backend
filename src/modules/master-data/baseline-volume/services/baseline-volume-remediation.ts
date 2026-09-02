import { ImportBatchRowReason } from '../../../../database/entities/baseline-volume-import-batch-row.entity';

/**
 * `BL-3` `ADIM 3` (`docs/process/BL3_DOGRULAMA_BRIEF.md §C`) — teşhis raporu
 * yüzeyinin taşıyıcı gerekçesi: `Z87 §F12`'nin enum'u 5'ten 7'ye çıkarma
 * gerekçesi *"`NEGATIVE_VOLUME` (değer hatası) ile `INVALID_VOLUME_FORMAT`
 * (biçim hatası) AYIRT EDİLMELİ"* idi — bu ayrım yalnız ENUM'da kalırsa ve
 * raporda AYNI cümleye düşerse gerekçe BOŞA gider (brief §C, ZORUNLU: "İkisi
 * aynı cümleyi taşıyorsa `Z87 §F12`'nin enum'u 7'ye çıkarma gerekçesi BOŞA
 * GİDER").
 *
 * ⛔ Bu tablo `BASELINE_VOLUME_REMEDIATION`'ın YEDİ ANAHTARI, enum'un YEDİ
 * ÜYESİYLE `Record<ImportBatchRowReason, string>` tip zoruyla EŞİTLENİR —
 * derleme zamanında bir üye eksik/fazla kalırsa `tsc` hata verir (sessiz
 * eksik-eşleme yasağı, `§2.5`'in bu yüzeydeki karşılığı).
 *
 * ⚠️ **KAPSAM:** bu dosya yalnız CÜMLE SÖZLÜĞÜdür — `baseline_volume_
 * import_batch_rows` tablosunu DOLDURAN yazma yolu (ingest() → batch_rows
 * INSERT) VE bu sözlüğü tüketen bir teşhis raporu ENDPOINT'i BU TURDA
 * YAZILMADI. Gerekçe + açık bulgu: `docs/process/BL3_DOGRULAMA_BRIEF.md`
 * ekindeki task raporu (BL-3 ADIM 2-3 kapanışı).
 */
export const BASELINE_VOLUME_REMEDIATION: Record<ImportBatchRowReason, string> =
  {
    [ImportBatchRowReason.SKU_NOT_FOUND]:
      "SKU kodu katalogda yok — kodu düzelt ya da SKU'yu tanımla.",
    [ImportBatchRowReason.CPL_NOT_FOUND]:
      "CPL kodu katalogda yok — kodu düzelt ya da CPL'i tanımla.",
    [ImportBatchRowReason.INVALID_PERIOD]:
      "Dönem hücresi okunamadı — 'YYYY-MM' ya da geçerli bir tarih ver.",
    [ImportBatchRowReason.INVALID_VOLUME_FORMAT]:
      'Hücre biçimi sayı değil — hücreyi düzelt.',
    [ImportBatchRowReason.NEGATIVE_VOLUME]: 'Değer negatif — değeri düzelt.',
    [ImportBatchRowReason.MISSING_REQUIRED_FIELD]:
      'Zorunlu hücre boş — doldur.',
    [ImportBatchRowReason.DUPLICATE_GRAIN]:
      'Aynı tenant × SKU × CPL × dönem iki kez var — birini kaldır.',
  };
