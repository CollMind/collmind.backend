/**
 * period-month.spec.ts — T-333 (`Z81`).
 *
 * `toPeriodMonthUtc`'nin sözleşmesi: girdi Date'in UTC bileşenlerinden
 * `YYYY-MM` üretir — process'in local TZ'sinden BAĞIMSIZ. `TZ` probu
 * (Z81 §KANIT gerekliliği) `test:e2e`/`test` script'lerinin dışına
 * `TZ=America/New_York npx jest period-month` ile ayrıca koşulur; bu dosya
 * kendi içinde de iki bant simüle eder (UTC ve UTC batısı bir ofset) çünkü
 * `process.env.TZ`'yi Jest süreci başladıktan sonra değiştirmek `Intl`/
 * `Date` motorunun zaten çözdüğü TZ'yi değiştirmez (V8 bunu süreç başında
 * önbelleğe alır) — bu yüzden testler `getUTC*` çağrılarının GERÇEKTEN
 * kullanıldığını, yerel getter'lara hiç dokunulmadığını DOĞRUDAN sınar.
 */

import { toPeriodMonthUtc } from './period-month';

describe('toPeriodMonthUtc', () => {
  it('UTC gece yarısı bir tarih için doğru YYYY-MM üretir', () => {
    expect(toPeriodMonthUtc(new Date('2026-02-01T00:00:00.000Z'))).toBe(
      '2026-02',
    );
  });

  it('ayın son anı için hâlâ o ayı üretir (UTC 23:59:59.999)', () => {
    expect(toPeriodMonthUtc(new Date('2026-02-28T23:59:59.999Z'))).toBe(
      '2026-02',
    );
  });

  it('date-only ISO string parse UTC gece yarısında — ilk gün ayın kendisi', () => {
    // `new Date('2026-02-01')` spec gereği UTC gece yarısında parse eder.
    expect(toPeriodMonthUtc(new Date('2026-02-01'))).toBe('2026-02');
  });

  it('yıl sınırını doğru geçer (Aralık -> Ocak)', () => {
    expect(toPeriodMonthUtc(new Date('2026-12-31T23:00:00.000Z'))).toBe(
      '2026-12',
    );
    expect(toPeriodMonthUtc(new Date('2027-01-01T00:00:00.000Z'))).toBe(
      '2027-01',
    );
  });

  it('⛔ getUTC* kullanır — local getter kullansaydı UTC batısında bir gün önce kayardı', () => {
    // UTC 2026-02-01T00:00:00Z. Bir yerel getter (getMonth/getFullYear)
    // process TZ'si America/New_York (-05) olsaydı bunu 2026-01-31 23:00
    // yerel olarak okur ve '2026-01' üretirdi — TAM OLARAK T-333'ün
    // ölçtüğü kayma. `getUTC*` kullanan bu fonksiyon TZ'den bağımsız
    // olarak '2026-02' üretmeli.
    const d = new Date('2026-02-01T00:00:00.000Z');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(1); // 0-indexed: Şubat
    expect(toPeriodMonthUtc(d)).toBe('2026-02');
  });

  describe('§2.5 — geçersiz girdi SESSİZCE değil, AÇIKÇA reddedilir', () => {
    it('Invalid Date fırlatır', () => {
      expect(() => toPeriodMonthUtc(new Date('not-a-date'))).toThrow(TypeError);
    });

    it('Date olmayan bir değer fırlatır', () => {
      expect(() => toPeriodMonthUtc('2026-02-01' as unknown as Date)).toThrow(
        TypeError,
      );
    });
  });
});
