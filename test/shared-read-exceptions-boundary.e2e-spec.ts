/**
 * shared-read-exceptions-boundary.e2e-spec.ts
 *
 * `SHARED_READ` hücresinin **DÖRT İSTİSNASI** — göç-dışı, karar-bekler.
 * Dördü de tam **bir rol eksik** (4/5), yani hücrenin NEGATİF YARISINI
 * taşıyan tek rotalar bunlar.
 *
 * ⛔ NEDEN BU DOSYA VAR (code-reviewer S3, 2026-08-25):
 * Dördünden İKİSİ bugüne kadar YALNIZ BİR KOD YORUMUYLA korunuyordu —
 * `GET approvals` ve `GET approvals/pending` (`PLANNER` eksik). Mekanik
 * hiçbir kapı, o ikisini *"hücre SHARED_READ, göçürelim"* diye taşıyan bir
 * sonraki dalgayı durdurmaz: `route-scope` yeşil kalır (CAPABILITY kovası),
 * `single-mechanism` yeşil, `G6` yeşil (hücre uyuyor), `G7` yeşil (TSV
 * yeniden üretilirse). `PLANNER` sessizce ONAY KUYRUĞUNU görürdü.
 *
 * `CLAUDE.md` Done tanımı: *"bağlayıcı koşullar bir guard'a bağlandı —
 * bağlanamıyorsa koşul TAVSİYEYE düşürülür ve öyle işaretlenir."* Bu koşul
 * bağlanabiliyordu; bu dosya onu bağlıyor.
 *
 * Diğer ikisinin negatif pini ZATEN VAR — burada TEKRARLANMAZ (İlke 4:
 * aynı olgunun iki temsili bakım borcudur):
 *   finance-reporting/budget-variance          test/budget-variance.e2e-spec.ts
 *   spend-calculation/validate-budget/:planId  test/t249-app-runtime-live-route-grants.e2e-spec.ts
 *
 * ŞEKİL — iki-girdi-iki-çıktı (`CLAUDE.md §2.7 #6`, §2.7 #9 *"sinyal sabitse
 * sinyal değildir"*): izinli rol 403 ALMAZ, eksik rol 403 ALIR. Tek yönlü
 * bir iddia (yalnız 403 beklemek) guard'ın rotayı HERKESE kapattığı bozuk
 * durumda da yeşil kalırdı.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

describe('SHARED_READ istisnaları — onay kuyruğu PLANNER’a KAPALI', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let categoryManager: LoginResult;
  let finance: LoginResult;
  let readonly: LoginResult;

  // 4/5 — PLANNER YOK. Kaynak: approval.controller.ts @Roles(...) ve
  // capabilities.ts'in "DÖRT İSTİSNA" notu (B3 W4a ADIM 0).
  const ROUTES = ['approvals', 'approvals/pending'];

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    planner = await loginAs(app, 'PLANNER');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    finance = await loginAs(app, 'FINANCE');
    readonly = await loginAs(app, 'READONLY');
  });

  afterAll(async () => {
    await closeTestApp();
  });

  describe.each(ROUTES)('GET /%s', (route) => {
    // NEGATİF YARI — bu dosyanın var oluş sebebi.
    it('PLANNER 403 alır (onay kuyruğu görünürlüğü yok)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${route}`)
        .set('Authorization', `Bearer ${planner.accessToken}`);
      expect(res.status).toBe(403);
    });

    // POZİTİF YARI — 403'ün rotanın TÜMDEN kapalı olmasından gelmediğini
    // gösterir. Bu olmadan yukarıdaki assertion ayırt edici değildir.
    it.each([
      ['ADMIN', () => admin],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['FINANCE', () => finance],
      ['READONLY', () => readonly],
    ])('%s 403 ALMAZ', async (_label, who) => {
      const res = await request(app.getHttpServer())
        .get(`/${route}`)
        .set('Authorization', `Bearer ${who().accessToken}`);
      expect(res.status).not.toBe(403);
    });
  });
});
