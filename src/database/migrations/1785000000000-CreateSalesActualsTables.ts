import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

/**
 * T-020 — Sales Actuals (satış gerçekleşen) tabloları.
 *
 * ⚠️ LEDGER/BÜTÇE SINIRI: Bu migration `main.v_budget_summary` view DDL'ine
 * DOKUNMAZ. Yeni tablolarda `budget_envelope_id`/`ledger_entry_id`/
 * `agreement_id` kolonu YOKTUR — actuals satış cirosudur, harcama değildir.
 * Bkz. docs/analysis/0002-actuals-port-design.md §4.
 */
export class CreateSalesActualsTables1785000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."sales_actual_batches_status_enum" AS ENUM('ACTIVE', 'REPLACED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."sales_actual_batches_source_type_enum" AS ENUM('FILE_UPLOAD', 'SEED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // ── sales_actual_batches ────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'sales_actual_batches',
        schema: 'main',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'tenant_id', type: 'uuid', isNullable: false },
          {
            name: 'fiscal_period',
            type: 'varchar',
            length: '7',
            isNullable: false,
          },
          { name: 'cpl_id', type: 'uuid', isNullable: false },
          { name: 'category_id', type: 'uuid', isNullable: false },
          { name: 'channel_id', type: 'uuid', isNullable: false },
          {
            name: 'status',
            type: 'enum',
            enumName: 'sales_actual_batches_status_enum',
            default: "'ACTIVE'",
            isNullable: false,
          },
          {
            name: 'source_type',
            type: 'enum',
            enumName: 'sales_actual_batches_source_type_enum',
            default: "'FILE_UPLOAD'",
            isNullable: false,
          },
          {
            name: 'file_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'file_hash', type: 'char', length: '64', isNullable: false },
          { name: 'total_rows', type: 'int', default: 0, isNullable: false },
          { name: 'valid_rows', type: 'int', default: 0, isNullable: false },
          { name: 'error_rows', type: 'int', default: 0, isNullable: false },
          {
            name: 'gross_total',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'net_total',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'discount_total',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          { name: 'replaced_by_batch_id', type: 'uuid', isNullable: true },
          { name: 'replaced_at', type: 'timestamptz', isNullable: true },
          { name: 'validation_summary', type: 'jsonb', isNullable: true },
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
          { name: 'deleted_at', type: 'timestamp', isNullable: true },
          { name: 'created_by', type: 'uuid', isNullable: true },
          { name: 'updated_by', type: 'uuid', isNullable: true },
        ],
      }),
      true,
    );

    // ── sales_actuals ────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'sales_actuals',
        schema: 'main',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'tenant_id', type: 'uuid', isNullable: false },
          { name: 'batch_id', type: 'uuid', isNullable: false },
          {
            name: 'fiscal_period',
            type: 'varchar',
            length: '7',
            isNullable: false,
          },
          { name: 'cpl_id', type: 'uuid', isNullable: false },
          { name: 'category_id', type: 'uuid', isNullable: false },
          { name: 'channel_id', type: 'uuid', isNullable: false },
          {
            name: 'cpl_code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'category_name',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'channel_code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'gross_amount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'net_amount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'discount_amount',
            type: 'decimal',
            precision: 18,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '3',
            default: "'TRY'",
            isNullable: false,
          },
          { name: 'source_row_number', type: 'int', isNullable: false },
          { name: 'raw_row', type: 'jsonb', isNullable: false },
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
          { name: 'deleted_at', type: 'timestamp', isNullable: true },
          { name: 'created_by', type: 'uuid', isNullable: true },
          { name: 'updated_by', type: 'uuid', isNullable: true },
        ],
      }),
      true,
    );

    // ── Indexes ──────────────────────────────────────────────────────────
    // Scope başına tek ACTIVE batch — DB garantisi (TTM'de yoktu, replacement
    // race condition'ında partial unique 23505 -> 409 Conflict'e çevrilir)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_sales_actual_batches_active_scope"
      ON "main"."sales_actual_batches" ("tenant_id", "fiscal_period", "cpl_id", "category_id", "channel_id")
      WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL
    `);

    await queryRunner.createIndex(
      'main.sales_actual_batches',
      new TableIndex({
        name: 'ix_sab_tenant_period',
        columnNames: ['tenant_id', 'fiscal_period'],
      }),
    );

    await queryRunner.createIndex(
      'main.sales_actual_batches',
      new TableIndex({
        name: 'ix_sab_tenant_status',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.sales_actuals',
      new TableIndex({
        name: 'ix_sa_tenant_batch',
        columnNames: ['tenant_id', 'batch_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.sales_actuals',
      new TableIndex({
        name: 'ix_sa_tenant_dims',
        columnNames: [
          'tenant_id',
          'fiscal_period',
          'cpl_id',
          'category_id',
          'channel_id',
        ],
      }),
    );

    // ── Foreign keys ─────────────────────────────────────────────────────
    await queryRunner.createForeignKey(
      'main.sales_actual_batches',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actual_batches',
      new TableForeignKey({
        columnNames: ['cpl_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.cpls',
        onDelete: 'RESTRICT',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actual_batches',
      new TableForeignKey({
        columnNames: ['category_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.categories',
        onDelete: 'RESTRICT',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actual_batches',
      new TableForeignKey({
        columnNames: ['channel_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.channels',
        onDelete: 'RESTRICT',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actual_batches',
      new TableForeignKey({
        columnNames: ['replaced_by_batch_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.sales_actual_batches',
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actual_batches',
      new TableForeignKey({
        columnNames: ['created_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actual_batches',
      new TableForeignKey({
        columnNames: ['updated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.sales_actuals',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actuals',
      new TableForeignKey({
        columnNames: ['batch_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.sales_actual_batches',
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actuals',
      new TableForeignKey({
        columnNames: ['created_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'main.sales_actuals',
      new TableForeignKey({
        columnNames: ['updated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rowsTable = await queryRunner.getTable('main.sales_actuals');
    if (rowsTable) {
      for (const fk of rowsTable.foreignKeys) {
        await queryRunner.dropForeignKey('main.sales_actuals', fk);
      }
    }
    const batchesTable = await queryRunner.getTable(
      'main.sales_actual_batches',
    );
    if (batchesTable) {
      for (const fk of batchesTable.foreignKeys) {
        await queryRunner.dropForeignKey('main.sales_actual_batches', fk);
      }
    }

    await queryRunner.dropTable('main.sales_actuals', true);
    await queryRunner.dropTable('main.sales_actual_batches', true);

    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."sales_actual_batches_source_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."sales_actual_batches_status_enum"`,
    );
  }
}
