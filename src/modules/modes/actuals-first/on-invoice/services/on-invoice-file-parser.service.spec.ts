import { BadRequestException } from '@nestjs/common';
import { OnInvoiceFileParserService } from './on-invoice-file-parser.service';
import { describeExcelSerialDateFailure } from '../../../../../common/date/excel-serial-date';

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
 * ⚠️ REACHABILITY NOTE (measured, not assumed — see the module-level finding
 * reported to the team lead): with the current `raw: false` passed to
 * `XLSX.utils.sheet_to_json` (unchanged this turn — adım 2 is out of scope),
 * every cell value `sheet_to_json` hands back is a STRING, even for a purely
 * numeric, unformatted cell (measured: a plain integer cell round-trips as
 * `"46037"`, `typeof` `string`, under `raw: false`; the SAME cell comes back
 * as `46037`, `typeof` `number`, only under `raw: true`). So `parseExcel` and
 * `parseCSV`, called as an outside caller would call them, CANNOT reach the
 * `typeof value === 'number'` branch this turn — that branch only becomes
 * live once adım 2 flips `raw: true`. The tests below call the private
 * numeric-branch methods directly (bracket-notation), which is the ONLY way
 * to exercise wiring that is real but not yet reachable through the public
 * API; they are not a substitute for an adım-2 end-to-end test through
 * `parseExcel` once that lands.
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
});
