import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex, TableForeignKey } from 'typeorm';

export class UpdateBudgetAllocationStructure1771169825000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_allocations_period_type_enum" AS ENUM('yearly', 'quarterly', 'monthly');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_transaction_logs_transaction_type_enum" AS ENUM('allocation', 'utilization', 'release', 'adjustment', 'transfer', 'reservation', 'commit');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_alert_configurations_alert_level_enum" AS ENUM('warning_80', 'critical_95', 'exceeded_100');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_alert_configurations_notification_channel_enum" AS ENUM('email', 'in_app', 'sms');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Check if budget_allocations table exists
    const tableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'main' 
        AND table_name = 'budget_allocations'
      );
    `);

    if (tableExists[0].exists) {
      // Drop old foreign key if exists
      const foreignKeys = await queryRunner.query(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_schema = 'main' 
        AND table_name = 'budget_allocations' 
        AND constraint_type = 'FOREIGN KEY'
      `);

      for (const fk of foreignKeys) {
        await queryRunner.query(`ALTER TABLE "main"."budget_allocations" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
      }

      // Drop old columns if they exist
      await queryRunner.query(`
        ALTER TABLE "main"."budget_allocations" 
        DROP COLUMN IF EXISTS "envelope_id",
        DROP COLUMN IF EXISTS "alert_thresholds";
      `);
    } else {
      // Create table if it doesn't exist
      await queryRunner.createTable(
        new Table({
          name: 'budget_allocations',
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
      );
    }

    // Add new columns to budget_allocations
    const columnsToAdd = [
      { name: 'period_type', check: 'period_type', type: 'enum', enumName: 'budget_allocations_period_type_enum' },
      { name: 'period_start', check: 'period_start', type: 'date' },
      { name: 'period_end', check: 'period_end', type: 'date' },
      { name: 'fiscal_year', check: 'fiscal_year', type: 'int' },
      { name: 'cpl_id', check: 'cpl_id', type: 'uuid', nullable: true },
      { name: 'channel', check: 'channel', type: 'varchar', length: '50', nullable: true },
      { name: 'category', check: 'category', type: 'varchar', length: '100', nullable: true },
      { name: 'on_invoice_budget', check: 'on_invoice_budget', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'off_invoice_budget', check: 'off_invoice_budget', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'on_invoice_utilized', check: 'on_invoice_utilized', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'off_invoice_utilized', check: 'off_invoice_utilized', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'on_invoice_reserved', check: 'on_invoice_reserved', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'off_invoice_reserved', check: 'off_invoice_reserved', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'alert_threshold_80', check: 'alert_threshold_80', type: 'boolean', default: true },
      { name: 'alert_threshold_95', check: 'alert_threshold_95', type: 'boolean', default: true },
      { name: 'alert_threshold_100', check: 'alert_threshold_100', type: 'boolean', default: true },
      { name: 'alert_recipients', check: 'alert_recipients', type: 'jsonb', nullable: true },
      { name: 'hard_limit_mode', check: 'hard_limit_mode', type: 'boolean', default: false },
      { name: 'allow_carry_forward', check: 'allow_carry_forward', type: 'boolean', default: false },
    ];

    for (const col of columnsToAdd) {
      const exists = await queryRunner.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'main' 
        AND table_name = 'budget_allocations' 
        AND column_name = '${col.check}'
      `);

      if (exists.length === 0) {
        if (col.type === 'enum') {
          await queryRunner.query(`
            ALTER TABLE "main"."budget_allocations" 
            ADD COLUMN "${col.name}" "main"."${col.enumName}" ${col.nullable ? '' : 'NOT NULL'}
          `);
        } else {
          await queryRunner.addColumn(
            'main.budget_allocations',
            new TableColumn({
              name: col.name,
              type: col.type,
              length: col.length,
              precision: col.precision,
              scale: col.scale,
              isNullable: col.nullable ?? false,
              default: col.default,
            }),
          );
        }
      }
    }

    // Add generated columns (total_budget, on_invoice_available, off_invoice_available)
    const generatedColumns = [
      {
        name: 'total_budget',
        expression: 'on_invoice_budget + off_invoice_budget',
      },
      {
        name: 'on_invoice_available',
        expression: 'on_invoice_budget - on_invoice_utilized - on_invoice_reserved',
      },
      {
        name: 'off_invoice_available',
        expression: 'off_invoice_budget - off_invoice_utilized - off_invoice_reserved',
      },
    ];

    for (const genCol of generatedColumns) {
      const exists = await queryRunner.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'main' 
        AND table_name = 'budget_allocations' 
        AND column_name = '${genCol.name}'
      `);

      if (exists.length === 0) {
        await queryRunner.query(`
          ALTER TABLE "main"."budget_allocations" 
          ADD COLUMN "${genCol.name}" DECIMAL(15,2) GENERATED ALWAYS AS (${genCol.expression}) STORED NOT NULL
        `);
      }
    }

    // Create indexes
    const indexes = [
      {
        name: 'IDX_budget_allocations_tenant_period',
        columns: ['tenant_id', 'period_type', 'period_start', 'period_end', 'cpl_id', 'channel', 'category'],
        unique: true,
      },
      { name: 'IDX_budget_allocations_period_fiscal', columns: ['period_type', 'fiscal_year'] },
      { name: 'IDX_budget_allocations_cpl', columns: ['cpl_id'] },
      { name: 'IDX_budget_allocations_period_dates', columns: ['period_start', 'period_end'] },
    ];

    for (const idx of indexes) {
      const exists = await queryRunner.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE schemaname = 'main' 
        AND tablename = 'budget_allocations' 
        AND indexname = '${idx.name}'
      `);

      if (exists.length === 0) {
        if (idx.unique) {
          // For unique index with nullable columns, use partial index
          await queryRunner.query(`
            CREATE UNIQUE INDEX "${idx.name}" 
            ON "main"."budget_allocations" (${idx.columns.map((c) => `"${c}"`).join(', ')})
            WHERE "deleted_at" IS NULL
          `);
        } else {
          await queryRunner.createIndex(
            'main.budget_allocations',
            new TableIndex({
              name: idx.name,
              columnNames: idx.columns,
            }),
          );
        }
      }
    }

    // Create foreign key for CPL
    const hasCplFk = await queryRunner.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_schema = 'main' 
      AND table_name = 'budget_allocations' 
      AND constraint_name LIKE '%cpl%'
    `);

    if (hasCplFk.length === 0) {
      await queryRunner.createForeignKey(
        'main.budget_allocations',
        new TableForeignKey({
          columnNames: ['cpl_id'],
          referencedTableName: 'cpls',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );
    }

    // Create budget_transaction_logs table
    const transactionLogsExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'main' 
        AND table_name = 'budget_transaction_logs'
      );
    `);

    if (!transactionLogsExists[0].exists) {
      await queryRunner.createTable(
        new Table({
          name: 'budget_transaction_logs',
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
              name: 'budget_allocation_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'transaction_type',
              type: 'enum',
              enum: ['allocation', 'utilization', 'release', 'adjustment', 'transfer', 'reservation', 'commit'],
              enumName: 'budget_transaction_logs_transaction_type_enum',
            },
            {
              name: 'on_invoice_amount',
              type: 'decimal',
              precision: 15,
              scale: 2,
              default: 0,
            },
            {
              name: 'off_invoice_amount',
              type: 'decimal',
              precision: 15,
              scale: 2,
              default: 0,
            },
            {
              name: 'plan_id',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'description',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'created_by',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'idempotency_key',
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
              name: 'updated_by',
              type: 'uuid',
              isNullable: true,
            },
          ],
        }),
      );

      await queryRunner.createIndex(
        'main.budget_transaction_logs',
        new TableIndex({
          name: 'IDX_budget_transaction_logs_allocation_created',
          columnNames: ['budget_allocation_id', 'created_at'],
        }),
      );

      await queryRunner.createIndex(
        'main.budget_transaction_logs',
        new TableIndex({
          name: 'IDX_budget_transaction_logs_plan',
          columnNames: ['plan_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.budget_transaction_logs',
        new TableIndex({
          name: 'IDX_budget_transaction_logs_type',
          columnNames: ['transaction_type'],
        }),
      );

      await queryRunner.createForeignKey(
        'main.budget_transaction_logs',
        new TableForeignKey({
          columnNames: ['budget_allocation_id'],
          referencedTableName: 'budget_allocations',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'main.budget_transaction_logs',
        new TableForeignKey({
          columnNames: ['plan_id'],
          referencedTableName: 'plans',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );

      await queryRunner.createForeignKey(
        'main.budget_transaction_logs',
        new TableForeignKey({
          columnNames: ['created_by'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );
    }

    // Create budget_alert_configurations table
    const alertConfigExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'main' 
        AND table_name = 'budget_alert_configurations'
      );
    `);

    if (!alertConfigExists[0].exists) {
      await queryRunner.createTable(
        new Table({
          name: 'budget_alert_configurations',
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
              name: 'alert_level',
              type: 'enum',
              enum: ['warning_80', 'critical_95', 'exceeded_100'],
              enumName: 'budget_alert_configurations_alert_level_enum',
            },
            {
              name: 'notification_channels',
              type: 'jsonb',
            },
            {
              name: 'escalation_rules',
              type: 'jsonb',
              isNullable: true,
            },
            {
              name: 'is_active',
              type: 'boolean',
              default: true,
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
      );

      await queryRunner.createIndex(
        'main.budget_alert_configurations',
        new TableIndex({
          name: 'IDX_budget_alert_config_tenant_level',
          columnNames: ['tenant_id', 'alert_level'],
          isUnique: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables
    await queryRunner.dropTable('main.budget_alert_configurations');
    await queryRunner.dropTable('main.budget_transaction_logs');

    // Drop generated columns
    await queryRunner.query(`
      ALTER TABLE "main"."budget_allocations" 
      DROP COLUMN IF EXISTS "total_budget",
      DROP COLUMN IF EXISTS "on_invoice_available",
      DROP COLUMN IF EXISTS "off_invoice_available"
    `);

    // Drop new columns from budget_allocations
    await queryRunner.query(`
      ALTER TABLE "main"."budget_allocations" 
      DROP COLUMN IF EXISTS "period_type",
      DROP COLUMN IF EXISTS "period_start",
      DROP COLUMN IF EXISTS "period_end",
      DROP COLUMN IF EXISTS "fiscal_year",
      DROP COLUMN IF EXISTS "cpl_id",
      DROP COLUMN IF EXISTS "channel",
      DROP COLUMN IF EXISTS "category",
      DROP COLUMN IF EXISTS "on_invoice_budget",
      DROP COLUMN IF EXISTS "off_invoice_budget",
      DROP COLUMN IF EXISTS "on_invoice_utilized",
      DROP COLUMN IF EXISTS "off_invoice_utilized",
      DROP COLUMN IF EXISTS "on_invoice_reserved",
      DROP COLUMN IF EXISTS "off_invoice_reserved",
      DROP COLUMN IF EXISTS "alert_threshold_80",
      DROP COLUMN IF EXISTS "alert_threshold_95",
      DROP COLUMN IF EXISTS "alert_threshold_100",
      DROP COLUMN IF EXISTS "alert_recipients",
      DROP COLUMN IF EXISTS "hard_limit_mode",
      DROP COLUMN IF EXISTS "allow_carry_forward"
    `);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."budget_alert_configurations_notification_channel_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."budget_alert_configurations_alert_level_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."budget_transaction_logs_transaction_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."budget_allocations_period_type_enum"`);
  }
}
