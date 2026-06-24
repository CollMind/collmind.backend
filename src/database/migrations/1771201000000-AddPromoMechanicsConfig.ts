import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPromoMechanicsConfig1771201000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."mechanics_category_enum" AS ENUM(
          'on_invoice_discount',
          'off_invoice_discount',
          'per_unit_support',
          'lumpsum_spend',
          'long_term_agreement'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."mechanics_input_type_enum" AS ENUM('percentage', 'currency', 'units', 'boolean');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."mechanics_budget_type_enum" AS ENUM('on_invoice', 'off_invoice', 'both', 'none');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."mechanics_formula_validation_status_enum" AS ENUM('pending', 'valid', 'invalid', 'error');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add category column
    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'category',
        type: 'enum',
        enum: [
          'on_invoice_discount',
          'off_invoice_discount',
          'per_unit_support',
          'lumpsum_spend',
          'long_term_agreement',
        ],
        enumName: 'mechanics_category_enum',
        isNullable: true,
      }),
    );

    // Add input configuration columns
    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'input_type',
        type: 'enum',
        enum: ['percentage', 'currency', 'units', 'boolean'],
        enumName: 'mechanics_input_type_enum',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'default_value',
        type: 'decimal',
        precision: 18,
        scale: 4,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'step_increment',
        type: 'decimal',
        precision: 18,
        scale: 4,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'decimal_places',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'unit_symbol',
        type: 'varchar',
        length: '10',
        isNullable: true,
      }),
    );

    // Add formula management columns
    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'formula_variables',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'formula_validation_status',
        type: 'enum',
        enum: ['pending', 'valid', 'invalid', 'error'],
        enumName: 'mechanics_formula_validation_status_enum',
        default: "'pending'",
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'test_data',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    // Add applicability rules columns
    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'applicable_channels',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'applicable_categories',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'applicable_cpls',
        type: 'uuid',
        isArray: true,
        isNullable: true,
      }),
    );

    // Update exclusion_rules if it doesn't exist (it should already exist from previous migration)
    // But we'll add it just in case
    const hasExclusionRules = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'mechanics' 
      AND column_name = 'exclusion_rules'
    `);

    if (hasExclusionRules.length === 0) {
      await queryRunner.addColumn(
        'main.mechanics',
        new TableColumn({
          name: 'exclusion_rules',
          type: 'jsonb',
          isNullable: true,
        }),
      );
    }

    // Add visibility and sorting columns
    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'show_in_grid',
        type: 'boolean',
        default: true,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'grid_column_order',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'grid_column_width',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'group_header',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
    );

    // Add budget and approval rules columns
    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'track_against_budget',
        type: 'boolean',
        default: true,
        isNullable: false,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'budget_type',
        type: 'enum',
        enum: ['on_invoice', 'off_invoice', 'both', 'none'],
        enumName: 'mechanics_budget_type_enum',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'requires_approval_threshold',
        type: 'decimal',
        precision: 18,
        scale: 2,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'approval_flow',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    // Add combination and constraint rules columns
    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'mutually_exclusive_with',
        type: 'text',
        isArray: true,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'max_combined_discount_percentage',
        type: 'decimal',
        precision: 5,
        scale: 2,
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.mechanics',
      new TableColumn({
        name: 'combination_warnings',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove columns in reverse order
    await queryRunner.dropColumn('main.mechanics', 'combination_warnings');
    await queryRunner.dropColumn(
      'main.mechanics',
      'max_combined_discount_percentage',
    );
    await queryRunner.dropColumn('main.mechanics', 'mutually_exclusive_with');
    await queryRunner.dropColumn('main.mechanics', 'approval_flow');
    await queryRunner.dropColumn(
      'main.mechanics',
      'requires_approval_threshold',
    );
    await queryRunner.dropColumn('main.mechanics', 'budget_type');
    await queryRunner.dropColumn('main.mechanics', 'track_against_budget');
    await queryRunner.dropColumn('main.mechanics', 'group_header');
    await queryRunner.dropColumn('main.mechanics', 'grid_column_width');
    await queryRunner.dropColumn('main.mechanics', 'grid_column_order');
    await queryRunner.dropColumn('main.mechanics', 'show_in_grid');
    await queryRunner.dropColumn('main.mechanics', 'applicable_cpls');
    await queryRunner.dropColumn('main.mechanics', 'applicable_categories');
    await queryRunner.dropColumn('main.mechanics', 'applicable_channels');
    await queryRunner.dropColumn('main.mechanics', 'test_data');
    await queryRunner.dropColumn('main.mechanics', 'formula_validation_status');
    await queryRunner.dropColumn('main.mechanics', 'formula_variables');
    await queryRunner.dropColumn('main.mechanics', 'unit_symbol');
    await queryRunner.dropColumn('main.mechanics', 'decimal_places');
    await queryRunner.dropColumn('main.mechanics', 'step_increment');
    await queryRunner.dropColumn('main.mechanics', 'default_value');
    await queryRunner.dropColumn('main.mechanics', 'input_type');
    await queryRunner.dropColumn('main.mechanics', 'category');

    // Drop enum types
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."mechanics_formula_validation_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."mechanics_budget_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."mechanics_input_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."mechanics_category_enum"`,
    );
  }
}
