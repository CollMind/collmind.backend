import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LTAAgreement } from '../../../database/entities/lta-agreement.entity';
import { LTARate } from '../../../database/entities/lta-rate.entity';
import { LTAPlanOverride } from '../../../database/entities/lta-plan-override.entity';
import { PlanSku } from '../../../database/entities/plan.entity';
import { Sku } from '../../../database/entities/sku.entity';
import { LTAAgreementController } from './lta-agreement.controller';
import { LTAAgreementService } from './lta-agreement.service';
import { LTACalculationService } from './lta-calculation.service';
import { LTAAgreementRepository } from './lta-agreement.repository';
import { MasterDataModule } from '../../master-data/master-data.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LTAAgreement,
      LTARate,
      LTAPlanOverride,
      PlanSku,
      Sku,
    ]),
    forwardRef(() => MasterDataModule),
  ],
  controllers: [LTAAgreementController],
  providers: [
    LTAAgreementService,
    LTACalculationService,
    LTAAgreementRepository,
  ],
  exports: [LTAAgreementService, LTACalculationService],
})
export class LTAModule {}
