/**
 * spend-trend-granularity-contract.e2e-spec.ts — [[T-296]]
 *
 * Kapsam: GET /finance-reporting/spend-trend — `granularity` parametre
 * sözleşmesi.
 *
 * `T-294`'ün `months` düzeltmesinin ardından `§7.1` sayımı yapıldı ve AYNI
 * controller'da AYNI sınıftan iki kardeş bulundu (`T-296`): `granularity`
 * (bu dosya) ve `comparisonType` (variance-analysis, ayrı dosya).
 *
 * Ölçülmüş kusur: controller `granularity`'yi
 * `@Query('granularity') granularity: ReportGranularity = ReportGranularity.MONTHLY`
 * olarak, `ReportFilters`'tan (whitelist DTO) AYRI bildiriyordu. `main.ts`'de
 * `whitelist:true, forbidNonWhitelisted:true` var → `?granularity=...`
 * gönderen her istek `400 "property granularity should not exist"` alıyordu.
 *
 * ⚠️ Bu kusur `T-294`'ün `months`'undan DARDIR: `granularity` TS enum tipli,
 * `design:paramtypes` `Object` emit ediyor, `ValidationPipe`'ın
 * `metatype === Number` dalına HİÇ girmiyor → değer `undefined` kalıyor →
 * JS varsayılanı (`= ReportGranularity.MONTHLY`) DEVREYE GİRİYOR. Yani
 * `NaN`/500 yolu YOK — yalnız whitelist `400`'ü var. Bu dosya bunu da pinler
 * (parametresiz çağrının DOĞRU granularity ile 200 döndüğünü).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture } from './helpers/seed-e2e';

describe('Spend Trend — granularity parametre sözleşmesi (E2E, T-296)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    await loadE2EFixture(app);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it('parametresiz çağrı → 200, varsayılan granularity=monthly', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/spend-trend')
      .set(admin.authHeader())
      .expect(200);

    expect(res.body.granularity).toBe('monthly');
  });

  it('?granularity=monthly → 200 (önceki kusur: whitelist 400 "should not exist")', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/spend-trend?granularity=monthly')
      .set(admin.authHeader())
      .expect(200);

    expect(res.body.granularity).toBe('monthly');
  });

  it('?granularity=daily → 200 VE çıktı granularity DEĞİŞİR (değer, statü değil)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/spend-trend?granularity=daily')
      .set(admin.authHeader())
      .expect(200);

    expect(res.body.granularity).toBe('daily');
  });

  it('?granularity=weekly → 200 VE çıktı granularity DEĞİŞİR', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/spend-trend?granularity=weekly')
      .set(admin.authHeader())
      .expect(200);

    expect(res.body.granularity).toBe('weekly');
  });

  it('geçersiz granularity → anlamlı 400 (§2.5: sessiz varsayılan YASAK)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/spend-trend?granularity=yearly')
      .set(admin.authHeader());

    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });

  it("kardeş uç (variance-analysis) `granularity`'yi REDDEDER — iki-girdi-iki-çıktı", async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/variance-analysis?granularity=daily')
      .set(admin.authHeader());

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('granularity should not exist'),
      ]),
    );
  });
});
