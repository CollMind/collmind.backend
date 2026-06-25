/**
 * T-012 — Budget/RAG threshold'larını config-driven yap
 *
 * budget_alert_configurations tablosuna threshold_percent (decimal 5,2 NOT NULL)
 * kolonu ekler. Backfill: alertLevel enum değerine göre 80/95/100 atar.
 * down(): kolonu kaldırır.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThresholdPercentToBudgetAlertConfig1783000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Kolonu DEFAULT ile ekle (NOT NULL constraint geçici DEFAULT gerektirir)
    await queryRunner.query(`
      ALTER TABLE "main"."budget_alert_configurations"
      ADD COLUMN IF NOT EXISTS "threshold_percent" DECIMAL(5, 2) NOT NULL DEFAULT 0;
    `);

    // 2. Backfill: alertLevel'a göre doğru değerleri ata
    await queryRunner.query(`
      UPDATE "main"."budget_alert_configurations"
      SET "threshold_percent" = 80
      WHERE "alert_level" = 'warning_80';
    `);

    await queryRunner.query(`
      UPDATE "main"."budget_alert_configurations"
      SET "threshold_percent" = 95
      WHERE "alert_level" = 'critical_95';
    `);

    await queryRunner.query(`
      UPDATE "main"."budget_alert_configurations"
      SET "threshold_percent" = 100
      WHERE "alert_level" = 'exceeded_100';
    `);

    // 3. Geçici DEFAULT'u kaldır (NOT NULL kalsın)
    await queryRunner.query(`
      ALTER TABLE "main"."budget_alert_configurations"
      ALTER COLUMN "threshold_percent" DROP DEFAULT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."budget_alert_configurations"
      DROP COLUMN IF EXISTS "threshold_percent";
    `);
  }
}
