import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManagerAndReadonlyRoles1775000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add enum values outside any transaction so they're committed immediately
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'MANAGER';
    `);
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'READONLY';
    `);

    // Now safe to use the new enum values in a separate transaction
    await queryRunner.startTransaction();
    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'MANAGER'
      WHERE role = 'APPROVER';
    `);
    await queryRunner.commitTransaction();
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
        'MANAGER and READONLY enum values remain in DB — this is expected PostgreSQL behavior.',
    );
  }
}
