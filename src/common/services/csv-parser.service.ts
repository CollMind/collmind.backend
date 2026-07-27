import { Injectable, BadRequestException } from '@nestjs/common';
import csvParser from 'csv-parser';
import { Readable } from 'stream';

export interface CsvParseOptions {
  /** Bayt cinsinden maksimum dosya boyutu. Varsayılan 10MB. */
  maxSizeBytes?: number;
  /** Maksimum satır sayısı (header hariç). Varsayılan 10000. */
  maxRows?: number;
  /** İzin verilen MIME type'lar. Varsayılan yalnızca text/csv. */
  allowedMimeTypes?: string[];
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_ROWS = 10000;
const DEFAULT_MIME_WHITELIST = [
  'text/csv',
  'application/vnd.ms-excel', // bazı tarayıcılar CSV'yi bu MIME ile gönderir
  'application/octet-stream',
];

/**
 * DTO-agnostik CSV parser — T-020 (T-021'de mevcut iki parser
 * `customer/services/file-parser.service.ts` ve
 * `on-invoice/services/on-invoice-file-parser.service.ts` buna delege
 * edilecek; bu turda regresyon riski alınmadı).
 *
 * Ham `Record<string,string>[]` döner; DTO mapping çağıran tarafın işidir.
 * Dosya boyutu/satır sayısı/MIME guard'ları tek yerde toplanır.
 */
@Injectable()
export class CsvParserService {
  async parse(
    file: Express.Multer.File,
    options: CsvParseOptions = {},
  ): Promise<Record<string, string>[]> {
    const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE;
    const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
    const allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_MIME_WHITELIST;

    if (!file || !file.buffer) {
      throw new BadRequestException('Dosya yüklenmedi.');
    }

    if (file.buffer.length > maxSizeBytes) {
      throw new BadRequestException(
        `Dosya boyutu çok büyük. Maksimum ${Math.floor(maxSizeBytes / (1024 * 1024))}MB olmalıdır.`,
      );
    }

    const ext = file.originalname?.split('.').pop()?.toLowerCase();
    if (ext !== 'csv') {
      throw new BadRequestException(
        'Desteklenmeyen dosya formatı. Sadece CSV (.csv) dosyaları kabul edilir.',
      );
    }

    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Desteklenmeyen dosya MIME tipi: ${file.mimetype}`,
      );
    }

    return new Promise((resolve, reject) => {
      const rows: Record<string, string>[] = [];
      let rowCount = 0;
      const stream = Readable.from(file.buffer.toString('utf-8'));

      stream
        .pipe(csvParser())
        .on('data', (data: Record<string, string>) => {
          rowCount++;
          if (rowCount > maxRows) {
            stream.destroy();
            reject(
              new BadRequestException(
                `CSV dosyası çok fazla satır içeriyor. Maksimum ${maxRows} satır işlenebilir.`,
              ),
            );
            return;
          }
          rows.push(data);
        })
        .on('end', () => {
          resolve(rows);
        })
        .on('error', (error: Error) => {
          reject(
            new BadRequestException(
              `CSV dosyası okunamadı: ${error.message || 'Bilinmeyen hata'}`,
            ),
          );
        });
    });
  }
}
