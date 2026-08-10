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
} from '../../../../../common/row-parsing/pick-cell';
import { normalizeBlankCells } from '../../../../../common/row-parsing/normalize-blank-cells';
import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { CreateOnInvoiceEntryDto } from '../dto/create-on-invoice-entry.dto';
import { OnInvoiceDiscountType } from '../../../../../database/entities/on-invoice-entry.entity';

export interface ParsedOnInvoiceRow {
  dto: CreateOnInvoiceEntryDto;
  originalRowNumber: number;
  originalRowData?: Record<string, any>;
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
        );
        const listPrice = this.getNumberValue(
          pickCell(row, 'list_price', 'listPrice', 'LIST_PRICE', 'ListPrice'),
        );
        const actualPrice = this.getNumberValue(
          pickCell(
            row,
            'actual_price',
            'actualPrice',
            'ACTUAL_PRICE',
            'ActualPrice',
          ),
        );
        const discount = this.getNumberValue(
          pickCell(row, 'discount', 'Discount', 'DISCOUNT'),
        );
        const discountType = this.getDiscountType(
          pickCell(
            row,
            'discount_type',
            'discountType',
            'DISCOUNT_TYPE',
            'DiscountType',
          ),
        );

        const dto: CreateOnInvoiceEntryDto = {
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
   */
  private getNumberValue(value: any): number {
    const result = parseNumericText(value);
    if (!result.ok) {
      throw new BadRequestException(
        result.reason === 'EMPTY'
          ? 'Number değeri zorunludur'
          : describeNumericTextFailure(result),
      );
    }
    return Number(result.canonical);
  }

  /**
   * T-123: string branch now goes through `date-text.ts`'s katı gramer (ISO
   * `YYYY-MM-DD` veya Türk `GG.AA.YYYY`, ürün sahibi kararı 2026-08-09,
   * T-121) instead of `new Date(str)` — closes bulgu 3 (US-order guess,
   * `"3.4.2026"` -> 4 Mart yerine 3 Nisan) here too; bulgu 1 (TZ slip) was
   * never present at this call site (measured, T-123: local getters, not
   * `toISOString()`) but bulgu 3 was, unchanged, until this edit.
   *
   * Satır-bazlı hata teslimi (T-123 madde 4): bu metod hâlâ FIRLATIR, tıpkı
   * `getNumberValue`/`getDiscountType`/`getFiscalPeriod` gibi — bilinçli, bu
   * dosyanın var olan tasarımı: `mapToEntryDtos`'un hiçbir alanı için satır
   * bazlı bir hata biriktirme kanalı yok (`customer/file-parser.service.ts`
   * `FieldParseError`/`parseErrors`'ın burada karşılığı yok, ölçüldü). Bir
   * satırdaki tek bozuk tarih hücresi bu throw ile `parseExcel`/`parseCSV`'nin
   * dış `catch`'ine çıkar ve TÜM dosyayı reddeder — bu, T-123'ün kapsamı
   * DEĞİL (yeni bir satır-kanalı mimarisi kurmak ayrı bir task gerektirir);
   * burada yalnız var olan dosya-bazlı ret deseni belgeleniyor.
   */
  private getDateValue(value: any): string {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException('Date değeri zorunludur');
    }

    // Excel serial date kontrolü (T-107 adım 1: paylaşılan, TZ-bağımsız yardımcı)
    if (typeof value === 'number') {
      const result = excelSerialToIsoDate(value);
      if (!result.ok) {
        throw new BadRequestException(describeExcelSerialDateFailure(result));
      }
      return result.isoDate;
    }

    // String tarih formatı: katı gramer (T-123/T-121) — ISO ya da
    // GG.AA.YYYY, ikisi dışında her şey (US sırası, belirsiz gün/ay, serbest
    // metin) reddedilir; hiçbir zaman `new Date(str)` ile tahmin edilmez.
    const result = parseDateText(value);
    if (!result.ok) {
      throw new BadRequestException(describeDateTextFailure(result));
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
   */
  private getFiscalPeriod(value: any): string {
    if (value === null || value === undefined || value === '') {
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

  private getDiscountType(value: any): OnInvoiceDiscountType {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException('Discount type değeri zorunludur');
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

    throw new BadRequestException(
      `Geçersiz discount type: ${value}. Geçerli değerler: CPP_ON, LTA_ON, PROMO_DISCOUNT`,
    );
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
