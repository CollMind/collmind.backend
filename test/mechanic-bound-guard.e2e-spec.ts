/**
 * mechanic-bound-guard.e2e-spec.ts
 *
 * T-084 — live-route proof for the `boundOf` fix in
 * `mechanic.service.ts` (`create`/`update` min/max guard).
 *
 * Before the fix, a mechanic with an open upper bound (`max_value IS NULL`,
 * e.g. seeded VIS_LS/PRICE_SUP/DISPLAY_FEE — 3 of 6 mechanics) could not be
 * PATCHed on ANY field: `0 >= null` coerced to `0 >= 0` → `true`, so the
 * "minValue must be less than maxValue" guard fired even though the DTO
 * never touched the bounds. This spec exercises the real
 * `PATCH /master-data/mechanics/:id` route (not a mock) against a seeded
 * mechanic that carries this exact shape.
 *
 * Mutation note: `VIS_LS.isActive` is flipped to `false` and back to its
 * original value within the same `it()` (try/finally), so no state leaks
 * into other specs (T-047 invariant). This ALSO includes the two
 * `admin_audit_logs` rows the two successful PATCH calls legitimately
 * create (`AdminAuditService#logAdminAction`, entity_type='mechanic') —
 * `global-teardown.js` enforces a suite-wide row-count invariant on that
 * table, so this spec deletes exactly the rows it produced (same precedent
 * as `cleanupTestPlans`/`cleanupTestAgreements` in seed-e2e.ts, which do the
 * same for entity_type='PLAN'/'AGREEMENT': a direct-SQL, test-scoped
 * deletion of rows this test itself created — not a violation of the
 * application-layer audit-immutability rule, which governs the product's
 * own code paths, not test teardown).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  resolveIdByCode,
  E2EFixture,
} from './helpers/seed-e2e';

describe('Mechanic min/max bound guard — live route (T-084, E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;
  let mechanicId: string;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
    // Seeded with minValue=0, maxValue=NULL ("no upper bound") — the exact
    // shape that triggered the E1 defect (`0 >= null` coerced to `true`).
    mechanicId = await resolveIdByCode(
      app,
      fixture.tenantId,
      'mechanics',
      'VIS_LS',
    );
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it("PATCH with max_value=NULL mechanic: {isActive:false} → 200 (regression: old code 400'd because open upper bound was coerced to 0)", async () => {
    const admin = await loginAs(app, 'ADMIN');

    const before = await request(app.getHttpServer())
      .get(`/master-data/mechanics/${mechanicId}`)
      .set(admin.authHeader())
      .expect(200);
    expect(before.body.code).toBe('VIS_LS');
    expect(before.body.maxValue).toBeNull();
    const originalIsActive: boolean = before.body.isActive;

    // T-047: capture pre-existing audit rows for this mechanic so we can
    // delete ONLY the ones this test produces, not any that already
    // existed (defensive — seed itself does not audit-log its own inserts,
    // but the query is a set-difference either way, so it's correct
    // regardless).
    const auditRowsBefore: { id: string }[] = await dataSource.query(
      `SELECT id FROM main.admin_audit_logs
        WHERE entity_type = 'mechanic' AND entity_id = $1`,
      [mechanicId],
    );
    const auditIdsBefore = new Set(auditRowsBefore.map((r) => r.id));

    try {
      const patchRes = await request(app.getHttpServer())
        .patch(`/master-data/mechanics/${mechanicId}`)
        .set(admin.authHeader())
        .send({ isActive: false })
        .expect(200);

      expect(patchRes.body.isActive).toBe(false);
      // The fix must not have silently invented bounds: still open.
      expect(patchRes.body.maxValue).toBeNull();
    } finally {
      // T-047 invariant: restore seed state for subsequent specs, whether
      // the assertion above passed or failed.
      await request(app.getHttpServer())
        .patch(`/master-data/mechanics/${mechanicId}`)
        .set(admin.authHeader())
        .send({ isActive: originalIsActive })
        .expect(200);

      const auditRowsAfter: { id: string }[] = await dataSource.query(
        `SELECT id FROM main.admin_audit_logs
          WHERE entity_type = 'mechanic' AND entity_id = $1`,
        [mechanicId],
      );
      const newAuditIds = auditRowsAfter
        .map((r) => r.id)
        .filter((id) => !auditIdsBefore.has(id));
      if (newAuditIds.length > 0) {
        await dataSource.query(
          `DELETE FROM main.admin_audit_logs WHERE id = ANY($1::uuid[])`,
          [newAuditIds],
        );
      }
    }

    const after = await request(app.getHttpServer())
      .get(`/master-data/mechanics/${mechanicId}`)
      .set(admin.authHeader())
      .expect(200);
    expect(after.body.isActive).toBe(originalIsActive);
  });

  it('PATCH with a real violation ({minValue:50, maxValue:10}) → 400, still rejected after the fix', async () => {
    const admin = await loginAs(app, 'ADMIN');

    const res = await request(app.getHttpServer())
      .patch(`/master-data/mechanics/${mechanicId}`)
      .set(admin.authHeader())
      .send({ minValue: 50, maxValue: 10 });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(
      'minValue must be less than maxValue',
    );

    // Confirm the rejected write never landed (bounds unchanged).
    const after = await request(app.getHttpServer())
      .get(`/master-data/mechanics/${mechanicId}`)
      .set(admin.authHeader())
      .expect(200);
    expect(Number(after.body.minValue)).toBe(0);
    expect(after.body.maxValue).toBeNull();
  });
});
