import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementController } from './settlement.controller';
import { SettlementSummaryService } from './settlement-summary.service';
import { SettlementCloseService } from './settlement-close.service';
import { SettlementGuard } from './settlement.guard';
import { Agreement } from '../../../../database/entities/agreement.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { CommonModule } from '../../../../common/common.module';
import { BudgetModule } from '../../../shared/budget/budget.module';
import { AccessScopeModule } from '../../../shared/access-scope/access-scope.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Agreement]),
    LedgerModule,
    CommonModule,
    BudgetModule,
    AccessScopeModule,
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
