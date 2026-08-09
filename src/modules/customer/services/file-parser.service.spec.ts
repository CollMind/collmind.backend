import { FileParserService, FieldParseError } from './file-parser.service';
import { describeExcelSerialDateFailure } from '../../../common/date/excel-serial-date';
import { describeDateTextFailure } from '../../../common/date/date-text';
import { describeNumericTextFailure } from '../../../common/numeric/numeric-text';
import * as XLSX from 'xlsx';

/**
 * T-107 adım 1 — wiring test for the fifth call site: `getOptionalDate`.
 * See `on-invoice-file-parser.service.spec.ts` for why the shared math is
 * not re-tested here and why the numeric branch is exercised through the
 * private method rather than the public `parseExcel`/`parseCSV` surface
 * (identical `raw: false` reachability gap, unchanged this turn).
 *
 * T-121 REVIEW — CONTRACT CHANGE (2026-08-09): `getOptionalDate` and
 * `getOptionalNumber` used to THROW `BadRequestException` for a present-but-
 * unreadable value, which `mapToCustomerDtos`'s single `.map()` call and
 * `parseExcel`/`parseCSV`'s own try/catch turned into a FILE-LEVEL rejection
 * in `CustomerService.importFromFile` — one bad cell anywhere rejected the
 * whole upload, with no row number and no indication of which field
 * (measured, T-121 review: a 500-row file with one bad date at data row 250
 * returned a single file error, not 499 created + 1 row-level error).
 *
 * The two getters now take a third `errors: FieldParseError[]` parameter and
 * COLLECT into it instead of throwing — `mapToCustomerDtos` allocates one
 * such array per row and hands it to `CustomerService.importFromFile`'s
 * existing per-row error channel via `ParsedCustomerRow.parseErrors`. §2.5
 * is still satisfied: a present-but-unreadable value is never silently
 * treated as absent — it still produces an error, just not a thrown one, and
 * that error still identifies the row (`ParsedCustomerRow.originalRowNumber`)
 * and the field (`FieldParseError.field`). The tests below pin the NEW shape;
 * the old `.toThrow(BadRequestException)` contract this file used to assert
 * is gone on purpose, not by omission.
 *
 * `parseErrors` for the string date branch routes through
 * `../../../common/date/date-text.ts`, which has its own exhaustive spec
 * (`date-text.spec.ts`) covering the parsing grammar, the calendar-validity
 * check (including the century leap-year rule, T-121 review S2), and TZ
 * independence. What is tested HERE is narrower and deliberately so: only
 * that `getOptionalDate`/`getOptionalNumber` actually WIRE their branch to
 * the shared helper (collect its error, or return its value unchanged) —
 * the same "wiring, not math" split this file has always used.
 */
