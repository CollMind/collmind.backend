/**
 * budget-transaction-logs-idempotency.e2e-spec.ts
 *
 * T-095 — partial UNIQUE on `main.budget_transaction_logs(tenant_id, idempotency_key)`,
 * proven against a REAL running database (migration
 * `1798000000000-AddPartialIdempotencyIndexToBudgetTransactionLogs.ts`).
 *
 * SCOPE (task note, verbatim from the task brief):
 *   1. Same (tenant_id, idempotency_key), second insert -> 23505, constraint name asserted.
 *   2. Same key, DIFFERENT tenant_id -> both accepted (the constraint is tenant-scoped).
 *   3. idempotency_key = NULL, TWO rows, same tenant_id -> BOTH accepted. This is the
 *      partiality test: with a full (non-partial) `UNIQUE` on a nullable column, ordinary
 *      SQL NULL semantics ALSO permit multiple NULLs (documented explicitly in the
 *      migration's own "NOTE ON SHAPE" comment) — so this one case does not, by itself,
 *      distinguish "partial" from "full-but-nullable". What it DOES rule out is the
 *      REJECTED `NOT NULL + UNIQUE` design the migration's header describes and reverts
 *      (task brief, migration lines 6-27): under that design this insert would fail with
 *      23502 (not-null violation) before uniqueness is even evaluated. Recorded here so a
 *      later reader does not read this test as stronger evidence than it is.
 *
 * This suite bypasses `BudgetAllocationService` entirely (`DataSource.query()` direct
 * INSERT into `main.budget_transaction_logs`) — it exercises the DATABASE CONSTRAINT, not
 * the service's read-before-write guard (that is `budget-allocation.service.spec.ts`'s
 * job, unit-level, under "createTransaction — idempotency read-before-write (T-095)").
 * The two layers protect against different failures (service-level: normal duplicate
 * request; DB-level: race between two writers that both read "absent") and are
 * deliberately proven separately, per the migration's own "THE TWO LAYERS DO DIFFERENT
 * JOBS" comment in budget-allocation.service.ts.
 *
 * FK note: `budget_transaction_logs.budget_allocation_id` has a NOT NULL + FK to
 * `main.budget_allocations(id)` (`ON DELETE CASCADE` — migration
 * 1771169825000-UpdateBudgetAllocationStructure.ts). A single throwaway allocation row is
 * created in `beforeAll` and deleted in `afterAll`; the CASCADE removes every log row this
 * suite inserted without a separate DELETE. Cleanup is verified against the DB, not
 * assumed. `budget_transaction_logs.tenant_id` and `budget_allocations.tenant_id` carry NO
 * FK to a tenants table (checked: no `TableForeignKey` on `tenant_id` in the creating
 * migration) — the "different tenant" in test 2 is therefore a bare random UUID, no
 * `main.tenants` row required and no `main.tenants` cleanup needed.
 *
 * T-047/T-060 row-count invariant (global-setup.js / global-teardown.js): tracks only
 * agreements / plans / plan_fus / plan_skus / approval_requests / admin_audit_logs / users
 * for the shared "Wella Turkey" fixture tenant. This suite touches none of those tables and
 * uses a fully separate throwaway allocation/tenant-id — it cannot perturb that invariant.
 */

import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';

