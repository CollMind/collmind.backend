/**
 * e2e-row-count.js (CommonJS — required directly by Jest's globalSetup /
 * globalTeardown, which run in a separate process/module realm from the
 * ts-jest-transformed spec files and must NOT depend on ts-jest).
 *
 * T-047: shared DB-count logic for the suite-wide row-count invariant.
 * See global-setup.js / global-teardown.js for the invariant itself.
 */

const { Client } = require('pg');
require('dotenv').config();

function envOr(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function schema() {
  return envOr('DB_SCHEMA', 'main');
}

async function connect() {
  const client = new Client({
    host: envOr('DB_HOST', 'localhost'),
    port: parseInt(envOr('DB_PORT', '5432'), 10),
    user: envOr('DB_USERNAME', 'postgres'),
    password: envOr('DB_PASSWORD', ''),
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
  return {
    agreements: agreements.rows[0].c,
    plans: plans.rows[0].c,
    planFus: planFus.rows[0].c,
    planSkus: planSkus.rows[0].c,
  };
}

module.exports = { connect, resolveFixtureTenantId, countRows };
