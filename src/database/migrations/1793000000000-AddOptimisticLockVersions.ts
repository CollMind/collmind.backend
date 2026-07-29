import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-034 — Optimistic locking (BRD "eş zamanlı düzenleme"): manual
 * `version integer` + compare-and-swap, NOT `@VersionColumn` (see
 * docs/analysis/0005-optimistic-locking-design.md K1 — every mutation on
 * these 4 tables goes through `repo.update()`/`queryRunner.manager.update()`,
 * which `@VersionColumn` never checks or bumps).
 *
 * `DEFAULT 1` → no backfill needed, existing rows become version=1.
 * Postgres 11+ non-volatile default → `ADD COLUMN` does not rewrite the
 * table, so lock time on large tables (e.g. `plan_skus`) stays short.
 *
 * Scope is deliberately limited to the 4 tables whose mutations are
 * user-input-driven and CAS-protected in this task (plans/plan_fus/
 * plan_skus/agreements). Append-only tables (ledger_entries,
 * budget_transactions, agreement_transactions, plan_approval_history,
 * admin_audit_logs, notifications, on_invoice_*, sales_actuals) are
 * explicitly OUT of scope — a version column there would falsely imply an
 * UPDATE path exists (BRD audit-immutability).
 */
export class AddOptimisticLockVersions1793000000000 implements MigrationInterface {
  name = 'AddOptimisticLockVersions1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."plans" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plan_fus" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plan_skus" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."agreements" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."plans" DROP COLUMN "version";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plan_fus" DROP COLUMN "version";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."plan_skus" DROP COLUMN "version";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."agreements" DROP COLUMN "version";
    `);
  }
}
