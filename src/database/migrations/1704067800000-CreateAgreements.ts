import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateAgreements1704067800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create schema if not exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    // Create enum types if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."agreements_agreement_type_enum" AS ENUM('STA', 'LTA');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."agreements_agreement_status_enum" AS ENUM('DRAFT', 'PENDING', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."agreements_spend_type_enum" AS ENUM('ON_INVOICE', 'OFF_INVOICE', 'BOTH');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."agreements_mechanic_type_enum" AS ENUM('PERCENT', 'AMOUNT', 'AMOUNT_PER_UNIT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'agreements',
        schema: 'main',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'tenant_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'agreement_code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'agreement_name',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'agreement_type',
            type: 'enum',
            enum: ['STA', 'LTA'],
            enumName: 'agreements_agreement_type_enum',
            isNullable: false,
          },
          {
            name: 'cpl_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'channel',
            type: 'varchar',
            length: '30',
            isNullable: false,
          },
          {
            name: 'region_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'gu_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'fu_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'sku_scope',
            type: 'varchar',
            length: '20',
            default: "'FU'",
            isNullable: false,
          },
          {
            name: 'tactic_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'mechanic_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'mechanic_value',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'mechanic_type',
            type: 'enum',
            enum: ['PERCENT', 'AMOUNT', 'AMOUNT_PER_UNIT'],
            enumName: 'agreements_mechanic_type_enum',
            isNullable: true,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '3',
            default: "'TRY'",
            isNullable: false,
          },
          {
            name: 'cap_total_amount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'spend_type',
            type: 'enum',
            enum: ['ON_INVOICE', 'OFF_INVOICE', 'BOTH'],
            enumName: 'agreements_spend_type_enum',
            isNullable: true,
          },
          {
            name: 'start_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'end_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'period_month',
            type: 'varchar',
            length: '7',
            isNullable: false,
          },
          {
            name: 'justification',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['DRAFT', 'PENDING', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED'],
            enumName: 'agreements_agreement_status_enum',
            default: "'DRAFT'",
            isNullable: false,
          },
          {
            name: 'approval_request_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'approved_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'approved_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'rejected_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejected_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'rejection_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'consumed_amount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: '0',
            isNullable: false,
          },
          {
            name: 'current_price',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'expected_price',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'competitor_price',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'competitor_name',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'updated_by',
            type: 'uuid',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Indexes
    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_TENANT_CODE',
        columnNames: ['tenant_id', 'agreement_code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_CPL_ID',
        columnNames: ['cpl_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_CHANNEL',
        columnNames: ['channel'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_PERIOD_MONTH',
        columnNames: ['period_month'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_TENANT_CPL_STATUS',
        columnNames: ['tenant_id', 'cpl_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreements',
      new TableIndex({
        name: 'IDX_AGREEMENTS_TENANT_PERIOD_STATUS',
        columnNames: ['tenant_id', 'period_month', 'status'],
      }),
    );

    // Partial index on approval_request_id (where not null)
    await queryRunner.query(`
      CREATE INDEX "IDX_AGREEMENTS_APPROVAL_REQUEST_ID" 
      ON "main"."agreements" ("approval_request_id") 
      WHERE "approval_request_id" IS NOT NULL;
    `);

    // Foreign keys
    await queryRunner.createForeignKey(
      'main.agreements',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreements',
      new TableForeignKey({
        columnNames: ['cpl_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.customers',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreements',
      new TableForeignKey({
        columnNames: ['approved_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreements',
      new TableForeignKey({
        columnNames: ['rejected_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreements',
      new TableForeignKey({
        columnNames: ['created_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreements',
      new TableForeignKey({
        columnNames: ['updated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop partial index explicitly (created with raw SQL)
    await queryRunner.query(`DROP INDEX IF EXISTS "main"."IDX_AGREEMENTS_APPROVAL_REQUEST_ID"`);
    await queryRunner.dropTable('main.agreements', true);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."agreements_agreement_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."agreements_agreement_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."agreements_spend_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."agreements_mechanic_type_enum"`);
  }
}


