import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateCustomers1704067320000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create schema if not exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    // Create enum types if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."customers_channel_enum" AS ENUM('NKA', 'TRADITIONAL_TRADE', 'E_COMMERCE', 'EXPORT', 'WHOLESALE', 'RETAIL', 'HORECA');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."customers_type_enum" AS ENUM('DIRECT', 'DISTRIBUTOR', 'WHOLESALER', 'RETAILER', 'END_CUSTOMER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."customers_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'customers',
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
            name: 'channel',
            type: 'enum',
            enum: [
              'NKA',
              'TRADITIONAL_TRADE',
              'E_COMMERCE',
              'EXPORT',
              'WHOLESALE',
              'RETAIL',
              'HORECA',
            ],
          },
          {
            name: 'type',
            type: 'enum',
            enum: [
              'DIRECT',
              'DISTRIBUTOR',
              'WHOLESALER',
              'RETAILER',
              'END_CUSTOMER',
            ],
            default: "'DIRECT'",
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED'],
            default: "'ACTIVE'",
          },
          {
            name: 'city',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'district',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'region',
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
            name: 'address',
            type: 'text',
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
            name: 'tax_office',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'company_registration_number',
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
            name: 'contact_mobile',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'payment_terms',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'credit_limit',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '3',
            default: "'TRY'",
          },
          {
            name: 'sales_representative',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'account_manager',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'customer_group',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'customer_segment',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'customer_tier',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'business_size',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'annual_revenue',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'last_order_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'first_order_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'total_orders',
            type: 'int',
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
            name: 'is_vip',
            type: 'boolean',
            default: false,
          },
          {
            name: 'contract_start_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'contract_end_date',
            type: 'date',
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
      'main.customers',
      new TableIndex({
        name: 'IDX_CUSTOMERS_TENANT_CODE',
        columnNames: ['tenant_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.customers',
      new TableIndex({
        name: 'IDX_CUSTOMERS_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.customers',
      new TableIndex({
        name: 'IDX_CUSTOMERS_CHANNEL',
        columnNames: ['channel'],
      }),
    );

    await queryRunner.createIndex(
      'main.customers',
      new TableIndex({
        name: 'IDX_CUSTOMERS_CITY',
        columnNames: ['city'],
      }),
    );

    await queryRunner.createIndex(
      'main.customers',
      new TableIndex({
        name: 'IDX_CUSTOMERS_IS_VIP',
        columnNames: ['is_vip'],
      }),
    );

    await queryRunner.createIndex(
      'main.customers',
      new TableIndex({
        name: 'IDX_CUSTOMERS_TENANT_ID',
        columnNames: ['tenant_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'main.customers',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.customers');
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."customers_channel_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "main"."customers_type_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."customers_status_enum"`,
    );
  }
}
