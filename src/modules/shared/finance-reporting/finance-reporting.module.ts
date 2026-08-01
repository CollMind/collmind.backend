import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceReportingService } from './finance-reporting.service';
import { FinanceReportingController } from './finance-reporting.controller';
import { Plan, PlanFu, PlanSku } from '../../../database/entities/plan.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { BudgetAllocation } from '../../../database/entities/budget-allocation.entity';
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
      BudgetAllocation,
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
