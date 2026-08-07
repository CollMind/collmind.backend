import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnInvoiceRepository } from './on-invoice.repository';
import {
  OnInvoiceFileParserService,
  ParsedOnInvoiceRow,
} from './services/on-invoice-file-parser.service';
import { OnInvoiceValidationService } from './services/on-invoice-validation.service';
import {
  OnInvoiceBatch,
  OnInvoiceBatchStatus,
} from '../../../../database/entities/on-invoice-batch.entity';
import {
  OnInvoiceEntry,
  OnInvoiceEntryStatus,
} from '../../../../database/entities/on-invoice-entry.entity';
import { CustomerService } from '../../../customer/customer.service';
import { SkuService } from '../../../master-data/sku/sku.service';
import {
  BudgetService,
  isSplitDimensionGuardError,
} from '../../../shared/budget/budget.service';
import { LedgerService } from '../ledger/ledger.service';
import { CreateOnInvoiceEntryDto } from './dto';
import { ValidationResponseDto, CompletionResponseDto } from './dto';
import { randomUUID } from 'crypto';
import { LedgerSourceType } from '../ledger/dto';
import { SpendType } from '../../../../database/entities/ledger-entry.entity';
import { BudgetSpendType } from '../../../../database/entities/budget-envelope.entity';
import { diagnosticsOf } from '../../../../common/errors/diagnostics';
import { isUserFacing } from '../../../../common/errors/user-facing';

@Injectable()
export class OnInvoiceService {
  private readonly logger = new Logger(OnInvoiceService.name);

  constructor(
    private readonly repository: OnInvoiceRepository,
    private readonly fileParserService: OnInvoiceFileParserService,
    private readonly validationService: OnInvoiceValidationService,
    private readonly customerService: CustomerService,
    private readonly skuService: SkuService,
    private readonly budgetService: BudgetService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Adım 1: Dosya yükleme, parse ve validasyon (tek seferde)
   */
  async uploadAndValidateFile(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
  ): Promise<{
    batchId: string;
    totalRows: number;
    validation: ValidationResponseDto;
  }> {
    // Parse et
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
    let parsedRows: ParsedOnInvoiceRow[];

    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      parsedRows = await this.fileParserService.parseExcel(file);
    } else if (fileExtension === 'csv') {
      parsedRows = await this.fileParserService.parseCSV(file);
    } else {
      throw new BadRequestException(
        'Desteklenmeyen dosya formatı. Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.',
      );
    }

    if (parsedRows.length === 0) {
      throw new BadRequestException('Dosya boş veya geçersiz.');
    }

    // Batch oluştur
    const fiscalPeriod = parsedRows[0]?.dto.fiscalPeriod;
    if (!fiscalPeriod) {
      throw new BadRequestException('Fiscal period belirtilmedi.');
    }

    const batchCode = `BATCH-ON-${fiscalPeriod.replace('-', '')}-${Date.now().toString().slice(-3)}`;
    const batch = await this.repository.createBatch({
      batchCode,
      status: OnInvoiceBatchStatus.PENDING,
      fiscalPeriod,
      totalRows: parsedRows.length,
      validRows: 0,
      errorRows: 0,
      totalDiscountAmount: 0,
      affectedEnvelopesCount: 0,
      fileName: file.originalname,
      fileSize: file.buffer.length,
      tenantId,
      createdBy: userId,
    });

    // Validasyon yap ve batch'e kaydet
    const validationSummary = await this.validateUploadedFile(
      batch.id,
      parsedRows,
      tenantId,
    );

    return {
      batchId: batch.id,
      totalRows: parsedRows.length,
      validation: validationSummary,
    };
  }

  /**
   * Adım 1: Sadece dosya yükleme ve parse (eski method, geriye uyumluluk için)
   */
  async uploadFile(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
  ): Promise<{ batchId: string; totalRows: number }> {
    if (!file) {
      throw new BadRequestException('Dosya yüklenmedi');
    }

    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
    let parsedRows: ParsedOnInvoiceRow[];

    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      parsedRows = await this.fileParserService.parseExcel(file);
    } else if (fileExtension === 'csv') {
      parsedRows = await this.fileParserService.parseCSV(file);
    } else {
      throw new BadRequestException(
        'Desteklenmeyen dosya formatı. Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.',
      );
    }

    if (parsedRows.length === 0) {
      throw new BadRequestException('Dosya boş veya geçersiz.');
    }

