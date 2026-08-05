import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR 0007 Karar 4 / errata E13 — the CONTRACT half of expand-contract.
 *
 * Migration 1796 added the three semantic columns and deliberately left
 * `entered_value` in place, because dropping a column is impossible without
 * touching its readers: schema widens first, consumers migrate, schema narrows
 * last. This is the narrowing.
 *
 * PRECONDITION, PROVEN NOT ASSUMED
 * All 18 production readers moved onto the semantic columns (F2/C2b-0..3).
 * The proof is not "we counted them" — the counting was wrong twice. The proof
 * is that `enteredValue` was removed from the PlanMechanicValue entity and
 * `tsc --noEmit` then compiled clean. Removing the property makes every
 * remaining reader a compile error; a clean compile means none remain.
 *
 * (Running `tsc` BEFORE removing the property proves nothing — it is green
 * whether 18 readers remain or 0, because the property still exists. That
 * ordering defect is recorded in CLAUDE.md §2.7.)
 *
 * The first run of that proof surfaced 2 references the inventory had missed
 * (the entity's own spec), which is exactly what the step is for.
 *
 * DATA
 * `plan_mechanic_values` holds 0 rows, so nothing is lost. `down()` restores
 * the column as it was — `numeric(18,4)`, nullable.
 */
export class DropPlanMechanicEnteredValue1797000000000 implements MigrationInterface {
  name = 'DropPlanMechanicEnteredValue1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SCHEMA-QUALIFIED. This database hosts both `main` (CTPM) and `public`
    // (TTM); an unqualified catalogue probe reads whichever schema resolves
    // first. That is the defect class behind
    // UQ_ledger_entries_reversal_per_tenant silently never applying.
    const exists = await queryRunner.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'main'
         AND table_name   = 'plan_mechanic_values'
         AND column_name  = 'entered_value'
    `);

    if (exists.length > 0) {
      await queryRunner.query(`
        ALTER TABLE main.plan_mechanic_values DROP COLUMN entered_value
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'main'
         AND table_name   = 'plan_mechanic_values'
         AND column_name  = 'entered_value'
    `);

    if (exists.length === 0) {
      await queryRunner.query(`
        ALTER TABLE main.plan_mechanic_values
          ADD COLUMN entered_value numeric(18,4)
      `);
    }
  }
}
