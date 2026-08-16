import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateBudgetTransactions1704067520000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // K-2.6.13(c) — koşullu şema yaratma (tam gerekçe:
    // CreateTenants1704067200000, aynı görev). `CREATE SCHEMA IF NOT EXISTS`
    // PostgreSQL'de DATABASE-düzeyi CREATE iznini şemanın var olup
    // olmadığına BAKMADAN denetler; DDL-yetkili rol yalnız şema-içi CREATE alır
    // (KARAR 2, scripts/db-roles/01-roles-and-ownership.sql). Sonuç aynı
    // kalır — yalnız izin denetimi şema zaten varken yolun dışına çıkar.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT FROM pg_namespace WHERE nspname = 'main'
        ) THEN
          EXECUTE 'CREATE SCHEMA main';
        END IF;
      END $$;
    `);

    // Create enum types if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_transactions_tx_type_enum" AS ENUM('ALLOCATE', 'COMMIT', 'RESERVE', 'RELEASE', 'TRANSFER', 'ADJUST');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_transactions_tx_status_enum" AS ENUM('PENDING', 'POSTED', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_transactions_source_type_enum" AS ENUM('AGREEMENT', 'PLAN', 'MANUAL', 'TRANSFER', 'ADJUSTMENT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'budget_transactions',
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
            name: 'envelope_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'tx_type',
            type: 'enum',
            enum: [
              'ALLOCATE',
              'COMMIT',
              'RESERVE',
              'RELEASE',
              'TRANSFER',
              'ADJUST',
            ],
            enumName: 'budget_transactions_tx_type_enum',
            isNullable: false,
          },
          {
            name: 'tx_status',
            type: 'enum',
            enum: ['PENDING', 'POSTED', 'CANCELLED'],
            enumName: 'budget_transactions_tx_status_enum',
            default: "'POSTED'",
            isNullable: false,
          },
          {
            name: 'source_type',
            type: 'enum',
            enum: ['AGREEMENT', 'PLAN', 'MANUAL', 'TRANSFER', 'ADJUSTMENT'],
            enumName: 'budget_transactions_source_type_enum',
            isNullable: true,
          },
          {
            name: 'source_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '3',
            default: "'TRY'",
            isNullable: false,
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
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
            onUpdate: 'CURRENT_TIMESTAMP',
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
      'main.budget_transactions',
      new TableIndex({
        name: 'IDX_BUDGET_TRANSACTIONS_TENANT_IDEMPOTENCY',
        columnNames: ['tenant_id', 'idempotency_key'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.budget_transactions',
      new TableIndex({
        name: 'IDX_BUDGET_TRANSACTIONS_TENANT_ENVELOPE_TYPE',
        columnNames: ['tenant_id', 'envelope_id', 'tx_type'],
      }),
    );

    await queryRunner.createIndex(
      'main.budget_transactions',
      new TableIndex({
        name: 'IDX_BUDGET_TRANSACTIONS_TENANT_SOURCE',
        columnNames: ['tenant_id', 'source_type', 'source_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.budget_transactions',
      new TableIndex({
        name: 'IDX_BUDGET_TRANSACTIONS_TENANT_TYPE_STATUS',
        columnNames: ['tenant_id', 'tx_type', 'tx_status'],
      }),
    );

    // Foreign keys
    await queryRunner.createForeignKey(
      'main.budget_transactions',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.budget_transactions',
      new TableForeignKey({
        columnNames: ['envelope_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.budget_envelopes',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.budget_transactions', true);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_transactions_tx_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_transactions_tx_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_transactions_source_type_enum"`,
    );
  }
}
