import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { SnakeCaseNamingStrategy } from '../database/strategies/snake-case-naming.strategy';
// Import all entities explicitly to ensure they are loaded correctly
import { User } from '../database/entities/user.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { Customer } from '../database/entities/customer.entity';
import { BudgetEnvelope } from '../database/entities/budget-envelope.entity';
import { BudgetTransaction } from '../database/entities/budget-transaction.entity';
import { Notification } from '../database/entities/notification.entity';
import { AdminAuditLog } from '../database/entities/admin-audit-log.entity';
import { Agreement } from '../database/entities/agreement.entity';
import { ApprovalRequest } from '../database/entities/approval-request.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { AgreementTransaction } from '../database/entities/agreement-transaction.entity';
import { OnInvoiceEntry } from '../database/entities/on-invoice-entry.entity';
import { OnInvoiceBatch } from '../database/entities/on-invoice-batch.entity';
import { SalesActual } from '../database/entities/sales-actual.entity';
import { SalesActualBatch } from '../database/entities/sales-actual-batch.entity';
import { BudgetSummaryView } from '../database/entities/budget-summary.view-entity';
import { Brand } from '../database/entities/brand.entity';
import { Category } from '../database/entities/category.entity';
import { Channel } from '../database/entities/channel.entity';
import { Cpl } from '../database/entities/cpl.entity';
import { ForecastingUnit } from '../database/entities/forecasting-unit.entity';
import { GenericUnit } from '../database/entities/generic-unit.entity';
import { Mechanic } from '../database/entities/mechanic.entity';
import { Region } from '../database/entities/region.entity';
import { Sku } from '../database/entities/sku.entity';
import { Tactic } from '../database/entities/tactic.entity';
// B dalgası (T-211)
import { BudgetPolicy } from '../database/entities/budget-policy.entity';
import { ApprovalPolicy } from '../database/entities/approval-policy.entity';
import {
  Role,
  Capability,
  RoleCapability,
  UserRoleAssignment,
} from '../database/entities/role.entity';
import { Claim } from '../database/entities/claim.entity';
import { ClaimMatch } from '../database/entities/claim-match.entity';
import { TacticRealization } from '../database/entities/tactic-realization.entity';
import { FiscalPeriod } from '../database/entities/fiscal-period.entity';
import { Kpi } from '../database/entities/kpi.entity';
import { UserScope } from '../database/entities/user-scope.entity';
import { Plan, PlanFu, PlanSku } from '../database/entities/plan.entity';
import { PlanMechanicValue } from '../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../database/entities/mechanic-spend-breakdown.entity';
import { LTAAgreement } from '../database/entities/lta-agreement.entity';
import { LTARate } from '../database/entities/lta-rate.entity';
import { LTAPlanOverride } from '../database/entities/lta-plan-override.entity';
import { BudgetAllocation } from '../database/entities/budget-allocation.entity';
import { BudgetTransactionLog } from '../database/entities/budget-transaction-log.entity';
import { BudgetAlertConfiguration } from '../database/entities/budget-alert-configuration.entity';
import { PlanApprovalHistory } from '../database/entities/plan-approval-history.entity';
import { join } from 'path';

// Only load .env file if it exists (for local development)
// In Cloud Run, environment variables are set directly
config({ override: false });

const configService = new ConfigService();

// Helper function to get env var with fallback to ConfigService (for NestJS context)
function getEnvVar(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || configService.get(key) || defaultValue;
}

// T-224: bu, uygulamanın entity kaynağı için TEK KAYNAKTIR. CLI migration
// (`dataSourceOptions.entities` — aşağıda) VE runtime (`DatabaseModule`,
// `../database/database.module.ts`) buradan okur. `typeorm.config.ts` kanonik
// seçildi çünkü CLI'ın eksik bir entity'yi kaçırması sessizdir (şema eksik
// kalır), `DatabaseModule`'ün kaçırması gürültülüdür (bootstrap çöker) —
// ADR/ürün sahibi kararı: [[T-224]]. AYRI BİR SABİT olarak ihraç edilir,
// `dataSource.options.entities`'ten DEĞİL — yoksa tüketici bir `DataSource`
// örneği kurmak zorunda kalırdı.
export const ALL_ENTITIES = [
  // Shared entities
  User,
  Tenant,
  Customer,
  BudgetEnvelope,
  BudgetTransaction,
  Notification,
  AdminAuditLog,
  // View entities
  BudgetSummaryView,
  // Actuals-First entities
  Agreement,
  ApprovalRequest,
  LedgerEntry,
  AgreementTransaction,
  OnInvoiceEntry,
  OnInvoiceBatch,
  SalesActual,
  SalesActualBatch,
  // Master Data entities
  Brand,
  Category,
  Channel,
  Cpl,
  ForecastingUnit,
  GenericUnit,
  Mechanic,
  Region,
  Sku,
  Tactic,
  // KPI and User Scope entities
  Kpi,
  UserScope,
  // Planning-First entities
  Plan,
  PlanFu,
  PlanSku,
  PlanMechanicValue,
  MechanicSpendBreakdown,
  LTAAgreement,
  LTARate,
  LTAPlanOverride,
  BudgetAllocation,
  BudgetTransactionLog,
  BudgetAlertConfiguration,
  PlanApprovalHistory,
  // B dalgası (T-211)
  BudgetPolicy,
  ApprovalPolicy,
  Role,
  Capability,
  RoleCapability,
  UserRoleAssignment,
  Claim,
  ClaimMatch,
  TacticRealization,
  FiscalPeriod,
];

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: getEnvVar('DB_HOST') || 'localhost',
  port: parseInt(getEnvVar('DB_PORT') || '5432', 10),
  username: getEnvVar('DB_USERNAME') || 'postgres',
  password: getEnvVar('DB_PASSWORD') || '',
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
  // T-224: kaynak `ALL_ENTITIES` — bu dosyanın üstünde ihraç edilen tek liste.
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
