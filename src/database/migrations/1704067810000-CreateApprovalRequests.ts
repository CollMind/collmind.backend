import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateApprovalRequests1704067810000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create schema if not exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "main"`);

    // Create enum types if not exists
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."approval_requests_request_type_enum" AS ENUM('AGREEMENT', 'BUDGET_TRANSFER', 'IMPORT_BATCH', 'OTHER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."approval_requests_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'approval_requests',
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
            name: 'request_type',
            type: 'enum',
            enum: ['AGREEMENT', 'BUDGET_TRANSFER', 'IMPORT_BATCH', 'OTHER'],
            enumName: 'approval_requests_request_type_enum',
            isNullable: false,
          },
          {
            name: 'entity_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'entity_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'requested_by_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'requested_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'approval_policy_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'approval_levels',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'current_level',
            type: 'int',
            default: 1,
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
            enumName: 'approval_requests_status_enum',
            default: "'PENDING'",
            isNullable: false,
          },
          {
            name: 'approved_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'approved_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'rejected_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejected_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'rejection_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'cancelled_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'cancelled_by_id',
            type: 'uuid',
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
      'main.approval_requests',
      new TableIndex({
        name: 'IDX_APPROVAL_REQUESTS_TENANT_ENTITY',
        columnNames: ['tenant_id', 'entity_type', 'entity_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.approval_requests',
      new TableIndex({
        name: 'IDX_APPROVAL_REQUESTS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'main.approval_requests',
      new TableIndex({
        name: 'IDX_APPROVAL_REQUESTS_TENANT_REQUESTED_BY',
        columnNames: ['tenant_id', 'requested_by_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.approval_requests',
      new TableIndex({
        name: 'IDX_APPROVAL_REQUESTS_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    // Foreign keys
    await queryRunner.createForeignKey(
      'main.approval_requests',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.approval_requests',
      new TableForeignKey({
        columnNames: ['requested_by_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.approval_requests',
      new TableForeignKey({
        columnNames: ['approved_by_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.approval_requests',
      new TableForeignKey({
        columnNames: ['rejected_by_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.approval_requests',
      new TableForeignKey({
        columnNames: ['cancelled_by_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.approval_requests',
      new TableForeignKey({
        columnNames: ['created_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.approval_requests',
      new TableForeignKey({
        columnNames: ['updated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.users',
        onDelete: 'SET NULL',
      }),
    );

    // Add foreign key from agreements.approval_request_id to approval_requests.id
    // This ensures referential integrity - agreements can reference approval requests
    await queryRunner.createForeignKey(
      'main.agreements',
      new TableForeignKey({
        columnNames: ['approval_request_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.approval_requests',
        onDelete: 'SET NULL', // If approval request is deleted, set to NULL (soft reference)
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the foreign key from agreements.approval_request_id to approval_requests.id
    // This must be done before dropping the approval_requests table
    // Try both table name formats to handle TypeORM's getTable API variations
    let agreementsTable = await queryRunner.getTable('agreements');
    if (!agreementsTable) {
      agreementsTable = await queryRunner.getTable('main.agreements');
    }

    if (agreementsTable) {
      // Find FK by column name (more reliable than table name matching)
      // TypeORM may store referencedTableName in different formats (with/without schema)
      const approvalRequestFk = agreementsTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('approval_request_id') !== -1,
      );
      if (approvalRequestFk) {
        await queryRunner.dropForeignKey('main.agreements', approvalRequestFk);
      }
    }

    await queryRunner.dropTable('main.approval_requests', true);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."approval_requests_request_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."approval_requests_status_enum"`,
    );
  }
}
