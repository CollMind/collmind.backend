import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import {
  parseNumericText,
  describeNumericTextFailure,
} from '../../../../common/numeric/numeric-text';
import {
  excelSerialToIsoDate,
  describeExcelSerialDateFailure,
} from '../../../../common/date/excel-serial-date';
import {
  parseDateText,
  describeDateTextFailure,
} from '../../../../common/date/date-text';
import {
  pickCell,
  hasCellValue,
  isBlankCellValue,
} from '../../../../common/row-parsing/pick-cell';
import { normalizeBlankCells } from '../../../../common/row-parsing/normalize-blank-cells';
import { FieldParseError } from '../../../../common/row-parsing/field-parse-error';

/**
 * `BL-2` (`docs/process/BL2_GIRIS_BRIEF.md §1/§5c`) — baseline hacim
 * import'unun dosya-okuma UCU.
 *
 * ⛔ YENİ BİR PARSER "İCAT" EDİLMEDİ — emsal DÖRT, biri UYARLANDI
 * (`off-invoice-file-parser.service.ts`, aynı XLSX+CSV okuma iskeleti:
 * `sheet_to_json({ raw:true, defval:null, blankrows:false })` + `csv-parser`
 * stream + satır limiti). Bu dosya o iskeleti KOPYALAMIYOR, PAYLAŞILAN
 * ÇEKİRDEĞİ ÇAĞIRIYOR — `§5c`'nin ayrımı:
 *
 *   PAYLAŞILAN ÇEKİRDEK (import EDİLİR, kopyalanmaz)
 *     - hücre okuma:        `pick-cell.ts` (`pickCell`/`hasCellValue`/
 *                            `isBlankCellValue`)
 *     - sayı grameri:       `numeric-text.ts` (`parseNumericText`)
 *     - tarih grameri:      `date-text.ts` (`parseDateText`) — metin dalı
 *     - Excel serial-date:  `excel-serial-date.ts` (`excelSerialToIsoDate`)
 *     - red raporu kanalı:  `field-parse-error.ts` (`FieldParseError`)
 *
 *   DOSYA TİPİ ŞEMASI (BU DOSYAYA ÖZGÜ, off-invoice'la PAYLAŞILMAZ)
 *     - kolon düzeni:       `sku_code` · `cpl_code` · `period` · `base_volume`
 *     - zorunlu alanlar:    dördü de (Q20/`§3`: eksik alan → SATIR REDDİ)
 *     - UOM:                bu dosyada YOK — `base_volume` PIECE, birim
 *                            dönüşümü `baseline_volumes` şemasının kapsamı
 *                            dışında (entity JSDoc'u)
 *
 * ⛔ `W2` TUZAĞI (`§5c`): off-invoice'un KENDİ varsayımları (agreement_id/
 * invoice_no zorunluluğu, `amount`/`invoiceDate` alan adları) buraya
 * SIZDIRILMADI — bu dosyanın DTO'su (`ParsedBaselineVolumeRow`) baseline'a
 * özgü, off-invoice'un DTO'suyla HİÇBİR ALAN PAYLAŞMIYOR.
 *
 * ── PİN 1 — KAYNAK HÜCRE → PERIOD ETİKETİ, ÜÇ TZ'DE AYNI (`§2a`) ─────────
 * `getPeriodValue` aşağıda: metin `YYYY-MM` · Excel serial-date · tam tarih
 * metni (ISO/Türk) — HİÇBİRİ bir `Date` NESNESİ ÜRETMEZ. Excel serial ve tam
 * tarih metni dalları `excelSerialToIsoDate`/`parseDateText`'in ürettiği
 * `YYYY-MM-DD` DİZGESİNİ `.slice(0, 7)` ile kısaltır — `off-invoice
 * -file-parser.service.ts`'in `getFiscalPeriod` metodunun BİREBİR aynısı
 * (T-123/T-107 adım 1 zaten TZ-bağımsız kanıtlanmış, `period-month.ts`'in
 * JSDoc'unun uyardığı `Date`+local-getter karışımı burada YOK — hiçbir
 * `new Date(...)` çağrısı yok, yalnız dizge birleştirme/kısaltma). TZ=UTC ·
 * TZ=Europe/Istanbul · TZ=America/New_York üç ortamda da AYNI çıktıyı verir
 * — kanıt: `baseline-volume-file-parser.service.spec.ts` `describe('PİN 1
 * — period label, üç TZ')`.
 */
export interface ParsedBaselineVolumeRow {
  originalRowNumber: number;
  originalRowData?: Record<string, unknown>;
  skuCode: string | undefined;
  cplCode: string | undefined;
  /** `YYYY-MM`, yalnız dizge — bkz. dosya-üstü JSDoc "PİN 1". */
  period: string | undefined;
  baseVolume: number | undefined;
  /** Bir hücre MEVCUT ama OKUNAMADIYSA burada (§2.5: mevcut-ama-okunamaz ≠
   *  hiç yok). Boş alan (hiç yazılmamış hücre) burada DEĞİL, satır-şeması
   *  doğrulamasında (`baseline-volume.service.ts`) ele alınır. */
  parseErrors?: FieldParseError[];
}

@Injectable()
export class BaselineVolumeFileParserService {
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly MAX_ROWS = 5000; // 12 ay × büyük SKU×CPL kartezyeni — sales-actuals'ın 500'ünden geniş, ölçülmüş bir üst sınır değil, off-invoice/on-invoice'un 500'ünün baseline'ın matris hacmine göre dar kalacağı gözlemine dayanan bir üst sınır; gerekirse ürün sahibi revize eder.

