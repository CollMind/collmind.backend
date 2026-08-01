/**
 * optimistic-locking.e2e-spec.ts
 *
 * T-034 — deterministic proof for the version-CAS mechanism (BRD
 * "Optimistic locking (eş zamanlı düzenleme)"). Design:
 * docs/analysis/0005-optimistic-locking-design.md §9.
 *
 * Per the T-034 task instructions, "N green runs" is NOT accepted as proof
 * on its own. Layers here:
 *   1. Stale-version replay (no timing, fully deterministic) — the
 *      PRIMARY proof.
 *   2. Cross-level false-positive check (K2's payoff — grid-cell edits on
 *      different rows/levels never spuriously 409 each other).
 *   3. A real concurrency race, asserted with an ORDER-INDEPENDENT
 *      invariant (`[200,409].sort()`) — never asserts which request wins.
 *   4. MISSING_VERSION (T-034 "Geçiş modu: KATI" — no flag, no graceful
 *      degradation; omitting `version` is itself a 409).
 *
 * Mutation-proof (temporarily removing the `AND version = :expected`
 * predicate from versioned-update.helper.ts and re-running this file to
 * confirm it goes red) was performed manually for this task — see the T-034
 * task report for the pasted red-then-green output. Not re-run on every CI
 * pass (that would defeat the point of fixing the bug).
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
  cleanupTestAgreements,
  E2EFixture,
} from './helpers/seed-e2e';

describe('Optimistic locking — version CAS (T-034, E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let FU_TUP_BOYA: string;
  let FU_WELLA_HC_500ML: string;
  let TACTIC_PROMO: string;
  let MECHANIC_DISCOUNT: string;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [
      CHANNEL_NKA,
      CATEGORY_SAC_BOYASI,
      FU_TUP_BOYA,
      FU_WELLA_HC_500ML,
      TACTIC_PROMO,
      MECHANIC_DISCOUNT,
    ] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
      resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-SAC-BOYASI'),
      resolveIdByCode(
        app,
        fixture.tenantId,
        'forecasting_units',
        'FU-TUP-BOYA',
      ),
      resolveIdByCode(
        app,
        fixture.tenantId,
        'forecasting_units',
        'FU-WELLA-HC-500ML',
      ),
      resolveIdByCode(app, fixture.tenantId, 'tactics', 'TAC-PROMO'),
      resolveIdByCode(app, fixture.tenantId, 'mechanics', 'MEC-DISCOUNT'),
    ]);
  });

  afterAll(async () => {
    try {
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-OPTLOCK-');
    } catch {
      // best-effort
    }
    try {
      await cleanupTestAgreements(app, fixture.tenantId, 'E2E-OPTLOCK-');
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
        planName: `E2E-OPTLOCK-${namePrefix}-${Date.now()}`,
        cplId: fixture.cplId,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY_SAC_BOYASI,
        startDate: '2026-01-05',
        endDate: '2026-01-31',
      })
      .expect(201);
    return res.body.id;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Layer 3 — deterministic stale-version replay (PRIMARY proof)
  // ──────────────────────────────────────────────────────────────────────

  describe('stale-version replay (deterministic, no timing)', () => {
    it('plans.version: PATCH /plans/:id — v1 succeeds, replaying v1 gets 409 STALE_VERSION, the lost write never lands', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('PLAN-HEADER');

      const getRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(getRes.body.version).toBe(1);

      const firstWrite = await request(app.getHttpServer())
        .patch(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({ planName: 'CAS-WINNER', version: 1 })
        .expect(200);
      expect(firstWrite.body.version).toBe(2);
      expect(firstWrite.body.planName).toBe('CAS-WINNER');

      // Replay the SAME (now stale) version=1 — must be rejected, not
      // silently overwrite the winner.
      const staleReplay = await request(app.getHttpServer())
        .patch(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({ planName: 'CAS-LOSER-SHOULD-NEVER-LAND', version: 1 });

      expect(staleReplay.status).toBe(409);
      expect(staleReplay.body.code).toBe('STALE_VERSION');
      expect(staleReplay.body.currentVersion).toBe(2);
      expect(staleReplay.body.current.planName).toBe('CAS-WINNER');

      // No lost update: a fresh GET still shows the winner's value.
      const finalRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(finalRes.body.planName).toBe('CAS-WINNER');
      expect(finalRes.body.version).toBe(2);
    });

    it('plan_fus.version: PATCH tactics — v1 succeeds, replaying v1 gets 409 STALE_VERSION, tactics stay at the winner value', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('FU-TACTICS');

      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);
      expect(addFuRes.body.version).toBe(1);

      const win = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10 }, version: 1 })
        .expect(200);
      expect(win.body.version).toBe(2);

      const staleReplay = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 999 }, version: 1 });

      expect(staleReplay.status).toBe(409);
      expect(staleReplay.body.code).toBe('STALE_VERSION');
      expect(staleReplay.body.currentVersion).toBe(2);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus.find(
        (f: any) => f.id === addFuRes.body.id,
      );
      expect(planFu.tactics.CPP_ON_PCT).toBe(10);
      expect(planFu.version).toBe(2);
    });

    it('plan_skus.version: PATCH volume — v1 succeeds, replaying v1 gets 409 STALE_VERSION, volume stays at the winner value', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('SKU-VOLUME');

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

      const win = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);
      expect(win.body.version).toBe(2);
      expect(Number(win.body.plannedVolume)).toBe(1000);

      const staleReplay = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 99999, version: 1 });

      expect(staleReplay.status).toBe(409);
      expect(staleReplay.body.code).toBe('STALE_VERSION');
      expect(staleReplay.body.currentVersion).toBe(2);
      expect(Number(staleReplay.body.current.plannedVolume)).toBe(1000);

      const finalPlanRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const finalFu = finalPlanRes.body.planFus.find(
        (f: any) => f.id === addFuRes.body.id,
      );
      const finalSku = finalFu.planSkus.find((s: any) => s.skuId === skuId);
      expect(Number(finalSku.plannedVolume)).toBe(1000);
      expect(finalSku.version).toBe(2);
    });

    it('agreements.version: PATCH /agreements/:id — v1 succeeds, replaying v1 gets 409 STALE_VERSION', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const createRes = await request(app.getHttpServer())
        .post('/agreements')
        .set(planner.authHeader())
        .send({
          agreementName: `E2E-OPTLOCK-AGREEMENT-${Date.now()}`,
          agreementType: 'STA',
          cplId: fixture.cplId,
          channelId: CHANNEL_NKA,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          mechanicType: 'PERCENT',
          mechanicValue: 10,
          spendType: 'OFF_INVOICE',
          startDate: '2026-01-05',
          endDate: '2026-01-20',
          capTotalAmount: 1000,
          justification: 'E2E T-034 optimistic-locking fixture',
        })
        .expect(201);
      const agreementId = createRes.body.id;
      expect(createRes.body.version).toBe(1);

      const win = await request(app.getHttpServer())
        .patch(`/agreements/${agreementId}`)
        .set(planner.authHeader())
        .send({ agreementName: 'CAS-WINNER-AGREEMENT', version: 1 })
        .expect(200);
      expect(win.body.version).toBe(2);

      const staleReplay = await request(app.getHttpServer())
        .patch(`/agreements/${agreementId}`)
        .set(planner.authHeader())
        .send({ agreementName: 'CAS-LOSER-SHOULD-NEVER-LAND', version: 1 });

      expect(staleReplay.status).toBe(409);
      expect(staleReplay.body.code).toBe('STALE_VERSION');
      expect(staleReplay.body.currentVersion).toBe(2);

      const finalRes = await request(app.getHttpServer())
        .get(`/agreements/${agreementId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(finalRes.body.agreementName).toBe('CAS-WINNER-AGREEMENT');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Layer 3b — cross-level / cross-row: no spurious 409s (K2's payoff)
  // ──────────────────────────────────────────────────────────────────────

  describe('cross-row / cross-level — no false-positive 409s', () => {
    it('two different FUs on the same plan can each be tactic-edited with their own correct version — both 200', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('CROSS-FU');

      const fu1 = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);

      const fu2 = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 2 })
        .expect(201);

      const r1 = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 5 }, version: fu1.body.version });
      const r2 = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 5 }, version: fu2.body.version });

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    });

    it('a recalc (triggered by another write) does not bump plan_skus.version — a subsequent correctly-versioned SKU edit still succeeds', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('RECALC-NO-BUMP');

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
      const skuVersionAfterAddFu = planFu.planSkus[0].version;

      // Recalc runs (triggered internally by every mutation, and explicitly
      // here) — must NOT touch plan_skus.version (T-034: derived writes are
      // unversioned).
      await request(app.getHttpServer())
        .post(`/plans/${planId}/recalculate`)
        .set(planner.authHeader())
        .send({})
        .expect(200);

      const afterRecalc = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const fuAfter = afterRecalc.body.planFus.find(
        (f: any) => f.id === addFuRes.body.id,
      );
      const skuAfter = fuAfter.planSkus.find((s: any) => s.skuId === skuId);
      expect(skuAfter.version).toBe(skuVersionAfterAddFu);

      // The version the client already held (from addFu's response) is
      // still valid — CAS succeeds.
      await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({
          baseVolume: 500,
          plannedVolume: 600,
          version: skuVersionAfterAddFu,
        })
        .expect(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-041 — addFu/updateFuTactic/updateSkuVolume/removeFu now report the
  // CURRENT plan version in their response (body `planVersion`, or for
  // removeFu's 204-No-Content the `X-Plan-Version` header) instead of
  // forcing the client to predict it locally (the exact `version + 1`
  // guess PlanningGridEnhanced.tsx:914 made, which this task removes the
  // need for).
  // ──────────────────────────────────────────────────────────────────────

  describe('T-041 — mutation responses report the current planVersion (no more client-side guessing)', () => {
    it('two consecutive addFu calls chained purely off the response planVersion — no 409', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('T041-CHAIN-ADDFU');

      const fu1 = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);
      // Post-CAS-bump value (1 -> 2), not the pre-bump `1` the client sent.
      expect(fu1.body.planVersion).toBe(2);

      // The client never re-GETs the plan or predicts `version + 1` here —
      // it takes fu1's own response at face value.
      const fu2 = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: fu1.body.planVersion })
        .expect(201);
      expect(fu2.body.planVersion).toBe(3);

      // Confirm against the server's own record, independently of the
      // chained values above.
      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(planRes.body.version).toBe(3);
    });

    it('addFu response is additive — existing PlanFu fields (id, version, tactics) are still present alongside the new planVersion', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('T041-ADDITIVE');

      const fu1 = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);

      expect(fu1.body.id).toBeDefined();
      expect(fu1.body.fuId).toBe(FU_TUP_BOYA);
      expect(fu1.body.version).toBe(1); // PlanFu's OWN version — unrelated to planVersion
      expect(fu1.body.planVersion).toBe(2); // plans.version, additive field
    });

    it('updateFuTactic and updateSkuVolume also report planVersion (unchanged by these child-row-only mutations)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('T041-CHILD-MUTATIONS');

      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);
      expect(addFuRes.body.planVersion).toBe(2);

      const tacticRes = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 5 }, version: addFuRes.body.version })
        .expect(200);
      // plan_fus.version bumped, plans.version untouched by this mutation.
      expect(tacticRes.body.planVersion).toBe(2);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus.find(
        (f: any) => f.id === addFuRes.body.id,
      );
      const skuId = planFu.planSkus[0].skuId;
      const skuVersion = planFu.planSkus[0].version;

      const volumeRes = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 500, plannedVolume: 600, version: skuVersion })
        .expect(200);
      expect(volumeRes.body.planVersion).toBe(2);
    });

    it('removeFu (204 No Content) surfaces the post-CAS-bump planVersion via the X-Plan-Version response header', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('T041-REMOVEFU-HEADER');

      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);
      expect(addFuRes.body.planVersion).toBe(2);

      const delRes = await request(app.getHttpServer())
        .delete(`/plans/${planId}/fus/${FU_TUP_BOYA}`)
        .set(planner.authHeader())
        .send({ planVersion: addFuRes.body.planVersion })
        .expect(204);

      expect(delRes.headers['x-plan-version']).toBe('3');

      // The header value must be usable for the NEXT structural write,
      // with no local prediction — proves it isn't a stale echo.
      await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({
          fuId: FU_TUP_BOYA,
          planVersion: Number(delRes.headers['x-plan-version']),
        })
        .expect(201);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Layer 4 — real concurrency race, order-independent invariant
  // ──────────────────────────────────────────────────────────────────────

  describe('real concurrent race — order-independent invariant', () => {
    it('two simultaneous PATCH volume requests with the same version: exactly one 200 and one 409 (never [200,200] lost-update, never [409,409] livelock)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      for (let i = 0; i < 5; i++) {
        const planId = await createDraftPlan(`RACE-${i}`);
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
        const skuVersion = planFu.planSkus[0].version;

        const send = (plannedVolume: number) =>
          request(app.getHttpServer())
            .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
            .set(planner.authHeader())
            .send({ baseVolume: 500, plannedVolume, version: skuVersion });

        const [a, b] = await Promise.all([send(700), send(800)]);

        // Order-independent: NEVER assert which one wins.
        const statuses = [a.status, b.status].sort();
        expect(statuses).toEqual([200, 409]);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Layer for T-034 "Geçiş modu: KATI" — missing version is itself a 409
  // ──────────────────────────────────────────────────────────────────────

  describe('strict mode — missing `version` is rejected (no flag, no graceful fallback)', () => {
    it('PATCH /plans/:id without `version` -> 409 MISSING_VERSION (not 200, not a ValidationPipe 400)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('MISSING-VERSION-HEADER');

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({ planName: 'no-version-sent' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MISSING_VERSION');

      const getRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(getRes.body.planName).not.toBe('no-version-sent');
    });

    it('PATCH .../skus/:skuId/volume without `version` -> 409 MISSING_VERSION', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('MISSING-VERSION-SKU');
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

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MISSING_VERSION');
    });

    it('POST /plans/:id/fus without `planVersion` -> 409 MISSING_VERSION', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('MISSING-VERSION-ADDFU');

      const res = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MISSING_VERSION');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Code-review follow-up #2 (2026-07-29): DELETE /plans/:id/fus/:fuId
  // (removeFu) had ZERO test coverage — DTO/planVersion existed, no proof
  // it actually works over HTTP with a DELETE + JSON body (a known
  // drop-prone combination in some client/proxy stacks).
  // ──────────────────────────────────────────────────────────────────────

  describe('removeFu — DELETE /plans/:id/fus/:fuId (previously untested)', () => {
    it('correct planVersion -> 204, the FU is actually gone', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('REMOVEFU-HAPPY');

      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);
      expect(addFuRes.body.version).toBe(1);

      // addFu's own CAS-gate already bumped plans.version 1 -> 2 (structural
      // change, see docs/analysis/0005 §3) — the client must use THAT
      // version for the next structural write, not the value it sent in.
      const afterAddFu = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(afterAddFu.body.version).toBe(2);

      const delRes = await request(app.getHttpServer())
        .delete(`/plans/${planId}/fus/${FU_TUP_BOYA}`)
        .set(planner.authHeader())
        .send({ planVersion: 2 });

      expect(delRes.status).toBe(204);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(
        planRes.body.planFus.find((f: any) => f.id === addFuRes.body.id),
      ).toBeUndefined();
      // removeFu's own CAS-gate bumps plans.version again (2 -> 3).
      expect(planRes.body.version).toBeGreaterThan(2);
    });

    it('missing `planVersion` -> 409 MISSING_VERSION, the FU is NOT removed (proves DELETE+body actually reaches the server)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('REMOVEFU-MISSING-VERSION');

      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);

      const delRes = await request(app.getHttpServer())
        .delete(`/plans/${planId}/fus/${FU_TUP_BOYA}`)
        .set(planner.authHeader())
        .send({});

      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('MISSING_VERSION');

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(
        planRes.body.planFus.find((f: any) => f.id === addFuRes.body.id),
      ).toBeDefined();
    });

    it('stale planVersion -> 409 STALE_VERSION, the FU is NOT removed', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('REMOVEFU-STALE');

      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);

      // addFu's own CAS-gate already bumped plans.version 1 -> 2. Bump it
      // again out from under the pending delete via an unrelated header
      // edit (2 -> 3), so a client still holding v1 (or even v2) is stale.
      await request(app.getHttpServer())
        .patch(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({ planName: 'bump-version-before-delete', version: 2 })
        .expect(200);

      const delRes = await request(app.getHttpServer())
        .delete(`/plans/${planId}/fus/${FU_TUP_BOYA}`)
        .set(planner.authHeader())
        .send({ planVersion: 1 }); // stale — plan is now v3

      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('STALE_VERSION');
      expect(delRes.body.currentVersion).toBe(3);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      expect(
        planRes.body.planFus.find((f: any) => f.id === addFuRes.body.id),
      ).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Code-review follow-up #1 (2026-07-29): delete() was found entirely
  // exempt from optimistic locking — the most destructive mutation path
  // (a stale-view delete silently discards a concurrent editor's FUs/SKUs
  // or tactic/mechanic edits). Closed with the same CAS mechanism as every
  // other user-input write.
  // ──────────────────────────────────────────────────────────────────────

  describe('delete() — DELETE /plans/:id and DELETE /agreements/:id (destructive, previously unguarded)', () => {
    it('DELETE /plans/:id: correct version -> 204, plan actually gone; stale version -> 409 STALE_VERSION, plan NOT deleted', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('DELETE-PLAN');

      // Bump plans.version out from under the delete (v1 -> v2).
      await request(app.getHttpServer())
        .patch(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({ planName: 'bump-before-delete', version: 1 })
        .expect(200);

      // Stale replay: client still holds v1.
      const staleDelete = await request(app.getHttpServer())
        .delete(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({ version: 1 });
      expect(staleDelete.status).toBe(409);
      expect(staleDelete.body.code).toBe('STALE_VERSION');

      const stillThere = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader());
      expect(stillThere.status).toBe(200);

      // Correct version -> succeeds.
      const win = await request(app.getHttpServer())
        .delete(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({ version: 2 });
      expect(win.status).toBe(204);

      const gone = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader());
      expect(gone.status).toBe(404);
    });

    it('DELETE /plans/:id: missing `version` -> 409 MISSING_VERSION, plan NOT deleted', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('DELETE-PLAN-MISSING-VERSION');

      const res = await request(app.getHttpServer())
        .delete(`/plans/${planId}`)
        .set(planner.authHeader())
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MISSING_VERSION');

      const stillThere = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader());
      expect(stillThere.status).toBe(200);
    });

    it('DELETE /agreements/:id: correct version -> 204, agreement actually gone; stale version -> 409 STALE_VERSION, agreement NOT deleted', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const createRes = await request(app.getHttpServer())
        .post('/agreements')
        .set(planner.authHeader())
        .send({
          agreementName: `E2E-OPTLOCK-DELETE-AGR-${Date.now()}`,
          agreementType: 'STA',
          cplId: fixture.cplId,
          channelId: CHANNEL_NKA,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          mechanicType: 'PERCENT',
          mechanicValue: 10,
          spendType: 'OFF_INVOICE',
          startDate: '2026-01-05',
          endDate: '2026-01-20',
          capTotalAmount: 1000,
          justification: 'E2E T-034 delete-CAS fixture',
        })
        .expect(201);
      const agreementId = createRes.body.id;
      expect(createRes.body.version).toBe(1);

      await request(app.getHttpServer())
        .patch(`/agreements/${agreementId}`)
        .set(planner.authHeader())
        .send({ agreementName: 'bump-before-delete', version: 1 })
        .expect(200);

      const staleDelete = await request(app.getHttpServer())
        .delete(`/agreements/${agreementId}`)
        .set(planner.authHeader())
        .send({ version: 1 });
      expect(staleDelete.status).toBe(409);
      expect(staleDelete.body.code).toBe('STALE_VERSION');

      const win = await request(app.getHttpServer())
        .delete(`/agreements/${agreementId}`)
        .set(planner.authHeader())
        .send({ version: 2 });
      expect(win.status).toBe(204);

      const gone = await request(app.getHttpServer())
        .get(`/agreements/${agreementId}`)
        .set(planner.authHeader());
      expect(gone.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Code-review follow-up #3 (2026-07-29) — Layer 6: cross-tenant
  // isolation. The tenantId-predicate fix (§1.5) was only proven at the
  // repository-mock unit level before; this proves it end-to-end over real
  // HTTP with a genuinely different tenant + user (created here — the repo
  // has no second-tenant e2e fixture, see role-journey.e2e-spec.ts's same
  // note). The JWT is minted directly via JwtService (bypassing
  // /auth/login's password check, which we have no real credential for) —
  // JwtStrategy#validate still does a real DB lookup keyed on
  // (id, tenantId), so this is not a bypass of the auth guard itself, only
  // of the login *form*.
  // ──────────────────────────────────────────────────────────────────────

  describe('cross-tenant isolation (Layer 6)', () => {
    let tenantBId: string;
    let tenantBToken: string;

    beforeAll(async () => {
      const tenantRows = await dataSource.query(
        `INSERT INTO main.tenants (name, status)
         VALUES ($1, 'ACTIVE') RETURNING id`,
        [`E2E-OPTLOCK-TENANT-B-${Date.now()}`],
      );
      tenantBId = tenantRows[0].id;

      const tenantBEmail = `e2e-optlock-tenant-b-${Date.now()}@example.com`;
      const userRows = await dataSource.query(
        `INSERT INTO main.users (tenant_id, email, password_hash, role, status, full_name)
         VALUES ($1, $2, 'unused-hash-e2e-jwt-minted-directly', 'PLANNER', 'ACTIVE', 'E2E Optlock Tenant B Planner')
         RETURNING id`,
        [tenantBId, tenantBEmail],
      );
      const tenantBUserId = userRows[0].id;

      const jwtService = app.get(JwtService);
      tenantBToken = jwtService.sign({
        sub: tenantBUserId,
        tenantId: tenantBId,
        email: tenantBEmail,
        role: 'PLANNER',
      });
    });

    afterAll(async () => {
      try {
        // FK ON DELETE CASCADE on main.users(tenant_id) removes the user too.
        await dataSource.query(`DELETE FROM main.tenants WHERE id = $1`, [
          tenantBId,
        ]);
      } catch {
        // best-effort
      }
    });

    it("Tenant A's planSkuId + Tenant B's JWT -> 404 (not 200, not a cross-tenant STALE_VERSION leak), Tenant A's row unchanged", async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('CROSS-TENANT');

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
      const skuVersion = planFu.planSkus[0].version;

      const crossTenantAttempt = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${skuId}/volume`)
        .set({ Authorization: `Bearer ${tenantBToken}` })
        .send({ baseVolume: 1, plannedVolume: 1, version: skuVersion });

      expect(crossTenantAttempt.status).toBe(404);

      // Tenant A's row is untouched — no lost update, no data sizzled into
      // Tenant B's request despite matching the correct version number.
      const afterRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const afterFu = afterRes.body.planFus.find(
        (f: any) => f.id === addFuRes.body.id,
      );
      const afterSku = afterFu.planSkus.find((s: any) => s.skuId === skuId);
      expect(afterSku.version).toBe(skuVersion);
    });

    it("Tenant A's planId + Tenant B's JWT on DELETE /plans/:id -> 404, Tenant A's plan NOT deleted", async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('CROSS-TENANT-DELETE');

      const crossTenantDelete = await request(app.getHttpServer())
        .delete(`/plans/${planId}`)
        .set({ Authorization: `Bearer ${tenantBToken}` })
        .send({ version: 1 });

      expect(crossTenantDelete.status).toBe(404);

      const stillThere = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader());
      expect(stillThere.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-034b — state transitions: transaction + FOR UPDATE + status-CAS
  // (docs/analysis/0005 §4). submit/approve/reject/returnToDraft are NOT
  // version-CAS'd (K5) — the barrier is the transition's own precondition
  // (status), enforced under a row lock. submit() is the sole documented
  // exception and DOES also validate plans.version.
  // ──────────────────────────────────────────────────────────────────────

  describe('T-034b — state transitions (transaction + FOR UPDATE + status-CAS)', () => {
    /** DRAFT plan + FU_WELLA_HC_500ML (COGS-populated fixture) -> totalSpend > 0, ready to submit. */
    async function createReadyToSubmitPlan(
      namePrefix: string,
    ): Promise<{ planId: string; version: number }> {
      const planner = await loginAs(app, 'PLANNER');
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-OPTLOCK-${namePrefix}-${Date.now()}`,
          cplId: fixture.cplId,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const planId = createRes.body.id;

      await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus[0];
      const skuId = planFu.planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_WELLA_HC_500ML}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10, VIS_LS: 2000 }, version: 1 })
        .expect(200);

      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/recalculate`)
        .set(planner.authHeader())
        .send({})
        .expect(200);
      expect(Number(recalcRes.body.totalSpend)).toBeGreaterThan(0);

      return { planId, version: recalcRes.body.version };
    }

    describe('submit() — the K5 exception: version IS validated', () => {
      it('stale plans.version -> 409 STALE_VERSION (deterministic, no timing); correct version -> 200', async () => {
        const planner = await loginAs(app, 'PLANNER');
        const { planId, version } =
          await createReadyToSubmitPlan('T034B-SUBMIT-STALE');

        // Bump plans.version without changing status (plan-header edit).
        // NOTE: must keep the `E2E-` prefix — cleanupTestPlans (seed-e2e.ts)
        // matches on `plan_name LIKE 'E2E-%'` (or plan_code, unaffected by
        // rename); renaming away from it would leak this plan's RESERVE
        // budget_transaction forever (same leak class as T-028d/T-036 —
        // code-review caught this: reserved 75000->175000 over repeated
        // runs before this fix).
        await request(app.getHttpServer())
          .patch(`/plans/${planId}`)
          .set(planner.authHeader())
          .send({ planName: 'E2E-OPTLOCK-renamed-before-submit', version })
          .expect(200);

        // Replaying the OLD version -> 409 STALE_VERSION, plan stays DRAFT.
        const staleSubmit = await request(app.getHttpServer())
          .post(`/plans/${planId}/submit`)
          .set(planner.authHeader())
          .send({ version });
        expect(staleSubmit.status).toBe(409);
        expect(staleSubmit.body.code).toBe('STALE_VERSION');

        const afterStale = await request(app.getHttpServer())
          .get(`/plans/${planId}`)
          .set(planner.authHeader())
          .expect(200);
        expect(afterStale.body.status).toBe('DRAFT');

        // Correct (current) version -> 200 PENDING_APPROVAL.
        const okSubmit = await request(app.getHttpServer())
          .post(`/plans/${planId}/submit`)
          .set(planner.authHeader())
          .send({ version: afterStale.body.version })
          .expect(200);
        expect(okSubmit.body.status).toBe('PENDING_APPROVAL');
      });

      it('missing `version` -> 409 MISSING_VERSION, plan stays DRAFT', async () => {
        const planner = await loginAs(app, 'PLANNER');
        const { planId } = await createReadyToSubmitPlan(
          'T034B-SUBMIT-MISSING-VERSION',
        );

        const res = await request(app.getHttpServer())
          .post(`/plans/${planId}/submit`)
          .set(planner.authHeader())
          .send({});
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('MISSING_VERSION');

        const after = await request(app.getHttpServer())
          .get(`/plans/${planId}`)
          .set(planner.authHeader())
          .expect(200);
        expect(after.body.status).toBe('DRAFT');
      });
    });

    describe('approve() — stale-status replay (deterministic, no timing)', () => {
      it('sequential double-approve: first 200 APPROVED, second 400 (status already APPROVED) — no double COMMIT', async () => {
        const planner = await loginAs(app, 'PLANNER');
        const manager = await loginAs(app, 'MANAGER');
        const { planId, version } = await createReadyToSubmitPlan(
          'T034B-APPROVE-STALE',
        );

        await request(app.getHttpServer())
          .post(`/plans/${planId}/submit`)
          .set(planner.authHeader())
          .send({ version })
          .expect(200);

        const first = await request(app.getHttpServer())
          .post(`/plans/${planId}/approve`)
          .set(manager.authHeader())
          .send({ comments: 'first' });
        expect(first.status).toBe(200);
        expect(first.body.status).toBe('APPROVED');

        const second = await request(app.getHttpServer())
          .post(`/plans/${planId}/approve`)
          .set(manager.authHeader())
          .send({ comments: 'second' });
        expect(second.status).toBe(400);

        const commitTx = await dataSource.query(
          `SELECT tx_type FROM main.budget_transactions
           WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'COMMIT'`,
          [planId],
        );
        expect(commitTx.length).toBe(1); // exactly one COMMIT — no double-spend
      });
    });

    describe('real concurrent race — order-independent invariant (Layer 4, mirrors the SKU-volume race above)', () => {
      it('two simultaneous approve() calls on the same PENDING plan: exactly one 200 and one 400/409, exactly one COMMIT ever posted', async () => {
        const planner = await loginAs(app, 'PLANNER');
        const manager = await loginAs(app, 'MANAGER');

        for (let i = 0; i < 3; i++) {
          const { planId, version } = await createReadyToSubmitPlan(
            `T034B-APPROVE-RACE-${i}`,
          );

          await request(app.getHttpServer())
            .post(`/plans/${planId}/submit`)
            .set(planner.authHeader())
            .send({ version })
            .expect(200);

          const send = () =>
            request(app.getHttpServer())
              .post(`/plans/${planId}/approve`)
              .set(manager.authHeader())
              .send({ comments: 'race' });

          const [a, b] = await Promise.all([send(), send()]);

          // Order-independent: NEVER assert which one wins. A 400 (status
          // guard, the loser blocked on the FOR UPDATE lock and then read
          // an already-APPROVED row) is the expected loser outcome here —
          // not 409, since approve() has no version-CAS (K5); the
          // status-CAS predicate is the barrier.
          const statuses = [a.status, b.status].sort();
          expect(statuses).toEqual([200, 400]);

          const commitTx = await dataSource.query(
            `SELECT tx_type FROM main.budget_transactions
             WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'COMMIT'`,
            [planId],
          );
          // Mutation-proof anchor: if the FOR UPDATE lock or the
          // status-CAS predicate were ever removed, this would
          // intermittently observe 2 COMMIT rows (double-spend) instead of
          // exactly 1 — the exact bug class T-034b closes.
          expect(commitTx.length).toBe(1);
        }
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-034c — recalc serialization (docs/analysis/0005 §3): lost
  // recalculation. `recalculatePlanWithKpiEngine` now runs inside one
  // `QueryRunner` transaction that takes `pg_advisory_xact_lock(planId)` as
  // the first thing it does, serializing concurrent recalcs of the SAME
  // plan. FU_TUP_BOYA (52 SKUs, see product.seed.ts) is used deliberately —
  // a wider per-recalc window makes an unserialized interleave more likely
  // to manifest, and gives a meaningful `<500ms` performance data point for
  // a realistically-sized FU.
  // ──────────────────────────────────────────────────────────────────────

  describe('T-034c — recalc serialization (transaction + pg_advisory_xact_lock)', () => {
    function numOrNull(v: unknown): number | null {
      return v === null || v === undefined ? null : Number(v);
    }

    async function createPlanWithFu(namePrefix: string): Promise<{
      planId: string;
      skus: Array<{ skuId: string; version: number }>;
    }> {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan(namePrefix);
      const addFuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);
      // A non-zero tactic so totalSpend actually moves with volume (an FU
      // with no tactics set legitimately produces 0 promo spend regardless
      // of volume — see the K2 cross-row test above for the same tactic).
      await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10 }, version: addFuRes.body.version })
        .expect(200);
      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus.find(
        (f: any) => f.id === addFuRes.body.id,
      );
      const skus = planFu.planSkus.map((s: any) => ({
        skuId: s.skuId,
        version: s.version,
      }));
      return { planId, skus };
    }

    // ── Deterministic invariant (PRIMARY proof) ───────────────────────
    //
    // recalculatePlanWithKpiEngine is idempotent — a pure function of the
    // currently-persisted volumes/tactics/master data (docs/analysis/0005
    // §3). So regardless of HOW two concurrent recalcs (triggered by two
    // concurrent SKU-volume edits on two DIFFERENT rows) interleave, the
    // plan-level totals persisted immediately after the race MUST equal
    // the totals a subsequent, fully-uncontested recalc produces. If a
    // recalc's write ever "lost" the other update (the exact T-034c bug),
    // the two would differ — this assertion never depends on which
    // request won the race, only on whether the final persisted state is
    // complete.
    it('two concurrent SKU-volume edits (different rows) -> the totals persisted right after the race equal a fresh, uncontested recalc (no lost recalculation)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      for (let i = 0; i < 3; i++) {
        const { planId, skus } = await createPlanWithFu(`RECALC-RACE-${i}`);
        const [skuA, skuB] = skus;

        const patchVolume = (
          sku: { skuId: string; version: number },
          plannedVolume: number,
        ) =>
          request(app.getHttpServer())
            .patch(
              `/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${sku.skuId}/volume`,
            )
            .set(planner.authHeader())
            .send({ baseVolume: 500, plannedVolume, version: sku.version });

        const [ra, rb] = await Promise.all([
          patchVolume(skuA, 1000),
          patchVolume(skuB, 700),
        ]);
        expect(ra.status).toBe(200);
        expect(rb.status).toBe(200);

        const afterRace = await request(app.getHttpServer())
          .get(`/plans/${planId}`)
          .set(planner.authHeader())
          .expect(200);

        // Fresh, uncontested recalc.
        await request(app.getHttpServer())
          .post(`/plans/${planId}/recalculate`)
          .set(planner.authHeader())
          .send({})
          .expect(200);
        const fresh = await request(app.getHttpServer())
          .get(`/plans/${planId}`)
          .set(planner.authHeader())
          .expect(200);

        expect(numOrNull(afterRace.body.totalSpend)).toEqual(
          numOrNull(fresh.body.totalSpend),
        );
        expect(numOrNull(afterRace.body.totalGp)).toEqual(
          numOrNull(fresh.body.totalGp),
        );
        expect(numOrNull(afterRace.body.overallRoi)).toEqual(
          numOrNull(fresh.body.overallRoi),
        );
        // Both edits must actually be reflected (sanity: rules out a
        // trivially-passing "both totals are 0/null" false negative).
        expect(Number(fresh.body.totalPlannedVolume)).toBeGreaterThan(0);
        expect(Number(fresh.body.totalSpend)).toBeGreaterThan(0);
      }
    });

    // ── Real concurrency, order-independent invariant (mirrors Layer 4) ──
    it('N simultaneous /plans/:id/recalculate calls on the SAME plan all succeed and leave it consistent (idempotent, serialized — never a torn write)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId } = await createPlanWithFu('RECALC-CONCURRENT-SAME');

      const recalc = () =>
        request(app.getHttpServer())
          .post(`/plans/${planId}/recalculate`)
          .set(planner.authHeader())
          .send({});

      const results = await Promise.all([recalc(), recalc(), recalc()]);
      for (const r of results) {
        expect(r.status).toBe(200);
      }

      const final = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      // No CAS bump: T-034 K4 — recalc is unversioned, so 3 concurrent
      // recalcs never 409 each other and never bump plans.version.
      expect(final.body.version).toBe(2); // 1 (create) -> 2 (addFu bump)
    });

    // ── Performance (BRD "<500ms" recalc budget) ──────────────────────
    //
    // Not a hard pass/fail gate here (a 52-SKU FU's full SpendCalc+KPI
    // engine loop is an order of magnitude more work than the single-SKU
    // formula evaluation the BRD figure describes, and CI machine speed
    // varies) — logged for the task report's performance section instead.
    // The generous upper bound below only catches a gross regression
    // (e.g. the lock never being released, serializing what should be
    // parallel).
    it('records recalc latency: single vs. 2-concurrent-on-different-plans vs. 2-concurrent-on-the-same-plan', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const { planId: soloPlan } = await createPlanWithFu('RECALC-PERF-SOLO');
      const t0 = Date.now();
      await request(app.getHttpServer())
        .post(`/plans/${soloPlan}/recalculate`)
        .set(planner.authHeader())
        .send({})
        .expect(200);
      const soloMs = Date.now() - t0;

      const { planId: planX } = await createPlanWithFu('RECALC-PERF-DIFF-X');
      const { planId: planY } = await createPlanWithFu('RECALC-PERF-DIFF-Y');
      const t1 = Date.now();
      await Promise.all([
        request(app.getHttpServer())
          .post(`/plans/${planX}/recalculate`)
          .set(planner.authHeader())
          .send({}),
        request(app.getHttpServer())
          .post(`/plans/${planY}/recalculate`)
          .set(planner.authHeader())
          .send({}),
      ]);
      const differentPlansConcurrentMs = Date.now() - t1;

      const { planId: planZ } = await createPlanWithFu('RECALC-PERF-SAME');
      const t2 = Date.now();
      await Promise.all([
        request(app.getHttpServer())
          .post(`/plans/${planZ}/recalculate`)
          .set(planner.authHeader())
          .send({}),
        request(app.getHttpServer())
          .post(`/plans/${planZ}/recalculate`)
          .set(planner.authHeader())
          .send({}),
      ]);
      const samePlanConcurrentMs = Date.now() - t2;

      // eslint-disable-next-line no-console
      console.log(
        `[T-034c perf] solo recalc (52 SKUs): ${soloMs}ms | ` +
          `2 concurrent recalcs on DIFFERENT plans: ${differentPlansConcurrentMs}ms | ` +
          `2 concurrent recalcs on the SAME plan (advisory-lock-serialized): ${samePlanConcurrentMs}ms`,
      );

      // Sanity ceiling only — not the BRD <500ms figure itself (see comment
      // above). 52 SKUs x (SpendCalc + KPI engine) sequential DB round
      // trips is inherently well above a single-formula-evaluation budget.
      expect(soloMs).toBeLessThan(15000);
      expect(differentPlansConcurrentMs).toBeLessThan(15000);
      expect(samePlanConcurrentMs).toBeLessThan(20000);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // T-043 — plan.controller.ts / agreement.controller.ts route params now
  // go through `ParseUUIDPipe` (same pattern already used by
  // settlement.controller.ts / reversal.controller.ts, see
  // reversal.e2e-spec.ts's "Geçersiz UUID formatı" test for the reference
  // shape). A malformed UUID used to reach Postgres as-is
  // (`invalid input syntax for type uuid`, uncaught -> 500); a
  // well-formed-but-nonexistent UUID must keep 404 (scope/not-found is a
  // service-level decision `ParseUUIDPipe` never touches).
  // ──────────────────────────────────────────────────────────────────────

  describe('T-043 — malformed UUID route params -> 400, not 500 (well-formed-but-missing stays 404)', () => {
    const NON_EXISTENT_UUID = '00000000-0000-0000-0000-000000000099';

    it('GET /plans/:id — malformed id -> 400', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .get('/plans/not-a-uuid')
        .set(planner.authHeader());
      expect(res.status).toBe(400);
    });

    it('GET /plans/:id — well-formed but nonexistent id -> 404 (behavior preserved)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .get(`/plans/${NON_EXISTENT_UUID}`)
        .set(planner.authHeader());
      expect(res.status).toBe(404);
    });

    it('POST /plans/:id/fus — malformed planId -> 400 (not a body-validation 400, a param-pipe 400 — reached before the handler runs)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .post('/plans/not-a-uuid/fus')
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 });
      expect(res.status).toBe(400);
    });

    it('PATCH /plans/:id/fus/:fuId/tactics — malformed fuId -> 400', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('T043-BAD-FUID');
      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/not-a-uuid/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 5 }, version: 1 });
      expect(res.status).toBe(400);
    });

    it('PATCH /plans/:id/fus/:fuId/skus/:skuId/volume — malformed skuId -> 400', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('T043-BAD-SKUID');
      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/not-a-uuid/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 500, plannedVolume: 600, version: 1 });
      expect(res.status).toBe(400);
    });

    it('DELETE /plans/:id/fus/:fuId — malformed fuId -> 400, the plan is unaffected', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planId = await createDraftPlan('T043-BAD-DELETE-FUID');
      const res = await request(app.getHttpServer())
        .delete(`/plans/${planId}/fus/not-a-uuid`)
        .set(planner.authHeader())
        .send({ planVersion: 1 });
      expect(res.status).toBe(400);
    });

    it('GET /agreements/:id — malformed id -> 400; well-formed-but-nonexistent -> 404', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const malformed = await request(app.getHttpServer())
        .get('/agreements/not-a-uuid')
        .set(planner.authHeader());
      expect(malformed.status).toBe(400);

      const missing = await request(app.getHttpServer())
        .get(`/agreements/${NON_EXISTENT_UUID}`)
        .set(planner.authHeader());
      expect(missing.status).toBe(404);
    });

    it('DELETE /agreements/:id — malformed id -> 400, not the 500 Postgres would otherwise throw', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .delete('/agreements/not-a-uuid')
        .set(planner.authHeader())
        .send({ version: 1 });
      expect(res.status).toBe(400);
    });
  });
});
