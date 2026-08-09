import { execFileSync } from 'child_process';
import * as path from 'path';
import {
  parseDateText,
  parseOptionalDateText,
  describeDateTextFailure,
  DateTextErr,
} from './date-text';

/**
 * T-121. Every cell of the team lead's measurement matrix (task body, 2026-08-09)
 * becomes a case here, plus the `EMPTY` vs. "present but unreadable" split that
 * mirrors `parseOptionalNumericText` (T-105) and `excelSerialToIsoDate` (T-107
 * adım 1) — the third sibling in this family, same shape, string input instead
 * of numeric.
 *
 * PRODUCT OWNER DECISION under test (task body): ISO `YYYY-MM-DD` and Turkish
 * `GG.AA.YYYY` are accepted; everything ambiguous (US slash order, 2-digit
 * years, free text) is refused. `3/4/26` is refused for the identical reason
 * `"1.234"` is refused in `numeric-text.ts` (T-105): a wrong guess that looks
 * like a right one is worse than a refusal.
 */

const ok = (input: string): string => {
  const r = parseDateText(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} for '${input}'`);
  return r.isoDate;
};
const fail = (input: string): DateTextErr => {
  const r = parseDateText(input);
  if (r.ok)
    throw new Error(`expected failure, got ${r.isoDate} for '${input}'`);
  return r;
};

describe('parseDateText (T-121)', () => {
  describe('accepted formats', () => {
    it.each([
      ['2026-01-15', '2026-01-15'],
      ['15.01.2026', '2026-01-15'],
      // The headline case this task exists to fix: a Turkish user writing
      // "3 Nisan" (3 April) must not silently become 4 March, which is what
      // `new Date("3.4.2026")` — via the US-order guess on the OLD string
      // branch's sibling `new Date("3/4/26")` — produced.
      ['3.4.2026', '2026-04-03'],
      // 1-2 digit day/month, not zero-padded — a human typing this format is
      // not forced to pad.
      ['03.04.2026', '2026-04-03'],
      // Leap year, Turkish format.
      ['29.02.2028', '2028-02-29'],
      // T-121 review S2: century rule (divisible by 100 is NOT a leap year
      // UNLESS also divisible by 400). `2000 % 4 === 0` alone would already
      // accept this — the case that actually exercises the century branch
      // is the pair below (`1900`, refused) and (`2100`, refused), not this
      // one on its own. Kept here so the accepted side of the boundary has
      // its own explicit case, next to its two refused siblings.
      ['2000-02-29', '2000-02-29'],
    ])('%s -> %s', (input, expected) => {
      expect(ok(input)).toBe(expected);
    });
  });

  describe('UNRECOGNIZED_FORMAT — ambiguity is refused, never guessed', () => {
    it.each([
      // US month/day order — the exact defect this module exists to remove.
      // `new Date("3/4/26")` used to resolve this as March 4th; a Turkish
      // user meant 3 Nisan (April 3rd). Refused outright, not reinterpreted.
      '3/4/26',
      '15/1/26',
      '1/15/26',
      'Jan 15 2026',
      // Zero-padding is required for the ISO shape — `2026-2-5` is not
      // `2026-02-05` by assumption, it is simply not admitted.
      '2026-2-5',
      // 2-digit years open the identical windowing ambiguity (1926 vs. 2026)
      // the product decision explicitly declines to guess at.
      '15.01.26',
    ])('%s is refused as UNRECOGNIZED_FORMAT', (input) => {
      expect(fail(input).reason).toBe('UNRECOGNIZED_FORMAT');
    });
  });

  describe('INVALID_CALENDAR_DATE — well-formed digits, not a real Gregorian day', () => {
    it.each([
      // Not a leap year.
      '29.02.2026',
      '2026-02-30',
      // Month/day out of range, both grammars.
      '2026-13-01',
      '32.01.2026',
      '01.13.2026',
      // T-121 review S2: century rule, refused side. `1900` and `2100` are
      // both divisible by 4 — a naive `year % 4 === 0` check would wrongly
      // accept these as leap years. They are refused because they are ALSO
      // divisible by 100 but NOT by 400. Without these two cases (plus the
      // accepted `2000-02-29` above), a broken `isLeapYear` that ignores the
      // century rule entirely passes every other case in this file — the
      // existing `29.02.2026` case never divides evenly by 4, so it cannot
      // distinguish the two implementations.
      '1900-02-29',
      '2100-02-29',
    ])('%s is refused as INVALID_CALENDAR_DATE', (input) => {
      expect(fail(input).reason).toBe('INVALID_CALENDAR_DATE');
    });
  });

  describe('EMPTY', () => {
    it.each(['', '   '])('%p is EMPTY, not UNRECOGNIZED_FORMAT', (input) => {
      expect(fail(input).reason).toBe('EMPTY');
    });

    it('null/undefined are EMPTY', () => {
      expect(parseDateText(null).ok).toBe(false);
      expect((parseDateText(null) as DateTextErr).reason).toBe('EMPTY');
      expect(parseDateText(undefined).ok).toBe(false);
      expect((parseDateText(undefined) as DateTextErr).reason).toBe('EMPTY');
    });
  });

  describe('the two grammars do not collide (task rationale: "." and "-" are different separators)', () => {
    // A string that is unambiguously ISO must never be reachable via the TR
    // branch, and vice versa — if it were, the grammar would itself be
    // ambiguous, which is the exact thing the product decision refuses.
    it('an ISO string is never accepted by the TR pattern under a different reading', () => {
      const r = parseDateText('2026-01-15');
      expect(r).toEqual({ ok: true, isoDate: '2026-01-15' });
    });

    it('a TR string is never accepted by the ISO pattern under a different reading', () => {
      const r = parseDateText('15.01.2026');
      expect(r).toEqual({ ok: true, isoDate: '2026-01-15' });
    });
  });

  // Without this, a parser that accepted everything and echoed it back
  // unchanged would also pass every OK-path assertion above.
  it('is not simply permissive', () => {
    expect(parseDateText('not a date').ok).toBe(false);
    expect(parseDateText('2026/01/15').ok).toBe(false);
    expect(parseDateText('15-01-2026').ok).toBe(false);
    expect(parseDateText('2026.01.15').ok).toBe(false);
  });
});

describe('parseOptionalDateText (T-121)', () => {
  // Mirrors parseOptionalNumericText (T-105): the importer must not merge a
  // legitimate absence with a §2.5 silent failure on an unreadable value.
  it('returns undefined only for a genuinely absent value', () => {
    expect(parseOptionalDateText(undefined)).toBeUndefined();
    expect(parseOptionalDateText(null)).toBeUndefined();
    expect(parseOptionalDateText('')).toBeUndefined();
    expect(parseOptionalDateText('   ')).toBeUndefined();
  });

  it('reports an unreadable-but-present value as an error, not an absence', () => {
    const r = parseOptionalDateText('3/4/26');
    expect(r).toBeDefined();
    expect(r!.ok).toBe(false);
    expect((r as DateTextErr).reason).toBe('UNRECOGNIZED_FORMAT');
  });

  it('passes a readable value through', () => {
    const r = parseOptionalDateText('3.4.2026');
    expect(r!.ok).toBe(true);
    expect((r as { isoDate: string }).isoDate).toBe('2026-04-03');
  });
});

describe('describeDateTextFailure — Turkish, user-safe messages', () => {
  it('EMPTY message', () => {
    expect(describeDateTextFailure(fail(''))).toBe('Tarih değeri boş.');
  });

  it('INVALID_CALENDAR_DATE message names the input, invents nothing', () => {
    const message = describeDateTextFailure(fail('2026-02-30'));
    expect(message).toContain('2026-02-30');
    expect(message).toContain('Geçersiz');
  });

  // ⚠️ T-105's lesson, restated for dates: a message must not point the user
  // at a format the parser itself refuses. Every format-shaped example named
  // in an UNRECOGNIZED_FORMAT message must independently round-trip through
  // this same parser as `ok: true`.
  it('UNRECOGNIZED_FORMAT message names formats that this parser actually accepts', () => {
    const message = describeDateTextFailure(fail('3/4/26'));
    expect(message).toContain('3/4/26');

    // Pull every date-shaped token out of the message and confirm each one
    // parses OK under the real grammar — not merely that it "looks like a
    // date".
    const candidates = [
      ...message.matchAll(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}/g),
    ].map((m) => m[0]);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(parseDateText(candidate).ok).toBe(true);
    }
  });
});

/**
 * TZ independence, MEASURED rather than asserted from the module's design
 * (CLAUDE.md: "ölçmek istediğinin değil" / §2.7 — a claim about another
 * component's behaviour must be checked, not inferred). Reuses the
 * `child_process` harness from `excel-serial-date.spec.ts` (T-107 adım 1):
 * `process.env.TZ` reassignment inside a running Jest worker does not
 * reliably take effect after the worker's first local-clock `Date` call, so
 * each zone gets a genuinely fresh `node` process with `TZ` set before that
 * process ever runs.
 *
 * This module's design claims it never constructs a `Date` at all (see the
 * source docstring, point 2) — if true, the identical representative battery
 * below must come back byte-identical across a zone east of UTC, UTC itself,
 * and a zone west of UTC. That identity is the thing under test, not any one
 * zone's individual answer.
 */
const MODULE_PATH = path.resolve(__dirname, './date-text.ts');
const ZONES = ['Europe/Istanbul', 'UTC', 'America/New_York'] as const;

interface ZoneBattery {
  isoOk: ReturnType<typeof parseDateText>; // '2026-01-15'
  trOk: ReturnType<typeof parseDateText>; // '15.01.2026'
  // the headline defect case: US-order guess vs. Turkish 3 Nisan
  trAmbiguousMonth: ReturnType<typeof parseDateText>; // '3.4.2026'
  usOrderRejected: ReturnType<typeof parseDateText>; // '3/4/26'
  leapYearOk: ReturnType<typeof parseDateText>; // '29.02.2028'
  invalidCalendar: ReturnType<typeof parseDateText>; // '2026-02-30'
}

function computeBatteryUnderZone(tz: string): ZoneBattery {
  const script = `
    const m = require(${JSON.stringify(MODULE_PATH)});
    const battery = {
      isoOk: m.parseDateText('2026-01-15'),
      trOk: m.parseDateText('15.01.2026'),
      trAmbiguousMonth: m.parseDateText('3.4.2026'),
      usOrderRejected: m.parseDateText('3/4/26'),
      leapYearOk: m.parseDateText('29.02.2028'),
      invalidCalendar: m.parseDateText('2026-02-30'),
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

describe('TZ independence (T-121), measured via fresh subprocesses (§2.7)', () => {
  it.each(ZONES)(
    "the full representative battery is byte-identical under TZ=%s — including the '3.4.2026' -> 3 Nisan case",
    (tz) => {
      const battery = computeBatteryUnderZone(tz);
      expect(battery.isoOk).toEqual({ ok: true, isoDate: '2026-01-15' });
      expect(battery.trOk).toEqual({ ok: true, isoDate: '2026-01-15' });
      expect(battery.trAmbiguousMonth).toEqual({
        ok: true,
        isoDate: '2026-04-03',
      });
      expect(battery.usOrderRejected).toEqual({
        ok: false,
        reason: 'UNRECOGNIZED_FORMAT',
        input: '3/4/26',
      });
      expect(battery.leapYearOk).toEqual({ ok: true, isoDate: '2028-02-29' });
      expect(battery.invalidCalendar).toEqual({
        ok: false,
        reason: 'INVALID_CALENDAR_DATE',
        input: '2026-02-30',
      });
    },
  );

  it('the three zones agree with each other, not just with a fixed expectation', () => {
    const [istanbul, utc, newYork] = ZONES.map(computeBatteryUnderZone);
    expect(istanbul).toEqual(utc);
    expect(utc).toEqual(newYork);
  });
});
