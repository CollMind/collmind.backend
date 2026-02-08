import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateAdminAuditLogs1704067680000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create schema if not exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    // Create enum types if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."admin_audit_logs_result_enum" AS ENUM('SUCCESS', 'FAILURE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'admin_audit_logs',
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
            name: 'admin_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'admin_email',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'action_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'entity_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'entity_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'ip_address',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'result',
            type: 'enum',
            enum: ['SUCCESS', 'FAILURE'],
            isNullable: false,
            enumName: 'admin_audit_logs_result_enum',
          },
          {
            name: 'before_values',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'after_values',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'justification',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_high_risk',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'alert_sent',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Indexes
    await queryRunner.createIndex(
      'main.admin_audit_logs',
      new TableIndex({
        name: 'IDX_ADMIN_AUDIT_LOGS_TENANT_ADMIN',
        columnNames: ['tenant_id', 'admin_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.admin_audit_logs',
      new TableIndex({
        name: 'IDX_ADMIN_AUDIT_LOGS_TENANT_CREATED',
        columnNames: ['tenant_id', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'main.admin_audit_logs',
      new TableIndex({
        name: 'IDX_ADMIN_AUDIT_LOGS_ENTITY',
        columnNames: ['entity_type', 'entity_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.admin_audit_logs',
      new TableIndex({
        name: 'IDX_ADMIN_AUDIT_LOGS_HIGH_RISK',
        columnNames: ['is_high_risk', 'created_at'],
      }),
    );

    // Foreign key to tenants
    await queryRunner.createForeignKey(
      'main.admin_audit_logs',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.admin_audit_logs', true);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."admin_audit_logs_result_enum"`);
  }
}

