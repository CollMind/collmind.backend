import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateTenants1704067200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create schema if not exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    // Create enum types if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."tenants_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'TRIAL');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."tenants_plan_enum" AS ENUM('FREE', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'tenants',
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
            name: 'name',
            type: 'varchar',
            length: '200',
            isUnique: true,
          },
          {
            name: 'domain',
            type: 'varchar',
            length: '100',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TRIAL'],
            default: "'TRIAL'",
          },
          {
            name: 'plan',
            type: 'enum',
            enum: ['FREE', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'],
            default: "'FREE'",
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
            name: 'contact_person',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'address',
            type: 'varchar',
            length: '255',
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
            name: 'postal_code',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'tax_number',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'company_registration_number',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'industry',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'settings',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'subscription_start_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'subscription_end_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'max_users',
            type: 'int',
            default: 5,
          },
          {
            name: 'max_storage_gb',
            type: 'int',
            default: 10,
          },
          {
            name: 'current_storage_gb',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'metadata',
            type: 'jsonb',
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
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'main.tenants',
      new TableIndex({
        name: 'IDX_TENANT_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'main.tenants',
      new TableIndex({
        name: 'IDX_TENANT_DOMAIN',
        columnNames: ['domain'],
        isUnique: true,
        where: '"domain" IS NOT NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.tenants');
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."tenants_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."tenants_plan_enum"`);
  }
}
