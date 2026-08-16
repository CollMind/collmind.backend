import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateLedgerEntries1704067540000 implements MigrationInterface {
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
        CREATE TYPE "main"."ledger_entries_entry_direction_enum" AS ENUM('DEBIT', 'CREDIT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."ledger_entries_spend_type_enum" AS ENUM('ON_INVOICE', 'OFF_INVOICE', 'ADJUSTMENT', 'ACCRUAL');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'ledger_entries',
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
            name: 'source_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'source_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'agreement_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'spend_type',
            type: 'enum',
            enum: ['ON_INVOICE', 'OFF_INVOICE', 'ADJUSTMENT', 'ACCRUAL'],
            enumName: 'ledger_entries_spend_type_enum',
            isNullable: false,
          },
          {
            name: 'entry_direction',
            type: 'enum',
            enum: ['DEBIT', 'CREDIT'],
            enumName: 'ledger_entries_entry_direction_enum',
            default: "'DEBIT'",
            isNullable: false,
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
            name: 'period_month',
            type: 'varchar',
            length: '7',
            isNullable: false,
          },
          {
            name: 'posting_date',
            type: 'date',
            isNullable: false,
          },
          {
            name: 'channel',
            type: 'varchar',
            length: '30',
            isNullable: true,
          },
          {
            name: 'cpl_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'fu_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'tactic_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'mechanic_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'budget_envelope_id',
            type: 'uuid',
            isNullable: true,
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
      'main.ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_ENTRIES_TENANT_IDEMPOTENCY',
        columnNames: ['tenant_id', 'idempotency_key'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_ENTRIES_TENANT_AGREEMENT',
        columnNames: ['tenant_id', 'agreement_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_ENTRIES_TENANT_ENVELOPE',
        columnNames: ['tenant_id', 'budget_envelope_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_ENTRIES_TENANT_PERIOD',
        columnNames: ['tenant_id', 'period_month'],
      }),
    );

    await queryRunner.createIndex(
      'main.ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_ENTRIES_TENANT_SPEND_TYPE',
        columnNames: ['tenant_id', 'spend_type'],
      }),
    );

    // Foreign keys
    await queryRunner.createForeignKey(
      'main.ledger_entries',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.ledger_entries',
      new TableForeignKey({
        columnNames: ['budget_envelope_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.budget_envelopes',
        onDelete: 'SET NULL',
      }),
    );

    // Note: agreement_id and cpl_id foreign keys will be added when those tables exist
    // For now, we'll skip them to avoid dependency issues
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.ledger_entries', true);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."ledger_entries_entry_direction_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."ledger_entries_spend_type_enum"`,
    );
  }
}
