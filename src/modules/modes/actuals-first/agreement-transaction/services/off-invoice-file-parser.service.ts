import { Injectable, BadRequestException } from '@nestjs/common';
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
        raw: false,
        defval: false,
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
        ...row,
        _originalRowNumber: index + 2, // +2: header row (1) + 0-based index (1) = 2
      }))
      .filter((row) => {
        // Boş satırları filtrele - en azından agreement_id veya invoice_no olmalı
        return (
          row.agreement_id ||
          row.agreementId ||
          row.Agreement_ID ||
          row.AgreementId ||
          row.invoice_no ||
          row.invoiceNo ||
          row.Invoice_No ||
          row.InvoiceNo
        );
      })
      .map((row) => {
        const dto: CreateAgreementTransactionDto = {
          agreementId: this.getStringValue(
            row.agreement_id ||
              row.agreementId ||
              row.Agreement_ID ||
              row.AgreementId,
          ),
          invoiceNo: this.getStringValue(
            row.invoice_no || row.invoiceNo || row.Invoice_No || row.InvoiceNo,
          ),
          invoiceDate: this.getDateValue(
            row.invoice_date ||
              row.invoiceDate ||
              row.Invoice_Date ||
              row.InvoiceDate,
          ),
          amount: this.getNumberValue(row.amount || row.Amount || row.AMOUNT),
          currency:
            this.getOptionalString(
              row.currency || row.Currency || row.CURRENCY,
            ) || 'TRY',
          notes: this.getOptionalString(
            row.description ||
              row.Description ||
              row.DESCRIPTION ||
              row.notes ||
              row.Notes ||
              row.NOTES,
          ),
        };

        // Fiscal period (YYYY-MM formatında)
        const fiscalPeriod = this.getFiscalPeriod(
          row.fiscal_period ||
            row.fiscalPeriod ||
            row.Fiscal_Period ||
            row.FiscalPeriod,
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

  private getNumberValue(value: any): number {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException('Amount değeri zorunludur');
    }
    const num = Number(String(value).replace(/,/g, '')); // Virgülleri kaldır
    if (isNaN(num)) {
      throw new BadRequestException(`Geçersiz amount değeri: ${value}`);
    }
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

    // Excel serial date kontrolü
    if (typeof value === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + value * 86400000);
      return jsDate.toISOString().split('T')[0];
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

    // Excel serial date ise çevir
    if (typeof value === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const jsDate = new Date(excelEpoch.getTime() + value * 86400000);
      const year = jsDate.getFullYear();
      const month = String(jsDate.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
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
