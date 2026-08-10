import { BadRequestException } from '@nestjs/common';
import { OffInvoiceFileParserService } from './off-invoice-file-parser.service';
import { describeExcelSerialDateFailure } from '../../../../../common/date/excel-serial-date';
import { describeDateTextFailure } from '../../../../../common/date/date-text';
import * as XLSX from 'xlsx';

/**
 * T-107 adım 1 — wiring tests for the two call sites in THIS file
 * (`getDateValue`, `getFiscalPeriod`). See `on-invoice-file-parser.service.spec.ts`
 * for why the shared math is not re-tested here and why the numeric branch
 * is exercised through the private methods rather than the public
 * `parseExcel`/`parseCSV` surface here.
 *
 * ⚠️ REACHABILITY NOTE, UPDATED (T-107 adım 2 landed, 2026-08-10): adım 1's
 * original note said the `raw: false` reachability gap applied here
 * unchanged. adım 2 flipped `raw: true` for this file too (see
 * `off-invoice-file-parser.service.ts`'s `sheet_to_json` call site) — the
 * gap is closed. See the "T-107 adım 2 — public surface" describe block
 * below for the now-reachable end-to-end coverage.
 *
 * ⚠️ This file's `getFiscalPeriod` differs from `OnInvoiceFileParserService`'s:
 * it returns `undefined` for an absent value instead of throwing (see the
 * source, line ~297) — a pre-existing, separate design choice, not something
 * T-107 adım 1 changed. Not exercised here to avoid asserting on behavior
 * outside this task's scope.
 */
