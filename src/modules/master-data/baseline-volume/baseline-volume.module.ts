import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaselineVolume } from '../../../database/entities/baseline-volume.entity';
import { BaselineVolumeImportBatch } from '../../../database/entities/baseline-volume-import-batch.entity';
import { BaselineVolumeImportBatchRow } from '../../../database/entities/baseline-volume-import-batch-row.entity';
import { Sku } from '../../../database/entities/sku.entity';
import { Cpl } from '../../../database/entities/cpl.entity';
import { BaselineVolumeController } from './baseline-volume.controller';
import { BaselineVolumeService } from './baseline-volume.service';
import { BaselineVolumeRepository } from './baseline-volume.repository';
import { BaselineVolumeFileParserService } from './services/baseline-volume-file-parser.service';
import { BaselineVolumeLookupService } from './services/baseline-volume-lookup.service';
import { BaselineVolumeCoverageService } from './services/baseline-volume-coverage.service';
import { MasterDataModule } from '../master-data.module';
import { CommonModule } from '../../../common/common.module';

/**
 * `BL-2` (`docs/process/BL2_GIRIS_BRIEF.md`) — baseline hacim modülü.
 *
 * `SalesActualsModule`'ün aynı sınırı: KPI/ledger/budget/approval/agreement
 * modüllerinden HİÇBİRİNİ import etmiyor. Kapsam yalnız ingestion + saklama +
 * okuma — `D2`/`D4` (SKU eşleme + kapsam kapısı) `BL-3`'ün işi.
 *
 * `Sku`/`Cpl` bu modülün KENDİ `TypeOrmModule.forFeature`'ına da eklendi
 * (`BaselineVolumeCoverageService`'in `≥%95` kapı hesaplaması için) —
 * `MasterDataModule` bu iki entity'nin repository token'ını EXPORT etmiyor
 * (yalnız servislerini), o yüzden aynı entity burada AYRICA kaydedildi;
 * TypeORM aynı entity'yi birden çok modülün `forFeature`'ında güvenle
 * paylaşır (tek connection, tek metadata).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BaselineVolume,
      BaselineVolumeImportBatch,
      BaselineVolumeImportBatchRow,
      Sku,
      Cpl,
    ]),
    MasterDataModule,
    CommonModule,
  ],
  controllers: [BaselineVolumeController],
  providers: [
    BaselineVolumeService,
    BaselineVolumeRepository,
    BaselineVolumeFileParserService,
    BaselineVolumeLookupService,
    BaselineVolumeCoverageService,
  ],
  exports: [
    BaselineVolumeService,
    BaselineVolumeRepository,
    BaselineVolumeCoverageService,
  ],
})
export class BaselineVolumeModule {}
