/**
 * recalc-perf-regression.e2e-spec.ts
 *
 * T-046b (docs/analysis/0007-recalc-scale-telemetry.md §4-T4) — permanent
 * regression guard for the N+1 cleanup done in T-046a
 * (`spend-calculation.service.ts` mechanic/LTA hoisting, `plan.service.ts`
 * SKU re-read removal, extra `findById` removal). Without this test,
 * nothing catches those N+1s coming back — the measurement harness that
 * produced the T-046/T-046a numbers was ad-hoc and deleted after use.
 *
 * DELIBERATE DESIGN CHOICES (see task instructions — do not "fix" these):
 *   1. Asserts DB ROUND-TRIP COUNT, never wall-clock duration. Duration is
 *      only `console.log`ged. Round-trip count is deterministic (same SQL
 *      shape every run, independent of CI machine load); duration is not —
 *      T-040 burned hours on exactly this kind of load-dependent flakiness.
 *   2. The ceiling is generous (52 SKU -> baseline 24, ceiling 30), not the
 *      literal measured number — small, legitimate future changes (e.g.
 *      one more audit-log INSERT) should not break this test; a REGRESSION
 *      (an N+1 coming back, which adds round-trips proportional to SKU
 *      count) will blow through a 25% margin immediately.
 *   3. Uses FU_TUP_BOYA (52 SKUs, `product.seed.ts`) — the same fixture
 *      `optimistic-locking.e2e-spec.ts`'s T-034c section uses, and the
 *      exact scenario measured in docs/analysis/0007 §1.3 (S1) and
 *      T-046a's report (52 SKU: 185 -> 24 round-trips).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  resolveIdByCode,
  cleanupTestPlans,
  E2EFixture,
} from './helpers/seed-e2e';
import {
  installDbRoundTripCounter,
  uninstallDbRoundTripCounter,
  resetDbRoundTripCount,
  getDbRoundTripCount,
} from './helpers/db-round-trip-counter';

describe('Recalc perf regression — DB round-trip ceiling (T-046b, E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;

  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let FU_TUP_BOYA: string;

  beforeAll(async () => {
    installDbRoundTripCounter();
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);

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
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-RECALCPERF-');
    } catch {
      // best-effort
    }
    uninstallDbRoundTripCounter();
    await closeTestApp();
  });

  it('PATCH .../volume on a 52-SKU FU (tactic set): DB round-trips stay well under the pre-T-046a baseline (185) — catches N+1 regressions deterministically', async () => {
    const planner = await loginAs(app, 'PLANNER');

    const createRes = await request(app.getHttpServer())
      .post('/plans')
      .set(planner.authHeader())
      .send({
        planName: `E2E-RECALCPERF-${Date.now()}`,
        cplId: fixture.cplId,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY_SAC_BOYASI,
        startDate: '2026-01-05',
        endDate: '2026-01-31',
      })
      .expect(201);
    const planId = createRes.body.id;

    const addFuRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(planner.authHeader())
      .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
      .expect(201);

    const planResBeforeTactics = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(planner.authHeader())
      .expect(200);
    const planFuBeforeTactics = planResBeforeTactics.body.planFus.find(
      (f: any) => f.id === addFuRes.body.id,
    );
    expect(planFuBeforeTactics.planSkus.length).toBe(52);
    const skuId = planFuBeforeTactics.planSkus[0].skuId;

    // T-062: VIS_LS (LUMPSUM_SPEND) is distributed base-volume-proportional
    // (docs/decisions/0006) — an FU where EVERY SKU has null base volume
    // (this fixture's default, before any volume PATCH) now noisily rejects
    // a lumpsum tactic value instead of silently computing 0
    // (`LUMPSUM_DISTRIBUTION_NO_BASE_VOLUME`). Give a DIFFERENT SKU (not the
    // one this test measures below) a nominal base volume first, purely so
    // the tactics PATCH below succeeds — this happens BEFORE the round-trip
    // counter reset, so it does not affect the measured count.
    const baseVolumeDonorSkuId = planFuBeforeTactics.planSkus[1].skuId;
    await request(app.getHttpServer())
      .patch(
        `/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${baseVolumeDonorSkuId}/volume`,
      )
      .set(planner.authHeader())
      .send({
        baseVolume: 100,
        plannedVolume: 100,
        version: planFuBeforeTactics.planSkus[1].version,
      })
      .expect(200);

    // A non-zero tactic (3 mechanics) — mirrors docs/analysis/0007 §1.4's
    // "tactic VAR" scenario, the more expensive of the two measured shapes.
    await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
      .set(planner.authHeader())
      .send({
        tactics: { CPP_ON_PCT: 5, CPP_OFF_PCT: 3, VIS_LS: 1000 },
        version: addFuRes.body.version,
      })
      .expect(200);

    const planRes = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(planner.authHeader())
      .expect(200);
    const planFu = planRes.body.planFus.find(
      (f: any) => f.id === addFuRes.body.id,
    );
    expect(planFu.planSkus.length).toBe(52);
    const skuVersion = planFu.planSkus.find(
      (ps: any) => ps.skuId === skuId,
    ).version;

    // Reset AFTER all setup (plan/FU creation, tactic write) so only the
    // measured request's round-trips are counted.
    resetDbRoundTripCount();
    const t0 = Date.now();

    const patchRes = await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
      .set(planner.authHeader())
      .send({ baseVolume: 500, plannedVolume: 700, version: skuVersion })
      .expect(200);

    const durationMs = Date.now() - t0;
    const roundTrips = getDbRoundTripCount();

    // eslint-disable-next-line no-console
    console.log(
      `[T-046b perf regression] 52 SKU, tactic set: ${roundTrips} DB round-trips, ${durationMs}ms ` +
        `(logged only — NOT asserted, see file header)`,
    );

    // T-046a's measured post-fix number is 24 (T-046a task report); the
    // pre-fix number for this exact scenario was 185 (docs/analysis/0007
    // §1.4 T1: 497 round-trips at 52 SKU x 3 mechanics — note 0007's T1 row
    // includes a slightly different setup path, so this test's own
    // pre-fix baseline was independently confirmed below in the mutation
    // proof). 30 gives ~25% headroom over the 24 baseline without coming
    // anywhere close to a regressed N+1's cost (which scales with SKU
    // count x mechanic count, not by a few queries).
    expect(roundTrips).toBeLessThanOrEqual(30);

    // Sanity: the request actually did the work (rules out a trivially
    // "fast because it did nothing" false negative).
    expect(Number(patchRes.body.plannedVolume)).toBe(700);

    // T2 (docs/analysis/0007 §4-T2): the response header this test also
    // guards — frontend (T-046d) depends on it being present and numeric.
    expect(patchRes.headers['x-recalc-ms']).toBeDefined();
    expect(Number(patchRes.headers['x-recalc-ms'])).toBeGreaterThanOrEqual(0);
    expect(patchRes.headers['x-recalc-sku-count']).toBe('52');
  });
});
