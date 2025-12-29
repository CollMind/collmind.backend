import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dataSource from '../../config/typeorm.config';
import { runSeeds } from './index';

async function bootstrap() {
  let connection: DataSource | null = null;

  try {
    console.log('🔌 Connecting to database...');
    connection = await dataSource.initialize();
    console.log('✅ Database connected successfully\n');

    await runSeeds(connection);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error running seeds:', error);
    process.exit(1);
  } finally {
    if (connection && connection.isInitialized) {
      await connection.destroy();
      console.log('\n🔌 Database connection closed');
    }
  }
}

bootstrap();

