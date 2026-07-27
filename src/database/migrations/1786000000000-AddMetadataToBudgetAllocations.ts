/**
 * T-026 (D-3) — Şema kayması düzeltmesi.
 *
 * `BudgetAllocation` entity'sinde (src/database/entities/budget-allocation.entity.ts)
 * `metadata` jsonb kolonu tanımlı olmasına rağmen `main.budget_allocations` tablosunda
 * bu kolon yoktu. TypeORM entity metadata ile fiziksel şema uyuşmadığından
 * `GET /finance-reporting/budget-utilization` (ve metadata okuyan/yazan diğer sorgular)
 * 500 ile patlıyordu (role-journey A13b).
 *
 * up(): kolonu ekler (nullable, mevcut satırlar etkilenmez).
 * down(): kolonu kaldırır.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetadataToBudgetAllocations1786000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."budget_allocations"
      ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."budget_allocations"
      DROP COLUMN IF EXISTS "metadata";
    `);
  }
}
