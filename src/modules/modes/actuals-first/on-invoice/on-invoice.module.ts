import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnInvoiceEntry } from '../../../../database/entities/on-invoice-entry.entity';
import { OnInvoiceBatch } from '../../../../database/entities/on-invoice-batch.entity';
import { OnInvoiceService } from './on-invoice.service';
import { OnInvoiceController } from './on-invoice.controller';
import { OnInvoiceRepository } from './on-invoice.repository';
import { OnInvoiceFileParserService } from './services/on-invoice-file-parser.service';
import { OnInvoiceValidationService } from './services/on-invoice-validation.service';
import { CustomerModule } from '../../../customer/customer.module';
import { MasterDataModule } from '../../../master-data/master-data.module';
import { BudgetModule } from '../../../shared/budget/budget.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OnInvoiceEntry, OnInvoiceBatch]),
    CustomerModule,
    MasterDataModule,
    BudgetModule,
    LedgerModule,
  ],
  controllers: [OnInvoiceController],
  providers: [
    OnInvoiceService,
    OnInvoiceRepository,
    OnInvoiceFileParserService,
    OnInvoiceValidationService,
  ],
  exports: [OnInvoiceService, OnInvoiceRepository],
})
export class OnInvoiceModule {}
