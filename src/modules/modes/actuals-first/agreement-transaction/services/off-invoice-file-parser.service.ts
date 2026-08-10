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
  pickCell,
  hasCellValue,
} from '../../../../../common/row-parsing/pick-cell';
import { normalizeBlankCells } from '../../../../../common/row-parsing/normalize-blank-cells';
import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { CreateAgreementTransactionDto } from '../dto/create-agreement-transaction.dto';

export interface ParsedOffInvoiceRow {
  dto: CreateAgreementTransactionDto;
  originalRowNumber: number;
  originalRowData?: Record<string, any>;
  fiscalPeriod?: string; // YYYY-MM formatında
  description?: string;
}

@Injectable()
export class OffInvoiceFileParserService {
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MAX_ROWS = 500; // Max 500 rows per batch

  async parseExcel(file: Express.Multer.File): Promise<ParsedOffInvoiceRow[]> {
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
        // measured regression this caused: a real `0` amount, read under a
        // non-last alias spelling, silently resolved to `undefined`).
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

      return this.mapToTransactionDtos(data);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`Excel dosyası okunamadı: ${errorMessage}`);
    }
  }

  async parseCSV(file: Express.Multer.File): Promise<ParsedOffInvoiceRow[]> {
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
              const transactionDtos = this.mapToTransactionDtos(results);
              resolve(transactionDtos);
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

  private mapToTransactionDtos(data: any[]): ParsedOffInvoiceRow[] {
    return data
      .map((row, index) => ({
        // T-107 adım 2 review (S2): normalize XLSX's `null` blank-cell
        // sentinel to `undefined` before this row is stored as
        // `originalRowData` below — shared with the other two importers
        // (`common/row-parsing/normalize-blank-cells.ts`), so a caller
        // reading the per-row error payload does not see a literal `null`
        // for a cell that was simply never written.
        ...normalizeBlankCells(row),
        _originalRowNumber: index + 2, // +2: header row (1) + 0-based index (1) = 2
      }))
      .filter((row) => {
        // Boş satırları filtrele - en azından agreement_id veya invoice_no
        // olmalı. T-107 adım 2 review (B1): presence is `hasCellValue`, NOT
        // `pickCell(...) !== undefined` — under the CSV branch, a blank
        // cell is `csv-parser`'s `''`, not XLSX's `null`/`undefined`
        // sentinel, so `!== undefined` counted it as present and a `,,,`
        // row survived into a throwing getter below, taking the WHOLE FILE
        // down (see `pick-cell.ts`'s `hasCellValue` doc for the measured
        // repro). `hasCellValue` treats blank-after-trim as absent for
        // BOTH formats while still counting a real `0`/`false` as present.
        return (
          hasCellValue(
            row,
            'agreement_id',
            'agreementId',
            'Agreement_ID',
            'AgreementId',
          ) ||
          hasCellValue(
            row,
            'invoice_no',
            'invoiceNo',
            'Invoice_No',
            'InvoiceNo',
          )
        );
      })
      .map((row) => {
        const dto: CreateAgreementTransactionDto = {
          agreementId: this.getStringValue(
            pickCell(
              row,
              'agreement_id',
              'agreementId',
              'Agreement_ID',
              'AgreementId',
            ),
          ),
          invoiceNo: this.getStringValue(
            pickCell(row, 'invoice_no', 'invoiceNo', 'Invoice_No', 'InvoiceNo'),
          ),
          invoiceDate: this.getDateValue(
            pickCell(
              row,
              'invoice_date',
              'invoiceDate',
              'Invoice_Date',
              'InvoiceDate',
            ),
          ),
          amount: this.getNumberValue(
            pickCell(row, 'amount', 'Amount', 'AMOUNT'),
          ),
          currency:
            this.getOptionalString(
              pickCell(row, 'currency', 'Currency', 'CURRENCY'),
            ) || 'TRY',
          notes: this.getOptionalString(
            pickCell(
              row,
              'description',
              'Description',
              'DESCRIPTION',
              'notes',
              'Notes',
              'NOTES',
            ),
          ),
        };

        // Fiscal period (YYYY-MM formatında)
        const fiscalPeriod = this.getFiscalPeriod(
          pickCell(
            row,
            'fiscal_period',
            'fiscalPeriod',
            'Fiscal_Period',
            'FiscalPeriod',
          ),
        );

        return {
          dto,
          originalRowNumber: row._originalRowNumber,
          originalRowData: row,
          fiscalPeriod,
          description: dto.notes,
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
   * ⚠️ THIS CHANGES HOW AN EXISTING FILE IS READ, and the change is from wrong to
   * right. The old line deleted every comma before converting, so it treated `,`
   * as a thousands separator: `1234,56` became 123456 — a hundred times too big,
   * silently. The template this importer publishes says `7250.00`, so a decimal
   * comma was never supported; it was accepted and corrupted rather than refused.
   *
   * `1.234.567,89` used to throw here (the dots survived and `Number` gave NaN);
   * it now reads correctly.
   *
   * `Number(canonical)` is safe: the grammar admits `-?\d+(\.\d+)?` only, so
   * `Infinity` is refused before reaching it (T-099).
   */
  private getNumberValue(value: any): number {
    const result = parseNumericText(value);
    if (!result.ok) {
      throw new BadRequestException(
        result.reason === 'EMPTY'
          ? 'Amount değeri zorunludur'
          : describeNumericTextFailure(result),
      );
    }
    const num = Number(result.canonical);
    if (num <= 0) {
      throw new BadRequestException(
        `Amount değeri pozitif olmalıdır: ${value}`,
      );
    }
    return num;
  }

  private getDateValue(value: any): string {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException('Invoice date değeri zorunludur');
    }

    // Excel serial date kontrolü (T-107 adım 1: paylaşılan, TZ-bağımsız yardımcı)
    if (typeof value === 'number') {
      const result = excelSerialToIsoDate(value);
      if (!result.ok) {
        throw new BadRequestException(describeExcelSerialDateFailure(result));
      }
      return result.isoDate;
    }

    // String tarih formatlarını dene
    const str = String(value).trim();
    const date = new Date(str);

    if (isNaN(date.getTime())) {
      throw new BadRequestException(
        `Geçersiz tarih formatı: ${value}. YYYY-MM-DD formatında olmalıdır.`,
      );
    }

    // YYYY-MM-DD formatına çevir
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getFiscalPeriod(value: any): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;

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

    // Date objesi ise çevir
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    }

    return undefined;
  }

  /**
   * Excel template oluştur
   */
  generateExcelTemplate(): Buffer {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        'agreement_id',
        'invoice_no',
        'invoice_date',
        'fiscal_period',
        'amount',
        'description',
      ],
      [
        'LTA-2026-GS-001',
        'FF-Q1-001',
        '2026-01-15',
        '2026-01',
        '7250.00',
        'Q1 Settlement - Price Difference Invoice',
      ],
      [
        'LTA-2026-GS-001',
        'FF-Q1-002',
        '2026-01-20',
        '2026-01',
        '3500.00',
        'Display Fee - January',
      ],
      [
        'LTA-2026-MK-002',
        'FF-Q1-003',
        '2026-01-25',
        '2026-01',
        '12000.00',
        'Turnover Bonus - Q1',
      ],
      [
        'STA-2026-CF-003',
        'FTR-2026-001',
        '2026-01-10',
        '2026-01',
        '8500.00',
        'Rebate Settlement',
      ],
      [
        'LTA-2026-GS-001',
        'FF-Q1-004',
        '2026-01-30',
        '2026-01',
        '5500.00',
        'Listing Fee - January',
      ],
      [
        'STA-2026-MK-004',
        'FTR-2026-002',
        '2026-01-12',
        '2026-01',
        '6200.00',
        'Co-op Advertising Fee',
      ],
    ]);

    // Kolon genişliklerini ayarla
    worksheet['!cols'] = [
      { wch: 20 }, // agreement_id
      { wch: 15 }, // invoice_no
      { wch: 15 }, // invoice_date
      { wch: 12 }, // fiscal_period
      { wch: 15 }, // amount
      { wch: 30 }, // description
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Off-Invoice');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * CSV template oluştur
   */
  generateCSVTemplate(): string {
    return [
      'agreement_id,invoice_no,invoice_date,fiscal_period,amount,description',
      'LTA-2026-GS-001,FF-Q1-001,2026-01-15,2026-01,7250.00,Q1 Settlement - Price Difference Invoice',
      'LTA-2026-GS-001,FF-Q1-002,2026-01-20,2026-01,3500.00,Display Fee - January',
      'LTA-2026-MK-002,FF-Q1-003,2026-01-25,2026-01,12000.00,Turnover Bonus - Q1',
      'STA-2026-CF-003,FTR-2026-001,2026-01-10,2026-01,8500.00,Rebate Settlement',
      'LTA-2026-GS-001,FF-Q1-004,2026-01-30,2026-01,5500.00,Listing Fee - January',
      'STA-2026-MK-004,FTR-2026-002,2026-01-12,2026-01,6200.00,Co-op Advertising Fee',
    ].join('\n');
  }
}
