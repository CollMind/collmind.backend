import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { PlanRepository } from './plan.repository';
import { ApprovalWorkflowService } from './approval-workflow.service';
import {
  Plan,
  PlanFu,
  PlanSku,
} from '../../../../database/entities/plan.entity';
import { PlanApprovalHistory } from '../../../../database/entities/plan-approval-history.entity';
import { ForecastingUnit } from '../../../../database/entities/forecasting-unit.entity';
import { Sku } from '../../../../database/entities/sku.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';
import { BudgetModule } from '../../../shared/budget/budget.module';
import { ApprovalModule } from '../../../shared/approval/approval.module';
import { KpiEngineModule } from '../../../shared/kpi-engine/kpi-engine.module';
import { SpendCalculationModule } from '../../../shared/spend-calculation/spend-calculation.module';
import { AccessScopeModule } from '../../../shared/access-scope/access-scope.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Plan,
      PlanFu,
      PlanSku,
      PlanApprovalHistory,
      ForecastingUnit,
      Sku,
      Tactic,
    ]),
    BudgetModule,
    ApprovalModule,
    KpiEngineModule,
    AccessScopeModule,
    forwardRef(() => SpendCalculationModule),
  ],
  controllers: [PlanController],
  providers: [PlanService, PlanRepository, ApprovalWorkflowService],
  exports: [PlanService, PlanRepository, ApprovalWorkflowService],
})
export class PlanModule {}
