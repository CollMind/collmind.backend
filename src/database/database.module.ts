import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SnakeCaseNamingStrategy } from './strategies/snake-case-naming.strategy';
import { User } from './entities/user.entity';
import { Tenant } from './entities/tenant.entity';
import { Customer } from './entities/customer.entity';
import { BudgetEnvelope } from './entities/budget-envelope.entity';
import { BudgetTransaction } from './entities/budget-transaction.entity';
import { Notification } from './entities/notification.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
// Actuals-First entities
import { Agreement } from './entities/agreement.entity';
import { ApprovalRequest } from './entities/approval-request.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { AgreementTransaction } from './entities/agreement-transaction.entity';
import { OnInvoiceEntry } from './entities/on-invoice-entry.entity';
import { OnInvoiceBatch } from './entities/on-invoice-batch.entity';
import { SalesActual } from './entities/sales-actual.entity';
import { SalesActualBatch } from './entities/sales-actual-batch.entity';
import { BudgetSummaryView } from './entities/budget-summary.view-entity';
// Master Data entities
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
} from './entities';
// KPI and User Scope entities
import { Kpi } from './entities/kpi.entity';
import { UserScope } from './entities/user-scope.entity';
// Planning-First entities
import { Plan, PlanFu, PlanSku } from './entities/plan.entity';
import { PlanMechanicValue } from './entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from './entities/mechanic-spend-breakdown.entity';
import { LTAAgreement } from './entities/lta-agreement.entity';
import { LTARate } from './entities/lta-rate.entity';
import { LTAPlanOverride } from './entities/lta-plan-override.entity';
import { BudgetAllocation } from './entities/budget-allocation.entity';
import { BudgetTransactionLog } from './entities/budget-transaction-log.entity';
import { BudgetAlertConfiguration } from './entities/budget-alert-configuration.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbConfig = {
          type: 'postgres' as const,
          host: configService.get('DB_HOST'),
          port: parseInt(configService.get('DB_PORT') || '5432', 10),
          username: configService.get('DB_USERNAME'),
          password: configService.get('DB_PASSWORD'),
          database: configService.get('DB_DATABASE'),
          schema: configService.get('DB_SCHEMA') || 'main',
          // Retry mechanism for Cloud Run (VPC connections can be slow)
          retryAttempts: 5,
          retryDelay: 3000, // 3 seconds between retries
          // Connection pool settings for Cloud Run
          extra: {
            max: 10, // Maximum number of connections in the pool
            connectionTimeoutMillis: 60000, // 60 seconds timeout (increased for VPC)
            idleTimeoutMillis: 30000,
            statement_timeout: 30000,
          },
        };

        console.log('Database configuration:', {
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          schema: dbConfig.schema,
          username: dbConfig.username,
        });

        return {
          ...dbConfig,
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
          ],
          synchronize: false,
          logging: configService.get('NODE_ENV') === 'development',
          namingStrategy: new SnakeCaseNamingStrategy(),
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
