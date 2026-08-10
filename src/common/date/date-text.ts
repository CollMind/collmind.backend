/**
 * T-121: the one place a human-written date TEXT becomes a canonical
 * `YYYY-MM-DD` string.
 *
 * Sibling of `./excel-serial-date.ts` (T-107 adım 1, which handles the NUMERIC
 * Excel-serial branch) and `../numeric/numeric-text.ts` (T-105, same shape for
 * numbers). This module is the STRING branch: what runs when a date cell or CSV
 * field arrives as text instead of a serial number.
 *
 * Replaces, as of T-123, all three sites where a human-written date TEXT
 * used to be turned into a string by hand: `customer/services/file-parser.service.ts`
 * (T-121, the original site), and `on-invoice-file-parser.service.ts` /
 * `off-invoice-file-parser.service.ts`'s `getDateValue`/`getFiscalPeriod`
 * (T-123 — measured, 2026-08-08, Team Lead: those two used LOCAL getters
 * instead of `toISOString()` and so did NOT carry bulgu 1 (the TZ day-slip),
 * but DID carry bulgu 3 (the US-order guess) unchanged — `"3.4.2026"` parsed
 * as 4 Mart, not 3 Nisan, in both. Bulgu 1 being absent does not mean the
 * grammar defect was absent; only one of the three defects below was fixed by
 * accident of formatting choice. See T-121 in the meta-repo backlog for the
 * full four-column before/after matrix this decision is based on):
 *
 *     const date = new Date(str);                       // instant, ambiguous parse
 *     if (!isNaN(date.getTime())) {
 *       return date.toISOString().split('T')[0];         // UTC read of a local parse
 *     }
 *     return undefined;                                  // §2.5: silent, on a broken input
 *
 * THREE INDEPENDENT DEFECTS MEASURED IN THAT CODE, kept here so a future editor
 * does not reintroduce any one of them piecemeal:
 *
 * 1. GÜN KAYMASI (day slip). `new Date("1/15/26")` parses at LOCAL midnight;
 *    `.toISOString()` reads it back on UTC. East of UTC (Europe/Istanbul,
 *    Asia/Kolkata — this product's market) the two clocks disagree by a day:
 *
 *        TZ=Europe/Istanbul  "1/15/26" -> 2026-01-14   (wrong, one day early)
 *        TZ=UTC                          2026-01-15
 *        TZ=America/New_York             2026-01-15
 *
 *    ISO strings do not slip (`new Date("2026-01-15")` parses at UTC midnight
 *    per spec, so the two clocks agree) — which is exactly why the bug was easy
 *    to miss: it only shows on the non-ISO input this file's own downstream
 *    validator (`customer.service.ts`) assumed nothing could reach it with.
 *
 * 2. NO SINGLE FORMATTER FIXES BOTH INPUT SHAPES. Switching `.toISOString()`
 *    for local getters (`getFullYear`/`getMonth`/`getDate`) fixes case 1 but
 *    breaks ISO input WEST of UTC instead (measured, `America/New_York`,
 *    `"2026-01-15"` -> `2026-01-14`) — because `new Date(str)` itself parses on
 *    a DIFFERENT clock depending on whether the string is ISO or not. There is
 *    no formatter-level fix; the defect is upstream, in ever constructing a
 *    `Date` — an INSTANT — from a value that is a calendar DAY, which has no
 *    instant and no timezone. Hence the design below: no `Date`, anywhere, at
 *    any point, for any input this module accepts. Not `Date.UTC` either —
 *    unlike `excel-serial-date.ts`, which uses `Date.UTC` deliberately as a
 *    provably clock-independent DAY-COUNTER for a genuinely linear serial
 *    number, this module's input is calendar components already (year, month,
 *    day as separately parsed digit groups), so calendar arithmetic is done by
 *    hand — a leap-year rule and a days-in-month table — and never touches the
 *    `Date` type at all.
 *
 * 3. THE WORST ONE, AND TIMEZONE-INDEPENDENT: `new Date(str)` resolves
 *    day/month ambiguity by silently assuming US ORDER (month/day/year).
 *
 *        "3/4/26"   -> Wed Mar 04 2026     a Turkish user wrote 3 NİSAN
 *        "15/1/26"  -> Invalid              -> silently `undefined` (§2.5)
 *        "1/15/26"  -> Thu Jan 15 2026
 *
 *    That is not a one-day error, it is a one-MONTH error, on contract
 *    start/end dates — worse than (1) and unrelated to it; fixing (1) alone
 *    would have left this standing.
 *
 * PRODUCT OWNER DECISION (2026-08-09, T-121): accept ISO (`YYYY-MM-DD`) and
 * Turkish (`GG.AA.YYYY`, e.g. `15.01.2026`) — reject everything else,
 * including the US slash order and the ambiguous `D/M/YY` / `M/D/YY` shapes
 * that caused defect 3. The two accepted formats do not collide with each
 * other: `.` and `-` are different separators, so there is no shape a caller
 * could write that parses two different ways under this grammar. This is the
 * date-side twin of the decision `../numeric/numeric-text.ts` records for
 * numbers (2026-08-07): "AMBIGUITY IS REFUSED, NEVER GUESSED" — same
 * gerekçe, same date, one day apart, product side. `3/4/26` is refused for
 * the identical reason `"1.234"` is refused there: a wrong guess is a wrong
 * value that looks like a right one.
 *
 * IT RETURNS A RESULT, NOT A `Date` — same shape as both sibling modules, and
 * for the same reason: a shared primitive should not decide what an invalid
 * value MEANS to its caller (row-fails-the-import vs. field-is-optional), and
 * handing back a `Date` here would reintroduce the exact instant/day
 * confusion this module exists to remove. The canonical output is the
 * `YYYY-MM-DD` STRING — never constructed via `Date`, only string
 * concatenation of the validated, zero-padded components.
 *
 * `parseOptionalDateText` mirrors `parseOptionalNumericText`'s docstring: a
 * present-but-unreadable value is not the same as an absent one (§2.5). Only
 * `null`/`undefined`/whitespace-only means "not given"; anything else that
 * fails to parse is a caller-visible error, not a silently dropped field.
 */

