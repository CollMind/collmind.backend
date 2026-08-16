import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreatePlans1704068300000 implements MigrationInterface {
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
        CREATE TYPE "main"."plans_plan_status_enum" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create plans table
    await queryRunner.createTable(
      new Table({
        name: 'plans',
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
            name: 'plan_code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'plan_name',
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
            name: 'cpl_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'channel_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'region_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'category_id',
            type: 'uuid',
            isNullable: false,
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
            name: 'status',
            type: 'enum',
            enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
            enumName: 'plans_plan_status_enum',
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
            name: 'comments',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'total_planned_volume',
            type: 'decimal',
            precision: 18,
            scale: 3,
            default: 0,
            isNullable: false,
          },
          {
            name: 'total_spend',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'total_gp',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'overall_roi',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'rag_status',
            type: 'varchar',
            length: '10',
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
            isNullable: false,
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

    // Create indexes for plans
    await queryRunner.createIndex(
      'main.plans',
      new TableIndex({
        name: 'IDX_plans_tenant_plan_code',
        columnNames: ['tenant_id', 'plan_code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.plans',
      new TableIndex({
        name: 'IDX_plans_tenant_status',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.plans',
      new TableIndex({
        name: 'IDX_plans_tenant_cpl_status',
        columnNames: ['tenant_id', 'cpl_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.plans',
      new TableIndex({
        name: 'IDX_plans_tenant_category_status',
        columnNames: ['tenant_id', 'category_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.plans',
      new TableIndex({
        name: 'IDX_plans_approval_request',
        columnNames: ['approval_request_id'],
        where: 'approval_request_id IS NOT NULL',
      }),
    );

    // Create foreign keys for plans
    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['cpl_id'],
        referencedTableName: 'cpls',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['channel_id'],
        referencedTableName: 'channels',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['category_id'],
        referencedTableName: 'categories',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['region_id'],
        referencedTableName: 'regions',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['approved_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['rejected_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['approval_request_id'],
        referencedTableName: 'approval_requests',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Create plan_fus table
    await queryRunner.createTable(
      new Table({
        name: 'plan_fus',
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
            name: 'plan_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'fu_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'tactics',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'total_planned_volume',
            type: 'decimal',
            precision: 18,
            scale: 3,
            default: 0,
            isNullable: false,
          },
          {
            name: 'total_spend',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'total_gp',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'gp_roi',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'rag_status',
            type: 'varchar',
            length: '10',
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
            isNullable: false,
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

    // Create indexes for plan_fus
    await queryRunner.createIndex(
      'main.plan_fus',
      new TableIndex({
        name: 'IDX_plan_fus_plan_id',
        columnNames: ['plan_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.plan_fus',
      new TableIndex({
        name: 'IDX_plan_fus_fu_id',
        columnNames: ['fu_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.plan_fus',
      new TableIndex({
        name: 'IDX_plan_fus_plan_fu_unique',
        columnNames: ['plan_id', 'fu_id'],
        isUnique: true,
      }),
    );

    // Create foreign keys for plan_fus
    await queryRunner.createForeignKey(
      'main.plan_fus',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plan_fus',
      new TableForeignKey({
        columnNames: ['plan_id'],
        referencedTableName: 'plans',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plan_fus',
      new TableForeignKey({
        columnNames: ['fu_id'],
        referencedTableName: 'forecasting_units',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // Create plan_skus table
    await queryRunner.createTable(
      new Table({
        name: 'plan_skus',
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
            name: 'plan_fu_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'sku_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'base_volume',
            type: 'decimal',
            precision: 18,
            scale: 3,
            isNullable: true,
          },
          {
            name: 'planned_volume',
            type: 'decimal',
            precision: 18,
            scale: 3,
            isNullable: true,
          },
          {
            name: 'incremental_volume',
            type: 'decimal',
            precision: 18,
            scale: 3,
            default: 0,
            isNullable: false,
          },
          {
            name: 'planned_turnover',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'tactic_spend',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'planned_gp',
            type: 'decimal',
            precision: 18,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'gp_roi',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'rag_status',
            type: 'varchar',
            length: '10',
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
            isNullable: false,
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

    // Create indexes for plan_skus
    await queryRunner.createIndex(
      'main.plan_skus',
      new TableIndex({
        name: 'IDX_plan_skus_plan_fu_id',
        columnNames: ['plan_fu_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.plan_skus',
      new TableIndex({
        name: 'IDX_plan_skus_sku_id',
        columnNames: ['sku_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.plan_skus',
      new TableIndex({
        name: 'IDX_plan_skus_plan_fu_sku_unique',
        columnNames: ['plan_fu_id', 'sku_id'],
        isUnique: true,
      }),
    );

    // Create foreign keys for plan_skus
    await queryRunner.createForeignKey(
      'main.plan_skus',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plan_skus',
      new TableForeignKey({
        columnNames: ['plan_fu_id'],
        referencedTableName: 'plan_fus',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plan_skus',
      new TableForeignKey({
        columnNames: ['sku_id'],
        referencedTableName: 'skus',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    const planSkusTable = await queryRunner.getTable('main.plan_skus');
    if (planSkusTable) {
      const foreignKeys = planSkusTable.foreignKeys;
      for (const fk of foreignKeys) {
        await queryRunner.dropForeignKey('main.plan_skus', fk);
      }
    }

    const planFusTable = await queryRunner.getTable('main.plan_fus');
    if (planFusTable) {
      const foreignKeys = planFusTable.foreignKeys;
      for (const fk of foreignKeys) {
        await queryRunner.dropForeignKey('main.plan_fus', fk);
      }
    }

    const plansTable = await queryRunner.getTable('main.plans');
    if (plansTable) {
      const foreignKeys = plansTable.foreignKeys;
      for (const fk of foreignKeys) {
        await queryRunner.dropForeignKey('main.plans', fk);
      }
    }

    // Drop tables
    await queryRunner.dropTable('main.plan_skus', true);
    await queryRunner.dropTable('main.plan_fus', true);
    await queryRunner.dropTable('main.plans', true);

    // Drop enum types
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."plans_plan_status_enum"`,
    );
  }
}
