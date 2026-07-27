/**
 * T-026 (D-1 follow-up) — Şema kayması düzeltmesi.
 *
 * `PlanApprovalHistory` entity `BaseEntity`'den `createdBy`/`updatedBy`
 * (`created_by`/`updated_by`, uuid, nullable) kolonlarını miras alıyor, ancak
 * `main.plan_approval_history` tablosunu oluşturan migration
 * (1772000000000-AddApprovalWorkflowFieldsToPlans.ts) bu kolonları hiç
 * eklememişti. D-1 fix'i (PlanApprovalHistory'nin merkezi DataSource entity
 * listelerine eklenmesi) sonrası bu kayma açığa çıktı: `createHistoryEntry`
 * artık entity metadata'sını buluyor ama INSERT "column \"created_by\" of
 * relation \"plan_approval_history\" does not exist" ile patlıyor — submit/
 * approve/reject/requestChanges/escalate akışlarının hepsini etkiler.
 *
 * up(): eksik kolonları ekler (nullable, mevcut satırlar etkilenmez).
 * down(): kolonları kaldırır.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedByUpdatedByToPlanApprovalHistory1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."plan_approval_history"
      ADD COLUMN IF NOT EXISTS "created_by" uuid NULL,
      ADD COLUMN IF NOT EXISTS "updated_by" uuid NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."plan_approval_history"
      DROP COLUMN IF EXISTS "created_by",
      DROP COLUMN IF EXISTS "updated_by";
    `);
  }
}
