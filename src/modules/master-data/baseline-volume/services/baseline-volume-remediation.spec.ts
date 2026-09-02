import { ImportBatchRowReason } from '../../../../database/entities/baseline-volume-import-batch-row.entity';
import { BASELINE_VOLUME_REMEDIATION } from './baseline-volume-remediation';

/**
 * `BL-3` `ADIM 3` (`docs/process/BL3_DOGRULAMA_BRIEF.md §C`) — YEDİ enum
 * üyesinin HER BİRİ AYRI bir düzeltme eylemi cümlesi taşımalı. Taşıyıcı
 * gerekçe (`Z87 §F12`): `NEGATIVE_VOLUME` ("değeri düzelt") ile
 * `INVALID_VOLUME_FORMAT` ("biçimi düzelt") FARKLI eylemlerdir — ikisi aynı
 * cümleyi taşırsa enum'u 5'ten 7'ye çıkarma gerekçesi boşa gider.
 */
describe('BASELINE_VOLUME_REMEDIATION', () => {
  const allReasons = Object.values(ImportBatchRowReason);

  it('enum’un YEDİ üyesinin HEPSİ için bir cümle tanımlı', () => {
    expect(allReasons).toHaveLength(7);
    for (const reason of allReasons) {
      expect(BASELINE_VOLUME_REMEDIATION[reason]).toBeDefined();
      expect(typeof BASELINE_VOLUME_REMEDIATION[reason]).toBe('string');
      expect(BASELINE_VOLUME_REMEDIATION[reason].length).toBeGreaterThan(0);
    }
  });

  it('HİÇBİR iki cümle birbiriyle AYNI DEĞİL (özellikle NEGATIVE_VOLUME ≠ INVALID_VOLUME_FORMAT)', () => {
    const sentences = allReasons.map((r) => BASELINE_VOLUME_REMEDIATION[r]);
    const uniqueSentences = new Set(sentences);
    expect(uniqueSentences.size).toBe(sentences.length);

    expect(
      BASELINE_VOLUME_REMEDIATION[ImportBatchRowReason.NEGATIVE_VOLUME],
    ).not.toBe(
      BASELINE_VOLUME_REMEDIATION[ImportBatchRowReason.INVALID_VOLUME_FORMAT],
    );
  });
});
