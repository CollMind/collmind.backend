/**
 * variance-analysis-comparison-type-contract.e2e-spec.ts — [[T-296]]
 *
 * Kapsam: GET /finance-reporting/variance-analysis — `comparisonType`
 * parametre sözleşmesi.
 *
 * Ölçülmüş kusur: controller `comparisonType`'ı
 * `@Query('comparisonType') comparisonType: ComparisonType = ComparisonType.BUDGET_VS_ACTUAL`
 * olarak, `ReportFilters`'tan (whitelist DTO) AYRI bildiriyordu. `main.ts`'de
 * `whitelist:true, forbidNonWhitelisted:true` var → `?comparisonType=...`
 * gönderen her istek `400 "property comparisonType should not exist"`
 * alıyordu.
 *
 * ⚠️ `T-294`'ün `months`'undan DAR: `comparisonType` TS enum tipli,
 * `ValidationPipe`'ın `metatype === Number` dalına HİÇ girmiyor → değer
 * `undefined` kalıyor → JS varsayılanı devreye giriyor. `NaN`/500 yolu YOK.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture } from './helpers/seed-e2e';

describe('Variance Analysis — comparisonType parametre sözleşmesi (E2E, T-296)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    await loadE2EFixture(app);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it('parametresiz çağrı → 200, varsayılan comparisonType=budget_vs_actual', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/variance-analysis')
      .set(admin.authHeader())
      .expect(200);

    expect(res.body.comparisonType).toBe('budget_vs_actual');
  });

  it('?comparisonType=budget_vs_actual → 200 (önceki kusur: whitelist 400 "should not exist")', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get(
        '/finance-reporting/variance-analysis?comparisonType=budget_vs_actual',
      )
      .set(admin.authHeader())
      .expect(200);

    expect(res.body.comparisonType).toBe('budget_vs_actual');
  });

  it('?comparisonType=previous_period → 200 VE çıktı comparisonType DEĞİŞİR (değer, statü değil)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get(
        '/finance-reporting/variance-analysis?comparisonType=previous_period',
      )
      .set(admin.authHeader())
      .expect(200);

    expect(res.body.comparisonType).toBe('previous_period');
  });

  // ⛔ DEĞİŞTİ (code-reviewer B1): önce `200 VE comparisonType DEĞİŞİR`
  // bekliyordu — ve o assertion, servisin GİRDİYİ GERİ YAZDIĞI alanı okuyup
  // SESSİZ BİR SIFIRI YEŞİL ÇİVİLİYORDU: `planned* = 0`, yani uç PLANLANAN
  // BÜTÇEYİ SIFIR gösteriyordu (ölçüldü: budget_vs_actual 1.600.000 ↔
  // forecast_vs_actual 0). `§7.1 T-084`: "bir hatayı belgelemek, onu KORUMA
  // ALTINA ALIR."
  it('?comparisonType=forecast_vs_actual → anlamlı 400 (§2.5: sessiz sıfır YASAK)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get(
        '/finance-reporting/variance-analysis?comparisonType=forecast_vs_actual',
      )
      .set(admin.authHeader());

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('desteklenmiyor');
  });

  // ⛔ AYIRT EDİCİ — code-reviewer B2. Yukarıdaki testler `comparisonType`
  // ECHO'sunu okuyor; servis onu girdiden aynen geri yazıyor. Bu test
  // DESTEKLENEN iki değerin GERÇEKTEN farklı sayı ürettiğini ölçer.
  it('comparisonType VERİYİ KOVALIYOR: iki desteklenen değer FARKLI planned üretir', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const ARALIK = 'startDate=2025-01-01&endDate=2026-12-31';
    const al = async (t: string) => {
      const r = await request(app.getHttpServer())
        .get(
          `/finance-reporting/variance-analysis?${ARALIK}&comparisonType=${t}`,
        )
        .set(admin.authHeader())
        .expect(200);
      const toplam = r.body.variances[r.body.variances.length - 1];
      return Number(toplam.planned);
    };

    const butce = await al('budget_vs_actual');
    const onceki = await al('previous_period');

    // Sabit sayı YAZILMIYOR (fixture değişebilir) — ölçülen şey İKİSİNİN
    // AYRI hesaplandığı, yani mekanizmanın kendisi.
    expect(butce).not.toBe(onceki);
  });

  it('geçersiz comparisonType → anlamlı 400 (§2.5: sessiz varsayılan YASAK)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/variance-analysis?comparisonType=nonsense')
      .set(admin.authHeader());

    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });

  it("kardeş uç (spend-trend) `comparisonType`'ı REDDEDER — iki-girdi-iki-çıktı", async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get('/finance-reporting/spend-trend?comparisonType=previous_period')
      .set(admin.authHeader());

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('comparisonType should not exist'),
      ]),
    );
  });

  it("kardeş uç (cash-flow-projection) `comparisonType`'ı REDDEDER", async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .get(
        '/finance-reporting/cash-flow-projection?comparisonType=previous_period',
      )
      .set(admin.authHeader());

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('comparisonType should not exist'),
      ]),
    );
  });
});
