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

      // Security: Use defval: false to prevent prototype pollution
      const data = XLSX.utils.sheet_to_json(worksheet, {
        raw: false,
        defval: false, // Prevent prototype pollution attacks
        blankrows: false, // Skip blank rows for performance
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
   * T-121 review B1: `parseExcel` calls `sheet_to_json` with `defval: false`
   * (prototype-pollution guard, see the comment there — untouched by this
   * fix). That option fills a cell that was never written at all — the
   * common shape for a blank cell in a real, human-edited spreadsheet — with
   * the literal boolean `false`, not with an absent key. `raw: false` in the
   * same call formats every FILLED cell (including real "TRUE"/"FALSE" text)
   * to a string, and `csv-parser` (the CSV branch) never produces a
   * `boolean` either — measured, see the probe referenced in the T-121
   * review. So a `boolean` in `row` can only ever be this one sentinel, from
   * this one source, never a value a user actually typed.
   *
   * Left unstripped, that `false` sat inside every `row.a || row.b || row.c`
   * alias chain below and behaved like a real value once every earlier alias
   * was truly absent: `[false, undefined, undefined, undefined]` returns
   * `false` — not the row's actual absence — because `||` returns its LAST
   * operand when every operand is falsy. Three different families then broke
   * on that same `false`, each in its own way: `getOptionalDate` (T-121's
   * new strict grammar has no format for the string `"false"`) started
   * THROWING and rejecting the whole upload; `getOptionalNumber` threw for
   * the same reason; `getOptionalString` had no rejection path at all and
   * silently PERSISTED the string `"false"` into a text column.
   *
   * Stripping the sentinel here, once, before any alias chain reads the row,
   * restores "blank cell" to actually meaning absent — for every alias
   * spelling, every field family, in one place — without touching the
   * `defval: false` choice itself or any per-field getter.
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
  private stripBlankCellSentinel(row: Record<string, any>): any {
    const normalized: Record<string, any> = {};
    for (const key of Object.keys(row)) {
      normalized[key] = row[key] === false ? undefined : row[key];
    }
    return normalized;
  }

  private mapToCustomerDtos(data: any[]): ParsedCustomerRow[] {
    // Önce her satıra orijinal satır numarasını ekle (header + 1-based index)
    const dataWithRowNumbers = data.map((row, index) => ({
      ...this.stripBlankCellSentinel(row),
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
            row.code ||
              row.Code ||
              row.CODE ||
              `AUTO_${row._originalRowNumber}`,
          ),
          name: this.getStringValue(row.name || row.Name || row.NAME || ''),
          channel: this.getChannel(
            row.channel || row.Channel || row.CHANNEL || 'RETAIL',
          ),
          type: this.getType(row.type || row.Type || row.TYPE),
          status: this.getStatus(row.status || row.Status || row.STATUS),
          city: this.getOptionalString(row.city || row.City || row.CITY),
          district: this.getOptionalString(
            row.district || row.District || row.DISTRICT,
          ),
          region: this.getOptionalString(
            row.region || row.Region || row.REGION,
          ),
          country: this.getOptionalString(
            row.country || row.Country || row.COUNTRY,
          ),
          address: this.getOptionalString(
            row.address || row.Address || row.ADDRESS,
          ),
          postalCode: this.getOptionalString(
            row.postalCode ||
              row.postal_code ||
              row.PostalCode ||
              row.POSTAL_CODE,
          ),
          taxNumber: this.getOptionalString(
            row.taxNumber || row.tax_number || row.TaxNumber || row.TAX_NUMBER,
          ),
          taxOffice: this.getOptionalString(
            row.taxOffice || row.tax_office || row.TaxOffice || row.TAX_OFFICE,
          ),
          companyRegistrationNumber: this.getOptionalString(
            row.companyRegistrationNumber ||
              row.company_registration_number ||
              row.CompanyRegistrationNumber ||
              row.COMPANY_REGISTRATION_NUMBER,
          ),
          contactPerson: this.getOptionalString(
            row.contactPerson ||
              row.contact_person ||
              row.ContactPerson ||
              row.CONTACT_PERSON,
          ),
          contactEmail: this.getOptionalString(
            row.contactEmail ||
              row.contact_email ||
              row.ContactEmail ||
              row.CONTACT_EMAIL,
          ),
          contactPhone: this.getOptionalString(
            row.contactPhone ||
              row.contact_phone ||
              row.ContactPhone ||
              row.CONTACT_PHONE,
          ),
          contactMobile: this.getOptionalString(
            row.contactMobile ||
              row.contact_mobile ||
              row.ContactMobile ||
              row.CONTACT_MOBILE,
          ),
          paymentTerms: this.getOptionalString(
            row.paymentTerms ||
              row.payment_terms ||
              row.PaymentTerms ||
              row.PAYMENT_TERMS,
          ),
          creditLimit: this.getOptionalNumber(
            row.creditLimit ||
              row.credit_limit ||
              row.CreditLimit ||
              row.CREDIT_LIMIT,
            'creditLimit',
            parseErrors,
          ),
          currency:
            this.getOptionalString(
              row.currency || row.Currency || row.CURRENCY,
            ) || 'TRY',
          salesRepresentative: this.getOptionalString(
            row.salesRepresentative ||
              row.sales_representative ||
              row.SalesRepresentative ||
              row.SALES_REPRESENTATIVE,
          ),
          accountManager: this.getOptionalString(
            row.accountManager ||
              row.account_manager ||
              row.AccountManager ||
              row.ACCOUNT_MANAGER,
          ),
          customerGroup: this.getOptionalString(
            row.customerGroup ||
              row.customer_group ||
              row.CustomerGroup ||
              row.CUSTOMER_GROUP,
          ),
          customerSegment: this.getOptionalString(
            row.customerSegment ||
              row.customer_segment ||
              row.CustomerSegment ||
              row.CUSTOMER_SEGMENT,
          ),
          customerTier: this.getOptionalString(
            row.customerTier ||
              row.customer_tier ||
              row.CustomerTier ||
              row.CUSTOMER_TIER,
          ),
          businessSize: this.getOptionalString(
            row.businessSize ||
              row.business_size ||
              row.BusinessSize ||
              row.BUSINESS_SIZE,
          ),
          annualRevenue: this.getOptionalNumber(
            row.annualRevenue ||
              row.annual_revenue ||
              row.AnnualRevenue ||
              row.ANNUAL_REVENUE,
            'annualRevenue',
            parseErrors,
          ),
          lastOrderDate: this.getOptionalDate(
            row.lastOrderDate ||
              row.last_order_date ||
              row.LastOrderDate ||
              row.LAST_ORDER_DATE,
            'lastOrderDate',
            parseErrors,
          ),
          firstOrderDate: this.getOptionalDate(
            row.firstOrderDate ||
              row.first_order_date ||
              row.FirstOrderDate ||
              row.FIRST_ORDER_DATE,
            'firstOrderDate',
            parseErrors,
          ),
          numberOfBranches: this.getOptionalNumber(
            row.numberOfBranches ||
              row.number_of_branches ||
              row.NumberOfBranches ||
              row.NUMBER_OF_BRANCHES,
            'numberOfBranches',
            parseErrors,
          ),
          notes: this.getOptionalString(row.notes || row.Notes || row.NOTES),
          isVip: this.getOptionalBoolean(
            row.isVip || row.is_vip || row.IsVip || row.IS_VIP,
          ),
          contractStartDate: this.getOptionalDate(
            row.contractStartDate ||
              row.contract_start_date ||
              row.ContractStartDate ||
              row.CONTRACT_START_DATE,
            'contractStartDate',
            parseErrors,
          ),
          contractEndDate: this.getOptionalDate(
            row.contractEndDate ||
              row.contract_end_date ||
              row.ContractEndDate ||
              row.CONTRACT_END_DATE,
            'contractEndDate',
            parseErrors,
          ),
        };

        // Metadata objesi oluştur
        if (
          row.storeSize ||
          row.store_size ||
          row.StoreSize ||
          row.STORE_SIZE ||
          row.numberOfEmployees ||
          row.number_of_employees ||
          row.NumberOfEmployees ||
          row.NUMBER_OF_EMPLOYEES ||
          row.industry ||
          row.Industry ||
          row.INDUSTRY
        ) {
          dto.metadata = {
            storeSize: this.getOptionalNumber(
              row.storeSize ||
                row.store_size ||
                row.StoreSize ||
                row.STORE_SIZE,
              'metadata.storeSize',
              parseErrors,
            ),
            numberOfEmployees: this.getOptionalNumber(
              row.numberOfEmployees ||
                row.number_of_employees ||
                row.NumberOfEmployees ||
                row.NUMBER_OF_EMPLOYEES,
              'metadata.numberOfEmployees',
              parseErrors,
            ),
            industry: this.getOptionalString(
              row.industry || row.Industry || row.INDUSTRY,
            ),
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