describe('FileParserService — field-level parsing wiring (T-121)', () => {
  let service: FileParserService;

  beforeEach(() => {
    service = new FileParserService();
  });

  const getOptionalDate = (
    value: unknown,
    field = 'testField',
  ): { value: string | undefined; errors: FieldParseError[] } => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as {
        getOptionalDate(
          v: unknown,
          f: string,
          e: FieldParseError[],
        ): string | undefined;
      }
    ).getOptionalDate(value, field, errors);
    return { value: result, errors };
  };

  const getOptionalNumber = (
    value: unknown,
    field = 'testField',
  ): { value: number | undefined; errors: FieldParseError[] } => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as {
        getOptionalNumber(
          v: unknown,
          f: string,
          e: FieldParseError[],
        ): number | undefined;
      }
    ).getOptionalNumber(value, field, errors);
    return { value: result, errors };
  };

  describe('getOptionalDate — numeric (Excel serial) branch', () => {
    it('a numeric cell value is handed to the shared helper and its ISO date returned unchanged, no error pushed', () => {
      const { value, errors } = getOptionalDate(46037);
      expect(value).toBe('2026-01-15');
      expect(errors).toHaveLength(0);
    });

    it('a DST-boundary serial converts correctly', () => {
      const { value, errors } = getOptionalDate(46320);
      expect(value).toBe('2026-10-25');
      expect(errors).toHaveLength(0);
    });

    // §2.5: a PRESENT value that fails to parse must be refused — collected
    // as a row-level error — never silently treated the same as an ABSENT
    // value (which would return `undefined` with no error at all).
    it('a NOT_FINITE numeric input (NaN) is collected as an INVALID_DATE error, value is undefined', () => {
      const { value, errors } = getOptionalDate(NaN, 'lastOrderDate');
      expect(value).toBeUndefined();
      expect(errors).toEqual([
        {
          field: 'lastOrderDate',
          error_type: 'INVALID_DATE',
          error_message: describeExcelSerialDateFailure({
            ok: false,
            reason: 'NOT_FINITE',
            input: NaN,
          }),
        },
      ]);
    });

    it("Excel's fictitious 1900-02-29 (serial 60) is collected via the helper, with the helper's own message", () => {
      const { value, errors } = getOptionalDate(60, 'contractStartDate');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('contractStartDate');
      expect(errors[0].error_type).toBe('INVALID_DATE');
      expect(errors[0].error_message).toBe(
        describeExcelSerialDateFailure({
          ok: false,
          reason: 'LEAP_BUG_DAY',
          input: 60,
        }),
      );
    });

    // 0 is a number, not the sentinel for "absent" — must reach the helper
    // and be collected as NON_POSITIVE, not silently pass through as if the
    // field had never been given.
    it('numeric 0 is collected via the helper, not treated as absent', () => {
      const { value, errors } = getOptionalDate(0);
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].error_type).toBe('INVALID_DATE');
    });
  });

  describe('getOptionalDate — genuinely absent input (the only case with zero errors AND an undefined value)', () => {
    it.each([undefined, null, ''])(
      '%p returns undefined with NO error pushed',
      (v) => {
        const { value, errors } = getOptionalDate(v);
        expect(value).toBeUndefined();
        expect(errors).toHaveLength(0);
      },
    );
  });

  describe('getOptionalDate — string branch, wiring to date-text.ts (T-121)', () => {
    // The headline case: a Turkish date written GG.AA.YYYY must resolve to
    // 3 Nisan (April), not silently become 4 Mart via a US month/day guess.
    // Math itself belongs to date-text.spec.ts; this pins that the WIRING
    // returns that value unchanged.
    it('a Turkish-format string cell (GG.AA.YYYY) is parsed correctly, not guessed as US order', () => {
      const { value, errors } = getOptionalDate('3.4.2026');
      expect(value).toBe('2026-04-03');
      expect(errors).toHaveLength(0);
    });

    it('an ISO-format string cell passes through unchanged', () => {
      const { value, errors } = getOptionalDate('2026-01-15');
      expect(value).toBe('2026-01-15');
      expect(errors).toHaveLength(0);
    });

    // §2.5: an ambiguous/unreadable-but-PRESENT string must be collected as
    // an error, never silently dropped to `undefined` with no trace — this
    // is the exact defect T-121 closes (the old code's `new Date(str)`
    // either guessed US order or returned `undefined` for anything it could
    // not parse, with no way to tell the two apart).
    it('a US-order / ambiguous string cell is collected as an error, not silently dropped', () => {
      const { value, errors } = getOptionalDate('3/4/26', 'contractEndDate');
      expect(value).toBeUndefined();
      expect(errors).toEqual([
        {
          field: 'contractEndDate',
          error_type: 'INVALID_DATE',
          error_message: describeDateTextFailure({
            ok: false,
            reason: 'UNRECOGNIZED_FORMAT',
            input: '3/4/26',
          }),
        },
      ]);
    });

    it("a calendar-invalid string cell is collected via the helper, with the helper's own message", () => {
      const { value, errors } = getOptionalDate('2026-02-30');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].error_type).toBe('INVALID_DATE');
      expect(errors[0].error_message).toContain('2026-02-30');
    });

    it('an empty string cell (post-trim) still returns undefined with NO error', () => {
      const { value, errors } = getOptionalDate('   ');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(0);
    });
  });

  describe('getOptionalNumber — wiring to numeric-text.ts (T-105 / T-121 review)', () => {
    it('a well-formed numeric string is parsed and returned as a number, no error pushed', () => {
      const { value, errors } = getOptionalNumber('1500');
      expect(value).toBe(1500);
      expect(errors).toHaveLength(0);
    });

    it('a Turkish-formatted numeric string (1.234,56) is accepted, not silently dropped', () => {
      const { value, errors } = getOptionalNumber('1.234,56');
      expect(value).toBeCloseTo(1234.56);
      expect(errors).toHaveLength(0);
    });

    it('genuinely absent input (undefined/null/empty) returns undefined with NO error', () => {
      for (const v of [undefined, null, '']) {
        const { value, errors } = getOptionalNumber(v);
        expect(value).toBeUndefined();
        expect(errors).toHaveLength(0);
      }
    });

    // §2.5: a present-but-ambiguous numeric value is collected as an error,
    // never silently coerced or dropped.
    it('an ambiguous numeric string is collected as an INVALID_AMOUNT error, value is undefined', () => {
      const { value, errors } = getOptionalNumber('1.234', 'creditLimit');
      expect(value).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('creditLimit');
      expect(errors[0].error_type).toBe('INVALID_AMOUNT');
      // Reuse the module's own failure descriptor so this assertion does not
      // hardcode a message the source could drift away from unnoticed (§2.7).
      expect(errors[0].error_message).toBe(
        describeNumericTextFailure({
          ok: false,
          reason: 'AMBIGUOUS_SEPARATOR',
          input: '1.234',
        }),
      );
    });
  });

  describe('end-to-end via mapToCustomerDtos — the row-level error channel (T-121)', () => {
    const mapToCustomerDtos = (
      rows: unknown[],
    ): Array<{
      dto: Record<string, unknown>;
      originalRowNumber: number;
      parseErrors?: FieldParseError[];
    }> =>
      (
        service as unknown as {
          mapToCustomerDtos(rows: unknown[]): Array<{
            dto: Record<string, unknown>;
            originalRowNumber: number;
            parseErrors?: FieldParseError[];
          }>;
        }
      ).mapToCustomerDtos(rows);

    it('a row with a Turkish-format string contractStartDate reaches the DTO correctly, parseErrors is undefined', () => {
      const rows = mapToCustomerDtos([
        {
          code: 'CUST-2',
          name: 'Test Customer 2',
          contractStartDate: '3.4.2026',
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.contractStartDate).toBe('2026-04-03');
      expect(rows[0].parseErrors).toBeUndefined();
    });

    it('a row with an ambiguous string contractStartDate is NOT dropped from the result — it is collected as a row-level parseError (§2.5)', () => {
      const rows = mapToCustomerDtos([
        {
          code: 'CUST-2',
          name: 'Test Customer 2',
          contractStartDate: '3/4/26',
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.contractStartDate).toBeUndefined();
      expect(rows[0].parseErrors).toEqual([
        {
          field: 'contractStartDate',
          error_type: 'INVALID_DATE',
          error_message: expect.any(String),
        },
      ]);
    });

    it('a row with a numeric lastOrderDate reaches the DTO with the correct ISO value, parseErrors is undefined', () => {
      const rows = mapToCustomerDtos([
        {
          code: 'CUST-1',
          name: 'Test Customer',
          lastOrderDate: 46037, // 2026-01-15
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.lastOrderDate).toBe('2026-01-15');
      expect(rows[0].parseErrors).toBeUndefined();
    });

    it('a row with an unreadable numeric lastOrderDate is NOT dropped from the result — it is collected as a row-level parseError (§2.5)', () => {
      const rows = mapToCustomerDtos([
        {
          code: 'CUST-1',
          name: 'Test Customer',
          lastOrderDate: 60, // Excel's fictitious 1900-02-29
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.lastOrderDate).toBeUndefined();
      expect(rows[0].parseErrors).toHaveLength(1);
      expect(rows[0].parseErrors![0].field).toBe('lastOrderDate');
      expect(rows[0].parseErrors![0].error_type).toBe('INVALID_DATE');
    });

    it('a row with two independently broken fields collects BOTH errors, in field-declaration order (creditLimit before contractStartDate)', () => {
      const rows = mapToCustomerDtos([
        {
          code: 'CUST-3',
          name: 'Test Customer 3',
          creditLimit: '1.234', // ambiguous numeric
          contractStartDate: '3/4/26', // ambiguous date
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].parseErrors).toHaveLength(2);
      expect(rows[0].parseErrors![0].field).toBe('creditLimit');
      expect(rows[0].parseErrors![0].error_type).toBe('INVALID_AMOUNT');
      expect(rows[0].parseErrors![1].field).toBe('contractStartDate');
      expect(rows[0].parseErrors![1].error_type).toBe('INVALID_DATE');
    });

    // ⚠️ THE DELIVERY ITSELF, not just the per-field mechanics: a single bad
    // cell on ONE row must not affect a SIBLING row in the same file. A
    // single-row fixture cannot show this — with only one row there is
    // nothing for the bug (the old file-level throw, or any future
    // regression that re-couples rows) to leak into. This needs at least
    // two rows, one broken and one clean, and must check that row numbers
    // are not conflated between them.
    it('one bad row does not affect a sibling row — both are present in the result, correctly numbered (T-121 review, measured: 500-row file, 1 bad date -> 499 created + 1 row-level error, not a file-level rejection)', () => {
      const rows = mapToCustomerDtos([
        {
          code: 'CUST-BAD',
          name: 'Broken Row',
          contractStartDate: '3/4/26', // ambiguous — unparseable
        },
        {
          code: 'CUST-GOOD',
          name: 'Clean Row',
          contractStartDate: '15.01.2026', // valid Turkish format
        },
      ]);

      expect(rows).toHaveLength(2);

      // Row 1: broken field is undefined and reported, but the REST of the
      // row (code/name) is untouched — this is a field-level failure, not a
      // row-level wipeout.
      expect(rows[0].originalRowNumber).toBe(2); // header(1) + 0-based(1)
      expect(rows[0].dto.code).toBe('CUST-BAD');
      expect(rows[0].dto.name).toBe('Broken Row');
      expect(rows[0].dto.contractStartDate).toBeUndefined();
      expect(rows[0].parseErrors).toEqual([
        {
          field: 'contractStartDate',
          error_type: 'INVALID_DATE',
          error_message: expect.any(String),
        },
      ]);

      // Row 2: entirely unaffected by row 1's failure, correct row number.
      expect(rows[1].originalRowNumber).toBe(3);
      expect(rows[1].dto.code).toBe('CUST-GOOD');
      expect(rows[1].dto.contractStartDate).toBe('2026-01-15');
      expect(rows[1].parseErrors).toBeUndefined();
    });
  });
});

/**
 * T-121 second-tour review (B3/B4) — the PUBLIC surface, with a real xlsx
 * buffer, not the private-method shortcuts the suite above uses.
 *
 * Before this block, nothing in the repo ran `parseExcel`/`parseCSV`
 * end-to-end (every spec for these two parsers reaches in via
 * `as unknown as { ... }` to a private method — see the header comment on
 * this file and the sibling `on-invoice`/`off-invoice` specs). That gap is
 * exactly where B3 lived: `stripBlankCellSentinel` (private) is exercised
 * correctly by nothing that also exercises `sheet_to_json`'s actual
 * `raw:false`/`defval:false` behaviour, so a regression in the interaction
 * between the two (not in either one alone) had no test to catch it.
 *
 * B3's trigger, measured (see the comment on `stripBlankCellSentinel`):
 * `defval: false` fills a genuinely blank cell with the literal boolean
 * `false`. That sentinel only survives an `a || b || c` alias chain when it
 * is the LAST operand — i.e. when the file's header spelling matches the
 * chain's SCREAMING_SNAKE_CASE alias (`CITY`, `NOTES`,
 * `CONTRACT_START_DATE`, `CREDIT_LIMIT`, …). No fixture in the suite above
 * used a SCREAMING_SNAKE header, so none of them could have failed the way
 * removing the strip actually fails.
 */
describe('parseExcel / parseCSV — public surface, real buffers (T-121 second-tour review)', () => {
  let service: FileParserService;

  beforeEach(() => {
    service = new FileParserService();
  });

  function buildMulterFile(
    buffer: Buffer,
    originalname: string,
    mimetype: string,
  ): Express.Multer.File {
    return {
      originalname,
      mimetype,
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

  /** `rows[0]` is the header row; every cell after it is a data cell. `null`
   *  produces a genuinely blank cell (no key written at all in the
   *  underlying sheet) — the shape `defval: false` fills, which is the shape
   *  this whole block is about. A literal `false` produces a REAL boolean
   *  cell (not a blank one) — see the dedicated test below for why that is
   *  a different case entirely. */
  function buildXlsxFile(rows: unknown[][]): Express.Multer.File {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;
    return buildMulterFile(
      buffer,
      'customers.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  function buildCsvFile(text: string): Express.Multer.File {
    return buildMulterFile(
      Buffer.from(text, 'utf-8'),
      'customers.csv',
      'text/csv',
    );
  }

  describe('B3 — blank-cell sentinel must not leak into SCREAMING_SNAKE-aliased fields', () => {
    it('a blank cell under SCREAMING_SNAKE headers (CITY, NOTES) is undefined, never the string "false"', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'CITY', 'NOTES'],
        ['CUST-1', 'Test Customer', null, null],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      // §2.5: the sentinel, unstripped, formats to the STRING "false" here
      // (getOptionalString trims/stringifies whatever it is handed) — that
      // is the exact regression this pins against, not just "is falsy".
      expect(rows[0].dto.city).toBeUndefined();
      expect(rows[0].dto.notes).toBeUndefined();
    });

    it('a blank CONTRACT_START_DATE cell is undefined with NO parseError — absent, not unreadable', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'CONTRACT_START_DATE'],
        ['CUST-1', 'Test Customer', null],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.contractStartDate).toBeUndefined();
      // Unstripped, the sentinel reaches `getOptionalDate` as the string
      // "false", which matches neither the ISO nor the GG.AA.YYYY grammar
      // and is therefore collected as an INVALID_DATE row-level error — a
      // blank cell must NOT produce an error at all (§2.5's other edge: a
      // genuine absence is not a failure).
      expect(rows[0].parseErrors).toBeUndefined();
    });

    it('a blank CREDIT_LIMIT cell is undefined with NO parseError — absent, not unreadable', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'CREDIT_LIMIT'],
        ['CUST-1', 'Test Customer', null],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.creditLimit).toBeUndefined();
      // Unstripped, "false" fails `numeric-text.ts`'s grammar (MALFORMED)
      // and is collected as an INVALID_AMOUNT row-level error.
      expect(rows[0].parseErrors).toBeUndefined();
    });

    // Scope check, not a mutation-sensitive assertion (the fix strips only
    // the BOOLEAN `false`, never the string `"FALSE"` `raw: false` produces
    // for a genuinely filled boolean cell — see `buildXlsxFile`'s comment):
    // proves the fix does not overreach into a field a user actually filled.
    it('a genuine FALSE boolean cell for IS_VIP is preserved as `false`, not stripped to undefined', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'IS_VIP'],
        ['CUST-1', 'Test Customer', false],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.isVip).toBe(false);
    });
  });

  describe('B4 — blank-row numbering stays aligned with the physical file, XLSX and CSV alike', () => {
    it('parseExcel: a blank row in the middle does not shift the row numbers of the rows after it', async () => {
      const file = buildXlsxFile([
        ['code', 'name'],
        ['C1', 'Customer One'], // sheet row 2
        [], // sheet row 3 — blank
        ['C2', 'Customer Two'], // sheet row 4
        ['C3', 'Customer Three'], // sheet row 5
      ]);

      const rows = await service.parseExcel(file);

      expect(rows.map((r) => [r.dto.code, r.originalRowNumber])).toEqual([
        ['C1', 2],
        ['C2', 4],
        ['C3', 5],
      ]);
    });

    it('parseCSV: a blank line in the middle numbers the surviving rows identically to parseExcel', async () => {
      const file = buildCsvFile(
        'code,name\nC1,Customer One\n\nC2,Customer Two\nC3,Customer Three\n',
      );

      const rows = await service.parseCSV(file);

      expect(rows.map((r) => [r.dto.code, r.originalRowNumber])).toEqual([
        ['C1', 2],
        ['C2', 4],
        ['C3', 5],
      ]);
    });
  });

  /**
   * T-107 adım 2 — `raw: true` + `pickCell` through the PUBLIC surface
   * (`parseExcel`). Every case here is pinned with the real value planted
   * under a NON-first alias at least once (§2.7 lesson 6: a suite that only
   * ever fills the first key cannot distinguish `pickCell` from an
   * accidentally-correct `||` chain).
   */
  describe('T-107 adım 2 — real 0 / real false do not vanish, under any alias position', () => {
    it('a real 0 creditLimit under the FIRST alias spelling (creditLimit) is NOT lost', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'creditLimit'],
        ['CUST-1', 'Test Customer', 0],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.creditLimit).toBe(0);
      expect(rows[0].parseErrors).toBeUndefined();
    });

    // The exact regression measured in `pick-cell.ts`'s own docstring: under
    // the pre-fix `row.creditLimit || row.credit_limit || row.CreditLimit ||
    // row.CREDIT_LIMIT` chain, a real `0` typed under this LAST alias
    // resolved correctly ONLY because it happened to be the chain's last
    // operand — this pins that `pickCell` gets there for a structural
    // reason (first-present-wins), not by the same accident.
    it('a real 0 creditLimit under the LAST alias spelling (CREDIT_LIMIT) is NOT lost', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'CREDIT_LIMIT'],
        ['CUST-1', 'Test Customer', 0],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.creditLimit).toBe(0);
      expect(rows[0].parseErrors).toBeUndefined();
    });

    it('a real false isVip under the FIRST alias spelling (isVip) is NOT lost', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'isVip'],
        ['CUST-1', 'Test Customer', false],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.isVip).toBe(false);
    });

    // Mirrors the B3 "genuine FALSE" test above, but this is the ADIM 2
    // acceptance case specifically: under `raw: true` the cell arrives as
    // the actual JS boolean `false` (not the string `"FALSE"` `raw: false`
    // produced), and must still survive through `pickCell` unchanged.
    it('a real false isVip under the LAST alias spelling (IS_VIP) is NOT lost', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'IS_VIP'],
        ['CUST-1', 'Test Customer', false],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.isVip).toBe(false);
    });

    it('a real 0 does not collide with the metadata-object-presence check (a lone metadata.storeSize=0 still creates dto.metadata)', async () => {
      const file = buildXlsxFile([
        ['code', 'name', 'storeSize'],
        ['CUST-1', 'Test Customer', 0],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.metadata).toBeDefined();
      expect(rows[0].dto.metadata!.storeSize).toBe(0);
    });
  });

  describe('T-107 adım 2 — code columns keep leading zeros and other digit-like text unchanged', () => {
    it('a code cell typed as text with a leading zero is preserved verbatim, not coerced to a number', async () => {
      const file = buildXlsxFile([
        ['code', 'name'],
        ['0012345678901', 'Test Customer'],
      ]);

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.code).toBe('0012345678901');
    });
  });

  describe('T-107 adım 2 — a #,##0-formatted numeric cell is accepted, not rejected (T-105 regression closed)', () => {
    it('creditLimit formatted #,##0 in the sheet is read as the underlying number, no parseError', async () => {
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['code', 'name', 'creditLimit'],
        ['CUST-1', 'Test Customer', 12500],
      ]);
      // The cell's OWN display format is thousands-grouped — exactly the
      // shape `raw: false` could only hand back as the string `"12,500"`,
      // which `numeric-text.ts` cannot disambiguate from a decimal and
      // refuses (T-105). `raw: true` must never even reach that grammar for
      // a genuinely numeric cell.
      (worksheet['C2'] as { z?: string }).z = '#,##0';
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer;
      const file = buildMulterFile(
        buffer,
        'customers.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.creditLimit).toBe(12500);
      expect(rows[0].parseErrors).toBeUndefined();
    });
  });

  describe("T-107 adım 2 — a date cell is read via its raw serial, independent of the column's own display format", () => {
    it('a contractStartDate cell formatted dd.mm.yyyy resolves to the correct calendar day via the serial, not the (unread) display text', async () => {
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['code', 'name', 'contractStartDate'],
        ['CUST-1', 'Test Customer', 46037], // serial for 2026-01-15
      ]);
      // T-121 measured: under `raw: false`, THIS display format is exactly
      // the one SheetJS cannot turn into a parseable string (it hands back
      // the raw serial AS TEXT, e.g. "46037", not "15.01.2026") — adım 2's
      // whole point is that `raw: true` never depends on this format at all.
      (worksheet['C2'] as { z?: string }).z = 'dd.mm.yyyy';
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer;
      const file = buildMulterFile(
        buffer,
        'customers.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      const rows = await service.parseExcel(file);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.contractStartDate).toBe('2026-01-15');
      expect(rows[0].parseErrors).toBeUndefined();
    });
  });
});
