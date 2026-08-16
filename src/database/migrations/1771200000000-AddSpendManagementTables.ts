import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
  TableColumn,
} from 'typeorm';

export class AddSpendManagementTables1771200000000 implements MigrationInterface {
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

    // 1. Update mechanics table - Add new columns
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."mechanics_spending_type_enum" AS ENUM('on_invoice', 'off_invoice', 'both');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'spending_type',
        type: 'enum',
        enum: ['on_invoice', 'off_invoice', 'both'],
        enumName: 'mechanics_spending_type_enum',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'calculation_formula',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'applicability_rules',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'input_constraints',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    // 2. Create plan_mechanic_values table
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."plan_mechanic_values_distribution_method_enum" AS ENUM('percentage', 'per_unit', 'lumpsum', 'proportional');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    const planMechanicValuesExists = await queryRunner.hasTable(
      'main.plan_mechanic_values',
    );
    if (!planMechanicValuesExists) {
      await queryRunner.createTable(
        new Table({
          name: 'plan_mechanic_values',
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
              name: 'plan_fu_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'mechanic_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'entered_value',
              type: 'decimal',
              precision: 18,
              scale: 4,
              isNullable: true,
            },
            {
              name: 'calculated_spend',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'on_invoice_amount',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'off_invoice_amount',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'distribution_method',
              type: 'enum',
              enum: ['percentage', 'per_unit', 'lumpsum', 'proportional'],
              enumName: 'plan_mechanic_values_distribution_method_enum',
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
      );

      await queryRunner.createIndex(
        'main.plan_mechanic_values',
        new TableIndex({
          name: 'IDX_plan_mechanic_values_plan_fu_mechanic',
          columnNames: ['plan_fu_id', 'mechanic_id'],
          isUnique: true,
        }),
      );

      await queryRunner.createIndex(
        'main.plan_mechanic_values',
        new TableIndex({
          name: 'IDX_plan_mechanic_values_plan_fu_id',
          columnNames: ['plan_fu_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.plan_mechanic_values',
        new TableIndex({
          name: 'IDX_plan_mechanic_values_mechanic_id',
          columnNames: ['mechanic_id'],
        }),
      );

      await queryRunner.createForeignKey(
        'main.plan_mechanic_values',
        new TableForeignKey({
          columnNames: ['plan_fu_id'],
          referencedTableName: 'plan_fus',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'main.plan_mechanic_values',
        new TableForeignKey({
          columnNames: ['mechanic_id'],
          referencedTableName: 'mechanics',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );
    }

    // 3. Create mechanic_spend_breakdown table
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."mechanic_spend_breakdown_distribution_basis_enum" AS ENUM('base_volume_ratio', 'planned_volume_ratio', 'equal');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    const mechanicSpendBreakdownExists = await queryRunner.hasTable(
      'main.mechanic_spend_breakdown',
    );
    if (!mechanicSpendBreakdownExists) {
      await queryRunner.createTable(
        new Table({
          name: 'mechanic_spend_breakdown',
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
              name: 'plan_sku_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'mechanic_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'plan_mechanic_value_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'calculated_amount',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'distribution_basis',
              type: 'enum',
              enum: ['base_volume_ratio', 'planned_volume_ratio', 'equal'],
              enumName: 'mechanic_spend_breakdown_distribution_basis_enum',
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
      );

      await queryRunner.createIndex(
        'main.mechanic_spend_breakdown',
        new TableIndex({
          name: 'IDX_mechanic_spend_breakdown_plan_sku_mechanic',
          columnNames: ['plan_sku_id', 'mechanic_id'],
          isUnique: true,
        }),
      );

      await queryRunner.createIndex(
        'main.mechanic_spend_breakdown',
        new TableIndex({
          name: 'IDX_mechanic_spend_breakdown_plan_sku_id',
          columnNames: ['plan_sku_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.mechanic_spend_breakdown',
        new TableIndex({
          name: 'IDX_mechanic_spend_breakdown_mechanic_id',
          columnNames: ['mechanic_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.mechanic_spend_breakdown',
        new TableIndex({
          name: 'IDX_mechanic_spend_breakdown_plan_mechanic_value_id',
          columnNames: ['plan_mechanic_value_id'],
        }),
      );

      await queryRunner.createForeignKey(
        'main.mechanic_spend_breakdown',
        new TableForeignKey({
          columnNames: ['plan_sku_id'],
          referencedTableName: 'plan_skus',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'main.mechanic_spend_breakdown',
        new TableForeignKey({
          columnNames: ['mechanic_id'],
          referencedTableName: 'mechanics',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );

      await queryRunner.createForeignKey(
        'main.mechanic_spend_breakdown',
        new TableForeignKey({
          columnNames: ['plan_mechanic_value_id'],
          referencedTableName: 'plan_mechanic_values',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }

    // 4. Create lta_agreements table
    const ltaAgreementsExists = await queryRunner.hasTable(
      'main.lta_agreements',
    );
    if (!ltaAgreementsExists) {
      await queryRunner.createTable(
        new Table({
          name: 'lta_agreements',
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
              name: 'cpl_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'channel_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'on_invoice_percentage',
              type: 'decimal',
              precision: 5,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'off_invoice_percentage',
              type: 'decimal',
              precision: 5,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'effective_date',
              type: 'date',
              isNullable: false,
            },
            {
              name: 'expiry_date',
              type: 'date',
              isNullable: true,
            },
            {
              name: 'is_active',
              type: 'boolean',
              default: true,
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
      );

      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_cpl_channel_active',
          columnNames: ['cpl_id', 'channel_id', 'is_active'],
        }),
      );

      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_cpl_id',
          columnNames: ['cpl_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_channel_id',
          columnNames: ['channel_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_dates',
          columnNames: ['effective_date', 'expiry_date'],
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_agreements',
        new TableForeignKey({
          columnNames: ['cpl_id'],
          referencedTableName: 'cpls',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_agreements',
        new TableForeignKey({
          columnNames: ['channel_id'],
          referencedTableName: 'channels',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );
    }

    // 5. Create budget_allocations table (guarded because later migrations may already create/reshape it)
    const budgetAllocationsExists = await queryRunner.hasTable(
      'main.budget_allocations',
    );
    if (!budgetAllocationsExists) {
      await queryRunner.createTable(
        new Table({
          name: 'budget_allocations',
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
              name: 'on_invoice_budget',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'off_invoice_budget',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'utilized_on_invoice',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'utilized_off_invoice',
              type: 'decimal',
              precision: 18,
              scale: 2,
              default: 0,
              isNullable: false,
            },
            {
              name: 'alert_thresholds',
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
      );

      await queryRunner.createIndex(
        'main.budget_allocations',
        new TableIndex({
          name: 'IDX_budget_allocations_tenant_envelope',
          columnNames: ['tenant_id', 'envelope_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.budget_allocations',
        new TableIndex({
          name: 'IDX_budget_allocations_envelope_id',
          columnNames: ['envelope_id'],
        }),
      );

      await queryRunner.createForeignKey(
        'main.budget_allocations',
        new TableForeignKey({
          columnNames: ['envelope_id'],
          referencedTableName: 'budget_envelopes',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }

    // 6. Update plan_skus table - Add LTA and promo spend columns
    await queryRunner.addColumn(
      'main.plan_skus',
      new TableColumn({
        name: 'base_lta_on_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.plan_skus',
      new TableColumn({
        name: 'base_lta_off_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.plan_skus',
      new TableColumn({
        name: 'planned_lta_on_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.plan_skus',
      new TableColumn({
        name: 'planned_lta_off_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.plan_skus',
      new TableColumn({
        name: 'promo_on_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.plan_skus',
      new TableColumn({
        name: 'promo_off_invoice_spend',
        type: 'decimal',
        precision: 18,
        scale: 2,
        default: 0,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove columns from plan_skus
    await queryRunner.dropColumn('main.plan_skus', 'promo_off_invoice_spend');
    await queryRunner.dropColumn('main.plan_skus', 'promo_on_invoice_spend');
    await queryRunner.dropColumn(
      'main.plan_skus',
      'planned_lta_off_invoice_spend',
    );
    await queryRunner.dropColumn(
      'main.plan_skus',
      'planned_lta_on_invoice_spend',
    );
    await queryRunner.dropColumn(
      'main.plan_skus',
      'base_lta_off_invoice_spend',
    );
    await queryRunner.dropColumn('main.plan_skus', 'base_lta_on_invoice_spend');

    // Drop budget_allocations table
    await queryRunner.dropTable('main.budget_allocations');

    // Drop lta_agreements table
    await queryRunner.dropTable('main.lta_agreements');

    // Drop mechanic_spend_breakdown table
    await queryRunner.dropTable('main.mechanic_spend_breakdown');

    // Drop plan_mechanic_values table
    await queryRunner.dropTable('main.plan_mechanic_values');

    // Remove columns from mechanics
    await queryRunner.dropColumn('main.mechanics', 'input_constraints');
    await queryRunner.dropColumn('main.mechanics', 'applicability_rules');
    await queryRunner.dropColumn('main.mechanics', 'calculation_formula');
    await queryRunner.dropColumn('main.mechanics', 'spending_type');

    // Drop enum types
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."mechanics_spending_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."plan_mechanic_values_distribution_method_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."mechanic_spend_breakdown_distribution_basis_enum"`,
    );
  }
}
