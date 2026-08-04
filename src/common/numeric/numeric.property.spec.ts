/**
 * Property-based tests for the numeric contract (ADR 0007 F1).
 *
 * WHY THESE ARE NOT OPTIONAL
 * F1 ships with no production caller — `claims`, `recognition_variance` and the
 * settlement extensions do not exist yet (that is the ADR's scope option C: new
 * modules are born exact). So the usual proof that code works — something calls
 * it and the result is right — is unavailable. These tests are the substitute.
 *
 * This repo has shipped "mechanism exists, nothing calls it" nine times. The
 * difference here is that it is deliberate AND the behaviour is pinned by
 * properties rather than by a handful of examples someone chose because they
 * happened to pass.
 *
 * NO NEW DEPENDENCY (scope limit), so the generator is a seeded LCG. Seeded
 * rather than random: a failing case must be reproducible from the test output
 * alone, otherwise a flake is unactionable.
 */

import {
  MoneyMinor,
  moneyFromMinorUnits,
  moneyFromNumericString,
  moneyToNumericString,
  roundHalfAwayFromZero,
  allocateLargestRemainder,
  applyRate,
  rateFromPercent,
  rateToNumericString,
  rateFromNumericString,
  NumericOverflowError,
  AllocationError,
  MAX_RATE_OPERAND_MINOR,
} from './index';

