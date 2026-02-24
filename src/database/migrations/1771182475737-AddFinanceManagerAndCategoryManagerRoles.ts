import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFinanceManagerAndCategoryManagerRoles1771182475737 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add FINANCE_MANAGER to users_role_enum
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'FINANCE_MANAGER';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add CATEGORY_MANAGER to users_role_enum
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'CATEGORY_MANAGER';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL does not support removing enum values directly
    // To rollback, you would need to:
    // 1. Create a new enum with the old values
    // 2. Update the column to use the new enum
    // 3. Drop the old enum
    // This is complex and not recommended for production
    // Instead, we'll just log a warning
    console.warn('⚠️  Cannot remove enum values in PostgreSQL. Manual rollback required if needed.');
  }
}
