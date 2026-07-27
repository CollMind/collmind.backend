import { Injectable } from '@nestjs/common';
import {
  SalesActualsMasterDataIndex,
  normalizeCategoryName,
} from './sales-actuals-lookup.service';
import { RowValidationIssue } from '../dto/ingest-result.dto';

export interface ValidRowResult {
  rowNumber: number;
  cplId: string;
  cplCode: string;
  categoryId: string;
  categoryName: string;
  channelId: string;
  channelCode: string;
  fiscalPeriod: string;
  grossAmount: number;
  netAmount?: number;
  discountAmount?: number;
  currency: string;
  rawRow: Record<string, string>;
}

export interface ResolvedRowScope {
  cplId: string;
  cplCode: string;
  categoryId: string;
  categoryName: string;
  channelId: string;
  channelCode: string;
}

export interface RowValidationOutcome {
  isValid: boolean;
  row?: ValidRowResult;
  errors: RowValidationIssue[];
  warnings: RowValidationIssue[];
  /**
   * cpl/category/channel başarıyla çözüldüyse (yalnızca tutar alanları
   * hatalı olsa bile) dolu — batch-seviyesi errorRows attribution için.
   */
  resolvedScope?: ResolvedRowScope;
}

const RECONCILIATION_TOLERANCE = 0.01;

/**
 * Türkçe biçimli sayıları (binlik ayraç '.', ondalık ',') ve düz İngilizce
 * biçimi de destekleyen esnek numeric parser. Boş/geçersiz -> null.
 */
export function parseAmount(value: string | undefined): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;

  let normalized = trimmed;
  if (normalized.includes(',') && normalized.split('.').length > 2) {
    // 1.234.567,89 -> binlik nokta, ondalık virgül
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',') && !normalized.includes('.')) {
    // 1234,56 -> virgül ondalık ayraç
    normalized = normalized.replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }

  const num = Number(normalized);
  return Number.isNaN(num) ? null : num;
}

