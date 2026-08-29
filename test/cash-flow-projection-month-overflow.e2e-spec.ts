/**
 * cash-flow-projection-month-overflow.e2e-spec.ts
 *
 * SÖZLEŞME: `GET /finance-reporting/cash-flow-projection?months=N` uç noktası
 * TAM `N` aylık bir pencere döndürür — başlangıç günü ayın KAÇI olursa olsun.
 *
 * ⛔ NEDEN AYRI BİR DOSYA VE NEDEN `startDate` PARAMETRELİ
 *
 * Kardeş dosya `cash-flow-projection-months-contract.e2e-spec.ts` aynı
 * sözleşmenin bir parçasını (`monthDiff === months`) zaten pin'liyordu, ama
 * `startDate` GÖNDERMEDEN — yani ürün `new Date()` kullanıyordu. Sonuç: testin
 * rengi ÇALIŞTIRILDIĞI GÜNE bağlıydı.
 *
 *   2026-08-28'de koşarsa  → 2027-02-28  monthDiff=6  ✅ YEŞİL
 *   2026-08-29'da koşarsa  → 2027-03-01  monthDiff=7  ❌ KIRMIZI
 *
 * Bu bir "flaky test" DEĞİLDİ; ürün kusuruydu ve tetikleyicisi yük değil
 * TAKVİM'di (`DISIPLIN`: "flaky bir test, ürünün ARALIKLI bozulduğunun kanıtı
 * olabilir" — burada aralığı ayın günü belirliyor). Bir sözleşme testinin
 * ayın 1-28'inde kör, 29-31'inde uyanık olması, sözleşmenin ayda üç gün
 * ölçüldüğü anlamına gelir. Bu dosya `startDate`'i PARAMETREYLE verir, yani
 * her gün AYNI şeyi ölçer.
 *
 * KUSUR (T-328, `finance-reporting.service.ts` `getCashFlowProjection`):
 *
 *     const endDate = new Date(startDate);
 *     endDate.setMonth(endDate.getMonth() + months);   // ⛔ GÜN TAŞMASI
 *
 * `setMonth`, hedef ayda o GÜN YOKSA bir sonraki aya SESSİZCE taşar
 * (`Şub 31` → `Mar 3`). Ölçülmüş reprodüksiyon (düzeltme ÖNCESİ, bu dosyayla):
 *
 *     startDate=2026-01-31  months=1  →  endDate 2026-03-03  monthDiff=2  ⛔ İKİ KAT
 *     startDate=2026-08-31  months=6  →  endDate 2027-03-03  monthDiff=7  ⛔
 *
 * ÜRÜN ETKİSİ sessiz ve finansal, ve YÖNÜ tehlikeli: pencere istenenden
 * GENİŞLER, hiçbir uyarı verilmez, ve daha uzun bir tahsilat penceresi nakit
 * akışını OLDUĞUNDAN İYİ gösterebilir.
 *
 * ASSERTION ŞEKLİ — `endDate` STRING'İ BİREBİR karşılaştırılır, `getMonth()`
 * farkı DEĞİL. İki gerekçe:
 *   1. `monthDiff` bir ÖZETTİR: `2026-02-28` ile `2026-02-27` aynı `monthDiff`i
 *      verir. Clamp'ın hedef ayın SON GÜNÜNE düştüğünü ancak tam string
 *      gösterir.
 *   2. `new Date("YYYY-MM-DD")` UTC gece yarısında ayrışır ama `getMonth()`
 *      YEREL saatte okur; UTC'nin BATISINDAKİ bir makinede (`America/*`) gün
 *      bir geri kayar ve ay sınırındaki bir tarihte `getMonth()` yanlış ayı
 *      verir. Kardeş dosya bu bağımlılığı taşıyor; bu dosya taşımıyor.
 *      (Aynı yerel/UTC saat karışımı `common/date/excel-serial-date.ts`'in
 *      docstring'inde ölçülmüş hâliyle kayıtlı.)
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture } from './helpers/seed-e2e';

describe('Cash Flow Projection — ay ekleme GÜN TAŞMASI (E2E, T-328)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    await loadE2EFixture(app);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  /**
   * ⛔ TAŞMA VAKALARI — hedef ay, başlangıç gününü BARINDIRMIYOR.
   * Düzeltme öncesi HEPSİ bir sonraki aya taşıyordu.
   */
  describe('Hedef ay daha KISA → son güne clamp (taşma YOK)', () => {
    it.each([
      // [startDate,      months, beklenen endDate,  not]
      [
        '2026-01-31',
        1,
        '2026-02-28',
        '31 Ocak + 1 ay → 28 Şubat (artık yıl DEĞİL)',
      ],
      ['2024-01-31', 1, '2024-02-29', '31 Ocak + 1 ay → 29 Şubat (ARTIK YIL)'],
      ['2026-01-30', 1, '2026-02-28', '30 Ocak + 1 ay → 28 Şubat'],
      ['2026-01-29', 1, '2026-02-28', '29 Ocak + 1 ay → 28 Şubat'],
      [
        '2024-01-29',
        1,
        '2024-02-29',
        '29 Ocak + 1 ay → 29 Şubat (artık yılda taşmaz)',
      ],
      [
        '2026-03-31',
        1,
        '2026-04-30',
        '31 Mart + 1 ay → 30 Nisan (30 günlük ay)',
      ],
      ['2026-05-31', 1, '2026-06-30', '31 Mayıs + 1 ay → 30 Haziran'],
      ['2026-08-29', 6, '2027-02-28', 'BU KUSURU BUGÜN GÖRÜNÜR KILAN VAKA'],
      ['2026-08-30', 6, '2027-02-28', ''],
      ['2026-08-31', 6, '2027-02-28', ''],
      ['2026-08-31', 18, '2028-02-29', 'yıl aşımı + artık yıl'],
      ['2026-12-31', 2, '2027-02-28', 'yıl sınırını geçen clamp'],
    ])(
      'startDate=%s months=%s → endDate %s',
      async (startDate, months, expected) => {
        const admin = await loginAs(app, 'ADMIN');
        const res = await request(app.getHttpServer())
          .get(
            `/finance-reporting/cash-flow-projection?startDate=${startDate}&months=${months}`,
          )
          .set(admin.authHeader())
          .expect(200);

        expect(res.body.startDate).toBe(startDate);
        expect(res.body.endDate).toBe(expected);
      },
    );
  });

  /**
   * POZİTİF KONTROL — hedef ay başlangıç gününü BARINDIRIYOR, yani clamp
   * DEVREYE GİRMEMELİ. Bu yarı olmadan yukarıdaki assertion'lar, `endDate`in
   * her zaman ayın son gününe yuvarlandığı BOZUK bir düzeltmede de yeşil
   * kalırdı (`§2.7 #9`: "sinyal sabitse, sinyal değildir").
   */
  describe('POZ.KONTROL — gün hedef ayda VAR → clamp YOK, gün AYNEN korunur', () => {
    it.each([
      ['2026-08-15', 6, '2027-02-15'],
      ['2026-08-01', 6, '2027-02-01'],
      ['2026-08-28', 6, '2027-02-28'],
      ['2026-01-31', 12, '2027-01-31'],
      ['2026-01-15', 1, '2026-02-15'],
      ['2026-02-28', 1, '2026-03-28'],
    ])(
      'startDate=%s months=%s → endDate %s',
      async (startDate, months, expected) => {
        const admin = await loginAs(app, 'ADMIN');
        const res = await request(app.getHttpServer())
          .get(
            `/finance-reporting/cash-flow-projection?startDate=${startDate}&months=${months}`,
          )
          .set(admin.authHeader())
          .expect(200);

        expect(res.body.endDate).toBe(expected);
      },
    );
  });

  /**
   * Kardeş dosyanın `monthDiff` sözleşmesi, TARİHTEN BAĞIMSIZ hâliyle. Ay
   * farkı UTC getter'larıyla okunur — `new Date("YYYY-MM-DD")` UTC gece
   * yarısında ayrıştığı için tek saat-uyumlu okuma budur.
   */
  it('monthDiff === months — ayın 29/30/31`inde başlasa bile', async () => {
    const admin = await loginAs(app, 'ADMIN');
    for (const startDate of [
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2026-08-31',
    ]) {
      for (const months of [1, 3, 6, 12]) {
        const res = await request(app.getHttpServer())
          .get(
            `/finance-reporting/cash-flow-projection?startDate=${startDate}&months=${months}`,
          )
          .set(admin.authHeader())
          .expect(200);

        const start = new Date(res.body.startDate);
        const end = new Date(res.body.endDate);
        const monthDiff =
          (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
          (end.getUTCMonth() - start.getUTCMonth());
        expect({ startDate, months, monthDiff }).toEqual({
          startDate,
          months,
          monthDiff: months,
        });
      }
    }
  });
});
