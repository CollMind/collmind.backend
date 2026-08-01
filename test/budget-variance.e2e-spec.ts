/**
 * budget-variance.e2e-spec.ts — T-023 (finance-reporting bütçe varyansı raporu)
 *
 * Kapsam:
 *   GET /finance-reporting/budget-variance
 *
 * Kapsam kararı (ürün sahibi, 2026-08-01): "Bütçe varyansı" = tahsis edilen
 * bütçe (allocated) vs GERÇEKLEŞEN harcama (consumed, ledger DEBIT-CREDIT).
 * Hacim/KPI varyansı (plan vs gerçek satış) KAPSAM DIŞI.
 *
 * Doğrulanan noktalar:
 *   - Token olmadan → 401
 *   - RBAC: ADMIN/FINANCE_MANAGER/READONLY → 200 (UNRESTRICTED, AccessScopeService)
 *     PLANNER → 403 (bu rapor finans/kategori sahipliği alanı, planner'a kapalı)
 *   - CATEGORY_MANAGER → 200 ama fail-closed scope nedeniyle boş (seed'deki
 *     budget_envelopes satırları categoryId=NULL taşıyor; CM'nin scope pair'leri
 *     her zaman somut bir categoryId taşır — NULL'a eşleşmez, AccessScopeService
 *     R-2 ilkesi). Bu bir bug DEĞİL, mevcut seed + fail-closed scope'un beklenen
 *     kesişimi.
 *   - Sayısal doğruluk: ENV-2026-NKA-Q1 için rapor çıktısı, v_budget_summary'nin
 *     ham SQL toplamıyla BİREBİR eşleşir (no-recompute kanıtı).
 *   - allocated=0 durumunda variancePercent/utilizationPercent/status null
 *     (canlı DB'de böyle bir zarf yoksa unit test bu senaryoyu zaten kapsıyor —
 *     bkz. finance-reporting.budget-variance.service.spec.ts).
 *   - reserved ile consumed asla karışmaz: response'ta ikisi ayrı alan.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';

describe('Budget Variance Report (E2E, T-023)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  describe('Token olmadan erişim → 401', () => {
    it('GET /finance-reporting/budget-variance → 401', async () => {
      await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .expect(401);
    });
  });

  describe('RBAC', () => {
    it('ADMIN → 200 + geçerli rapor şekli', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .set(admin.authHeader())
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('byChannel');
      expect(res.body).toHaveProperty('byCategory');
      expect(res.body).toHaveProperty('byPeriod');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);

      const envNka = res.body.items.find(
        (i: any) => i.code === 'ENV-2026-NKA-Q1',
      );
      expect(envNka).toBeDefined();
      // reserved (encumbrance) ve consumed (GERÇEKLEŞEN) ayrı alanlar —
      // birbirine karıştırılmamış olmalı.
      expect(envNka).toHaveProperty('reserved');
      expect(envNka).toHaveProperty('consumed');
      expect(envNka).toHaveProperty('allocated');
      expect(envNka).toHaveProperty('variance');
    });

    it('FINANCE_MANAGER → 200 (UNRESTRICTED)', async () => {
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .set(fm.authHeader())
        .expect(200);
    });

    it('READONLY → 200 (UNRESTRICTED)', async () => {
      const readonly = await loginAs(app, 'READONLY');
      await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .set(readonly.authHeader())
        .expect(200);
    });

    it('PLANNER → 403 (bu rapora erişimi yok)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .set(planner.authHeader())
        .expect(403);
    });

    it('CATEGORY_MANAGER → 200, fail-closed scope nedeniyle boş items (seed envelope categoryId=NULL, CM pair categoryId somut)', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .set(cm.authHeader())
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total.allocated).toBe(0);
      expect(res.body.total.variancePercent).toBeNull();
    });
  });

  describe('Filtreler', () => {
    it('fiscalYear filtresi yalnızca eşleşen zarfları döner', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .query({ fiscalYear: '2026' })
        .set(admin.authHeader())
        .expect(200);

      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.fiscalYear).toBe('2026');
      }
    });

    it('channels[] filtresi yalnızca eşleşen zarfları döner (repeated-key query string)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance?channels[]=NKA')
        .set(admin.authHeader())
        .expect(200);

      // Seed'deki envelope.channel kolonu NULL (yalnızca metadata.channel dolu,
      // bkz. budget-envelope.seed.ts) — bu filtre bilerek boş sonuç üretir;
      // burada doğrulanan şey 400 DEĞİL 200 dönmesi (DTO array-parse regresyonu).
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('Null-safety (BRD division-by-zero kuralı)', () => {
    it('hiçbir item Infinity/NaN variancePercent döndürmez', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .set(admin.authHeader())
        .expect(200);

      for (const item of res.body.items) {
        if (item.variancePercent !== null) {
          expect(Number.isFinite(item.variancePercent)).toBe(true);
        }
        if (item.utilizationPercent !== null) {
          expect(Number.isFinite(item.utilizationPercent)).toBe(true);
        }
      }
    });
  });

  describe('Sayısal doğruluk — v_budget_summary ile birebir eşleşme', () => {
    it('ENV-2026-NKA-Q1 raporu, ham v_budget_summary SQL toplamıyla birebir aynı', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const raw = await dataSource.query(
        `SELECT allocated_amount, reserved_amount, consumed_amount, available_amount
           FROM main.v_budget_summary
          WHERE tenant_id = $1 AND code = 'ENV-2026-NKA-Q1'`,
        [fixture.tenantId],
      );
      expect(raw.length).toBe(1);
      const allocated = Number(raw[0].allocated_amount);
      const reserved = Number(raw[0].reserved_amount);
      const consumed = Number(raw[0].consumed_amount);
      const available = Number(raw[0].available_amount);

      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-variance')
        .set(admin.authHeader())
        .expect(200);

      const item = res.body.items.find(
        (i: any) => i.code === 'ENV-2026-NKA-Q1',
      );
      expect(item).toBeDefined();
      expect(Number(item.allocated)).toBe(allocated);
      expect(Number(item.reserved)).toBe(reserved);
      expect(Number(item.consumed)).toBe(consumed);
      expect(Number(item.available)).toBe(available);

      // Varyans SADECE consumed'dan hesaplanır — reserved'dan DEĞİL (BRD
      // "Actual vs budget").
      const expectedVariance = consumed - allocated;
      expect(Number(item.variance)).toBe(expectedVariance);
      if (allocated > 0) {
        expect(item.variancePercent).toBeCloseTo(
          (expectedVariance / allocated) * 100,
          5,
        );
      } else {
        expect(item.variancePercent).toBeNull();
      }
    });
  });
});
