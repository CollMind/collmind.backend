import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR 0007 Karar 4 (as corrected by errata E2) — split `entered_value` by semantics.
 *
 * WHY
 * `plan_mechanic_values.entered_value numeric(18,4)` carries THREE different
 * meanings depending on the mechanic, measured live on 2026-08-04:
 *
 *   category             input_type   mechanic_type     meaning
 *   on/off_invoice_disc. percentage   PERCENT           a rate (0-100)
 *   per_unit_support     currency     AMOUNT_PER_UNIT   TRY per unit  (price scale)
 *   lumpsum_spend        currency     AMOUNT            TRY total     (money scale)
 *
 * Three columns, not two: the "money" half is not one scale. A unit price and a
 * total amount round differently and overflow differently, so collapsing them
 * would hide the distinction inside the column rather than remove it.
 *
 * SCOPE — errata E2 is explicit that this is NECESSARY BUT NOT SUFFICIENT.
 * `entered_value` has no production writer; the planner's input goes to the
 * `plan_fus.tactics` JSONB. This migration closes the column layer only. The
 * read path (buildMechanicValues, C2) and the write path (tactics PATCH
 * validation, C3) follow in this same delivery.
 *
 * EXPAND-CONTRACT
 * This migration is the EXPAND half. It ADDS the three columns and leaves
 * `entered_value` in place; the DROP belongs to the commit where the readers
 * stop looking at it (C2, migration 1797). A migration that dropped the column
 * here could not compile alongside its readers and could not be reverted on its
 * own — schema widens first, consumers migrate, schema narrows last.
 * The four-column intermediate state is the pattern, not a cost.
 *
 * DATA
 * `plan_mechanic_values` holds 0 rows (verified before writing this migration).
 * `down()` is a true inverse: it drops only what `up()` added. The path is
 * `migration:run` on a reset database, not an in-place production migration —
 * CTPM has no deployed environment (CLAUDE.md §1).
 */
export class SplitPlanMechanicEnteredValue1796000000000
  implements MigrationInterface
{
  name = 'SplitPlanMechanicEnteredValue1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Catalogue guards are SCHEMA-QUALIFIED. An unqualified pg_constraint /
    // information_schema probe reads whichever schema resolves first, and this
    // database hosts both `main` (CTPM) and `public` (TTM). That defect class is
    // why UQ_ledger_entries_reversal_per_tenant silently never applied.
    const hasEnteredValue = await queryRunner.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'main'
         AND table_name   = 'plan_mechanic_values'
         AND column_name  = 'entered_value'
    `);

    await queryRunner.query(`
      ALTER TABLE main.plan_mechanic_values
        ADD COLUMN IF NOT EXISTS entered_rate_pct     numeric(9,4),
        ADD COLUMN IF NOT EXISTS entered_unit_amount  numeric(18,4),
        ADD COLUMN IF NOT EXISTS entered_total_amount numeric(18,2)
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN main.plan_mechanic_values.entered_rate_pct IS
        'Rate in percent notation (0-100), numeric(9,4). ADR 0007 Karar 5. Runtime type: RateMicro.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN main.plan_mechanic_values.entered_unit_amount IS
        'TRY per unit (PER_UNIT_SUPPORT). Price scale, not money scale. ADR 0007 Karar 4.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN main.plan_mechanic_values.entered_total_amount IS
        'TRY total (LUMPSUM_SPEND). Money scale. ADR 0007 Karar 4. Runtime type: MoneyMinor.'
    `);

    // NO `DROP COLUMN` HERE — this is the EXPAND half of expand-contract.
    // Dropping `entered_value` is impossible without touching its readers, so a
    // C1 that dropped it could not compile on its own and could not be reverted
    // on its own either. The drop moves to C2 (migration 1797), the commit where
    // the readers stop looking at it. Schema widens first, consumers migrate,
    // schema narrows last.
    void hasEnteredValue; // probe kept: C2 asserts the column is still there

    // `<= 1`, deliberately NOT `= 1`.
    // spend-distribution.service.ts creates a PlanMechanicValue row for a
    // mechanic with no entered value. "Row exists, nothing entered yet" is a
    // legitimate state, and `= 1` would make it unwritable — forcing a caller
    // to invent a zero. That is the silent-zero class this contract exists to
    // prevent (CLAUDE.md §2.5), expressed at the schema level: NULL and 0 stay
    // distinguishable.
    // SCOPE: the constraint covers ONLY the three new columns. `entered_value`
    // is deliberately outside it — during expand both may legitimately hold a
    // value (the legacy column still carries today's data path, the new ones
    // are not written yet). Including it would make the expand phase unwritable.
    await queryRunner.query(`
      ALTER TABLE main.plan_mechanic_values
        ADD CONSTRAINT chk_pmv_at_most_one_entered CHECK (
            (entered_rate_pct     IS NOT NULL)::int
          + (entered_unit_amount  IS NOT NULL)::int
          + (entered_total_amount IS NOT NULL)::int
          <= 1
        )
    `);

    await queryRunner.query(`
      ALTER TABLE main.plan_mechanic_values
        ADD CONSTRAINT chk_pmv_rate_range CHECK (
          entered_rate_pct IS NULL
          OR (entered_rate_pct >= 0 AND entered_rate_pct <= 100)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Schema-qualified guard again — dropping a constraint that lives in
    // `public` because the probe was unqualified is the same defect inverted.
    const constraints = await queryRunner.query(`
      SELECT c.conname
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'main'
         AND c.conrelid = 'main.plan_mechanic_values'::regclass
         AND c.conname IN ('chk_pmv_at_most_one_entered', 'chk_pmv_rate_range')
    `);
    for (const row of constraints) {
      await queryRunner.query(
        `ALTER TABLE main.plan_mechanic_values DROP CONSTRAINT "${row.conname}"`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE main.plan_mechanic_values
        DROP COLUMN IF EXISTS entered_rate_pct,
        DROP COLUMN IF EXISTS entered_unit_amount,
        DROP COLUMN IF EXISTS entered_total_amount
    `);
  }
}
