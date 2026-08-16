import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateBudgetReservations1704067560000 implements MigrationInterface {
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

    // Create enum types if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_reservations_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMMITTED', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'budget_reservations',
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
            name: 'agreement_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'agreement_name',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'reserved_amount',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMMITTED', 'CANCELLED'],
            default: "'PENDING'",
            isNullable: false,
            enumName: 'budget_reservations_status_enum',
          },
          {
            name: 'requested_by_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'requested_by_email',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'requested_by_name',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'approved_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'approved_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejected_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
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
      'main.budget_reservations',
      new TableIndex({
        name: 'IDX_BUDGET_RESERVATIONS_TENANT_ENVELOPE',
        columnNames: ['tenant_id', 'envelope_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.budget_reservations',
      new TableIndex({
        name: 'IDX_BUDGET_RESERVATIONS_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.budget_reservations',
      new TableIndex({
        name: 'IDX_BUDGET_RESERVATIONS_TENANT_AGREEMENT',
        columnNames: ['tenant_id', 'agreement_id'],
      }),
    );

    // Foreign keys
    await queryRunner.createForeignKey(
      'main.budget_reservations',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.budget_reservations',
      new TableForeignKey({
        columnNames: ['envelope_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.budget_envelopes',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.budget_reservations', true);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_reservations_status_enum"`,
    );
  }
}
