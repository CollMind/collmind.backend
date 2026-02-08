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
// Master Data module
import { MasterDataModule } from './modules/master-data/master-data.module';
// Planning-First mode modules
import { PlanModule } from './modules/modes/planning-first/plan/plan.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    // Shared core modules
    TenantModule,
    UserModule,
    CustomerModule,
    BudgetModule,
    NotificationModule,
    CommonModule,
    // Actuals-First mode modules
    AgreementModule,
    AgreementTransactionModule,
    LedgerModule,
    // Master Data module
    MasterDataModule,
    // Planning-First mode modules
    PlanModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

