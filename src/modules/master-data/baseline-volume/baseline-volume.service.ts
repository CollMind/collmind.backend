import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BaselineVolumeFileParserService,
  ParsedBaselineVolumeRow,
} from './services/baseline-volume-file-parser.service';
import { BaselineVolumeLookupService } from './services/baseline-volume-lookup.service';
import { BaselineVolumeRepository } from './baseline-volume.repository';
import { AdminAuditService } from '../../../common/services/admin-audit.service';
import {
  BaselineVolume,
  BaselineVolumeAcceptanceStatus,
  BaselineVolumeSourceType,
} from '../../../database/entities/baseline-volume.entity';
import {
  BaselineVolumeRowIssue,
  IngestBaselineVolumeResultDto,
} from './dto/ingest-result.dto';

export interface IngestBaselineVolumeInput {
  fileName: string;
  fileBuffer: Buffer;
  contentType: string;
}

export interface IngestUserContext {
  userId: string;
  userEmail: string;
}

/**
 * `BL-2` (`docs/process/BL2_GIRIS_BRIEF.md`) — baseline hacim import
 * orkestrasyonu. Tek giriş noktası: `ingest()`.
 *
 * ── `§3` IMPORT OLGUSU — ÜÇLÜ DÖRDE ÇIKMAZ ────────────────────────────────
 * Import bilinçli bir veri-getirme eylemidir; grid'in "henüz girilmedi"
 * ara-durumu burada YOK. Zorunlu bir alanı (sku_code/cpl_code/period/
 * base_volume) eksik olan satır `plan_skus`/`baseline_volumes`'a HİÇ GİRMEZ —
 * `NOT_EVALUABLE` import yoluyla ÜRETİLMEZ (yalnız grid girişiyle doğar,
 * bu servisin kapsamı dışında).
 *
 * ── İKİ AYRI RED SINIFI (`dto/ingest-result.dto.ts`'in JSDoc'u) ──────────
 *
 *   A) ANAHTAR ÇÖZÜLEMEDİ (`keyUnresolvedRows`)
 *      Zorunlu alanlardan biri hiç okunamadı YA DA sku_code/cpl_code
 *      katalogda yok. `baseline_volumes.sku_id`/`cpl_id` NOT NULL FK olduğu
 *      için bu satır tabloya bir SATIR OLARAK GİREMEZ (migration `1822`
 *      JSDoc'unun "SKU eşleşmedi türü red bu tabloya bir satır olarak
 *      giremez" notu). Yalnız bu ingest cevabında taşınır — kalıcı bir evi
 *      YOK (bkz. task raporu §5, DUR noktası).
 *
 *   B) ANAHTAR ÇÖZÜLDÜ, DEĞER REDDEDİLDİ (`formatRejectedRows`)
 *      sku_code/cpl_code/period çözüldü ama base_volume ya biçimsiz, ya
 *      negatif, ya da bu dosyada/tabloda AYNI grain'in bir tekrarı
 *      (`DUPLICATE_GRAIN`). Bu satır `baseline_volumes`'a
 *      `acceptance_status = 'REJECTED'` olarak YAZILIR — `reason` NOT NULL
 *      (DB CHECK). `BL-3`'ün `≥%95` kapısı bu satırları "EKSİK" sayar
 *      (`Z79 §4` / `Z85 §3` PİN 2).
 *
 * ── `RolesGuard`/`CapabilityGuard` ──────────────────────────────────────
 * Kontrolör tarafında (bkz. `baseline-volume.controller.ts`); bu serviste
 * RBAC yok, yalnız tenant-scope.
 */
