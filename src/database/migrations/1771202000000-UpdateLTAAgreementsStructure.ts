import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class UpdateLTAAgreementsStructure1771202000000 implements MigrationInterface {
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

    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."lta_agreements_status_enum" AS ENUM('draft', 'active', 'expired', 'terminated');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Check if lta_agreements table exists and has old structure
    const tableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'main' 
        AND table_name = 'lta_agreements'
      );
    `);

    if (tableExists[0].exists) {
      // Drop old foreign keys and indexes
      const foreignKeys = await queryRunner.query(`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_schema = 'main' 
        AND table_name = 'lta_agreements' 
        AND constraint_type = 'FOREIGN KEY'
      `);

      for (const fk of foreignKeys) {
        await queryRunner.query(
          `ALTER TABLE "main"."lta_agreements" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`,
        );
      }

      // Drop old columns if they exist
      await queryRunner.query(`
        ALTER TABLE "main"."lta_agreements" 
        DROP COLUMN IF EXISTS "channel_id",
        DROP COLUMN IF EXISTS "on_invoice_percentage",
        DROP COLUMN IF EXISTS "off_invoice_percentage",
        DROP COLUMN IF EXISTS "is_active",
        DROP COLUMN IF EXISTS "description";
      `);
    } else {
      // Create table if it doesn't exist
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
    }

    // Add new columns to lta_agreements
    const hasAgreementName = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND column_name = 'agreement_name'
    `);

    if (hasAgreementName.length === 0) {
      await queryRunner.addColumn(
        'main.lta_agreements',
        new TableColumn({
          name: 'agreement_name',
          type: 'varchar',
          length: '200',
          isNullable: false,
        }),
      );
    }

    const hasAgreementCode = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND column_name = 'agreement_code'
    `);

    if (hasAgreementCode.length === 0) {
      await queryRunner.addColumn(
        'main.lta_agreements',
        new TableColumn({
          name: 'agreement_code',
          type: 'varchar',
          length: '100',
          isNullable: false,
        }),
      );
    }

    const hasStatus = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND column_name = 'status'
    `);

    if (hasStatus.length === 0) {
      await queryRunner.addColumn(
        'main.lta_agreements',
        new TableColumn({
          name: 'status',
          type: 'enum',
          enum: ['draft', 'active', 'expired', 'terminated'],
          enumName: 'lta_agreements_status_enum',
          default: "'draft'",
          isNullable: false,
        }),
      );
    }

    const hasTotalAgreementValue = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND column_name = 'total_agreement_value'
    `);

    if (hasTotalAgreementValue.length === 0) {
      await queryRunner.addColumn(
        'main.lta_agreements',
        new TableColumn({
          name: 'total_agreement_value',
          type: 'decimal',
          precision: 18,
          scale: 2,
          isNullable: true,
        }),
      );
    }

    const hasNotes = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND column_name = 'notes'
    `);

    if (hasNotes.length === 0) {
      await queryRunner.addColumn(
        'main.lta_agreements',
        new TableColumn({
          name: 'notes',
          type: 'text',
          isNullable: true,
        }),
      );
    }

    // Update effective_date and expiry_date if they don't exist
    const hasEffectiveDate = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND column_name = 'effective_date'
    `);

    if (hasEffectiveDate.length === 0) {
      await queryRunner.addColumn(
        'main.lta_agreements',
        new TableColumn({
          name: 'effective_date',
          type: 'date',
          isNullable: false,
        }),
      );
    }

    const hasExpiryDate = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND column_name = 'expiry_date'
    `);

    if (hasExpiryDate.length === 0) {
      await queryRunner.addColumn(
        'main.lta_agreements',
        new TableColumn({
          name: 'expiry_date',
          type: 'date',
          isNullable: true,
        }),
      );
    }

    // Create indexes (check if they exist first)
    const existingIndexes = await queryRunner.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'main' 
      AND tablename = 'lta_agreements'
    `);
    const indexNames = existingIndexes.map((idx: any) => idx.indexname);

    if (!indexNames.includes('IDX_lta_agreements_tenant_code')) {
      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_tenant_code',
          columnNames: ['tenant_id', 'agreement_code'],
          isUnique: true,
        }),
      );
    }

    if (!indexNames.includes('IDX_lta_agreements_cpl_status')) {
      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_cpl_status',
          columnNames: ['cpl_id', 'status'],
        }),
      );
    }

    if (!indexNames.includes('IDX_lta_agreements_dates')) {
      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_dates',
          columnNames: ['effective_date', 'expiry_date'],
        }),
      );
    }

    if (!indexNames.includes('IDX_lta_agreements_status')) {
      await queryRunner.createIndex(
        'main.lta_agreements',
        new TableIndex({
          name: 'IDX_lta_agreements_status',
          columnNames: ['status'],
        }),
      );
    }

    // Create foreign key for CPL
    const hasCplFk = await queryRunner.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_schema = 'main' 
      AND table_name = 'lta_agreements' 
      AND constraint_name LIKE '%cpl%'
    `);

    if (hasCplFk.length === 0) {
      await queryRunner.createForeignKey(
        'main.lta_agreements',
        new TableForeignKey({
          columnNames: ['cpl_id'],
          referencedTableName: 'cpls',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );
    }

    // Create lta_rates table
    const ltaRatesExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'main' 
        AND table_name = 'lta_rates'
      );
    `);

    if (!ltaRatesExists[0].exists) {
      await queryRunner.createTable(
        new Table({
          name: 'lta_rates',
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
              name: 'lta_agreement_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'channel_id',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'channel',
              type: 'varchar',
              length: '100',
              isNullable: false,
            },
            {
              name: 'category_id',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'category',
              type: 'varchar',
              length: '100',
              isNullable: false,
            },
            {
              name: 'on_invoice_percentage',
              type: 'decimal',
              precision: 5,
              scale: 2,
              isNullable: false,
            },
            {
              name: 'off_invoice_percentage',
              type: 'decimal',
              precision: 5,
              scale: 2,
              isNullable: false,
            },
            {
              name: 'minimum_volume_commitment',
              type: 'decimal',
              precision: 18,
              scale: 3,
              isNullable: true,
            },
            {
              name: 'maximum_discount_cap',
              type: 'decimal',
              precision: 18,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'payment_terms',
              type: 'varchar',
              length: '50',
              isNullable: true,
            },
            {
              name: 'is_active',
              type: 'boolean',
              default: true,
              isNullable: false,
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

      // Create unique index on agreement + channel + category (using string columns)
      await queryRunner.createIndex(
        'main.lta_rates',
        new TableIndex({
          name: 'IDX_lta_rates_agreement_channel_category',
          columnNames: ['lta_agreement_id', 'channel', 'category'],
          isUnique: true,
        }),
      );

      await queryRunner.createIndex(
        'main.lta_rates',
        new TableIndex({
          name: 'IDX_lta_rates_agreement_id',
          columnNames: ['lta_agreement_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.lta_rates',
        new TableIndex({
          name: 'IDX_lta_rates_channel_id',
          columnNames: ['channel_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.lta_rates',
        new TableIndex({
          name: 'IDX_lta_rates_category_id',
          columnNames: ['category_id'],
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_rates',
        new TableForeignKey({
          columnNames: ['lta_agreement_id'],
          referencedTableName: 'lta_agreements',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_rates',
        new TableForeignKey({
          columnNames: ['channel_id'],
          referencedTableName: 'channels',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_rates',
        new TableForeignKey({
          columnNames: ['category_id'],
          referencedTableName: 'categories',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );
    }

    // Create lta_plan_overrides table
    const ltaPlanOverridesExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'main' 
        AND table_name = 'lta_plan_overrides'
      );
    `);

    if (!ltaPlanOverridesExists[0].exists) {
      await queryRunner.createTable(
        new Table({
          name: 'lta_plan_overrides',
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
              name: 'lta_rate_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'lta_agreement_id',
              type: 'uuid',
              isNullable: false,
            },
            {
              name: 'override_on_invoice_pct',
              type: 'decimal',
              precision: 5,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'override_off_invoice_pct',
              type: 'decimal',
              precision: 5,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'override_reason',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'approved_by',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'approved_at',
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
        'main.lta_plan_overrides',
        new TableIndex({
          name: 'IDX_lta_plan_overrides_plan_rate',
          columnNames: ['plan_id', 'lta_rate_id'],
          isUnique: true,
        }),
      );

      await queryRunner.createIndex(
        'main.lta_plan_overrides',
        new TableIndex({
          name: 'IDX_lta_plan_overrides_plan_id',
          columnNames: ['plan_id'],
        }),
      );

      await queryRunner.createIndex(
        'main.lta_plan_overrides',
        new TableIndex({
          name: 'IDX_lta_plan_overrides_lta_rate_id',
          columnNames: ['lta_rate_id'],
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_plan_overrides',
        new TableForeignKey({
          columnNames: ['plan_id'],
          referencedTableName: 'plans',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_plan_overrides',
        new TableForeignKey({
          columnNames: ['lta_rate_id'],
          referencedTableName: 'lta_rates',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_plan_overrides',
        new TableForeignKey({
          columnNames: ['lta_agreement_id'],
          referencedTableName: 'lta_agreements',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );

      await queryRunner.createForeignKey(
        'main.lta_plan_overrides',
        new TableForeignKey({
          columnNames: ['approved_by'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop lta_plan_overrides table
    await queryRunner.dropTable('main.lta_plan_overrides');

    // Drop lta_rates table
    await queryRunner.dropTable('main.lta_rates');

    // Remove new columns from lta_agreements (keep base structure)
    await queryRunner.dropColumn('main.lta_agreements', 'notes');
    await queryRunner.dropColumn(
      'main.lta_agreements',
      'total_agreement_value',
    );
    await queryRunner.dropColumn('main.lta_agreements', 'status');
    await queryRunner.dropColumn('main.lta_agreements', 'agreement_code');
    await queryRunner.dropColumn('main.lta_agreements', 'agreement_name');

    // Drop enum type
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."lta_agreements_status_enum"`,
    );
  }
}
