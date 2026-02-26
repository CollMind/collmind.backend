import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import dataSource from './config/typeorm.config';
import { runAllSeeds } from './database/seeds';

async function bootstrap() {
  try {
    console.log('==========================================');
    console.log('Starting application bootstrap...');
    console.log('==========================================');
    console.log('Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_DATABASE: process.env.DB_DATABASE,
      DB_USERNAME: process.env.DB_USERNAME,
      DB_SCHEMA: process.env.DB_SCHEMA,
      JWT_SECRET: process.env.JWT_SECRET ? '***SET***' : 'NOT SET',
      JWT_EXPIRATION: process.env.JWT_EXPIRATION,
    });
    console.log('==========================================');

    console.log('Creating NestJS application...');
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });
    console.log('✅ AppModule created successfully');

    console.log('Setting up global validation pipe...');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    console.log('✅ Validation pipe configured');

    console.log('Setting up Swagger...');
    const config = new DocumentBuilder()
      .setTitle('CollMind TPM Backend')
      .setDescription('CollMind TPM Backend API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
    console.log('✅ Swagger configured');

    console.log('Setting up CORS...');
    app.enableCors({
      origin: true, // Allow all origins in development
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
      credentials: true,
    });
    console.log('✅ CORS configured');

    const port = process.env.PORT || 8080;
    // Use '0.0.0.0' for production/containers, 'localhost' for local development
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    const displayHost = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    console.log(`==========================================`);
    console.log(`Starting server on port ${port}...`);
    console.log(`==========================================`);
    await app.listen(port, host);
    console.log(`✅ Application is running on: http://${displayHost}:${port}`);
    console.log(`✅ Swagger documentation: http://${displayHost}:${port}/api`);
    console.log(`✅ Health check: http://${displayHost}:${port}/`);
    console.log(`==========================================`);

    // Run migrations and seeds after app starts (non-blocking)
    if (process.env.NODE_ENV === 'production') {
      console.log('Scheduling migrations and seeds...');
      runMigrationsAndSeeds().catch((error) => {
        console.error('❌ Migration/Seed failed:', error);
        // Don't exit - app is already running
      });
    }
  } catch (error) {
    console.error('==========================================');
    console.error('❌ Fatal error during bootstrap:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('==========================================');
    throw error;
  }
}

