import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateBudgetEnvelopes1704067500000 implements MigrationInterface {
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
        CREATE TYPE "main"."budget_envelopes_status_enum" AS ENUM('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'budget_envelopes',
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
            name: 'code',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'fiscal_year',
            type: 'varchar',
            length: '10',
            isNullable: false,
          },
          {
            name: 'period',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'allocated_amount',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'consumed_amount',
            type: 'decimal',
            precision: 15,
            scale: 2,
            default: 0,
            isNullable: false,
          },
          {
            name: 'available_amount',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'],
            default: "'DRAFT'",
            isNullable: false,
            enumName: 'budget_envelopes_status_enum',
          },
          {
            name: 'budget_owner_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'budget_owner_email',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'budget_owner_name',
            type: 'varchar',
            length: '200',
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
      'main.budget_envelopes',
      new TableIndex({
        name: 'IDX_BUDGET_ENVELOPES_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.budget_envelopes',
      new TableIndex({
        name: 'IDX_BUDGET_ENVELOPES_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.budget_envelopes',
      new TableIndex({
        name: 'IDX_BUDGET_ENVELOPES_FISCAL_PERIOD',
        columnNames: ['fiscal_year', 'period'],
      }),
    );

    // Foreign key to tenants
    await queryRunner.createForeignKey(
      'main.budget_envelopes',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.budget_envelopes', true);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_envelopes_status_enum"`,
    );
  }
}
