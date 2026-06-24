import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerEntry } from '../../../../database/entities/ledger-entry.entity';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { LedgerRepository } from './ledger.repository';
import { BudgetModule } from '../../../shared/budget/budget.module';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry]), BudgetModule],
  controllers: [LedgerController],
  providers: [LedgerService, LedgerRepository],
  exports: [LedgerService, LedgerRepository],
})
export class LedgerModule {}
