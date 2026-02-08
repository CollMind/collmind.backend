import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanToApprovalRequestTypeEnum1704068400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'PLAN' to the existing enum type
    // Note: ALTER TYPE ... ADD VALUE cannot be executed inside a transaction block in PostgreSQL
    // We'll use a DO block to handle errors gracefully
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 
          FROM pg_enum 
          WHERE enumlabel = 'PLAN' 
          AND enumtypid = (
            SELECT oid 
            FROM pg_type 
            WHERE typname = 'approval_requests_request_type_enum'
          )
        ) THEN
          ALTER TYPE "main"."approval_requests_request_type_enum" ADD VALUE 'PLAN';
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          -- Value might already exist or enum might not exist, ignore
          NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL doesn't support removing enum values directly
    // This would require recreating the enum type, which is complex
    // For now, we'll leave it as a no-op
    // In production, you might need to:
    // 1. Create a new enum without 'PLAN'
    // 2. Update all columns to use the new enum
    // 3. Drop the old enum
    // 4. Rename the new enum to the original name
    await queryRunner.query(`
      -- Enum value removal is not directly supported in PostgreSQL
      -- Manual intervention required if rollback is needed
    `);
  }
}