    // Fiscal period'u ilk satırdan al (tüm satırlar aynı period olmalı)
    const fiscalPeriod = parsedRows[0]?.dto.fiscalPeriod;
    if (!fiscalPeriod) {
      throw new BadRequestException('Fiscal period belirtilmedi.');
    }

    // Batch oluştur
    const batchCode = `BATCH-ON-${fiscalPeriod.replace('-', '')}-${Date.now().toString().slice(-3)}`;
    const batch = await this.repository.createBatch({
      batchCode,
      status: OnInvoiceBatchStatus.PENDING,
      fiscalPeriod,
      totalRows: parsedRows.length,
      validRows: 0,
      errorRows: 0,
      totalDiscountAmount: 0,
      affectedEnvelopesCount: 0,
      fileName: file.originalname,
      fileSize: file.buffer.length,
      tenantId,
      createdBy: userId,
    });

    return {
      batchId: batch.id,
      totalRows: parsedRows.length,
    };
  }

  /**
   * Adım 2: Validasyon ve özet
   */
  async validateBatch(
    batchId: string,
    tenantId: string,
  ): Promise<ValidationResponseDto> {
    const batch = await this.repository.findById(batchId, tenantId);
    if (!batch) {
      throw new NotFoundException('Batch bulunamadı');
    }

    // Batch'i VALIDATING durumuna al
    await this.repository.updateBatch(
      batchId,
      {
        status: OnInvoiceBatchStatus.VALIDATING,
      },
      tenantId,
    );

    try {
      // Dosyayı tekrar parse et (gerçek uygulamada cache'lenebilir)
      // Şimdilik batch'ten entries'leri al
      const entries = await this.repository.findEntriesByBatchId(
        batchId,
        tenantId,
      );

      // Eğer entries yoksa, dosyayı tekrar parse etmemiz gerekir
      // Bu durumda batch'te dosya bilgisi saklanmalı
      // Şimdilik basit bir yaklaşım: entries varsa onları kullan, yoksa hata ver
      if (entries.length === 0) {
        throw new BadRequestException(
          'Batch entries bulunamadı. Lütfen dosyayı tekrar yükleyin.',
        );
      }

      // Validation yap (entries'leri ParsedOnInvoiceRow formatına çevir)
      // Bu kısım gerçek uygulamada optimize edilebilir
      const validationResults = await this.validationService.validateBatch(
        entries.map((e) => ({
          dto: {
            customerCode: e.customerCode,
            invoiceNo: e.invoiceNo,
            invoiceDate: e.invoiceDate.toISOString().split('T')[0],
            fiscalPeriod: e.fiscalPeriod,
            skuCode: e.skuCode,
            quantity: Number(e.quantity),
            listPrice: Number(e.listPrice),
            actualPrice: Number(e.actualPrice),
            discount: Number(e.discount),
            discountType: e.discountType,
            currency: e.currency,
          },
          originalRowNumber: e.rowNumber,
        })),
        tenantId,
      );

      // Özet oluştur
      const summary = await this.validationService.generateValidationSummary(
        entries.map((e) => ({
          dto: {
            customerCode: e.customerCode,
            invoiceNo: e.invoiceNo,
            invoiceDate: e.invoiceDate.toISOString().split('T')[0],
            fiscalPeriod: e.fiscalPeriod,
            skuCode: e.skuCode,
            quantity: Number(e.quantity),
            listPrice: Number(e.listPrice),
            actualPrice: Number(e.actualPrice),
            discount: Number(e.discount),
            discountType: e.discountType,
            currency: e.currency,
          },
          originalRowNumber: e.rowNumber,
        })),
        validationResults,
        tenantId,
      );

      // Batch'i güncelle
      await this.repository.updateBatch(
        batchId,
        {
          status: OnInvoiceBatchStatus.VALIDATED,
          validRows: summary.lineAnalysis.valid,
          errorRows: summary.lineAnalysis.errors,
          totalDiscountAmount: summary.financialSummary.totalDiscount,
          validationSummary: summary,
        },
        tenantId,
      );

      return summary;
    } catch (error) {
      await this.repository.updateBatch(
        batchId,
        {
          status: OnInvoiceBatchStatus.FAILED,
        },
        tenantId,
      );
      throw error;
    }
  }

  /**
   * Adım 2 alternatif: Dosyadan direkt validasyon (upload sonrası)
   */
  async validateUploadedFile(
    batchId: string,
    parsedRows: ParsedOnInvoiceRow[],
    tenantId: string,
  ): Promise<ValidationResponseDto> {
    const batch = await this.repository.findById(batchId, tenantId);
    if (!batch) {
      throw new NotFoundException('Batch bulunamadı');
    }

    // Batch'i VALIDATING durumuna al
    await this.repository.updateBatch(
      batchId,
      {
        status: OnInvoiceBatchStatus.VALIDATING,
      },
      tenantId,
    );

    try {
      // Validation yap
      const validationResults = await this.validationService.validateBatch(
        parsedRows,
        tenantId,
      );

      // Özet oluştur
      const summary = await this.validationService.generateValidationSummary(
        parsedRows,
        validationResults,
        tenantId,
      );

      // Valid entries'leri batch'e kaydet (PENDING status ile)
      const validRows = parsedRows.filter(
        (_, index) => validationResults[index]?.isValid,
      );
      const entries: Partial<OnInvoiceEntry>[] = [];

      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        const result = validationResults[parsedRows.indexOf(row)];

        if (!result || !result.isValid) continue;

        const invoiceDate = new Date(row.dto.invoiceDate);
        const idempotencyKey = `${row.dto.customerCode}|${row.dto.invoiceNo}|${invoiceDate.toISOString().split('T')[0]}|${row.dto.skuCode}|${row.originalRowNumber}`;

        entries.push({
          batchId: batch.id,
          invoiceNo: row.dto.invoiceNo,
          invoiceDate: invoiceDate,
          fiscalPeriod: row.dto.fiscalPeriod,
          customerId: result.customerId!,
          customerCode: result.customerCode!,
          skuId: result.skuId!,
          skuCode: result.skuCode!,
          quantity: row.dto.quantity,
          listPrice: row.dto.listPrice,
          actualPrice: row.dto.actualPrice,
          discount: row.dto.discount,
          discountType: row.dto.discountType,
          currency: row.dto.currency || 'TRY',
          status: OnInvoiceEntryStatus.PENDING,
          validationStatus: 'VALID',
          rowNumber: row.originalRowNumber,
          idempotencyKey,
          tenantId,
        });
      }

      if (entries.length > 0) {
        await this.repository.createEntriesBatch(entries);
      }

      // Batch'i güncelle
      await this.repository.updateBatch(
        batchId,
        {
          status: OnInvoiceBatchStatus.VALIDATED,
          validRows: summary.lineAnalysis.valid,
          errorRows: summary.lineAnalysis.errors,
          totalDiscountAmount: summary.financialSummary.totalDiscount,
          affectedEnvelopesCount: summary.budgetImpact.length,
          validationSummary: summary,
        },
        tenantId,
      );

      return summary;
    } catch (error) {
      await this.repository.updateBatch(
        batchId,
        {
          status: OnInvoiceBatchStatus.FAILED,
        },
        tenantId,
      );
      throw error;
    }
  }

  /**
   * Adım 3: Batch işleme ve ledger entry oluşturma
   */
  async processBatch(
    batchId: string,
    tenantId: string,
    userId: string,
  ): Promise<CompletionResponseDto> {
    const batch = await this.repository.findById(batchId, tenantId);
    if (!batch) {
      throw new NotFoundException('Batch bulunamadı');
    }

    if (batch.status !== OnInvoiceBatchStatus.VALIDATED) {
      throw new BadRequestException(
        `Batch durumu uygun değil. Mevcut durum: ${batch.status}`,
      );
    }

    // Batch'i PROCESSING durumuna al
    await this.repository.updateBatch(
      batchId,
      {
        status: OnInvoiceBatchStatus.PROCESSING,
      },
      tenantId,
    );

    try {
      // Valid entries'leri al
      const entries = await this.repository.findEntriesByBatchId(
        batchId,
        tenantId,
      );
      const validEntries = entries.filter(
        (e) => e.status === OnInvoiceEntryStatus.PENDING,
      );

      let processedCount = 0;
      let totalDiscount = 0;
      const affectedEnvelopes = new Set<string>();

      for (const entry of validEntries) {
        try {
          // Customer ve SKU bilgilerini al
          const customer = await this.customerService.findOne(
            tenantId,
            entry.customerId,
          );
          const sku = await this.skuService.findOne(tenantId, entry.skuId);

          // Channel ve category belirle
          const channel = customer.channel;
          let category: string | undefined;
          if (sku.genericUnit && sku.genericUnit.category) {
            category =
              sku.genericUnit.category.code || sku.genericUnit.category.name;
          }

          // T-057 madde 4 (ölçüm sonucu, docs/analysis/0008 §5.7): this
          // service is unconditionally ON_INVOICE — there is no field
          // anywhere in `OnInvoiceEntry`/`CreateOnInvoiceEntryDto` that
          // varies the type, and the ledger entry created below has ALWAYS
          // hardcoded `spendType: SpendType.ON_INVOICE` (line ~466ish,
          // pre-existing, unrelated to this fix).
          //
          // Team Lead bağımsız doğrulama (2026-08-03, madde 3'teki canlı
          // regresyondan sonra genelleştirildi): HER ZAMAN tipli çözüm
          // kullanmak, `findEnvelopeByDimensions`'ın tipli-eşleşme sırasının
          // (§5.1: "tipli eşleşme UNSPLIT'i HER ZAMAN yener", dönem eşleşmesi
          // İKİNCİL kriterdir) AYNI KANAL + AYNI YIL'daki TAMAMEN alakasız
          // bir dönemde yaratılmış bir tipli zarfı (ör. bir test fixture'ı)
          // bu dimension'ın GERÇEK UNSPLIT zarfının yerine geçirmesine yol
          // açabilir — UNSPLIT boyutta davranış artık BİREBİR AYNI değildir.
          // T-056 adım 6 deseni: ÖNCE unqualified çağrı (bugünkü davranışın
          // ta kendisi), yalnızca GERÇEKTEN split edilmiş bir boyuta çarpıp
          // guard fırlarsa tipli çözüme geçilir — ikinci/bağımsız bir
          // "split mi?" sorgusu YOK.
          let envelope: Awaited<
            ReturnType<typeof this.budgetService.findEnvelopeByDimensions>
          >;
          try {
            envelope = await this.budgetService.findEnvelopeByDimensions(
              tenantId,
              channel,
              entry.fiscalPeriod,
              category,
            );
          } catch (err) {
            if (!isSplitDimensionGuardError(err)) {
              throw err;
            }
            // Genuinely split dimension — typed lookup now resolves the
            // correct ON_INVOICE twin (no ambiguity).
            envelope = await this.budgetService.findEnvelopeByDimensions(
              tenantId,
              channel,
              entry.fiscalPeriod,
              category,
              BudgetSpendType.ON_INVOICE,
            );
          }

          if (envelope) {
            // Ledger entry oluştur
            const idempotencyKey = `LEDGER|ON_INVOICE|${entry.id}`;
            await this.ledgerService.createEntry(
              {
                sourceType: LedgerSourceType.MANUAL,
                sourceId: entry.id,
                spendType: SpendType.ON_INVOICE,
                amount: entry.discount,
                periodMonth: entry.fiscalPeriod,
                // Independent bug found while producing T-057's e2e evidence
                // (unrelated to spend-type resolution, pre-existing at HEAD,
                // `git show HEAD` confirms): TypeORM hydrates a `type: 'date'`
                // column (`OnInvoiceEntry#invoiceDate`) as a plain
                // 'YYYY-MM-DD' STRING, not a `Date` — `entry.invoiceDate
                // .toISOString()` therefore threw `TypeError` on EVERY row,
                // for EVERY batch, always (proven live: measured 0/1 ledger
                // entries posted before this fix, unconditionally, on an
                // otherwise-valid UNSPLIT-dimension entry — not a split-
                // dimension-specific failure). `new Date(...)` accepts both
                // a `Date` and a date string, so this is safe regardless of
                // which shape a given TypeORM/driver version returns.
                postingDate: new Date(entry.invoiceDate)
                  .toISOString()
                  .split('T')[0],
                budgetEnvelopeId: envelope.id,
                channel,
                cplId: customer.cplId,
                fuId: sku.fuId,
              },
              tenantId,
              userId,
              idempotencyKey,
            );

            // Entry'yi POSTED durumuna al
            await this.repository.updateEntry(entry.id, {
              status: OnInvoiceEntryStatus.POSTED,
              budgetEnvelopeId: envelope.id,
            });

            affectedEnvelopes.add(envelope.id);
            totalDiscount += Number(entry.discount);
            processedCount++;
          } else {
            // Envelope bulunamadı - entry'yi ERROR durumuna al
            await this.repository.updateEntry(entry.id, {
              status: OnInvoiceEntryStatus.ERROR,
              validationStatus: 'ERROR',
              validationErrors: [
                {
                  message: `Budget envelope bulunamadı: ${channel} / ${category} / ${entry.fiscalPeriod}`,
                  severity: 'ERROR',
                },
              ],
            });
          }
        } catch (error) {
          // Hata durumunda entry'yi ERROR durumuna al.
          //
          // T-098: what gets persisted depends on WHO WROTE THE MESSAGE, and
          // that is DECLARED by the thrower, never inferred here.
          //
          // `validation_errors` is stored and returned by `GET /on-invoice/entries`,
          // so whatever lands here has left the server. Default: the class name.
          //
          // An earlier attempt used `instanceof HttpException` as a proxy for
          // "authored for a caller". Measured wrong on this exact path — the
          // reachable throwers are `Customer with ID <uuid> not found`,
          // `SKU with ID <uuid> not found`, and the split-guard's developer text,
          // all of them NotFoundException/BadRequestException and none of them
          // written for an uploader. See `common/errors/user-facing.ts` for the
          // full measurement and for why the default points at redaction.
          //
          // Nothing carries the marker today, so this reduces to redaction — the
          // intended starting point. The user-facing text for the common case is
          // not lost: the "envelope bulunamadı" branch above writes its own
          // message directly rather than throwing.
          //
          // Either way the full error, with `context` and stack, goes to the log
          // via `diagnosticsOf` — diagnosis is server-side, not in the entry.
          this.logger.error(
            `On-invoice entry ${entry.id} failed processing`,
            diagnosticsOf(error),
          );
          await this.repository.updateEntry(entry.id, {
            status: OnInvoiceEntryStatus.ERROR,
            validationStatus: 'ERROR',
            validationErrors: [
              {
                message: isUserFacing(error)
                  ? error.message
                  : error instanceof Error
                    ? `İşlenemedi (${error.name})`
                    : 'Bilinmeyen hata',
                severity: 'ERROR',
              },
            ],
          });
        }
      }

      // Batch'i COMPLETED durumuna al
      await this.repository.updateBatch(
        batchId,
        {
          status: OnInvoiceBatchStatus.COMPLETED,
          validRows: processedCount,
          totalDiscountAmount: totalDiscount,
          affectedEnvelopesCount: affectedEnvelopes.size,
        },
        tenantId,
      );

      return {
        batchId: batch.batchCode,
        uploadedRecords: processedCount,
        totalDiscount: totalDiscount,
        affectedEnvelopes: affectedEnvelopes.size,
      };
    } catch (error) {
      await this.repository.updateBatch(
        batchId,
        {
          status: OnInvoiceBatchStatus.FAILED,
        },
        tenantId,
      );
      throw error;
    }
  }

  /**
   * Tüm On-Invoice entry'lerini getir (filtrelerle)
   */
  async getEntries(
    tenantId: string,
    filters?: {
      batchId?: string;
      customerId?: string;
      skuId?: string;
      fiscalPeriod?: string;
      discountType?: string;
      invoiceDateFrom?: Date;
      invoiceDateTo?: Date;
      status?: string;
    },
  ): Promise<OnInvoiceEntry[]> {
    try {
      return await this.repository.findAllEntries(tenantId, {
        batchId: filters?.batchId,
        customerId: filters?.customerId,
        skuId: filters?.skuId,
        fiscalPeriod: filters?.fiscalPeriod,
        discountType: filters?.discountType,
        invoiceDateFrom: filters?.invoiceDateFrom,
        invoiceDateTo: filters?.invoiceDateTo,
        status: filters?.status,
      });
    } catch (error) {
      console.error('Error in getEntries:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `On-Invoice entry'leri getirilirken hata oluştu: ${errorMessage}`,
      );
    }
  }

  /**
   * Batch bilgilerini getir
   */
  async getBatch(batchId: string, tenantId: string): Promise<OnInvoiceBatch> {
    const batch = await this.repository.findById(batchId, tenantId);
    if (!batch) {
      throw new NotFoundException('Batch bulunamadı');
    }
    return batch;
  }

  /**
   * Template indir
   */
  generateExcelTemplate(): Buffer {
    return this.fileParserService.generateExcelTemplate();
  }

  generateCSVTemplate(): string {
    return this.fileParserService.generateCSVTemplate();
  }

  /**
   * Get total count of On-Invoice entries
   */
  async getCount(tenantId: string): Promise<number> {
    return this.repository.countEntries(tenantId);
  }
}
