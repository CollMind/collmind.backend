import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateMasterDataEntities1704068000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create schema if not exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."tactics_tactic_type_enum" AS ENUM('DISCOUNT', 'LUMP_SUM', 'VOLUME_REBATE', 'CO_OP', 'LISTING_FEE', 'OTHER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."tactics_spend_type_enum" AS ENUM('ON_INVOICE', 'OFF_INVOICE', 'BOTH');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."mechanics_mechanic_type_enum" AS ENUM('PERCENT', 'AMOUNT', 'AMOUNT_PER_UNIT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."cpls_status_enum" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // 1. Brands
    await queryRunner.createTable(
      new Table({
        name: 'brands',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
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
      'main.brands',
      new TableIndex({
        name: 'IDX_BRANDS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'main.brands',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    // 2. Categories
    await queryRunner.createTable(
      new Table({
        name: 'categories',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'parent_category_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'level',
            type: 'int',
            default: 1,
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
      'main.categories',
      new TableIndex({
        name: 'IDX_CATEGORIES_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.categories',
      new TableIndex({
        name: 'IDX_CATEGORIES_PARENT',
        columnNames: ['parent_category_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.categories',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.categories',
      new TableForeignKey({
        columnNames: ['parent_category_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.categories',
        onDelete: 'SET NULL',
      }),
    );

    // 3. Channels
    await queryRunner.createTable(
      new Table({
        name: 'channels',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'subchannel',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'sort_order',
            type: 'int',
            default: 0,
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
      'main.channels',
      new TableIndex({
        name: 'IDX_CHANNELS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'main.channels',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    // 4. Regions
    await queryRunner.createTable(
      new Table({
        name: 'regions',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'parent_region_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'level',
            type: 'int',
            default: 1,
          },
          {
            name: 'country',
            type: 'varchar',
            length: '100',
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
      'main.regions',
      new TableIndex({
        name: 'IDX_REGIONS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.regions',
      new TableIndex({
        name: 'IDX_REGIONS_PARENT',
        columnNames: ['parent_region_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.regions',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.regions',
      new TableForeignKey({
        columnNames: ['parent_region_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.regions',
        onDelete: 'SET NULL',
      }),
    );

    // 5. Generic Units
    await queryRunner.createTable(
      new Table({
        name: 'generic_units',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'brand_id',
            type: 'uuid',
          },
          {
            name: 'category_id',
            type: 'uuid',
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
      'main.generic_units',
      new TableIndex({
        name: 'IDX_GENERIC_UNITS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.generic_units',
      new TableIndex({
        name: 'IDX_GENERIC_UNITS_BRAND',
        columnNames: ['brand_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.generic_units',
      new TableIndex({
        name: 'IDX_GENERIC_UNITS_CATEGORY',
        columnNames: ['category_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.generic_units',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.generic_units',
      new TableForeignKey({
        columnNames: ['brand_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.brands',
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'main.generic_units',
      new TableForeignKey({
        columnNames: ['category_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.categories',
        onDelete: 'RESTRICT',
      }),
    );

    // 6. Forecasting Units
    await queryRunner.createTable(
      new Table({
        name: 'forecasting_units',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'gu_id',
            type: 'uuid',
          },
          {
            name: 'size',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'segment',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'is_plannable',
            type: 'boolean',
            default: true,
          },
          {
            name: 'default_base_volume',
            type: 'decimal',
            precision: 18,
            scale: 3,
            isNullable: true,
          },
          {
            name: 'base_price',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '3',
            default: "'TRY'",
          },
          {
            name: 'unit_of_measure',
            type: 'varchar',
            length: '20',
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
      'main.forecasting_units',
      new TableIndex({
        name: 'IDX_FORECASTING_UNITS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.forecasting_units',
      new TableIndex({
        name: 'IDX_FORECASTING_UNITS_GU',
        columnNames: ['gu_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.forecasting_units',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.forecasting_units',
      new TableForeignKey({
        columnNames: ['gu_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.generic_units',
        onDelete: 'RESTRICT',
      }),
    );

    // 7. SKUs
    await queryRunner.createTable(
      new Table({
        name: 'skus',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'gu_id',
            type: 'uuid',
          },
          {
            name: 'fu_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'variant',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'size',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'barcode',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'unit_price',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'cogs',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '3',
            default: "'TRY'",
          },
          {
            name: 'unit_of_measure',
            type: 'varchar',
            length: '20',
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
      'main.skus',
      new TableIndex({
        name: 'IDX_SKUS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.skus',
      new TableIndex({
        name: 'IDX_SKUS_GU',
        columnNames: ['gu_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.skus',
      new TableIndex({
        name: 'IDX_SKUS_FU',
        columnNames: ['fu_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.skus',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.skus',
      new TableForeignKey({
        columnNames: ['gu_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.generic_units',
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'main.skus',
      new TableForeignKey({
        columnNames: ['fu_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.forecasting_units',
        onDelete: 'SET NULL',
      }),
    );

    // 8. Tactics
    await queryRunner.createTable(
      new Table({
        name: 'tactics',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'tactic_type',
            type: 'enum',
            enum: [
              'DISCOUNT',
              'LUMP_SUM',
              'VOLUME_REBATE',
              'CO_OP',
              'LISTING_FEE',
              'OTHER',
            ],
            enumName: 'tactics_tactic_type_enum',
          },
          {
            name: 'spend_type',
            type: 'enum',
            enum: ['ON_INVOICE', 'OFF_INVOICE', 'BOTH'],
            enumName: 'tactics_spend_type_enum',
            isNullable: true,
          },
          {
            name: 'applicable_channels',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'applicable_categories',
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
      'main.tactics',
      new TableIndex({
        name: 'IDX_TACTICS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'main.tactics',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    // 9. Mechanics
    await queryRunner.createTable(
      new Table({
        name: 'mechanics',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'tactic_id',
            type: 'uuid',
          },
          {
            name: 'mechanic_type',
            type: 'enum',
            enum: ['PERCENT', 'AMOUNT', 'AMOUNT_PER_UNIT'],
            enumName: 'mechanics_mechanic_type_enum',
          },
          {
            name: 'calculation_rules',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'min_value',
            type: 'decimal',
            precision: 18,
            scale: 4,
            isNullable: true,
          },
          {
            name: 'max_value',
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
      'main.mechanics',
      new TableIndex({
        name: 'IDX_MECHANICS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.mechanics',
      new TableIndex({
        name: 'IDX_MECHANICS_TACTIC',
        columnNames: ['tactic_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.mechanics',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.mechanics',
      new TableForeignKey({
        columnNames: ['tactic_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tactics',
        onDelete: 'RESTRICT',
      }),
    );

    // 10. CPLs
    await queryRunner.createTable(
      new Table({
        name: 'cpls',
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
            name: 'code',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'channel_id',
            type: 'uuid',
          },
          {
            name: 'region_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'city',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'country',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'contact_person',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'contact_email',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'contact_phone',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'customer_tier',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'is_vip',
            type: 'boolean',
            default: false,
          },
          {
            name: 'annual_revenue',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED'],
            enumName: 'cpls_status_enum',
            default: "'ACTIVE'",
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
      'main.cpls',
      new TableIndex({
        name: 'IDX_CPLS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.cpls',
      new TableIndex({
        name: 'IDX_CPLS_CHANNEL',
        columnNames: ['channel_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.cpls',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.cpls',
      new TableForeignKey({
        columnNames: ['channel_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.channels',
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'main.cpls',
      new TableForeignKey({
        columnNames: ['region_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.regions',
        onDelete: 'SET NULL',
      }),
    );

    // 11. Add CPL to Customers
    await queryRunner.query(`
      ALTER TABLE "main"."customers"
      ADD COLUMN IF NOT EXISTS "cpl_id" uuid
    `);

    await queryRunner.createIndex(
      'main.customers',
      new TableIndex({
        name: 'IDX_CUSTOMERS_CPL',
        columnNames: ['cpl_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.customers',
      new TableForeignKey({
        columnNames: ['cpl_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.cpls',
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys and columns
    await queryRunner.query(`
      ALTER TABLE "main"."customers"
      DROP COLUMN IF EXISTS "cpl_id"
    `);

    // Drop tables in reverse order
    await queryRunner.dropTable('main.cpls');
    await queryRunner.dropTable('main.mechanics');
    await queryRunner.dropTable('main.tactics');
    await queryRunner.dropTable('main.skus');
    await queryRunner.dropTable('main.forecasting_units');
    await queryRunner.dropTable('main.generic_units');
    await queryRunner.dropTable('main.regions');
    await queryRunner.dropTable('main.channels');
    await queryRunner.dropTable('main.categories');
    await queryRunner.dropTable('main.brands');

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."cpls_status_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."mechanics_mechanic_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."tactics_spend_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."tactics_tactic_type_enum"`,
    );
  }
}
