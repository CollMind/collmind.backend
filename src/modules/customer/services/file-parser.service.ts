import { Injectable, BadRequestException } from '@nestjs/common';
import {
  parseOptionalNumericText,
  describeNumericTextFailure,
} from '../../../common/numeric/numeric-text';
import {
  excelSerialToIsoDate,
  describeExcelSerialDateFailure,
} from '../../../common/date/excel-serial-date';
import {
  parseOptionalDateText,
  describeDateTextFailure,
} from '../../../common/date/date-text';
import { pickCell } from '../../../common/row-parsing/pick-cell';
import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import {
  CustomerChannel,
  CustomerType,
  CustomerStatus,
} from '../../../database/entities/customer.entity';

/**
 * T-121 review (a): a single field on a single row that could not be turned
 * into a value (an unparseable date or number cell) is a ROW-LEVEL error,
 * not a file-level one (§2.5 — present-but-unreadable must not be silently
 * dropped, and must not take the whole file down with it either). This is
 * the shape that carries ONE such failure from `getOptionalDate` /
 * `getOptionalNumber` up to `CustomerService.importFromFile`'s existing
 * per-row error channel (`{ row, code, error_type, error_message,
 * original_row_data }`, see `customer.service.ts`).
 *
 * `error_type` reuses the vocabulary already documented on the `POST
 * /customers/import` Swagger response (`customer.controller.ts`) —
 * `INVALID_DATE` for the date family, `INVALID_AMOUNT` for the numeric
 * family (deliberately covers counts like `numberOfBranches` too: they go
 * through the same strict-grammar parser as money fields, and introducing a
 * third, undocumented error type for them would be an unrequested API
 * surface expansion — §2.4).
 */
export interface FieldParseError {
  field: string;
  error_type: string;
  error_message: string;
}

export interface ParsedCustomerRow {
  dto: CreateCustomerDto;
  originalRowNumber: number;
  originalRowData?: Record<string, any>;
  /** Non-empty iff at least one field on this row failed to parse. Ordered
   *  by field-declaration order in `mapToCustomerDtos`, so `[0]` is the same
   *  "first error wins" field the rest of this file's validation already
   *  uses (see `CustomerService.validateCustomerDto`). */
  parseErrors?: FieldParseError[];
}

