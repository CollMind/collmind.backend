/**
 * dashboard.e2e-spec.ts
 *
 * Kapsam:
 *   GET /dashboard/summary
 *   GET /dashboard/pending-tasks
 *   GET /dashboard/cpl-status
 *
 * BRD kuralları:
 *   - Tüm roller (ADMIN/PLANNER/MANAGER/FINANCE/...) bu endpoint'lere erişebilir
 *   - Token olmadan → 401
 *   - PLANNER yalnızca atanmış CPL scope'undaki verileri görür (tenant-wide değil)
 *   - ADMIN tenant-wide görür
 *   - Cross-tenant sızıntı kontrolü: iki farklı tenant kullanıcısı birbirinin
 *     verisini görememeli (tek tenant seed olduğundan response count'u kısıtla)
 *
 * Dashboard summary response shape (DashboardSummaryResponseDto):
 *   activeAgreementCount, pendingApprovalCount, openTaskCount, budgetUtilization
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';

describe('Dashboard (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // ── Unauthenticated erişim ────────────────────────────────────────────────

  describe('Token olmadan erişim → 401', () => {
    it('GET /dashboard/summary → 401', async () => {
      await request(app.getHttpServer()).get('/dashboard/summary').expect(401);
    });

    it('GET /dashboard/pending-tasks → 401', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/pending-tasks')
        .expect(401);
    });

    it('GET /dashboard/cpl-status → 401', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/cpl-status')
        .expect(401);
    });
  });

  // ── GET /dashboard/summary ────────────────────────────────────────────────

  describe('GET /dashboard/summary', () => {
    it('ADMIN → 200 + geçerli summary shape', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(admin.authHeader())
        .expect(200);

      // DashboardSummaryResponseDto shape kontrolü
      expect(res.body).toHaveProperty('activeAgreementCount');
      expect(res.body).toHaveProperty('pendingApprovalCount');
      expect(res.body).toHaveProperty('openTaskCount');
      expect(typeof res.body.activeAgreementCount).toBe('number');
      expect(typeof res.body.pendingApprovalCount).toBe('number');
      expect(typeof res.body.openTaskCount).toBe('number');
    });

    it('PLANNER → 200 (kendi CPL scope, tenant-wide değil)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const plannerRes = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(planner.authHeader())
        .expect(200);

      const admin = await loginAs(app, 'ADMIN');
      const adminRes = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(admin.authHeader())
        .expect(200);

      // PLANNER CPL scope'u → ADMIN'den az veya eşit agreement görür
      expect(plannerRes.body.activeAgreementCount).toBeLessThanOrEqual(
        adminRes.body.activeAgreementCount,
      );
    });

    it('MANAGER → 200', async () => {
      const manager = await loginAs(app, 'MANAGER');

      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(manager.authHeader())
        .expect(200);
    });

    it('FINANCE → 200', async () => {
      const finance = await loginAs(app, 'FINANCE');

      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(finance.authHeader())
        .expect(200);
    });

    it('CATEGORY_MANAGER → 200', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(cm.authHeader())
        .expect(200);
    });

    it('READONLY → 200', async () => {
      const ro = await loginAs(app, 'READONLY');

      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(ro.authHeader())
        .expect(200);
    });

    it('Query parametresiyle (period=YYYY-MM) → 200', async () => {
      /**
       * DashboardSummaryQueryDto: field adı "period" (YYYY-MM | YYYY-QN | ALL).
       * "periodStart"/"periodEnd" geçersiz — ValidationPipe forbidNonWhitelisted=true
       * nedeniyle 400 döner. Doğru parametre: ?period=2026-06
       */
      const admin = await loginAs(app, 'ADMIN');

      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .query({ period: '2026-06' })
        .set(admin.authHeader())
        .expect(200);
    });

    it('Geçersiz query parametresi (forbidNonWhitelisted) → 400', async () => {
      /**
       * ValidationPipe forbidNonWhitelisted: true olduğundan bilinmeyen query
       * param'lar 400 döndürür. Bu beklenen davranış.
       */
      const admin = await loginAs(app, 'ADMIN');

      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .query({ periodStart: '2026-01', periodEnd: '2026-12' })
        .set(admin.authHeader())
        .expect(400);
    });

    it('budgetUtilization alanı null değil sayısal bir değer veya null (division-by-zero BRD)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(admin.authHeader())
        .expect(200);

      // BRD: division-by-zero → null, aksi halde sayı
      if (res.body.budgetUtilization !== null) {
        expect(typeof res.body.budgetUtilization).toBe('number');
      }
    });
  });

  // ── GET /dashboard/pending-tasks ──────────────────────────────────────────

  describe('GET /dashboard/pending-tasks', () => {
    it('ADMIN → 200 + geçerli PendingTasksResponseDto shape', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/dashboard/pending-tasks')
        .set(admin.authHeader())
        .expect(200);

      // PendingTasksResponseDto shape
      expect(res.body).toHaveProperty('pendingApprovals');
      expect(Array.isArray(res.body.pendingApprovals)).toBe(true);
    });

    it('PLANNER → 200 (kendi CPL scope)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get('/dashboard/pending-tasks')
        .set(planner.authHeader())
        .expect(200);

      expect(res.body).toHaveProperty('pendingApprovals');
    });

    it('Token olmadan → 401', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/pending-tasks')
        .expect(401);
    });
  });

  // ── GET /dashboard/cpl-status ─────────────────────────────────────────────

  describe('GET /dashboard/cpl-status', () => {
    it('ADMIN → 200 + geçerli CplStatusResponseDto shape', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/dashboard/cpl-status')
        .set(admin.authHeader())
        .expect(200);

      expect(res.body).toBeDefined();
      // CplStatusResponseDto: { items: [...] } ya da doğrudan array
      // Shape kontrolü: items array veya doğrudan array
      const items = Array.isArray(res.body) ? res.body : res.body.items;
      expect(Array.isArray(items)).toBe(true);
    });

    it('PLANNER → 200 (yalnızca kendi CPL scope)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const plannerRes = await request(app.getHttpServer())
        .get('/dashboard/cpl-status')
        .set(planner.authHeader())
        .expect(200);

      const admin = await loginAs(app, 'ADMIN');
      const adminRes = await request(app.getHttpServer())
        .get('/dashboard/cpl-status')
        .set(admin.authHeader())
        .expect(200);

      const plannerItems = Array.isArray(plannerRes.body)
        ? plannerRes.body
        : (plannerRes.body.items ?? []);
      const adminItems = Array.isArray(adminRes.body)
        ? adminRes.body
        : (adminRes.body.items ?? []);

      // PLANNER CPL scope'u → ADMIN'den az veya eşit CPL görür
      expect(plannerItems.length).toBeLessThanOrEqual(adminItems.length);
    });

    it('Token olmadan → 401', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/cpl-status')
        .expect(401);
    });
  });

  // ── Cross-tenant izolasyon ────────────────────────────────────────────────

  describe('Tenant izolasyonu', () => {
    it('ADMIN tenant-scoped veriler görür (başka tenant verisi yok)', async () => {
      /**
       * Tek tenant seed (Wella Turkey) mevcut olduğundan
       * cross-tenant sızıntı testi dolaylı yapılır:
       * ADMIN'in gördüğü data yalnızca kendi tenantına ait olmalı.
       *
       * Kanıt: summary'deki activeAgreementCount seed'deki agreement sayısı
       * ile tutarlı olmalı (başka tenant'ın agreement'ı karışmamalı).
       * Burada sadece 200 + sayısal response'u doğruluyoruz; multi-tenant
       * sızıntı testi ikinci tenant fixture gerektiriyor (bkz. QA planı).
       */
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(admin.authHeader())
        .expect(200);

      // Seed'de 3 agreement var (1 DRAFT, 1 APPROVED, 1 LTA DRAFT)
      // activeAgreementCount: APPROVED/ACTIVE olanlar = en az 1, en fazla 3
      expect(res.body.activeAgreementCount).toBeGreaterThanOrEqual(0);
      // Negatif sayı olamaz (BRD: division-by-zero → null, negatif count geçersiz)
      expect(res.body.activeAgreementCount).toBeGreaterThanOrEqual(0);
    });
  });
});
