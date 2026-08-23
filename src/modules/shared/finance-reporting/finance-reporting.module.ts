import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceReportingService } from './finance-reporting.service';
import { FinanceReportingController } from './finance-reporting.controller';
import { Plan, PlanFu, PlanSku } from '../../../database/entities/plan.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { BudgetEnvelope } from '../../../database/entities/budget-envelope.entity';
import { BudgetModule } from '../budget/budget.module';
import { AccessScopeModule } from '../access-scope/access-scope.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Plan,
      PlanFu,
      PlanSku,
      PlanMechanicValue,
      MechanicSpendBreakdown,
      // T-270/Z21: `BudgetAllocation` removed — `FinanceReportingService` no
      // longer reads `budget_allocations` (retired, K-2.2.3 violation; see
      // Z21 karar kaydı). `budget-allocation.controller.ts`'s own module
      // registration (`BudgetModule`) is untouched by this.
      BudgetEnvelope,
    ]),
    BudgetModule,
    AccessScopeModule,
  ],
  controllers: [FinanceReportingController],
  providers: [FinanceReportingService],
  exports: [FinanceReportingService],
})
export class FinanceReportingModule {}
