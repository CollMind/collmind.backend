import { Injectable, BadRequestException } from '@nestjs/common';
import {
  parseNumericText,
  describeNumericTextFailure,
} from '../../../../../common/numeric/numeric-text';
import {
  excelSerialToIsoDate,
  describeExcelSerialDateFailure,
} from '../../../../../common/date/excel-serial-date';
import {
  parseDateText,
  describeDateTextFailure,
} from '../../../../../common/date/date-text';
import {
  pickCell,
  hasCellValue,
  isBlankCellValue,
} from '../../../../../common/row-parsing/pick-cell';
import { normalizeBlankCells } from '../../../../../common/row-parsing/normalize-blank-cells';
import { FieldParseError } from '../../../../../common/row-parsing/field-parse-error';
import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { CreateOnInvoiceEntryDto } from '../dto/create-on-invoice-entry.dto';
import { OnInvoiceDiscountType } from '../../../../../database/entities/on-invoice-entry.entity';

/**
 * T-126: `invoiceDate`/`quantity`/`listPrice`/`actualPrice`/`discount`/
 * `discountType` are required on `CreateOnInvoiceEntryDto` (the API-facing
 * shape), but AT PARSE TIME a cell may be present-and-unreadable — a state
 * that must not be invented as some other value (§2.5). `fiscalPeriod`
 * deliberately stays `string` (not loosened) — see the doc on
 * `getFiscalPeriod` below for why that one field keeps throwing instead of
 * joining this row-level channel.
 */
export type ParsedOnInvoiceEntryDto = Omit<
  CreateOnInvoiceEntryDto,
  | 'invoiceDate'
  | 'quantity'
  | 'listPrice'
  | 'actualPrice'
  | 'discount'
  | 'discountType'
> & {
  invoiceDate: string | undefined;
  quantity: number | undefined;
  listPrice: number | undefined;
  actualPrice: number | undefined;
  discount: number | undefined;
  discountType: OnInvoiceDiscountType | undefined;
};

export interface ParsedOnInvoiceRow {
  dto: ParsedOnInvoiceEntryDto;
  originalRowNumber: number;
  originalRowData?: Record<string, any>;
  /** Non-empty iff at least one required field on this row failed to PARSE
   *  (present, but unreadable — §2.5). Folded into
   *  `OnInvoiceValidationService.validateRow`'s row-level `ValidationError`
   *  channel by that service, not thrown here (T-126) — a single bad cell
   *  must fail its OWN row, not the whole upload. */
  parseErrors?: FieldParseError[];
}

@Injectable()
export class OnInvoiceFileParserService {
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MAX_ROWS = 5000; // Max 5000 rows per batch

  async parseExcel(file: Express.Multer.File): Promise<ParsedOnInvoiceRow[]> {
    try {
      // Dosya boyutu kontrolü
      if (file.buffer.length > this.MAX_FILE_SIZE) {
        throw new BadRequestException(
          'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.',
        );
      }

      const workbook = XLSX.read(file.buffer, {
        type: 'buffer',
        cellDates: false,
        cellNF: false,
        cellStyles: false,
        sheetRows: this.MAX_ROWS + 1, // Header + max rows
      });

      if (workbook.SheetNames.length === 0) {
        throw new BadRequestException('Excel dosyası boş veya geçersiz.');
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      if (!worksheet || !worksheet['!ref']) {
        throw new BadRequestException('Excel dosyası geçersiz veya boş.');
      }

      const data = XLSX.utils.sheet_to_json(worksheet, {
        raw: true, // T-107 adım 2: hücreyi kaynağında oku (sayı/tarih hücreleri
        // metne çevrilmeden gelir) — `getNumberValue`/`getDateValue` sayısal
        // girdiyi zaten kabul ediyor (T-105/adım 1).
        //
        // T-107 adım 2: `defval: null`, not `false` — under `raw: true` a
        // written cell is only ever `string | number | boolean`
        // (`cellDates: false` above), so `null` can never collide with a
        // value a user typed, unlike `false` (see `pick-cell.ts` for the
        // measured regression this caused: a real `0` quantity/discount,
        // read under a non-last alias spelling, silently resolved to
        // `undefined`).
        defval: null,
        blankrows: false,
      });

      if (data.length === 0) {
        throw new BadRequestException('Excel dosyası boş.');
      }

      if (data.length > this.MAX_ROWS) {
        throw new BadRequestException(
          `Excel dosyası çok fazla satır içeriyor. Maksimum ${this.MAX_ROWS} satır işlenebilir.`,
        );
      }

      return this.mapToEntryDtos(data);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`Excel dosyası okunamadı: ${errorMessage}`);
    }
  }

