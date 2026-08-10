import { execFileSync } from 'child_process';
import * as path from 'path';
import {
  excelSerialToIsoDate,
  describeExcelSerialDateFailure,
  ExcelSerialDateErr,
} from './excel-serial-date';

/**
 * T-107 adım 1.
 *
 * ⚠️ THE ACCEPTANCE CRITERION THIS FILE EXISTS TO ENFORCE: the pre-fix code
 * (`new Date(1899, 11, 30)` — a LOCAL-clock epoch — combined with
 * `.toISOString()` — a UTC-clock read) only misbehaves EAST of UTC. Measured
 * by the team lead, serial `46037` (a spreadsheet cell showing `2026-01-15`):
 *
 *   TZ=Europe/Istanbul  -> 2026-01-14  (wrong, one day early)
 *   TZ=Asia/Kolkata     -> 2026-01-14  (wrong, one day early)
 *   TZ=UTC              -> 2026-01-15  (right, by accident of both clocks
 *                                        agreeing at the UTC/local boundary)
 *   TZ=America/New_York -> 2026-01-15  (right, by accident of the same kind)
 *
 * A suite that runs `TZ=UTC` (Jest's implicit default whenever the host
 * machine or CI happens to be UTC) CANNOT see this defect: every assertion
 * would pass against the broken implementation too. So the OK-path cases
 * below run under THREE zones, one of them east of UTC, and assert the
 * IDENTICAL, EXPECTED result — that identity, not any single zone's answer,
 * is the thing under test.
 *
 * ⚠️ MEASURED, AND IT CHANGED THE SHAPE OF THIS FILE: `jest.resetModules()` +
 * mutating `process.env.TZ` before a fresh `require()`, done from INSIDE a
 * running Jest worker (`jest-environment-node` on this Node build), does
 * NOT reliably change what `new Date(...).getTimezoneOffset()` returns after
 * the FIRST local-clock `Date` computation in that worker process — the
 * offset appears to latch onto the machine's real default zone (here,
 * `Europe/Istanbul`) and further `process.env.TZ` reassignments are silently
 * ignored for the rest of that worker's lifetime. Reproduced directly (see
 * the "harness sanity" describe block below): a same-test `TZ='UTC'`
 * reassignment, evaluated strictly after a prior local-clock `Date` call,
 * kept returning the Istanbul offset (`-180`), not `0`. A test built on that
 * (broken) premise would report three different zones while secretly
 * measuring the same one three times — exactly the §2.7 "kanıt kurulumu
 * ölçtüğün durumu değiştirmiyor" failure class, just discovered here instead
 * of repeated.
 *
 * The fix used here is the option the task explicitly names as an
 * alternative: `child_process`, spawning a genuinely fresh Node process per
 * zone with `TZ` set in its environment BEFORE that process ever touches a
 * `Date`. Verified empirically before relying on it (see the "harness
 * sanity" block): a subprocess with `TZ=Europe/Istanbul` reports offset
 * `-180`, one with `TZ=UTC` reports `0`, one with `TZ=America/New_York`
 * reports `300` — real divergence, not a repeated cached value. And against
 * a DELIBERATELY mutated copy of this module's epoch (`Date.UTC(1899, 11,
 * 30)` swapped for the pre-fix `new Date(1899, 11, 30).getTime()`), the same
 * subprocess harness reproduced the team lead's exact numbers: `2026-01-14`
 * under `TZ=Europe/Istanbul`, `2026-01-15` under `TZ=UTC` — i.e. this
 * harness DOES go red against the regression it exists to catch.
 */

const MODULE_PATH = path.resolve(__dirname, './excel-serial-date.ts');

interface ZoneBattery {
  main: ReturnType<typeof excelSerialToIsoDate>; // serial 46037
  dstSpring: ReturnType<typeof excelSerialToIsoDate>; // serial 46110
  dstFall: ReturnType<typeof excelSerialToIsoDate>; // serial 46320
  reference: ReturnType<typeof excelSerialToIsoDate>; // serial 44197
}

/**
 * Spawns a FRESH `node` process with `TZ=<tz>` set in its environment from
 * the start (never mutated mid-process — see the file header for why that
 * distinction matters), requires the REAL module under test by absolute
 * path, computes the OK-path battery, and returns it. `ts-node/register` in
 * `transpile-only` mode lets the child `require()` the `.ts` file directly
 * without a separate build step.
 */
