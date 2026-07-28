import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agreement } from '../../../../database/entities/agreement.entity';
import { AgreementService } from './agreement.service';
import { AgreementController } from './agreement.controller';
import { AgreementRepository } from './agreement.repository';
import { BudgetModule } from '../../../shared/budget/budget.module';
import { ApprovalModule } from '../../../shared/approval/approval.module';
import { KpiEngineModule } from '../../../shared/kpi-engine/kpi-engine.module';
import { MasterDataModule } from '../../../master-data/master-data.module';
import { AccessScopeModule } from '../../../shared/access-scope/access-scope.module';
import { CommonModule } from '../../../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agreement]),
    BudgetModule,
    ApprovalModule,
    KpiEngineModule,
    MasterDataModule,
    AccessScopeModule,
    CommonModule,
  ],
  controllers: [AgreementController],
  providers: [AgreementService, AgreementRepository],
  exports: [AgreementService, AgreementRepository],
})
export class AgreementModule {}
