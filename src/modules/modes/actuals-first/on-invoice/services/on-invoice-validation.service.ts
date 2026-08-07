import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CustomerService } from '../../../../customer/customer.service';
import { SkuService } from '../../../../master-data/sku/sku.service';
import { BudgetService } from '../../../../shared/budget/budget.service';
import { BudgetThresholdService } from '../../../../shared/budget/budget-threshold.service';
import { ParsedOnInvoiceRow } from './on-invoice-file-parser.service';
import { OnInvoiceRepository } from '../on-invoice.repository';
import {
  ValidationResponseDto,
  ValidationErrorDto,
  BudgetImpactItemDto,
  DiscountDistributionDto,
} from '../dto/validation-response.dto';
import { OnInvoiceDiscountType } from '../../../../../database/entities/on-invoice-entry.entity';
import { CustomerStatus } from '../../../../../database/entities/customer.entity';
import { UtilizationStatus } from '../../../../shared/finance-reporting/dto/budget-utilization.dto';
import { diagnosticsOf } from '../../../../../common/errors/diagnostics';

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
  customerId?: string;
  skuId?: string;
  customerCode?: string;
  skuCode?: string;
  channel?: string;
  category?: string;
}

@Injectable()
export class OnInvoiceValidationService {
  private readonly logger = new Logger(OnInvoiceValidationService.name);

  constructor(
    private readonly customerService: CustomerService,
    private readonly skuService: SkuService,
    private readonly budgetService: BudgetService,
    private readonly budgetThresholdService: BudgetThresholdService,
    private readonly repository: OnInvoiceRepository,
  ) {}

