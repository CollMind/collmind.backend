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
import { BudgetSummaryView } from '../database/entities/budget-summary.view-entity';
import {
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
} from '../database/entities';
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

// Only load .env file if it exists (for local development)
// In Cloud Run, environment variables are set directly
config({ override: false });

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
  ssl: getEnvVar('NODE_ENV') === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
  // Use explicit entity imports instead of path pattern for better reliability
  entities: [
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
  ],
  migrations: [__dirname + '/../database/migrations/**/*{.ts,.js}'],
  synchronize: false, // PRODUCTION'DA MUTLAKA FALSE
  logging: getEnvVar('NODE_ENV') === 'development',
  namingStrategy: new SnakeCaseNamingStrategy(),
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;

