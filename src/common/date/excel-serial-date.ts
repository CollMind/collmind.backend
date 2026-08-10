/**
 * T-107 adım 1: the one place an Excel serial-date NUMBER becomes a canonical
 * `YYYY-MM-DD` string.
 *
 * Replaces five call sites that all wrote the same code
 * (`off-invoice-file-parser.service.ts:268,308`,
 * `on-invoice-file-parser.service.ts:281,323`,
 * `customer/services/file-parser.service.ts:434` — §7: kusurlar dosya bazlı
 * kümelenir, ve aynı dosyada kalıbın iki ucu, `getDateValue` ve fiscal-period
 * varyantı, ayrı ayrı yazılmıştı):
 *
 *     const excelEpoch = new Date(1899, 11, 30);              // LOCAL midnight
 *     const jsDate = new Date(excelEpoch.getTime() + value * 86400000);
 *     return jsDate.toISOString().split('T')[0];              // formats in UTC
 *
 * ⚠️ THE BUG WAS THE MIX OF CLOCKS, NOT THE EPOCH CONSTANT. `new Date(1899, 11,
 * 30)` builds the epoch at LOCAL midnight; `.toISOString()` formats the result
 * in UTC. In any timezone EAST of UTC (local midnight is BEFORE the UTC day
 * boundary — Europe/Istanbul, Asia/Kolkata, and every zone with a positive
 * offset), the two clocks disagree by one calendar day and the printed date
 * lands one day early. Measured (`node`, this file's epoch, serial `46037`,
 * which a spreadsheet cell shows as `2026-01-15`):
 *
 *     TZ=Europe/Istanbul  epoch.toISOString() = 1899-12-29T22:03:04.000Z  -> 2026-01-14  ✗
 *     TZ=Asia/Kolkata     epoch.toISOString() = 1899-12-29T18:38:50.000Z  -> 2026-01-14  ✗
 *     TZ=UTC                                                              -> 2026-01-15  ✓
 *     TZ=America/New_York                                                 -> 2026-01-15  ✓
 *
 * (Istanbul's offset in 1899 is LMT +01:57, not the modern +03:00 — a further
 * reason not to trust ANY local-clock arithmetic on a 19th-century date. The
 * fix does not depend on getting that offset right; it depends on never
 * touching a local clock at all.)
 *
 * `Date.UTC(1899, 11, 30)` builds and reads the epoch on the SAME clock in
 * every timezone, so the function below is timezone-independent by
 * construction, not by having been tested in enough zones.
 *
 * WHY DECEMBER 30 AND NOT DECEMBER 31, 1899
 * This is the well-known "1900 leap year bug" compensation, not an off-by-one
 * left in by accident. Lotus 1-2-3 treated 1900 as a leap year (it is not —
 * divisible by 100, not by 400); Excel kept that bug for file compatibility.
 * Using Dec 30, 1899 as the linear epoch makes serial arithmetic land on the
 * date Excel itself displays for every serial from 61 (1900-03-01) onward —
 * verified against the widely-cited fact that serial 44197 is 2021-01-01:
 *
 *     Date.UTC(1899,11,30) + 44197 days  ->  2021-01-01  ✓
 *
 * IT RETURNS A RESULT, NOT A STRING OR A THROW — same shape as
 * `../numeric/numeric-text.ts` (T-105), and for the same reason: a shared
 * primitive should not decide what an invalid value MEANS to its caller. Some
 * callers require the field (`getDateValue`) and must fail the row; others
 * treat it as optional (`getOptionalDate`) and, once the value fails to
 * parse, must ALSO fail rather than silently drop it — a present-but-broken
 * value is not the same as an absent one (§2.5, and the sibling lesson
 * `parseOptionalNumericText`'s own docstring records for the numeric case).
 *
 * INVALID SERIALS ARE REFUSED, NEVER GUESSED — three cases, decided here
 * because §2.5 forbids inventing a date silently:
 *
 * 1. Not finite (`NaN`, `Infinity`) -> REFUSED (`NOT_FINITE`). `typeof x ===
 *    'number'` at every call site admits `NaN`; nothing upstream excludes it.
 *
 * 2. Zero or negative -> REFUSED (`NON_POSITIVE`). Excel's serial system has
 *    no calendar date at or before its own epoch; a spreadsheet cell holding
 *    `0` or a negative number is not a date, whatever produced it.
 *
 * 3. Exactly `60` -> REFUSED (`LEAP_BUG_DAY`). This is a DIFFERENT case from
 *    (2), in kind and not degree. Excel displays serial 60 as "1900-02-29" —
 *    a date THAT DOES NOT EXIST on the Gregorian calendar (1900 is not a leap
 *    year) — purely for Lotus compatibility. The linear formula above cannot
 *    reproduce that display; measured, it computes serial 60 as `1900-02-28`,
 *    which is what Excel calls serial 59:
 *
 *        Date.UTC(1899,11,30) + 59 days  ->  1900-02-27
 *        Date.UTC(1899,11,30) + 60 days  ->  1900-02-28   (Excel: "1900-02-29")
 *        Date.UTC(1899,11,30) + 61 days  ->  1900-03-01   (agrees with Excel)
 *
 *    Silently returning `1900-02-28` would be a guess dressed as a
 *    computation — exactly the failure `numeric-text.ts` names in its own
 *    header ("AMBIGUITY IS REFUSED, NEVER GUESSED"). Refused instead.
 *
 * ⚠️ NOT HANDLED, ON PURPOSE, AND STATED RATHER THAN LEFT IMPLICIT: serials 1
 * through 59 carry the SAME one-day discrepancy against Excel's own display as
 * serial 60 does (measured: `Date.UTC(1899,11,30) + 1 day` -> `1899-12-31`,
 * Excel displays serial 1 as `1900-01-01`). They are not rejected here. The
 * reason is scope, not an oversight: T-107 adım 1's five call sites are
 * invoice dates, fiscal periods and customer contract dates — none of them
 * plausibly reference January or February of 1900 — and rejecting a 60-value
 * range nobody asked about would be exactly the kind of unrequested business
 * rule §2.4 warns against inventing. If a caller is ever found that can
 * legitimately receive a serial in that range, that is a new, separately
 * decided question, not an extension of this comment.
 *
 * 4. Too large to be a representable JS `Date` -> REFUSED (`OUT_OF_RANGE`).
 *    T-126: measured — `excelSerialToIsoDate(99999999999)` (a plausible typo
 *    or a stray non-date number landing in a numeric cell) computed a
 *    millisecond offset (`8.64e18`) far past `Date`'s own valid range
 *    (`±8.64e15`), and `new Date(ms).toISOString()` on that THREW a raw,
 *    uncaught `RangeError: Invalid time value` — not the `BadRequestException`
 *    every other refusal in this file produces. Every one of this function's
 *    six call sites (`off-invoice`×2, `on-invoice`×3, `customer`×1) already
 *    wraps `!result.ok` into a 400; none of them expected an exception to
 *    escape a `result.ok === true` branch instead. That made a single
 *    malformed cell a 500, not a 400 — and, upstream of any per-row error
 *    channel, a 500 there takes the WHOLE request down. Checked before
 *    `.toISOString()` is called, so the throw can never happen; refused with
 *    the same shape as the other three cases instead.
 */

