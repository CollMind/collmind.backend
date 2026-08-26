/**
 * modes-write-capability-boundary.e2e-spec.ts
 *
 * `B3 W6` göçü (`Z35`, 2026-08-26) — `modes/` altındaki 25 rota `@Roles` →
 * `@RequireCapability` göçürüldü, üç hücreye BÖLÜNMÜŞ hâlde:
 *
 *   MODES_ACTUALS_WRITE  {ADMIN,FINANCE}   8 rota  (agreement-transaction ·
 *                                                    on-invoice · sales-actuals)
 *   MODES_PLAN_WRITE     {ADMIN,PLANNER}  12 rota  (agreement · plan)
 *   MODES_SUBMIT         {ADMIN,PLANNER}   5 rota  (agreement · plan)
 *
 * `ROLE_CAPABILITIES`'te üçü de göç öncesi `@Roles` kümesiyle BİREBİR —
 * davranış KORUNUYOR (`docs/brd-v2/04_KARAR_KAYDI.md` `Z35`).
 *
 * ── ZIT YÖN — pinler KARIŞMASIN ─────────────────────────────────────────
 *
 * `MODES_ACTUALS_WRITE` ile `MODES_PLAN_WRITE` AYNI Z35 bölünmesinin İKİ
 * ZIT ucudur: biri FINANCE'i içerir PLANNER'ı dışlar, diğeri tam tersi.
 * `MODES_SUBMIT` `MODES_PLAN_WRITE` ile AYNI kümeyi taşır ({ADMIN,PLANNER})
 * ama farklı bir üretici dalından türer (fiil deseni: submit/cancel/
 * return-to-draft) — `B3B1_DALGA_PLANI_ONERI.md`'nin uyardığı şekil.
 *
 *   MODES_ACTUALS_WRITE   FINANCE → izinli   ·  PLANNER → 403
 *   MODES_PLAN_WRITE      PLANNER → izinli   ·  FINANCE → 403
 *   MODES_SUBMIT          PLANNER → izinli   ·  FINANCE → 403
 *
 * `CLAUDE.md §2.7 #6` — İKİ GİRDİ / İKİ ÇIKTI: üçünün de NEGATİF YARISI VAR
 * (izinli rol 403 ALMAZ, izinsiz rol 403 ALIR) — pin gerçek ayırt edici.
 *
 * Üç rota da yan etkili; gövde/hedef KASTEN geçersiz — guard geçsin,
 * servis/ValidationPipe reddetsin, DB'ye HİÇBİR SATIR YAZILMASIN
 * (`T-047/T-060` satır sayısı invaryantı korunur):
 *
 *   POST /on-invoice/upload      → dosya YOK                → ADMIN/FINANCE 400
 *   POST /plans                  → zorunlu alanlar eksik      → ADMIN/PLANNER 400
 *   POST /plans/:id/submit       → nonexistent UUID            → ADMIN/PLANNER 404
 *
 * `POST /agreement-transactions` üzerindeki `{ADMIN,FINANCE}` daraltması
 * zaten `test/agreement-transaction-role-boundary.e2e-spec.ts`'te pinli
 * (`T-277`/`Z35`) — burada TEKRAR EDİLMEDİ, `on-invoice/upload` farklı bir
 * controller/rota seçilerek kapsam genişletildi.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis 404 üretir. Hiçbir satır yazılmaz/silinmez.
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W6 — modes/ yazma yetkisi (MODES_ACTUALS_WRITE / MODES_PLAN_WRITE / MODES_SUBMIT)', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let finance: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    planner = await loginAs(app, 'PLANNER');
    finance = await loginAs(app, 'FINANCE');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  // ── MODES_ACTUALS_WRITE {ADMIN,FINANCE} — FINANCE izinli, PLANNER DEĞİL ──
  describe('POST /on-invoice/upload (MODES_ACTUALS_WRITE {ADMIN,FINANCE})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['PLANNER', () => planner],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, dosya yok)', async () => {
      const res = await request(app.getHttpServer())
        .post('/on-invoice/upload')
        .set(admin.authHeader());
      expect(res.status).toBe(400);
    });

    it('FINANCE → 400 (POZ.KONTROL — guard geçti, dosya yok)', async () => {
      const res = await request(app.getHttpServer())
        .post('/on-invoice/upload')
        .set(finance.authHeader());
      expect(res.status).toBe(400);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (MODES_ACTUALS_WRITE yalnız ADMIN,FINANCE — PLANNER DIŞARIDA, Z35)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/on-invoice/upload')
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  // ── MODES_PLAN_WRITE {ADMIN,PLANNER} — PLANNER izinli, FINANCE DEĞİL ────
  describe('POST /plans (MODES_PLAN_WRITE {ADMIN,PLANNER})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['FINANCE', () => finance],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];
    // Zorunlu alanlar (planName/cplId/channelId/categoryId/startDate/
    // endDate) BİLEREK eksik — guard geçsin, ValidationPipe reddetsin.
    const INVALID_BODY = {};

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it('PLANNER → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (MODES_PLAN_WRITE yalnız ADMIN,PLANNER — FINANCE DIŞARIDA, Z35)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/plans')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  // ── MODES_SUBMIT {ADMIN,PLANNER} — aynı küme, FARKLI üretici dalı ───────
  describe('POST /plans/:id/submit (MODES_SUBMIT {ADMIN,PLANNER})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['FINANCE', () => finance],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];

    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/plans/${NONEXISTENT_UUID}/submit`)
        .set(admin.authHeader())
        .send({});
      expect(res.status).toBe(404);
    });

    it('PLANNER → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/plans/${NONEXISTENT_UUID}/submit`)
        .set(planner.authHeader())
        .send({});
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (MODES_SUBMIT yalnız ADMIN,PLANNER — FINANCE DIŞARIDA)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/plans/${NONEXISTENT_UUID}/submit`)
          .set(getUser().authHeader())
          .send({});
        expect(res.status).toBe(403);
      },
    );
  });
});
