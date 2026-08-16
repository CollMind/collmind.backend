/**
 * e2e-row-count.js (CommonJS — required directly by Jest's globalSetup /
 * globalTeardown, which run in a separate process/module realm from the
 * ts-jest-transformed spec files and must NOT depend on ts-jest).
 *
 * T-047: shared DB-count logic for the suite-wide row-count invariant.
 * T-060: scope widened (approval_requests / admin_audit_logs / users) —
 * see the comment above countRows() for how this scope was determined
 * (measured, not guessed) and global-setup.js for the invariant itself.
 */

const { Client } = require('pg');
require('dotenv').config();

function envOr(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

// K-2.6.13a/d: bu, `npm run test:e2e` suite'inin YALNIZ SELECT yapan bir
// ölçüm bağlantısıdır (satır sayısı invaryantı, T-047/T-060) — app_runtime
// (K-2.6.13, AC#1: "tam suite app_runtime altında yeşil") ile aynı rolü
// kullanır, çünkü ölçtüğü tablolar zaten uygulamanın kendisi tarafından
// sürekli okunuyor (envanter S3'ün kapsadığı SELECT hakları burada da
// yeterli). Sessizce 'postgres'e düşmez — eksikse AÇIK hata.
//
// Bu dosya CommonJS'tir ve ts-jest'e bağımlı OLAMAZ (bkz. dosya başı yorumu)
// — bu yüzden `src/config/db-role-env.ts`'i import EDEMEZ ve aynı
// fail-fast mantığını burada AYRI bir kopya olarak taşır. İkisi aynı
// sözleşmeyi (DB_RUNTIME_USERNAME/PASSWORD zorunlu, sessiz varsayılan yok)
// uygular — biri değişirse diğeri de gözden geçirilmeli.
function requireEnv(key) {
  const v = process.env[key];
  if (v === undefined || v === '') {
    throw new Error(
      `${key} tanımlı değil. K-2.6.13d: veritabanı bağlantı kimliği eksikse ` +
        `sessizce bir varsayılana düşülmez.`,
    );
  }
  return v;
}

function schema() {
  return envOr('DB_SCHEMA', 'main');
}

async function connect() {
  const client = new Client({
    host: envOr('DB_HOST', 'localhost'),
    port: parseInt(envOr('DB_PORT', '5432'), 10),
    user: requireEnv('DB_RUNTIME_USERNAME'),
    password: requireEnv('DB_RUNTIME_PASSWORD'),
    database: envOr('DB_DATABASE', ''),
  });
  await client.connect();
  return client;
}

/** Resolves the e2e fixture tenant id — mirrors loadE2EFixture (seed-e2e.ts). */
async function resolveFixtureTenantId(client) {
  const s = schema();
  const res = await client.query(
    `SELECT id FROM ${s}.tenants WHERE name = 'Wella Turkey' LIMIT 1`,
  );
  if (res.rows.length === 0) {
    throw new Error(
      "T-047 invariant: 'Wella Turkey' tenant not found — run `npm run seed` " +
        'before `npm run test:e2e`.',
    );
  }
  return res.rows[0].id;
}

/**
 * Counts main.agreements / main.plans / main.plan_fus / main.plan_skus for
 * the given tenant — INCLUDING soft-deleted rows (no `deleted_at IS NULL`
 * filter). This is deliberate: a soft-deleted row that lost its 'E2E-'
 * prefix on rename is exactly the leak class T-047 closes (see
 * 'bump-before-delete', found soft-deleted with 0 active rows but 94
 * physical rows during T-047 triage) — filtering it out would make the
 * invariant blind to it again.
 *
 * T-060 — SCOPE WIDENING (measured, not guessed):
 * Team Lead measured `main.approval_requests` at 9,116 rows with
 * `main.plans` at 0 — proof the T-047 invariant above was blind to a whole
 * table. Instead of guessing which OTHER tables might also leak, every
 * `main.*` table was row-counted immediately before and immediately after
 * one full, unmodified `npm run test:e2e` run (dev DB, no reset). Only
 * THREE tables had a non-zero delta:
 *   approval_requests  +38   (main.plans/agreements FK-less polymorphic
 *                              entity_id — cleanupTestPlans/
 *                              cleanupTestAgreements never touched it)
 *   admin_audit_logs   +6    (all entity_type='AGREEMENT_TRANSACTION' —
 *                              reversal.service.ts's REVERSE audit row,
 *                              also FK-less polymorphic entity_id;
 *                              cleanupTestAgreements deleted the
 *                              agreement_transactions row but never the
 *                              audit row pointing at it)
 *   users              +1    (role-journey.e2e-spec.ts N9 — POST /users
 *                              creates a throwaway PLANNER to prove
 *                              fail-closed scope; no DELETE /users exists,
 *                              only `deactivate` was called, so the row
 *                              stayed forever — measured: 289/298 rows,
 *                              97% of the whole table, from this one test)
 * Every other table (budget_transactions, ledger_entries, plan_fus,
 * plan_skus, ...) had delta=0 in that same measurement — i.e. the existing
 * cleanup helpers already return them to baseline, so adding them here
 * would add noise, not coverage.
 *
 * All three root causes were fixed (test/helpers/seed-e2e.ts:
 * cleanupTestPlans/cleanupTestAgreements now also delete the
 * approval_requests/admin_audit_logs rows that point at the plan/agreement/
 * agreement_transaction ids they delete; a new cleanupTestUsers hard-deletes
 * role-journey's throwaway user by exact id). These three tables are added
 * to the invariant as RAW counts (not "orphan counts") deliberately: after
 * the fix, a leak-free run nets to zero on all of them (re-measured, see
 * task report) — a raw-count regression is the simplest signal and, unlike
 * an orphan-count, doesn't quietly hide a NEW kind of leak that happens to
 * leave a non-orphaned-looking row behind.
 *
 * Why admin_audit_logs as a RAW count is safe (this contradicts the T-047
 * global-setup.js comment, which deliberately excluded it as "expected,
 * legitimate append-only growth" — that assumption was re-checked here, not
 * inherited): every current e2e admin_audit_logs producer in this suite
 * (agreement.service.ts 'AGREEMENT', reversal.service.ts
 * 'AGREEMENT_TRANSACTION', settlement-close.service.ts 'AGREEMENT',
 * sales-actuals.service.ts 'SalesActualBatch') writes against a fixture
 * that some cleanup helper in this run deletes (cleanupTestAgreements /
 * cleanupSalesActuals) — none of the *current* specs write audit rows
 * against the seed's own agreements (reversal.e2e-spec.ts and
 * settlement.e2e-spec.ts both have explicit comments confirming they
 * stopped using `fixture.approvedAgreementId` for exactly this reason).
 * mechanic.service.ts / channel.service.ts also write admin_audit_logs but
 * no e2e spec calls those endpoints, so they never fire here. If that ever
 * changes, this raw count will correctly go red — the fix then is to widen
 * the matching cleanup helper, not to loosen this invariant.
 */
async function countRows(client, tenantId) {
  const s = schema();
  const agreements = await client.query(
    `SELECT count(*)::int AS c FROM ${s}.agreements WHERE tenant_id = $1`,
    [tenantId],
  );
  const plans = await client.query(
    `SELECT count(*)::int AS c FROM ${s}.plans WHERE tenant_id = $1`,
    [tenantId],
  );
  const planFus = await client.query(
    `SELECT count(*)::int AS c FROM ${s}.plan_fus pf
       JOIN ${s}.plans p ON p.id = pf.plan_id
      WHERE p.tenant_id = $1`,
    [tenantId],
  );
  const planSkus = await client.query(
    `SELECT count(*)::int AS c FROM ${s}.plan_skus ps
       JOIN ${s}.plan_fus pf ON pf.id = ps.plan_fu_id
       JOIN ${s}.plans p ON p.id = pf.plan_id
      WHERE p.tenant_id = $1`,
    [tenantId],
  );
  const approvalRequests = await client.query(
    `SELECT count(*)::int AS c FROM ${s}.approval_requests WHERE tenant_id = $1`,
    [tenantId],
  );
  const adminAuditLogs = await client.query(
    `SELECT count(*)::int AS c FROM ${s}.admin_audit_logs WHERE tenant_id = $1`,
    [tenantId],
  );
  const users = await client.query(
    `SELECT count(*)::int AS c FROM ${s}.users WHERE tenant_id = $1`,
    [tenantId],
  );
  return {
    agreements: agreements.rows[0].c,
    plans: plans.rows[0].c,
    planFus: planFus.rows[0].c,
    planSkus: planSkus.rows[0].c,
    approvalRequests: approvalRequests.rows[0].c,
    adminAuditLogs: adminAuditLogs.rows[0].c,
    users: users.rows[0].c,
  };
}

module.exports = { connect, resolveFixtureTenantId, countRows };
