import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementController } from './settlement.controller';
import { SettlementSummaryService } from './settlement-summary.service';
import { SettlementCloseService } from './settlement-close.service';
import { SettlementGuard } from './settlement.guard';
import { Agreement } from '../../../../database/entities/agreement.entity';
import { UserScope } from '../../../../database/entities/user-scope.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { CommonModule } from '../../../../common/common.module';
import { BudgetModule } from '../../../shared/budget/budget.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agreement, UserScope]),
    LedgerModule,
    CommonModule,
    BudgetModule,
  ],
  controllers: [SettlementController],
  providers: [
    SettlementSummaryService,
    SettlementCloseService,
    SettlementGuard,
  ],
  exports: [SettlementSummaryService, SettlementCloseService],
})
export class SettlementModule {}
