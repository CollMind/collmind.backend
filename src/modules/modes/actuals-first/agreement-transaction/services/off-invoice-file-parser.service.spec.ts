import { BadRequestException } from '@nestjs/common';
import { OffInvoiceFileParserService } from './off-invoice-file-parser.service';
import { describeExcelSerialDateFailure } from '../../../../../common/date/excel-serial-date';

/**
 * T-107 adım 1 — wiring tests for the two call sites in THIS file
 * (`getDateValue`, `getFiscalPeriod`). See `on-invoice-file-parser.service.spec.ts`
 * for why the shared math is not re-tested here and why the numeric branch
 * is exercised through the private methods rather than the public
 * `parseExcel`/`parseCSV` surface: the same `raw: false` reachability gap
 * applies to this file (identical `XLSX.utils.sheet_to_json` options), unchanged
 * this turn (adım 2 is out of scope).
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
});