  async validateRow(
    row: ParsedOnInvoiceRow,
    tenantId: string,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // 1. Customer Code kontrolü
    if (!row.dto.customerCode || row.dto.customerCode.trim() === '') {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'customer_code',
        severity: 'ERROR',
        message: 'Müşteri kodu zorunludur',
        originalRowData: row.originalRowData,
      });
      return {
        rowNumber: row.originalRowNumber,
        isValid: false,
        errors,
        warnings,
      };
    }

    // 2. Customer var mı ve aktif mi?
    let customer;
    try {
      customer = await this.customerService.findByCode(
        tenantId,
        row.dto.customerCode,
      );
    } catch (error) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'customer_code',
        severity: 'ERROR',
        message: `Müşteri kodu bulunamadı: ${row.dto.customerCode}`,
        originalRowData: row.originalRowData,
      });
      return {
        rowNumber: row.originalRowNumber,
        isValid: false,
        errors,
        warnings,
      };
    }

    if (customer.status !== CustomerStatus.ACTIVE) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'customer_code',
        severity: 'ERROR',
        message: `Müşteri aktif değil: ${row.dto.customerCode}`,
        originalRowData: row.originalRowData,
      });
    }

    // 3. SKU Code kontrolü
    if (!row.dto.skuCode || row.dto.skuCode.trim() === '') {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'sku_code',
        severity: 'ERROR',
        message: 'SKU kodu zorunludur',
        originalRowData: row.originalRowData,
      });
      return {
        rowNumber: row.originalRowNumber,
        isValid: false,
        errors,
        warnings,
      };
    }

    // 4. SKU var mı ve aktif mi?
    let sku;
    try {
      sku = await this.skuService.findByCode(tenantId, row.dto.skuCode);
    } catch (error) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'sku_code',
        severity: 'ERROR',
        message: `SKU kodu geçersiz: ${row.dto.skuCode}`,
        originalRowData: row.originalRowData,
      });
      return {
        rowNumber: row.originalRowNumber,
        isValid: false,
        errors,
        warnings,
      };
    }

    if (!sku.isActive) {
      warnings.push({
        rowNumber: row.originalRowNumber,
        field: 'sku_code',
        severity: 'WARNING',
        message: `SKU aktif değil: ${row.dto.skuCode}`,
        originalRowData: row.originalRowData,
      });
    }

    // 5. Invoice No kontrolü
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

    // 6. Invoice Date kontrolü
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
      today.setHours(23, 59, 59, 999);

      if (invoiceDate > today) {
        errors.push({
          rowNumber: row.originalRowNumber,
          field: 'invoice_date',
          severity: 'ERROR',
          message: 'Fatura tarihi gelecekte olamaz',
          originalRowData: row.originalRowData,
        });
      }
    }

    // 7. Fiscal Period kontrolü
    if (!row.dto.fiscalPeriod) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'fiscal_period',
        severity: 'ERROR',
        message: 'Fiscal period zorunludur',
        originalRowData: row.originalRowData,
      });
    } else {
      const fiscalPeriodRegex = /^\d{4}-\d{2}$/;
      if (!fiscalPeriodRegex.test(row.dto.fiscalPeriod)) {
        errors.push({
          rowNumber: row.originalRowNumber,
          field: 'fiscal_period',
          severity: 'ERROR',
          message: `Fiscal period formatı hatalı (YYYY-MM): ${row.dto.fiscalPeriod}`,
          originalRowData: row.originalRowData,
        });
      }
    }

    // 8. Quantity kontrolü
    if (
      row.dto.quantity === null ||
      row.dto.quantity === undefined ||
      row.dto.quantity <= 0
    ) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'quantity',
        severity: 'ERROR',
        message: 'Miktar pozitif bir sayı olmalıdır',
        originalRowData: row.originalRowData,
      });
    }

    // 9. List Price kontrolü
    if (
      row.dto.listPrice === null ||
      row.dto.listPrice === undefined ||
      row.dto.listPrice <= 0
    ) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'list_price',
        severity: 'ERROR',
        message: 'Liste fiyatı pozitif bir sayı olmalıdır',
        originalRowData: row.originalRowData,
      });
    }

    // 10. Actual Price kontrolü
    if (
      row.dto.actualPrice === null ||
      row.dto.actualPrice === undefined ||
      row.dto.actualPrice < 0
    ) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'actual_price',
        severity: 'ERROR',
        message: 'İndirimli fiyat negatif olamaz',
        originalRowData: row.originalRowData,
      });
    }

    // 11. Discount kontrolü
    if (row.dto.discount === null || row.dto.discount === undefined) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'discount',
        severity: 'ERROR',
        message: 'İndirim tutarı zorunludur',
        originalRowData: row.originalRowData,
      });
    } else if (row.dto.discount < 0) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'discount',
        severity: 'ERROR',
        message: 'Negatif indirim tutarı',
        originalRowData: row.originalRowData,
      });
    }

    // 12. Discount Type kontrolü
    if (!row.dto.discountType) {
      errors.push({
        rowNumber: row.originalRowNumber,
        field: 'discount_type',
        severity: 'ERROR',
        message: 'İndirim tipi zorunludur',
        originalRowData: row.originalRowData,
      });
    }

    // 13. Duplicate kontrolü (idempotency)
    if (
      row.dto.customerCode &&
      row.dto.invoiceNo &&
      row.dto.invoiceDate &&
      row.dto.skuCode
    ) {
      const invoiceDateStr = new Date(row.dto.invoiceDate)
        .toISOString()
        .split('T')[0];
      const idempotencyKey = `${row.dto.customerCode}|${row.dto.invoiceNo}|${invoiceDateStr}|${row.dto.skuCode}|${row.originalRowNumber}`;
      const existing = await this.repository.findByIdempotencyKey(
        idempotencyKey,
        tenantId,
      );

      if (existing) {
        errors.push({
          rowNumber: row.originalRowNumber,
          field: 'invoice_no',
          severity: 'ERROR',
          message: `Bu fatura satırı zaten mevcut. Fatura: ${row.dto.invoiceNo}, SKU: ${row.dto.skuCode}`,
          originalRowData: row.originalRowData,
        });
      }
    }

    // Get channel and category from customer and SKU
    let channel: string | undefined;
    let category: string | undefined;

    if (customer) {
      channel = customer.channel;
    }

    if (sku && sku.genericUnit && sku.genericUnit.category) {
      category = sku.genericUnit.category.code || sku.genericUnit.category.name;
    }

    return {
      rowNumber: row.originalRowNumber,
      isValid: errors.length === 0,
      errors,
      warnings,
      customerId: customer?.id,
      skuId: sku?.id,
      customerCode: customer?.code,
      skuCode: sku?.code,
      channel,
      category,
    };
  }

  async validateBatch(
    rows: ParsedOnInvoiceRow[],
    tenantId: string,
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const row of rows) {
      const result = await this.validateRow(row, tenantId);
      results.push(result);
    }

    return results;
  }

  /**
   * Validasyon sonuçlarını analiz eder ve özet bilgileri döner
   */
  async generateValidationSummary(
    rows: ParsedOnInvoiceRow[],
    validationResults: ValidationResult[],
    tenantId: string,
  ): Promise<ValidationResponseDto> {
    // Satır Analizi
    const totalRows = rows.length;
    const validRows = validationResults.filter((r) => r.isValid).length;
    const errorRows = validationResults.filter((r) => !r.isValid).length;

    // Finansal Özet
    const validRowsData = rows.filter(
      (_, index) => validationResults[index]?.isValid,
    );
    const totalDiscount = validRowsData.reduce(
      (sum, row) => sum + (row.dto.discount || 0),
      0,
    );

    // İndirim Dağılımı
    const discountDistribution: DiscountDistributionDto = {
      cppOnInvoice: { amount: 0, percentage: 0 },
      ltaOnInvoice: { amount: 0, percentage: 0 },
      promoDiscount: { amount: 0, percentage: 0 },
    };

    validRowsData.forEach((row) => {
      const discount = row.dto.discount || 0;
      if (row.dto.discountType === OnInvoiceDiscountType.CPP_ON) {
        discountDistribution.cppOnInvoice!.amount += discount;
      } else if (row.dto.discountType === OnInvoiceDiscountType.LTA_ON) {
        discountDistribution.ltaOnInvoice!.amount += discount;
      } else if (
        row.dto.discountType === OnInvoiceDiscountType.PROMO_DISCOUNT
      ) {
        discountDistribution.promoDiscount!.amount += discount;
      }
    });

    if (totalDiscount > 0) {
      discountDistribution.cppOnInvoice!.percentage =
        (discountDistribution.cppOnInvoice!.amount / totalDiscount) * 100;
      discountDistribution.ltaOnInvoice!.percentage =
        (discountDistribution.ltaOnInvoice!.amount / totalDiscount) * 100;
      discountDistribution.promoDiscount!.percentage =
        (discountDistribution.promoDiscount!.amount / totalDiscount) * 100;
    }

    // Bütçe Etkisi Simülasyonu
    const budgetImpact = await this.simulateBudgetImpact(
      validRowsData,
      validationResults,
      tenantId,
    );

    // Hatalar
    const errors: ValidationErrorDto[] = [];
    validationResults.forEach((result) => {
      result.errors.forEach((error) => {
        errors.push({
          rowNumber: error.rowNumber,
          field: error.field,
          message: error.message,
        });
      });
    });

    // Kritik envelope sayısı (RED seviyesine düşecek)
    const criticalEnvelopesCount = budgetImpact.filter(
      (bi) => bi.status === 'RED',
    ).length;

    // T-098: counted separately, never folded into criticalEnvelopesCount — an
    // envelope we could not read is not a finding about the budget.
    const unreadableEnvelopesCount = budgetImpact.filter(
      (bi) => bi.dataStatus === 'unavailable',
    ).length;

    return {
      lineAnalysis: {
        total: totalRows,
        valid: validRows,
        errors: errorRows,
      },
      financialSummary: {
        totalDiscount: totalDiscount,
      },
      discountDistribution: discountDistribution,
      budgetImpact: budgetImpact,
      errors: errors,
      criticalEnvelopesCount: criticalEnvelopesCount,
      unreadableEnvelopesCount: unreadableEnvelopesCount,
    };
  }

  /**
   * Bütçe etkisini simüle eder
   */
  private async simulateBudgetImpact(
    validRows: ParsedOnInvoiceRow[],
    validationResults: ValidationResult[],
    tenantId: string,
  ): Promise<BudgetImpactItemDto[]> {
    // Fetch thresholds once outside any loop (config-driven, tenant-scoped)
    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    // Envelope bazlı grupla
    const envelopeMap = new Map<
      string,
      {
        envelopeCode: string;
        current: number;
        thisUpload: number;
        channel?: string;
        category?: string;
        fiscalPeriod?: string;
      }
    >();

    validRows.forEach((row, index) => {
      const result = validationResults[index];
      if (!result || !result.isValid) return;

      const fiscalPeriod = row.dto.fiscalPeriod;
      const channel = result.channel;
      const category = result.category;

      if (!fiscalPeriod || !channel || !category) return;

      const envelopeKey = `${channel}|${category}|${fiscalPeriod}`;
      const envelopeCode = `${channel} / ${category} / ${fiscalPeriod}`;

      if (!envelopeMap.has(envelopeKey)) {
        envelopeMap.set(envelopeKey, {
          envelopeCode,
          current: 0,
          thisUpload: 0,
          channel,
          category,
          fiscalPeriod,
        });
      }

      const envelope = envelopeMap.get(envelopeKey)!;
      envelope.thisUpload += row.dto.discount || 0;
    });

    // Her envelope için mevcut durumu al ve simülasyon yap
    const budgetImpact: BudgetImpactItemDto[] = [];

    for (const [key, envelope] of envelopeMap.entries()) {
      try {
        // Envelope'u bul
        const foundEnvelope = await this.budgetService.findEnvelopeByDimensions(
          tenantId,
          envelope.channel!,
          envelope.fiscalPeriod!,
          envelope.category,
        );

        if (foundEnvelope) {
          const current = Number(foundEnvelope.availableAmount) || 0;
          const after = current - envelope.thisUpload;

          // Status belirleme (RAG) — config-driven thresholds, tenant-scoped
          const allocated = Number(foundEnvelope.allocatedAmount) || 0;
          const utilizationAfter =
            allocated > 0 ? ((allocated - after) / allocated) * 100 : 0;

          // Thresholds are fetched once outside the loop (passed via closure)
          const rawStatus = this.budgetThresholdService.toStatus(
            utilizationAfter,
            thresholds,
          );
          // Override to RED when actually exceeded or available goes negative
          const status: UtilizationStatus =
            this.budgetThresholdService.isExceeded(
              utilizationAfter,
              thresholds,
            ) || after < 0
              ? UtilizationStatus.RED
              : rawStatus;

          budgetImpact.push({
            envelopeCode: envelope.envelopeCode,
            current: current,
            thisUpload: -envelope.thisUpload, // Negatif göster (bütçeden düşülüyor)
            after: after,
            status: status,
            dataStatus: 'ok',
          });
        } else {
          // Envelope bulunamadı - uyarı olarak ekle.
          // ⚠️ T-098 sibling, deliberately NOT changed here: this branch's `0` is a
          // statement about a MISSING envelope, not a failed read, and whether an
          // absent envelope should report 0 or nothing is a product question
          // (CLAUDE.md §2.4). Recorded in T-098 rather than decided in passing.
          budgetImpact.push({
            envelopeCode: envelope.envelopeCode,
            current: 0,
            thisUpload: -envelope.thisUpload,
            after: -envelope.thisUpload,
            status: UtilizationStatus.RED, // Envelope yoksa RED
            dataStatus: 'ok',
          });
        }
      } catch (error) {
        // T-098: the row stays, the figures do not.
        //
        // This used to push `current: 0, status: RED`, which put a failure into the
        // report wearing two disguises at once: `0` is a valid budget figure, and
        // RED is a FINDING ("this upload breaches the threshold"). A reader had no
        // way to tell an unreadable envelope from a breached one.
        //
        // The row is still emitted on purpose — an envelope missing from a budget
        // impact report reads as "not affected", which is the same lie inverted.
        this.logger.warn(
          `Budget impact could not be computed for envelope ${envelope.envelopeCode} — reporting dataStatus=unavailable`,
          diagnosticsOf(error),
        );
        budgetImpact.push({
          envelopeCode: envelope.envelopeCode,
          current: null,
          thisUpload: -envelope.thisUpload,
          after: null,
          status: null,
          dataStatus: 'unavailable',
        });
      }
    }

    return budgetImpact;
  }
}
