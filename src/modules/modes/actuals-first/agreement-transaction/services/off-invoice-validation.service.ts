import { Injectable } from '@nestjs/common';
import { AgreementService } from '../../agreement/agreement.service';
import { AgreementStatus } from '../../../../../database/entities/agreement.entity';
import { ParsedOffInvoiceRow } from './off-invoice-file-parser.service';
import { AgreementTransactionRepository } from '../agreement-transaction.repository';
import { toPeriodMonthUtc } from '../../../../../common/date/period-month';

export interface ValidationError {
  rowNumber: number;
  field?: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  originalRowData?: Record<string, any>;
}

export interface ValidationResult {
  rowNumber: number;
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  agreementId?: string;
  invoiceNo?: string;
}

@Injectable()
export class OffInvoiceValidationService {
  constructor(
    private readonly agreementService: AgreementService,
    private readonly txRepository: AgreementTransactionRepository,
  ) {}

  async validateRow(
    row: ParsedOffInvoiceRow,
    tenantId: string,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // T-126: a field that failed to PARSE (present, but unreadable — §2.5)
    // is reported here, in the SAME row-level channel every check below
    // already uses — `OffInvoiceFileParserService.getDateValue`/
    // `getNumberValue`/`getFiscalPeriod` collect these instead of throwing,
    // so a single bad cell fails its OWN row instead of the whole upload
    // (measured regression this closes: previously one unreadable cell threw
    // out of `mapToTransactionDtos`'s `.map()` into `parseExcel`/`parseCSV`'s
    // file-level `catch`, rejecting every other row in the file too).
    // Pushed BEFORE the early-return checks below so a parse error survives
    // every one of them — the row is invalid either way.
    const parseErrorFields = new Set(
      (row.parseErrors ?? []).map((e) => e.field),
    );
    for (const parseError of row.parseErrors ?? []) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: parseError.field,
        severity: 'ERROR',
        message: parseError.error_message,
        originalRowData: row.originalRowData,
      });
    }

    // 1. Agreement ID kontrolü
    if (!row.dto.agreementId || row.dto.agreementId.trim() === '') {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'agreement_id',
        severity: 'ERROR',
        message: "Anlaşma ID'si zorunludur",
        originalRowData: row.originalRowData,
      });
      return {
        rowNumber: row.originalRowNumber,
        isValid: false,
        errors,
        warnings,
      };
    }

    // 2. Agreement var mı ve durumu uygun mu?
    let agreement;
    try {
      // Önce ID ile dene (UUID formatında mı?)
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          row.dto.agreementId,
        );
      if (isUUID) {
        agreement = await this.agreementService.findById(
          row.dto.agreementId,
          tenantId,
        );
      } else {
        // UUID değilse code ile dene
        agreement = await this.agreementService.findByCode(
          row.dto.agreementId,
          tenantId,
        );
      }
    } catch (error) {
      // Agreement bulunamadı
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'agreement_id',
        severity: 'ERROR',
        message: `Anlaşma bulunamadı: ${row.dto.agreementId}`,
        originalRowData: row.originalRowData,
      });
      return {
        rowNumber: row.originalRowNumber,
        isValid: false,
        errors,
        warnings,
      };
    }

    if (!agreement) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'agreement_id',
        severity: 'ERROR',
        message: `Anlaşma bulunamadı: ${row.dto.agreementId}`,
        originalRowData: row.originalRowData,
      });
      return {
        rowNumber: row.originalRowNumber,
        isValid: false,
        errors,
        warnings,
      };
    }

    // 3. Agreement durumu kontrolü
    //
    // [[T-335]] `Q21` — bu küme kod tabanında BEŞ yerde ayrı ayrı yazılı;
    // kaynak (Section_04:603, tam alıntı `agreement.entity.ts`
    // `IN_FORCE_AGREEMENT_STATES` yorumunda) BİR KEZ yazılıdır, buraya
    // TEKRAR EDİLMEZ. Bu kopyanın sorduğu soru: **"harcama girilebilir mi?"**
    // Kardeşleri (aynı DEĞER, FARKLI soru — bilerek birleştirilmedi):
    //   reversal.service.ts#REVERSIBLE_AGREEMENT_STATES         "ters kayıt atılabilir mi"
    //   settlement-close.service.ts#SETTLEABLE_STATES          "kapatılabilir mi"
    //   agreement.service.ts#cancel (durum kontrolü)                    "iptal edilebilir mi"
    //   agreement.entity.ts IN_FORCE_AGREEMENT_STATES             "oran kademesi harcama motoruna iner mi"
    // Biri değişirse diğer DÖRDÜ OTOMATİK değişmez — ayrı soru, ayrı karar.
    if (
      ![AgreementStatus.APPROVED, AgreementStatus.ACTIVE].includes(
        agreement.status,
      )
    ) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'agreement_id',
        severity: 'ERROR',
        message: `Anlaşma durumu uygun değil. Mevcut durum: ${agreement.status}. Sadece APPROVED veya ACTIVE anlaşmalar için giriş yapılabilir.`,
        originalRowData: row.originalRowData,
      });
    }

    if (agreement.status === 'CLOSED') {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'agreement_id',
        severity: 'ERROR',
        message: 'Kapatılmış anlaşmalar için giriş yapılamaz',
        originalRowData: row.originalRowData,
      });
    }

    // 4. Invoice No kontrolü
    if (!row.dto.invoiceNo || row.dto.invoiceNo.trim() === '') {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'invoice_no',
        severity: 'ERROR',
        message: 'Fatura numarası zorunludur',
        originalRowData: row.originalRowData,
      });
    } else if (row.dto.invoiceNo.length > 100) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'invoice_no',
        severity: 'ERROR',
        message: 'Fatura numarası en fazla 100 karakter olabilir',
        originalRowData: row.originalRowData,
      });
    }

    // 5. Invoice Date kontrolü
    if (!row.dto.invoiceDate) {
      // T-126: a present-but-unreadable cell already produced a SPECIFIC
      // `invoice_date` error above (parseErrorFields); do not also claim it
      // was never given — those are two different failures (§2.5).
      if (!parseErrorFields.has('invoice_date')) {
        errors.push({
          rowNumber: row.originalRowNumber,
          field: 'invoice_date',
          severity: 'ERROR',
          message: 'Fatura tarihi zorunludur',
          originalRowData: row.originalRowData,
        });
      }
    } else {
      const invoiceDate = new Date(row.dto.invoiceDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999); // Bugünün sonu

      // Gelecek tarih kontrolü
      if (invoiceDate > today) {
        errors.push({
          rowNumber: row.originalRowNumber,
          field: 'invoice_date',
          severity: 'ERROR',
          message: 'Fatura tarihi gelecekte olamaz',
          originalRowData: row.originalRowData,
        });
      }

      // Agreement period içinde mi? (Warning)
      if (agreement.startDate && agreement.endDate) {
        const startDate = new Date(agreement.startDate);
        const endDate = new Date(agreement.endDate);
        if (invoiceDate < startDate || invoiceDate > endDate) {
          warnings.push({
            rowNumber: row.originalRowNumber,
            field: 'invoice_date',
            severity: 'WARNING',
            message: `Fatura tarihi anlaşma dönemi dışında (${startDate.toISOString().split('T')[0]} - ${endDate.toISOString().split('T')[0]})`,
            originalRowData: row.originalRowData,
          });
        }
      }
    }

    // 6. Fiscal Period kontrolü
    if (row.fiscalPeriod) {
      const fiscalPeriodRegex = /^\d{4}-\d{2}$/;
      if (!fiscalPeriodRegex.test(row.fiscalPeriod)) {
        errors.push({
          rowNumber: row.originalRowNumber,
          field: 'fiscal_period',
          severity: 'ERROR',
          message: `Fiscal Period formatı hatalı (YYYY-MM): ${row.fiscalPeriod}`,
          originalRowData: row.originalRowData,
        });
      } else {
        // Fiscal period ile invoice date karşılaştırması
        // T-333 (Z81 §4): bu satır bir GÖSTERİM uyuşmazlığı değil, bir
        // ANAHTAR uyuşmazlığıdır — `row.fiscalPeriod` bütçe zarfı seçiminde
        // `create()`'in birincil-öncelikli anahtarı olarak kullanılıyor
        // (`agreement-transaction.service.ts` fiscalPeriod önceliği).
        // Tutarsız bir satır, faturayı YANLIŞ zarftan düşürebilir — "yarım
        // anahtar, tam anahtar kadar yanlış eşleşir" (Z81 §4). Bu yüzden
        // WARNING değil ERROR: satır reddedilir. (§4.2/§2.5 sınıfı — sessiz
        // yanlış eşleşme yerine açık red.)
        if (row.dto.invoiceDate) {
          const invoiceDate = new Date(row.dto.invoiceDate);
          const invoicePeriod = toPeriodMonthUtc(invoiceDate);

          if (row.fiscalPeriod !== invoicePeriod) {
            errors.push({
              rowNumber: row.originalRowNumber,
              field: 'fiscal_period',
              severity: 'ERROR',
              message: `Fiscal period (${row.fiscalPeriod}) fatura tarihinden türetilen dönemden (${invoicePeriod}) farklı — anahtar eşleşmesi bozulacağı için satır reddedildi.`,
              originalRowData: row.originalRowData,
            });
          }
        }
      }
    } else if (parseErrorFields.has('fiscal_period')) {
      // T-126: the cell WAS given but could not be parsed — already reported
      // above as a row-level ERROR with the specific reason. Do not ALSO
      // claim it was "not specified" (that warning is for the genuinely
      // absent case only).
      //
      // ⚠️ T-126 review (S3): "does not fall through to the fallback chain —
      // this row is invalid, full stop" is true only WITHIN this method.
      // Measured: `POST /agreement-transactions/validate-and-import`
      // (`agreement-transaction.controller.ts`) takes client-supplied
      // `rows: CreateAgreementTransactionDto[]` straight into
      // `AgreementTransactionService.batchImport` -> `create`, which does
      // NOT re-run `validateRow` — `create`'s own `agreement.periodMonth` /
      // `invoiceDate` fallback chain (`agreement-transaction.service.ts:
      // 109-119`) decides purely on `dto.fiscalPeriod`'s truthiness, with no
      // knowledge of this method's `parseErrorFields`. In practice this row
      // is kept out of the fallback because the frontend only resubmits
      // `validRows` from `POST /validate` — but that is a CLIENT
      // convention, not a server-enforced invariant; nothing on the server
      // re-validates a row this method rejected before `create` runs.
      // Server-side re-validation on import is a separate, larger question
      // — not this task's scope.
    } else {
      // Fiscal period zorunlu değil ama uyarı verilebilir
      warnings.push({
        rowNumber: row.originalRowNumber,
        field: 'fiscal_period',
        severity: 'WARNING',
        message: 'Fiscal period belirtilmedi. Bütçe düşümü için önerilir.',
        originalRowData: row.originalRowData,
      });
    }

    // 7. Amount kontrolü
    if (parseErrorFields.has('amount')) {
      // T-126: already reported above with the specific parse failure; an
      // unparseable amount has nothing to compare against the cap either, so
      // the cap-check branch below is skipped along with the generic
      // "zorunludur/pozitif" message.
    } else if (!row.dto.amount || row.dto.amount <= 0) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'amount',
        severity: 'ERROR',
        message: 'Tutar pozitif bir sayı olmalıdır',
        originalRowData: row.originalRowData,
      });
    } else {
      // Cap kontrolü (Warning)
      const currentTotal = await this.txRepository.sumByAgreementId(
        agreement.id,
        tenantId,
      );
      if (currentTotal + row.dto.amount > Number(agreement.capTotalAmount)) {
        warnings.push({
          rowNumber: row.originalRowNumber,
          field: 'amount',
          severity: 'WARNING',
          message: `Tutar anlaşma cap'ini aşıyor. Mevcut: ${currentTotal}, Eklenen: ${row.dto.amount}, Cap: ${agreement.capTotalAmount}`,
          originalRowData: row.originalRowData,
        });
      }
    }

    // 8. Duplicate kontrolü (idempotency)
    if (row.dto.agreementId && row.dto.invoiceNo && row.dto.invoiceDate) {
      const invoiceDateStr = new Date(row.dto.invoiceDate)
        .toISOString()
        .split('T')[0];
      const idempotencyKey = `${agreement.id}|${row.dto.invoiceNo}|${invoiceDateStr}`;
      const existing = await this.txRepository.findByIdempotencyKey(
        idempotencyKey,
        tenantId,
      );

      if (existing) {
        errors.push({
          rowNumber: row.originalRowNumber,
          field: 'invoice_no',
          severity: 'ERROR',
          message: `Bu fatura zaten mevcut. Fatura: ${row.dto.invoiceNo}, Tarih: ${invoiceDateStr}`,
          originalRowData: row.originalRowData,
        });
      }
    }

    return {
      rowNumber: row.originalRowNumber,
      isValid: errors.length === 0,
      errors,
      warnings,
      agreementId: agreement.id,
      invoiceNo: row.dto.invoiceNo,
    };
  }

  async validateBatch(
    rows: ParsedOffInvoiceRow[],
    tenantId: string,
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const row of rows) {
      const result = await this.validateRow(row, tenantId);
      results.push(result);
    }

    return results;
  }
}
