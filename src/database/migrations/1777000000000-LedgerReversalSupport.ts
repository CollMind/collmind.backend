import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reversal desteği: ledger_entries ve agreement_transactions tablolarına
 * is_reversed / reverses_entry_id sütunları + çift-reversal engeli (partial unique index).
 *
 * transaction = false: partial unique index CREATE CONCURRENT değil, fakat enum
 * alterasyonu gibi DDL için yine de transaction dışı çalıştırıyoruz.
 */
export class LedgerReversalSupport1777000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) ledger_entries: reverses_entry_id (self-FK)
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
        ADD COLUMN IF NOT EXISTS "reverses_entry_id" uuid NULL;
    `);

    // 2) ledger_entries: is_reversed flag
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
        ADD COLUMN IF NOT EXISTS "is_reversed" boolean NOT NULL DEFAULT false;
    `);

    // 3) Self-FK — idempotent via pg_constraint check
    const fkRows = (await queryRunner.query(`
      SELECT c.conname FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conname = 'FK_ledger_entries_reverses_entry'
        AND n.nspname = 'main'
      LIMIT 1
    `)) as Array<{ conname: string }>;

    if (fkRows.length === 0) {
      await queryRunner.query(`
        ALTER TABLE "main"."ledger_entries"
          ADD CONSTRAINT "FK_ledger_entries_reverses_entry"
          FOREIGN KEY ("reverses_entry_id")
          REFERENCES "main"."ledger_entries"("id")
          ON DELETE NO ACTION ON UPDATE NO ACTION;
      `);
    }

    // 4) Partial unique index: çift-reversal'ı DB düzeyinde engelle
    const uqRows = (await queryRunner.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'main'
        AND indexname = 'UQ_ledger_entries_reversal_per_tenant'
      LIMIT 1
    `)) as Array<{ indexname: string }>;

    if (uqRows.length === 0) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "UQ_ledger_entries_reversal_per_tenant"
          ON "main"."ledger_entries" ("tenant_id", "reverses_entry_id")
          WHERE "reverses_entry_id" IS NOT NULL;
      `);
    }

    // 5) agreement_transactions: is_reversed flag
    await queryRunner.query(`
      ALTER TABLE "main"."agreement_transactions"
        ADD COLUMN IF NOT EXISTS "is_reversed" boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "main"."UQ_ledger_entries_reversal_per_tenant";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
        DROP CONSTRAINT IF EXISTS "FK_ledger_entries_reverses_entry";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
        DROP COLUMN IF EXISTS "is_reversed";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."ledger_entries"
        DROP COLUMN IF EXISTS "reverses_entry_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."agreement_transactions"
        DROP COLUMN IF EXISTS "is_reversed";
    `);
  }
}
