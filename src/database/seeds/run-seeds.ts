import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { runAllSeeds } from './index';

config();

async function bootstrap() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'collmind_tpm',
    schema: process.env.DB_SCHEMA || 'main',
    entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
    synchronize: false,
  });

  let exitCode = 0;
  try {
    await dataSource.initialize();
    console.log('📦 Database connected\n');

    await runAllSeeds(dataSource);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    exitCode = 1;
  } finally {
    // Ensure database connection is always closed, even if an error occurred
    // Wrap destroy in try-catch to ensure we always exit even if cleanup fails
    try {
      if (dataSource && dataSource.isInitialized) {
        await dataSource.destroy();
        console.log('\n📦 Database connection closed');
      }
    } catch (cleanupError) {
      console.error('⚠️  Error during cleanup:', cleanupError);
      // Continue to exit even if cleanup fails
    }
    process.exit(exitCode);
  }
}

bootstrap();

