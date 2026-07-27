import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesActual } from '../../../../database/entities/sales-actual.entity';
import { SalesActualBatch } from '../../../../database/entities/sales-actual-batch.entity';
import { SalesActualsController } from './sales-actuals.controller';
import { SalesActualsService } from './sales-actuals.service';
import { SalesActualsRepository } from './sales-actuals.repository';
import { SalesActualsLookupService } from './services/sales-actuals-lookup.service';
import { SalesActualsValidationService } from './services/sales-actuals-validation.service';
import { MasterDataModule } from '../../../master-data/master-data.module';
import { CommonModule } from '../../../../common/common.module';

/**
 * T-020 — Sales Actuals modülü.
 *
 * ⚠️ MODÜL SINIRI (koşul 3, docs/analysis/0002-actuals-port-design.md §1/§4):
 * Bu modül LedgerModule, BudgetModule, KpiEngineModule, SpendCalculationModule,
 * ApprovalModule, PlanModule, AgreementModule, SettlementModule import ETMEZ.
 * Actuals satış cirosudur, harcama/spend değildir ve KPI motorunu beslemez.
 * Kural `sales-actuals.module.spec.ts` ile kilitlidir — bu importlar dosyaya
 * eklenirse test kırılır.
 *
 * Bu turda kimse bu modülü import etmez; app.module.ts'e düz kayıt yeterli.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SalesActual, SalesActualBatch]),
    MasterDataModule,
    CommonModule,
  ],
  controllers: [SalesActualsController],
  providers: [
    SalesActualsService,
    SalesActualsRepository,
    SalesActualsLookupService,
    SalesActualsValidationService,
  ],
  exports: [SalesActualsService, SalesActualsRepository],
})
export class SalesActualsModule {}
