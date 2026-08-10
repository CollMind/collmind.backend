import { BadRequestException } from '@nestjs/common';
import { OnInvoiceFileParserService } from './on-invoice-file-parser.service';
import { describeExcelSerialDateFailure } from '../../../../../common/date/excel-serial-date';
import { describeDateTextFailure } from '../../../../../common/date/date-text';
import { OffInvoiceFileParserService } from '../../agreement-transaction/services/off-invoice-file-parser.service';
import { FieldParseError } from '../../../../../common/row-parsing/field-parse-error';
import * as XLSX from 'xlsx';

/**
 * T-107 adım 1 — wiring tests for the two call sites in THIS file
 * (`getDateValue`, `getFiscalPeriod`). The shared math itself (TZ-independence,
 * the four refusal classes, boundary values) is exhaustively covered once in
 * `common/date/excel-serial-date.spec.ts` — not repeated here (§2.7).
 *
 * T-126 REWRITE (2026-08-10): `getDateValue`/`getNumberValue`/`getDiscountType`
 * used to THROW `BadRequestException` for a present-but-unreadable cell,
 * which `mapToEntryDtos`'s single `.map()` and `parseExcel`/`parseCSV`'s own
 * try/catch turned into a FILE-LEVEL rejection with no row number (measured,
 * T-123: this importer had no row-level channel at all — every one of these
 * getters threw straight into the file-level `catch`). They now take a
 * fourth/third `errors: FieldParseError[]` parameter and COLLECT into it
 * instead of throwing, mirroring `off-invoice-file-parser.service.ts`'s
 * identical rewrite and the `customer` importer's original one (T-121
 * review (a)). `getFiscalPeriod` is the DELIBERATE EXCEPTION — it still
 * throws, unchanged by T-126, because on-invoice's fiscal period is read to
 * CREATE the batch before row-level validation ever runs (see that
 * method's own doc comment, and the dedicated asymmetry-pin block at the
 * bottom of this file).
 */
