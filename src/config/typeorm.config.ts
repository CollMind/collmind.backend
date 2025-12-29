import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { SnakeCaseNamingStrategy } from '../database/strategies/snake-case-naming.strategy';

config();

const configService = new ConfigService();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: configService.get('DB_HOST'),
  port: configService.get('DB_PORT'),
  username: configService.get('DB_USERNAME'),
  password: configService.get('DB_PASSWORD'),
  database: configService.get('DB_DATABASE'),
  schema: configService.get('DB_SCHEMA') || 'main',
  entities: [__dirname + '/../database/entities/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/**/*{.ts,.js}'],
  synchronize: false, // PRODUCTION'DA MUTLAKA FALSE
  logging: configService.get('NODE_ENV') === 'development',
  namingStrategy: new SnakeCaseNamingStrategy(),
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;

