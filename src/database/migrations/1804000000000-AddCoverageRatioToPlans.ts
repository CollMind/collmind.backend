import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-218 — `plans.coverage_ratio`.
 *
 * The value already exists: `KpiEngineService.calculatePlan()` computes a
 * `coverageRatio` for every rolled-up KPI result (SUM/AVG aggregates via the
 * `else` branch, ratio KPIs via `recomputeRatioFromChildren` — both in
 * `kpi-engine.service.ts`). `plan.service.ts` reads `GP_ROI_PCT` out of that
 * result set for `overallRoi`/`ragStatus` (the plan's headline ROI KPI —
 * `calculationLevel: SKU`, `aggregationMethodFu: WEIGHTED_AVG`,
 * `kpi.seed.ts`) but discards `GP_ROI_PCT.coverageRatio` — the fraction of
 * FUs that resolved into that value. Without a carrier at the `plans` row,
 * no plan-level surface (`PlanList`, `GrandTotals`) can render the `K-2.4.22a`
 * grey/coverage-badge state; INV-N-004 records this as "remediation blocked,
 * not merely unwritten".
 *
 * Scope decision (product owner, 2026-08-14): a single nullable column, not
 * a `calculated_kpis` JSONB bucket on `plans` — `plan_fus`/`plan_skus`
 * already have that shape for their own children, but `plans` has no
 * consumer for a whole KPI-result map today (İlke 1: no schema flexibility
 * ahead of a need).
 *
 * `null` (not `0`, not omitted) means "no FUs to aggregate" or "engine did
 * not report a ratio for this KPI at plan level" — same T-027 discipline as
 * `overall_roi`/`rag_status` next to it: an explicit `null` on every write,
 * never a stale prior value left behind by an UPDATE that skips the column.
 *
 * `numeric(9,4)`: the value is a fraction in `[0, 1]` (`K-2.4.22b`'s
 * "4/170" ratio), not a currency amount — narrower precision than the
 * `overall_roi` column (`numeric(18,4)`) on purpose, no unit mismatch to
 * reconcile.
 *
 * No backfill: existing rows have no historical `coverageRatio` to recover
 * (the engine never persisted it at plan level); the next recalc populates
 * it going forward. `nullable: true` covers the gap for rows that are never
 * recalculated.
 */
export class AddCoverageRatioToPlans1804000000000
  implements MigrationInterface
{
  name = 'AddCoverageRatioToPlans1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."plans"
      ADD COLUMN "coverage_ratio" numeric(9,4) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."plans"
      DROP COLUMN "coverage_ratio";
    `);
  }
}
