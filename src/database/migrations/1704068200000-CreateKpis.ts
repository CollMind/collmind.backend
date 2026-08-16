import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateKpis1704068200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // K-2.6.13(c) — koşullu şema yaratma (tam gerekçe:
    // CreateTenants1704067200000, aynı görev). `CREATE SCHEMA IF NOT EXISTS`
    // PostgreSQL'de DATABASE-düzeyi CREATE iznini şemanın var olup
    // olmadığına BAKMADAN denetler; app_migrate yalnız şema-içi CREATE alır
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

    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."kpis_formula_type_enum" AS ENUM('expression', 'conditional', 'user_input', 'external', 'javascript');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."kpis_calculation_level_enum" AS ENUM('sku', 'fu', 'plan');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."kpis_display_format_enum" AS ENUM('number', 'currency', 'percentage');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."kpis_aggregation_method_enum" AS ENUM('sum', 'avg', 'min', 'max', 'weighted_avg');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'kpis',
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
          },
          {
            name: 'kpi_code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'kpi_name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'kpi_group',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'kpi_description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'formula_type',
            type: 'enum',
            enum: [
              'expression',
              'conditional',
              'user_input',
              'external',
              'javascript',
            ],
            enumName: 'kpis_formula_type_enum',
          },
          {
            name: 'formula_text',
            type: 'text',
          },
          {
            name: 'depends_on_kpis',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'calculation_order',
            type: 'int',
          },
          {
            name: 'calculation_level',
            type: 'enum',
            enum: ['sku', 'fu', 'plan'],
            enumName: 'kpis_calculation_level_enum',
          },
          {
            name: 'display_format',
            type: 'enum',
            enum: ['number', 'currency', 'percentage'],
            enumName: 'kpis_display_format_enum',
          },
          {
            name: 'decimal_places',
            type: 'int',
            default: 2,
          },
          {
            name: 'show_in_grid',
            type: 'boolean',
            default: true,
          },
          {
            name: 'column_order',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'aggregation_method_fu',
            type: 'enum',
            enum: ['sum', 'avg', 'min', 'max', 'weighted_avg'],
            enumName: 'kpis_aggregation_method_enum',
            isNullable: true,
          },
          {
            name: 'rag_green_threshold',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'rag_amber_threshold',
            type: 'decimal',
            precision: 18,
            scale: 4,
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
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
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

    await queryRunner.createIndex(
      'main.kpis',
      new TableIndex({
        name: 'IDX_KPIS_TENANT_CODE',
        columnNames: ['tenant_id', 'kpi_code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.kpis',
      new TableIndex({
        name: 'IDX_KPIS_CALCULATION_ORDER',
        columnNames: ['calculation_order'],
      }),
    );

    await queryRunner.createIndex(
      'main.kpis',
      new TableIndex({
        name: 'IDX_KPIS_GROUP',
        columnNames: ['kpi_group'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.kpis',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    // Add constraint
    await queryRunner.query(`
      ALTER TABLE "main"."kpis"
      ADD CONSTRAINT "CHK_KPIS_CALCULATION_ORDER"
      CHECK (calculation_order > 0 AND calculation_order <= 50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.kpis');
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."kpis_aggregation_method_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."kpis_display_format_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."kpis_calculation_level_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."kpis_formula_type_enum"`,
    );
  }
}
