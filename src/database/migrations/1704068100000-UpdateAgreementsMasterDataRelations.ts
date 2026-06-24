import { MigrationInterface, QueryRunner, TableForeignKey } from 'typeorm';

export class UpdateAgreementsMasterDataRelations1704068100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add channel_id column if it doesn't exist
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'main' 
          AND table_name = 'agreements' 
          AND column_name = 'channel_id'
        ) THEN
          ALTER TABLE "main"."agreements"
          ADD COLUMN "channel_id" uuid;
          
          -- Migrate existing channel string values to channel_id
          -- This assumes channels table has been populated
          -- For now, we'll leave it nullable and require manual migration
        END IF;
      END $$;
    `);

    // Drop old channel column if it exists (after channel_id is added and foreign key is created)
    // We'll do this at the end after all foreign keys are created
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'main' 
          AND table_name = 'agreements' 
          AND column_name = 'channel'
          AND column_name != 'channel_id'
        ) THEN
          -- First, make it nullable to avoid constraint issues
          ALTER TABLE "main"."agreements"
          ALTER COLUMN "channel" DROP NOT NULL;
          
          -- Then drop the column
          ALTER TABLE "main"."agreements"
          DROP COLUMN "channel";
        END IF;
      END $$;
    `);

    // Helper function to create foreign key with error handling
    const createForeignKeySafely = async (
      tableName: string,
      columnNames: string[],
      referencedTableName: string,
      referencedColumnNames: string[],
      onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL' = 'RESTRICT',
      cleanupQuery?: string,
    ): Promise<boolean> => {
      try {
        // Clean up invalid references if cleanup query provided
        if (cleanupQuery) {
          const invalidRecords = await queryRunner.query(cleanupQuery);
          if (invalidRecords && invalidRecords.length > 0) {
            const ids = invalidRecords.map((r: any) => r.id);
            await queryRunner.query(
              `DELETE FROM ${tableName} WHERE id = ANY($1::uuid[])`,
              [ids],
            );
            console.log(
              `✅ Cleaned up ${invalidRecords.length} invalid references for ${columnNames.join(', ')}`,
            );
          }
        }

        // Check if foreign key already exists
        const table = await queryRunner.getTable(tableName);
        if (table) {
          const existingFk = table.foreignKeys.find(
            (fk) =>
              fk.columnNames.length === columnNames.length &&
              fk.columnNames.every((col, idx) => col === columnNames[idx]) &&
              fk.referencedTableName === referencedTableName,
          );
          if (existingFk) {
            console.log(
              `ℹ️  Foreign key for ${columnNames.join(', ')} already exists`,
            );
            return true;
          }
        }

        // Create foreign key
        await queryRunner.createForeignKey(
          tableName,
          new TableForeignKey({
            columnNames,
            referencedColumnNames,
            referencedTableName,
            onDelete,
          }),
        );
        console.log(`✅ Foreign key created for ${columnNames.join(', ')}`);
        return true;
      } catch (error: any) {
        // If it's a constraint violation, it means invalid data still exists
        if (
          error?.code === '23503' ||
          error?.message?.includes('violates foreign key constraint')
        ) {
          console.error(
            `❌ Cannot create foreign key for ${columnNames.join(', ')}: Invalid data exists. ` +
              `Please clean up invalid ${columnNames.join(', ')} values manually.`,
          );
          return false;
        }
        // Other errors (e.g., table doesn't exist, FK already exists)
        console.log(
          `⚠️  Foreign key creation skipped for ${columnNames.join(', ')}:`,
          error.message,
        );
        return false;
      }
    };

    // Add foreign keys for master data entities
    // Note: These will only be created if the referenced tables exist

    // First, drop any existing foreign key on cpl_id that might reference customers
    const table = await queryRunner.getTable('main.agreements');
    if (table) {
      const existingCustomerFk = table.foreignKeys.find(
        (fk) =>
          fk.columnNames.indexOf('cpl_id') !== -1 &&
          fk.referencedTableName === 'main.customers',
      );
      if (existingCustomerFk) {
        await queryRunner.dropForeignKey('main.agreements', existingCustomerFk);
        console.log('✅ Dropped existing customer foreign key on cpl_id');
      }
    }

    // CPL foreign key (required, so invalid agreements must be deleted)
    const cplsTableExists = await queryRunner.hasTable('main.cpls');
    if (cplsTableExists) {
      await createForeignKeySafely(
        'main.agreements',
        ['cpl_id'],
        'main.cpls',
        ['id'],
        'RESTRICT',
        `
          SELECT id, agreement_code, cpl_id
          FROM main.agreements
          WHERE cpl_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM main.cpls c WHERE c.id = cpl_id)
        `,
      );
    }

    // Channel foreign key
    const channelsTableExists = await queryRunner.hasTable('main.channels');
    if (channelsTableExists) {
      await createForeignKeySafely(
        'main.agreements',
        ['channel_id'],
        'main.channels',
        ['id'],
        'RESTRICT',
        `
          SELECT id, agreement_code, channel_id
          FROM main.agreements
          WHERE channel_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM main.channels c WHERE c.id = channel_id)
        `,
      );
    }

    // Region foreign key (nullable, so invalid values can be set to NULL)
    const regionsTableExists = await queryRunner.hasTable('main.regions');
    if (regionsTableExists) {
      // For nullable columns, set invalid values to NULL instead of deleting
      await queryRunner.query(`
        UPDATE main.agreements
        SET region_id = NULL
        WHERE region_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM main.regions r WHERE r.id = region_id)
      `);
      await createForeignKeySafely(
        'main.agreements',
        ['region_id'],
        'main.regions',
        ['id'],
        'SET NULL',
      );
    }

    // Category foreign key (nullable)
    const categoriesTableExists = await queryRunner.hasTable('main.categories');
    if (categoriesTableExists) {
      await queryRunner.query(`
        UPDATE main.agreements
        SET category_id = NULL
        WHERE category_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM main.categories c WHERE c.id = category_id)
      `);
      await createForeignKeySafely(
        'main.agreements',
        ['category_id'],
        'main.categories',
        ['id'],
        'SET NULL',
      );
    }

    // Generic Unit foreign key (nullable)
    const guTableExists = await queryRunner.hasTable('main.generic_units');
    if (guTableExists) {
      await queryRunner.query(`
        UPDATE main.agreements
        SET gu_id = NULL
        WHERE gu_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM main.generic_units g WHERE g.id = gu_id)
      `);
      await createForeignKeySafely(
        'main.agreements',
        ['gu_id'],
        'main.generic_units',
        ['id'],
        'SET NULL',
      );
    }

    // Forecasting Unit foreign key (required, so invalid agreements must be deleted)
    const fuTableExists = await queryRunner.hasTable('main.forecasting_units');
    if (fuTableExists) {
      await createForeignKeySafely(
        'main.agreements',
        ['fu_id'],
        'main.forecasting_units',
        ['id'],
        'RESTRICT',
        `
          SELECT id FROM main.agreements
          WHERE fu_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM main.forecasting_units f WHERE f.id = fu_id)
        `,
      );
    }

    // Tactic foreign key (required)
    const tacticTableExists = await queryRunner.hasTable('main.tactics');
    if (tacticTableExists) {
      await createForeignKeySafely(
        'main.agreements',
        ['tactic_id'],
        'main.tactics',
        ['id'],
        'RESTRICT',
        `
          SELECT id FROM main.agreements
          WHERE tactic_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM main.tactics t WHERE t.id = tactic_id)
        `,
      );
    }

    // Mechanic foreign key (required)
    const mechanicTableExists = await queryRunner.hasTable('main.mechanics');
    if (mechanicTableExists) {
      await createForeignKeySafely(
        'main.agreements',
        ['mechanic_id'],
        'main.mechanics',
        ['id'],
        'RESTRICT',
        `
          SELECT id FROM main.agreements
          WHERE mechanic_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM main.mechanics m WHERE m.id = mechanic_id)
        `,
      );
    }

    // Drop old channel column if it exists (after all foreign keys are created)
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'main' 
          AND table_name = 'agreements' 
          AND column_name = 'channel'
          AND column_name != 'channel_id'
        ) THEN
          -- First, make it nullable to avoid constraint issues
          ALTER TABLE "main"."agreements"
          ALTER COLUMN "channel" DROP NOT NULL;
          
          -- Then drop the column
          ALTER TABLE "main"."agreements"
          DROP COLUMN "channel";
        END IF;
      END $$;
    `);
    console.log('✅ Dropped old channel column from agreements table');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys
    const foreignKeys = [
      { table: 'main.agreements', column: 'cpl_id', refTable: 'main.cpls' },
      {
        table: 'main.agreements',
        column: 'channel_id',
        refTable: 'main.channels',
      },
      {
        table: 'main.agreements',
        column: 'region_id',
        refTable: 'main.regions',
      },
      {
        table: 'main.agreements',
        column: 'category_id',
        refTable: 'main.categories',
      },
      {
        table: 'main.agreements',
        column: 'gu_id',
        refTable: 'main.generic_units',
      },
      {
        table: 'main.agreements',
        column: 'fu_id',
        refTable: 'main.forecasting_units',
      },
      {
        table: 'main.agreements',
        column: 'tactic_id',
        refTable: 'main.tactics',
      },
      {
        table: 'main.agreements',
        column: 'mechanic_id',
        refTable: 'main.mechanics',
      },
    ];

    for (const fk of foreignKeys) {
      try {
        const table = await queryRunner.getTable(fk.table);
        if (table) {
          const foreignKey = table.foreignKeys.find(
            (key) => key.columnNames.indexOf(fk.column) !== -1,
          );
          if (foreignKey) {
            await queryRunner.dropForeignKey(fk.table, foreignKey);
          }
        }
      } catch (error) {
        console.log(`Error dropping foreign key for ${fk.column}:`, error);
      }
    }

    // Re-add old channel column if it was dropped
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'main' 
          AND table_name = 'agreements' 
          AND column_name = 'channel'
        ) THEN
          ALTER TABLE "main"."agreements"
          ADD COLUMN "channel" varchar(30) NOT NULL;
        END IF;
      END $$;
    `);

    // Drop channel_id column if it exists
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'main' 
          AND table_name = 'agreements' 
          AND column_name = 'channel_id'
        ) THEN
          ALTER TABLE "main"."agreements"
          DROP COLUMN "channel_id";
        END IF;
      END $$;
    `);
  }
}
