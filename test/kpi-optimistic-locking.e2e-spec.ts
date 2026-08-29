/**
 * kpi-optimistic-locking.e2e-spec.ts
 *
 * T-039 — optimistic locking for KPI/formula configuration (BRD "eş zamanlı
 * düzenleme" + "hesaplamalar dinamik formülden gelir"). Design and
 * granularity survey: docs/analysis/0005-optimistic-locking-design.md §7.5,
 * task: .claude/backlog/tasks/T-039.md.
 *
 * Unlike T-034 (strict — `version` required, no flag, frontend shipped in
 * the same turn), this rollout is ADDITIVE: `collmind.frontend`'s
 * `KpiManagementPage` (`src/api/endpoints/kpi.endpoints.ts`) does not send
 * `version` yet, so a strict 409-on-missing-version would break every save
 * in that screen. `version` is therefore optional here — sending it
 * enforces CAS, omitting it preserves pre-T-039 unconditional-write
 * behavior (see kpi.service.ts#update, kpi.repository.ts#updateUnversioned).
 *
 * Layers (same discipline as T-034, docs/analysis/0005 §9):
 *   1. Stale-version replay (deterministic, no timing) — PRIMARY proof.
 *   2. Legacy/no-version path still works (frontend not broken).
 *   3. Real concurrency race, order-independent invariant.
 *   4. Formula-cache freshness: the update is reflected in the NEXT
 *      calculation, not up to 60s later (KpiEngineService#getActiveKpis TTL
 *      cache — this is the actual BRD "dinamik formül" risk T-039 called
 *      out, not just the lost-update race).
 *
 * Mutation-proof (temporarily removing the `AND version = :expected`
 * predicate from versioned-update.helper.ts) is shared with T-034's proof
 * of the same helper — re-run and pasted into the T-039 task report rather
 * than duplicated as a standing CI step (same rationale as T-034's file
 * header).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  resolveIdByCode,
  cleanupTestPlans,
  E2EFixture,
} from './helpers/seed-e2e';

describe('KPI/formula config — optimistic locking (T-039, E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let FU_TUP_BOYA: string;

  // KPI codes/ids created by this suite — always torn down in afterAll so
  // they never leak into the tenant's active-KPI list used by other e2e
  // files (calculateSku() runs over ALL active KPIs).
  const createdKpiCodes: string[] = [];
  const createdKpiIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    // T-327 — idempotent kalıntı temizliği (belt-and-suspenders, `afterAll`ın
    // TAMAMLAYICISI, YERİNE geçeni değil). `afterAll` (aşağıda) her normal
    // koşumda `createdKpiIds`'i hard-DELETE eder ve bu ÖLÇÜLDÜ: tam bir
    // `npm run test:e2e` koşumunda `main.kpis` delta 0 (T-327 raporu).
    // Ama `afterAll` yalnız SÜREÇ normal biterse çalışır — Jest worker'ının
    // ölmesi/kesilmesi (OOM, ctrl-C, CI timeout) `afterAll`ı ATLAR ve tam
    // bunun izini 2026-08-16 tarihli altı `E2E_KPILOCK_*` satırı (kpi_group
    // 'Test') 2026-08-28'e kadar canlı DB'de bıraktı (bkz. T-327 bulgusu).
    // Hiçbir `afterAll` şekli bu sınıfı KAPATAMAZ (kesinti afterAll'dan
    // ÖNCE olur); bu yüzden suite'in KENDİSİ bir sonraki koşumda kendi
    // kalıntısını silerek kendiliğinden iyileşir — kapsam dar ve kesin:
    // yalnız bu suite'in ürettiği kod deseni (`E2E_KPILOCK_%`), yalnız bu
    // fixture tenant'ı. (b) şekli ("fixture yerine mevcut ürün KPI'ı
    // kullan") REDDEDİLDİ: Layer 1/2/3 kendi `version` sayacını CAS ile
    // mutasyona uğratıyor (stale-replay/race testleri) — paylaşılan bir
    // ürün KPI'sının version'ını testler arası veya paralel koşumlar arası
    // paylaşmak test izolasyonunu bozar ve Layer 4 gerçek bir formül
    // değişikliği yapıp SKU hesaplamasını etkiliyor (üretim KPI'sında asla
    // yapılmaması gereken bir mutasyon).
    await dataSource.query(
      `DELETE FROM main.kpis WHERE tenant_id = $1 AND kpi_code LIKE 'E2E_KPILOCK_%'`,
      [fixture.tenantId],
    );

    [CHANNEL_NKA, CATEGORY_SAC_BOYASI, FU_TUP_BOYA] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
      resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-SAC-BOYASI'),
      resolveIdByCode(
        app,
        fixture.tenantId,
        'forecasting_units',
        'FU-TUP-BOYA',
      ),
    ]);
  });

  afterAll(async () => {
    try {
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-KPILOCK-');
    } catch {
      // best-effort
    }
    // Hard delete (not softRemove) so a later `activeOnly` scan by any
    // other suite never sees these test-only codes again.
    try {
      if (createdKpiIds.length > 0) {
        await dataSource.query(
          `DELETE FROM main.kpis WHERE id = ANY($1::uuid[])`,
          [createdKpiIds],
        );
      }
    } catch {
      // best-effort
    }
    await closeTestApp();
  });

  async function createDraftPlan(namePrefix: string): Promise<string> {
    const planner = await loginAs(app, 'PLANNER');
    const res = await request(app.getHttpServer())
      .post('/plans')
      .set(planner.authHeader())
      .send({
        planName: `E2E-KPILOCK-${namePrefix}-${Date.now()}`,
        cplId: fixture.cplId,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY_SAC_BOYASI,
        startDate: '2026-01-05',
        endDate: '2026-01-31',
      })
      .expect(201);
    return res.body.id;
  }

  async function createTestKpi(codeSuffix: string, formulaText = 'PLAN_VOL') {
    const admin = await loginAs(app, 'ADMIN');
    const kpiCode = `E2E_KPILOCK_${codeSuffix}_${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/master-data/kpis')
      .set(admin.authHeader())
      .send({
        kpiCode,
        kpiName: `E2E KPI lock test ${codeSuffix}`,
        kpiGroup: 'Test',
        formulaType: 'expression',
        formulaText,
        dependsOnKpis: ['PLAN_VOL'],
        calculationOrder: 4,
        calculationLevel: 'sku',
        displayFormat: 'number',
        decimalPlaces: 2,
        showInGrid: false,
        isActive: true,
      })
      .expect(201);
    createdKpiCodes.push(kpiCode);
    createdKpiIds.push(res.body.id);
    return res.body as { id: string; version: number; kpiCode: string };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Layer 1 — deterministic stale-version replay (PRIMARY proof)
  // ──────────────────────────────────────────────────────────────────────

  describe('stale-version replay (deterministic, no timing)', () => {
    it('PATCH /master-data/kpis/:id — v1 succeeds, replaying v1 gets 409 STALE_VERSION, the lost formula edit never lands', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const kpi = await createTestKpi('STALE');
      expect(kpi.version).toBe(1);

      const firstWrite = await request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ formulaText: 'PLAN_VOL * 2', version: 1 })
        .expect(200);
      expect(firstWrite.body.version).toBe(2);
      expect(firstWrite.body.formulaText).toBe('PLAN_VOL * 2');

      // Replay the SAME (now stale) version=1 — a second Admin editing the
      // RAG threshold concurrently must not silently clobber the formula
      // change above.
      const staleReplay = await request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ ragGreenThreshold: 50, version: 1 });

      expect(staleReplay.status).toBe(409);
      expect(staleReplay.body.code).toBe('STALE_VERSION');
      expect(staleReplay.body.currentVersion).toBe(2);
      expect(staleReplay.body.current.formulaText).toBe('PLAN_VOL * 2');

      // No lost update: a fresh GET still shows the winner's formula.
      const finalRes = await request(app.getHttpServer())
        .get(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .expect(200);
      expect(finalRes.body.formulaText).toBe('PLAN_VOL * 2');
      expect(finalRes.body.version).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Layer 2 — additive rollout: no-version request still works (frontend
  // not broken)
  // ──────────────────────────────────────────────────────────────────────

  describe('additive rollout — omitting `version` does not 409 (KpiManagementPage does not send it yet)', () => {
    it('PATCH without `version` -> 200 (legacy behavior), and the stored version is still bumped for the next reader', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const kpi = await createTestKpi('NOVERSION');

      const res = await request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ formulaText: 'PLAN_VOL * 3' })
        .expect(200);

      expect(res.body.formulaText).toBe('PLAN_VOL * 3');
      // Bumped even though the caller never checked it in — otherwise a
      // later version-aware caller would see a permanently frozen `1` and
      // could never legitimately CAS against this row again.
      expect(res.body.version).toBe(2);
    });

    it('a versioned write followed by a version-less write still succeeds, and bumps version again (no CAS enforced when omitted)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const kpi = await createTestKpi('MIXED');

      const v2 = await request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ calculationOrder: 5, version: 1 })
        .expect(200);
      expect(v2.body.version).toBe(2);

      const v3 = await request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ calculationOrder: 6 }) // no version — legacy path
        .expect(200);
      expect(v3.body.version).toBe(3);
      expect(v3.body.calculationOrder).toBe(6);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Layer 3 — real concurrent race, order-independent invariant
  // ──────────────────────────────────────────────────────────────────────

  describe('real concurrent race — order-independent invariant', () => {
    it('two simultaneous PATCH requests with the same version: exactly one 200 and one 409 (never [200,200] lost-update, never [409,409] livelock)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const kpi = await createTestKpi('RACE');

      const reqA = request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ formulaText: 'PLAN_VOL * 10', version: 1 });
      const reqB = request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ formulaText: 'PLAN_VOL * 20', version: 1 });

      const [resA, resB] = await Promise.all([reqA, reqB]);
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Layer 4 — formula-cache freshness: THE dynamic-formula risk. Without
  // `KpiEngineService#clearCache` being wired into `KpiService#update`
  // (T-039 fix — `clearCache` had zero non-test callers before this task),
  // this test would fail: `getActiveKpis` caches the tenant's active KPI
  // list for 60s, far longer than this test's runtime, so a stale formula
  // would still be in effect for the second recalc below.
  // ──────────────────────────────────────────────────────────────────────

  describe('formula update is used by the NEXT calculation (no 60s stale cache)', () => {
    it('recalc after a formula PATCH reflects the new formula immediately, not the pre-update one', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const planner = await loginAs(app, 'PLANNER');

      // Trivial SKU-level KPI: value == PLAN_VOL initially.
      const kpi = await createTestKpi('FRESH', 'PLAN_VOL');

      const planId = await createDraftPlan('CACHE-FRESH');
      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus.find(
        (f: any) => f.id === addFuRes.body.id,
      );
      const skuId = planFu.planSkus[0].skuId;

      // First recalc — our KPI's formula is still `PLAN_VOL`.
      const beforeUpdate = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 500, plannedVolume: 700, version: 1 })
        .expect(200);
      const kpiBefore = beforeUpdate.body.calculatedKpis?.[kpi.kpiCode]?.value;
      expect(Number(kpiBefore)).toBe(700); // == PLAN_VOL

      // Admin changes the formula to double PLAN_VOL — this must be picked
      // up by the VERY NEXT recalc, not up to 60s later.
      await request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .send({ formulaText: 'PLAN_VOL * 2', version: 1 })
        .expect(200);

      // Second recalc, same PLAN_VOL (700) — if the engine cache were
      // stale, this would still compute 700 (old formula), not 1400.
      const afterUpdate = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 500, plannedVolume: 700, version: 2 })
        .expect(200);
      const kpiAfter = afterUpdate.body.calculatedKpis?.[kpi.kpiCode]?.value;
      expect(Number(kpiAfter)).toBe(1400); // == PLAN_VOL * 2, NOT the stale 700
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Cross-tenant isolation regression (T-034 §1.5 pattern) —
  // `updateVersioned`/`updateUnversioned` both scope on `{ id, tenantId }`;
  // prove it rather than assert it.
  // ──────────────────────────────────────────────────────────────────────

  describe('cross-tenant isolation', () => {
    let tenantBId: string;
    let tenantBToken: string;

    beforeAll(async () => {
      const tenantRows = await dataSource.query(
        `INSERT INTO main.tenants (name, status)
         VALUES ($1, 'ACTIVE') RETURNING id`,
        [`E2E-KPILOCK-TENANT-B-${Date.now()}`],
      );
      tenantBId = tenantRows[0].id;

      const tenantBEmail = `e2e-kpilock-tenant-b-${Date.now()}@example.com`;
      const userRows = await dataSource.query(
        `INSERT INTO main.users (tenant_id, email, password_hash, role, status, full_name)
         VALUES ($1, $2, 'unused-hash-e2e-jwt-minted-directly', 'ADMIN', 'ACTIVE', 'E2E KpiLock Tenant B Admin')
         RETURNING id`,
        [tenantBId, tenantBEmail],
      );
      const tenantBUserId = userRows[0].id;

      const jwtService = app.get(JwtService);
      tenantBToken = jwtService.sign({
        sub: tenantBUserId,
        tenantId: tenantBId,
        email: tenantBEmail,
        role: 'ADMIN',
      });
    });

    afterAll(async () => {
      try {
        await dataSource.query(`DELETE FROM main.tenants WHERE id = $1`, [
          tenantBId,
        ]);
      } catch {
        // best-effort
      }
    });

    it("Tenant A's KPI id + Tenant B's JWT -> 404 (not a cross-tenant STALE_VERSION leak), Tenant A's row unchanged", async () => {
      const kpi = await createTestKpi('XTENANT');

      const crossTenantAttempt = await request(app.getHttpServer())
        .patch(`/master-data/kpis/${kpi.id}`)
        .set({ Authorization: `Bearer ${tenantBToken}` })
        .send({ formulaText: 'HIJACKED', version: kpi.version });

      expect(crossTenantAttempt.status).toBe(404);

      const admin = await loginAs(app, 'ADMIN');
      const afterRes = await request(app.getHttpServer())
        .get(`/master-data/kpis/${kpi.id}`)
        .set(admin.authHeader())
        .expect(200);
      expect(afterRes.body.formulaText).toBe('PLAN_VOL');
      expect(afterRes.body.version).toBe(1);
    });
  });
});
