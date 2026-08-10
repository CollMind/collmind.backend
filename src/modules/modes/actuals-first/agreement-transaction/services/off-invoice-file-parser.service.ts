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

  /**
   * T-123: string branch now goes through `date-text.ts`'s katı gramer (ISO
   * `YYYY-MM-DD` veya Türk `GG.AA.YYYY`, ürün sahibi kararı 2026-08-09,
   * T-121) instead of `new Date(str)` — bkz. `OnInvoiceFileParserService`'in
   * aynı isimli metodundaki doküman, tıpatıp aynı gerekçe/bulgu.
   *
   * Satır-bazlı hata teslimi (T-123 madde 4): bu metod da FIRLATIR ve bu
   * dosyada da satır bazlı bir hata biriktirme kanalı yok (ölçüldü — bkz.
   * `getNumberValue` de aynı şekilde atıyor). Bilinçli, var olan dosya-bazlı
   * ret tasarımı; T-123'ün kapsamı değil.
   */
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
   * T-123: metin dalı artık `date-text.ts` üzerinden — `YYYY-MM-DD`'yi
   * `YYYY-MM`'e kısaltma çağıran tarafta yapılır (bkz. `OnInvoiceFileParserService`
   * ikizindeki gerekçe: `date-text.ts` yalnız takvim GÜNÜ'nü kodluyor, "dönem"
   * ayrı bir gramer).
   *
   * `string | undefined` dönüşü — `OnInvoiceFileParserService.getFiscalPeriod`
   * her zaman `string` döner ve boş girdide FIRLATIR — BİLİNÇLİ VE ÖLÇÜLMÜŞ bir
   * asimetridir, T-123'ün icadı değil: `agreement-transaction.service.ts:109-119`
   * fiscal period'u DTO'da yoksa `agreement.periodMonth`'a, o da yoksa
   * `invoiceDate`'ten türetilen döneme düşürür (Priority 1/2/3 zinciri) — yani
   * off-invoice importunda bu ALAN gerçekten opsiyonel. On-invoice tarafında
   * böyle bir düşüş zinciri yok (`on-invoice.service.ts`: `if (!fiscalPeriod)
   * throw`), bu yüzden orada alan zorunlu. §2.4 gereği bu asimetri
   * DEĞİŞTİRİLMEDİ — yalnız burada ölçülüp belgelendi.
   *
   * Ama BU asimetri, aşağıdaki bug'ı meşrulaştırmıyordu: hücre MEVCUT ama
   * ayrıştırılamıyorsa (`§2.5` — mevcut-ama-okunamaz, YOK ile aynı şey
   * değildir) eskiden burası sessizce `undefined` dönüyordu — yani "girdi
   * yok" ile "girdi var ama çöp" ayrımı kayboluyordu ve satır, agreement'ın
   * periodMonth'una ya da invoiceDate'ten türetilen döneme SESSİZCE
   * düşüyordu; kullanıcının yazdığı (muhtemelen yanlış yazılmış) değer
   * hiç görünmeden atlanıyordu. T-123 madde 3: artık FIRLATIR.
   */
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

    // Tam tarih metni ise katı gramer (T-123/T-121) ile çöz, sonra YYYY-MM'e
    // kısalt — `new Date(str)` yerine.
    const dateResult = parseDateText(str);
    if (dateResult.ok) {
      return dateResult.isoDate.slice(0, 7);
    }

    // ⚠️ BURADA BİLEREK FIRLATMIYORUZ — ve bu bir eksiklik değil, ölçülmüş bir
    // takas. Geri alındı: T-123, ürün sahibi kararı 2026-08-10.
    //
    // T-123 önce buraya bir `BadRequestException` koydu (§2.5: "mevcut ama
    // okunamaz" ile "hiç verilmemiş" aynı şey değildir — doğru bir kural).
    // Ölçüldü ki bu importer'da o katılığın gideceği bir yer YOK:
    //
    //     A1 fiscal_period = "çöp"  ->  THROW
    //     A2 sağlam satır           ->  o da reddedildi (TÜM DOSYA)
    //
    // `customer` importunda satır-bazlı bir hata kanalı var
    // (`FieldParseError`/`parseErrors`, T-121); burada YOK — throw `.map()`'ten
    // `parseCSV`/`parseExcel`'in dış catch'ine çıkıp dosyayı satır numarasız
    // reddediyor. Yani tek bozuk hücre 500 satırlık bir yüklemeyi düşürüyordu.
    //
    // Katılık eklerken teslimi düzeltmemek, §2.5'i bir ucundan uygulayıp
    // diğerini açık bırakmaktır (T-121'in dersi).
    //
    // ⚠️ SESSİZ VARSAYILAN İLE SESSİZ FALLBACK AYNI ŞEY DEĞİLDİR. §2.5 bilgi
    // UYDURMAYI yasaklıyor; buradaki düşüş zinciri başka bir KAYNAK kullanıyor:
    // `agreement-transaction.service.ts:109-119` sırayla `agreement.periodMonth`,
    // sonra `invoiceDate`'ten türetilen dönem. Sessiz, ama kaynaklı.
    //
    // GERİ GELECEK: satır-bazlı hata kanalı bu iki importer'a taşındığında
    // (T-126) bu throw geri konmalı — o zaman bozuk hücre satırı reddeder,
    // dosyayı değil. İki task birbirini biliyor.
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
