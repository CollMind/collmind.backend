/**
 * T-008 Code-Review S-5 — Deactivate legacy KPI rows
 *
 * The following KPI codes were created by pre-migration seeds and are now
 * superseded by BRD-canonical equivalents:
 *
 *   PLAN_TURNOVER  — formula_text 'PLAN_VOL * BPTT'
 *                    Superseded by PLANNED_GSV (same formula, correct name)
 *                    and PLANNED_TO (on-invoice-only NIV turnover).
 *
 *   TACTIC_SPEND   — formula_text 'TACTIC_SPEND'
 *                    Superseded by TOTAL_PLANNED_SPEND (from SpendCalc).
 *
 *   GP             — formula_text '(PLAN_VOL * BPTT) - (PLAN_VOL * COGS) - TACTIC_SPEND'
 *                    Superseded by PLANNED_GP (BRD formula: PLANNED_TO - PLANNED_COGS).
 *
 * While active, the KPI engine picks them up, evaluates them (often to null
 * because their dependencies are absent in the new recalc context) and writes
 * null entries to calculatedKpis JSONB — polluting results and causing noise
 * in getAnalysis / calculateKpis responses.
 *
 * This migration marks them is_active = false using a formula_text guard so the
 * update is idempotent and will not affect rows that happen to share a code but
 * have a different (current) formula.
 *
 * down() re-activates them (reverts to pre-migration state).
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeactivateLegacyKpis1782000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Deactivate PLAN_TURNOVER rows that still carry the legacy formula.
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET    is_active  = false,
             updated_at = NOW()
      WHERE  kpi_code    = 'PLAN_TURNOVER'
        AND  formula_text = 'PLAN_VOL * BPTT';
    `);

    // Deactivate TACTIC_SPEND rows that carry the identity/legacy formula.
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET    is_active  = false,
             updated_at = NOW()
      WHERE  kpi_code    = 'TACTIC_SPEND'
        AND  formula_text = 'TACTIC_SPEND';
    `);

    // Deactivate GP rows that carry the legacy formula.
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET    is_active  = false,
             updated_at = NOW()
      WHERE  kpi_code    = 'GP'
        AND  formula_text = '(PLAN_VOL * BPTT) - (PLAN_VOL * COGS) - TACTIC_SPEND';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-activate the legacy rows (formula_text guard keeps this idempotent).
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET    is_active  = true,
             updated_at = NOW()
      WHERE  kpi_code    = 'PLAN_TURNOVER'
        AND  formula_text = 'PLAN_VOL * BPTT';
    `);

    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET    is_active  = true,
             updated_at = NOW()
      WHERE  kpi_code    = 'TACTIC_SPEND'
        AND  formula_text = 'TACTIC_SPEND';
    `);

    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET    is_active  = true,
             updated_at = NOW()
      WHERE  kpi_code    = 'GP'
        AND  formula_text = '(PLAN_VOL * BPTT) - (PLAN_VOL * COGS) - TACTIC_SPEND';
    `);
  }
}