@Injectable()
export class BaselineVolumeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly fileParser: BaselineVolumeFileParserService,
    private readonly lookupService: BaselineVolumeLookupService,
    private readonly repository: BaselineVolumeRepository,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async ingest(
    tenantId: string,
    userCtx: IngestUserContext,
    input: IngestBaselineVolumeInput,
  ): Promise<IngestBaselineVolumeResultDto> {
    const isCsv =
      input.contentType === 'text/csv' ||
      input.fileName.toLowerCase().endsWith('.csv');

    const rows = isCsv
      ? await this.fileParser.parseCSV({
          buffer: input.fileBuffer,
          originalname: input.fileName,
          mimetype: input.contentType,
        } as Express.Multer.File)
      : await this.fileParser.parseExcel({
          buffer: input.fileBuffer,
          originalname: input.fileName,
          mimetype: input.contentType,
        } as Express.Multer.File);

    const index = await this.lookupService.buildIndex(tenantId);

    const keyUnresolvedRows: BaselineVolumeRowIssue[] = [];
    const acceptedOrRejected: Array<{
      row: ParsedBaselineVolumeRow;
      skuId: string;
      cplId: string;
      period: string;
    }> = [];

    // ── ADIM 1: anahtar çözümlemesi (Q20/`§3`: eksik/çözülemeyen anahtar → satır tabloya HİÇ GİRMEZ) ──
    for (const row of rows) {
      const missing: string[] = [];
      if (!row.skuCode) missing.push('sku_code');
      if (!row.cplCode) missing.push('cpl_code');
      if (!row.period) missing.push('period');
      // base_volume EKSİK olabilir (o durumda REJECTED olarak yazılır,
      // aşağıda ADIM 2) — anahtar değil, DEĞER; bu döngüde saymaz.

      if (row.parseErrors && row.parseErrors.length > 0) {
        for (const err of row.parseErrors) {
          if (err.field === 'sku_code' || err.field === 'cpl_code') {
            missing.push(err.field);
          } else if (err.field === 'period' && !missing.includes('period')) {
            missing.push('period');
          }
        }
      }

      if (missing.length > 0) {
        keyUnresolvedRows.push({
          rowNumber: row.originalRowNumber,
          reasonCode: 'MISSING_REQUIRED_FIELD',
          field: missing.join(','),
          message: `Zorunlu alan(lar) eksik veya okunamadı: ${missing.join(', ')}.`,
          originalRowData: row.originalRowData,
        });
        continue;
      }

      const sku = index.skuByCode.get(row.skuCode!);
      if (!sku) {
        keyUnresolvedRows.push({
          rowNumber: row.originalRowNumber,
          reasonCode: 'SKU_NOT_FOUND',
          field: 'sku_code',
          message: `SKU kodu katalogda bulunamadı: '${row.skuCode}'.`,
          originalRowData: row.originalRowData,
        });
        continue;
      }

      const cpl = index.cplByCode.get(row.cplCode!);
      if (!cpl) {
        keyUnresolvedRows.push({
          rowNumber: row.originalRowNumber,
          reasonCode: 'CPL_NOT_FOUND',
          field: 'cpl_code',
          message: `CPL kodu katalogda bulunamadı: '${row.cplCode}'.`,
          originalRowData: row.originalRowData,
        });
        continue;
      }

      acceptedOrRejected.push({
        row,
        skuId: sku.id,
        cplId: cpl.id,
        period: row.period!,
      });
    }

    if (acceptedOrRejected.length === 0 && keyUnresolvedRows.length > 0) {
      throw new BadRequestException({
        code: 'NO_RESOLVABLE_ROWS',
        message:
          'Dosyadaki hiçbir satırın anahtarı (SKU/CPL/period) çözülemedi. Batch oluşturulmadı.',
        totalRows: rows.length,
        keyUnresolvedRows,
      });
    }

    if (acceptedOrRejected.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_FILE',
        message: 'Dosyada işlenebilir satır yok.',
        totalRows: rows.length,
      });
    }

    // ── ADIM 2: dosya-içi yinelenen grain tespiti (aynı sku/cpl/period ikinci kez) ──
    const seenInFile = new Map<string, number>(); // grainKey -> ilk satır no
    const formatRejectedRows: BaselineVolumeRowIssue[] = [];
    const toInsert: Array<{
      row: ParsedBaselineVolumeRow;
      skuId: string;
      cplId: string;
      period: string;
      status: BaselineVolumeAcceptanceStatus;
      reason?: string;
    }> = [];

    for (const item of acceptedOrRejected) {
      const grainKey = `${item.skuId}|${item.cplId}|${item.period}`;
      const firstSeenAt = seenInFile.get(grainKey);
      if (firstSeenAt !== undefined) {
        formatRejectedRows.push({
          rowNumber: item.row.originalRowNumber,
          reasonCode: 'DUPLICATE_GRAIN',
          message: `Aynı SKU × CPL × period bu dosyada satır ${firstSeenAt}'de zaten var.`,
          originalRowData: item.row.originalRowData,
        });
        toInsert.push({
          ...item,
          status: BaselineVolumeAcceptanceStatus.REJECTED,
          reason: 'DUPLICATE_GRAIN',
        });
        continue;
      }
      seenInFile.set(grainKey, item.row.originalRowNumber);

      if (item.row.baseVolume === undefined) {
        const hadFormatError = item.row.parseErrors?.some(
          (e) => e.field === 'base_volume',
        );
        const reasonCode = hadFormatError
          ? 'INVALID_VOLUME_FORMAT'
          : 'MISSING_REQUIRED_FIELD';
        formatRejectedRows.push({
          rowNumber: item.row.originalRowNumber,
          reasonCode,
          field: 'base_volume',
          message: hadFormatError
            ? item.row.parseErrors!.find((e) => e.field === 'base_volume')!
                .error_message
            : 'base_volume alanı zorunludur.',
          originalRowData: item.row.originalRowData,
        });
        toInsert.push({
          ...item,
          status: BaselineVolumeAcceptanceStatus.REJECTED,
          reason: reasonCode,
        });
        continue;
      }

      if (item.row.baseVolume < 0) {
        formatRejectedRows.push({
          rowNumber: item.row.originalRowNumber,
          reasonCode: 'NEGATIVE_VOLUME',
          field: 'base_volume',
          message: `base_volume negatif olamaz: ${item.row.baseVolume}.`,
          originalRowData: item.row.originalRowData,
        });
        toInsert.push({
          ...item,
          status: BaselineVolumeAcceptanceStatus.REJECTED,
          reason: 'NEGATIVE_VOLUME',
        });
        continue;
      }

      toInsert.push({
        ...item,
        status: BaselineVolumeAcceptanceStatus.ACCEPTED,
      });
    }

    // ── ADIM 3: DB'de ÖNCEDEN var olan grain'leri kontrol et (23505'e bırakmadan) ──
    let batchId = '';
    const importedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      const batch = await this.repository.createBatch(manager, {
        tenantId,
        createdBy: userCtx.userId,
      });
      batchId = batch.id;

      const existingKeys = await this.repository.findExistingGrainKeys(
        manager,
        tenantId,
        toInsert
          .filter((i) => i.status === BaselineVolumeAcceptanceStatus.ACCEPTED)
          .map((i) => ({ skuId: i.skuId, cplId: i.cplId, period: i.period })),
      );

      const finalRows: Partial<BaselineVolume>[] = toInsert.map((item) => {
        if (item.status === BaselineVolumeAcceptanceStatus.ACCEPTED) {
          const grainKey = `${item.skuId}|${item.cplId}|${item.period}`;
          if (existingKeys.has(grainKey)) {
            formatRejectedRows.push({
              rowNumber: item.row.originalRowNumber,
              reasonCode: 'DUPLICATE_GRAIN',
              message:
                'Aynı SKU × CPL × period için tabloda kabul edilmiş bir kayıt zaten var.',
              originalRowData: item.row.originalRowData,
            });
            return {
              tenantId,
              skuId: item.skuId,
              cplId: item.cplId,
              period: item.period,
              baseVolume: undefined,
              sourceType: BaselineVolumeSourceType.IMPORT,
              importBatchId: batchId,
              acceptanceStatus: BaselineVolumeAcceptanceStatus.REJECTED,
              reason: 'DUPLICATE_GRAIN',
              importedAt,
              createdBy: userCtx.userId,
            };
          }
        }

        return {
          tenantId,
          skuId: item.skuId,
          cplId: item.cplId,
          period: item.period,
          baseVolume:
            item.status === BaselineVolumeAcceptanceStatus.ACCEPTED
              ? item.row.baseVolume
              : undefined,
          sourceType: BaselineVolumeSourceType.IMPORT,
          importBatchId: batchId,
          acceptanceStatus: item.status,
          reason:
            item.status === BaselineVolumeAcceptanceStatus.REJECTED
              ? item.reason
              : undefined,
          importedAt,
          createdBy: userCtx.userId,
        };
      });

      await this.repository.insertRowsChunked(manager, finalRows);
    });

    await this.adminAuditService.logAdminAction(
      tenantId,
      userCtx.userId,
      userCtx.userEmail,
      'BASELINE_VOLUME_UPLOAD',
      'BaselineVolumeImportBatch',
      batchId,
      undefined,
      'SUCCESS',
      undefined,
      {
        totalRows: rows.length,
        acceptedRows: toInsert.filter(
          (i) => i.status === BaselineVolumeAcceptanceStatus.ACCEPTED,
        ).length,
        formatRejectedRows: formatRejectedRows.length,
        keyUnresolvedRows: keyUnresolvedRows.length,
      },
    );

    return {
      batchId,
      totalRows: rows.length,
      acceptedRows: toInsert.filter(
        (i) =>
          i.status === BaselineVolumeAcceptanceStatus.ACCEPTED &&
          !formatRejectedRows.some(
            (f) => f.rowNumber === i.row.originalRowNumber,
          ),
      ).length,
      formatRejectedRows,
      keyUnresolvedRows,
    };
  }

  async getBatch(tenantId: string, batchId: string) {
    const batch = await this.repository.findBatchById(tenantId, batchId);
    if (!batch) {
      throw new NotFoundException(`Batch bulunamadı: ${batchId}`);
    }
    const counts = await this.repository.countByAcceptance(tenantId, batchId);
    return { ...batch, counts };
  }

  async getBatchRows(tenantId: string, batchId: string) {
    await this.getBatch(tenantId, batchId);
    return this.repository.findRowsByBatchId(tenantId, batchId);
  }
}