function computeBatteryUnderZone(tz: string): ZoneBattery {
  const script = `
    const m = require(${JSON.stringify(MODULE_PATH)});
    const battery = {
      main: m.excelSerialToIsoDate(46037),
      dstSpring: m.excelSerialToIsoDate(46110),
      dstFall: m.excelSerialToIsoDate(46320),
      reference: m.excelSerialToIsoDate(44197),
    };
    process.stdout.write(JSON.stringify(battery));
  `;
  const stdout = execFileSync(
    'node',
    ['-r', 'ts-node/register/transpile-only', '-e', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf-8' },
  );
  return JSON.parse(stdout) as ZoneBattery;
}

/** Same subprocess mechanism, but measuring the raw local-clock offset — used
 * only to prove the harness itself is sensitive to `TZ`, independent of
 * anything in the module under test. */
function timezoneOffsetUnderZone(tz: string): number {
  const script = `process.stdout.write(String(new Date(2026, 0, 15).getTimezoneOffset()));`;
  const stdout = execFileSync('node', ['-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf-8',
  });
  return Number(stdout);
}

const ZONES = ['Europe/Istanbul', 'UTC', 'America/New_York'] as const;

describe('excelSerialToIsoDate (T-107 adım 1)', () => {
  describe('harness sanity — proven before being relied on (§2.7)', () => {
    it('a fresh subprocess per zone DOES reflect TZ (unlike in-process reassignment)', () => {
      expect(timezoneOffsetUnderZone('Europe/Istanbul')).toBe(-180);
      expect(timezoneOffsetUnderZone('UTC')).toBe(0);
      expect(timezoneOffsetUnderZone('America/New_York')).toBe(300);
    });

    it('demonstrates the broken premise this harness deliberately avoids: in-process TZ reassignment after a prior local Date call does not take effect in this Jest worker', () => {
      // eslint-disable-next-line no-new
      new Date(2026, 0, 15); // warms whatever the worker caches first
      process.env.TZ = 'UTC';
      const afterReassign = new Date(2026, 0, 15).getTimezoneOffset();
      // If this ever starts failing (i.e. `afterReassign === 0`), Jest/Node's
      // behavior has changed and the subprocess machinery above could be
      // simplified back to in-process `jest.resetModules()` — but only after
      // re-verifying, not by assumption.
      expect(afterReassign).not.toBe(0);
    });
  });

  describe('the exact case the team lead measured — identical, correct value across zones, one of them east of UTC', () => {
    it.each(ZONES)('serial 46037 -> 2026-01-15 under TZ=%s', (tz) => {
      const battery = computeBatteryUnderZone(tz);
      expect(battery.main).toEqual({ ok: true, isoDate: '2026-01-15' });
    });
  });

  describe('a DST boundary on each side — identical across zones', () => {
    it.each(ZONES)(
      'serial 46110 -> 2026-03-29 under TZ=%s (spring-forward week)',
      (tz) => {
        const battery = computeBatteryUnderZone(tz);
        expect(battery.dstSpring).toEqual({
          ok: true,
          isoDate: '2026-03-29',
        });
      },
    );

    it.each(ZONES)(
      'serial 46320 -> 2026-10-25 under TZ=%s (fall-back week)',
      (tz) => {
        const battery = computeBatteryUnderZone(tz);
        expect(battery.dstFall).toEqual({ ok: true, isoDate: '2026-10-25' });
      },
    );
  });

  describe('the widely-cited reference point, as a second independent check', () => {
    it.each(ZONES)('serial 44197 -> 2021-01-01 under TZ=%s', (tz) => {
      const battery = computeBatteryUnderZone(tz);
      expect(battery.reference).toEqual({ ok: true, isoDate: '2021-01-01' });
    });
  });

  // The rejection classes never construct a `Date` at all (see the source:
  // each returns before reaching `EXCEL_EPOCH_UTC_MS`), so they cannot be
  // timezone-sensitive by construction — no subprocess needed. Exercised
  // in-process, directly against the real module.
  describe('refusal classes (§2.5 — no silent guess), timezone-independent by construction', () => {
    it.each([NaN, Infinity, -Infinity])(
      'refuses non-finite input %p as NOT_FINITE, echoing the exact input',
      (input) => {
        expect(excelSerialToIsoDate(input)).toEqual({
          ok: false,
          reason: 'NOT_FINITE',
          input,
        });
      },
    );

    it.each([0, -1, -46037])(
      'refuses non-positive input %p as NON_POSITIVE, echoing the exact input',
      (input) => {
        expect(excelSerialToIsoDate(input)).toEqual({
          ok: false,
          reason: 'NON_POSITIVE',
          input,
        });
      },
    );

    it.each([60, 60.5])(
      "refuses Excel's fictitious 1900-02-29 (serial %p) as LEAP_BUG_DAY",
      (input) => {
        expect(excelSerialToIsoDate(input)).toEqual({
          ok: false,
          reason: 'LEAP_BUG_DAY',
          input,
        });
      },
    );

    // The values immediately either side of 60 are NOT refused — otherwise
    // LEAP_BUG_DAY would silently have grown into a range nobody asked for
    // (module docstring: "NOT HANDLED, ON PURPOSE"). This IS the OK path, so
    // it is technically timezone-sensitive in principle; asserted once here
    // (in-process) as a boundary sanity check, and already covered for real
    // cross-zone identity by the batteries above.
    it('serials adjacent to 60 are accepted, not refused', () => {
      expect(excelSerialToIsoDate(59)).toEqual({
        ok: true,
        isoDate: '1900-02-27',
      });
      expect(excelSerialToIsoDate(61)).toEqual({
        ok: true,
        isoDate: '1900-03-01',
      });
    });

    /**
     * T-126: fourth refusal class. MEASURED before the fix (module doc,
     * case 4): the computed millisecond offset for this input (`8.64e18`)
     * is far past `Date`'s own representable range (`±8.64e15`), and the
     * pre-fix code called `new Date(ms).toISOString()` directly — which
     * THREW a raw, uncaught `RangeError: Invalid time value`, not a
     * `BadRequestException` like every other refusal in this file. The
     * assertion below is the crash guard itself: calling this function must
     * not throw for this input — if the `Number.isNaN(date.getTime())`
     * check the fix added were ever removed, this test would not go red
     * with a failed `toEqual`, it would go red with an UNCAUGHT
     * `RangeError`, which is exactly the distinction §2.7's "mutasyon
     * kırmızısı testin kırılmasından da hiç koşmamasından da gelebilir"
     * warns about — both look red, only one is this test doing its job.
     */
    it('refuses a value too large to be a representable Date as OUT_OF_RANGE, without throwing RangeError', () => {
      expect(() => excelSerialToIsoDate(99999999999)).not.toThrow();
      expect(excelSerialToIsoDate(99999999999)).toEqual({
        ok: false,
        reason: 'OUT_OF_RANGE',
        input: 99999999999,
      });
    });

    it('a value just past the safe boundary is also refused as OUT_OF_RANGE, not silently clamped', () => {
      // `EXCEL_EPOCH_UTC_MS + value * MS_PER_DAY` must exceed `Date`'s max
      // representable instant (`±8.64e15` ms) for this to refuse — a value
      // merely "large" is not enough; it has to actually overflow `Date`.
      expect(excelSerialToIsoDate(1e11).ok).toBe(false);
      expect((excelSerialToIsoDate(1e11) as { reason: string }).reason).toBe(
        'OUT_OF_RANGE',
      );
    });
  });

  describe('describeExcelSerialDateFailure — Turkish, user-safe messages', () => {
    it('NOT_FINITE message names the input and does not guess a date', () => {
      const result = excelSerialToIsoDate(NaN);
      expect(result.ok).toBe(false);
      const message = describeExcelSerialDateFailure(
        result as ExcelSerialDateErr,
      );
      expect(message).toContain('Geçersiz tarih değeri');
      expect(message).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no invented ISO date
    });

    it('NON_POSITIVE message explains the polarity requirement', () => {
      const result = excelSerialToIsoDate(-5);
      expect(result.ok).toBe(false);
      const message = describeExcelSerialDateFailure(
        result as ExcelSerialDateErr,
      );
      expect(message).toContain('-5');
      expect(message).toContain('pozitif');
    });

    it('LEAP_BUG_DAY message names the 1900 leap-year bug, not a guessed date', () => {
      const result = excelSerialToIsoDate(60);
      expect(result.ok).toBe(false);
      const message = describeExcelSerialDateFailure(
        result as ExcelSerialDateErr,
      );
      expect(message).toContain('1900');
      expect(message).toContain('29 Şubat 1900');
    });

    it('OUT_OF_RANGE message names the value, not a guessed or clamped date', () => {
      const result = excelSerialToIsoDate(99999999999);
      expect(result.ok).toBe(false);
      const message = describeExcelSerialDateFailure(
        result as ExcelSerialDateErr,
      );
      expect(message).toContain('Geçersiz tarih değeri');
      expect(message).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no invented ISO date
    });
  });

  // Without this, a helper that accepted every number and always returned some
  // ISO-shaped string would also pass every refusal-class assertion above too
  // trivially — this pins the boundary value shared by two adjacent classes
  // (0 sits between "not finite" and "positive").
  it('is not simply permissive — 0 is refused, not coerced to a date', () => {
    expect(excelSerialToIsoDate(0).ok).toBe(false);
  });
});
