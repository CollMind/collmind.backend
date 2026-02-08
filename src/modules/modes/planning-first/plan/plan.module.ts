import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { PlanRepository } from './plan.repository';
import { Plan, PlanFu, PlanSku } from '../../../../database/entities/plan.entity';
import { ForecastingUnit } from '../../../../database/entities/forecasting-unit.entity';
import { Sku } from '../../../../database/entities/sku.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';
import { BudgetModule } from '../../../shared/budget/budget.module';
import { ApprovalModule } from '../../../shared/approval/approval.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, PlanFu, PlanSku, ForecastingUnit, Sku, Tactic]),
    BudgetModule,
    ApprovalModule,
  ],
  controllers: [PlanController],
  providers: [PlanService, PlanRepository],
  exports: [PlanService, PlanRepository],
})
export class PlanModule {}
