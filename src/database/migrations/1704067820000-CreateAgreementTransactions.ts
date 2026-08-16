import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateAgreementTransactions1704067820000 implements MigrationInterface {
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

    await queryRunner.createTable(
      new Table({
        name: 'agreement_transactions',
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
            name: 'agreement_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'invoice_no',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'invoice_date',
            type: 'date',
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
            name: 'cpl_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'batch_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'row_number',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '200',
            isNullable: false,
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
      'main.agreement_transactions',
      new TableIndex({
        name: 'IDX_AGREEMENT_TRANSACTIONS_TENANT_IDEMPOTENCY',
        columnNames: ['tenant_id', 'idempotency_key'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.agreement_transactions',
      new TableIndex({
        name: 'IDX_AGREEMENT_TRANSACTIONS_AGREEMENT_ID',
        columnNames: ['agreement_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreement_transactions',
      new TableIndex({
        name: 'IDX_AGREEMENT_TRANSACTIONS_BATCH_ID',
        columnNames: ['batch_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreement_transactions',
      new TableIndex({
        name: 'IDX_AGREEMENT_TRANSACTIONS_INVOICE_DATE',
        columnNames: ['invoice_date'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreement_transactions',
      new TableIndex({
        name: 'IDX_AGREEMENT_TRANSACTIONS_TENANT_AGREEMENT',
        columnNames: ['tenant_id', 'agreement_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.agreement_transactions',
      new TableIndex({
        name: 'IDX_AGREEMENT_TRANSACTIONS_TENANT_INVOICE',
        columnNames: ['tenant_id', 'invoice_no', 'invoice_date'],
      }),
    );

    // Foreign keys
    await queryRunner.createForeignKey(
      'main.agreement_transactions',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreement_transactions',
      new TableForeignKey({
        columnNames: ['agreement_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.agreements',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreement_transactions',
      new TableForeignKey({
        columnNames: ['cpl_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.customers',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreement_transactions',
      new TableForeignKey({
        columnNames: ['created_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.agreement_transactions',
      new TableForeignKey({
        columnNames: ['updated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.agreement_transactions', true);
  }
}
