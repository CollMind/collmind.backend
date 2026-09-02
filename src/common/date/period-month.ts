/**
 * T-333 (`Z81`): the one place a `Date` is turned into a `YYYY-MM` PERIOD
 * LABEL. Fourth sibling in `src/common/date/`, after `./date-text.ts`
 * (T-121), `./excel-serial-date.ts` (T-107) and `./add-months.ts` (T-328).
 *
 * ⛔ WHY THIS EXISTS — LOCAL `getMonth()`/`getFullYear()` ON A UTC INSTANT
 * SLIPS A MONTH (AND A DAY, NEAR MIDNIGHT) WEST OF UTC
 *
 * `new Date('2026-02-01')` (a date-only ISO string, per spec) parses at
 * **UTC midnight**. Reading it back with the LOCAL getters
 * (`getFullYear()`/`getMonth()`) is a clock mix: the value carries a UTC
 * instant, the read is local. East of UTC (this deployment: Europe/Istanbul,
 * `+03`) the mix is silent — local midnight-plus-three still falls on the
 * same calendar day. West of UTC (e.g. `America/New_York`, `-05`) UTC
 * midnight is the PREVIOUS local evening: the derived `YYYY-MM` label rolls
 * back a month at the start of every month, and a day at every midnight
 * boundary. Nine call sites carried this before this module existed
 * (`BL-1` ölçüm raporu, `Z81`) — some deriving the label as an anahtar
 * (budget-envelope dimension match, `agreement_transactions.fiscal_period`),
 * where a wrong label is a wrong ledger deduction, not a display glitch.
 *
 * ⚠️ AND THE MIX SURVIVES THE DRIVER — measured, not assumed (`Z81 §5`)
 *
 * `main.plans.start_date` / `main.agreements.start_date` are PostgreSQL
 * `date` columns (no time zone in the type). `node-postgres` serialises an
 * outgoing `Date` parameter and parses an incoming `date`/`timestamp
 * without time zone` value using the NODE PROCESS's LOCAL calendar
 * components — not UTC. A round trip through such a column is therefore a
 * SECOND place the same local/UTC mix can reappear, independent of this
 * module. This module does not (and cannot) fix that layer; it only
 * guarantees that turning an in-memory `Date` into a period label is
 * timezone-independent BY CONSTRUCTION. See `Z81 §5` / `BL-1 §1` for the
 * empirical probe and its result.
 *
 * THE RULE IMPLEMENTED HERE: READ ON THE SAME CLOCK THE INPUT WAS PARSED
 * ON — UTC, both alt-desen (B) `new Date()` "now" and alt-desen (A)
 * `new Date(dto.someDate)` parsed from a date-only string. Standardising
 * `(B)` on UTC as well (not just local) is a deliberate choice
 * (`Z81 §2`): the canonical calendar boundary for a period label is UTC,
 * matching how `(A)`'s date-only strings are already interpreted — a
 * single yardımcı for both, not two conventions that happen to agree east
 * of UTC.
 */

/**
 * Turn a `Date` into a `YYYY-MM` period label, reading UTC components only.
 *
 * §2.5 — INVALID INPUT THROWS. A period label silently defaulting to
 * `NaN-NaN` (or worse, wrapping to a neighbouring month via `Date`'s own
 * leniency) is exactly the class this file exists to remove.
 */
export function toPeriodMonthUtc(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(
      `toPeriodMonthUtc: geçersiz tarih (${String(date)}). Dönem etiketi ` +
        `üretmek için geçerli bir Date gerekir.`,
    );
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
