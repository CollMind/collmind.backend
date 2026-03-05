import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManagerAndReadonlyRoles1775000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add MANAGER to enum
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'MANAGER';
    `);

    // Add READONLY to enum
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'READONLY';
    `);

    // Migrate existing APPROVER users to MANAGER
    // Note: Must run in separate transaction after enum value is committed
    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'MANAGER'
      WHERE role = 'APPROVER';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert MANAGER users back to APPROVER
    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'APPROVER'
      WHERE role = 'MANAGER';
    `);
    // NOTE: PostgreSQL does not support removing enum values.
    // MANAGER and READONLY remain in the enum type after rollback.
    // Manual cleanup requires creating a new enum type if needed.
    console.warn(
      '⚠️  down() complete: MANAGER users reverted to APPROVER. ' +
      'MANAGER and READONLY enum values remain in DB — this is expected PostgreSQL behavior.'
    );
  }
}