@Injectable()
export class FileParserService {
  async parseExcel(file: Express.Multer.File): Promise<ParsedCustomerRow[]> {
    try {
      // Security: Limit file size to prevent DoS attacks (10MB max)
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.buffer.length > MAX_FILE_SIZE) {
        throw new BadRequestException(
          'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.',
        );
      }

      // Security: Limit sheet processing to prevent ReDoS (CVE-2024-22363 mitigation)
      // Note: sheetRows includes header row, so 10001 = 1 header + 10000 data rows (consistent with CSV parser)
      const workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        cellDates: false, // Disable date parsing to reduce attack surface
        cellNF: false, // Disable number format parsing
        cellStyles: false, // Disable style parsing
        sheetRows: 10001, // Limit rows to prevent DoS (10000 data rows max, same as CSV parser)
      });

      // Security: Limit number of sheets processed
      if (workbook.SheetNames.length === 0) {
        throw new BadRequestException('Excel dosyası boş veya geçersiz.');
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Security: Additional validation - check if worksheet is valid
      if (!worksheet || !worksheet['!ref']) {
        throw new BadRequestException('Excel dosyası geçersiz veya boş.');
      }

      // T-121 review B4: `blankrows: false` DROPS a blank row from this
      // array instead of keeping it as an entry — measured: a sheet with a
      // blank row at sheet row 3 (header=1, C1=2, blank=3, C2=4, C3=5)
      // produced an array of 3 elements, and `mapToCustomerDtos`'s
      // `index + 2` then numbered them 2, 3, 4 — C2 and C3 both reported
      // one row EARLY, off by exactly the number of blank rows skipped
      // before them. The CSV branch below does not have this gap:
      // `csv-parser` emits one object per physical line including blank
      // ones, so its index already accounts for them. `blankrows: true`
      // makes the Excel branch match: the blank row becomes a real entry
      // (every cell reads as the `null` sentinel normalized by
      // `normalizeBlankCells` below), gets a correct row number, and is
      // then dropped by the SAME `code || name` filter that already drops
      // blank CSV rows — not by being invisible to the indexer.
      const data = XLSX.utils.sheet_to_json(worksheet, {
        raw: true, // T-107 adım 2: hücreyi kaynağında oku (sayı/tarih hücreleri
        // metne çevrilmeden gelir) — bkz. `parseOptionalNumericText` ve
        // `excelSerialToIsoDate`, ikisi de sayısal girdiyi zaten kabul ediyor.
        //
        // T-107 adım 2: `defval` was `false` (a boolean) until this turn,
        // labelled "prevent prototype pollution" — measured (2026-08-10,
        // under `raw: true`): a `__proto__` header column produces the row
        // key `__proto___NaN` under BOTH `defval: false` and `defval:
        // null`, and `({}).<anything>` stays `undefined` either way —
        // SheetJS's own header handling is what neutralizes `__proto__`,
        // not this option. The `false`/`null` choice here is orthogonal to
        // that protection. `null` is used instead because, under `raw:
        // true`, a cell SheetJS actually read is only ever `string |
        // number | boolean` (see `cellDates: false` above) — `null` can
        // therefore never collide with something a user typed, which the
        // old `false` sentinel did (a real boolean `false` cell was
        // indistinguishable from a blank one; see `normalizeBlankCells`).
        defval: null,
        blankrows: true, // T-121 B4: keep blank rows as entries so row numbers stay aligned with the file; they are dropped later by mapToCustomerDtos's code||name filter, same as CSV
      });

      return this.mapToCustomerDtos(data);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`Excel dosyası okunamadı: ${errorMessage}`);
    }
  }

  async parseCSV(file: Express.Multer.File): Promise<ParsedCustomerRow[]> {
    try {
      // Security: Limit file size to prevent DoS attacks (10MB max) - same as parseExcel
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.buffer.length > MAX_FILE_SIZE) {
        throw new BadRequestException(
          'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.',
        );
      }

      // Security: Limit row count to prevent DoS attacks (10000 data rows max, same as Excel parser)
      // Note: csv-parser handles header separately, so MAX_ROWS counts data rows only
      const MAX_ROWS = 10000;
      let rowCount = 0;

      return new Promise((resolve, reject) => {
        const results: Record<string, string>[] = [];
        const stream = Readable.from(file.buffer.toString('utf-8'));

        stream
          .pipe(csvParser())
          .on('data', (data: Record<string, string>) => {
            rowCount++;
            // Security: Stop processing if row limit exceeded
            if (rowCount > MAX_ROWS) {
              stream.destroy();
              reject(
                new BadRequestException(
                  `CSV dosyası çok fazla satır içeriyor. Maksimum ${MAX_ROWS} satır işlenebilir.`,
                ),
              );
              return;
            }
            results.push(data);
          })
          .on('end', () => {
            try {
              if (results.length === 0) {
                throw new BadRequestException('CSV dosyası boş veya geçersiz.');
              }
              const customerDtos = this.mapToCustomerDtos(results);
              resolve(customerDtos);
            } catch (error) {
              if (error instanceof BadRequestException) {
                reject(error);
                return;
              }
              const errorMessage =
                error instanceof Error ? error.message : 'Bilinmeyen hata';
              reject(
                new BadRequestException(
                  `CSV dosyası işlenemedi: ${errorMessage}`,
                ),
              );
            }
          })
          .on('error', (error: Error) => {
            const errorMessage =
              error instanceof Error ? error.message : 'Bilinmeyen hata';
            reject(
              new BadRequestException(`CSV dosyası okunamadı: ${errorMessage}`),
            );
          });
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`CSV dosyası işlenemedi: ${errorMessage}`);
    }
  }

  /**
   * T-107 adım 2: renamed from `stripBlankCellSentinel` and re-pointed at
   * `null`, not `false` — the blank-cell sentinel changed shape when
   * `parseExcel`'s `sheet_to_json` call switched `defval` from `false` to
   * `null` (see that call site's comment for why `false` was never a safe
   * sentinel under `raw: true`: it collided with a REAL boolean cell, e.g.
   * `IS_VIP`, which `raw: true` now reads as the actual JS boolean `false`
   * rather than the string `"FALSE"`).
   *
   * This method is no longer load-bearing for alias resolution — every
   * `row.a || row.b || row.c` chain below has been replaced with
   * `pickCell(row, 'a', 'b', 'c')` (`common/row-parsing/pick-cell.ts`),
   * which already treats `null` and `undefined` as equally absent, so a raw,
   * unnormalized row would resolve identically. What this pass still buys is
   * `originalRowData` (stored below, for the caller's row-level error
   * reporting): without it, a blank cell would surface downstream as the
   * literal `null` instead of an omitted key. Kept for that reason, not for
   * correctness.
   *
   * Return type is deliberately `any`, not `Record<string, any>`: spreading a
   * `Record<string, any>`-typed value into an object literal together with a
   * named property (`_originalRowNumber`) makes TS drop the index signature
   * from the resulting literal type — measured, `tsc --strict` then refuses
   * every `row.SOME_ALIAS` access below with "Property does not exist on
   * type '{ _originalRowNumber: number }'". `data: any[]` already makes this
   * whole pipeline untyped by design; `any` here keeps it that way instead of
   * fighting a spread-narrowing quirk with no behavioural benefit.
   */
  private normalizeBlankCells(row: Record<string, any>): any {
    const normalized: Record<string, any> = {};
    for (const key of Object.keys(row)) {
      normalized[key] = row[key] === null ? undefined : row[key];
    }
    return normalized;
  }

  private mapToCustomerDtos(data: any[]): ParsedCustomerRow[] {
    // Önce her satıra orijinal satır numarasını ekle (header + 1-based index)
    const dataWithRowNumbers = data.map((row, index) => ({
      ...this.normalizeBlankCells(row),
      _originalRowNumber: index + 2, // +2: header row (1) + 0-based index (1) = 2
    }));

    // Sonra boş satırları filtrele ve DTO'ya çevir
    return dataWithRowNumbers
      .filter((row) => row.code || row.name) // Boş satırları filtrele
      .map((row) => {
        // T-121 review (a): field-level parse failures (an unreadable date or
        // number cell) are collected here, in field-declaration order, rather
        // than thrown — a thrown exception from inside this object literal
        // would abort the WHOLE FILE at the first bad cell (measured: the
        // prior design turned `getOptionalDate`'s throw into
        // `CustomerService.importFromFile`'s file-level `BadRequestException`
        // at line ~244, losing the row number entirely). `getOptionalDate`
        // is deliberately unaware of the destination — it only appends to
        // this array — so it stays the single seam per T-107 adım 1 /
        // T-105's own split (parsing vs. what an invalid value MEANS to the
        // caller).
        const parseErrors: FieldParseError[] = [];
        const dto: CreateCustomerDto = {
          code: this.getStringValue(
            pickCell(row, 'code', 'Code', 'CODE') ??
              `AUTO_${row._originalRowNumber}`,
          ),
          name: this.getStringValue(
            pickCell(row, 'name', 'Name', 'NAME') ?? '',
          ),
          channel: this.getChannel(
            pickCell(row, 'channel', 'Channel', 'CHANNEL') ?? 'RETAIL',
          ),
          type: this.getType(pickCell(row, 'type', 'Type', 'TYPE')),
          status: this.getStatus(pickCell(row, 'status', 'Status', 'STATUS')),
          city: this.getOptionalString(pickCell(row, 'city', 'City', 'CITY')),
          district: this.getOptionalString(
            pickCell(row, 'district', 'District', 'DISTRICT'),
          ),
          region: this.getOptionalString(
            pickCell(row, 'region', 'Region', 'REGION'),
          ),
          country: this.getOptionalString(
            pickCell(row, 'country', 'Country', 'COUNTRY'),
          ),
          address: this.getOptionalString(
            pickCell(row, 'address', 'Address', 'ADDRESS'),
          ),
          postalCode: this.getOptionalString(
            pickCell(
              row,
              'postalCode',
              'postal_code',
              'PostalCode',
              'POSTAL_CODE',
            ),
          ),
          taxNumber: this.getOptionalString(
            pickCell(row, 'taxNumber', 'tax_number', 'TaxNumber', 'TAX_NUMBER'),
          ),
          taxOffice: this.getOptionalString(
            pickCell(row, 'taxOffice', 'tax_office', 'TaxOffice', 'TAX_OFFICE'),
          ),
          companyRegistrationNumber: this.getOptionalString(
            pickCell(
              row,
              'companyRegistrationNumber',
              'company_registration_number',
              'CompanyRegistrationNumber',
              'COMPANY_REGISTRATION_NUMBER',
            ),
          ),
          contactPerson: this.getOptionalString(
            pickCell(
              row,
              'contactPerson',
              'contact_person',
              'ContactPerson',
              'CONTACT_PERSON',
            ),
          ),
          contactEmail: this.getOptionalString(
            pickCell(
              row,
              'contactEmail',
              'contact_email',
              'ContactEmail',
              'CONTACT_EMAIL',
            ),
          ),
          contactPhone: this.getOptionalString(
            pickCell(
              row,
              'contactPhone',
              'contact_phone',
              'ContactPhone',
              'CONTACT_PHONE',
            ),
          ),
          contactMobile: this.getOptionalString(
            pickCell(
              row,
              'contactMobile',
              'contact_mobile',
              'ContactMobile',
              'CONTACT_MOBILE',
            ),
          ),
          paymentTerms: this.getOptionalString(
            pickCell(
              row,
              'paymentTerms',
              'payment_terms',
              'PaymentTerms',
              'PAYMENT_TERMS',
            ),
          ),
          creditLimit: this.getOptionalNumber(
            pickCell(
              row,
              'creditLimit',
              'credit_limit',
              'CreditLimit',
              'CREDIT_LIMIT',
            ),
            'creditLimit',
            parseErrors,
          ),
          currency:
            this.getOptionalString(
              pickCell(row, 'currency', 'Currency', 'CURRENCY'),
            ) || 'TRY',
          salesRepresentative: this.getOptionalString(
            pickCell(
              row,
              'salesRepresentative',
              'sales_representative',
              'SalesRepresentative',
              'SALES_REPRESENTATIVE',
            ),
          ),
          accountManager: this.getOptionalString(
            pickCell(
              row,
              'accountManager',
              'account_manager',
              'AccountManager',
              'ACCOUNT_MANAGER',
            ),
          ),
          customerGroup: this.getOptionalString(
            pickCell(
              row,
              'customerGroup',
              'customer_group',
              'CustomerGroup',
              'CUSTOMER_GROUP',
            ),
          ),
          customerSegment: this.getOptionalString(
            pickCell(
              row,
              'customerSegment',
              'customer_segment',
              'CustomerSegment',
              'CUSTOMER_SEGMENT',
            ),
          ),
          customerTier: this.getOptionalString(
            pickCell(
              row,
              'customerTier',
              'customer_tier',
              'CustomerTier',
              'CUSTOMER_TIER',
            ),
          ),
          businessSize: this.getOptionalString(
            pickCell(
              row,
              'businessSize',
              'business_size',
              'BusinessSize',
              'BUSINESS_SIZE',
            ),
          ),
          annualRevenue: this.getOptionalNumber(
            pickCell(
              row,
              'annualRevenue',
              'annual_revenue',
              'AnnualRevenue',
              'ANNUAL_REVENUE',
            ),
            'annualRevenue',
            parseErrors,
          ),
          lastOrderDate: this.getOptionalDate(
            pickCell(
              row,
              'lastOrderDate',
              'last_order_date',
              'LastOrderDate',
              'LAST_ORDER_DATE',
            ),
            'lastOrderDate',
            parseErrors,
          ),
          firstOrderDate: this.getOptionalDate(
            pickCell(
              row,
              'firstOrderDate',
              'first_order_date',
              'FirstOrderDate',
              'FIRST_ORDER_DATE',
            ),
            'firstOrderDate',
            parseErrors,
          ),
          numberOfBranches: this.getOptionalNumber(
            pickCell(
              row,
              'numberOfBranches',
              'number_of_branches',
              'NumberOfBranches',
              'NUMBER_OF_BRANCHES',
            ),
            'numberOfBranches',
            parseErrors,
          ),
          notes: this.getOptionalString(
            pickCell(row, 'notes', 'Notes', 'NOTES'),
          ),
          isVip: this.getOptionalBoolean(
            pickCell(row, 'isVip', 'is_vip', 'IsVip', 'IS_VIP'),
          ),
          contractStartDate: this.getOptionalDate(
            pickCell(
              row,
              'contractStartDate',
              'contract_start_date',
              'ContractStartDate',
              'CONTRACT_START_DATE',
            ),
            'contractStartDate',
            parseErrors,
          ),
          contractEndDate: this.getOptionalDate(
            pickCell(
              row,
              'contractEndDate',
              'contract_end_date',
              'ContractEndDate',
              'CONTRACT_END_DATE',
            ),
            'contractEndDate',
            parseErrors,
          ),
        };

        // Metadata objesi oluştur — T-107 adım 2: presence is decided by
        // "is any of these three fields NOT absent" (`!== undefined`), not
        // by JS-truthiness — a real `storeSize: 0` must still create the
        // metadata object, and under the old `row.a || row.b || ...`
        // existence check it would not have (same silent-zero shape as the
        // scalar fields above, just applied to an object-creation decision
        // instead of a value).
        const storeSize = pickCell(
          row,
          'storeSize',
          'store_size',
          'StoreSize',
          'STORE_SIZE',
        );
        const numberOfEmployees = pickCell(
          row,
          'numberOfEmployees',
          'number_of_employees',
          'NumberOfEmployees',
          'NUMBER_OF_EMPLOYEES',
        );
        const industry = pickCell(row, 'industry', 'Industry', 'INDUSTRY');
        if (
          storeSize !== undefined ||
          numberOfEmployees !== undefined ||
          industry !== undefined
        ) {
          dto.metadata = {
            storeSize: this.getOptionalNumber(
              storeSize,
              'metadata.storeSize',
              parseErrors,
            ),
            numberOfEmployees: this.getOptionalNumber(
              numberOfEmployees,
              'metadata.numberOfEmployees',
              parseErrors,
            ),
            industry: this.getOptionalString(industry),
          };
        }

        return {
          dto,
          originalRowNumber: row._originalRowNumber,
          originalRowData: row, // Store original row data for error reporting
          parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
        };
      });
  }

  private getStringValue(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private getOptionalString(value: any): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const str = String(value).trim();
    return str || undefined;
  }

  /**
   * T-105 / T-121 review (a): `undefined` means ABSENT and nothing else.
   *
   * It used to mean both "not given" and "unreadable", which merged a legitimate
   * absence with a silent failure (CLAUDE.md §2.5). It also rejected every Turkish
   * format outright — `1.234,56` went to `undefined` — so a credit limit written
   * the way a Turkish user writes it simply vanished from the import.
   *
   * An unreadable-but-present value is now a ROW-LEVEL error, appended to
   * `errors` under `field`, not a thrown exception. T-121 review (a) measured
   * the earlier throw-based version: it crossed `mapToCustomerDtos`'s single
   * `.map()` call and `parseExcel`/`parseCSV`'s own try/catch, and
   * `CustomerService.importFromFile` (line ~244) turned it into a
   * FILE-level `BadRequestException` — one bad cell anywhere in the file
   * rejected the entire upload, with no row number and no indication of
   * which field. That is a real regression relative to the row-level channel
   * this method's caller already has (`{ row, code, error_type,
   * error_message, original_row_data }`) — collecting into it, instead of
   * throwing past it, is the fix.
   */
  private getOptionalNumber(
    value: any,
    field: string,
    errors: FieldParseError[],
  ): number | undefined {
    const result = parseOptionalNumericText(value);
    if (result === undefined) return undefined;
    if (!result.ok) {
      errors.push({
        field,
        error_type: 'INVALID_AMOUNT',
        error_message: describeNumericTextFailure(result),
      });
      return undefined;
    }
    return Number(result.canonical);
  }

  private getOptionalBoolean(value: any): boolean | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const str = String(value).toLowerCase().trim();
    return str === 'true' || str === '1' || str === 'yes' || str === 'evet';
  }

  /**
   * T-121 review (a): `undefined` means ABSENT and nothing else, on both
   * branches below. Neither branch guesses or silently drops an unreadable
   * value — but neither THROWS anymore either. A thrown exception here used
   * to cross `mapToCustomerDtos`'s `.map()` and land in
   * `CustomerService.importFromFile`'s file-level catch (line ~244),
   * turning a single bad date cell into a whole-file `BadRequestException`
   * with no row number — measured, T-121 review (a): a file with 500 good
   * rows and ONE unparseable date returned 500 as a file error, not 499
   * created + 1 row-level error. Both branches now append to `errors` and
   * return `undefined` for that field instead, so the caller decides what
   * an unreadable value MEANS (row-fails-validation, via the same channel
   * `MISSING_FIELD` / `INVALID_AMOUNT` / `INVALID_EMAIL` already use) rather
   * than losing the row entirely.
   */
  private getOptionalDate(
    value: any,
    field: string,
    errors: FieldParseError[],
  ): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;

    // Excel tarih formatını kontrol et (serial number)
    // T-107 adım 1: paylaşılan, TZ-bağımsız yardımcı. Alan opsiyonel olsa da
    // MEVCUT bir değerin okunamaması ile alanın hiç verilmemiş olması aynı şey
    // değildir (§2.5) — bu yüzden burada da sessizce `undefined` dönülmez.
    if (typeof value === 'number') {
      const result = excelSerialToIsoDate(value);
      if (!result.ok) {
        errors.push({
          field,
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure(result),
        });
        return undefined;
      }
      return result.isoDate;
    }

    // String tarih formatı: katı gramer (T-121) — ISO ya da GG.AA.YYYY,
    // ikisi dışında her şey (US sırası, belirsiz gün/ay, serbest metin)
    // reddedilir; hiçbir zaman `new Date(str)` ile tahmin edilmez.
    const result = parseOptionalDateText(value);
    if (result === undefined) return undefined;
    if (!result.ok) {
      errors.push({
        field,
        error_type: 'INVALID_DATE',
        error_message: describeDateTextFailure(result),
      });
      return undefined;
    }
    return result.isoDate;
  }

  private getChannel(value: any): CustomerChannel {
    if (!value) return CustomerChannel.RETAIL;
    const channel = String(value).toUpperCase().trim();
    const validChannels = Object.values(CustomerChannel);
    return validChannels.includes(channel as CustomerChannel)
      ? (channel as CustomerChannel)
      : CustomerChannel.RETAIL;
  }

  private getType(value: any): CustomerType | undefined {
    if (!value) return undefined;
    const type = String(value).toUpperCase().trim();
    const validTypes = Object.values(CustomerType);
    return validTypes.includes(type as CustomerType)
      ? (type as CustomerType)
      : undefined;
  }

  private getStatus(value: any): CustomerStatus | undefined {
    if (!value) return undefined;
    const status = String(value).toUpperCase().trim();
    const validStatuses = Object.values(CustomerStatus);
    return validStatuses.includes(status as CustomerStatus)
      ? (status as CustomerStatus)
      : undefined;
  }
}