/** Deterministic LCG — same constants as glibc, adequate for shrink-free fuzzing. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1103515245, s) + 12345) >>> 0;
    return s / 0x100000000;
  };
}

const RUNS = 500;

describe('roundHalfAwayFromZero (ADR 0007 errata E7)', () => {
  it('property: |round(x)| === round(|x|) — sign symmetry', () => {
    const rnd = lcg(20260804);
    for (let i = 0; i < RUNS; i++) {
      const x = (rnd() - 0.5) * 2_000_000;
      expect(Math.abs(roundHalfAwayFromZero(x))).toBe(
        roundHalfAwayFromZero(Math.abs(x)),
      );
    }
  });

  it('K7 regression: does NOT delegate to Math.round on the negative half', () => {
    // Math.round(-2.5) === -2 (rounds toward +infinity). The contract requires -3.
    // This single assertion is the whole reason the helper exists.
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfAwayFromZero(-2.5)).not.toBe(Math.round(-2.5));
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
  });

  it('rejects non-finite input rather than producing NaN silently', () => {
    expect(() => roundHalfAwayFromZero(NaN)).toThrow(RangeError);
    expect(() => roundHalfAwayFromZero(Infinity)).toThrow(RangeError);
  });
});

describe('money string round-trip', () => {
  it('property: parse(serialise(m)) === m for every representable amount', () => {
    const rnd = lcg(7);
    for (let i = 0; i < RUNS; i++) {
      const minor = Math.floor((rnd() - 0.5) * 2_000_000_00);
      const m = moneyFromMinorUnits(minor);
      expect(moneyFromNumericString(moneyToNumericString(m))).toBe(m);
    }
  });

  it('refuses sub-kuruş precision instead of truncating it silently', () => {
    expect(() => moneyFromNumericString('10.005')).toThrow(/sub-kuruş/);
    expect(moneyFromNumericString('10.00')).toBe(1000);
    expect(moneyFromNumericString('-3.07')).toBe(-307);
  });

  it('rejects a fractional minor unit rather than rounding behind the caller', () => {
    expect(() => moneyFromMinorUnits(10.5)).toThrow(/integer/);
  });
});

describe('rate round-trip (errata E3 — micro scale, not basis points)', () => {
  it('3.25 percent is 32500 micro, not 325', () => {
    expect(rateFromPercent(3.25)).toBe(32500);
  });

  it('property: parse(serialise(r)) === r', () => {
    const rnd = lcg(99);
    for (let i = 0; i < RUNS; i++) {
      const micro = Math.floor(rnd() * 1_000_000);
      const r = rateFromPercent(micro / 10_000);
      expect(rateFromNumericString(rateToNumericString(r))).toBe(r);
    }
  });
});

describe('applyRate (errata E4 — operand ceiling, not value ceiling)', () => {
  it('property: result never exceeds the amount for rates <= 100 percent', () => {
    const rnd = lcg(1234);
    for (let i = 0; i < RUNS; i++) {
      const amount = moneyFromMinorUnits(Math.floor(rnd() * 100_000_000));
      const rate = rateFromPercent(rnd() * 100);
      expect(Math.abs(applyRate(amount, rate))).toBeLessThanOrEqual(amount);
    }
  });

  it('throws above the operand ceiling, and the message carries the ADR pointer', () => {
    const tooBig = moneyFromMinorUnits(MAX_RATE_OPERAND_MINOR + 1);
    expect(() => applyRate(tooBig, rateFromPercent(1))).toThrow(
      NumericOverflowError,
    );
    try {
      applyRate(tooBig, rateFromPercent(1));
      fail('expected NumericOverflowError');
    } catch (e) {
      // K12: whoever sees this needs to find the decision, not guess at it.
      expect((e as Error).message).toContain('50000000');
      expect((e as Error).message).toContain('ADR 0007 E4/A9');
    }
  });
});

describe('allocateLargestRemainder (ADR 0007 Karar 6, canonical per errata E6)', () => {
  const parts = (weights: number[]) =>
    weights.map((w, i) => ({
      key: `p${i}`,
      weight: w,
      tieBreak: [`2026-01-0${(i % 9) + 1}`, `CODE-${i}`],
    }));

  it('property: conservation — sum(parts) === total, always', () => {
    const rnd = lcg(424242);
    for (let i = 0; i < RUNS; i++) {
      const n = 2 + Math.floor(rnd() * 6);
      const weights = Array.from({ length: n }, () => Math.floor(rnd() * 1000));
      if (weights.reduce((a, b) => a + b, 0) === 0) continue;
      const total = moneyFromMinorUnits(Math.floor(rnd() * 10_000_00));
      const result = allocateLargestRemainder(total, parts(weights));
      const sum = result.reduce((s, r) => s + r.amount, 0);
      expect(sum).toBe(total);
    }
  });

  it('property: conservation holds for negative totals too (reversals)', () => {
    const rnd = lcg(5150);
    for (let i = 0; i < 200; i++) {
      const weights = [1 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 10)];
      const total = moneyFromMinorUnits(-Math.floor(rnd() * 100_000));
      const result = allocateLargestRemainder(total, parts(weights));
      expect(result.reduce((s, r) => s + r.amount, 0)).toBe(total);
    }
  });

  it('is deterministic: identical input yields identical placement', () => {
    const total = moneyFromMinorUnits(100_01);
    const a = allocateLargestRemainder(total, parts([1, 1, 1]));
    const b = allocateLargestRemainder(total, parts([1, 1, 1]));
    expect(a).toEqual(b);
  });

  it('breaks ties on the business key, not on input order (INV-N-001)', () => {
    // Equal weights -> equal fractional parts -> the tie-break decides who gets
    // the odd kuruş. Reversing input order must not move it.
    const total = moneyFromMinorUnits(10);
    const forward = allocateLargestRemainder(total, [
      { key: 'late', weight: 1, tieBreak: ['2026-06-01', 'B'] },
      { key: 'early', weight: 1, tieBreak: ['2026-01-01', 'A'] },
      { key: 'mid', weight: 1, tieBreak: ['2026-03-01', 'C'] },
    ]);
    const reversed = allocateLargestRemainder(total, [
      { key: 'mid', weight: 1, tieBreak: ['2026-03-01', 'C'] },
      { key: 'early', weight: 1, tieBreak: ['2026-01-01', 'A'] },
      { key: 'late', weight: 1, tieBreak: ['2026-06-01', 'B'] },
    ]);
    const byKey = (r: { key: string; amount: MoneyMinor }[]) =>
      Object.fromEntries(r.map((x) => [x.key, x.amount]));
    expect(byKey(forward)).toEqual(byKey(reversed));
  });

  it('refuses to invent a tie-break key', () => {
    expect(() =>
      allocateLargestRemainder(moneyFromMinorUnits(100), [
        { key: 'a', weight: 1, tieBreak: [] },
      ]),
    ).toThrow(AllocationError);
  });

  it('refuses a zero total weight instead of defaulting to an equal split', () => {
    expect(() =>
      allocateLargestRemainder(moneyFromMinorUnits(100), parts([0, 0])),
    ).toThrow(/zero/);
  });

  it('classic 100/3 case: 33.34 + 33.33 + 33.33 === 100.00', () => {
    const result = allocateLargestRemainder(
      moneyFromMinorUnits(100_00),
      parts([1, 1, 1]),
    );
    expect(result.reduce((s, r) => s + r.amount, 0)).toBe(10000);
    expect(result.map((r) => r.amount).sort((a, b) => b - a)).toEqual([
      3334, 3333, 3333,
    ]);
  });
});