export type ExcelSerialDateFailure =
  /** `NaN` or `±Infinity` — not a representable day count at all. */
  | 'NOT_FINITE'
  /** `<= 0` — before or at Excel's own epoch; no calendar date exists there. */
  | 'NON_POSITIVE'
  /** `Math.floor(value) === 60` — Excel's fictitious, non-existent 1900-02-29. */
  | 'LEAP_BUG_DAY'
  /** Computed millisecond offset falls outside `Date`'s own representable
   *  range — `new Date(ms).toISOString()` would throw `RangeError` rather
   *  than produce a date at all. */
  | 'OUT_OF_RANGE';

export interface ExcelSerialDateOk {
  readonly ok: true;
  /** Canonical `YYYY-MM-DD`, computed on `Date.UTC` — timezone-independent. */
  readonly isoDate: string;
}

export interface ExcelSerialDateErr {
  readonly ok: false;
  readonly reason: ExcelSerialDateFailure;
  readonly input: number;
}

export type ExcelSerialDateResult = ExcelSerialDateOk | ExcelSerialDateErr;

/**
 * Turkish-language message for a row-level rejection, safe to show a user.
 * Mirrors `describeNumericTextFailure`'s role for the numeric grammar.
 */
export function describeExcelSerialDateFailure(
  err: ExcelSerialDateErr,
): string {
  switch (err.reason) {
    case 'NOT_FINITE':
      return `Geçersiz tarih değeri: '${err.input}'.`;
    case 'NON_POSITIVE':
      return `Geçersiz tarih değeri: '${err.input}'. Excel seri tarihi pozitif olmalıdır.`;
    case 'LEAP_BUG_DAY':
      return (
        `Geçersiz tarih değeri: '${err.input}'. Bu, Excel'in 1900 artık yıl ` +
        `hatası nedeniyle var olmayan bir takvim gününü (29 Şubat 1900) temsil eder.`
      );
    case 'OUT_OF_RANGE':
      return `Geçersiz tarih değeri: '${err.input}'. Değer çok büyük, bir takvim gününe karşılık gelmiyor.`;
  }
}

/**
 * Days between Excel's linear epoch and the JS epoch, on `Date.UTC` — see the
 * module docstring for why Dec 30, 1899 and not Dec 31.
 */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/**
 * Convert an Excel serial-date NUMBER (as SheetJS hands back with
 * `raw: false` disabled from a numeric cell, or `raw: true`) to a canonical
 * `YYYY-MM-DD`. Timezone-independent: computed and formatted on `Date.UTC`
 * throughout, never on a local clock.
 *
 * Does not accept strings — every call site already branches on
 * `typeof value === 'number'` before reaching this function; a non-numeric
 * cell goes through a different parse path (`new Date(str)`), unchanged by
 * T-107 adım 1.
 */
export function excelSerialToIsoDate(value: number): ExcelSerialDateResult {
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'NOT_FINITE', input: value };
  }
  if (value <= 0) {
    return { ok: false, reason: 'NON_POSITIVE', input: value };
  }
  if (Math.floor(value) === 60) {
    return { ok: false, reason: 'LEAP_BUG_DAY', input: value };
  }

  const ms = EXCEL_EPOCH_UTC_MS + value * MS_PER_DAY;
  const date = new Date(ms);
  // T-126: checked BEFORE `.toISOString()` runs — that call throws
  // `RangeError` on an out-of-range `Date`, and `Number.isNaN(date.getTime())`
  // is `Date`'s own documented signal for "construction did not produce a
  // representable instant" (see module doc, case 4).
  if (Number.isNaN(date.getTime())) {
    return { ok: false, reason: 'OUT_OF_RANGE', input: value };
  }
  return { ok: true, isoDate: date.toISOString().split('T')[0] };
}
