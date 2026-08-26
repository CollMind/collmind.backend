/**
 * b3-exception-wave-cell-migrations.e2e-spec.ts
 *
 * `B3` istisna dalgası — `Faz-B` (docs/process/B3_ISTISNA_DALGASI_BRIEF.md).
 * Hüküm: `docs/brd-v2/04_KARAR_KAYDI.md` `Z43`.
 *
 * Bu dosya, `Faz-B`'nin READONLY dahil bir DB fixture'ı GEREKTİRMEYEN dört
 * kalemini (B, D-sales-actuals, D-plan-performance, E) DAVRANIŞ olarak
 * pinler. `dashboard/summary` (C) ve `settlements/summary` (D) mevcut
 * dosyalarda zaten kapsanıyor (`dashboard.e2e-spec.ts` · `settlement.e2e-
 * spec.ts`); `MODES_LEDGER_READ +READONLY` (A) `ledger-envelope-role-
 * boundary.e2e-spec.ts`'te.
 *
 * Her pin İKİ GİRDİ / İKİ ÇIKTI (`CLAUDE.md §2.7 #6`): 403 tek başına
 * kanıt değildir — reddin sebebi ancak 403 ALMAYAN bir kardeş vaka yanında
 * yazılıysa ayırt edicidir.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis boş dizi döner. Salt-okunur rota, hiçbir satır yazılmaz/silinmez.
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 istisna dalgası Faz-B — hücre göçleri (Z43)', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let finance: LoginResult;
  let planner: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    finance = await loginAs(app, 'FINANCE');
    planner = await loginAs(app, 'PLANNER');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  // ── B — agreement-transactions/stats/summary: {A,F,P} → MODES_LEDGER_READ
  //       {A,F,P,RO} (−P ölür zaten üye, +RO YENİ) ─────────────────────────
  describe('GET /agreement-transactions/stats/summary → MODES_LEDGER_READ', () => {
    it('ADMIN → 200 (POZ.KONTROL)', async () => {
      await request(app.getHttpServer())
        .get('/agreement-transactions/stats/summary')
        .set(admin.authHeader())
        .expect(200);
    });

    it('FINANCE → 200 (POZ.KONTROL — değişmedi)', async () => {
      await request(app.getHttpServer())
        .get('/agreement-transactions/stats/summary')
        .set(finance.authHeader())
        .expect(200);
    });

    it('PLANNER → 200 (değişmedi — zaten hedef hücrenin üyesi)', async () => {
      await request(app.getHttpServer())
        .get('/agreement-transactions/stats/summary')
        .set(planner.authHeader())
        .expect(200);
    });

    it('READONLY → 200 (GENİŞLEME — Z43 §2 + Z42 §2 aynı satırda kapanır)', async () => {
      await request(app.getHttpServer())
        .get('/agreement-transactions/stats/summary')
        .set(readonly.authHeader())
        .expect(200);
    });

    it('CATEGORY_MANAGER → 403 (hedef hücrenin üyesi değil — Z25 kilidi, bu dalgaya binmedi)', async () => {
      await request(app.getHttpServer())
        .get('/agreement-transactions/stats/summary')
        .set(categoryManager.authHeader())
        .expect(403);
    });
  });

  // ── E — agreement-transactions/batch/:batchId: MODES_IMPORT_READ {A,F} →
  //       MODES_LEDGER_READ {A,F,P,RO} (§6 cümle-testi, açılım yok) ─────────
  describe('GET /agreement-transactions/batch/:batchId → MODES_LEDGER_READ', () => {
    it('ADMIN → 200 (POZ.KONTROL)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/agreement-transactions/batch/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('FINANCE → 200 (POZ.KONTROL — değişmedi)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/agreement-transactions/batch/${NONEXISTENT_UUID}`)
        .set(finance.authHeader());
      expect(res.status).toBe(200);
    });

    it('PLANNER → 200 (GENİŞLEME — eskiden 403)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/agreement-transactions/batch/${NONEXISTENT_UUID}`)
        .set(planner.authHeader());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('READONLY → 200 (GENİŞLEME — eskiden 403)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/agreement-transactions/batch/${NONEXISTENT_UUID}`)
        .set(readonly.authHeader());
      expect(res.status).toBe(200);
    });

    it('CATEGORY_MANAGER → 403 (değişmedi — hedef hücrenin üyesi değil)', async () => {
      await request(app.getHttpServer())
        .get(`/agreement-transactions/batch/${NONEXISTENT_UUID}`)
        .set(categoryManager.authHeader())
        .expect(403);
    });
  });

  // ── D — actuals-first/sales-actuals/summary: −PLANNER (SUMMARY_READ) ────
  describe('GET /actuals-first/sales-actuals/summary → SUMMARY_READ (−PLANNER)', () => {
    it('ADMIN → 200 (POZ.KONTROL)', async () => {
      await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/summary')
        .set(admin.authHeader())
        .expect(200);
    });

    it('FINANCE → 200 (POZ.KONTROL — değişmedi)', async () => {
      await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/summary')
        .set(finance.authHeader())
        .expect(200);
    });

    it('PLANNER → 403 (DARALTMA — Z43 §4, eskiden 200)', async () => {
      await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/summary')
        .set(planner.authHeader())
        .expect(403);
    });

    it('CATEGORY_MANAGER → 200 (değişmedi — SUMMARY_READ üyesi)', async () => {
      await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/summary')
        .set(categoryManager.authHeader())
        .expect(200);
    });

    it('READONLY → 200 (değişmedi — SUMMARY_READ üyesi)', async () => {
      await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/summary')
        .set(readonly.authHeader())
        .expect(200);
    });
  });

  // ── D — finance-reporting/plan-performance: −PLANNER (SUMMARY_READ) ─────
  describe('GET /finance-reporting/plan-performance → SUMMARY_READ (−PLANNER)', () => {
    it('ADMIN → 200 (POZ.KONTROL)', async () => {
      await request(app.getHttpServer())
        .get('/finance-reporting/plan-performance')
        .set(admin.authHeader())
        .expect(200);
    });

    it('FINANCE → 200 (POZ.KONTROL — değişmedi)', async () => {
      await request(app.getHttpServer())
        .get('/finance-reporting/plan-performance')
        .set(finance.authHeader())
        .expect(200);
    });

    it('PLANNER → 403 (DARALTMA — Z43 §4, eskiden 200)', async () => {
      await request(app.getHttpServer())
        .get('/finance-reporting/plan-performance')
        .set(planner.authHeader())
        .expect(403);
    });

    it('CATEGORY_MANAGER → 200 (değişmedi — SUMMARY_READ üyesi)', async () => {
      await request(app.getHttpServer())
        .get('/finance-reporting/plan-performance')
        .set(categoryManager.authHeader())
        .expect(200);
    });

    it('READONLY → 200 (değişmedi — SUMMARY_READ üyesi)', async () => {
      await request(app.getHttpServer())
        .get('/finance-reporting/plan-performance')
        .set(readonly.authHeader())
        .expect(200);
    });
  });
});
