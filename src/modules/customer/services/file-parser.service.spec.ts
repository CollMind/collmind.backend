import { BadRequestException } from '@nestjs/common';
import { FileParserService } from './file-parser.service';
import { describeExcelSerialDateFailure } from '../../../common/date/excel-serial-date';

/**
 * T-107 adım 1 — wiring test for the fifth call site: `getOptionalDate`.
 * See `on-invoice-file-parser.service.spec.ts` for why the shared math is
 * not re-tested here and why the numeric branch is exercised through the
 * private method rather than the public `parseExcel`/`parseCSV` surface
 * (identical `raw: false` reachability gap, unchanged this turn).
 *
 * ⚠️ `getOptionalDate` is the one call site with an "optional" field. §2.5's
 * silent-zero ban is why it does NOT return `undefined` for a value that IS
 * present but fails to parse — see the source comment at line ~436: "MEVCUT
 * bir değerin okunamaması ile alanın hiç verilmemiş olması aynı şey değildir".
 * That distinction (absent vs. present-but-broken) is exactly what the first
 * two tests below pin.
 *
 * ⚠️ OUT OF SCOPE, DELIBERATELY NOT ASSERTED "CORRECT" HERE: the STRING branch
 * of this same method (line ~448, `new Date(str).toISOString()`) has its own,
 * live, UTC-eastward-only off-by-one defect on non-ISO input — tracked
 * separately as [[T-121]]. Nothing below exercises or asserts a value for
 * that branch; doing so would risk pinning the bug as "expected" behavior.
 */
describe('FileParserService — excel-serial-date wiring (T-107 adım 1)', () => {
  let service: FileParserService;

  beforeEach(() => {
    service = new FileParserService();
  });

  const getOptionalDate = (value: unknown): string | undefined =>
    (
      service as unknown as {
        getOptionalDate(v: unknown): string | undefined;
      }
    ).getOptionalDate(value);

  describe('numeric (Excel serial) branch', () => {
    it('a numeric cell value is handed to the shared helper and its ISO date returned unchanged', () => {
      expect(getOptionalDate(46037)).toBe('2026-01-15');
    });

    it('a DST-boundary serial converts correctly', () => {
      expect(getOptionalDate(46320)).toBe('2026-10-25');
    });

    // §2.5: a PRESENT value that fails to parse must be refused, never
    // silently treated the same as an ABSENT value.
    it('a NOT_FINITE numeric input is refused (throws), not returned as undefined', () => {
      expect(() => getOptionalDate(NaN)).toThrow(BadRequestException);
    });

    it("Excel's fictitious 1900-02-29 (serial 60) is refused via the helper, with the helper's own message", () => {
      let caught: BadRequestException | undefined;
      try {
        getOptionalDate(60);
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

    // 0 is a number, not the sentinel for "absent" — must reach the helper
    // and be refused as NON_POSITIVE, not silently pass through as `undefined`.
    it('numeric 0 is refused via the helper, not treated as absent', () => {
      expect(() => getOptionalDate(0)).toThrow(BadRequestException);
    });
  });

  describe('genuinely absent input — the one case that legitimately returns undefined', () => {
    it.each([undefined, null, ''])(
      '%p returns undefined, not an error',
      (v) => {
        expect(getOptionalDate(v)).toBeUndefined();
      },
    );
  });

  describe('end-to-end from a parsed row to the final DTO (mapToCustomerDtos)', () => {
    it('a row with a numeric lastOrderDate reaches the DTO with the correct ISO value', () => {
      const mapToCustomerDtos = (
        service as unknown as {
          mapToCustomerDtos(
            rows: unknown[],
          ): Array<{ dto: Record<string, unknown> }>;
        }
      ).mapToCustomerDtos.bind(service);

      const rows = mapToCustomerDtos([
        {
          code: 'CUST-1',
          name: 'Test Customer',
          lastOrderDate: 46037, // 2026-01-15
        },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0].dto.lastOrderDate).toBe('2026-01-15');
    });

    it('a row with an unreadable numeric lastOrderDate is refused, not silently dropped (§2.5)', () => {
      const mapToCustomerDtos = (
        service as unknown as {
          mapToCustomerDtos(rows: unknown[]): unknown[];
        }
      ).mapToCustomerDtos.bind(service);

      expect(() =>
        mapToCustomerDtos([
          {
            code: 'CUST-1',
            name: 'Test Customer',
            lastOrderDate: 60, // Excel's fictitious 1900-02-29
          },
        ]),
      ).toThrow(BadRequestException);
    });
  });
});