describe('OffInvoiceFileParserService — excel-serial-date wiring (T-107 adım 1)', () => {
  let service: OffInvoiceFileParserService;

  beforeEach(() => {
    service = new OffInvoiceFileParserService();
  });

  const getDateValue = (value: unknown): string =>
    (service as unknown as { getDateValue(v: unknown): string }).getDateValue(
      value,
    );
  const getFiscalPeriod = (value: unknown): string | undefined =>
    (
      service as unknown as {
        getFiscalPeriod(v: unknown): string | undefined;
      }
    ).getFiscalPeriod(value);

  describe('getDateValue — numeric (Excel serial) branch', () => {
    it('a numeric cell value is handed to the shared helper and its ISO date returned unchanged', () => {
      expect(getDateValue(46037)).toBe('2026-01-15');
    });

    it('a NOT_FINITE input is refused via the helper', () => {
      expect(() => getDateValue(Infinity)).toThrow(BadRequestException);
    });

    it('a NON_POSITIVE input is refused via the helper', () => {
      expect(() => getDateValue(0)).toThrow(BadRequestException);
    });

    it("Excel's fictitious 1900-02-29 (serial 60) is refused via the helper, with the helper's own message", () => {
      let caught: BadRequestException | undefined;
      try {
        getDateValue(60);
      } catch (e) {
        caught = e as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      const response = caught!.getResponse() as { message: string };
      expect(response.message).toBe(
        describeExcelSerialDateFailure({
          ok: false,
          reason: 'LEAP_BUG_DAY',
          input: 60,
        }),
      );
    });

    it('an absent value is refused before the helper is reached, with its own message', () => {
      expect(() => getDateValue(null)).toThrow(
        'Invoice date değeri zorunludur',
      );
    });
  });

  describe('getFiscalPeriod — numeric (Excel serial) branch', () => {
    it('a numeric cell value is converted via the shared helper and truncated to YYYY-MM', () => {
      expect(getFiscalPeriod(46037)).toBe('2026-01');
    });

    it('a DST-boundary serial converts correctly', () => {
      expect(getFiscalPeriod(46320)).toBe('2026-10');
    });

    it('a refused serial propagates the helper failure rather than falling through to "undefined"', () => {
      expect(() => getFiscalPeriod(60)).toThrow(BadRequestException);
    });
  });

  describe('end-to-end from a parsed row to the final DTO/fiscal period (mapToTransactionDtos)', () => {
    // Closest available approximation of "through the parser's own public
    // surface" given the raw:false reachability gap — see the file header.
    it('a row with a numeric invoice_date and fiscal_period reaches the output with correct ISO values', () => {
      const mapToTransactionDtos = (
        service as unknown as {
          mapToTransactionDtos(rows: unknown[]): Array<{
            dto: Record<string, unknown>;
            fiscalPeriod: string | undefined;
          }>;
        }
      ).mapToTransactionDtos.bind(service);

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
    });

    it('a row with an unreadable numeric date is refused, not silently dropped (§2.5)', () => {
      const mapToTransactionDtos = (
        service as unknown as {
          mapToTransactionDtos(rows: unknown[]): unknown[];
        }
      ).mapToTransactionDtos.bind(service);

      expect(() =>
        mapToTransactionDtos([
          {
            agreement_id: 'AGR-1',
            invoice_no: 'INV-1',
            invoice_date: 60, // Excel's fictitious 1900-02-29
            amount: '100.00',
            fiscal_period: '2026-01',
          },
        ]),
      ).toThrow(BadRequestException);
    });
  });

  /**
   * T-107 adım 2 — public surface (`parseExcel`), real `.xlsx` buffers,
   * `raw: true` live. `amount` is the field `pickCell` protects here (a real
   * `0` amount is a legitimate off-invoice transaction line, not an absent
   * one).
   *
   * MEASURED (T-107 adım 2 review, B4 — `pickCell` mutated back to an
   * `a || b || c` chain, this describe block re-run): the LAST-alias-
   * spelling case (`AMOUNT`) stayed GREEN under the mutation — being the
   * chain's own last operand (`row.amount || row.Amount || row.AMOUNT`,
   * with the first two absent from the row), `0` has nothing after it to
   * be overridden by, so `||` and `pickCell` agree there. It is kept
   * because it pins the exact shape `pick-cell.ts`'s docstring measures,
   * not because it distinguishes from `||` — that is the FIRST-alias case
   * added below, which DID go red under the same mutation.
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

    // MEASURED (not the assumption this test started with): unlike
    // `on-invoice`'s `getNumberValue`, this file's own `getNumberValue` has a
    // separate, PRE-EXISTING business rule — `num <= 0` is refused with its
    // own message (`getNumberValue`, this file) — an off-invoice transaction
    // amount of 0 or less is rejected on purpose, unrelated to T-107. What
    // this test actually proves is narrower and still real: `pickCell`
    // delivers the genuine `0` under the LAST alias spelling (`AMOUNT`) TO
    // `getNumberValue` at all — rather than the pre-fix `||` chain's shape,
    // where a `0` under a non-last alias would have resolved to `undefined`
    // and been rejected as "Amount değeri zorunludur" (EMPTY) instead of
    // this specific positivity message. The two rejection reasons are
    // observably different, which is how this test can tell "pickCell
    // delivered 0" apart from "pickCell silently dropped it".
    it('a real 0 amount under the LAST alias (AMOUNT) reaches getNumberValue and is refused by the POSITIVE-amount rule, not silently dropped as absent', async () => {
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

      await expect(service.parseExcel(file)).rejects.toThrow(
        'Amount değeri pozitif olmalıdır: 0',
      );
    });

    // T-107 adım 2 review (B4): the LAST-alias case above does not
    // distinguish `pickCell` from `||` (see its own comment) — this does.
    // `amount` is the FIRST of three aliases (`amount`, `Amount`, `AMOUNT`)
    // with the other two absent from the row, so under `||` the real `0`
    // is overridden by a later, merely-absent alias (`0 || undefined ||
    // undefined` = `undefined`) and would resolve to the EMPTY rejection
    // ("Amount değeri zorunludur") instead of the POSITIVE-amount one.
    // MEASURED: red under the `pickCell` -> `||` mutation.
    it('a real 0 amount under the FIRST alias (amount) reaches getNumberValue and is refused by the POSITIVE-amount rule, not silently dropped as absent', async () => {
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

      await expect(service.parseExcel(file)).rejects.toThrow(
        'Amount değeri pozitif olmalıdır: 0',
      );
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
  });
});

/**
 * T-107 adım 2 review (B1) — public surface (`parseCSV`), real CSV text.
 * `csv-parser`'s blank-cell value is `''`, never XLSX's `null`/`undefined`
 * sentinel — a `,,,,,,` row (every aliased column resolves to `''`) used to
 * survive the old `pickCell(...) !== undefined` blank-row filter (`'' !==
 * undefined`) and hit `getDateValue`, which throws on `value === ''`,
 * taking the WHOLE FILE down. `hasCellValue` is the fix; this is its only
 * public-surface (`parseCSV`) coverage for this importer — before this turn
 * there was NONE (only `parseExcel` had a public-surface describe block).
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
 * T-123 — wiring tests for the STRING branch of `getDateValue` /
 * `getFiscalPeriod` in THIS file, now routed through `date-text.ts` instead
 * of `new Date(str)`. Companion to the numeric (excel-serial) wiring block
 * above (T-107 adım 1) and to `date-text.spec.ts` (T-121), which owns the
 * grammar/calendar-math itself — not re-tested here (§2.7).
 *
 * ⚠️ `getFiscalPeriod` in THIS file has a RETRACTED throw — see the
 * dedicated describe block below ("retraction pinned") for that half of
 * T-123. This block covers only `getDateValue` (unaffected by the
 * retraction — see its own doc comment: it still throws, deliberately, same
 * as `OnInvoiceFileParserService.getDateValue`) plus `getFiscalPeriod`'s
 * OK-path (a parseable string still truncates to YYYY-MM exactly as before).
 */
describe('OffInvoiceFileParserService — date-text string-branch wiring (T-123)', () => {
  let service: OffInvoiceFileParserService;

  beforeEach(() => {
    service = new OffInvoiceFileParserService();
  });

  const getDateValue = (value: unknown): string =>
    (service as unknown as { getDateValue(v: unknown): string }).getDateValue(
      value,
    );
  const getFiscalPeriod = (value: unknown): string | undefined =>
    (
      service as unknown as {
        getFiscalPeriod(v: unknown): string | undefined;
      }
    ).getFiscalPeriod(value);

  describe('getDateValue — string branch (still throws on a bad string, unaffected by the getFiscalPeriod retraction)', () => {
    it('GG.AA.YYYY ("3.4.2026") resolves to 3 Nisan (2026-04-03), not the old US-order guess (2026-03-04)', () => {
      expect(getDateValue('3.4.2026')).toBe('2026-04-03');
    });

    it('a zero-padded Turkish date ("15.01.2026") is accepted and correct — the old branch threw on this exact input (Team Lead measurement)', () => {
      expect(getDateValue('15.01.2026')).toBe('2026-01-15');
    });

    it('an ISO date string passes through unchanged', () => {
      expect(getDateValue('2026-01-15')).toBe('2026-01-15');
    });

    it('US slash order ("3/4/26") is refused, not silently accepted as March 4th', () => {
      expect(() => getDateValue('3/4/26')).toThrow(BadRequestException);
    });

    it('a calendar rollover ("2026-02-30") is refused, not silently rolled into March (new Date\'s fifth silent-failure mode, added per task instruction)', () => {
      expect(() => getDateValue('2026-02-30')).toThrow(BadRequestException);
    });

    it('an out-of-range month ("2026-13-01") is refused', () => {
      expect(() => getDateValue('2026-13-01')).toThrow(BadRequestException);
    });

    it('the thrown message for a rejected string is exactly what describeDateTextFailure produces, not a locally reworded copy', () => {
      let caught: BadRequestException | undefined;
      try {
        getDateValue('3/4/26');
      } catch (e) {
        caught = e as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      const response = caught!.getResponse() as { message: string };
      expect(response.message).toBe(
        describeDateTextFailure({
          ok: false,
          reason: 'UNRECOGNIZED_FORMAT',
          input: '3/4/26',
        }),
      );
    });
  });

  describe('getFiscalPeriod — OK path: a parseable full-date string still truncates to YYYY-MM', () => {
    it('GG.AA.YYYY ("3.4.2026") resolves to 2026-04, not the old guess 2026-03', () => {
      expect(getFiscalPeriod('3.4.2026')).toBe('2026-04');
    });

    it('a zero-padded Turkish date ("15.01.2026") truncates to 2026-01', () => {
      expect(getFiscalPeriod('15.01.2026')).toBe('2026-01');
    });

    it('a full ISO date string truncates to YYYY-MM', () => {
      expect(getFiscalPeriod('2026-01-15')).toBe('2026-01');
    });

    it('a plain YYYY-MM string is accepted directly, unaffected by T-123 (checked before the date-text branch is ever reached)', () => {
      expect(getFiscalPeriod('2026-04')).toBe('2026-04');
    });
  });

  /**
   * T-123 madde 3, RETRACTED (product owner decision, 2026-08-10) — see the
   * long rationale in `off-invoice-file-parser.service.ts`'s `getFiscalPeriod`
   * doc comment. This block pins the CURRENT (reverted) behavior, not the
   * intermediate throwing version T-123 shipped first:
   *
   *   - a genuinely ABSENT cell (`''`/`null`/`undefined`) -> `undefined`,
   *     no error — legitimate optionality, unaffected by T-123 either way
   *     (`agreement-transaction.service.ts`'s Priority 1/2/3 fallback chain
   *     covers this case).
   *   - a PRESENT but unparseable cell (garbage text, US-order slash, a
   *     calendar rollover) -> ALSO `undefined`, but for a different reason:
   *     this importer has no row-level error-accumulation channel (measured
   *     — `getNumberValue`/`getDateValue` in this same file both throw and
   *     take the whole file down), so throwing here converts a single bad
   *     fiscal_period cell into a rejection of every row in the upload.
   *
   * ⚠️ Do not "fix" this by reintroducing the throw without ALSO building the
   * row-level channel T-126 tracks — that reintroduction is exactly what was
   * measured and reverted here.
   */
  describe('getFiscalPeriod — retraction pinned: present-but-unparseable resolves to undefined, does NOT throw (T-123, reverted 2026-08-10, see T-126)', () => {
    it('a genuinely absent cell resolves to undefined (unaffected either way — legitimate optionality)', () => {
      expect(getFiscalPeriod('')).toBeUndefined();
      expect(getFiscalPeriod(null)).toBeUndefined();
      expect(getFiscalPeriod(undefined)).toBeUndefined();
    });

    it('a present-but-garbage cell ("çöp") resolves to undefined, does NOT throw', () => {
      expect(getFiscalPeriod('çöp')).toBeUndefined();
    });

    it('a present-but-US-order cell ("3/4/26") resolves to undefined, does NOT throw', () => {
      expect(getFiscalPeriod('3/4/26')).toBeUndefined();
    });

    it('a present-but-calendar-invalid cell ("2026-02-30", a rollover) resolves to undefined, does NOT throw', () => {
      expect(getFiscalPeriod('2026-02-30')).toBeUndefined();
    });
  });

  describe('end-to-end via mapToTransactionDtos — a broken fiscal_period cell does not drop its row or reject the file (T-123, reverted 2026-08-10)', () => {
    const mapToTransactionDtos = (
      rows: unknown[],
    ): Array<{
      dto: Record<string, unknown>;
      fiscalPeriod: string | undefined;
    }> =>
      (
        service as unknown as {
          mapToTransactionDtos(rows: unknown[]): Array<{
            dto: Record<string, unknown>;
            fiscalPeriod: string | undefined;
          }>;
        }
      ).mapToTransactionDtos(rows);

    // MEASURED (Team Lead, 2026-08-10, task body):
    //   A1 fiscal_period = "çöp"  ->  satır geçiyor, fiscalPeriod = undefined
    //   A2 sağlam satır           ->  geçiyor
    //   satır sayısı: 2
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
      expect(rows[1].fiscalPeriod).toBe('2026-01');
      expect(rows[1].dto.agreementId).toBe('AGR-2');
    });

    it('a broken invoice_date (getDateValue, unaffected by the retraction) on one row still rejects the WHOLE FILE — contrast with fiscal_period above', () => {
      expect(() =>
        mapToTransactionDtos([
          {
            agreement_id: 'AGR-1',
            invoice_no: 'INV-1',
            invoice_date: '3/4/26', // ambiguous US order — getDateValue still throws
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
        ]),
      ).toThrow(BadRequestException);
    });
  });
});
