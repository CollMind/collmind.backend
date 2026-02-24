import { Injectable, BadRequestException } from '@nestjs/common';
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
        throw new BadRequestException('Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.');
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
        throw new BadRequestException(`Excel dosyası çok fazla satır içeriyor. Maksimum ${this.MAX_ROWS} satır işlenebilir.`);
      }

      return this.mapToEntryDtos(data);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`Excel dosyası okunamadı: ${errorMessage}`);
    }
  }

  async parseCSV(file: Express.Multer.File): Promise<ParsedOnInvoiceRow[]> {
    try {
      if (file.buffer.length > this.MAX_FILE_SIZE) {
        throw new BadRequestException('Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.');
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
              reject(new BadRequestException(`CSV dosyası çok fazla satır içeriyor. Maksimum ${this.MAX_ROWS} satır işlenebilir.`));
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
              const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
              reject(new BadRequestException(`CSV dosyası işlenemedi: ${errorMessage}`));
            }
          })
          .on('error', (error: Error) => {
            const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
            reject(new BadRequestException(`CSV dosyası okunamadı: ${errorMessage}`));
          });
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`CSV dosyası işlenemedi: ${errorMessage}`);
    }
  }

  private mapToEntryDtos(data: any[]): ParsedOnInvoiceRow[] {
    return data
      .map((row, index) => ({
        ...row,
        _originalRowNumber: index + 2, // +2: header row (1) + 0-based index (1) = 2
      }))
      .filter((row) => {
        // Boş satırları filtrele - en azından customer_code veya invoice_no olmalı
        return row.customer_code || row.customerCode || row.CUSTOMER_CODE || row.CustomerCode ||
               row.invoice_no || row.invoiceNo || row.INVOICE_NO || row.InvoiceNo;
      })
      .map((row) => {
        const customerCode = this.getStringValue(
          row.customer_code || row.customerCode || row.CUSTOMER_CODE || row.CustomerCode
        );
        const invoiceNo = this.getStringValue(
          row.invoice_no || row.invoiceNo || row.INVOICE_NO || row.InvoiceNo
        );
        const invoiceDate = this.getDateValue(
          row.invoice_date || row.invoiceDate || row.INVOICE_DATE || row.InvoiceDate
        );
        const fiscalPeriod = this.getFiscalPeriod(
          row.fiscal_period || row.fiscalPeriod || row.FISCAL_PERIOD || row.FiscalPeriod
        );
        const skuCode = this.getStringValue(
          row.sku_code || row.skuCode || row.SKU_CODE || row.SkuCode
        );
        const quantity = this.getNumberValue(
          row.quantity || row.Quantity || row.QUANTITY
        );
        const listPrice = this.getNumberValue(
          row.list_price || row.listPrice || row.LIST_PRICE || row.ListPrice
        );
        const actualPrice = this.getNumberValue(
          row.actual_price || row.actualPrice || row.ACTUAL_PRICE || row.ActualPrice
        );
        const discount = this.getNumberValue(
          row.discount || row.Discount || row.DISCOUNT
        );
        const discountType = this.getDiscountType(
          row.discount_type || row.discountType || row.DISCOUNT_TYPE || row.DiscountType
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
          currency: this.getOptionalString(
            row.currency || row.Currency || row.CURRENCY
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

  private getNumberValue(value: any): number {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException('Number değeri zorunludur');
    }
    // Virgül ve nokta ayracını düzelt (Türkçe format: 1.234,56 -> 1234.56)
    let numStr = String(value).trim();
    // Eğer nokta binlik ayraç gibi görünüyorsa (1.234,56 formatı)
    if (numStr.includes(',') && numStr.split('.').length > 2) {
      // Binlik ayraç olarak nokta kullanılmış
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      // Sadece virgülü noktaya çevir
      numStr = numStr.replace(/,/g, '');
    }
    const num = Number(numStr);
    if (isNaN(num)) {
      throw new BadRequestException(`Geçersiz number değeri: ${value}`);
    }
    return num;
  }

  private getDateValue(value: any): string {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException('Date değeri zorunludur');
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
      throw new BadRequestException(`Geçersiz tarih formatı: ${value}. YYYY-MM-DD formatında olmalıdır.`);
    }

    // YYYY-MM-DD formatına çevir
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

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

    throw new BadRequestException(`Geçersiz fiscal period formatı: ${value}. YYYY-MM formatında olmalıdır.`);
  }

  private getDiscountType(value: any): OnInvoiceDiscountType {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException('Discount type değeri zorunludur');
    }

    const str = String(value).trim().toUpperCase();

    // Mapping
    if (str === 'CPP_ON' || str === 'CPP ON-INVOICE' || str === 'CPP_ON_INVOICE') {
      return OnInvoiceDiscountType.CPP_ON;
    }
    if (str === 'LTA_ON' || str === 'LTA ON-INVOICE' || str === 'LTA_ON_INVOICE' || str === 'LTA Fatura Altı İskonto') {
      return OnInvoiceDiscountType.LTA_ON;
    }
    if (str === 'PROMO_DISCOUNT' || str === 'PROMO DISCOUNT' || str === 'Anında Fiyat İndirimi') {
      return OnInvoiceDiscountType.PROMO_DISCOUNT;
    }

    throw new BadRequestException(`Geçersiz discount type: ${value}. Geçerli değerler: CPP_ON, LTA_ON, PROMO_DISCOUNT`);
  }

  /**
   * Excel template oluştur
   */
  generateExcelTemplate(): Buffer {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['CUSTOMER_CODE', 'INVOICE_NO', 'INVOICE_DATE', 'FISCAL_PERIOD', 'SKU_CODE', 'QUANTITY', 'LIST_PRICE', 'ACTUAL_PRICE', 'DISCOUNT', 'DISCOUNT_TYPE'],
      ['CUST-CF-001', 'INV-50001', '2026-01-15', '2026-01', 'WEL-HC-001', '100', '185.00', '162.80', '2220.00', 'CPP_ON'],
      ['CUST-CF-001', 'INV-50001', '2026-01-15', '2026-01', 'WEL-HC-002', '50', '245.00', '220.50', '1225.00', 'CPP_ON'],
      ['CUST-GS-002', 'INV-50002', '2026-01-16', '2026-01', 'WEL-HC-001', '200', '185.00', '166.50', '3700.00', 'LTA_ON'],
      ['CUST-GS-002', 'INV-50002', '2026-01-16', '2026-01', 'WEL-HC-003', '75', '320.00', '288.00', '2400.00', 'LTA_ON'],
      ['CUST-MK-003', 'INV-50003', '2026-01-17', '2026-01', 'WEL-HC-001', '150', '185.00', '175.75', '1387.50', 'PROMO_DISCOUNT'],
      ['CUST-MK-003', 'INV-50003', '2026-01-17', '2026-01', 'WEL-HC-002', '100', '245.00', '232.75', '1225.00', 'PROMO_DISCOUNT'],
      ['CUST-CF-001', 'INV-50004', '2026-01-18', '2026-01', 'WEL-HC-004', '80', '150.00', '135.00', '1200.00', 'CPP_ON'],
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
