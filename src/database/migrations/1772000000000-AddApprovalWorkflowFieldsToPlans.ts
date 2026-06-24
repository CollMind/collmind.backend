import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class AddApprovalWorkflowFieldsToPlans1772000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add PENDING_FINANCE_REVIEW to enum
    await queryRunner.query(`
      ALTER TYPE "main"."plans_plan_status_enum" ADD VALUE IF NOT EXISTS 'PENDING_FINANCE_REVIEW';
    `);

    // Add new columns to plans table
    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'submission_notes',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'submitted_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'submitted_by',
        type: 'uuid',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'pending_finance_review',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'escalation_reason',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'escalated_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'escalated_by',
        type: 'uuid',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'on_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.plans',
      new TableColumn({
        name: 'off_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['submitted_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        referencedSchema: 'main',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plans',
      new TableForeignKey({
        columnNames: ['escalated_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        referencedSchema: 'main',
        onDelete: 'SET NULL',
      }),
    );

    // Create plan_approval_history table
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."plan_approval_history_action_enum" AS ENUM(
          'SUBMITTED',
          'APPROVED',
          'REJECTED',
          'REQUEST_CHANGES',
          'ESCALATED',
          'RETURNED_TO_DRAFT',
          'BUDGET_RESERVED',
          'BUDGET_RELEASED',
          'BUDGET_COMMITTED'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'plan_approval_history',
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
            name: 'action',
            type: 'enum',
            enum: [
              'SUBMITTED',
              'APPROVED',
              'REJECTED',
              'REQUEST_CHANGES',
              'ESCALATED',
              'RETURNED_TO_DRAFT',
              'BUDGET_RESERVED',
              'BUDGET_RELEASED',
              'BUDGET_COMMITTED',
            ],
            enumName: 'plan_approval_history_action_enum',
            isNullable: false,
          },
          {
            name: 'actioned_by',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'comments',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'rejection_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'escalation_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'specific_changes',
            type: 'jsonb',
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
        ],
      }),
      true,
    );

    // Add indexes
    await queryRunner.createIndex(
      'main.plan_approval_history',
      new TableIndex({
        name: 'IDX_plan_approval_history_plan_id_created_at',
        columnNames: ['plan_id', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'main.plan_approval_history',
      new TableIndex({
        name: 'IDX_plan_approval_history_tenant_id_action',
        columnNames: ['tenant_id', 'action'],
      }),
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'main.plan_approval_history',
      new TableForeignKey({
        columnNames: ['plan_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'plans',
        referencedSchema: 'main',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plan_approval_history',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'tenants',
        referencedSchema: 'main',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'main.plan_approval_history',
      new TableForeignKey({
        columnNames: ['actioned_by'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        referencedSchema: 'main',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop plan_approval_history table
    await queryRunner.dropTable('main.plan_approval_history', true);

    // Drop foreign keys from plans
    const plansTable = await queryRunner.getTable('main.plans');
    const submittedByFk = plansTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('submitted_by') !== -1,
    );
    const escalatedByFk = plansTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('escalated_by') !== -1,
    );

    if (submittedByFk) {
      await queryRunner.dropForeignKey('main.plans', submittedByFk);
    }
    if (escalatedByFk) {
      await queryRunner.dropForeignKey('main.plans', escalatedByFk);
    }

    // Drop columns from plans
    await queryRunner.dropColumn('main.plans', 'off_invoice_spend');
    await queryRunner.dropColumn('main.plans', 'on_invoice_spend');
    await queryRunner.dropColumn('main.plans', 'escalated_by');
    await queryRunner.dropColumn('main.plans', 'escalated_at');
    await queryRunner.dropColumn('main.plans', 'escalation_reason');
    await queryRunner.dropColumn('main.plans', 'pending_finance_review');
    await queryRunner.dropColumn('main.plans', 'submitted_by');
    await queryRunner.dropColumn('main.plans', 'submitted_at');
    await queryRunner.dropColumn('main.plans', 'submission_notes');

    // Note: Cannot remove enum value in PostgreSQL, so we leave it
  }
}
