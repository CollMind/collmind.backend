/**
 * Exactness limits — ADR 0007 Karar 6, errata E4, open question A9.
 *
 * JS `number` is exact for integers up to 2^53 − 1 (9_007_199_254_740_991).
 * The ADR's original note read that as "90 trillion TRY of headroom", which is
 * true only for a single MoneyMinor value in isolation. It is NOT the binding
 * limit: `applyRate` forms an intermediate product of
 *
 *     MoneyMinor (kuruş) × RateMicro (1e-6)
 *
 * so the operand ceiling is 2^53 / RATE_SCALE ≈ 9.007e9 kuruş ≈ 90_071_992 TRY —
 * roughly 90 million, not 90 trillion. Errata E4 records the correction.
 *
 * Today's largest real value in the system is 600_000 TRY (a budget envelope),
 * i.e. ~150x headroom. The guard therefore never fires in practice today; it
 * exists so that the day it does fire, the failure is loud and self-explaining
 * instead of a silently wrong number.
 */

import { MoneyMinor } from './brands';

/** 2^53 − 1. The exact-integer ceiling for IEEE-754 doubles. */
export const MAX_SAFE_EXACT = Number.MAX_SAFE_INTEGER;

/**
 * Re-evaluation threshold in TRY (ADR 0007 A9). Not a hard limit — the hard
 * limit is derived below. This is the number at which someone should revisit
 * whether `bigint` is needed, and it is carried in the error message so the
 * person seeing the overflow knows what decision is waiting for them.
 */
export const BIGINT_REVIEW_THRESHOLD_TRY = 50_000_000;

/**
 * Operand ceiling for rate application, in minor units.
 * Derived, not typed by hand: 2^53 / RATE_SCALE.
 */
export const MAX_RATE_OPERAND_MINOR = Math.floor(MAX_SAFE_EXACT / 1_000_000);

export class NumericOverflowError extends Error {
  constructor(
    readonly operation: string,
    readonly valueMinor: number,
    readonly ceilingMinor: number,
  ) {
    // K12: the message must carry the literal threshold and the ADR reference,
    // because whoever reads this stack trace is exactly the person who needs to
    // know that a decision (bigint migration) is already written down.
    super(
      `Numeric overflow in ${operation}: ${valueMinor} minor units exceeds the ` +
        `exact-arithmetic ceiling of ${ceilingMinor}. ` +
        `Re-evaluation threshold is ${BIGINT_REVIEW_THRESHOLD_TRY} TRY — see ADR 0007 E4/A9 ` +
        `for the bigint decision this triggers.`,
    );
    this.name = 'NumericOverflowError';
  }
}

/**
 * Assert a money value can take part in rate arithmetic without losing
 * exactness. Applied to the OPERAND, before the multiplication — checking the
 * product afterwards would be checking a number that is already wrong.
 */
export function assertRateOperandExact(
  amountMinor: MoneyMinor,
  operation = 'applyRate',
): void {
  if (Math.abs(amountMinor) > MAX_RATE_OPERAND_MINOR) {
    throw new NumericOverflowError(
      operation,
      amountMinor,
      MAX_RATE_OPERAND_MINOR,
    );
  }
}

/** Assert a plain integer result is still exactly representable. */
export function assertExactInteger(value: number, operation: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE_EXACT) {
    throw new NumericOverflowError(operation, value, MAX_SAFE_EXACT);
  }
}
