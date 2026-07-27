/**
 * T-027 — KPI eksik-veri kuralını BRD'ye getir (COGS null → ROI %100/GREEN
 * yanılsamasını bitir).
 *
 * `plan_skus.planned_gp` ve `plan_skus.planned_turnover` kolonları NOT NULL
 * (default 0) idi. KPI engine'in dependency-null propagation'ı (formula-parser
 * içinde: bir bağımlılık null ise sonuç null) zaten PLANNED_GP/GP_ROI_PCT'i
 * eksik master data (örn. SKU'da COGS yok) durumunda null üretiyordu, ama bu
 * null'lar NOT NULL kolonlara yazılamadığı için `plan.service.ts` onları
 * sessizce 0'a çeviriyordu (veya `undefined` ile update'i atlayıp eski
 * (stale) değeri bırakıyordu) — bu da GP_ROI_PCT = %100 / RAG = GREEN gibi
 * yanıltıcı bir "mükemmel skor" yanılsaması yaratıyordu.
 *
 * up(): `planned_gp` ve `planned_turnover` kolonlarını nullable yapar
 *       (default 0 korunur — mevcut satırlar ve yeni INSERT'ler etkilenmez;
 *       yalnızca recalc artık bu alanlara açıkça NULL yazabilir).
 * down(): kolonları tekrar NOT NULL yapar (varsa NULL değerleri 0'a çevirir).
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakePlanGpFieldsNullable1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."plan_skus"
      ALTER COLUMN "planned_gp" DROP NOT NULL,
      ALTER COLUMN "planned_turnover" DROP NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "main"."plan_skus" SET "planned_gp" = 0 WHERE "planned_gp" IS NULL;
      UPDATE "main"."plan_skus" SET "planned_turnover" = 0 WHERE "planned_turnover" IS NULL;
      ALTER TABLE "main"."plan_skus"
      ALTER COLUMN "planned_gp" SET NOT NULL,
      ALTER COLUMN "planned_turnover" SET NOT NULL;
    `);
  }
}
