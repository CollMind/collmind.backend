import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UserModule } from './modules/user/user.module';
import { CustomerModule } from './modules/customer/customer.module';
// Shared modules
import { BudgetModule } from './modules/shared/budget/budget.module';
import { NotificationModule } from './modules/notification/notification.module';
import { CommonModule } from './common/common.module';
// Actuals-First mode modules
import { AgreementModule } from './modules/modes/actuals-first/agreement/agreement.module';
import { AgreementTransactionModule } from './modules/modes/actuals-first/agreement-transaction/agreement-transaction.module';
import { LedgerModule } from './modules/modes/actuals-first/ledger/ledger.module';
import { OnInvoiceModule } from './modules/modes/actuals-first/on-invoice/on-invoice.module';
import { ReversalModule } from './modules/modes/actuals-first/reversal/reversal.module';
import { SettlementModule } from './modules/modes/actuals-first/settlement/settlement.module';
import { SalesActualsModule } from './modules/modes/actuals-first/sales-actuals/sales-actuals.module';
// Master Data module
import { MasterDataModule } from './modules/master-data/master-data.module';
// Planning-First mode modules
import { PlanModule } from './modules/modes/planning-first/plan/plan.module';
// Shared KPI Engine
import { KpiEngineModule } from './modules/shared/kpi-engine/kpi-engine.module';
// Shared LTA Module
import { LTAModule } from './modules/shared/lta/lta.module';
// Shared Spend Calculation Module
import { SpendCalculationModule } from './modules/shared/spend-calculation/spend-calculation.module';
// Shared Finance Reporting Module
import { FinanceReportingModule } from './modules/shared/finance-reporting/finance-reporting.module';
// Shared Dashboard Module
import { DashboardModule } from './modules/shared/dashboard/dashboard.module';
// Admin Module
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // envFilePath is optional - Cloud Run sets env vars directly
      // For local development, .env file will be used if it exists
      envFilePath: process.env.NODE_ENV === 'production' ? undefined : '.env',
    }),
    DatabaseModule,
    // Shared core modules
    TenantModule,
    UserModule,
    CustomerModule,
    BudgetModule,
    NotificationModule,
    CommonModule,
    KpiEngineModule,
    LTAModule,
    SpendCalculationModule,
    FinanceReportingModule,
    DashboardModule,
    // Actuals-First mode modules
    AgreementModule,
    AgreementTransactionModule,
    LedgerModule,
    OnInvoiceModule,
    ReversalModule,
    SettlementModule,
    SalesActualsModule,
    // Master Data module
    MasterDataModule,
    // Planning-First mode modules
    PlanModule,
    // Admin Module
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
