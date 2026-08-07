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

import {
  parseNumericText,
  describeNumericTextFailure,
} from '../../../../../common/numeric/numeric-text';

const RECONCILIATION_TOLERANCE = 0.01;

/**
 * T-105: delegates to the single canonical parser. This function used to contain
 * its own separator logic, which read `1.234,56` as 1.23456 — a thousand times
 * too small, silently, on a live upload route. Three sibling parsers carried the
 * same defect; all four now share one grammar
 * (`common/numeric/numeric-text.ts`).
 *
 * Kept as a named function because the shape `string -> number | null` is what the
 * three call sites below expect. The failure REASON is available separately via
 * `parseNumericText` for callers that want to explain themselves — see
 * `amountFailure` below, which is why an ambiguous `1.234` no longer produces the
 * same message as `abc`.
 *
 * `Number()` on `canonical` is safe here in a way it never was on raw input: the
 * grammar admits only `-?\d+(\.\d+)?`, so `""` -> 0, `"0x10"` -> 16 and
 * `"Infinity"` -> Infinity cannot occur. That last one closes T-099 on this path.
 */
export function parseAmount(value: string | undefined): number | null {
  const result = parseNumericText(value);
  return result.ok ? Number(result.canonical) : null;
}

/**
 * The reason a value could not be read, for a row-level message. Returns
 * `undefined` when the value parses.
 */
export function amountFailure(value: string | undefined): string | undefined {
  const result = parseNumericText(value);
  return result.ok ? undefined : describeNumericTextFailure(result);
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
        message:
          amountFailure(rawRow.gross_amount) ??
          `Geçersiz gross_amount: '${rawRow.gross_amount}'`,
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
          message:
            amountFailure(rawRow.net_amount) ??
            `Geçersiz net_amount: '${rawRow.net_amount}'`,
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
          message:
            amountFailure(rawRow.discount_amount) ??
            `Geçersiz discount_amount: '${rawRow.discount_amount}'`,
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