  async parseCSV(file: Express.Multer.File): Promise<ParsedOnInvoiceRow[]> {
    try {
      if (file.buffer.length > this.MAX_FILE_SIZE) {
        throw new BadRequestException(
          'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.',
        );
      }

      let rowCount = 0;

      return new Promise((resolve, reject) => {
        const results: Record<string, string>[] = [];
        const stream = Readable.from(file.buffer.toString('utf-8'));

        stream
          .pipe(csvParser())
          .on('data', (data: Record<string, string>) => {
            rowCount++;
            if (rowCount > this.MAX_ROWS) {
              stream.destroy();
              reject(
                new BadRequestException(
                  `CSV dosyası çok fazla satır içeriyor. Maksimum ${this.MAX_ROWS} satır işlenebilir.`,
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
              const entryDtos = this.mapToEntryDtos(results);
              resolve(entryDtos);
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

  private mapToEntryDtos(data: any[]): ParsedOnInvoiceRow[] {
    return data
      .map((row, index) => ({
        // T-107 adım 2 review (S2): normalize XLSX's `null` blank-cell
        // sentinel to `undefined` before this row is stored as
        // `originalRowData` below — shared with the other two importers
        // (`common/row-parsing/normalize-blank-cells.ts`).
        ...normalizeBlankCells(row),
        _originalRowNumber: index + 2, // +2: header row (1) + 0-based index (1) = 2
      }))
      .filter((row) => {
        // Boş satırları filtrele - en azından customer_code veya invoice_no
        // olmalı. T-107 adım 2 review (B1): presence is `hasCellValue`, NOT
        // `pickCell(...) !== undefined` — under the CSV branch, a blank
        // cell is `csv-parser`'s `''`, not XLSX's `null`/`undefined`
        // sentinel, so `!== undefined` counted it as present and a `,,,`
        // row survived into a throwing getter below, taking the WHOLE FILE
        // down (see `pick-cell.ts`'s `hasCellValue` doc for the measured
        // repro).
        return (
          hasCellValue(
            row,
            'customer_code',
            'customerCode',
            'CUSTOMER_CODE',
            'CustomerCode',
          ) ||
          hasCellValue(
            row,
            'invoice_no',
            'invoiceNo',
            'INVOICE_NO',
            'InvoiceNo',
          )
        );
      })
      .map((row) => {
        // T-126: field-level parse failures (an unreadable date, number or
        // enum cell) are collected here, in field-declaration order, rather
        // than thrown — a thrown exception from any of the getters below
        // would abort the WHOLE FILE at the first bad cell (measured, T-123:
        // this importer had no row-level channel yet and every one of these
        // getters threw straight into `parseExcel`/`parseCSV`'s file-level
        // `catch`). `fiscalPeriod` is the deliberate exception — see
        // `getFiscalPeriod`'s own doc for why it still throws.
        const parseErrors: FieldParseError[] = [];

        const customerCode = this.getStringValue(
          pickCell(
            row,
            'customer_code',
            'customerCode',
            'CUSTOMER_CODE',
            'CustomerCode',
          ),
        );
        const invoiceNo = this.getStringValue(
          pickCell(row, 'invoice_no', 'invoiceNo', 'INVOICE_NO', 'InvoiceNo'),
        );
        const invoiceDate = this.getDateValue(
          pickCell(
            row,
            'invoice_date',
            'invoiceDate',
            'INVOICE_DATE',
            'InvoiceDate',
          ),
          'invoice_date',
          parseErrors,
        );
        const fiscalPeriod = this.getFiscalPeriod(
          pickCell(
            row,
            'fiscal_period',
            'fiscalPeriod',
            'FISCAL_PERIOD',
            'FiscalPeriod',
          ),
        );
        const skuCode = this.getStringValue(
          pickCell(row, 'sku_code', 'skuCode', 'SKU_CODE', 'SkuCode'),
        );
        const quantity = this.getNumberValue(
          pickCell(row, 'quantity', 'Quantity', 'QUANTITY'),
          'quantity',
          parseErrors,
        );
        const listPrice = this.getNumberValue(
          pickCell(row, 'list_price', 'listPrice', 'LIST_PRICE', 'ListPrice'),
          'list_price',
          parseErrors,
        );
        const actualPrice = this.getNumberValue(
          pickCell(
            row,
            'actual_price',
            'actualPrice',
            'ACTUAL_PRICE',
            'ActualPrice',
          ),
          'actual_price',
          parseErrors,
        );
        const discount = this.getNumberValue(
          pickCell(row, 'discount', 'Discount', 'DISCOUNT'),
          'discount',
          parseErrors,
        );
        const discountType = this.getDiscountType(
          pickCell(
            row,
            'discount_type',
            'discountType',
            'DISCOUNT_TYPE',
            'DiscountType',
          ),
          'discount_type',
          parseErrors,
        );

        const dto: ParsedOnInvoiceEntryDto = {
          customerCode: customerCode,
          invoiceNo: invoiceNo,
          invoiceDate: invoiceDate,
          fiscalPeriod: fiscalPeriod,
          skuCode: skuCode,
          quantity: quantity,
          listPrice: listPrice,
          actualPrice: actualPrice,
          discount: discount,
          discountType: discountType,
          currency:
            this.getOptionalString(
              pickCell(row, 'currency', 'Currency', 'CURRENCY'),
            ) || 'TRY',
        };

        return {
          dto,
          originalRowNumber: row._originalRowNumber,
          originalRowData: row,
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
   * T-105: one grammar, shared with every other importer
   * (`common/numeric/numeric-text.ts`).
   *
   * This carried its own separator logic and got both directions wrong: it read
   * `1.234,56` as 1.23456 (a thousand times too small) and `1234,56` as 123456 (a
   * hundred times too big, by deleting a comma it had decided was a thousands
   * separator). Its own comment claimed `Türkçe format: 1.234,56 -> 1234.56` —
   * precisely the case it computed wrongly — and the comment went with the code.
   *
   * `Number(canonical)` is safe where `Number(numStr)` was not: the grammar admits
   * `-?\d+(\.\d+)?` only, so `Infinity` and `1e5` are refused before reaching it
   * (T-099).
   *
   * T-126: no longer throws — EMPTY and present-but-unreadable both return
   * `undefined`, but only the latter appends to `errors`. EMPTY is a
   * legitimate absence; `OnInvoiceValidationService.validateRow`'s existing
   * per-field "zorunludur"/"pozitif olmalıdır" checks (they already treat
   * `undefined` as failing, same as `null`) catch it with the SAME message a
   * truly-empty cell always produced. Positivity/`<= 0` stays validateRow's
   * job, not this parser's — matches the parsing/meaning split
   * `numeric-text.ts` documents (T-105).
   */
  private getNumberValue(
    value: any,
    field: string,
    errors: FieldParseError[],
  ): number | undefined {
    const result = parseNumericText(value);
    if (!result.ok) {
      if (result.reason !== 'EMPTY') {
        errors.push({
          field,
          error_type: 'INVALID_AMOUNT',
          error_message: describeNumericTextFailure(result),
        });
      }
      return undefined;
    }
    return Number(result.canonical);
  }

  /**
   * T-123: string branch goes through `date-text.ts`'s katı gramer (ISO
   * `YYYY-MM-DD` veya Türk `GG.AA.YYYY`, ürün sahibi kararı 2026-08-09,
   * T-121) instead of `new Date(str)` — closes bulgu 3 (US-order guess,
   * `"3.4.2026"` -> 4 Mart yerine 3 Nisan) here too; bulgu 1 (TZ slip) was
   * never present at this call site (measured, T-123: local getters, not
   * `toISOString()`) but bulgu 3 was, unchanged, until this edit.
   *
   * T-126: satır-bazlı hata teslimi artık VAR — bu metod artık FIRLATMIYOR,
   * `errors`'a yazıyor (`OnInvoiceValidationService.validateRow`'un okuduğu
   * `parseErrors` kanalı; bu importer'ın kendisi bu turdan önce böyle bir
   * kanala sahip DEĞİLDİ — `getDiscountType`/`getFiscalPeriod` de aynı
   * şekilde atıyordu, ölçüldü). EMPTY sessizce `undefined` döner (meşru
   * yokluk, `validateRow`'un "Fatura tarihi zorunludur" kontrolü zaten
   * yakalıyor); present-but-unreadable `errors`'a spesifik mesajla yazılır.
   */
  private getDateValue(
    value: any,
    field: string,
    errors: FieldParseError[],
  ): string | undefined {
    // T-126 review (B1): `isBlankCellValue`, not the hand-written
    // `value === ''` this used to be — see `pick-cell.ts`'s
    // `isBlankCellValue` doc for the measured repro (a whitespace-only cell
    // fell through into `parseDateText`'s own `EMPTY` result below and
    // pushed an `INVALID_DATE` row error for what should have been a
    // silent, legitimate absence — the literal `''` cell right next to it
    // got zero errors for the identical intent).
    if (isBlankCellValue(value)) {
      return undefined;
    }

    // Excel serial date kontrolü (T-107 adım 1: paylaşılan, TZ-bağımsız yardımcı)
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

    // String tarih formatı: katı gramer (T-123/T-121) — ISO ya da
    // GG.AA.YYYY, ikisi dışında her şey (US sırası, belirsiz gün/ay, serbest
    // metin) reddedilir; hiçbir zaman `new Date(str)` ile tahmin edilmez.
    const result = parseDateText(value);
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

  /**
   * T-123: metin dalı artık `date-text.ts` üzerinden — bkz. `getDateValue`
   * dokümanı. `YYYY-MM-DD`'yi `YYYY-MM`'e kısaltma işi BİLEREK burada
   * (çağıran tarafta) yapılıyor, `date-text.ts` içinde değil: o modül
   * yalnızca bir takvim GÜNÜ kavramını kodluyor (bkz. modülün kendi
   * dokümanı), "dönem" (ay) ayrı bir gramer ve iki grameri aynı primitive'te
   * karıştırmak §7'nin "aynı yeteneği iki kez yazma" kuralının bir başka
   * yönü olurdu — bu yüzden dönüşüm burada, `excelSerialToIsoDate`'in
   * üstündeki `.slice(0, 7)` ile AYNI, hâlihazırda var olan desenle yapılır.
   *
   * T-126 KARARI (ölçüldü, satır-bazlı kanala TAŞINMADI — `getDateValue`/
   * `getNumberValue`/`getDiscountType`'ın aksine): bu metod hâlâ FIRLATIR.
   * Sebep, off-invoice'un tersine bu alanın burada gerçekten OPSİYONEL
   * OLMAMASI değil — `on-invoice.service.ts`'in `uploadAndValidateFile`/
   * `uploadFile`'ı `parsedRows[0]?.dto.fiscalPeriod`'u satır-bazlı validasyon
   * HİÇ ÇALIŞMADAN, batch'i YARATMAK için okuyor (`batch.fiscalPeriod`
   * NOT NULL kolonu ve `batchCode`'un kendisi buradan üretiliyor,
   * `on-invoice.service.ts:82-87`). Bu, off-invoice'daki 3 seviyeli düşüş
   * zincirinin (agreement.periodMonth / invoiceDate'ten türetilen dönem)
   * KARŞILIĞI YOK ("o serviste düşüş zinciri yok" — doğru asimetri, ama
   * gerekçesi bu). Bu metodu satır-bazlı yapmak 2..n. satırları korurdu, ama
   * satır 1'in fiscal_period'u bozuksa hem batch zaten yaratılamıyor (aynı
   * sonuç: dosya reddedilir) HEM DE mesaj daha az spesifik hale gelirdi
   * (`"Fiscal period belirtilmedi."` — "verilmedi" değil "okunamadı" olduğu
   * hâlde). Kazanç yok, kayıp var — bu yüzden değiştirilmedi. Batch'in tek
   * bir satırın fiscal period'una ÇAPALANMASI (hangi satırın "doğru" period
   * olduğuna dair bir uzlaşma/karşılaştırma kontrolü yok) ayrı, daha büyük
   * bir tasarım sorusu — bu task'ın kapsamı değil.
   */
  private getFiscalPeriod(value: any): string {
    // T-126 review (B1): `isBlankCellValue`, not the hand-written
    // `value === ''` this used to be — measured, a whitespace-only cell
    // (`"   "`) is not literally `''`, so the old check fell through all the
    // way to the throw at the bottom of this method and rejected the WHOLE
    // FILE with `"Geçersiz fiscal period formatı:    ."` (present-but-
    // unreadable) instead of the correct `"Fiscal period değeri zorunludur"`
    // (absent) — a worse outcome than the two optional getters above because
    // this variant throws past the row-level channel entirely.
    if (isBlankCellValue(value)) {
      throw new BadRequestException('Fiscal period değeri zorunludur');
    }

    const str = String(value).trim();

    // YYYY-MM formatını kontrol et
    const fiscalPeriodRegex = /^\d{4}-\d{2}$/;
    if (fiscalPeriodRegex.test(str)) {
      // Ay değerini kontrol et (01-12)
      const parts = str.split('-');
      const month = parseInt(parts[1], 10);
      if (month >= 1 && month <= 12) {
        return str;
      }
    }

    // Excel serial date ise çevir (T-107 adım 1: paylaşılan, TZ-bağımsız yardımcı)
    if (typeof value === 'number') {
      const result = excelSerialToIsoDate(value);
      if (!result.ok) {
        throw new BadRequestException(describeExcelSerialDateFailure(result));
      }
      return result.isoDate.slice(0, 7);
    }

    // Tam tarih metni ise katı gramer (T-123/T-121) ile çöz, sonra YYYY-MM'e
    // kısalt — `new Date(str)` yerine.
    const dateResult = parseDateText(str);
    if (dateResult.ok) {
      return dateResult.isoDate.slice(0, 7);
    }

    throw new BadRequestException(
      `Geçersiz fiscal period formatı: ${value}. Kabul edilen biçimler: ` +
        `YYYY-MM (ör. 2026-01) veya tam tarih (YYYY-MM-DD ya da GG.AA.YYYY).`,
    );
  }

  /**
   * T-126: no longer throws — `errors` gets the specific reason on an
   * unrecognized-but-present value, `undefined` is returned either way.
   *
   * ⚠️ T-126 review (S4): the claim that used to sit here — that EMPTY and
   * "not one of the known codes" collapse to the SAME row-level error family
   * — was checked and is wrong; §2.5 forbids collapsing them, and this
   * method does not. Measured: `''` returns `undefined` with ZERO errors
   * (a legitimate absence, same shape as `getDateValue`/`getNumberValue`'s
   * EMPTY case); `'XYZ'` returns `undefined` WITH an `INVALID_ENUM` error.
   * The two states stay distinguishable via `parseErrors`, same as every
   * other getter in this file.
   *
   * T-126 review (B1): absence is `isBlankCellValue`, NOT the hand-written
   * `value === ''` this used to be — a whitespace-only cell (`"   "`) used
   * to fall through into the mapping below, match none of the known codes,
   * and push an `INVALID_ENUM` error ("Geçersiz indirim tipi: '   '.") for
   * what should have been the same silent absence a literal `''` cell
   * already got.
   */
  private getDiscountType(
    value: any,
    field: string,
    errors: FieldParseError[],
  ): OnInvoiceDiscountType | undefined {
    if (isBlankCellValue(value)) {
      return undefined;
    }

    const str = String(value).trim().toUpperCase();

    // Mapping
    if (
      str === 'CPP_ON' ||
      str === 'CPP ON-INVOICE' ||
      str === 'CPP_ON_INVOICE'
    ) {
      return OnInvoiceDiscountType.CPP_ON;
    }
    if (
      str === 'LTA_ON' ||
      str === 'LTA ON-INVOICE' ||
      str === 'LTA_ON_INVOICE' ||
      str === 'LTA Fatura Altı İskonto'
    ) {
      return OnInvoiceDiscountType.LTA_ON;
    }
    if (
      str === 'PROMO_DISCOUNT' ||
      str === 'PROMO DISCOUNT' ||
      str === 'Anında Fiyat İndirimi'
    ) {
      return OnInvoiceDiscountType.PROMO_DISCOUNT;
    }

    errors.push({
      field,
      error_type: 'INVALID_ENUM',
      error_message: `Geçersiz indirim tipi: '${value}'. Geçerli değerler: CPP_ON, LTA_ON, PROMO_DISCOUNT`,
    });
    return undefined;
  }

  /**
   * Excel template oluştur
   */
  generateExcelTemplate(): Buffer {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        'CUSTOMER_CODE',
        'INVOICE_NO',
        'INVOICE_DATE',
        'FISCAL_PERIOD',
        'SKU_CODE',
        'QUANTITY',
        'LIST_PRICE',
        'ACTUAL_PRICE',
        'DISCOUNT',
        'DISCOUNT_TYPE',
      ],
      [
        'CUST-CF-001',
        'INV-50001',
        '2026-01-15',
        '2026-01',
        'WEL-HC-001',
        '100',
        '185.00',
        '162.80',
        '2220.00',
        'CPP_ON',
      ],
      [
        'CUST-CF-001',
        'INV-50001',
        '2026-01-15',
        '2026-01',
        'WEL-HC-002',
        '50',
        '245.00',
        '220.50',
        '1225.00',
        'CPP_ON',
      ],
      [
        'CUST-GS-002',
        'INV-50002',
        '2026-01-16',
        '2026-01',
        'WEL-HC-001',
        '200',
        '185.00',
        '166.50',
        '3700.00',
        'LTA_ON',
      ],
      [
        'CUST-GS-002',
        'INV-50002',
        '2026-01-16',
        '2026-01',
        'WEL-HC-003',
        '75',
        '320.00',
        '288.00',
        '2400.00',
        'LTA_ON',
      ],
      [
        'CUST-MK-003',
        'INV-50003',
        '2026-01-17',
        '2026-01',
        'WEL-HC-001',
        '150',
        '185.00',
        '175.75',
        '1387.50',
        'PROMO_DISCOUNT',
      ],
      [
        'CUST-MK-003',
        'INV-50003',
        '2026-01-17',
        '2026-01',
        'WEL-HC-002',
        '100',
        '245.00',
        '232.75',
        '1225.00',
        'PROMO_DISCOUNT',
      ],
      [
        'CUST-CF-001',
        'INV-50004',
        '2026-01-18',
        '2026-01',
        'WEL-HC-004',
        '80',
        '150.00',
        '135.00',
        '1200.00',
        'CPP_ON',
      ],
    ]);

    // Kolon genişliklerini ayarla
    worksheet['!cols'] = [
      { wch: 20 }, // CUSTOMER_CODE
      { wch: 15 }, // INVOICE_NO
      { wch: 15 }, // INVOICE_DATE
      { wch: 12 }, // FISCAL_PERIOD
      { wch: 15 }, // SKU_CODE
      { wch: 12 }, // QUANTITY
      { wch: 15 }, // LIST_PRICE
      { wch: 15 }, // ACTUAL_PRICE
      { wch: 15 }, // DISCOUNT
      { wch: 15 }, // DISCOUNT_TYPE
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'On-Invoice');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * CSV template oluştur
   */
  generateCSVTemplate(): string {
    return [
      'CUSTOMER_CODE,INVOICE_NO,INVOICE_DATE,FISCAL_PERIOD,SKU_CODE,QUANTITY,LIST_PRICE,ACTUAL_PRICE,DISCOUNT,DISCOUNT_TYPE',
      'CUST-CF-001,INV-50001,2026-01-15,2026-01,WEL-HC-001,100,185.00,162.80,2220.00,CPP_ON',
      'CUST-CF-001,INV-50001,2026-01-15,2026-01,WEL-HC-002,50,245.00,220.50,1225.00,CPP_ON',
      'CUST-GS-002,INV-50002,2026-01-16,2026-01,WEL-HC-001,200,185.00,166.50,3700.00,LTA_ON',
      'CUST-GS-002,INV-50002,2026-01-16,2026-01,WEL-HC-003,75,320.00,288.00,2400.00,LTA_ON',
      'CUST-MK-003,INV-50003,2026-01-17,2026-01,WEL-HC-001,150,185.00,175.75,1387.50,PROMO_DISCOUNT',
      'CUST-MK-003,INV-50003,2026-01-17,2026-01,WEL-HC-002,100,245.00,232.75,1225.00,PROMO_DISCOUNT',
      'CUST-CF-001,INV-50004,2026-01-18,2026-01,WEL-HC-004,80,150.00,135.00,1200.00,CPP_ON',
    ].join('\n');
  }
}
