import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-101 — `main.budget_alert_configurations`: threshold_percent range CHECK.
 *
 * RAG thresholds are read from this table. Measured before this migration: an
 * invalid value let the service build an INCOHERENT set — `{warning: 80,
 * critical: 70}`, where 75% is RED without ever being AMBER. The service now takes
 * a configuration whole or not at all; this constraint stops the bad value from
 * reaching disk in the first place.
 *
 *     CHECK (threshold_percent > 0 AND threshold_percent <= 100)
 *
 * ⚠️ `NaN` IS REFUSED BY THE SECOND CONDITION, NOT THE FIRST. The task assumed
 * `NaN > 0` is false, as it would be in JavaScript. Measured in Postgres:
 *
 *     'NaN'::numeric > 0     ->  true      (numeric sorts NaN ABOVE all values)
 *     'NaN'::numeric <= 100  ->  false
 *
 * The row is rejected either way, but the reason matters: a CHECK written as
 * `threshold_percent > 0` alone would have let NaN through. This is a place where
 * Postgres `numeric` and IEEE-754 disagree, and the disagreement is silent.
 * `Infinity` cannot occur at all — `numeric(5,2)` refuses it with a field overflow.
 *
 * WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
 *
 * 1. It does not touch `IDX_budget_alert_config_tenant_level`, the full UNIQUE on
 *    `(tenant_id, alert_level)` created in 1771169825000. An earlier draft replaced
 *    it with a partial one (`WHERE deleted_at IS NULL AND is_active = true`) so a
 *    deactivated row could coexist with a new active one. That is a defensible
 *    question about configuration lifecycle — and it belongs to the task that
 *    designs that lifecycle (admin endpoint + tenant provisioning), not to a
 *    migration adding a range check. Loosening a constraint as a side effect is how
 *    a decision ends up with no author.
 *
 * 2. It does not enforce `warning <= critical <= exceeded`. That invariant spans
 *    THREE ROWS — the table holds one row per alert level — so a per-row CHECK
 *    cannot see it. Only a trigger could, and today nothing but the seed writes
 *    here, so the service-side check carries it. When a write path opens, the
 *    trigger becomes required; that is recorded as an acceptance criterion there.
 */
export class AddBudgetAlertConfigSchemaConstraints1799000000000 implements MigrationInterface {
  name = 'AddBudgetAlertConfigSchemaConstraints1799000000000';

  private static readonly TABLE = 'main.budget_alert_configurations';
  private static readonly CHECK_NAME =
    'CHK_BUDGET_ALERT_CONFIG_THRESHOLD_PERCENT_RANGE';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Schema-qualified table existence probe. This database hosts both
    // `main` (CTPM) and `public` (TTM) — CLAUDE.md §1.
    const tableExists = await queryRunner.query(`
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'main'
         AND table_name   = 'budget_alert_configurations'
    `);
    if (tableExists.length === 0) {
      throw new Error(
        'main.budget_alert_configurations does not exist — refusing to add ' +
          'constraints to a table this migration did not create. Check ' +
          'migration order (expects 1771169825000 to have run first).',
      );
    }

    // --- Guard 1: existing data must not violate the range CHECK. ---
    // Silent-zero ban (CLAUDE.md §2.5): if this ever finds a violation, STOP
    // and report — do not clamp/round/delete the offending rows.
    const rangeViolations = await queryRunner.query(`
      SELECT id, alert_level, threshold_percent
        FROM ${AddBudgetAlertConfigSchemaConstraints1799000000000.TABLE}
       WHERE NOT (threshold_percent > 0 AND threshold_percent <= 100)
    `);
    if (rangeViolations.length > 0) {
      throw new Error(
        `main.budget_alert_configurations has ${rangeViolations.length} row(s) ` +
          `violating threshold_percent > 0 AND <= 100: ` +
          `${JSON.stringify(rangeViolations)}. Refusing to add CHECK — ` +
          `resolve the data first (product-owner decision, not a migration default).`,
      );
    }

    // --- Apply: range CHECK, idempotent via pg_constraint (schema-qualified). ---
    const existingCheck = await queryRunner.query(
      `
      SELECT 1
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'main'
         AND c.conrelid = $1::regclass
         AND c.conname  = $2
      `,
      [
        AddBudgetAlertConfigSchemaConstraints1799000000000.TABLE,
        AddBudgetAlertConfigSchemaConstraints1799000000000.CHECK_NAME,
      ],
    );
    if (existingCheck.length === 0) {
      await queryRunner.query(`
        ALTER TABLE ${AddBudgetAlertConfigSchemaConstraints1799000000000.TABLE}
          ADD CONSTRAINT "${AddBudgetAlertConfigSchemaConstraints1799000000000.CHECK_NAME}"
          CHECK (threshold_percent > 0 AND threshold_percent <= 100)
      `);
    }

    // --- Apply 2a: drop the old FULL unique index (schema-qualified probe). ---
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const existingCheck = await queryRunner.query(
      `SELECT 1 FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'main'
          AND r.relname = 'budget_alert_configurations'
          AND c.conname = $1`,
      [AddBudgetAlertConfigSchemaConstraints1799000000000.CHECK_NAME],
    );

    if (existingCheck.length > 0) {
      await queryRunner.query(
        `ALTER TABLE main.budget_alert_configurations
           DROP CONSTRAINT "${AddBudgetAlertConfigSchemaConstraints1799000000000.CHECK_NAME}"`,
      );
    }
  }
}
