import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agreement } from '../../../../database/entities/agreement.entity';
import { AgreementService } from './agreement.service';
import { AgreementController } from './agreement.controller';
import { AgreementRepository } from './agreement.repository';
import { BudgetModule } from '../../../shared/budget/budget.module';
import { ApprovalModule } from '../../../shared/approval/approval.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agreement]),
    BudgetModule,
    ApprovalModule,
  ],
  controllers: [AgreementController],
  providers: [AgreementService, AgreementRepository],
  exports: [AgreementService, AgreementRepository],
})
export class AgreementModule {}


