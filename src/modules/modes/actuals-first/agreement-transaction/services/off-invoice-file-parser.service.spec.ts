import { BadRequestException } from '@nestjs/common';
import { OffInvoiceFileParserService } from './off-invoice-file-parser.service';
import { describeExcelSerialDateFailure } from '../../../../../common/date/excel-serial-date';
import { describeDateTextFailure } from '../../../../../common/date/date-text';
import { FieldParseError } from '../../../../../common/row-parsing/field-parse-error';
import * as XLSX from 'xlsx';

/**
 * T-107 adım 1 — wiring tests for the two call sites in THIS file
 * (`getDateValue`, `getFiscalPeriod`). See `on-invoice-file-parser.service.spec.ts`
 * for why the shared math is not re-tested here.
 *
 * T-126 REWRITE (2026-08-10): `getDateValue`/`getNumberValue`/`getFiscalPeriod`
 * used to THROW `BadRequestException` for a present-but-unreadable cell, which
 * `mapToTransactionDtos`'s single `.map()` and `parseExcel`/`parseCSV`'s own
 * try/catch turned into a FILE-LEVEL rejection with no row number (measured,
 * T-123: a single bad `invoice_date` cell anywhere in a 500-row file rejected
 * the whole upload). All three now take a fourth/third `errors:
 * FieldParseError[]` parameter and COLLECT into it instead of throwing —
 * mirroring the identical contract change `customer/services/file-parser.service.ts`
 * went through first (T-121 review (a)) and `field-parse-error.ts` now shares
 * (T-126). §2.5 is still satisfied: a present-but-unreadable value is never
 * silently treated as absent — it still produces an error, just not a thrown
 * one, and `OffInvoiceValidationService.validateRow` folds it into the SAME
 * row-level `ValidationError` channel every other check already uses. The old
 * `.toThrow(BadRequestException)` assertions this file used to make are gone
 * on purpose, not by omission — see that service's own spec for the
 * validateRow-side half of this contract.
 */
