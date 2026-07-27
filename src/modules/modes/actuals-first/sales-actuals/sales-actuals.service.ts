import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { CsvParserService } from '../../../../common/services/csv-parser.service';
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
import { SalesActualsLookupService } from './services/sales-actuals-lookup.service';
import { SalesActualsValidationService } from './services/sales-actuals-validation.service';
import { SalesActualsRepository } from './sales-actuals.repository';
import {
  SalesActualBatch,
  SalesActualSourceType,
} from '../../../../database/entities/sales-actual-batch.entity';
import { SalesActual } from '../../../../database/entities/sales-actual.entity';
import {
  BatchIngestResultDto,
  IngestSalesActualsResultDto,
  RowValidationIssue,
} from './dto/ingest-result.dto';

const FILENAME_PERIOD_REGEX = /^actuals_(\d{4})-(\d{2})\.csv$/i;
const FISCAL_PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

interface ScopeGroup {
  fiscalPeriod: string;
  cplId: string;
  cplCode: string;
  categoryId: string;
  categoryName: string;
  channelId: string;
  channelCode: string;
  rows: Array<{
    sourceRowNumber: number;
    grossAmount: number;
    netAmount?: number;
    discountAmount?: number;
    currency: string;
    rawRow: Record<string, string>;
  }>;
}

export interface IngestSalesActualsInput {
  fileName: string;
  fileBuffer: Buffer;
  fiscalPeriodOverride?: string;
  sourceType: SalesActualSourceType;
}

export interface IngestUserContext {
  userId: string;
  userEmail: string;
}

/**
 * SalesActualsService.ingest() — TEK kod yolu. Controller (multipart upload)
 * ve seed script AYNI metodu çağırır (design §5).
 *
 * Kapsam SADECE ingestion + saklama + okuma. KPI/ledger/budget hesaplamasına
 * DOKUNMAZ (bkz. entity JSDoc'ları + sales-actuals.module.spec.ts).
 */
