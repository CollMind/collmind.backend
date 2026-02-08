import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMissingFieldsToAgreements1704067900000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create reconciliation_period enum if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."agreements_reconciliation_period_enum" AS ENUM('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add description column
    await queryRunner.addColumn(
      'main.agreements',
      new TableColumn({
        name: 'description',
        type: 'text',
        isNullable: true,
      }),
    );

    // Add category_id column
    await queryRunner.addColumn(
      'main.agreements',
      new TableColumn({
        name: 'category_id',
        type: 'uuid',
        isNullable: true,
      }),
    );

    // Add reconciliation_period column
    await queryRunner.addColumn(
      'main.agreements',
      new TableColumn({
        name: 'reconciliation_period',
        type: 'enum',
        enum: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'],
        enumName: 'agreements_reconciliation_period_enum',
        isNullable: true,
      }),
    );

    // Add notes column
    await queryRunner.addColumn(
      'main.agreements',
      new TableColumn({
        name: 'notes',
        type: 'text',
        isNullable: true,
      }),
    );

    // Add index for category_id
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agreements_category_id" 
      ON "main"."agreements" ("category_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove index
    await queryRunner.query(`
      DROP INDEX IF EXISTS "main"."IDX_agreements_category_id";
    `);

    // Remove columns
    await queryRunner.dropColumn('main.agreements', 'notes');
    await queryRunner.dropColumn('main.agreements', 'reconciliation_period');
    await queryRunner.dropColumn('main.agreements', 'category_id');
    await queryRunner.dropColumn('main.agreements', 'description');

    // Drop enum type
    await queryRunner.query(`
      DROP TYPE IF EXISTS "main"."agreements_reconciliation_period_enum";
    `);
  }
}