describe('OnInvoiceFileParserService — excel-serial-date wiring (T-107 adım 1 / T-126)', () => {
  let service: OnInvoiceFileParserService;

  beforeEach(() => {
    service = new OnInvoiceFileParserService();
  });

  const getDateValue = (
    value: unknown,
    field = 'invoice_date',
  ): { value: string | undefined; errors: FieldParseError[] } => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as {
        getDateValue(
          v: unknown,
          f: string,
          e: FieldParseError[],
        ): string | undefined;
      }
    ).getDateValue(value, field, errors);
    return { value: result, errors };
  };

  // `getFiscalPeriod` in THIS file is single-argument and still THROWS —
  // deliberately NOT rewritten by T-126 (see the file header and the
  // asymmetry-pin block below).
  const getFiscalPeriod = (value: unknown): string =>
    (
      service as unknown as { getFiscalPeriod(v: unknown): string }
    ).getFiscalPeriod(value);

  describe('getDateValue — numeric (Excel serial) branch', () => {
    it('a numeric cell value is handed to the shared helper and its ISO date returned unchanged, no error pushed', () => {
      const { value, errors } = getDateValue(46037);
      expect(value).toBe('2026-01-15');
      expect(errors).toHaveLength(0);
    });

    it('a NOT_FINITE input (NaN) is collected as an INVALID_DATE error, not silently coerced or thrown', () => {
      const { value, errors } = getDateValue(NaN, 'invoice_date');
      expect(value).toBeUndefined();
      expect(errors).toEqual([
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure({
            ok: false,
            reason: 'NOT_FINITE',
            input: NaN,
          }),
        },
      ]);
    });

    it('a NON_POSITIVE input (-5) is collected via the helper', () => {
      const { value, errors } = getDateValue(-5);
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].error_type).toBe('INVALID_DATE');
    });

    it("Excel's fictitious 1900-02-29 (serial 60) is collected via the helper, with the helper's own message", () => {
      const { value, errors } = getDateValue(60, 'invoice_date');
      expect(value).toBeUndefined();
      expect(errors).toEqual([
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure({
            ok: false,
            reason: 'LEAP_BUG_DAY',
            input: 60,
          }),
        },
      ]);
    });

    // T-126: a value too large to be a representable `Date` used to escape
    // as a raw `RangeError` (see `excel-serial-date.spec.ts` for the
    // module-level fix and its own crash-guard test) — pinned here too,
    // since this is one of the six call sites that would have propagated it.
    it('a value too large to be a representable Date is refused as OUT_OF_RANGE, not a crash', () => {
      expect(() => getDateValue(99999999999)).not.toThrow();
      const { value, errors } = getDateValue(99999999999);
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].error_type).toBe('INVALID_DATE');
    });

    // T-126 review (B1): `'   '` joins `''`/`null`/`undefined` in the SAME
    // loop, plus a dedicated identity assertion — before the fix, a
    // whitespace-only cell fell through into `parseDateText`'s own `EMPTY`
    // result and pushed a row-level `INVALID_DATE` error the literal `''`
    // case never got (see `pick-cell.ts`'s `isBlankCellValue` doc).
    describe('genuinely absent input — the only case with zero errors AND an undefined value', () => {
      it.each([undefined, null, '', '   '])(
        '%p returns undefined with NO error pushed',
        (v) => {
          const { value, errors } = getDateValue(v);
          expect(value).toBeUndefined();
          expect(errors).toHaveLength(0);
        },
      );

      it("'' and '   ' produce the IDENTICAL result — not just individually undefined/error-free (T-126 review B1)", () => {
        const blank = getDateValue('');
        const whitespace = getDateValue('   ');
        expect(whitespace).toEqual(blank);
        expect(blank).toEqual({ value: undefined, errors: [] });
      });
    });
  });

  describe('getFiscalPeriod — numeric (Excel serial) branch (unchanged by T-126 — still throws)', () => {
    it('a numeric cell value is converted via the shared helper and truncated to YYYY-MM', () => {
      expect(getFiscalPeriod(46037)).toBe('2026-01');
    });

    it('a refused serial propagates the helper failure, not a guessed period', () => {
      expect(() => getFiscalPeriod(60)).toThrow(BadRequestException);
    });

    // `getFiscalPeriod` checks the `YYYY-MM` string shape FIRST; a number
    // never matches that regex (`String(46037)` is not `\d{4}-\d{2}`), so
    // every numeric input falls through to the excel-serial branch.
    it('a DST-boundary serial converts correctly through the fiscal-period path too', () => {
      expect(getFiscalPeriod(46110)).toBe('2026-03');
    });
  });

  /**
   * T-126 review (B1): `getFiscalPeriod` THROWS for a blank cell (the
   * required, single-argument variant — see the file header). Before this
   * fix, the naive `value === ''` check did not match `'   '`, so it fell
   * through the whole method and hit the FINAL, present-but-unreadable throw
   * with a DIFFERENT message: `"Geçersiz fiscal period formatı:    ."` — a
   * whitespace-only cell was reported as GARBAGE, not as MISSING, even
   * though the literal `''` cell right next to it got the correct
   * "zorunludur" message. Both must throw the SAME message.
   */
  describe('getFiscalPeriod — blank input ("" and "   ") both throw, with the IDENTICAL message (T-126 review B1)', () => {
    it.each(['', '   '])(
      '%p throws "Fiscal period değeri zorunludur", not a garbage-format message',
      (v) => {
        expect(() => getFiscalPeriod(v)).toThrow('Fiscal period değeri zorunludur');
      },
    );

    it("'' and '   ' throw the IDENTICAL message — not just both throwing SOME message", () => {
      let blankMessage: string | undefined;
      let whitespaceMessage: string | undefined;
      try {
        getFiscalPeriod('');
      } catch (e) {
        blankMessage = (e as Error).message;
      }
      try {
        getFiscalPeriod('   ');
      } catch (e) {
        whitespaceMessage = (e as Error).message;
      }
      expect(whitespaceMessage).toBe(blankMessage);
      expect(blankMessage).toBe('Fiscal period değeri zorunludur');
    });
  });

  /**
   * T-126 review (B1): `getDiscountType` had NO unit-level coverage before
   * this turn (only end-to-end, via `parseExcel`, for the unrecognized-enum
   * case). Before the fix, the naive `value === ''` check let `'   '` fall
   * through into the enum-mapping branch, match none of the known codes, and
   * push an `INVALID_ENUM` error ("Geçersiz indirim tipi: '   '.") for what
   * should have been a silent, legitimate absence — the literal `''` cell
   * produced zero errors for the identical intent.
   */
  describe('getDiscountType — blank input ("" and "   "), no errors, side by side (T-126 review B1)', () => {
    const getDiscountType = (
      value: unknown,
      field = 'discount_type',
    ): { value: unknown; errors: FieldParseError[] } => {
      const errors: FieldParseError[] = [];
      const result = (
        service as unknown as {
          getDiscountType(
            v: unknown,
            f: string,
            e: FieldParseError[],
          ): unknown;
        }
      ).getDiscountType(value, field, errors);
      return { value: result, errors };
    };

    it.each(['', '   '])('%p returns undefined with NO error pushed', (v) => {
      const { value, errors } = getDiscountType(v);
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(0);
    });

    it("'' and '   ' produce the IDENTICAL result", () => {
      expect(getDiscountType('   ')).toEqual(getDiscountType(''));
      expect(getDiscountType('')).toEqual({ value: undefined, errors: [] });
    });
  });

  /**
   * T-126 review (B1) — `getNumberValue` was already trim-aware BEFORE this
   * fix (it delegates straight to `parseNumericText`, which trims — see
   * `pick-cell.ts`'s `isBlankCellValue` doc). Pinned side by side with the
   * broken getters above so the contrast is on record.
   */
  describe('getNumberValue — blank input, "" and "   " already agree (delegates to parseNumericText, which trims)', () => {
    const getNumberValue = (
      value: unknown,
      field = 'quantity',
    ): { value: number | undefined; errors: FieldParseError[] } => {
      const errors: FieldParseError[] = [];
      const result = (
        service as unknown as {
          getNumberValue(
            v: unknown,
            f: string,
            e: FieldParseError[],
          ): number | undefined;
        }
      ).getNumberValue(value, field, errors);
      return { value: result, errors };
    };

    it.each(['', '   '])('%p returns undefined with NO error pushed', (v) => {
      const { value, errors } = getNumberValue(v);
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(0);
    });

    it("'' and '   ' produce the IDENTICAL result", () => {
      expect(getNumberValue('   ')).toEqual(getNumberValue(''));
      expect(getNumberValue('')).toEqual({ value: undefined, errors: [] });
    });
  });

  describe('end-to-end from a parsed row to the final DTO (mapToEntryDtos)', () => {
    const mapToEntryDtos = (
      rows: unknown[],
    ): Array<{
      dto: Record<string, unknown>;
      parseErrors?: FieldParseError[];
    }> =>
      (
        service as unknown as {
          mapToEntryDtos(rows: unknown[]): Array<{
            dto: Record<string, unknown>;
            parseErrors?: FieldParseError[];
          }>;
        }
      ).mapToEntryDtos(rows);

    it('a row with a numeric invoice_date and fiscal_period reaches the DTO with the correct ISO values', () => {
      const rows = mapToEntryDtos([
        {
          customer_code: 'CUST-1',
          invoice_no: 'INV-1',
          invoice_date: 46037, // 2026-01-15
          fiscal_period: 46037, // -> 2026-01
          sku_code: 'SKU-1',
          quantity: '10',
          list_price: '100.00',
          actual_price: '95.00',
          discount: '5.00',
          discount_type: 'CPP_ON',
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.invoiceDate).toBe('2026-01-15');
      expect(rows[0].dto.fiscalPeriod).toBe('2026-01');
      expect(rows[0].parseErrors).toBeUndefined();
    });

    // T-126: this is the closed regression. An unreadable numeric
    // invoice_date used to throw straight out of `mapToEntryDtos`'s
    // `.map()`, taking the whole batch down. Now the row survives with a
    // row-level `parseErrors` entry.
    it('a row with an unreadable numeric invoice_date is NOT thrown out of the batch — it survives with a parseErrors entry (§2.5, T-126)', () => {
      const rows = mapToEntryDtos([
        {
          customer_code: 'CUST-1',
          invoice_no: 'INV-1',
          invoice_date: 60, // Excel's fictitious 1900-02-29
          fiscal_period: '2026-01',
          sku_code: 'SKU-1',
          quantity: '10',
          list_price: '100.00',
          actual_price: '95.00',
          discount: '5.00',
          discount_type: 'CPP_ON',
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.invoiceDate).toBeUndefined();
      expect(rows[0].parseErrors).toEqual([
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure({
            ok: false,
            reason: 'LEAP_BUG_DAY',
            input: 60,
          }),
        },
      ]);
    });

    // T-126: `fiscal_period` is the deliberate exception — a broken
    // fiscal_period STILL throws out of `mapToEntryDtos` (unlike every
    // other field in this row). See the asymmetry-pin block at the bottom
    // of this file for the full contrast with off-invoice.
    it('a row with an unreadable fiscal_period still throws — unaffected by T-126, unlike every other field in this row', () => {
      expect(() =>
        mapToEntryDtos([
          {
            customer_code: 'CUST-1',
            invoice_no: 'INV-1',
            invoice_date: '2026-01-15',
            fiscal_period: 'çöp',
            sku_code: 'SKU-1',
            quantity: '10',
            list_price: '100.00',
            actual_price: '95.00',
            discount: '5.00',
            discount_type: 'CPP_ON',
          },
        ]),
      ).toThrow(BadRequestException);
    });
  });

  /**
   * T-107 adım 2 — public surface (`parseExcel`), real `.xlsx` buffers,
   * `raw: true` live.
   */
  describe('T-107 adım 2 — public surface (parseExcel), raw: true', () => {
    function buildXlsxFile(rows: unknown[][]): Express.Multer.File {
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer;
      return {
        originalname: 'on-invoice.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
        size: buffer.length,
        fieldname: 'file',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: null as unknown as Express.Multer.File['stream'],
      };
    }

    it('a real 0 quantity under the FIRST alias (quantity) and a real 0 discount under the LAST alias (DISCOUNT) both survive through parseExcel', async () => {
      const file = buildXlsxFile([
        [
          'customer_code',
          'invoice_no',
          'invoice_date',
          'fiscal_period',
          'sku_code',
          'quantity',
          'list_price',
          'actual_price',
          'DISCOUNT',
          'discount_type',
        ],
        [
          'CUST-1',
          'INV-1',
          '2026-01-15',
          '2026-01',
          'SKU-1',
          0,
          100,
          95,
          0,
          'CPP_ON',
        ],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.quantity).toBe(0);
      expect(rows[0].dto.discount).toBe(0);
      expect(rows[0].parseErrors).toBeUndefined();
    });

    it('a numeric invoice_date cell (Excel serial) resolves via parseExcel end-to-end, not just the private method', async () => {
      const file = buildXlsxFile([
        [
          'customer_code',
          'invoice_no',
          'invoice_date',
          'fiscal_period',
          'sku_code',
          'quantity',
          'list_price',
          'actual_price',
          'discount',
          'discount_type',
        ],
        [
          'CUST-1',
          'INV-1',
          46037, // 2026-01-15
          '2026-01',
          'SKU-1',
          10,
          100,
          95,
          5,
          'CPP_ON',
        ],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.invoiceDate).toBe('2026-01-15');
    });

    it('a #,##0-formatted quantity cell is read as the underlying number, not rejected (T-105 regression closed)', async () => {
      const worksheet = XLSX.utils.aoa_to_sheet([
        [
          'customer_code',
          'invoice_no',
          'invoice_date',
          'fiscal_period',
          'sku_code',
          'quantity',
          'list_price',
          'actual_price',
          'discount',
          'discount_type',
        ],
        [
          'CUST-1',
          'INV-1',
          '2026-01-15',
          '2026-01',
          'SKU-1',
          7250,
          100,
          95,
          5,
          'CPP_ON',
        ],
      ]);
      (worksheet['F2'] as { z?: string }).z = '#,##0';
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer;
      const file: Express.Multer.File = {
        originalname: 'on-invoice.xlsx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
        size: buffer.length,
        fieldname: 'file',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: null as unknown as Express.Multer.File['stream'],
      };

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.quantity).toBe(7250);
    });

    // §2.5's third state: the FILE itself is malformed (no data rows), not a
    // single cell — still a file-level rejection, unchanged by T-126.
    it('a file with a header row but zero data rows is still a file-level rejection, unaffected by the per-row parseErrors channel', async () => {
      const file = buildXlsxFile([
        [
          'customer_code',
          'invoice_no',
          'invoice_date',
          'fiscal_period',
          'sku_code',
          'quantity',
          'list_price',
          'actual_price',
          'discount',
          'discount_type',
        ],
      ]);

      await expect(service.parseExcel(file)).rejects.toThrow(
        BadRequestException,
      );
    });

    // T-126: `discount_type` used to throw straight out of the batch on an
    // unrecognized code. Now the row survives with a parseErrors entry.
    it('an unrecognized discount_type does not reject the file — the row survives with a parseErrors entry', async () => {
      const file = buildXlsxFile([
        [
          'customer_code',
          'invoice_no',
          'invoice_date',
          'fiscal_period',
          'sku_code',
          'quantity',
          'list_price',
          'actual_price',
          'discount',
          'discount_type',
        ],
        [
          'CUST-1',
          'INV-1',
          '2026-01-15',
          '2026-01',
          'SKU-1',
          10,
          100,
          95,
          5,
          'NOT_A_REAL_TYPE',
        ],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.discountType).toBeUndefined();
      expect(rows[0].parseErrors).toHaveLength(1);
      expect(rows[0].parseErrors![0].field).toBe('discount_type');
      expect(rows[0].parseErrors![0].error_type).toBe('INVALID_ENUM');
    });
  });
});

/**
 * T-107 adım 2 review (B1) — public surface (`parseCSV`), real CSV text.
 */
describe('OnInvoiceFileParserService — parseCSV public surface (T-107 adım 2 review, B1)', () => {
  let service: OnInvoiceFileParserService;

  beforeEach(() => {
    service = new OnInvoiceFileParserService();
  });

  function buildCsvFile(text: string): Express.Multer.File {
    return {
      originalname: 'on-invoice.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from(text, 'utf-8'),
      size: Buffer.byteLength(text, 'utf-8'),
      fieldname: 'file',
      encoding: '7bit',
      destination: '',
      filename: '',
      path: '',
      stream: null as unknown as Express.Multer.File['stream'],
    };
  }

  const HEADER =
    'customer_code,invoice_no,invoice_date,fiscal_period,sku_code,quantity,list_price,actual_price,discount,discount_type';
  const GOOD_ROW =
    'CUST-1,INV-1,2026-01-15,2026-01,SKU-1,100,185.00,162.80,2220.00,CPP_ON';
  const BLANK_ROW = ',,,,,,,,,';

  it('a `,,,` blank CSV row in the middle does not take the whole file down — the good rows around it still import', async () => {
    const file = buildCsvFile(
      `${HEADER}\n${GOOD_ROW}\n${BLANK_ROW}\n${GOOD_ROW}\n`,
    );

    const rows = await service.parseCSV(file);

    expect(rows).toHaveLength(2);
    expect(rows[0].dto.customerCode).toBe('CUST-1');
    expect(rows[1].dto.customerCode).toBe('CUST-1');
  });

  it('a lone `,,,` blank CSV row (no good rows) does not throw — it is filtered to an empty result, not a file-level rejection', async () => {
    const file = buildCsvFile(`${HEADER}\n${BLANK_ROW}\n`);

    const rows = await service.parseCSV(file);

    expect(rows).toHaveLength(0);
  });
});

/**
 * T-107 adım 2 review (S2) — `originalRowData` must not leak XLSX's `null`
 * blank-cell sentinel to a caller reading the per-row error payload.
 */
describe('OnInvoiceFileParserService — originalRowData has no leaked null (T-107 adım 2 review, S2)', () => {
  let service: OnInvoiceFileParserService;

  beforeEach(() => {
    service = new OnInvoiceFileParserService();
  });

  it('a blank cell surfaces in originalRowData as undefined/omitted, never the literal null', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        'customer_code',
        'invoice_no',
        'invoice_date',
        'fiscal_period',
        'sku_code',
        'quantity',
        'list_price',
        'actual_price',
        'discount',
        'discount_type',
        'currency',
      ],
      [
        'CUST-1',
        'INV-1',
        '2026-01-15',
        '2026-01',
        'SKU-1',
        100,
        185.0,
        162.8,
        2220.0,
        'CPP_ON',
        null, // currency: genuinely blank cell
      ],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;
    const file: Express.Multer.File = {
      originalname: 'on-invoice.xlsx',
      mimetype:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
      size: buffer.length,
      fieldname: 'file',
      encoding: '7bit',
      destination: '',
      filename: '',
      path: '',
      stream: null as unknown as Express.Multer.File['stream'],
    };

    const rows = await service.parseExcel(file);

    expect(rows).toHaveLength(1);
    const originalRowData = rows[0].originalRowData!;
    expect(Object.values(originalRowData)).not.toContain(null);
    expect(originalRowData.currency).toBeUndefined();
  });
});

/**
 * T-123 / T-126 — wiring tests for the STRING branch of `getDateValue` in
 * THIS file, routed through `date-text.ts` instead of `new Date(str)`.
 * Companion to the numeric (excel-serial) wiring block above and to
 * `date-text.spec.ts` (T-121), which owns the grammar/calendar math itself
 * — not re-tested here (§2.7).
 */
describe('OnInvoiceFileParserService — date-text string-branch wiring (T-123 / T-126)', () => {
  let service: OnInvoiceFileParserService;

  beforeEach(() => {
    service = new OnInvoiceFileParserService();
  });

  const getDateValue = (
    value: unknown,
    field = 'invoice_date',
  ): { value: string | undefined; errors: FieldParseError[] } => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as {
        getDateValue(
          v: unknown,
          f: string,
          e: FieldParseError[],
        ): string | undefined;
      }
    ).getDateValue(value, field, errors);
    return { value: result, errors };
  };

  // Still single-argument, still throws — see the file header.
  const getFiscalPeriod = (value: unknown): string =>
    (
      service as unknown as { getFiscalPeriod(v: unknown): string }
    ).getFiscalPeriod(value);

  describe('getDateValue — string branch, OK path', () => {
    it('GG.AA.YYYY ("3.4.2026") resolves to 3 Nisan (2026-04-03), not the old US-order guess (2026-03-04)', () => {
      expect(getDateValue('3.4.2026').value).toBe('2026-04-03');
    });

    it('a zero-padded Turkish date ("15.01.2026") is accepted and correct', () => {
      expect(getDateValue('15.01.2026').value).toBe('2026-01-15');
    });

    it('an ISO date string passes through unchanged', () => {
      expect(getDateValue('2026-01-15').value).toBe('2026-01-15');
    });
  });

  describe('getDateValue — string branch, present-but-unreadable is collected, never thrown, never silently accepted', () => {
    it('US slash order ("3/4/26") is collected as an error, not silently accepted as March 4th', () => {
      const { value, errors } = getDateValue('3/4/26', 'invoice_date');
      expect(value).toBeUndefined();
      expect(errors).toEqual([
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: describeDateTextFailure({
            ok: false,
            reason: 'UNRECOGNIZED_FORMAT',
            input: '3/4/26',
          }),
        },
      ]);
    });

    it('a calendar rollover ("2026-02-30") is collected as an error, not silently rolled into March', () => {
      const { value, errors } = getDateValue('2026-02-30');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].error_message).toContain('2026-02-30');
    });

    it('an out-of-range month ("2026-13-01") is collected as an error', () => {
      const { value, errors } = getDateValue('2026-13-01');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
    });

    // The six shapes the task body calls out as "previously read correctly"
    // under the pre-T-121 `new Date(str)` implementation — pinned here as
    // the "asıl kazanç": they now produce a row-level error, never a silent
    // fallback.
    it.each([
      '2026/01',
      '2026-1',
      '2026-01-15 00:00:00',
      '2026/01/15',
      '01/15/2026',
      'Jan 2026',
    ])(
      'previously-silently-accepted-or-dropped shape %p is now a row-level parseErrors entry, not a silent fallback',
      (input) => {
        const { value, errors } = getDateValue(input, 'invoice_date');
        expect(value).toBeUndefined();
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('invoice_date');
        expect(errors[0].error_type).toBe('INVALID_DATE');
      },
    );

    it('the thrown-equivalent message for a rejected string is exactly what describeDateTextFailure produces, not a locally reworded copy', () => {
      const { errors } = getDateValue('3/4/26');
      expect(errors[0].error_message).toBe(
        describeDateTextFailure({
          ok: false,
          reason: 'UNRECOGNIZED_FORMAT',
          input: '3/4/26',
        }),
      );
    });
  });

  describe('getFiscalPeriod — string branch (full date text, truncated to YYYY-MM by this file; unchanged by T-126 — still throws)', () => {
    it('GG.AA.YYYY ("3.4.2026") resolves to 2026-04, not the old guess 2026-03', () => {
      expect(getFiscalPeriod('3.4.2026')).toBe('2026-04');
    });

    it('a zero-padded Turkish date ("15.01.2026") truncates to 2026-01', () => {
      expect(getFiscalPeriod('15.01.2026')).toBe('2026-01');
    });

    it('a full ISO date string truncates to YYYY-MM', () => {
      expect(getFiscalPeriod('2026-01-15')).toBe('2026-01');
    });

    it('US slash order ("3/4/26") is refused — on-invoice.getFiscalPeriod THROWS on an unparseable full-date string (see the asymmetry-pin block below for why off-invoice does not)', () => {
      expect(() => getFiscalPeriod('3/4/26')).toThrow(BadRequestException);
    });

    it('a calendar rollover ("2026-02-30") is refused, not silently rolled into March', () => {
      expect(() => getFiscalPeriod('2026-02-30')).toThrow(BadRequestException);
    });

    it('an out-of-range month ("2026-13-01") is refused', () => {
      expect(() => getFiscalPeriod('2026-13-01')).toThrow(BadRequestException);
    });
  });

  describe('end-to-end via mapToEntryDtos — string-branch date reaches the DTO (T-123)', () => {
    const mapToEntryDtos = (
      rows: unknown[],
    ): Array<{ dto: Record<string, unknown> }> =>
      (
        service as unknown as {
          mapToEntryDtos(
            rows: unknown[],
          ): Array<{ dto: Record<string, unknown> }>;
        }
      ).mapToEntryDtos(rows);

    it('a row with a Turkish-format string invoice_date/fiscal_period reaches the DTO with the correct ISO values (3 Nisan, not 4 Mart)', () => {
      const rows = mapToEntryDtos([
        {
          customer_code: 'CUST-1',
          invoice_no: 'INV-1',
          invoice_date: '3.4.2026',
          fiscal_period: '3.4.2026',
          sku_code: 'SKU-1',
          quantity: '10',
          list_price: '100.00',
          actual_price: '95.00',
          discount: '5.00',
          discount_type: 'CPP_ON',
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.invoiceDate).toBe('2026-04-03');
      expect(rows[0].dto.fiscalPeriod).toBe('2026-04');
    });

    // Contrast with off-invoice's row-level channel: on-invoice's throw for
    // a broken fiscal_period string still rejects the WHOLE FILE — this
    // file's design was NOT changed by T-126, only off-invoice's was
    // (product owner decision, 2026-08-10, gerekçe: off-invoice has a
    // fallback chain for a missing period, on-invoice does not — see
    // `getFiscalPeriod`'s own doc comment).
    it('a broken fiscal_period string on one row still rejects the WHOLE FILE here — unlike off-invoice (deliberate asymmetry, unaffected by T-126)', () => {
      expect(() =>
        mapToEntryDtos([
          {
            customer_code: 'CUST-1',
            invoice_no: 'INV-1',
            invoice_date: '2026-01-15',
            fiscal_period: 'çöp',
            sku_code: 'SKU-1',
            quantity: '10',
            list_price: '100.00',
            actual_price: '95.00',
            discount: '5.00',
            discount_type: 'CPP_ON',
          },
        ]),
      ).toThrow(BadRequestException);
    });
  });
});

