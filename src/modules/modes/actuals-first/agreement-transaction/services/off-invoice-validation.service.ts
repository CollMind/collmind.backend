import { Injectable, NotFoundException } from '@nestjs/common';
import { AgreementService } from '../../agreement/agreement.service';
import { AgreementStatus } from '../../../../../database/entities/agreement.entity';
import { ParsedOffInvoiceRow } from './off-invoice-file-parser.service';
import { AgreementTransactionRepository } from '../agreement-transaction.repository';

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
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'invoice_date',
        severity: 'ERROR',
        message: 'Fatura tarihi zorunludur',
        originalRowData: row.originalRowData,
      });
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
        // Fiscal period ile invoice date karşılaştırması (Warning)
        if (row.dto.invoiceDate) {
          const invoiceDate = new Date(row.dto.invoiceDate);
          const invoiceYear = invoiceDate.getFullYear();
          const invoiceMonth = String(invoiceDate.getMonth() + 1).padStart(
            2,
            '0',
          );
          const invoicePeriod = `${invoiceYear}-${invoiceMonth}`;

          if (row.fiscalPeriod !== invoicePeriod) {
            warnings.push({
              rowNumber: row.originalRowNumber,
              field: 'fiscal_period',
              severity: 'WARNING',
              message: `Fiscal period (${row.fiscalPeriod}) fatura tarihinden (${invoicePeriod}) farklı.`,
              originalRowData: row.originalRowData,
            });
          }
        }
      }
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
    if (!row.dto.amount || row.dto.amount <= 0) {
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
