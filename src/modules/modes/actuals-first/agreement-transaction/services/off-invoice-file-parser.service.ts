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
import { FieldParseError } from '../../../../../common/row-parsing/field-parse-error';
import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { CreateAgreementTransactionDto } from '../dto/create-agreement-transaction.dto';

/**
 * T-126: `amount`/`invoiceDate` are required on `CreateAgreementTransactionDto`
 * (the API-facing shape), but AT PARSE TIME a cell may be present-and-unreadable
 * — a state that must not be invented as some other value (§2.5). Mirrors
 * `OnInvoiceFileParserService`'s `ParsedOnInvoiceEntryDto` (same task, same
 * split); `fiscalPeriod` here is carried as its own sibling field on
 * `ParsedOffInvoiceRow` (below), not on this DTO — unchanged from before.
 */
export type ParsedOffInvoiceTransactionDto = Omit<
  CreateAgreementTransactionDto,
  'amount' | 'invoiceDate'
> & {
  amount: number | undefined;
  invoiceDate: string | undefined;
};

export interface ParsedOffInvoiceRow {
  dto: ParsedOffInvoiceTransactionDto;
  originalRowNumber: number;
  originalRowData?: Record<string, any>;
  fiscalPeriod?: string; // YYYY-MM formatında
  description?: string;
  /** Non-empty iff at least one field on this row failed to PARSE (present,
   *  but unreadable — §2.5). Folded into
   *  `OffInvoiceValidationService.validateRow`'s row-level `ValidationError`
   *  channel by that service, not thrown here (T-126) — a single bad cell
   *  must fail its OWN row, not the whole upload. */
  parseErrors?: FieldParseError[];
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
        // T-126: field-level parse failures (an unreadable date, number or
        // fiscal-period cell) are collected here, in field-declaration
        // order, rather than thrown — a thrown exception from any of the
        // getters below would abort the WHOLE FILE at the first bad cell
        // (measured, T-123: this is exactly what used to happen; see the
        // getters' own docs).
        const parseErrors: FieldParseError[] = [];

        const dto: ParsedOffInvoiceTransactionDto = {
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
            'invoice_date',
            parseErrors,
          ),
          amount: this.getNumberValue(
            pickCell(row, 'amount', 'Amount', 'AMOUNT'),
            'amount',
            parseErrors,
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
          'fiscal_period',
          parseErrors,
        );