/**
 * T-123 / T-126 — the on-invoice / off-invoice `getFiscalPeriod` asymmetry,
 * pinned SIDE BY SIDE so the difference is visible in a single assertion
 * block and a future editor does not "fix" it into a false consistency.
 * DELIBERATE, per both services' own doc comments:
 *
 *   - `on-invoice.service.ts` has no fallback for a missing fiscal period
 *     (`if (!fiscalPeriod) throw`) AND reads `parsedRows[0]?.dto.fiscalPeriod`
 *     to CREATE the batch before row-level validation ever runs
 *     (`on-invoice.service.ts:82-87`) -> `getFiscalPeriod` stays
 *     single-argument and THROWS.
 *   - `agreement-transaction.service.ts:109-119` falls back, in priority
 *     order, to `agreement.periodMonth` and then to a period derived from
 *     `invoiceDate` -> the field is genuinely OPTIONAL for off-invoice, so
 *     `OffInvoiceFileParserService.getFiscalPeriod` takes the
 *     `(value, field, errors)` shape and resolves a present-but-unparseable
 *     string to `undefined` plus a row-level `parseErrors` entry instead
 *     (T-123 retraction + T-126).
 *
 * Same broken input, same failure mode (UNRECOGNIZED_FORMAT), two different
 * — and both correct, for their own service — outcomes.
 */
