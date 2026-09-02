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
  BaselineVolumeImportBatchRow,
  ImportBatchRowReason,
  ImportBatchRowStatus,
} from '../../../database/entities/baseline-volume-import-batch-row.entity';
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
 * ── `BL-3 ADIM 4` (`docs/process/BL3_DOGRULAMA_BRIEF.md` kapanış eki) ────
 * **HER kaynak satır** (ACCEPTED de, REJECTED de, `keyUnresolvedRows` DA)
 * `baseline_volume_import_batch_rows`'a (migration `1823`) yazılır —
 * `sourceMatchRatio`'nun PAYDASI ve "kabul edilen satır hangi kaynak
 * satırdan geldi" izi burada kurulur (`Z87 §2`). Köprü:
 * `baseline_volumes` ↔ `batch_id` + `row_no` (uygulama katmanı, bu satır
 * numaraları `row.originalRowNumber` ile BİREBİR aynı).
 *
 * ⛔ **İKİ KANAL → TEK SÖZLÜK** (`Z87 §F12` ikinci hükmü): parser'ın
 * `error_type`'ı (`FieldParseError`, ör. `INVALID_PERIOD`) servise
 * ULAŞTIĞINDA reasonCode olarak DA taşınır — `MISSING_REQUIRED_FIELD`'e
 * ÇEVRİLMEZ. `period` alanı BLANK (hiç yazılmamış) olmakla PARSE
 * EDİLEMEDİ (yazılmış ama okunamadı) olmak AYRI durumlardır; yalnız
 * ikincisi `INVALID_PERIOD` üretir.
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
    // `BL-3 ADIM 4`: ADIM 1'in ürettiği kalıcı iz — batchId eklenmeden önce
    // toplanır (batch henüz DB'de yok), transaction içinde tamamlanır.
    const keyStageBatchRows: Array<
      Omit<Partial<BaselineVolumeImportBatchRow>, 'batchId' | 'tenantId'>
    > = [];

    // ── ADIM 1: anahtar çözümlemesi (Q20/`§3`: eksik/çözülemeyen anahtar → satır tabloya HİÇ GİRMEZ) ──
    for (const row of rows) {
      // ⛔ §2.5 — `raw` (batch_rows) HER satırda NOT NULL; parser HER satırda
      // `originalRowData: row` üretir (mapToBaselineVolumeRows) ama tip
      // opsiyonel — sessizce `{}` yazmak yerine AÇIK HATA.
      if (!row.originalRowData) {
        throw new Error(
          `ingest: satır ${row.originalRowNumber} için originalRowData YOK — parser'ın hücre-ham izi üretmediği beklenmeyen bir durum (§2.5, sessiz geçiş yok).`,
        );
      }
      const raw = row.originalRowData;

      // Gerçekten BOŞ (hücre hiç yazılmamış) alanlar — anahtar hiç okunamadı.
      const missingBlank: string[] = [];
      if (!row.skuCode) missingBlank.push('sku_code');
      if (!row.cplCode) missingBlank.push('cpl_code');

      // `period` hücresi YAZILMIŞ ama PARSE EDİLEMEMİŞ olabilir — bu, boş
      // olmaktan AYRI bir durumdur (parser `INVALID_PERIOD` üretir, bkz.
      // `baseline-volume-file-parser.service.ts` `getPeriodValue`). Boş
      // hücre parser'a hiç hata ürettirmez (ilk satırda `isBlankCellValue`
      // ile döner) — yani "period blank" ve "period parse error" AYRIK
      // kümelerdir, aynı anda ikisi de doğru olamaz.
      const periodParseError = row.parseErrors?.find(
        (err) => err.field === 'period' && err.error_type === 'INVALID_PERIOD',
      );
      if (!row.period && !periodParseError) missingBlank.push('period');
      // base_volume EKSİK olabilir (o durumda REJECTED olarak yazılır,
      // aşağıda ADIM 2) — anahtar değil, DEĞER; bu döngüde saymaz.

      if (missingBlank.length > 0) {
        // ⛔ ÖNCELİK (açık, gizli tie-break DEĞİL): şema bir satıra TEK
        // reasonCode izin verir. Bir satırda gerçekten-boş bir anahtar VARSA
        // (ör. sku_code hiç yazılmamış) — bu, "period yazılmış ama okunamadı"
        // sorunundan daha temel bir eksikliktir ve MISSING_REQUIRED_FIELD
        // KAZANIR. `INVALID_PERIOD` yalnız TEK BAŞINA sorun olduğunda üretilir
        // (aşağıdaki dal).
        keyUnresolvedRows.push({
          rowNumber: row.originalRowNumber,
          reasonCode: 'MISSING_REQUIRED_FIELD',
          field: missingBlank.join(','),
          message: `Zorunlu alan(lar) eksik veya okunamadı: ${missingBlank.join(', ')}.`,
          originalRowData: row.originalRowData,
        });
        keyStageBatchRows.push({
          rowNo: row.originalRowNumber,
          raw,
          status: ImportBatchRowStatus.REJECTED,
          reason: ImportBatchRowReason.MISSING_REQUIRED_FIELD,
          resolvedSkuId: undefined,
          resolvedCplId: undefined,
        });
        continue;
      }

      if (periodParseError) {
        keyUnresolvedRows.push({
          rowNumber: row.originalRowNumber,
          reasonCode: 'INVALID_PERIOD',
          field: 'period',
          message: periodParseError.error_message,
          originalRowData: row.originalRowData,
        });
        keyStageBatchRows.push({
          rowNo: row.originalRowNumber,
          raw,
          status: ImportBatchRowStatus.REJECTED,
          reason: ImportBatchRowReason.INVALID_PERIOD,
          resolvedSkuId: undefined,
          resolvedCplId: undefined,
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
        keyStageBatchRows.push({
          rowNo: row.originalRowNumber,
          raw,
          status: ImportBatchRowStatus.REJECTED,
          reason: ImportBatchRowReason.SKU_NOT_FOUND,
          // SKU bulunamadı ⇒ CPL lookup'a hiç ulaşılmaz (CHECK: ikisi de NULL).
          resolvedSkuId: undefined,
          resolvedCplId: undefined,
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
        keyStageBatchRows.push({
          rowNo: row.originalRowNumber,
          raw,
          status: ImportBatchRowStatus.REJECTED,
          reason: ImportBatchRowReason.CPL_NOT_FOUND,
          // SKU zaten çözüldü (CHECK: resolved_sku_id NOT NULL, resolved_cpl_id NULL).
          resolvedSkuId: sku.id,
          resolvedCplId: undefined,
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

      // ── `BL-3 ADIM 4`: satır yazarı — HER kaynak satır burada da yaşar ──
      // `finalRows[i]` ADIM 3'ün (DB-önceden-var grain) flip'ini içerir,
      // `toInsert[i]`'nin AYNI SIRA/UZUNLUKTA türevidir (`finalRows =
      // toInsert.map(...)`) — status/reason'ı ORADAN, skuId/cplId/rowNo/raw'ı
      // `toInsert[i]`'den al (bu ikisi zip'lenir, tahmin değil).
      const valueStageBatchRows: Array<
        Omit<Partial<BaselineVolumeImportBatchRow>, 'batchId' | 'tenantId'>
      > = toInsert.map((item, i) => {
        const finalRow = finalRows[i];
        const isAccepted =
          finalRow.acceptanceStatus === BaselineVolumeAcceptanceStatus.ACCEPTED;
        if (!item.row.originalRowData) {
          // Yukarıda ADIM 1'de zaten garanti edildi (tüm `rows` için); bu
          // dal yalnız bir ileride-refactor regresyonunu YAKALAMAK için
          // (§2.5 — sessizce `{}` yazılmaz).
          throw new Error(
            `ingest: satır ${item.row.originalRowNumber} için originalRowData YOK (value-stage) — beklenmeyen durum.`,
          );
        }
        return {
          rowNo: item.row.originalRowNumber,
          raw: item.row.originalRowData,
          status: isAccepted
            ? ImportBatchRowStatus.ACCEPTED
            : ImportBatchRowStatus.REJECTED,
          reason: isAccepted
            ? undefined
            : this.toImportBatchRowReason(finalRow.reason),
          // Bu dizinin HER üyesi SKU+CPL+period'u ÇÖZEREK ADIM 1'i geçmiştir
          // (`acceptedOrRejected`'in tanımı) — ACCEPTED da, value-stage
          // REJECTED (INVALID_VOLUME_FORMAT/NEGATIVE_VOLUME/DUPLICATE_GRAIN/
          // MISSING_REQUIRED_FIELD-value-aşaması) da resolved_* NOT NULL.
          resolvedSkuId: item.skuId,
          resolvedCplId: item.cplId,
        };
      });

      const allBatchRows: Partial<BaselineVolumeImportBatchRow>[] = [
        ...keyStageBatchRows,
        ...valueStageBatchRows,
      ].map((r) => ({ ...r, batchId, tenantId, createdBy: userCtx.userId }));

      await this.repository.insertBatchRowsChunked(manager, allBatchRows);
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

  /**
   * `Z87 §F12` ikinci hükmü: iki kanal (parser `error_type`, servis
   * `reasonCode`) → tek sözlük. `baseline_volumes.reason` serbest metin
   * (bkz. entity), ama `baseline_volume_import_batch_rows.reason` Postgres
   * ENUM'a kilitli — burada bir DÖNÜŞÜM YOK, yalnız TİP DOĞRULAMASI: kod
   * `ImportBatchRowReason`'ın bir üyesi DEĞİLSE sessizce geçilmez, açık hata
   * (§2.5) — dictionay'in ikisi arasında SESSİZCE ayrışması riskine karşı.
   */
  private toImportBatchRowReason(
    code: string | undefined,
  ): ImportBatchRowReason {
    if (!code || !(code in ImportBatchRowReason)) {
      throw new Error(
        `ingest: reasonCode '${code}' ImportBatchRowReason sözlüğünde yok — iki kanal tek sözlük şartı ihlal edildi (Z87 §F12, §2.5).`,
      );
    }
    return ImportBatchRowReason[code as keyof typeof ImportBatchRowReason];
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
