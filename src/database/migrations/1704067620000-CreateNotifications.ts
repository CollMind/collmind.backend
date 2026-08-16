import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateNotifications1704067620000 implements MigrationInterface {
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
        CREATE TYPE "main"."notifications_type_enum" AS ENUM('APPROVAL_REQUESTED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'BUDGET_ALERT_80', 'BUDGET_ALERT_100', 'AGREEMENT_EXPIRING');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."notifications_channel_enum" AS ENUM('EMAIL', 'IN_APP', 'SMS');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."notifications_priority_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."notifications_status_enum" AS ENUM('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'notifications',
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
            name: 'type',
            type: 'enum',
            enum: [
              'APPROVAL_REQUESTED',
              'APPROVAL_GRANTED',
              'APPROVAL_REJECTED',
              'BUDGET_ALERT_80',
              'BUDGET_ALERT_100',
              'AGREEMENT_EXPIRING',
            ],
            isNullable: false,
            enumName: 'notifications_type_enum',
          },
          {
            name: 'recipient_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'recipient_email',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'recipient_name',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'channel',
            type: 'enum',
            enum: ['EMAIL', 'IN_APP', 'SMS'],
            default: "'IN_APP'",
            isNullable: false,
            enumName: 'notifications_channel_enum',
          },
          {
            name: 'priority',
            type: 'enum',
            enum: ['LOW', 'MEDIUM', 'HIGH'],
            default: "'MEDIUM'",
            isNullable: false,
            enumName: 'notifications_priority_enum',
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ'],
            default: "'PENDING'",
            isNullable: false,
            enumName: 'notifications_status_enum',
          },
          {
            name: 'subject',
            type: 'varchar',
            length: '500',
            isNullable: false,
          },
          {
            name: 'body',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'sent_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'read_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
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
      'main.notifications',
      new TableIndex({
        name: 'IDX_NOTIFICATIONS_TENANT_RECIPIENT',
        columnNames: ['tenant_id', 'recipient_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.notifications',
      new TableIndex({
        name: 'IDX_NOTIFICATIONS_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.notifications',
      new TableIndex({
        name: 'IDX_NOTIFICATIONS_TENANT_TYPE',
        columnNames: ['tenant_id', 'type'],
      }),
    );

    await queryRunner.createIndex(
      'main.notifications',
      new TableIndex({
        name: 'IDX_NOTIFICATIONS_TENANT_CREATED',
        columnNames: ['tenant_id', 'created_at'],
      }),
    );

    // Foreign key to tenants
    await queryRunner.createForeignKey(
      'main.notifications',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.notifications', true);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."notifications_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."notifications_channel_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."notifications_priority_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."notifications_status_enum"`,
    );
  }
}