describe('OffInvoiceFileParserService — excel-serial-date wiring (T-107 adım 1 / T-126)', () => {
  let service: OffInvoiceFileParserService;

  beforeEach(() => {
    service = new OffInvoiceFileParserService();
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

  const getFiscalPeriod = (
    value: unknown,
    field = 'fiscal_period',
  ): { value: string | undefined; errors: FieldParseError[] } => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as {
        getFiscalPeriod(
          v: unknown,
          f: string,
          e: FieldParseError[],
        ): string | undefined;
      }
    ).getFiscalPeriod(value, field, errors);
    return { value: result, errors };
  };

  describe('getDateValue — numeric (Excel serial) branch', () => {
    it('a numeric cell value is handed to the shared helper and its ISO date returned unchanged, no error pushed', () => {
      const { value, errors } = getDateValue(46037);
      expect(value).toBe('2026-01-15');
      expect(errors).toHaveLength(0);
    });

    it('a NOT_FINITE input (Infinity) is collected as an INVALID_DATE error, value is undefined — not thrown', () => {
      const { value, errors } = getDateValue(Infinity);
      expect(value).toBeUndefined();
      expect(errors).toEqual([
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure({
            ok: false,
            reason: 'NOT_FINITE',
            input: Infinity,
          }),
        },
      ]);
    });

    // 0 is a number, not the "absent" sentinel — must reach the helper and be
    // collected as NON_POSITIVE, not treated as if the field had never been
    // given (which would return undefined with ZERO errors).
    it('numeric 0 is collected via the helper, not treated as absent', () => {
      const { value, errors } = getDateValue(0);
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

    // T-126: a value too large to be a representable `Date` used to escape as
    // a raw `RangeError` from `excelSerialToIsoDate` itself (see that
    // module's own spec) — asserted here too, at this call site, since it is
    // this getter that would have propagated the crash before the upstream
    // fix.
    it('a value too large to be a representable Date is refused as OUT_OF_RANGE, not a crash', () => {
      expect(() => getDateValue(99999999999)).not.toThrow();
      const { value, errors } = getDateValue(99999999999);
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].error_type).toBe('INVALID_DATE');
    });

    // §2.5's three-way split, pinned explicitly at this call site: a
    // genuinely ABSENT value (never given) is not the same as a PRESENT but
    // unreadable one — only the latter produces an error.
    // T-126 review (B1): `''` and `'   '` MUST produce the identical result
    // — pinned side by side in the SAME test (not two separate `it`s) so a
    // regression back to the naive `value === ''` check shows up as a
    // divergence between two cases in one assertion block, not as one lone
    // red test elsewhere that a reader has to correlate by hand. Before the
    // fix, `'   '` fell through into `parseDateText`'s own `EMPTY` result and
    // pushed a row-level `INVALID_DATE` error ("Tarih değeri boş.") that the
    // literal `''` case right next to it never got — see `pick-cell.ts`'s
    // `isBlankCellValue` doc for the measured repro.
    describe('genuinely absent input — the only case with zero errors AND an undefined value', () => {
      it.each([null, undefined, '', '   '])(
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

  describe('getFiscalPeriod — numeric (Excel serial) branch', () => {
    it('a numeric cell value is converted via the shared helper and truncated to YYYY-MM, no error pushed', () => {
      const { value, errors } = getFiscalPeriod(46037);
      expect(value).toBe('2026-01');
      expect(errors).toHaveLength(0);
    });

    it('a DST-boundary serial converts correctly', () => {
      const { value, errors } = getFiscalPeriod(46320);
      expect(value).toBe('2026-10');
      expect(errors).toHaveLength(0);
    });

    it('a refused serial is collected as an error, not silently dropped as "undefined = absent"', () => {
      const { value, errors } = getFiscalPeriod(60, 'fiscal_period');
      expect(value).toBeUndefined();
      expect(errors).toEqual([
        {
          field: 'fiscal_period',
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure({
            ok: false,
            reason: 'LEAP_BUG_DAY',
            input: 60,
          }),
        },
      ]);
    });
  });

  /**
   * T-126 review (B1) — `getNumberValue` was already trim-aware BEFORE this
   * fix (it delegates straight to `parseNumericText`, which trims — see
   * `pick-cell.ts`'s `isBlankCellValue` doc, this getter is the one NOT
   * listed among the naive-`=== ''` sites). Pinned here anyway, side by side
   * with the broken getters above, so the CONTRAST itself is on record: not
   * every getter in this file carried the bug, and a reader should not
   * assume a fix here was needed to know it already worked.
   */
  describe('getNumberValue — blank input, "" and "   " already agree (delegates to parseNumericText, which trims)', () => {
    const getNumberValue = (
      value: unknown,
      field = 'amount',
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

    it.each(['', '   '])(
      '%p returns undefined with NO error pushed',
      (v) => {
        const { value, errors } = getNumberValue(v);
        expect(value).toBeUndefined();
        expect(errors).toHaveLength(0);
      },
    );

    it("'' and '   ' produce the IDENTICAL result", () => {
      expect(getNumberValue('   ')).toEqual(getNumberValue(''));
      expect(getNumberValue('')).toEqual({ value: undefined, errors: [] });
    });
  });

  describe('end-to-end from a parsed row to the final DTO/fiscal period (mapToTransactionDtos)', () => {
    const mapToTransactionDtos = (
      rows: unknown[],
    ): Array<{
      dto: Record<string, unknown>;
      fiscalPeriod: string | undefined;
      parseErrors?: FieldParseError[];
    }> =>
      (
        service as unknown as {
          mapToTransactionDtos(rows: unknown[]): Array<{
            dto: Record<string, unknown>;
            fiscalPeriod: string | undefined;
            parseErrors?: FieldParseError[];
          }>;
        }
      ).mapToTransactionDtos(rows);

    it('a row with a numeric invoice_date and fiscal_period reaches the output with correct ISO values, no parseErrors', () => {
      const rows = mapToTransactionDtos([
        {
          agreement_id: 'AGR-1',
          invoice_no: 'INV-1',
          invoice_date: 46037, // 2026-01-15
          amount: '100.00',
          fiscal_period: 46037, // -> 2026-01
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.invoiceDate).toBe('2026-01-15');
      expect(rows[0].fiscalPeriod).toBe('2026-01');
      expect(rows[0].parseErrors).toBeUndefined();
    });

    // T-126: this is the closed regression. Before this turn, an unreadable
    // numeric invoice_date threw straight out of `mapToTransactionDtos`'s
    // `.map()`, taking the WHOLE FILE down with it. Now the row survives
    // with a row-level `parseErrors` entry.
    it('a row with an unreadable numeric date is NOT thrown out of the batch — it survives with a parseErrors entry (§2.5, T-126)', () => {
      const rows = mapToTransactionDtos([
        {
          agreement_id: 'AGR-1',
          invoice_no: 'INV-1',
          invoice_date: 60, // Excel's fictitious 1900-02-29
          amount: '100.00',
          fiscal_period: '2026-01',
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
  });

  /**
   * T-107 adım 2 — public surface (`parseExcel`), real `.xlsx` buffers,
   * `raw: true` live. `amount` is the field `pickCell` protects here (a real
   * `0` amount reaching `getNumberValue` at all, distinct from a non-last
   * alias silently resolving it to `undefined`).
   *
   * T-126: the parser's own `getNumberValue` no longer enforces positivity —
   * that moved to `OffInvoiceValidationService.validateRow` (its own spec
   * pins the business rule; out of scope here per the task's own boundary —
   * see [[T-124]]). What THIS test proves is narrower: a genuine `0` reaches
   * `dto.amount` unchanged, with no `parseErrors` entry (it parsed fine —
   * positivity is a MEANING question, not a parsing one).
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
        originalname: 'off-invoice.xlsx',
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

    it('a real 0 amount under the LAST alias (AMOUNT) reaches dto.amount unchanged, not silently dropped as absent', async () => {
      const file = buildXlsxFile([
        [
          'agreement_id',
          'invoice_no',
          'invoice_date',
          'AMOUNT',
          'fiscal_period',
        ],
        ['AGR-1', 'INV-1', '2026-01-15', 0, '2026-01'],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.amount).toBe(0);
      expect(rows[0].parseErrors).toBeUndefined();
    });

    // MEASURED (T-107 adım 2 review, B4 — `pickCell` mutated back to an
    // `a || b || c` chain): the LAST-alias case above does not distinguish
    // `pickCell` from `||` (see its own comment) — this does. `amount` is
    // the FIRST of three aliases with the other two absent, so under `||`
    // the real `0` is overridden by a later, merely-absent alias
    // (`0 || undefined || undefined` = `undefined`).
    it('a real 0 amount under the FIRST alias (amount) reaches dto.amount unchanged, not silently dropped as absent', async () => {
      const file = buildXlsxFile([
        [
          'agreement_id',
          'invoice_no',
          'invoice_date',
          'amount',
          'fiscal_period',
        ],
        ['AGR-1', 'INV-1', '2026-01-15', 0, '2026-01'],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.amount).toBe(0);
      expect(rows[0].parseErrors).toBeUndefined();
    });

    it('a numeric invoice_date cell (Excel serial) resolves via parseExcel end-to-end, not just the private method', async () => {
      const file = buildXlsxFile([
        [
          'agreement_id',
          'invoice_no',
          'invoice_date',
          'amount',
          'fiscal_period',
        ],
        ['AGR-1', 'INV-1', 46037, 100, '2026-01'],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.invoiceDate).toBe('2026-01-15');
    });

    // §2.5's third state, distinct from the two the getters above cover: the
    // FILE itself is malformed (no data rows at all), not a single cell.
    // That is still a file-level rejection, deliberately unchanged by T-126
    // — there is no row to attach a per-row error to.
    it('a file with a header row but zero data rows is still a file-level rejection, unaffected by the per-row parseErrors channel', async () => {
      const file = buildXlsxFile([
        [
          'agreement_id',
          'invoice_no',
          'invoice_date',
          'amount',
          'fiscal_period',
        ],
      ]);

      await expect(service.parseExcel(file)).rejects.toThrow(
        BadRequestException,
      );
    });

    // T-126: the file used to reject entirely on an unparseable amount cell
    // (the old `getNumberValue` threw). Now the row survives, reported.
    it('an unparseable amount cell (garbage text) does not reject the file — the row survives with a parseErrors entry', async () => {
      const file = buildXlsxFile([
        [
          'agreement_id',
          'invoice_no',
          'invoice_date',
          'amount',
          'fiscal_period',
        ],
        ['AGR-1', 'INV-1', '2026-01-15', 'çöp', '2026-01'],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.amount).toBeUndefined();
      expect(rows[0].parseErrors).toHaveLength(1);
      expect(rows[0].parseErrors![0].field).toBe('amount');
    });
  });
});

/**
 * T-107 adım 2 review (B1) — public surface (`parseCSV`), real CSV text.
 * `csv-parser`'s blank-cell value is `''`, never XLSX's `null`/`undefined`
 * sentinel — a `,,,,,,` row (every aliased column resolves to `''`) used to
 * survive the old `pickCell(...) !== undefined` blank-row filter (`'' !==
 * undefined`) and hit `getDateValue`, which threw on `value === ''`, taking
 * the WHOLE FILE down. `hasCellValue` is the fix; this is its only
 * public-surface (`parseCSV`) coverage for this importer.
 */
describe('OffInvoiceFileParserService — parseCSV public surface (T-107 adım 2 review, B1)', () => {
  let service: OffInvoiceFileParserService;

  beforeEach(() => {
    service = new OffInvoiceFileParserService();
  });

  function buildCsvFile(text: string): Express.Multer.File {
    return {
      originalname: 'off-invoice.csv',
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
    'agreement_id,invoice_no,invoice_date,fiscal_period,amount,description';
  const GOOD_ROW = 'AGR-1,INV-1,2026-01-15,2026-01,7250.00,Q1 Settlement';
  const BLANK_ROW = ',,,,,';

  it('a `,,,` blank CSV row in the middle does not take the whole file down — the good rows around it still import', async () => {
    const file = buildCsvFile(
      `${HEADER}\n${GOOD_ROW}\n${BLANK_ROW}\n${GOOD_ROW}\n`,
    );

    const rows = await service.parseCSV(file);

    expect(rows).toHaveLength(2);
    expect(rows[0].dto.agreementId).toBe('AGR-1');
    expect(rows[1].dto.agreementId).toBe('AGR-1');
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
describe('OffInvoiceFileParserService — originalRowData has no leaked null (T-107 adım 2 review, S2)', () => {
  let service: OffInvoiceFileParserService;

  beforeEach(() => {
    service = new OffInvoiceFileParserService();
  });

  it('a blank cell surfaces in originalRowData as undefined/omitted, never the literal null', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        'agreement_id',
        'invoice_no',
        'invoice_date',
        'fiscal_period',
        'amount',
        'description',
        'currency',
      ],
      [
        'AGR-1',
        'INV-1',
        '2026-01-15',
        '2026-01',
        7250.0,
        'Q1 Settlement',
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
      originalname: 'off-invoice.xlsx',
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
 * T-123 / T-126 — wiring tests for the STRING branch of `getDateValue` /
 * `getFiscalPeriod` in THIS file, routed through `date-text.ts` instead of
 * `new Date(str)`. Companion to the numeric (excel-serial) wiring block
 * above and to `date-text.spec.ts` (T-121), which owns the grammar/calendar
 * math itself — not re-tested here (§2.7).
 */
describe('OffInvoiceFileParserService — date-text string-branch wiring (T-123 / T-126)', () => {
  let service: OffInvoiceFileParserService;

  beforeEach(() => {
    service = new OffInvoiceFileParserService();
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

  const getFiscalPeriod = (
    value: unknown,
    field = 'fiscal_period',
  ): { value: string | undefined; errors: FieldParseError[] } => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as {
        getFiscalPeriod(
          v: unknown,
          f: string,
          e: FieldParseError[],
        ): string | undefined;
      }
    ).getFiscalPeriod(value, field, errors);
    return { value: result, errors };
  };

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

  /**
   * T-126: present-but-unreadable string dates now COLLECT into `errors`
   * instead of throwing (this file no longer takes the whole batch down on
   * one bad cell — see the `mapToTransactionDtos` describe block below).
   * Also pins the six shapes the Team Lead's task body called out as
   * "previously read correctly" under the pre-T-121 `new Date(str)`
   * implementation and now correctly REJECTED by the strict grammar
   * (`date-text.ts`) — never silently guessed, never silently fallen back.
   */
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

    // The six shapes the old `new Date(str)` branch happened to parse
    // (correctly or not) before T-121/T-123 introduced the strict grammar —
    // pinned here as the "asıl kazanç" the task body calls out: they must
    // now produce a ROW-LEVEL error, never a silent fallback and never a
    // throw that rejects the whole file.
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
  });

  describe('getFiscalPeriod — OK path: a parseable full-date string still truncates to YYYY-MM', () => {
    it('GG.AA.YYYY ("3.4.2026") resolves to 2026-04, not the old guess 2026-03', () => {
      expect(getFiscalPeriod('3.4.2026').value).toBe('2026-04');
    });

    it('a zero-padded Turkish date ("15.01.2026") truncates to 2026-01', () => {
      expect(getFiscalPeriod('15.01.2026').value).toBe('2026-01');
    });

    it('a full ISO date string truncates to YYYY-MM', () => {
      expect(getFiscalPeriod('2026-01-15').value).toBe('2026-01');
    });

    it('a plain YYYY-MM string is accepted directly (checked before the date-text branch is ever reached)', () => {
      expect(getFiscalPeriod('2026-04').value).toBe('2026-04');
    });
  });

  /**
   * T-123 madde 3, RETRACTED (product owner decision, 2026-08-10) — see the
   * long rationale in `off-invoice-file-parser.service.ts`'s `getFiscalPeriod`
   * doc comment: this field is genuinely OPTIONAL (the caller has a 3-level
   * fallback chain), so a present-but-unparseable cell resolves to
   * `undefined` rather than rejecting the row's fiscal period outright.
   *
   * T-126 UPDATE to that pin: the retraction is about the RETURN VALUE
   * (`undefined`, never a guessed period) — it does NOT mean "no trace". A
   * present-but-unreadable cell now ALSO pushes a row-level `parseErrors`
   * entry, closing the T-123 retraction's own silent gap (measured then:
   * `errors` did not exist yet, so this state produced neither a throw nor
   * an error — pure silence, unlike a genuinely absent cell, which still
   * produces neither).
   */
  describe('getFiscalPeriod — present-but-unparseable resolves to undefined AND records a parseError (T-123 retraction + T-126)', () => {
    // T-126 review (B1): `'   '` joins `''`/`null`/`undefined` in the SAME
    // loop, and a dedicated identity assertion follows — before the fix, a
    // whitespace-only cell fell through into `parseDateText`'s own `EMPTY`
    // result and pushed a row-level `INVALID_DATE` error the literal `''`
    // case never got (see `pick-cell.ts`'s `isBlankCellValue` doc).
    it('a genuinely absent cell resolves to undefined with NO error (legitimate optionality, unaffected by T-123 either way)', () => {
      for (const v of ['', '   ', null, undefined]) {
        const { value, errors } = getFiscalPeriod(v);
        expect(value).toBeUndefined();
        expect(errors).toHaveLength(0);
      }
    });

    it("'' and '   ' produce the IDENTICAL result (T-126 review B1)", () => {
      expect(getFiscalPeriod('   ')).toEqual(getFiscalPeriod(''));
      expect(getFiscalPeriod('')).toEqual({ value: undefined, errors: [] });
    });

    it('a present-but-garbage cell ("çöp") resolves to undefined AND pushes a parseErrors entry', () => {
      const { value, errors } = getFiscalPeriod('çöp', 'fiscal_period');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('fiscal_period');
      expect(errors[0].error_type).toBe('INVALID_DATE');
      expect(errors[0].error_message).toContain('çöp');
    });

    it('a present-but-US-order cell ("3/4/26") resolves to undefined AND pushes a parseErrors entry', () => {
      const { value, errors } = getFiscalPeriod('3/4/26');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
    });

    it('a present-but-calendar-invalid cell ("2026-02-30", a rollover) resolves to undefined AND pushes a parseErrors entry', () => {
      const { value, errors } = getFiscalPeriod('2026-02-30');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
    });
  });

  describe('end-to-end via mapToTransactionDtos — a broken fiscal_period or invoice_date cell does not drop its row or reject the file (T-123 retraction + T-126)', () => {
    const mapToTransactionDtos = (
      rows: unknown[],
    ): Array<{
      dto: Record<string, unknown>;
      fiscalPeriod: string | undefined;
      parseErrors?: FieldParseError[];
    }> =>
      (
        service as unknown as {
          mapToTransactionDtos(rows: unknown[]): Array<{
            dto: Record<string, unknown>;
            fiscalPeriod: string | undefined;
            parseErrors?: FieldParseError[];
          }>;
        }
      ).mapToTransactionDtos(rows);

    it('a broken fiscal_period cell on one row does not drop that row and does not reject the file — the sibling row is unaffected', () => {
      const rows = mapToTransactionDtos([
        {
          agreement_id: 'AGR-1',
          invoice_no: 'INV-1',
          invoice_date: '2026-01-15',
          amount: '100.00',
          fiscal_period: 'çöp',
        },
        {
          agreement_id: 'AGR-2',
          invoice_no: 'INV-2',
          invoice_date: '2026-01-16',
          amount: '200.00',
          fiscal_period: '2026-01',
        },
      ]);

      expect(rows).toHaveLength(2);
      expect(rows[0].fiscalPeriod).toBeUndefined();
      expect(rows[0].dto.agreementId).toBe('AGR-1');
      expect(rows[0].parseErrors).toEqual([
        {
          field: 'fiscal_period',
          error_type: 'INVALID_DATE',
          error_message: expect.stringContaining('çöp'),
        },
      ]);
      expect(rows[1].fiscalPeriod).toBe('2026-01');
      expect(rows[1].dto.agreementId).toBe('AGR-2');
      expect(rows[1].parseErrors).toBeUndefined();
    });

    // T-126: this used to be the contrast case — `invoice_date` still threw
    // and rejected the whole file while `fiscal_period` did not. That
    // asymmetry is now CLOSED for off-invoice: both fields go through the
    // same row-level `parseErrors` channel, neither throws.
    it('a broken invoice_date on one row ALSO survives via parseErrors now — the T-123-era asymmetry (fiscal_period silent, invoice_date file-rejecting) is closed by T-126', () => {
      const rows = mapToTransactionDtos([
        {
          agreement_id: 'AGR-1',
          invoice_no: 'INV-1',
          invoice_date: '3/4/26', // ambiguous US order
          amount: '100.00',
          fiscal_period: '2026-01',
        },
        {
          agreement_id: 'AGR-2',
          invoice_no: 'INV-2',
          invoice_date: '2026-01-16',
          amount: '200.00',
          fiscal_period: '2026-01',
        },
      ]);

      expect(rows).toHaveLength(2);
      expect(rows[0].dto.invoiceDate).toBeUndefined();
      expect(rows[0].parseErrors).toEqual([
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
      expect(rows[1].dto.invoiceDate).toBe('2026-01-16');
      expect(rows[1].parseErrors).toBeUndefined();
    });

    // MEASURED (Team Lead, task body): the file itself is never rejected —
    // both rows survive `mapToTransactionDtos`, one with a parse error, one
    // without.
    it('the file itself is not rejected — no exception is thrown for either broken-cell case above', () => {
      expect(() =>
        mapToTransactionDtos([
          {
            agreement_id: 'AGR-1',
            invoice_no: 'INV-1',
            invoice_date: '3/4/26',
            amount: '100.00',
            fiscal_period: 'çöp',
          },
        ]),
      ).not.toThrow();
    });
  });
});