        return {
          dto,
          originalRowNumber: row._originalRowNumber,
          originalRowData: row,
          fiscalPeriod,
          description: dto.notes,
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
   *
   * T-126: no longer throws, and no longer enforces positivity — EMPTY and
   * present-but-unreadable both return `undefined`, but only the latter
   * appends to `errors`. EMPTY is a legitimate absence;
   * `OffInvoiceValidationService.validateRow`'s existing "Tutar pozitif bir
   * sayı olmalıdır" check (§7.1's `amount <= 0` — [[T-124]]'s scope, not
   * this one) already treats `undefined`/`<= 0` as failing. Positivity stays
   * validateRow's job, not this parser's — matches the parsing/meaning split
   * `numeric-text.ts` documents (T-105) and the identical move
   * `OnInvoiceFileParserService.getNumberValue` already went through.
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
   * T-121) instead of `new Date(str)` — bkz. `OnInvoiceFileParserService`'in
   * aynı isimli metodundaki doküman, tıpatıp aynı gerekçe/bulgu.
   *
   * T-126: this method no longer THROWS. `invoice_date` used to reject the
   * WHOLE FILE on a single unreadable cell (measured, T-123: this dosyada
   * satır-bazlı bir hata kanalı yoktu). Now it takes the same `errors:
   * FieldParseError[]` sink `getNumberValue` and `getFiscalPeriod` do —
   * genuinely absent (`null`/`undefined`/`''`) returns `undefined` with NO
   * error pushed (a legitimate absence, caught by
   * `OffInvoiceValidationService.validateRow`'s existing "Fatura tarihi
   * zorunludur" check); present-but-unreadable pushes a specific error and
   * also returns `undefined` — the two states are NEVER collapsed into one
   * (§2.5). Mirrors `OnInvoiceFileParserService.getDateValue` exactly.
   */
  private getDateValue(
    value: any,
    field: string,
    errors: FieldParseError[],
  ): string | undefined {
    if (value === null || value === undefined || value === '') {
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
   * ⚠️ TARİHÇE (throw -> geri alma -> parseErrors, üç turda):
   *
   * 1) T-123 madde 3 önce buraya bir `BadRequestException` koydu (§2.5:
   *    "mevcut ama okunamaz" ile "hiç verilmemiş" aynı şey değildir — doğru
   *    bir kural): hücre MEVCUT ama ayrıştırılamıyorsa eskiden burası
   *    sessizce `undefined` dönüyordu — "girdi yok" ile "girdi var ama çöp"
   *    ayrımı kayboluyordu ve satır, agreement'ın periodMonth'una ya da
   *    invoiceDate'ten türetilen döneme SESSİZCE düşüyordu.
   *
   * 2) O throw GERİ ALINDI (T-123, ürün sahibi kararı 2026-08-10). Ölçüldü ki
   *    bu importer'da o katılığın gideceği bir yer YOK:
   *
   *        A1 fiscal_period = "çöp"  ->  THROW
   *        A2 sağlam satır           ->  o da reddedildi (TÜM DOSYA)
   *
   *    Bu dosyada satır-bazlı bir hata kanalı henüz YOKTU — throw `.map()`'ten
   *    `parseCSV`/`parseExcel`'in dış catch'ine çıkıp dosyayı satır numarasız
   *    reddediyordu. Tek bozuk hücre 500 satırlık bir yüklemeyi düşürüyordu.
   *    Katılık eklerken teslimi düzeltmemek, §2.5'i bir ucundan uygulayıp
   *    diğerini açık bırakmaktır (T-121'in dersi). Geri alma o zaman koda
   *    yazıldı: "GERİ GELECEK: satır-bazlı hata kanalı bu iki importer'a
   *    taşındığında (T-126) bu throw geri konmalı."
   *
   * 3) T-126: kanal şimdi VAR (`FieldParseError`/`parseErrors`,
   *    `getDateValue`/`getNumberValue` ile aynı desen). Throw GERİ KONMADI —
   *    dönüş değeri hâlâ `undefined` (madde 1'deki asimetri hâlâ geçerli:
   *    alan gerçekten opsiyonel, `agreement-transaction.service.ts`'in düşüş
   *    zinciri hâlâ orada) — ama artık "hiç" değil: present-but-unreadable
   *    durumu ARTIK bir `parseErrors` girdisi de üretiyor, kapatarak madde
   *    2'nin kendi sessiz boşluğunu (o zaman `errors` diye bir şey yoktu, bu
   *    durum ne throw ne error üretiyordu — saf sessizlik, gerçekten yok olan
   *    hücreden farksız). ⚠️ SESSİZ VARSAYILAN İLE SESSİZ FALLBACK AYNI ŞEY
   *    DEĞİLDİR: §2.5 bilgi UYDURMAYI yasaklıyor; buradaki düşüş zinciri
   *    başka bir KAYNAK kullanıyor (`agreement.periodMonth`, sonra
   *    `invoiceDate`'ten türetilen dönem) — sessiz, ama artık İZLENEBİLİR de
   *    (parseErrors'ta bir iz bırakıyor) ve kaynaklı.
   */
  private getFiscalPeriod(
    value: any,
    field: string,
    errors: FieldParseError[],
  ): string | undefined {
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
        errors.push({
          field,
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure(result),
        });
        return undefined;
      }
      return result.isoDate.slice(0, 7);
    }

    // Tam tarih metni ise katı gramer (T-123/T-121) ile çöz, sonra YYYY-MM'e
    // kısalt — `new Date(str)` yerine.
    const dateResult = parseDateText(str);
    if (dateResult.ok) {
      return dateResult.isoDate.slice(0, 7);
    }

    // Present-but-unreadable: yukarıdaki tarihçenin 3. maddesi — throw yok,
    // ama artık sessiz de değil.
    errors.push({
      field,
      error_type: 'INVALID_DATE',
      error_message: describeDateTextFailure(dateResult),
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