describe('getFiscalPeriod asymmetry — on-invoice throws, off-invoice collects into parseErrors (T-123 / T-126, pinned side by side)', () => {
  it('the identical broken fiscal_period string ("çöp") is thrown by OnInvoiceFileParserService.getFiscalPeriod but collected (not thrown) by OffInvoiceFileParserService.getFiscalPeriod', () => {
    const onService = new OnInvoiceFileParserService();
    const offService = new OffInvoiceFileParserService();
    const onGetFiscalPeriod = (value: unknown): string =>
      (
        onService as unknown as { getFiscalPeriod(v: unknown): string }
      ).getFiscalPeriod(value);
    const offGetFiscalPeriod = (
      value: unknown,
      field: string,
      errors: FieldParseError[],
    ): string | undefined =>
      (
        offService as unknown as {
          getFiscalPeriod(
            v: unknown,
            f: string,
            e: FieldParseError[],
          ): string | undefined;
        }
      ).getFiscalPeriod(value, field, errors);

    expect(() => onGetFiscalPeriod('çöp')).toThrow(BadRequestException);

    const offErrors: FieldParseError[] = [];
    expect(
      offGetFiscalPeriod('çöp', 'fiscal_period', offErrors),
    ).toBeUndefined();
    expect(offErrors).toHaveLength(1);

    // Same pairing, with a different broken shape (US slash order), to show
    // this is not an accident of one specific bad string.
    expect(() => onGetFiscalPeriod('3/4/26')).toThrow(BadRequestException);
    const offErrors2: FieldParseError[] = [];
    expect(
      offGetFiscalPeriod('3/4/26', 'fiscal_period', offErrors2),
    ).toBeUndefined();
    expect(offErrors2).toHaveLength(1);
  });
});