async function runMigrationsAndSeeds() {
  try {
    // Initialize DataSource if not already initialized
    if (!dataSource.isInitialized) {
      console.log('Initializing DataSource...');
      await dataSource.initialize();
      console.log('✅ DataSource initialized');
      
      // Set search_path to include main schema so migration table is created there
      const schema = process.env.DB_SCHEMA || 'main';
      try {
        await dataSource.query(`SET search_path TO "${schema}", public`);
        console.log(`✅ Search path set to "${schema}", public`);
      } catch (searchPathError) {
        console.log('⚠️  Could not set search_path:', searchPathError);
      }
    }

    const schema = process.env.DB_SCHEMA || 'main';
    console.log(`Using schema: ${schema}`);

    // Verify schema exists
    const schemaCheck = await dataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [schema]
    );
    if (schemaCheck.length === 0) {
      console.log(`⚠️  Schema "${schema}" does not exist, creating it...`);
      await dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      console.log(`✅ Schema "${schema}" created`);
    } else {
      console.log(`✅ Schema "${schema}" exists`);
    }

    // Check migration table in main schema (where it should be)
    const migrationsTableCheck = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [schema, 'migrations']
    );
    const migrationTableExists = migrationsTableCheck.length > 0;
    console.log(`Migration table exists in schema "${schema}": ${migrationTableExists}`);

    // Also check if migration table exists in public schema (old location)
    const publicMigrationsTableCheck = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      ['public', 'migrations']
    );
    if (publicMigrationsTableCheck.length > 0) {
      console.log('⚠️  Migration table found in "public" schema, moving to main schema...');
      try {
        // Move table from public to main schema
        await dataSource.query(`ALTER TABLE "public"."migrations" SET SCHEMA "${schema}"`);
        console.log(`✅ Migration table moved to "${schema}" schema`);
      } catch (error) {
        console.log('⚠️  Could not move migration table, will recreate:', error);
        await dataSource.query(`DROP TABLE IF EXISTS "public"."migrations" CASCADE`);
      }
    }

    // If migration table exists in main schema, verify its structure is correct
    if (migrationTableExists || publicMigrationsTableCheck.length > 0) {
      try {
        const finalSchema = migrationTableExists ? schema : 'public';
        const tableColumns = await dataSource.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
          [finalSchema, 'migrations']
        );
        console.log(`Migration table has ${tableColumns.length} columns`);
        
        // Expected columns: id, timestamp, name
        const expectedColumns = ['id', 'timestamp', 'name'];
        const actualColumns = tableColumns.map((col: any) => col.column_name);
        const hasCorrectStructure = expectedColumns.every(col => actualColumns.includes(col));
        
        if (!hasCorrectStructure) {
          console.log('⚠️  Migration table has incorrect structure. Dropping and recreating...');
          await dataSource.query(`DROP TABLE IF EXISTS "${schema}"."migrations" CASCADE`);
          await dataSource.query(`DROP TABLE IF EXISTS "public"."migrations" CASCADE`);
          console.log('✅ Migration table dropped');
        }
      } catch (error) {
        console.log('⚠️  Error checking migration table structure, will attempt to recreate:', error);
        // If we can't check the structure, try to drop and recreate
        try {
          await dataSource.query(`DROP TABLE IF EXISTS "${schema}"."migrations" CASCADE`);
          await dataSource.query(`DROP TABLE IF EXISTS "public"."migrations" CASCADE`);
          console.log('✅ Migration table dropped');
        } catch (dropError) {
          console.log('⚠️  Could not drop migration table:', dropError);
        }
      }
    }

    // Ensure migration table exists in main schema before running migrations
    // TypeORM creates it in public schema by default, so we need to create it in main schema first
    const migrationTableInMain = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [schema, 'migrations']
    );
    
    if (migrationTableInMain.length === 0) {
      console.log(`Creating migrations table in "${schema}" schema...`);
      try {
        await dataSource.query(`
          CREATE TABLE IF NOT EXISTS "${schema}"."migrations" (
            "id" SERIAL NOT NULL,
            "timestamp" bigint NOT NULL,
            "name" character varying NOT NULL,
            CONSTRAINT "PK_${schema}_migrations" PRIMARY KEY ("id")
          )
        `);
        console.log(`✅ Migrations table created in "${schema}" schema`);
      } catch (createError: any) {
        // If table creation fails, it might already exist or there's a constraint issue
        if (createError?.message?.includes('already exists')) {
          console.log(`⚠️  Migrations table might already exist, continuing...`);
        } else {
          console.log(`⚠️  Could not create migrations table in "${schema}" schema:`, createError);
        }
      }
    }

    // Check what migrations are available
    const availableMigrations = dataSource.migrations || [];
    console.log(`Found ${availableMigrations.length} migration file(s) available`);
    if (availableMigrations.length > 0) {
      console.log('Available migrations:');
      availableMigrations.forEach((migration) => {
        const migrationName = migration.constructor.name;
        console.log(`   - ${migrationName}`);
      });
    }

    // Run migrations with error handling for constraint conflicts
    console.log('Running database migrations...');
    let executedMigrations;
    try {
      executedMigrations = await dataSource.runMigrations();
      
      // After migrations run, move migration table from public to main schema if needed
      const publicTableCheck = await dataSource.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
        ['public', 'migrations']
      );
      const mainTableCheck = await dataSource.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
        [schema, 'migrations']
      );
      
      if (publicTableCheck.length > 0 && mainTableCheck.length === 0) {
        console.log(`Moving migrations table from "public" to "${schema}" schema...`);
        try {
          // Copy data from public to main
          const publicMigrations = await dataSource.query(`SELECT * FROM "public"."migrations"`);
          if (publicMigrations.length > 0) {
            await dataSource.query(`
              INSERT INTO "${schema}"."migrations" ("timestamp", "name")
              SELECT "timestamp", "name" FROM "public"."migrations"
              ON CONFLICT DO NOTHING
            `);
          }
          // Drop public table
          await dataSource.query(`DROP TABLE IF EXISTS "public"."migrations" CASCADE`);
          console.log(`✅ Migrations table moved to "${schema}" schema`);
        } catch (moveError) {
          console.log('⚠️  Could not move migrations table:', moveError);
        }
      }
    } catch (error: any) {
      // If error is about constraint already existing, drop and recreate the table
      if (error?.message?.includes('already exists') || error?.driverError?.message?.includes('already exists')) {
        console.log('⚠️  Constraint conflict detected. Dropping and recreating migrations table...');
        try {
          await dataSource.query(`DROP TABLE IF EXISTS "${schema}"."migrations" CASCADE`);
          await dataSource.query(`DROP TABLE IF EXISTS "public"."migrations" CASCADE`);
          console.log('✅ Migrations table dropped, retrying migrations...');
          executedMigrations = await dataSource.runMigrations();
        } catch (fixError) {
          console.error('❌ Failed to fix constraint issue:', fixError);
          throw error; // Re-throw original error
        }
      } else {
        throw error; // Re-throw if it's a different error
      }
    }
    console.log(`✅ Migrations completed successfully. Executed ${executedMigrations.length} migration(s)`);
    
    if (executedMigrations.length > 0) {
      executedMigrations.forEach((migration) => {
        console.log(`   - ${migration.name}`);
      });
    } else {
      console.log('   ℹ️  No new migrations to execute');
    }

    // Check which migrations have been executed (migrations table should be in main schema)
    let executedMigrationsList;
    try {
      executedMigrationsList = await dataSource.query(
        `SELECT * FROM "${schema}"."migrations" ORDER BY timestamp DESC LIMIT 10`
      );
    } catch (error) {
      // If table doesn't exist in main schema, try public schema
      try {
        executedMigrationsList = await dataSource.query(
          `SELECT * FROM "public"."migrations" ORDER BY timestamp DESC LIMIT 10`
        );
      } catch (publicError) {
        console.log('⚠️  Could not query migrations table:', publicError);
        executedMigrationsList = [];
      }
    }
    if (executedMigrationsList.length > 0) {
      console.log(`   ℹ️  Last ${executedMigrationsList.length} executed migration(s):`);
      executedMigrationsList.forEach((m: any) => {
        console.log(`      - ${m.name} (${new Date(parseInt(m.timestamp)).toISOString()})`);
      });
    }

    // Verify tenants table exists after migrations
    console.log('Verifying tenants table exists...');
    const tableCheck = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [schema, 'tenants']
    );
    
    if (tableCheck.length === 0) {
      console.log(`⚠️  Table "tenants" does not exist in schema "${schema}" after migrations!`);
      console.log('⚠️  This might mean migrations were marked as executed but tables were not created.');
      console.log('⚠️  Checking migration table status...');
      
      // Check if migrations table has entries
      let migrationEntries;
      try {
        migrationEntries = await dataSource.query(
          `SELECT * FROM "${schema}"."migrations" ORDER BY timestamp`
        );
      } catch (migrationError) {
        try {
          migrationEntries = await dataSource.query(
            `SELECT * FROM "public"."migrations" ORDER BY timestamp`
          );
        } catch (publicError) {
          migrationEntries = [];
        }
      }
      
      if (migrationEntries.length > 0) {
        console.log(`⚠️  Found ${migrationEntries.length} migration(s) marked as executed:`);
        migrationEntries.forEach((m: any) => {
          console.log(`   - ${m.name} (timestamp: ${m.timestamp})`);
        });
        console.log('⚠️  But tenants table does not exist. This indicates a problem.');
        console.log('⚠️  Attempting to re-run migrations by clearing migration table...');
        
        // Clear migration table and re-run migrations
        try {
          // Clear both main and public schema migration tables
          try {
            await dataSource.query(`DELETE FROM "${schema}"."migrations"`);
            console.log(`✅ Migration table cleared in "${schema}" schema`);
          } catch (mainError) {
            console.log(`⚠️  Could not clear migration table in "${schema}" schema:`, mainError);
          }
          try {
            await dataSource.query(`DELETE FROM "public"."migrations"`);
            console.log('✅ Migration table cleared in "public" schema');
          } catch (publicError) {
            console.log('⚠️  Could not clear migration table in "public" schema:', publicError);
          }
          
          // Re-run migrations
          console.log('Re-running migrations...');
          const reExecutedMigrations = await dataSource.runMigrations();
          console.log(`✅ Re-executed ${reExecutedMigrations.length} migration(s)`);
          
          // Verify tenants table again
          const retryTableCheck = await dataSource.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
            [schema, 'tenants']
          );
          
          if (retryTableCheck.length === 0) {
            throw new Error(`❌ Table "tenants" still does not exist in schema "${schema}" after re-running migrations!`);
          }
          console.log(`✅ Table "tenants" now exists in schema "${schema}"`);
        } catch (retryError) {
          console.error('❌ Failed to re-run migrations:', retryError);
          throw new Error(`❌ Table "tenants" does not exist in schema "${schema}" after migrations!`);
        }
      } else {
        throw new Error(`❌ Table "tenants" does not exist in schema "${schema}" after migrations! No migrations were executed.`);
      }
    } else {
      console.log(`✅ Table "tenants" exists in schema "${schema}"`);
    }

    // Wait 3 seconds before running seeds
    console.log('Waiting 3 seconds before running seeds...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Run seeds (using the same DataSource connection)
    console.log('Running database seeds...');
    await runAllSeeds(dataSource);
    console.log('✅ Seeds completed successfully');

    // Clean up connection
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('✅ DataSource connection closed');
    }
  } catch (error) {
    console.error('❌ Migration/Seed error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    // Clean up connection even on error
    if (dataSource.isInitialized) {
      try {
        await dataSource.destroy();
      } catch (destroyError) {
        console.error('Error destroying dataSource:', destroyError);
      }
    }
    throw error;
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});