@Injectable()
export class SalesActualsValidationService {
  /**
   * Tek satır validasyonu. BRD "varsayım yapma" kuralı gereği net+discount≠gross
   * yalnızca UYARI (satır kabul edilir); tüm diğer edge case'ler satır reddi.
   */
  validateRow(
    rawRow: Record<string, string>,
    rowNumber: number,
    fiscalPeriod: string,
    index: SalesActualsMasterDataIndex,
  ): RowValidationOutcome {
    const errors: RowValidationIssue[] = [];
    const warnings: RowValidationIssue[] = [];

    const cplCode = (rawRow.cpl_code ?? '').trim();
    const categoryCodeRaw = (rawRow.category_code ?? '').trim();
    const categoryNameRaw = (rawRow.category ?? '').trim();
    const channelCodeRaw = (rawRow.channel_code ?? '').trim();

    const cpl = cplCode ? index.cplByCode.get(cplCode) : undefined;
    if (!cpl) {
      errors.push({
        rowNumber,
        code: 'UNKNOWN_CPL',
        field: 'cpl_code',
        message: `Bilinmeyen CPL kodu: '${cplCode}'`,
      });
    }

    // Kategori: opsiyonel category_code varsa ÖNCELİKLİ (dayanıklılık).
    let category = undefined as ReturnType<Map<string, any>['get']> | undefined;
    if (categoryCodeRaw) {
      category = index.categoryByCode.get(categoryCodeRaw);
      if (!category) {
        errors.push({
          rowNumber,
          code: 'UNKNOWN_CATEGORY',
          field: 'category_code',
          message: `Bilinmeyen kategori kodu: '${categoryCodeRaw}'`,
        });
      }
    } else if (!categoryNameRaw) {
      errors.push({
        rowNumber,
        code: 'UNKNOWN_CATEGORY',
        field: 'category',
        message: 'Kategori alanı boş',
      });
    } else {
      const normalized = normalizeCategoryName(categoryNameRaw);
      const matches = index.categoryByNormalizedName.get(normalized) ?? [];
      if (matches.length === 0) {
        errors.push({
          rowNumber,
          code: 'UNKNOWN_CATEGORY',
          field: 'category',
          message: `Bilinmeyen kategori: '${categoryNameRaw}'`,
        });
      } else if (matches.length > 1) {
        errors.push({
          rowNumber,
          code: 'AMBIGUOUS_CATEGORY',
          field: 'category',
          message: `'${categoryNameRaw}' normalize edilince ${matches.length} kategoriyle eşleşiyor (${matches
            .map((m) => m.code)
            .join(', ')}). category_code kolonu ile netleştirin.`,
        });
      } else {
        category = matches[0];
      }
    }

    // Kanal: bağımsız çözümleme + CPL'in kanalına çapraz doğrulama.
    const resolvedChannel = channelCodeRaw
      ? index.channelByCode.get(channelCodeRaw)
      : undefined;
    if (!channelCodeRaw || !resolvedChannel) {
      errors.push({
        rowNumber,
        code: 'CHANNEL_MISMATCH',
        field: 'channel_code',
        message: `Bilinmeyen kanal kodu: '${channelCodeRaw}'`,
      });
    } else if (cpl && resolvedChannel.id !== cpl.channelId) {
      const cplChannel = index.channelById.get(cpl.channelId);
      errors.push({
        rowNumber,
        code: 'CHANNEL_MISMATCH',
        field: 'channel_code',
        message: `Satır kanalı ('${channelCodeRaw}') CPL'in kanalıyla ('${cplChannel?.code ?? cpl.channelId}') uyuşmuyor`,
      });
    }

    const grossAmount = parseAmount(rawRow.gross_amount);
    if (grossAmount === null || grossAmount <= 0) {
      errors.push({
        rowNumber,
        code: 'INVALID_GROSS_AMOUNT',
        field: 'gross_amount',
        message: `Geçersiz gross_amount: '${rawRow.gross_amount}'`,
      });
    }

    let netAmount: number | null = null;
    if (rawRow.net_amount !== undefined && rawRow.net_amount !== '') {
      netAmount = parseAmount(rawRow.net_amount);
      if (netAmount === null) {
        errors.push({
          rowNumber,
          code: 'INVALID_NET_AMOUNT',
          field: 'net_amount',
          message: `Geçersiz net_amount: '${rawRow.net_amount}'`,
        });
      }
    }

    let discountAmount: number | null = null;
    if (rawRow.discount_amount !== undefined && rawRow.discount_amount !== '') {
      discountAmount = parseAmount(rawRow.discount_amount);
      if (discountAmount === null) {
        errors.push({
          rowNumber,
          code: 'INVALID_DISCOUNT_AMOUNT',
          field: 'discount_amount',
          message: `Geçersiz discount_amount: '${rawRow.discount_amount}'`,
        });
      }
    }

    if (
      grossAmount !== null &&
      grossAmount > 0 &&
      netAmount !== null &&
      netAmount > grossAmount
    ) {
      errors.push({
        rowNumber,
        code: 'NET_EXCEEDS_GROSS',
        field: 'net_amount',
        message: `net_amount (${netAmount}) gross_amount'tan (${grossAmount}) büyük olamaz`,
      });
    }

    const resolvedScope: ResolvedRowScope | undefined =
      cpl && category && resolvedChannel && resolvedChannel.id === cpl.channelId
        ? {
            cplId: cpl.id,
            cplCode: cpl.code,
            categoryId: category.id,
            categoryName: category.name,
            channelId: cpl.channelId,
            channelCode: resolvedChannel.code,
          }
        : undefined;

    if (errors.length > 0) {
      return { isValid: false, errors, warnings, resolvedScope };
    }

    // BRD'de tanımsız reconciliation kuralı -> yalnızca warning, satır kabul.
    if (
      grossAmount !== null &&
      netAmount !== null &&
      discountAmount !== null &&
      Math.abs(netAmount + discountAmount - grossAmount) >
        RECONCILIATION_TOLERANCE
    ) {
      warnings.push({
        rowNumber,
        code: 'AMOUNT_RECONCILIATION',
        message: `net_amount (${netAmount}) + discount_amount (${discountAmount}) != gross_amount (${grossAmount})`,
      });
    }

    return {
      isValid: true,
      errors: [],
      warnings,
      resolvedScope,
      row: {
        rowNumber,
        cplId: cpl!.id,
        cplCode: cpl!.code,
        categoryId: category!.id,
        categoryName: category!.name,
        channelId: cpl!.channelId,
        channelCode: resolvedChannel!.code,
        fiscalPeriod,
        grossAmount: grossAmount as number,
        netAmount: netAmount ?? undefined,
        discountAmount: discountAmount ?? undefined,
        currency: (rawRow.currency ?? 'TRY').trim() || 'TRY',
        rawRow,
      },
    };
  }
}
