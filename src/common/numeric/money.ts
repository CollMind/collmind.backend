/**
 * MoneyMinor factories — the only doors into the branded money world.
 *
 * ADR 0007 Karar 3a + errata E1: `as MoneyMinor` is forbidden everywhere except
 * this directory, enforced by ESLint (`no-restricted-syntax`, see .eslintrc.js
 * — the compiler cannot catch `n as unknown as MoneyMinor`, measured in 0013
 * §3.1 row 10). Inside this file the cast is the implementation of the brand,
 * so the directory is excluded from that rule.
 *
 * Every factory VALIDATES. A factory that accepts anything is a cast with extra
 * steps.
 */

import { MoneyMinor, MONEY_SCALE } from './brands';
import { assertExactInteger } from './limits';
import { roundToMinorUnits } from './rounding';

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

/**
 * Build money from whole minor units (kuruş).
 * Rejects non-integers: a fractional kuruş is the exact defect this contract
 * exists to prevent, so it must not be silently rounded here — rounding is a
 * decision that belongs to `fromMajorUnits` or to an explicit call site.
 */
export function moneyFromMinorUnits(minor: number): MoneyMinor {
  if (!Number.isFinite(minor)) {
    throw new InvalidMoneyError(`Money must be finite, received ${minor}`);
  }
  if (!Number.isInteger(minor)) {
    throw new InvalidMoneyError(
      `Money in minor units must be an integer, received ${minor} — ` +
        `use moneyFromMajorUnits() if this is a TRY amount needing rounding.`,
    );
  }
  assertExactInteger(minor, 'moneyFromMinorUnits');
  return minor as MoneyMinor;
}

/**
 * Build money from a TRY amount, rounding half-away-from-zero to kuruş.
 * This is the boundary where an inexact input becomes an exact value, and the
 * only place in the money path where rounding is allowed to happen implicitly.
 */
export function moneyFromMajorUnits(amountInTry: number): MoneyMinor {
  if (!Number.isFinite(amountInTry)) {
    throw new InvalidMoneyError(
      `Money must be finite, received ${amountInTry}`,
    );
  }
  return moneyFromMinorUnits(roundToMinorUnits(amountInTry));
}

/**
 * Build money from a PostgreSQL `numeric` string (the shape the pg driver
 * actually returns). Parsed digit-wise rather than via `Number()` — the whole
 * point is not to route an exact decimal string through IEEE-754 on the way in.
 */
export function moneyFromNumericString(value: string): MoneyMinor {
  const trimmed = value.trim();
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) {
    throw new InvalidMoneyError(
      `Not a valid numeric literal for money: "${value}"`,
    );
  }
  const [, sign, whole, frac = ''] = match;
  const fracPadded = (frac + '00').slice(0, 2);
  const fracDropped = frac.slice(2);
  if (/[^0]/.test(fracDropped)) {
    throw new InvalidMoneyError(
      `Money value "${value}" carries sub-kuruş precision that would be lost ` +
        `silently; round explicitly before constructing.`,
    );
  }
  const minor = Number(whole) * MONEY_SCALE + Number(fracPadded);
  assertExactInteger(minor, 'moneyFromNumericString');
  return (sign ? -minor : minor) as MoneyMinor;
}

/** Serialise to the `numeric(18,2)` string form for persistence. */
export function moneyToNumericString(value: MoneyMinor): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / MONEY_SCALE);
  const frac = abs % MONEY_SCALE;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

/** Read-only view in TRY, for display and for Domain B hand-off. Never persist this. */
export function moneyToMajorUnits(value: MoneyMinor): number {
  return value / MONEY_SCALE;
}

export const MONEY_ZERO: MoneyMinor = 0 as MoneyMinor;

/** Exact addition. Needed because `a + b` on two MoneyMinor widens to `number`. */
export function addMoney(a: MoneyMinor, b: MoneyMinor): MoneyMinor {
  const sum = a + b;
  assertExactInteger(sum, 'addMoney');
  return sum as MoneyMinor;
}

/** Exact subtraction. Negative results are legal (reversals, credits). */
export function subtractMoney(a: MoneyMinor, b: MoneyMinor): MoneyMinor {
  const diff = a - b;
  assertExactInteger(diff, 'subtractMoney');
  return diff as MoneyMinor;
}

/** Multiply money by a whole count (e.g. per-unit support × volume). */
export function multiplyMoneyByCount(
  amount: MoneyMinor,
  count: number,
): MoneyMinor {
  if (!Number.isInteger(count)) {
    throw new InvalidMoneyError(
      `Count must be an integer, received ${count} — use applyRate() for ` +
        `proportional scaling.`,
    );
  }
  const product = amount * count;
  assertExactInteger(product, 'multiplyMoneyByCount');
  return product as MoneyMinor;
}
