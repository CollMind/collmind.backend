/**
 * Rounding — ADR 0007 Karar 6, mode corrected by errata E7.
 *
 * MODE: half-away-from-zero.
 *   round(2.5) === 3      round(-2.5) === -3
 *   invariant: |round(x)| === round(|x|)
 *
 * WHY NOT "half-up" (the ADR's original word)
 * "Half up" is undefined for negatives: does -2.5 go to -2 (toward +∞) or -3
 * (away from zero)? Both readings are called "half up" in different places.
 * Half-away-from-zero makes the sign symmetric, which is what commercial
 * reconciliation expects: a reversal of a rounded charge must round back to the
 * same magnitude, or a credit note fails to cancel its debit by one kuruş.
 *
 * WHY `Math.round` CANNOT BE USED (K7)
 * `Math.round(-2.5) === -2` — it rounds toward +∞, not away from zero. Any
 * delegation to it silently reintroduces the ambiguity this module exists to
 * remove. A regression test asserts the negative-half case specifically.
 *
 * WHEN IT IS APPLIED
 * At persistence only. Intermediate steps stay exact — rounding twice is how a
 * total stops matching the sum of its parts. `allocation.ts` is the one place
 * that rounds mid-computation, and it does so under a conservation invariant
 * that is property-tested.
 *
 * Today `ledger_entries` holds 1231 rows and 0 negative amounts, so the
 * negative branch has no production caller yet. The rule is being fixed while
 * nothing depends on it; reversal and CREDIT paths will exercise it later.
 */

import { MoneyMinor } from './brands';
import { assertExactInteger } from './limits';

/**
 * Round a real number to an integer, half away from zero.
 *
 * Returns a plain `number` on purpose: it is a numeric primitive, not yet a
 * money value. Branding happens in the money factory, which is the single
 * entry point into the branded world.
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `roundHalfAwayFromZero received a non-finite value: ${value}`,
    );
  }
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  assertExactInteger(rounded, 'roundHalfAwayFromZero');
  return rounded;
}

/**
 * Round an exact TRY amount to whole minor units (kuruş).
 * The only rounding point on the money path.
 */
export function roundToMinorUnits(amountInMajorUnits: number): number {
  return roundHalfAwayFromZero(amountInMajorUnits * 100);
}

/** Sum branded money exactly. Needed because `m + m` widens to `number`. */
export function sumMoney(values: readonly MoneyMinor[]): MoneyMinor {
  let total = 0;
  for (const v of values) total += v;
  assertExactInteger(total, 'sumMoney');
  return total as MoneyMinor;
}
