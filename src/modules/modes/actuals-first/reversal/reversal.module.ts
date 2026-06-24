import { Module } from '@nestjs/common';
import { ReversalController } from './reversal.controller';
import { ReversalService } from './reversal.service';
import { ReversalGuard } from './reversal.guard';
import { LedgerModule } from '../ledger/ledger.module';
import { AgreementTransactionModule } from '../agreement-transaction/agreement-transaction.module';
import { CommonModule } from '../../../../common/common.module';

@Module({
  imports: [LedgerModule, AgreementTransactionModule, CommonModule],
  controllers: [ReversalController],
  providers: [ReversalService, ReversalGuard],
  exports: [ReversalService],
})
export class ReversalModule {}
