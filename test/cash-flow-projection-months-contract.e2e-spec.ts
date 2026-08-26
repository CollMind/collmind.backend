/**
 * cash-flow-projection-months-contract.e2e-spec.ts — [[T-294]]
 *
 * Kapsam: GET /finance-reporting/cash-flow-projection — `months` parametre
 * sözleşmesi.
 *
 * Ölçülmüş üç kusur (Team Lead, 2026-08-26):
 *
 *   1. Controller `months`'u `@Query('months') months: number = 12` olarak,
 *      DTO'dan (`ReportFilters`) AYRI bildiriyordu. `main.ts`'de
 *      `whitelist:true, forbidNonWhitelisted:true` var, `ReportFilters`'ta
 *      `months` alanı YOKTU → `?months=12` gönderen frontend `400 "property
 *      months should not exist"` alıyordu.
 *
 *   2. ⛔ Ve o `400`, İKİNCİ bir kusuru ÖRTÜYORDU: çıplak
 *      `@Query('months') months: number = 12` bildiriminde `ParseIntPipe`
 *      yoktu. Global `ValidationPipe`, çıplak primitive @Query()
 *      parametrelerinde `Number(value)` dönüşümü uygular; parametre HİÇ
 *      gönderilmediğinde bu `Number(undefined)` → `NaN` üretir — ve `NaN`,
 *      JS'in `= 12` varsayılan parametresini TETİKLEMEZ (default yalnız
 *      `undefined` argümanda devreye girer). Sonuç: PARAMETRESİZ çağrı bile
 *      `endDate.setMonth(NaN)` → `Invalid Date` → `endDate.toISOString()`
 *      `RangeError: Invalid time value` → 500.
 *
 *   3. Whitelist'e yalnızca `months` eklemek (2. kusuru görmeden) `400`'ü
 *      kaldırıp `months=12` isteğinde STRING BİRLEŞTİRME kusurunu açardı:
 *      `getMonth() + "12"` → `"712"` → `setMonth("712")` → yıl 2085 gibi
 *      SESSİZ YANLIŞ bir tarih. Bu yüzden düzeltme `months`'u DTO'ya taşımak
 *      + `@Type(() => Number)` + `@IsInt/@Min/@Max` doğrulamasıyla TEK
 *      commit'te kapanır (§2.5: geçersiz girdi = açık hata, sessiz varsayılan
 *      DEĞİL).
 *
 * Bu dosya üçünü de PIN'ler — biri kırılırsa regresyon budur.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture } from './helpers/seed-e2e';

describe('Cash Flow Projection — months parametre sözleşmesi (E2E, T-294)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    await loadE2EFixture(app);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it('parametresiz çağrı → 200 (önceki kusur: NaN → Invalid Date → 500)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/cash-flow-projection')
      .set(admin.authHeader())
      .expect(200);

    expect(res.body).toHaveProperty('startDate');
    expect(res.body).toHaveProperty('endDate');

    // Varsayılan 12 ay: endDate, startDate'ten TAM 12 ay ileride olmalı —
    // string-birleştirme kusuru (getMonth()+"12"→"712") burada yakalanırdı.
    const start = new Date(res.body.startDate);
    const end = new Date(res.body.endDate);
    const monthDiff =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    expect(monthDiff).toBe(12);
    // Sessiz yanlış tarihin somut belirtisi: yıl 2085 gibi anlamsız bir
    // sıçrama YAPMAMALI.
    expect(end.getFullYear() - start.getFullYear()).toBeLessThanOrEqual(1);
  });

  it('?months=12 → 200 VE doğru tarih (önceki kusur: whitelist 400 "should not exist")', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/cash-flow-projection?months=12')
      .set(admin.authHeader())
      .expect(200);

    const start = new Date(res.body.startDate);
    const end = new Date(res.body.endDate);
    const monthDiff =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    expect(monthDiff).toBe(12);
  });

  it('?months=6 → 200 VE endDate 6 ay ileride (tip dönüşümü gerçekten sayı üretiyor)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/cash-flow-projection?months=6')
      .set(admin.authHeader())
      .expect(200);

    const start = new Date(res.body.startDate);
    const end = new Date(res.body.endDate);
    const monthDiff =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    expect(monthDiff).toBe(6);
  });

  describe('Geçersiz months → anlamlı 400 (§2.5: sessiz varsayılan YASAK)', () => {
    it.each([['0'], ['-1'], ['abc'], ['999']])(
      'months=%s → 400',
      async (value) => {
        const admin = await loginAs(app, 'ADMIN');
        const res = await request(app.getHttpServer())
          .get(`/finance-reporting/cash-flow-projection?months=${value}`)
          .set(admin.authHeader());

        expect(res.status).toBe(400);
        expect(res.body.message).toBeDefined();
      },
    );
  });

  // ⛔ S3 (code-reviewer): `months`'un PAYLAŞILAN `ReportFilters`'tan çıkarılması
  // (`T-294` `S2` → `T-296`) davranışsal olarak doğruydu ama HİÇBİR TESTE
  // BAĞLI DEĞİLDİ. Bugün yeşil; yarın biri `months`'u paylaşılan DTO'ya geri
  // koyarsa SESSİZCE geri döner ve sekiz uç yine `?months=6`'yı kabul edip
  // YOK SAYAR. `CLAUDE.md §4.2`: "bağlayıcı koşul bir guard'a bağlanır."
  it('KARDEŞ UÇLAR `months`i REDDEDER — paylaşılan DTO`dan çıktığının kanıtı', async () => {
    const admin = await loginAs(app, 'ADMIN');
    for (const yol of [
      'spend-composition',
      'budget-utilization',
      'spend-trend',
    ]) {
      const res = await request(app.getHttpServer())
        .get(`/finance-reporting/${yol}?months=6`)
        .set(admin.authHeader());
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain('months');
    }
  });

  // POZİTİF YARI: aynı parametre KENDİ ucunda kabul edilir. Bu olmadan
  // yukarıdaki assertion, `months`in HİÇBİR YERDE çalışmadığı bozuk durumda
  // da yeşil kalırdı (`§2.7 #9`: "sinyal sabitse sinyal değildir").
  it('POZ.KONTROL — kendi ucu `months`i KABUL eder', async () => {
    const admin = await loginAs(app, 'ADMIN');
    await request(app.getHttpServer())
      .get('/finance-reporting/cash-flow-projection?months=6')
      .set(admin.authHeader())
      .expect(200);
  });
});
