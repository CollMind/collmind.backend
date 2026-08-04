/**
 * Largest-remainder allocation — ADR 0007 Karar 6, declared canonical by errata E6.
 *
 * THE INVARIANT THIS EXISTS FOR
 *   sum(parts) === total,  for every input, always.
 * Distributing a total by percentages and rounding each share independently
 * loses or gains kuruş. This helper never does.
 *
 * ALGORITHM (Karar 6, four steps)
 *   1. exact share per part, floored to whole minor units
 *   2. remainder = total − Σ(floored shares)
 *   3. hand the remainder out one minor unit at a time, largest fractional part first
 *   4. ties break on BUSINESS KEY, never on a generated id
 *
 * WHY STEP 4 IS NOT NEGOTIABLE (INV-N-001)
 * Ordering by uuid makes the output depend on a value that carries no business
 * meaning and changes between environments: the same input produces different
 * kuruş placement in dev and prod, and neither is reproducible from the data.
 * The caller supplies an explicit sort key — agreement start date, then
 * agreement code — and the helper refuses to invent one.
 *
 * FOURTH IMPLEMENTATION WARNING (errata E6, K14)
 * Two other remainder rules already exist in this repo:
 *   - spend-calculation.service.ts  computeLumpsumDistribution — remainder to
 *     the largest base volume (live, ADR 0006 Karar 2)
 *   - spend-distribution.service.ts — difference to the largest amount (unreachable)
 * This module is canonical. Convergence of the existing two is T-076, separate
 * work. Do NOT write a fourth inline distribution anywhere.
 */

import { MoneyMinor } from './brands';
import { assertExactInteger } from './limits';

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/**
 * One allocation target. `weight` is the proportional basis (volume, share,
 * headcount — the caller decides). `tieBreak` is the business key used when two
 * parts have the same fractional remainder; it must be stable and meaningful.
 */
export interface AllocationPart<TKey> {
  readonly key: TKey;
  readonly weight: number;
  /**
   * Business sort key for tie-breaks, most significant first.
   * Example: `[startDate.toISOString(), agreementCode]`.
   * A generated id here is a defect — see INV-N-001 note above.
   */
  readonly tieBreak: readonly (string | number)[];
}

export interface AllocationResult<TKey> {
  readonly key: TKey;
  readonly amount: MoneyMinor;
}

function compareTieBreak(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/**
 * Allocate `total` across `parts` proportionally to weight, preserving the sum
 * exactly.
 *
 * Errors rather than guessing:
 *  - empty parts list
 *  - negative weight
 *  - total weight of zero (there is no meaningful proportional answer; the
 *    caller must decide whether that means "skip" or "equal split", and that is
 *    a business decision, not an arithmetic default — cf. ADR 0006 Karar 2,
 *    where null base volume explicitly receives no share)
 */
export function allocateLargestRemainder<TKey>(
  total: MoneyMinor,
  parts: readonly AllocationPart<TKey>[],
): AllocationResult<TKey>[] {
  if (parts.length === 0) {
    throw new AllocationError('Cannot allocate across an empty set of parts');
  }
  for (const p of parts) {
    if (!Number.isFinite(p.weight) || p.weight < 0) {
      throw new AllocationError(
        `Allocation weight must be finite and non-negative, received ${p.weight}`,
      );
    }
    if (p.tieBreak.length === 0) {
      throw new AllocationError(
        'Every allocation part needs a business tie-break key (INV-N-001: ' +
          'ordering by a generated id is forbidden)',
      );
    }
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) {
    throw new AllocationError(
      'Total allocation weight is zero — no proportional answer exists. ' +
        'The caller must decide explicitly (skip, equal split, or reject).',
    );
  }

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  // Step 1 — exact share, floored.
  const floored = parts.map((p) => {
    const exact = (absTotal * p.weight) / totalWeight;
    const base = Math.floor(exact);
    return { part: p, base, frac: exact - base };
  });

  // Step 2 — what is left over.
  const distributed = floored.reduce((s, f) => s + f.base, 0);
  let remainder = absTotal - distributed;
  assertExactInteger(remainder, 'allocateLargestRemainder.remainder');

  // Step 3/4 — largest fractional part first, ties on the business key.
  const order = [...floored].sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    return compareTieBreak(a.part.tieBreak, b.part.tieBreak);
  });

  const extra = new Map<number, number>();
  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    const idx = floored.indexOf(order[i]);
    extra.set(idx, (extra.get(idx) ?? 0) + 1);
    remainder -= 1;
  }

  const result = floored.map((f, i) => ({
    key: f.part.key,
    amount: (sign * (f.base + (extra.get(i) ?? 0))) as MoneyMinor,
  }));

  // Conservation is the contract. Assert it rather than trusting the algebra:
  // this is the one line that would have caught every historical rounding drift.
  const check = result.reduce((s, r) => s + r.amount, 0);
  if (check !== total) {
    throw new AllocationError(
      `Allocation lost money: total ${total} but parts sum to ${check}. ` +
        'This is a bug in allocateLargestRemainder, not in the caller.',
    );
  }

  return result;
}