@Injectable()
export class SalesActualsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly csvParser: CsvParserService,
    private readonly lookupService: SalesActualsLookupService,
    private readonly validationService: SalesActualsValidationService,
    private readonly repository: SalesActualsRepository,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async ingest(
    tenantId: string,
    userCtx: IngestUserContext,
    input: IngestSalesActualsInput,
  ): Promise<IngestSalesActualsResultDto> {
    const fiscalPeriod = this.resolveFiscalPeriod(
      input.fiscalPeriodOverride,
      input.fileName,
    );

    const fileHash = createHash('sha256')
      .update(input.fileBuffer)
      .digest('hex');

    const rawRows = await this.csvParser.parse(
      {
        buffer: input.fileBuffer,
        originalname: input.fileName,
        mimetype: 'text/csv',
      } as Express.Multer.File,
      { maxRows: 10000 },
    );

    const index = await this.lookupService.buildIndex(tenantId);

    const errors: RowValidationIssue[] = [];
    const warnings: RowValidationIssue[] = [];
    const scopeGroups = new Map<string, ScopeGroup>();
    let validRows = 0;

    rawRows.forEach((rawRow, i) => {
      const rowNumber = i + 2; // header = 1
      const outcome = this.validationService.validateRow(
        rawRow,
        rowNumber,
        fiscalPeriod,
        index,
      );

      warnings.push(...outcome.warnings);

      if (!outcome.isValid || !outcome.row) {
        errors.push(...outcome.errors);
        return;
      }

      validRows++;
      const row = outcome.row;
      const scopeKey = `${row.fiscalPeriod}|${row.cplId}|${row.categoryId}|${row.channelId}`;
      let group = scopeGroups.get(scopeKey);
      if (!group) {
        group = {
          fiscalPeriod: row.fiscalPeriod,
          cplId: row.cplId,
          cplCode: row.cplCode,
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          channelId: row.channelId,
          channelCode: row.channelCode,
          rows: [],
        };
        scopeGroups.set(scopeKey, group);
      }
      group.rows.push({
        sourceRowNumber: row.rowNumber,
        grossAmount: row.grossAmount,
        netAmount: row.netAmount,
        discountAmount: row.discountAmount,
        currency: row.currency,
        rawRow: row.rawRow,
      });
    });

    if (scopeGroups.size === 0) {
      throw new BadRequestException({
        code: 'NO_VALID_ROWS',
        message: 'Dosyadaki hiçbir satır geçerli değil. Batch oluşturulmadı.',
        totalRows: rawRows.length,
        errors,
      });
    }

    const batchResults: BatchIngestResultDto[] = [];

    await this.dataSource.transaction(async (manager) => {
      for (const group of scopeGroups.values()) {
        const grossTotal = sum(group.rows.map((r) => r.grossAmount));
        const netTotal = sum(group.rows.map((r) => r.netAmount ?? 0));
        const discountTotal = sum(group.rows.map((r) => r.discountAmount ?? 0));

        let existing: SalesActualBatch | null;
        try {
          existing = await this.repository.findActiveBatchForUpdate(
            manager,
            tenantId,
            group.fiscalPeriod,
            group.cplId,
            group.categoryId,
            group.channelId,
          );
        } catch (err) {
          throw this.wrapConcurrencyError(err);
        }

        if (existing && existing.fileHash === fileHash) {
          batchResults.push({
            batchId: existing.id,
            status: 'IDEMPOTENT_DUPLICATE',
            fiscalPeriod: group.fiscalPeriod,
            cplId: group.cplId,
            categoryId: group.categoryId,
            channelId: group.channelId,
            cplCode: group.cplCode,
            categoryName: group.categoryName,
            channelCode: group.channelCode,
            rowCount: existing.validRows,
            grossTotal: Number(existing.grossTotal),
            netTotal: Number(existing.netTotal),
            discountTotal: Number(existing.discountTotal),
          });
          continue;
        }

        // KRİTİK SIRA: partial unique index aynı scope'ta yalnızca TEK ACTIVE
        // satıra izin verir. Eski batch'i REPLACED'e çevirmeden yeni ACTIVE
        // batch INSERT edilirse 23505 (constraint violation) oluşur.
        if (existing) {
          await this.repository.markReplacedStatus(manager, existing.id);
        }

        let newBatch: SalesActualBatch;
        try {
          newBatch = await this.repository.createBatch(manager, {
            tenantId,
            fiscalPeriod: group.fiscalPeriod,
            cplId: group.cplId,
            categoryId: group.categoryId,
            channelId: group.channelId,
            fileName: input.fileName,
            fileHash,
            sourceType: input.sourceType,
            totalRows: group.rows.length,
            validRows: group.rows.length,
            errorRows: 0,
            grossTotal,
            netTotal,
            discountTotal,
            createdBy: userCtx.userId,
          });
        } catch (err) {
          throw this.wrapConcurrencyError(err);
        }

        await this.repository.insertRowsChunked(
          manager,
          group.rows.map(
            (r): Partial<SalesActual> => ({
              tenantId,
              batchId: newBatch.id,
              fiscalPeriod: group.fiscalPeriod,
              cplId: group.cplId,
              categoryId: group.categoryId,
              channelId: group.channelId,
              cplCode: group.cplCode,
              categoryName: group.categoryName,
              channelCode: group.channelCode,
              grossAmount: r.grossAmount,
              netAmount: r.netAmount,
              discountAmount: r.discountAmount,
              currency: r.currency,
              sourceRowNumber: r.sourceRowNumber,
              rawRow: r.rawRow,
              createdBy: userCtx.userId,
            }),
          ),
        );

        if (existing) {
          await this.repository.linkReplacement(
            manager,
            existing.id,
            newBatch.id,
          );

          await this.adminAuditService.logAdminAction(
            tenantId,
            userCtx.userId,
            userCtx.userEmail,
            'SALES_ACTUALS_REPLACE',
            'SalesActualBatch',
            newBatch.id,
            undefined,
            'SUCCESS',
            {
              oldBatchId: existing.id,
              totals: {
                grossTotal: Number(existing.grossTotal),
                netTotal: Number(existing.netTotal),
                discountTotal: Number(existing.discountTotal),
              },
            },
            {
              newBatchId: newBatch.id,
              totals: { grossTotal, netTotal, discountTotal },
            },
          );

          batchResults.push({
            batchId: newBatch.id,
            status: 'REPLACED',
            fiscalPeriod: group.fiscalPeriod,
            cplId: group.cplId,
            categoryId: group.categoryId,
            channelId: group.channelId,
            cplCode: group.cplCode,
            categoryName: group.categoryName,
            channelCode: group.channelCode,
            rowCount: group.rows.length,
            grossTotal,
            netTotal,
            discountTotal,
            replacedBatchId: existing.id,
          });
        } else {
          await this.adminAuditService.logAdminAction(
            tenantId,
            userCtx.userId,
            userCtx.userEmail,
            'SALES_ACTUALS_UPLOAD',
            'SalesActualBatch',
            newBatch.id,
            undefined,
            'SUCCESS',
            undefined,
            { totals: { grossTotal, netTotal, discountTotal } },
          );

          batchResults.push({
            batchId: newBatch.id,
            status: 'CREATED',
            fiscalPeriod: group.fiscalPeriod,
            cplId: group.cplId,
            categoryId: group.categoryId,
            channelId: group.channelId,
            cplCode: group.cplCode,
            categoryName: group.categoryName,
            channelCode: group.channelCode,
            rowCount: group.rows.length,
            grossTotal,
            netTotal,
            discountTotal,
          });
        }
      }
    });

    return {
      fileHash,
      fiscalPeriod,
      totalRows: rawRows.length,
      validRows,
      errorRows: errors.length,
      batches: batchResults,
      errors,
      warnings,
    };
  }

  async getBatch(tenantId: string, batchId: string) {
    const batch = await this.repository.findBatchById(tenantId, batchId);
    if (!batch) {
      throw new NotFoundException(`Batch bulunamadı: ${batchId}`);
    }
    return batch;
  }

  async getBatches(
    tenantId: string,
    filters?: { fiscalPeriod?: string; status?: string },
  ) {
    return this.repository.findBatches(tenantId, filters as any);
  }

  async getBatchRows(tenantId: string, batchId: string) {
    const batch = await this.getBatch(tenantId, batchId);
    return this.repository.findRowsByBatchId(tenantId, batch.id);
  }

  async getSummary(
    tenantId: string,
    filters?: {
      fiscalPeriod?: string;
      cplId?: string;
      categoryId?: string;
      channelId?: string;
    },
  ) {
    return this.repository.summarize(tenantId, filters);
  }

  private resolveFiscalPeriod(
    override: string | undefined,
    fileName: string,
  ): string {
    if (override) {
      if (!FISCAL_PERIOD_REGEX.test(override)) {
        throw new BadRequestException(
          `Geçersiz fiscalPeriod formatı: '${override}'. YYYY-MM olmalıdır.`,
        );
      }
      return override;
    }

    const match = fileName.match(FILENAME_PERIOD_REGEX);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }

    throw new BadRequestException(
      'fiscalPeriod belirtilmedi ve dosya adından çıkarılamadı. ' +
        'Query parametresi olarak fiscalPeriod=YYYY-MM gönderin veya dosya adı ' +
        "'actuals_YYYY-MM.csv' formatında olsun.",
    );
  }

  private wrapConcurrencyError(err: unknown): unknown {
    const code = (err as any)?.code ?? (err as any)?.driverError?.code;
    if (code === '23505') {
      return new ConflictException({
        code: 'CONCURRENT_UPLOAD',
        message: 'Aynı scope için eşzamanlı yükleme algılandı. Tekrar deneyin.',
      });
    }
    return err;
  }
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
