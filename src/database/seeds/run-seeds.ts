import 'reflect-metadata';
import { config } from 'dotenv';
import dataSource from '../../config/typeorm.config';
import { runAllSeeds } from './index';

// Only load .env file if it exists (for local development)
// In Cloud Run, environment variables are set directly
config({ override: false });

async function bootstrap() {
  let exitCode = 0;
  try {
    // Initialize DataSource if not already initialized
    if (!dataSource.isInitialized) {
      console.log('📦 Initializing database connection...');
      await dataSource.initialize();
      console.log('📦 Database connected\n');
    } else {
      console.log('📦 Using existing database connection\n');
    }

    await runAllSeeds(dataSource);
    console.log('\n✅ Seed process completed successfully');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
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
