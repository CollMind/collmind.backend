import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgreementTransaction } from '../../../../database/entities/agreement-transaction.entity';
import { AgreementTransactionService } from './agreement-transaction.service';
import { AgreementTransactionController } from './agreement-transaction.controller';
import { AgreementTransactionRepository } from './agreement-transaction.repository';
import { OffInvoiceFileParserService } from './services/off-invoice-file-parser.service';
import { OffInvoiceValidationService } from './services/off-invoice-validation.service';
import { LedgerModule } from '../ledger/ledger.module';
import { AgreementModule } from '../agreement/agreement.module';
import { BudgetModule } from '../../../shared/budget/budget.module';
import { AgreementService } from '../agreement/agreement.service';
import { BudgetService } from '../../../shared/budget/budget.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgreementTransaction]),
    LedgerModule,
    AgreementModule,
    BudgetModule,
  ],
  controllers: [AgreementTransactionController],
  providers: [
    AgreementTransactionService,
    AgreementTransactionRepository,
    OffInvoiceFileParserService,
    OffInvoiceValidationService,
  ],
  exports: [AgreementTransactionService, AgreementTransactionRepository],
})
export class AgreementTransactionModule {}
