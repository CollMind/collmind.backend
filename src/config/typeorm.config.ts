import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { SnakeCaseNamingStrategy } from '../database/strategies/snake-case-naming.strategy';

config();

const configService = new ConfigService();

// Helper function to get env var with fallback to ConfigService (for NestJS context)
function getEnvVar(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || configService.get(key) || defaultValue;
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: getEnvVar('DB_HOST') || 'localhost',
  port: parseInt(getEnvVar('DB_PORT') || '5432', 10),
  username: getEnvVar('DB_USERNAME') || 'postgres',
  password: getEnvVar('DB_PASSWORD') || '',
  database: getEnvVar('DB_DATABASE') || '',
  schema: getEnvVar('DB_SCHEMA') || 'main',
  entities: [__dirname + '/../database/entities/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/**/*{.ts,.js}'],
  synchronize: false, // PRODUCTION'DA MUTLAKA FALSE
  logging: getEnvVar('NODE_ENV') === 'development',
  namingStrategy: new SnakeCaseNamingStrategy(),
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;

