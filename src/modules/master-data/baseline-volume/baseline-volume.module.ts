import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaselineVolume } from '../../../database/entities/baseline-volume.entity';
import { BaselineVolumeImportBatch } from '../../../database/entities/baseline-volume-import-batch.entity';
import { BaselineVolumeController } from './baseline-volume.controller';
import { BaselineVolumeService } from './baseline-volume.service';
import { BaselineVolumeRepository } from './baseline-volume.repository';
import { BaselineVolumeFileParserService } from './services/baseline-volume-file-parser.service';
import { BaselineVolumeLookupService } from './services/baseline-volume-lookup.service';
import { MasterDataModule } from '../master-data.module';
import { CommonModule } from '../../../common/common.module';

/**
 * `BL-2` (`docs/process/BL2_GIRIS_BRIEF.md`) — baseline hacim modülü.
 *
 * `SalesActualsModule`'ün aynı sınırı: KPI/ledger/budget/approval/agreement
 * modüllerinden HİÇBİRİNİ import etmiyor. Kapsam yalnız ingestion + saklama +
 * okuma — `D2`/`D4` (SKU eşleme + kapsam kapısı) `BL-3`'ün işi.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BaselineVolume, BaselineVolumeImportBatch]),
    MasterDataModule,
    CommonModule,
  ],
  controllers: [BaselineVolumeController],
  providers: [
    BaselineVolumeService,
    BaselineVolumeRepository,
    BaselineVolumeFileParserService,
    BaselineVolumeLookupService,
  ],
  exports: [BaselineVolumeService, BaselineVolumeRepository],
})
export class BaselineVolumeModule {}
