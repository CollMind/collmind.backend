/**
 * add-months.spec.ts — T-328.
 *
 * `addMonthsClamped`'in sözleşmesi: ay eklemesi hedef ayın SON GÜNÜNE clamp
 * eder, bir sonraki aya TAŞMAZ.
 *
 * Bu dosya birim seviyesidir; uç noktanın aynı sözleşmesi
 * `test/cash-flow-projection-month-overflow.e2e-spec.ts`'te ayrıca pin'li.
 * İkisi de gerekli: burası kuralı (artık yıl, negatif ay, yıl aşımı) ucuz ve
 * tam olarak ölçer, oradaki e2e ise kuralın GERÇEKTEN o uca BAĞLI olduğunu
 * ölçer (`CLAUDE.md §4.2`: "üretim çağrı yolu var mı").
 */

import { addMonthsClamped } from './add-months';

/** Girdi/çıktıyı saat-uyumundan bağımsız okumak için: her iki uç da UTC. */
const iso = (d: Date) => d.toISOString().split('T')[0];
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('addMonthsClamped', () => {
  describe('⛔ GÜN TAŞMASI — hedef ay daha kısa → son güne clamp', () => {
    it.each([
      // Bunların HEPSİ `setMonth` ile bir sonraki aya taşıyordu (ölçüldü,
      // T-328 reprodüksiyonu — sağdaki sütun `setMonth`in ürettiği DEĞER).
      ['2026-01-31', 1, '2026-02-28', 'setMonth: 2026-03-03'],
      ['2026-01-30', 1, '2026-02-28', 'setMonth: 2026-03-02'],
      ['2026-01-29', 1, '2026-02-28', 'setMonth: 2026-03-01'],
      ['2026-03-31', 1, '2026-04-30', 'setMonth: 2026-05-01'],
      ['2026-05-31', 1, '2026-06-30', 'setMonth: 2026-07-01'],
      ['2026-08-31', 6, '2027-02-28', 'setMonth: 2027-03-03'],
      ['2026-08-29', 6, '2027-02-28', 'setMonth: 2027-03-01'],
      ['2026-12-31', 2, '2027-02-28', 'setMonth: 2027-03-03'],
      ['2026-08-31', 18, '2028-02-29', 'setMonth: 2028-03-02'],
      ['2026-10-31', 1, '2026-11-30', ''],
      ['2026-07-31', 1, '2026-08-31', 'iki 31 günlük ay — clamp YOK'],
    ])('%s + %s ay = %s', (start, months, expected) => {
      expect(iso(addMonthsClamped(utc(start), months))).toBe(expected);
    });
  });

  describe('ARTIK YIL — Şubat 29 çeker, clamp oraya düşer', () => {
    it.each([
      ['2024-01-31', 1, '2024-02-29'],
      ['2024-01-30', 1, '2024-02-29'],
      ['2024-01-29', 1, '2024-02-29'],
      ['2023-01-31', 1, '2023-02-28'],
      ['2000-01-31', 1, '2000-02-29'], // 400'e bölünür → artık yıl
      ['1900-01-31', 1, '1900-02-28'], // 100'e bölünür, 400'e değil → DEĞİL
      ['2024-02-29', 12, '2025-02-28'], // artık gün, artık olmayan yıla
      ['2024-02-29', 48, '2028-02-29'], // artık günden artık güne
    ])('%s + %s ay = %s', (start, months, expected) => {
      expect(iso(addMonthsClamped(utc(start), months))).toBe(expected);
    });
  });

  /**
   * POZİTİF KONTROL — gün hedef ayda VAR, clamp devreye GİRMEMELİ. Bu yarı
   * olmadan yukarıdaki assertion'lar "her zaman ayın son gününe yuvarla"
   * şeklindeki BOZUK bir implementasyonda da yeşil kalırdı
   * (`§2.7 #9`: "sinyal sabitse, sinyal değildir").
   */
  describe('POZ.KONTROL — clamp YOK, gün aynen korunur', () => {
    it.each([
      ['2026-01-15', 1, '2026-02-15'],
      ['2026-01-01', 1, '2026-02-01'],
      ['2026-02-28', 1, '2026-03-28'],
      ['2026-08-15', 6, '2027-02-15'],
      ['2026-08-01', 6, '2027-02-01'],
      ['2026-01-31', 12, '2027-01-31'], // tam yıl → gün korunur
      ['2026-01-31', 0, '2026-01-31'], // sıfır ay → değişmez
      ['2026-08-31', 60, '2031-08-31'], // DTO üst sınırı
    ])('%s + %s ay = %s', (start, months, expected) => {
      expect(iso(addMonthsClamped(utc(start), months))).toBe(expected);
    });
  });

  describe('NEGATİF ay — aynı clamp kuralı geriye doğru', () => {
    it.each([
      ['2026-03-31', -1, '2026-02-28'],
      ['2024-03-31', -1, '2024-02-29'],
      ['2026-01-31', -1, '2025-12-31'], // yıl sınırını geriye geçer
      ['2026-01-15', -13, '2024-12-15'],
    ])('%s + (%s) ay = %s', (start, months, expected) => {
      expect(iso(addMonthsClamped(utc(start), months))).toBe(expected);
    });
  });

  it('argümanı MUTASYONA UĞRATMAZ — yeni bir Date döner', () => {
    const original = utc('2026-01-31');
    const before = original.getTime();
    const result = addMonthsClamped(original, 1);

    expect(original.getTime()).toBe(before);
    expect(result).not.toBe(original);
    expect(iso(result)).toBe('2026-02-28');
  });

  it('günün SAATİNİ korur — yalnızca takvim kayar', () => {
    const d = new Date('2026-01-31T13:45:12.345Z');
    const result = addMonthsClamped(d, 1);

    expect(result.toISOString()).toBe('2026-02-28T13:45:12.345Z');
  });

  /**
   * §2.5 — geçersiz girdi AÇIK hata fırlatır; sessizce `Invalid Date`
   * üretilmez. (`Invalid Date`, çağıranın `toISOString()`'inde
   * `RangeError: Invalid time value` olarak, parametre adı GEÇMEYEN bir 500
   * hâlinde patlıyordu — T-294'ün ölçtüğü kusur.)
   */
  describe('§2.5 — geçersiz girdi açık hata', () => {
    it.each([NaN, Infinity, -Infinity, 1.5])(
      'months=%s → TypeError',
      (months: number) => {
        expect(() => addMonthsClamped(utc('2026-01-31'), months)).toThrow(
          TypeError,
        );
      },
    );

    it('Invalid Date girdisi → TypeError', () => {
      expect(() => addMonthsClamped(new Date('çöp'), 1)).toThrow(TypeError);
    });

    it('hata mesajı parametre adını GEÇİRİR (teşhis edilebilir olsun)', () => {
      expect(() => addMonthsClamped(utc('2026-01-31'), NaN)).toThrow(/months/);
    });
  });

  /**
   * ⚠️ SAAT DİLİMİNDEN BAĞIMSIZLIK. Aritmetik UTC bileşenleri üzerinde yapılır,
   * yani sonuç makinenin `TZ`'sine bağlı DEĞİLDİR. Eski kod yerel getter'larla
   * okuyup çağıran tarafta `toISOString()` ile UTC'de yazıyordu — aynı
   * yerel/UTC karışımı `excel-serial-date.ts`'in kendi gün-kayması hatasının
   * ölçülmüş kök nedeni.
   */
  it('UTC gece yarısı girdisi, ofseti ne olursa olsun aynı günü üretir', () => {
    // UTC'nin DOĞUSU ve BATISI ile aynı anı temsil eden iki girdi:
    const dogu = new Date('2026-01-31T03:00:00.000+03:00'); // = 00:00Z
    const bati = new Date('2026-01-30T19:00:00.000-05:00'); // = 00:00Z

    expect(dogu.getTime()).toBe(bati.getTime());
    expect(iso(addMonthsClamped(dogu, 1))).toBe('2026-02-28');
    expect(iso(addMonthsClamped(bati, 1))).toBe('2026-02-28');
  });
});
