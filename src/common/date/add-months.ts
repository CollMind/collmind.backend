/**
 * T-328: the one place a number of MONTHS is added to a date.
 *
 * Third sibling in `src/common/date/`, after `./date-text.ts` (T-121, the
 * human-written STRING branch) and `./excel-serial-date.ts` (T-107, the
 * NUMERIC serial branch). Those two turn foreign input INTO a canonical date;
 * this one does ARITHMETIC on a date we already have. Same rule as
 * `../numeric/parseNumericText` (T-105, which collapsed four hand-written
 * decimal parsers into one): the capability lives in one file, and callers
 * import it.
 *
 * ⛔ WHY THIS EXISTS — `Date.prototype.setMonth` OVERFLOWS SILENTLY
 *
 * `setMonth` does not clamp. If the target month has no such day, it rolls
 * forward into the NEXT month and reports success:
 *
 *     const d = new Date('2026-01-31');
 *     d.setMonth(d.getMonth() + 1);        // asked for FEBRUARY
 *     d.toISOString()                      // 2026-03-03  ← MART. No error.
 *
 * Measured on the live endpoint before this module existed
 * (`GET /finance-reporting/cash-flow-projection`, 2026-08-29):
 *
 *     startDate=2026-01-31  months=1   ->  2026-03-03   monthDiff 2   ⛔ İKİ KAT
 *     startDate=2026-08-31  months=6   ->  2027-03-03   monthDiff 7   ⛔
 *     startDate=2026-08-29  months=6   ->  2027-03-01   monthDiff 7   ⛔
 *     startDate=2026-08-28  months=6   ->  2027-02-28   monthDiff 6   ✅ (poz. kontrol)
 *
 * The last line is why the defect survived: the overflow only fires when the
 * start day (29/30/31) does not exist in the target month, so the same code
 * is CORRECT on most days of the month and WRONG on a few. Its e2e pin
 * therefore passed for weeks and turned red on 2026-08-29 with no code change
 * — a calendar-driven "flake" that was never a flake (`DISIPLIN`: "flaky bir
 * test, ürünün ARALIKLI bozulduğunun kanıtı olabilir").
 *
 * THE RULE IMPLEMENTED HERE: CLAMP TO THE LAST DAY OF THE TARGET MONTH.
 *
 *     2026-01-31 + 1 ay  ->  2026-02-28
 *     2024-01-31 + 1 ay  ->  2024-02-29   (leap)
 *     2026-03-31 + 1 ay  ->  2026-04-30
 *     2026-01-15 + 1 ay  ->  2026-02-15   (day exists — nothing is clamped)
 *
 * This is the same convention `date-fns`/`dayjs`/`java.time.Plus` all use, but
 * the choice is stated rather than inherited: a projection window asked for in
 * MONTHS must not silently become longer than the number requested. For
 * `cash-flow-projection` the overflow direction was the dangerous one — the
 * window WIDENED, so more collections fell inside it and cash flow could read
 * better than it is, with no warning anywhere.
 *
 * ⚠️ ARITHMETIC IS DONE ON UTC COMPONENTS, DELIBERATELY.
 *
 * The original code mixed clocks: it read `getMonth()`/`getDate()` (LOCAL) and
 * the caller formatted the result with `toISOString()` (UTC). That is the same
 * local/UTC mix `./excel-serial-date.ts` documents with measurements as the
 * root cause of its own day-slip bug. Reading and writing on ONE clock makes
 * this function timezone-independent by construction rather than by having
 * been tested in enough zones — which matters because its input typically
 * comes from an ISO `YYYY-MM-DD` query string, and `new Date('2026-01-31')`
 * parses at UTC midnight per spec.
 *
 * TIME-OF-DAY IS PRESERVED (also on UTC), so the function is a pure calendar
 * shift and nothing else: it changes the month, and the day only when the
 * month forces it.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Days in a month, `month` being 0-indexed as `Date`'s own getters are.
 *
 * ⚠️ This is the SECOND leap-year rule in `src/common/date/` — `./date-text.ts`
 * has its own `daysInMonth(year, month)` on a 1-indexed month. They are NOT
 * merged here on purpose: that one is part of a module whose stated design is
 * that it never touches the `Date` type at all (see its docstring, defect 2),
 * and importing it from a module that deliberately DOES use `Date.UTC` would
 * blur exactly the boundary that docstring draws. A third copy in a THIRD
 * place would be the thing to refuse; the pair is a recorded, bounded
 * duplication. (`dashboard.service.ts` carries a private `lastDayOfMonth` as
 * well — measured T-328, reported, not touched: it is in another module and
 * its own correctness was not in this task's scope.)
 */
function daysInUtcMonth(year: number, month: number): number {
  return month === 1 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month];
}

/**
 * Add `months` calendar months to `date`, clamping to the last day of the
 * target month instead of overflowing into the next one. Returns a NEW `Date`;
 * the argument is not mutated (the mutating `setMonth` shape is what made the
 * original defect easy to write).
 *
 * `months` may be negative — subtracting months clamps identically
 * (`2026-03-31 - 1 ay` -> `2026-02-28`). No caller does this today; the
 * behaviour is defined rather than left to chance so the first one does not
 * have to discover it.
 *
 * §2.5 — INVALID INPUT THROWS, it does not silently produce a value:
 *
 *   - an `Invalid Date` input, or a non-integer / non-finite `months`, used to
 *     yield another `Invalid Date`, and the caller's `toISOString()` then threw
 *     `RangeError: Invalid time value` — a 500 whose message named neither the
 *     endpoint nor the parameter. This throws with both.
 *
 * ⚠️ Reachability, measured (T-328) rather than asserted: the only caller today
 * is `finance-reporting.service.ts` `getCashFlowProjection`, whose `months`
 * arrives through `CashFlowProjectionQueryDto` (`@Type(() => Number)` +
 * `@IsInt` + `@Min(1)` + `@Max(60)`), so a non-integer `months` is rejected
 * with a 400 BEFORE this function is called and these throws do not fire on
 * that path today. They are kept because that is a property of the CALLER's
 * validation, not of this function, and the next caller may not have a DTO in
 * front of it. (T-294 pinned exactly this: a bare `@Query('months')` without
 * `ParseIntPipe` sent `NaN` straight into `setMonth` and produced a 500.)
 */
export function addMonthsClamped(date: Date, months: number): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(
      `addMonthsClamped: geçersiz tarih (${String(date)}). Ay eklemesi için ` +
        `geçerli bir Date gerekir.`,
    );
  }
  if (!Number.isInteger(months)) {
    throw new TypeError(
      `addMonthsClamped: 'months' tam sayı olmalı, alınan: ${String(months)}.`,
    );
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-11
  const day = date.getUTCDate();

  // Absolute month index, so year roll-over (in both directions) is one
  // `Math.floor` and never a chain of ±12 corrections.
  const absolute = year * 12 + month + months;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = absolute - targetYear * 12; // always 0-11, incl. negatives

  // ⛔ THE FIX: the day never leaves the target month.
  const targetDay = Math.min(day, daysInUtcMonth(targetYear, targetMonth));

  const result = new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  // `Date.UTC` maps years 0-99 onto 1900-1999; undo that so the function is
  // total over the calendar rather than over the years we happen to use.
  if (targetYear >= 0 && targetYear <= 99) {
    result.setUTCFullYear(targetYear);
  }
  return result;
}
