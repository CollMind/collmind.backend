import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { SnakeCaseNamingStrategy } from '../database/strategies/snake-case-naming.strategy';
import { join } from 'path';
import { migrateDbCredentials } from './db-role-env';
// K-2.6.13 (B4): entity listesi artık BURADA TANIMLANMIYOR — bkz.
// `../database/entities/all-entities.ts` başındaki not. Bu dosya (CLI/seed
// giriş noktası) modül seviyesinde `migrateDbCredentials()` çalıştırır
// (aşağıda); `ALL_ENTITIES`'i burada tanımlamak, onu import eden HERKESİ
// (runtime dahil) o yan etkiye maruz bırakırdı. `all-entities.ts` yan
// etkisizdir — entity import etmek dışında hiçbir şey yapmaz.
import { ALL_ENTITIES } from '../database/entities/all-entities';

// Only load .env file if it exists (for local development)
// In Cloud Run, environment variables are set directly
config({ override: false });

const configService = new ConfigService();

// Helper function to get env var with fallback to ConfigService (for NestJS context)
function getEnvVar(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || configService.get(key) || defaultValue;
}

// K-2.6.13a/c: bu DataSource CLI migration komutları (`-d` flag'i,
// package.json'daki migration:*) VE `run-seeds.ts`'in seed girişi
// tarafından paylaşılır — ikisi de `app_migrate` ile koşar (S2: "seed bir
// kurulum işlemidir, runtime işlemi değil"). Runtime bağlantısı (NestJS
// uygulaması) BURADAN beslenmez — o `database.module.ts`'in kendi
// `app_runtime` kimlik bilgileriyle kurulur. K-2.6.13d: eksik/boş kimlik
// sessizce 'postgres'e düşmez, `migrateDbCredentials()` açık hata fırlatır.
const migrateCredentials = migrateDbCredentials();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: getEnvVar('DB_HOST') || 'localhost',
  port: parseInt(getEnvVar('DB_PORT') || '5432', 10),
  username: migrateCredentials.username,
  password: migrateCredentials.password,
  database: getEnvVar('DB_DATABASE') || '',
  schema: getEnvVar('DB_SCHEMA') || 'main',
  ssl: (() => {
    // Explicit SSL setting from environment variable
    const dbSsl = getEnvVar('DB_SSL');
    if (dbSsl === 'false' || dbSsl === '0') {
      return false;
    }
    // For production (Cloud SQL), use SSL
    if (getEnvVar('NODE_ENV') === 'production' && !dbSsl) {
      return { rejectUnauthorized: false };
    }
    // Default: no SSL for local development
    return false;
  })(),
  // Use explicit entity imports instead of path pattern for better reliability
  // T-224 / K-2.6.13(B4): kaynak `ALL_ENTITIES` —
  // `../database/entities/all-entities.ts` (bu dosyanın DIŞINDA, yan
  // etkisiz). `database.module.ts` (runtime) da aynı yerden okur.
  entities: ALL_ENTITIES,
  migrations: (() => {
    // Use glob pattern for both development and production
    // Development: src/database/migrations/**/*.ts
    // Production: dist/database/migrations/**/*.js
    const isProduction = getEnvVar('NODE_ENV') === 'production';

    if (isProduction) {
      // Production: use compiled JS files with glob pattern from dist
      // __dirname in production is dist/config, so we go up one level to dist, then to database/migrations
      const migrationsPath = join(
        __dirname,
        '..',
        'database',
        'migrations',
        '**',
        '*.js',
      );
      console.log(
        `🔍 Config: Production mode - Loading migrations from: ${migrationsPath}`,
      );
      console.log(`🔍 Config: __dirname=${__dirname}`);

      // Verify migrations directory exists (for debugging). Pre-existing (HEAD,
      // unrelated to T-211) — this file entered lint's changed-file scope only
      // because of the B dalgası entity import additions above.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      const migrationsDir = join(__dirname, '..', 'database', 'migrations');
      if (fs.existsSync(migrationsDir)) {
        const files = fs
          .readdirSync(migrationsDir)
          .filter((f: string) => f.endsWith('.js'));
        console.log(
          `🔍 Config: Found ${files.length} migration files in ${migrationsDir}`,
        );
        if (files.length === 0) {
          console.error(
            '❌ Config: WARNING - No .js migration files found in production!',
          );
        }
      } else {
        console.error(
          `❌ Config: ERROR - Migrations directory does not exist: ${migrationsDir}`,
        );
      }

      return [migrationsPath];
    } else {
      // Development: use TS files with glob pattern from src
      const migrationsPath = join(
        __dirname,
        '..',
        'database',
        'migrations',
        '**',
        '*.ts',
      );
      console.log(
        `🔍 Config: Development mode - Loading migrations from: ${migrationsPath}`,
      );
      return [migrationsPath];
    }
  })(),
  migrationsTableName: 'migrations',
  migrationsTransactionMode: 'each',
  synchronize: false, // PRODUCTION'DA MUTLAKA FALSE
  logging: getEnvVar('NODE_ENV') === 'development',
  namingStrategy: new SnakeCaseNamingStrategy(),
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
