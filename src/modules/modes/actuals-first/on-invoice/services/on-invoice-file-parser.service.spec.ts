import { BadRequestException } from '@nestjs/common';
import { OnInvoiceFileParserService } from './on-invoice-file-parser.service';
import { describeExcelSerialDateFailure } from '../../../../../common/date/excel-serial-date';
import * as XLSX from 'xlsx';

/**
 * T-107 adım 1 — wiring tests for the two call sites in THIS file
 * (`getDateValue`, `getFiscalPeriod`). The shared math itself (TZ-independence,
 * the three refusal classes, boundary values) is exhaustively covered once in
 * `common/date/excel-serial-date.spec.ts` — not repeated here (§2.7 "test
 * yeşil ama hiçbir şey kanıtlamıyor" applies just as much to REDUNDANT
 * duplication of a cross-cutting test as to a missing one; what belongs HERE
 * is proof that this file actually CALLS the shared helper and propagates
 * its result/failure correctly, not a second copy of the helper's own suite).
 *
 * ⚠️ REACHABILITY NOTE, UPDATED (T-107 adım 2 landed, 2026-08-10): the
 * paragraph below described a real gap AT THE TIME adım 1 was written — with
 * `raw: false`, `sheet_to_json` handed back every cell as a STRING, so
 * `parseExcel`/`parseCSV` could never reach the `typeof value === 'number'`
 * branch through their public surface, only through the private-method
 * bracket-notation calls this file already used. adım 2 flipped `raw: true`
 * (see `on-invoice-file-parser.service.ts`'s `sheet_to_json` call site), so
 * that gap is CLOSED — the "T-107 adım 2 — public surface" describe block
 * below now exercises the numeric branch through `parseExcel` itself, with a
 * real `.xlsx` buffer. The private-method tests are kept (still the
 * narrowest way to pin the wiring/error-propagation contract in isolation),
 * not because the gap they were written to work around still exists.
 *
 * Original note, for the historical record: with `raw: false`, a plain
 * integer cell round-tripped as `"46037"` (`typeof` `string`); the SAME cell
 * came back as `46037` (`typeof` `number`) only under `raw: true`.
 */