export type DateTextFailure =
  /** Empty or whitespace-only. Callers decide whether that is an error via
   *  `parseOptionalDateText` vs. calling `parseDateText` directly. */
  | 'EMPTY'
  /** Well-formed digits but no separator/order this grammar accepts — every
   *  US-order, slash-separated, or free-text shape (`"3/4/26"`, `"15/1/26"`,
   *  `"Jan 15 2026"`) lands here, deliberately, per the product decision
   *  above. */
  | 'UNRECOGNIZED_FORMAT'
  /** Matched ISO or Turkish shape, but the digits are not a real Gregorian
   *  calendar day (`"2026-02-30"`, `"31.04.2026"`, `"29.02.2026"` in a
   *  non-leap year, month `13`, day `0`, …). Computed by hand — leap-year
   *  rule plus a days-in-month table — never by round-tripping through
   *  `Date`. */
  | 'INVALID_CALENDAR_DATE';

export interface DateTextOk {
  readonly ok: true;
  /** Canonical `YYYY-MM-DD`, zero-padded, never constructed via `Date`. */
  readonly isoDate: string;
}

export interface DateTextErr {
  readonly ok: false;
  readonly reason: DateTextFailure;
  readonly input: string;
}

export type DateTextResult = DateTextOk | DateTextErr;

/**
 * Turkish-language message for a row-level rejection, safe to show a user.
 * Mirrors `describeNumericTextFailure` / `describeExcelSerialDateFailure`.
 */
export function describeDateTextFailure(err: DateTextErr): string {
  switch (err.reason) {
    case 'EMPTY':
      return 'Tarih değeri boş.';
    case 'UNRECOGNIZED_FORMAT':
      return (
        `Tanınmayan tarih biçimi: '${err.input}'. Kabul edilen biçimler: ` +
        `YYYY-MM-DD (ör. 2026-01-15) veya GG.AA.YYYY (ör. 15.01.2026).`
      );
    case 'INVALID_CALENDAR_DATE':
      return `Geçersiz tarih: '${err.input}'. Böyle bir takvim günü yok.`;
  }
}

/** `YYYY-MM-DD`, digits only, exactly as ISO 8601 calendar dates are written. */
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `GG.AA.YYYY` — day first, then month, then a 4-digit year, dot-separated.
 * 1-2 digits for day/month (`3.4.2026` and `03.04.2026` both accepted) so a
 * human typing the format is not forced to zero-pad. The year is fixed at 4
 * digits deliberately: a 2-digit year (`15.01.26`) opens the identical
 * windowing ambiguity (is `26` 1926 or 2026?) the product owner's decision
 * refuses to guess at, and nothing in the T-121 decision asked for that
 * extension — inventing it would be exactly the unrequested business rule
 * §2.4 warns against.
 */
const TR_PATTERN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

/**
 * The only calendar arithmetic in this module, and it never touches `Date`:
 * a leap-year rule and a fixed days-in-month table, applied to already-parsed
 * digit groups. Returns the zero-padded canonical string, or `undefined` if
 * the three numbers do not name a real Gregorian day.
 */
function toCanonicalIfValidCalendarDate(
  year: number,
  month: number,
  day: number,
): string | undefined {
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a human-written date STRING against the grammar above. Never
 * constructs a `Date`. Rejects, rather than guesses, anything the grammar
 * does not admit.
 */
export function parseDateText(input: unknown): DateTextResult {
  if (input === null || input === undefined) {
    return { ok: false, reason: 'EMPTY', input: '' };
  }

  const raw = String(input).trim();
  if (raw === '') return { ok: false, reason: 'EMPTY', input: raw };

  const isoMatch = ISO_PATTERN.exec(raw);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const canonical = toCanonicalIfValidCalendarDate(
      Number(y),
      Number(m),
      Number(d),
    );
    return canonical
      ? { ok: true, isoDate: canonical }
      : { ok: false, reason: 'INVALID_CALENDAR_DATE', input: raw };
  }

  const trMatch = TR_PATTERN.exec(raw);
  if (trMatch) {
    const [, d, m, y] = trMatch;
    const canonical = toCanonicalIfValidCalendarDate(
      Number(y),
      Number(m),
      Number(d),
    );
    return canonical
      ? { ok: true, isoDate: canonical }
      : { ok: false, reason: 'INVALID_CALENDAR_DATE', input: raw };
  }

  return { ok: false, reason: 'UNRECOGNIZED_FORMAT', input: raw };
}

/**
 * Optional-field wrapper. `undefined` means ABSENT and nothing else — an
 * unreadable value still comes back as an error the caller must handle, not
 * a silently dropped field. Deliberately separate from `parseDateText`,
 * mirroring `parseOptionalNumericText`'s own split for the identical reason.
 */
export function parseOptionalDateText(
  input: unknown,
): DateTextResult | undefined {
  if (input === null || input === undefined) return undefined;
  if (String(input).trim() === '') return undefined;
  return parseDateText(input);
}
