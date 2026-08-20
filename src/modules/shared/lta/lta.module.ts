import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LTAAgreement } from '../../../database/entities/lta-agreement.entity';
import { LTARate } from '../../../database/entities/lta-rate.entity';
import { PlanSku } from '../../../database/entities/plan.entity';
import { Sku } from '../../../database/entities/sku.entity';
import { LTAAgreementController } from './lta-agreement.controller';
import { LTAAgreementService } from './lta-agreement.service';
import { LTACalculationService } from './lta-calculation.service';
import { LTAAgreementRepository } from './lta-agreement.repository';
import { MasterDataModule } from '../../master-data/master-data.module';

@Module({
  imports: [
    // T-250 (DUR #2 kararı): LTAPlanOverride BİLEREK burada YOK — ölçüldü
    // (`grep -rln "LTAPlanOverride\|ltaPlanOverride" src/modules` → yalnız
    // bu modülün eski kaydı, sıfır servis/repository/controller tüketicisi),
    // ölü DI kaydıydı. İlke 1'in iki yüzü: bugün ihtiyacı olmayan izin
    // verilmez, ihtiyacı olmayan KAYIT da tutulmaz. Entity'nin kendisi
    // `all-entities.ts`'te DURUYOR (migration şemasından düşmesin) — yalnız
    // bu modülün forFeature enjeksiyonu kaldırıldı. Bir tüketici gelirse
    // forFeature kaydı VE scripts/db-roles/02-runtime-grants.sql'deki GRANT
    // AYNI TURDA eklenir — app-runtime-grants guard'ı (T-250) bunu zorlar.
    TypeOrmModule.forFeature([LTAAgreement, LTARate, PlanSku, Sku]),
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