  async parseExcel(
    file: Express.Multer.File,
  ): Promise<ParsedBaselineVolumeRow[]> {
    try {
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
        sheetRows: this.MAX_ROWS + 1,
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
        raw: true,
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

      return this.mapToBaselineVolumeRows(data as Record<string, unknown>[]);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Bilinmeyen hata';
      throw new BadRequestException(`Excel dosyası okunamadı: ${errorMessage}`);
    }
  }

  async parseCSV(
    file: Express.Multer.File,
  ): Promise<ParsedBaselineVolumeRow[]> {
    try {
      if (file.buffer.length > this.MAX_FILE_SIZE) {
        throw new BadRequestException(
          'Dosya boyutu çok büyük. Maksimum 10MB olmalıdır.',
        );
      }

      let rowCount = 0;

      return await new Promise((resolve, reject) => {
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
              resolve(this.mapToBaselineVolumeRows(results));
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

  private mapToBaselineVolumeRows(
    data: Record<string, unknown>[],
  ): ParsedBaselineVolumeRow[] {
    return data
      .map((row, index) => ({
        ...normalizeBlankCells(row),
        _originalRowNumber: index + 2, // header (1) + 1-based
      }))
      .filter((row) => {
        // Tümüyle boş satırları (Excel'in ara sıra bıraktığı ara boşluklar)
        // filtrele — dört alanın DÖRDÜ de yoksa bu bir "satır" değil, gürültü.
        // Tek bir alan bile varsa satır Q20/`§3`'ün "eksik alanlı satır"
        // dalına gider (SATIR REDDİ + adlı hata) — burada FİLTRELENMEZ.
        return (
          hasCellValue(row, 'sku_code', 'skuCode', 'SKU_Code', 'SKUCode') ||
          hasCellValue(row, 'cpl_code', 'cplCode', 'CPL_Code', 'CPLCode') ||
          hasCellValue(row, 'period', 'Period', 'PERIOD') ||
          hasCellValue(
            row,
            'base_volume',
            'baseVolume',
            'Base_Volume',
            'BaseVolume',
          )
        );
      })
      .map((row) => {
        const parseErrors: FieldParseError[] = [];

        const skuCodeRaw = pickCell(
          row,
          'sku_code',
          'skuCode',
          'SKU_Code',
          'SKUCode',
        );
        const cplCodeRaw = pickCell(
          row,
          'cpl_code',
          'cplCode',
          'CPL_Code',
          'CPLCode',
        );
        const periodRaw = pickCell(row, 'period', 'Period', 'PERIOD');
        const baseVolumeRaw = pickCell(
          row,
          'base_volume',
          'baseVolume',
          'Base_Volume',
          'BaseVolume',
        );

        return {
          originalRowNumber: row._originalRowNumber,
          originalRowData: row,
          skuCode: this.getOptionalString(skuCodeRaw),
          cplCode: this.getOptionalString(cplCodeRaw),
          period: this.getPeriodValue(periodRaw, 'period', parseErrors),
          baseVolume: this.getNumberValue(
            baseVolumeRaw,
            'base_volume',
            parseErrors,
          ),
          parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
        };
      });
  }

  private getOptionalString(value: unknown): string | undefined {
    if (isBlankCellValue(value)) return undefined;
    const str = String(value).trim();
    return str || undefined;
  }

  /**
   * `numeric-text.ts` — T-105 grameri, `off-invoice`/`on-invoice`'la AYNI
   * (§7: "bu yeteneğin mevcut implementasyonu var mı" — evet, çağrılıyor).
   * `base_volume` bir SAYIM (PIECE), PARA DEĞİL — `money-float` guard'ının
   * "Alan A" evrenine girmiyor (bkz. task raporu §7).
   */
  private getNumberValue(
    value: unknown,
    field: string,
    errors: FieldParseError[],
  ): number | undefined {
    const result = parseNumericText(value);
    if (!result.ok) {
      if (result.reason !== 'EMPTY') {
        errors.push({
          field,
          error_type: 'INVALID_VOLUME_FORMAT',
          error_message: describeNumericTextFailure(result),
        });
      }
      return undefined;
    }
    return Number(result.canonical);
  }

  /**
   * PİN 1 — bkz. dosya-üstü JSDoc. Üç kabul edilen hücre şekli:
   *   1) metin `YYYY-MM` (zaten period etiketi)
   *   2) Excel serial-date sayısı → `excelSerialToIsoDate` → `.slice(0,7)`
   *   3) tam tarih metni (ISO `YYYY-MM-DD` / Türk `GG.AA.YYYY`) →
   *      `parseDateText` → `.slice(0,7)`
   * `off-invoice-file-parser.service.ts`'in `getFiscalPeriod`'uyla BİREBİR
   * aynı gramer — kopyalanmadı, aynı ÇEKİRDEK ÇAĞRILARAK yeniden üretildi.
   */
  private getPeriodValue(
    value: unknown,
    field: string,
    errors: FieldParseError[],
  ): string | undefined {
    if (isBlankCellValue(value)) return undefined;

    const str = String(value).trim();

    const periodRegex = /^\d{4}-\d{2}$/;
    if (periodRegex.test(str)) {
      const month = parseInt(str.split('-')[1], 10);
      if (month >= 1 && month <= 12) {
        return str;
      }
    }

    if (typeof value === 'number') {
      const result = excelSerialToIsoDate(value);
      if (!result.ok) {
        errors.push({
          field,
          error_type: 'INVALID_PERIOD',
          error_message: describeExcelSerialDateFailure(result),
        });
        return undefined;
      }
      return result.isoDate.slice(0, 7);
    }

    const dateResult = parseDateText(str);
    if (dateResult.ok) {
      return dateResult.isoDate.slice(0, 7);
    }

    errors.push({
      field,
      error_type: 'INVALID_PERIOD',
      error_message: describeDateTextFailure(dateResult),
    });
    return undefined;
  }
}
