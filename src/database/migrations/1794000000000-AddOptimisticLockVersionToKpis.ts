import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-039 — Optimistic locking for KPI/formula configuration (BRD "eş zamanlı
 * düzenleme" + "hesaplamalar dinamik formülden gelir"). Same mechanism as
 * T-034 (`docs/analysis/0005-optimistic-locking-design.md` K1): manual
 * `version integer` + compare-and-swap via `applyVersionedUpdate`, NOT
 * `@VersionColumn` — see `kpi.entity.ts#version` for why `@VersionColumn`
 * would be a "looks like it works, doesn't" trap here even though
 * `KpiService`'s mutations already go through `save()`.
 *
 * `kpis` is a tenant-wide configuration table (not per-plan): two Admins
 * editing the same `formula_text`/`rag_*_threshold`/`calculation_order`
 * concurrently today silently lose one edit, and the effect spans every
 * calculation for that tenant, not a single plan.
 *
 * `DEFAULT 1` -> no backfill needed, existing rows become version=1.
 * Postgres 11+ non-volatile default -> `ADD COLUMN` does not rewrite the
 * table.
 *
 * Scope: `kpis` only. Other tenant-wide config candidates surveyed
 * (`mechanic`, `tactic`, master-data entities) are lower-contention,
 * single-admin-edit surfaces and are deliberately left for a follow-up task;
 * `budget_alert_configuration` has no mutation endpoint today (seed-only) so
 * there is no concurrent-write surface to protect. Append-only tables are
 * out of scope per T-034's K9 (unchanged).
 */
export class AddOptimisticLockVersionToKpis1794000000000 implements MigrationInterface {
  name = 'AddOptimisticLockVersionToKpis1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."kpis" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."kpis" DROP COLUMN "version";
    `);
  }
}
