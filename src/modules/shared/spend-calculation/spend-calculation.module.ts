import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanSku, PlanFu, Plan } from '../../../database/entities/plan.entity';
import { Mechanic } from '../../../database/entities/mechanic.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { SpendCalculationService } from './spend-calculation.service';
import { SpendDistributionService } from './spend-distribution.service';
import { SpendValidationService } from './spend-validation.service';
import { SpendCalculationController } from './spend-calculation.controller';
import { LTAModule } from '../lta/lta.module';
import { MasterDataModule } from '../../master-data/master-data.module';
import { BudgetModule } from '../budget/budget.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanSku,
      PlanFu,
      Plan,
      Mechanic,
      PlanMechanicValue,
      MechanicSpendBreakdown,
    ]),
    LTAModule,
    MasterDataModule,
    BudgetModule,
  ],
  controllers: [SpendCalculationController],
  providers: [SpendCalculationService, SpendDistributionService, SpendValidationService],
  exports: [SpendCalculationService, SpendDistributionService, SpendValidationService],
})
export class SpendCalculationModule {}
