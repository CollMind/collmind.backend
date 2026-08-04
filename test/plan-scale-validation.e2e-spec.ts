/**
 * plan-scale-validation.e2e-spec.ts
 *
 * QA coverage for C3 — write-side scale validation on
 * `PATCH /plans/:id/fus/:fuId/tactics` (plan.service.ts#updateFuTactic,
 * step 3: `checkEnteredScale`, src/common/numeric/mechanic-input.ts).
 *
 * Proves the mechanism on the LIVE route, not just at the unit level
 * (src/common/numeric/mechanic-input.spec.ts covers the pure function):
 *   1. A PERCENT mechanic (CPP_ON_PCT) entered out of the 0-100 bound ->
 *      400 INVALID_SCALE.
 *   2. An AMOUNT mechanic (VIS_LS, lumpsum) entered with a sub-kuruş
 *      fraction (100.005, 3 decimals) -> 400 INVALID_SCALE.
 *   3. An AMOUNT_PER_UNIT mechanic (PRICE_SUP) entered at 0.0125 TRY/unit
 *      (4 decimals) -> 200. This is the deliberate exemption
 *      (mechanic-input.ts's ⚠️ block) proven on the real write path, not
 *      just against the pure function.
 *   4. Every 400 above leaves `plan_fus.tactics` and `plan_fus.version`
 *      exactly as they were before the request — no partial write.
 *   5. F2/C3 second review pass: an unknown mechanic code in `dto.tactics`
 *      (step 3, BEFORE `checkEnteredScale`) is rejected with
 *      UNKNOWN_MECHANIC_CODE, at the write — not silently accepted and
 *      re-discovered by recalc after the bad key already landed on disk
 *      (`unknownMechanicCodeError`, spend-calculation.service.ts, the
 *      single producer for both call sites — plan.service.ts#updateFuTactic
 *      step 3 and `buildMechanicValues`).
 *   6. The 409-before-400 sequencing guarantee (C3 step 2's comment: "a
 *      stale request must not have its body scale-validated") gets its own
 *      named case here, not just an incidental fixture value in
 *      optimistic-locking.e2e-spec.ts.
 *
 * Mechanic codes/types verified live against the seed DB (not assumed):
 *   docker exec collmind-tpm-postgres psql -U postgres -d collmind_tpm -c \
 *     "SELECT code, mechanic_type, is_active FROM main.mechanics m
 *      JOIN main.tenants t ON t.id = m.tenant_id
 *      WHERE t.name = 'Wella Turkey' ORDER BY mechanic_type, code;"
 *   -> CPP_ON_PCT/CPP_OFF_PCT/MEC-DISCOUNT = PERCENT (active),
 *      DISPLAY_FEE/VIS_LS = AMOUNT (active), PRICE_SUP = AMOUNT_PER_UNIT
 *      (active). All 6 seeded codes are active for this tenant — so
 *      `NO_SUCH_MECHANIC` below is unknown, not merely inactive.
 *
 * Does NOT touch optimistic-locking.e2e-spec.ts — that file's stale-version
 * fixtures (including its own `{ CPP_ON_PCT: 999 }` + `version: 1` -> 409
 * case) are the sequencing control for T-034/C3 step 2 and are left as-is.
 * §2 below only ADDS a same-shaped case here, under a name that says what
 * it proves.
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

describe('C3 — write-side scale validation, live route (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;

  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let FU_TUP_BOYA: string;

  beforeAll(async () => {
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
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-SCALE-');
    } catch {
      // best-effort
    }
    await closeTestApp();
  });

  async function createDraftPlanWithFu(
    namePrefix: string,
  ): Promise<{ planId: string; fuVersion: number }> {
    const planner = await loginAs(app, 'PLANNER');
    const planRes = await request(app.getHttpServer())
      .post('/plans')
      .set(planner.authHeader())
      .send({
        planName: `E2E-SCALE-${namePrefix}-${Date.now()}`,
        cplId: fixture.cplId,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY_SAC_BOYASI,
        startDate: '2026-01-05',
        endDate: '2026-01-31',
      })
      .expect(201);
    const planId = planRes.body.id;

    const addFuRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(planner.authHeader())
      .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
      .expect(201);

    return { planId, fuVersion: addFuRes.body.version };
  }

  async function getPlanFu(planId: string) {
    const planner = await loginAs(app, 'PLANNER');
    const planRes = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(planner.authHeader())
      .expect(200);
    return planRes.body.planFus.find((f: any) => f.fuId === FU_TUP_BOYA);
  }

  describe('PERCENT mechanic out of bound -> 400 INVALID_SCALE', () => {
    it('CPP_ON_PCT: 150 (valid version) -> 400, code INVALID_SCALE, violations non-empty', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'PERCENT-OOB',
      );

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 150 }, version: fuVersion });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SCALE');
      expect(Array.isArray(res.body.violations)).toBe(true);
      expect(res.body.violations.length).toBeGreaterThan(0);
      expect(res.body.violations[0].code).toBe('CPP_ON_PCT');
      expect(res.body.violations[0].kind).toBe('rate');
    });
  });

  describe('AMOUNT mechanic sub-kuruş -> 400 INVALID_SCALE', () => {
    it('VIS_LS (lumpsum): 100.005 (3 decimals, valid version) -> 400 INVALID_SCALE', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'AMOUNT-SUBKURUS',
      );

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { VIS_LS: 100.005 }, version: fuVersion });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SCALE');
      expect(res.body.violations[0].code).toBe('VIS_LS');
      expect(res.body.violations[0].kind).toBe('totalAmount');
    });
  });

  describe('AMOUNT_PER_UNIT exemption proven on the live route', () => {
    it('PRICE_SUP: 0.0125 TRY/unit (4 decimals, valid version) -> 200, NOT rejected', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'UNITAMOUNT-EXEMPT',
      );

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { PRICE_SUP: 0.0125 }, version: fuVersion });

      expect(res.status).toBe(200);
      expect(res.body.tactics.PRICE_SUP).toBe(0.0125);
    });
  });

  describe('a rejected (400) request leaves plan_fus.tactics and .version untouched', () => {
    it('no partial write from empty state: tactics stay null/absent, version stays at the pre-request value', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'NO-PARTIAL-WRITE-EMPTY',
      );

      const before = await getPlanFu(planId);
      expect(before.version).toBe(fuVersion);

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 150 }, version: fuVersion });
      expect(res.status).toBe(400);

      const after = await getPlanFu(planId);
      expect(after.version).toBe(fuVersion);
      expect(after.tactics).toEqual(before.tactics);
    });

    it('no partial write over existing state: a prior valid tactics value survives a subsequent rejected write unchanged', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'NO-PARTIAL-WRITE-EXISTING',
      );

      // Establish real prior state.
      const win = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 20 }, version: fuVersion })
        .expect(200);
      expect(win.body.tactics.CPP_ON_PCT).toBe(20);
      const versionAfterWin = win.body.version;

      // Reject: same version (current), invalid value.
      const rejected = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 150 }, version: versionAfterWin });
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('INVALID_SCALE');

      const after = await getPlanFu(planId);
      expect(after.version).toBe(versionAfterWin);
      expect(after.tactics.CPP_ON_PCT).toBe(20);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // §1 — F2/C3 second review pass: unknown mechanic code rejected BEFORE
  // the write (plan.service.ts#updateFuTactic step 3, ahead of
  // checkEnteredScale). Previously the bad key was silently accepted here,
  // written to plan_fus.tactics, and only THEN rejected by recalc's own
  // call to the same `unknownMechanicCodeError` producer — after the write
  // already committed on its own connection. That left an unopenable plan:
  // every later recalc/submit hit the identical 400 on the same stuck key.
  // ──────────────────────────────────────────────────────────────────────

  describe('unknown mechanic code — rejected before the write (F2/C3)', () => {
    it('NO_SUCH_MECHANIC: 5 (valid version) -> 400 UNKNOWN_MECHANIC_CODE, naming the bad code and the known active codes', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'UNKNOWN-MECHANIC',
      );

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { NO_SUCH_MECHANIC: 5 }, version: fuVersion });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNKNOWN_MECHANIC_CODE');
      // Message must name the offending code AND the known active codes —
      // this is a planner-typo message, not a generic 400 (see
      // unknownMechanicCodeError's doc comment: "a planner who mistyped
      // must be able to read the error and fix it themselves").
      expect(res.body.message).toContain('NO_SUCH_MECHANIC');
      for (const knownCode of [
        'CPP_ON_PCT',
        'CPP_OFF_PCT',
        'MEC-DISCOUNT',
        'DISPLAY_FEE',
        'VIS_LS',
        'PRICE_SUP',
      ]) {
        expect(res.body.message).toContain(knownCode);
      }
    });

    it('rejected before the write: the unknown key never reaches plan_fus.tactics and .version does not advance — the 400 alone is NOT proof of this (the old, buggy behaviour also returned 400, just AFTER writing)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'UNKNOWN-MECHANIC-NO-WRITE',
      );

      const before = await getPlanFu(planId);
      expect(before.version).toBe(fuVersion);

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { NO_SUCH_MECHANIC: 5 }, version: fuVersion });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNKNOWN_MECHANIC_CODE');

      const after = await getPlanFu(planId);
      expect(after.version).toBe(fuVersion);
      // The bad key must be entirely absent, not merely unequal to 5 —
      // a partial write that landed the key with a different/null value
      // would still fail this.
      expect(
        after.tactics ? Object.prototype.hasOwnProperty.call(
          after.tactics,
          'NO_SUCH_MECHANIC',
        ) : false,
      ).toBe(false);
      expect(after.tactics).toEqual(before.tactics);
    });

    it('the plan is not locked by the rejection: a subsequent valid tactic write on the same FU still returns 200', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'UNKNOWN-MECHANIC-NOT-LOCKED',
      );

      const rejected = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { NO_SUCH_MECHANIC: 5 }, version: fuVersion });
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('UNKNOWN_MECHANIC_CODE');

      // Same FU version as before — the rejected request never bumped it.
      const valid = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10 }, version: fuVersion });

      expect(valid.status).toBe(200);
      expect(valid.body.tactics.CPP_ON_PCT).toBe(10);
      expect(valid.body.tactics).not.toHaveProperty('NO_SUCH_MECHANIC');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // §2 — sequencing guarantee, named: a stale request is never
  // scale-judged. C3 step 2's comment in plan.service.ts#updateFuTactic
  // states the invariant explicitly: the version pre-check runs BEFORE
  // checkEnteredScale, so a stale write never reaches scale validation at
  // all (it fails CAS first). Today that invariant only lives, unnamed,
  // inside optimistic-locking.e2e-spec.ts:192 as a `{ CPP_ON_PCT: 999 }` +
  // `version: 1` fixture whose test name says nothing about scale — if
  // someone changes `999` to an in-range value (e.g. `50`) while fixing
  // something unrelated, the guarantee silently stops being exercised and
  // nothing here would fail. This case exists so the sequencing claim has
  // its own name and cannot be edited away without a visibly-named test
  // going red.
  // ──────────────────────────────────────────────────────────────────────

  describe('stale version wins over scale validation — a stale request is never scale-judged', () => {
    it('stale version (1) + a scale-invalid value (CPP_ON_PCT: 999, > 100) -> 409 STALE_VERSION, not 400 INVALID_SCALE', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { planId, fuVersion } = await createDraftPlanWithFu(
        'STALE-BEFORE-SCALE',
      );

      // Advance plan_fus.version once (fuVersion -> fuVersion + 1) with a
      // valid, unrelated write, so `fuVersion` itself is now stale. Uses
      // CPP_ON_PCT (a `rate`-kind mechanic) rather than a lumpsum mechanic
      // like DISPLAY_FEE — a lumpsum write on a fresh FU with no base
      // volume set on any SKU fails its own 400
      // (LUMPSUM_DISTRIBUTION_NO_BASE_VOLUME), which is unrelated to what
      // this test proves and would make the "win" step itself flaky.
      const win = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10 }, version: fuVersion })
        .expect(200);
      expect(win.body.version).toBe(fuVersion + 1);

      // Replay the now-stale `fuVersion` with a value that is BOTH stale
      // AND out-of-scale (150 > 100 bound). If scale were judged first (or
      // the two checks raced), this could surface as 400 INVALID_SCALE
      // instead of 409 — that would be the sequencing guarantee breaking.
      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 999 }, version: fuVersion });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_VERSION');
      expect(res.body.currentVersion).toBe(fuVersion + 1);

      // No partial write from the stale+invalid request either: the
      // winner's CPP_ON_PCT value (10) survives untouched — it was never
      // overwritten by the stale replay's out-of-scale 999.
      const after = await getPlanFu(planId);
      expect(after.version).toBe(fuVersion + 1);
      expect(after.tactics.CPP_ON_PCT).toBe(10);
    });
  });
});