describe('OnInvoiceFileParserService — excel-serial-date wiring (T-107 adım 1)', () => {
  let service: OnInvoiceFileParserService;

  beforeEach(() => {
    service = new OnInvoiceFileParserService();
  });

  // Bracket-notation access to `private` methods — see the reachability note
  // above for why a call through `parseExcel`/`parseCSV` cannot reach the
  // numeric branch this turn.
  const getDateValue = (value: unknown): string =>
    (service as unknown as { getDateValue(v: unknown): string }).getDateValue(
      value,
    );
  const getFiscalPeriod = (value: unknown): string =>
    (
      service as unknown as { getFiscalPeriod(v: unknown): string }
    ).getFiscalPeriod(value);

  describe('getDateValue — numeric (Excel serial) branch', () => {
    it('a numeric cell value is handed to the shared helper and its ISO date returned unchanged', () => {
      expect(getDateValue(46037)).toBe('2026-01-15');
    });

    it('a NOT_FINITE input is refused via the helper, not silently coerced', () => {
      expect(() => getDateValue(NaN)).toThrow(BadRequestException);
    });

    it('a NON_POSITIVE input is refused via the helper', () => {
      expect(() => getDateValue(-5)).toThrow(BadRequestException);
    });

    it("Excel's fictitious 1900-02-29 (serial 60) is refused via the helper", () => {
      expect(() => getDateValue(60)).toThrow(BadRequestException);
    });

    it('the thrown message is exactly what describeExcelSerialDateFailure produces, not a locally reworded copy', () => {
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

    // The required-field guard (empty/null/undefined) runs BEFORE the helper
    // is ever reached — a different, pre-existing check, unaffected by T-107
    // adım 1. Asserted so a future refactor cannot silently swap it for a
    // helper-produced message that would misname the actual problem (a
    // missing value is not an unparsable one).
    it('an absent value is refused before the helper is reached, with its own message', () => {
      expect(() => getDateValue(undefined)).toThrow('Date değeri zorunludur');
    });
  });

  describe('getFiscalPeriod — numeric (Excel serial) branch', () => {
    it('a numeric cell value is converted via the shared helper and truncated to YYYY-MM', () => {
      expect(getFiscalPeriod(46037)).toBe('2026-01');
    });

    it('a refused serial propagates the helper failure, not a guessed period', () => {
      expect(() => getFiscalPeriod(60)).toThrow(BadRequestException);
    });

    // `getFiscalPeriod` checks the `YYYY-MM` string shape FIRST; a number
    // never matches that regex (`String(46037)` is not `\d{4}-\d{2}`), so
    // every numeric input falls through to the excel-serial branch — proven,
    // not assumed, by asserting the DST-boundary serial converts correctly.
    it('a DST-boundary serial converts correctly through the fiscal-period path too', () => {
      expect(getFiscalPeriod(46110)).toBe('2026-03');
    });
  });

  describe('end-to-end from a parsed row to the final DTO (mapToEntryDtos)', () => {
    // This is the closest available approximation of "through the parser's
    // own public surface" given the raw:false reachability gap documented
    // above: `mapToEntryDtos` is the SAME private method `parseExcel` and
    // `parseCSV` both call after `sheet_to_json`/`csv-parser` produce their
    // row objects — the only difference from a true adım-2 end-to-end test is
    // that the numeric cell value is placed directly on the row here instead
    // of arriving through `sheet_to_json` (which cannot produce it yet).
    it('a row with a numeric invoice_date and fiscal_period reaches the DTO with the correct ISO values', () => {
      const mapToEntryDtos = (
        service as unknown as {
          mapToEntryDtos(
            rows: unknown[],
          ): Array<{ dto: Record<string, unknown> }>;
        }
      ).mapToEntryDtos.bind(service);

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
    });

    it('a row with an unreadable numeric date is refused, not silently dropped (§2.5)', () => {
      const mapToEntryDtos = (
        service as unknown as {
          mapToEntryDtos(rows: unknown[]): unknown[];
        }
      ).mapToEntryDtos.bind(service);

      expect(() =>
        mapToEntryDtos([
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
        ]),
      ).toThrow(BadRequestException);
    });
  });

  /**
   * T-107 adım 2 — public surface (`parseExcel`), real `.xlsx` buffers,
   * `raw: true` live. Closes the reachability gap the file header used to
   * document. `pickCell` replaced this file's `row.a || row.b || row.c`
   * chains for `quantity`/`discount` (money/count fields — exactly the
   * shape `pick-cell.ts`'s own docstring measures the regression on).
   *
   * MEASURED (T-107 adım 2 review, B4 — `pickCell` mutated back to an
   * `a || b || c` chain): this test DOES go red under that mutation, but
   * not for the reason its title implies. `quantity` is planted under the
   * FIRST of three aliases (`quantity`, `Quantity`, `QUANTITY`) with the
   * other two absent from the row — under `||`, `0 || undefined ||
   * undefined` evaluates to `undefined` (the falsy `0` gets overridden by
   * a LATER, merely-absent alias in the chain, not by a competing value).
   * `discount` is planted under the LAST alias (`DISCOUNT`) with nothing
   * after it, so its half of the assertion does NOT distinguish (see
   * `pick-cell.spec.ts`'s file header for why a value at the chain's own
   * tail always survives `||` too). The failure is real; it comes entirely
   * from the `quantity` half.
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
  });
});

/**
 * T-107 adım 2 review (B1) — public surface (`parseCSV`), real CSV text.
 * `csv-parser`'s blank-cell value is `''`, never XLSX's `null`/`undefined`
 * sentinel — a `,,,,,,,,,` row (every aliased column resolves to `''`) used
 * to survive the old `pickCell(...) !== undefined` blank-row filter
 * (`'' !== undefined`) and hit `getDateValue`, which throws on `value ===
 * ''`, taking the WHOLE FILE down. `hasCellValue` is the fix; this is its
 * only public-surface (`parseCSV`) coverage for this importer — before this
 * turn there was NONE (only `parseExcel` had a public-surface describe
 * block, see the file header for why).
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

    // The blank row is filtered out; both good rows survive.
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
 * blank-cell sentinel to a caller reading the per-row error payload; a
 * blank cell should be an OMITTED/undefined key, never the literal `null`.
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
