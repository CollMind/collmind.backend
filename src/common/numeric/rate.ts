/**
 * RateMicro factories and rate application — ADR 0007 Karar 5 (scale corrected
 * by errata E3), Karar 6, errata E4.
 *
 * SCALE: 1 RateMicro === 0.0001 percent. 3.25% === 32500.
 * Chosen so that `numeric(9,4)` in percent notation (`3.2500`) maps to an
 * integer with no representation change: DB column stores the percent form a
 * human reads, the runtime type stores the integer form arithmetic needs, and
 * the conversion is a single multiply by 10_000.
 */

import { MoneyMinor, RateMicro, RATE_PERCENT_SCALE } from './brands';
import { assertExactInteger, assertRateOperandExact } from './limits';
import { roundHalfAwayFromZero } from './rounding';

export class InvalidRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRateError';
  }
}

/** Build a rate from micro units. Integer only — a fractional micro is meaningless. */
export function rateFromMicro(micro: number): RateMicro {
  if (!Number.isFinite(micro) || !Number.isInteger(micro)) {
    throw new InvalidRateError(
      `Rate in micro units must be a finite integer, received ${micro}`,
    );
  }
  assertExactInteger(micro, 'rateFromMicro');
  return micro as RateMicro;
}

/**
 * Build a rate from percent notation (the form the DB column and the UI use).
 * 3.25 → 32500. Rounds at the 4th decimal, which is the column's precision.
 */
export function rateFromPercent(percent: number): RateMicro {
  if (!Number.isFinite(percent)) {
    throw new InvalidRateError(`Rate must be finite, received ${percent}`);
  }
  return rateFromMicro(roundHalfAwayFromZero(percent * RATE_PERCENT_SCALE));
}

/** Parse `numeric(9,4)` percent text without routing it through Number() first. */
export function rateFromNumericString(value: string): RateMicro {
  const trimmed = value.trim();
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) {
    throw new InvalidRateError(
      `Not a valid numeric literal for rate: "${value}"`,
    );
  }
  const [, sign, whole, frac = ''] = match;
  const fracPadded = (frac + '0000').slice(0, 4);
  if (/[^0]/.test(frac.slice(4))) {
    throw new InvalidRateError(
      `Rate "${value}" carries precision below numeric(9,4) that would be lost silently.`,
    );
  }
  const micro = Number(whole) * RATE_PERCENT_SCALE + Number(fracPadded);
  return rateFromMicro(sign ? -micro : micro);
}

/** Serialise back to the `numeric(9,4)` percent string. */
export function rateToNumericString(rate: RateMicro): string {
  const negative = rate < 0;
  const abs = Math.abs(rate);
  const whole = Math.floor(abs / RATE_PERCENT_SCALE);
  const frac = abs % RATE_PERCENT_SCALE;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(4, '0')}`;
}

export function rateToPercent(rate: RateMicro): number {
  return rate / RATE_PERCENT_SCALE;
}

/**
 * Apply a rate to a money amount — the ONE place the two scales meet.
 *
 * Intermediate scale: minor units × micro units = 1e-6 of a kuruş. That product
 * is exact as long as the operand is within the ceiling, which is why
 * `assertRateOperandExact` runs BEFORE the multiply — checking afterwards would
 * be validating a number that is already wrong (errata E4).
 *
 * Rounding enters exactly once, at the end, half-away-from-zero. The result is
 * whole kuruş, i.e. the persistable form.
 */
export function applyRate(amount: MoneyMinor, rate: RateMicro): MoneyMinor {
  assertRateOperandExact(amount, 'applyRate');
  const scaledProduct = amount * rate; // 1e-6 kuruş
  assertExactInteger(scaledProduct, 'applyRate.product');
  const minor = roundHalfAwayFromZero(scaledProduct / 1_000_000);
  return minor as MoneyMinor;
}