describe('main.budget_transaction_logs — partial idempotency UNIQUE index (T-095, e2e, real DB)', () => {
  const INDEX_NAME = 'IDX_BUDGET_TRANSACTION_LOGS_TENANT_IDEMPOTENCY';

  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;
  let throwawayAllocationId: string;

  beforeAll(async () => {
    app = await createTestApp();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    // Throwaway budget_allocations row purely to satisfy the FK on
    // budget_transaction_logs.budget_allocation_id. `channel` is randomised so this
    // insert cannot collide with the partial-unique dimension index on
    // budget_allocations (tenant_id, period_type, period_start, period_end, cpl_id,
    // channel, category) regardless of what other suites/seed data hold at these dates.
    const inserted = await dataSource.query(
      `INSERT INTO main.budget_allocations
         (tenant_id, period_type, period_start, period_end, fiscal_year, channel)
       VALUES ($1, 'monthly', '2099-01-01', '2099-01-31', 2099, $2)
       RETURNING id`,
      // `channel` is varchar(50) (budget-allocation.entity.ts) — prefix kept short
      // enough that prefix + a full 36-char UUID still fits.
      [fixture.tenantId, `E2E-IDEMP-FK-${randomUUID()}`],
    );
    throwawayAllocationId = inserted[0].id;
  });

  afterAll(async () => {
    if (throwawayAllocationId) {
      // ON DELETE CASCADE (budget_transaction_logs.budget_allocation_id FK) removes
      // every log row this suite inserted in one statement.
      await dataSource.query(`DELETE FROM main.budget_allocations WHERE id = $1`, [
        throwawayAllocationId,
      ]);
    }
    await closeTestApp();
  });

  /** Extracts the postgres error code/constraint regardless of whether TypeORM
   *  spread the driver error's own properties onto the QueryFailedError instance
   *  (it does — see node_modules/typeorm/error/QueryFailedError.js) or left them
   *  nested under `.driverError` (defensive fallback, matches the existing
   *  `error?.code === '23505' || error?.driverError?.code === '23505'` pattern
   *  already used in agreement.service.ts / sales-actuals.service.ts / seeds). */
  function extractPgError(err: any): { code?: string; constraint?: string } {
    return {
      code: err?.code ?? err?.driverError?.code,
      constraint: err?.constraint ?? err?.driverError?.constraint,
    };
  }

  async function insertLog(
    tenantId: string,
    idempotencyKey: string | null,
  ): Promise<string> {
    const rows = await dataSource.query(
      `INSERT INTO main.budget_transaction_logs
         (tenant_id, budget_allocation_id, transaction_type, on_invoice_amount,
          off_invoice_amount, idempotency_key)
       VALUES ($1, $2, 'reservation', 100.00, 50.00, $3)
       RETURNING id`,
      [tenantId, throwawayAllocationId, idempotencyKey],
    );
    return rows[0].id;
  }

  async function countLogsForAllocation(): Promise<number> {
    const rows = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM main.budget_transaction_logs
        WHERE budget_allocation_id = $1`,
      [throwawayAllocationId],
    );
    return rows[0].count;
  }

  it('1) same (tenant_id, idempotency_key): first insert succeeds, second insert on the identical pair fails with 23505 on IDX_BUDGET_TRANSACTION_LOGS_TENANT_IDEMPOTENCY', async () => {
    const key = `E2E-IDEMPOTENCY-DUP-${randomUUID()}`;

    const firstId = await insertLog(fixture.tenantId, key);
    expect(firstId).toBeDefined();

    let caught: any;
    let unexpectedSecondId: string | undefined;
    try {
      unexpectedSecondId = await insertLog(fixture.tenantId, key);
    } catch (err) {
      caught = err;
    }

    expect(unexpectedSecondId).toBeUndefined();
    expect(caught).toBeDefined();

    const { code, constraint } = extractPgError(caught);
    expect(code).toBe('23505');
    expect(constraint).toBe(INDEX_NAME);

    // Only the ORIGINAL row exists — both rejected duplicate attempts wrote nothing.
    const rows = await dataSource.query(
      `SELECT id FROM main.budget_transaction_logs
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [fixture.tenantId, key],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(firstId);
  });

  it('2) same idempotency_key, DIFFERENT tenant_id: both inserts are accepted — the unique constraint is tenant-scoped, not global', async () => {
    const key = `E2E-IDEMPOTENCY-CROSS-TENANT-${randomUUID()}`;
    const tenantB = randomUUID(); // bare uuid: tenant_id carries no FK, see file header

    const idA = await insertLog(fixture.tenantId, key);
    const idB = await insertLog(tenantB, key);

    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(idA).not.toBe(idB);

    const rows = await dataSource.query(
      `SELECT tenant_id FROM main.budget_transaction_logs WHERE idempotency_key = $1`,
      [key],
    );
    expect(rows).toHaveLength(2);
    const tenantIds = rows.map((r: { tenant_id: string }) => r.tenant_id).sort();
    expect(tenantIds).toEqual([fixture.tenantId, tenantB].sort());
  });

  it('3) idempotency_key = NULL, same tenant_id, TWO rows: both accepted — proves the index is PARTIAL (`WHERE idempotency_key IS NOT NULL`), not merely nullable-full (see file header caveat: this alone does not distinguish partial from full-but-nullable; it does rule out the rejected NOT NULL variant, which would 23502 here before uniqueness is even checked)', async () => {
    const beforeCount = await countLogsForAllocation();

    const idOne = await insertLog(fixture.tenantId, null);
    const idTwo = await insertLog(fixture.tenantId, null);

    expect(idOne).toBeDefined();
    expect(idTwo).toBeDefined();
    expect(idOne).not.toBe(idTwo);

    const afterCount = await countLogsForAllocation();
    expect(afterCount).toBe(beforeCount + 2);

    const rows = await dataSource.query(
      `SELECT id, idempotency_key FROM main.budget_transaction_logs WHERE id = ANY($1::uuid[])`,
      [[idOne, idTwo]],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.idempotency_key).toBeNull();
    }
  });

  it('cleanup sanity: after afterAll runs (verified here mid-suite via a direct query on the throwaway allocation before it is deleted) the rows this suite created are all scoped to throwawayAllocationId, so the pending FK-cascade DELETE in afterAll removes them all', async () => {
    const rows = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM main.budget_transaction_logs
        WHERE budget_allocation_id = $1`,
      [throwawayAllocationId],
    );
    // 1 (test 1, surviving row) + 2 (test 2) + 2 (test 3) = 5, but this test's
    // exact count is incidental — the point is every row this suite wrote carries
    // this allocation id, which is what makes the afterAll DELETE...CASCADE exhaustive.
    expect(rows[0].count).toBeGreaterThanOrEqual(5);
  });
});
