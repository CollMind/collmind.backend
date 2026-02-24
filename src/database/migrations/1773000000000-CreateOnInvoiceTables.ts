import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateOnInvoiceTables1773000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create schema if not exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."on_invoice_batch_status_enum" AS ENUM('PENDING', 'VALIDATING', 'VALIDATED', 'PROCESSING', 'COMPLETED', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."on_invoice_discount_type_enum" AS ENUM('CPP_ON', 'LTA_ON', 'PROMO_DISCOUNT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."on_invoice_entry_status_enum" AS ENUM('PENDING', 'VALIDATED', 'POSTED', 'ERROR');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create on_invoice_batches table
    await queryRunner.createTable(
      new Table({
        name: 'on_invoice_batches',
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
            name: 'batch_code',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enumName: 'on_invoice_batch_status_enum',
            default: "'PENDING'",
            isNullable: false,
          },
          {
            name: 'fiscal_period',
            type: 'varchar',
            length: '7',
            isNullable: false,
          },
          {
            name: 'total_rows',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'valid_rows',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'error_rows',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'total_discount_amount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'affected_envelopes_count',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'file_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'file_size',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'validation_summary',
            type: 'jsonb',
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

    // Create on_invoice_entries table
    await queryRunner.createTable(
      new Table({
        name: 'on_invoice_entries',
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
            name: 'batch_id',
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
            name: 'fiscal_period',
            type: 'varchar',
            length: '7',
            isNullable: false,
          },
          {
            name: 'customer_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'customer_code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'sku_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'sku_code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'quantity',
            type: 'decimal',
            precision: 18,
            scale: 3,
            isNullable: false,
          },
          {
            name: 'list_price',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'actual_price',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'discount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'discount_type',
            type: 'enum',
            enumName: 'on_invoice_discount_type_enum',
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
            name: 'status',
            type: 'enum',
            enumName: 'on_invoice_entry_status_enum',
            default: "'PENDING'",
            isNullable: false,
          },
          {
            name: 'validation_status',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'validation_errors',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'row_number',
            type: 'int',
            isNullable: false,
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

    // Indexes for on_invoice_batches
    await queryRunner.createIndex(
      'main.on_invoice_batches',
      new TableIndex({
        name: 'IDX_ON_INVOICE_BATCHES_TENANT_BATCH_CODE',
        columnNames: ['tenant_id', 'batch_code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_batches',
      new TableIndex({
        name: 'IDX_ON_INVOICE_BATCHES_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_batches',
      new TableIndex({
        name: 'IDX_ON_INVOICE_BATCHES_TENANT_FISCAL_PERIOD',
        columnNames: ['tenant_id', 'fiscal_period'],
      }),
    );

    // Indexes for on_invoice_entries
    await queryRunner.createIndex(
      'main.on_invoice_entries',
      new TableIndex({
        name: 'IDX_ON_INVOICE_ENTRIES_TENANT_IDEMPOTENCY',
        columnNames: ['tenant_id', 'idempotency_key'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_entries',
      new TableIndex({
        name: 'IDX_ON_INVOICE_ENTRIES_TENANT_BATCH_ID',
        columnNames: ['tenant_id', 'batch_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_entries',
      new TableIndex({
        name: 'IDX_ON_INVOICE_ENTRIES_TENANT_CUSTOMER_ID',
        columnNames: ['tenant_id', 'customer_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_entries',
      new TableIndex({
        name: 'IDX_ON_INVOICE_ENTRIES_TENANT_SKU_ID',
        columnNames: ['tenant_id', 'sku_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_entries',
      new TableIndex({
        name: 'IDX_ON_INVOICE_ENTRIES_TENANT_INVOICE',
        columnNames: ['tenant_id', 'invoice_no', 'invoice_date'],
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_entries',
      new TableIndex({
        name: 'IDX_ON_INVOICE_ENTRIES_TENANT_FISCAL_PERIOD',
        columnNames: ['tenant_id', 'fiscal_period'],
      }),
    );

    await queryRunner.createIndex(
      'main.on_invoice_entries',
      new TableIndex({
        name: 'IDX_ON_INVOICE_ENTRIES_TENANT_DISCOUNT_TYPE',
        columnNames: ['tenant_id', 'discount_type'],
      }),
    );

    // Foreign keys for on_invoice_batches
    await queryRunner.createForeignKey(
      'main.on_invoice_batches',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_batches',
      new TableForeignKey({
        columnNames: ['created_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_batches',
      new TableForeignKey({
        columnNames: ['updated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    // Foreign keys for on_invoice_entries
    await queryRunner.createForeignKey(
      'main.on_invoice_entries',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_entries',
      new TableForeignKey({
        columnNames: ['batch_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.on_invoice_batches',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_entries',
      new TableForeignKey({
        columnNames: ['customer_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.customers',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_entries',
      new TableForeignKey({
        columnNames: ['sku_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.skus',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_entries',
      new TableForeignKey({
        columnNames: ['budget_envelope_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.budget_envelopes',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_entries',
      new TableForeignKey({
        columnNames: ['created_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.on_invoice_entries',
      new TableForeignKey({
        columnNames: ['updated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    const entriesTable = await queryRunner.getTable('main.on_invoice_entries');
    if (entriesTable) {
      const foreignKeys = entriesTable.foreignKeys;
      for (const fk of foreignKeys) {
        await queryRunner.dropForeignKey('main.on_invoice_entries', fk);
      }
    }

    const batchesTable = await queryRunner.getTable('main.on_invoice_batches');
    if (batchesTable) {
      const foreignKeys = batchesTable.foreignKeys;
      for (const fk of foreignKeys) {
        await queryRunner.dropForeignKey('main.on_invoice_batches', fk);
      }
    }

    // Drop tables
    await queryRunner.dropTable('main.on_invoice_entries', true);
    await queryRunner.dropTable('main.on_invoice_batches', true);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."on_invoice_entry_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."on_invoice_discount_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."on_invoice_batch_status_enum"`);
  }
}
