/**
 * mechanic-input.spec.ts
 *
 * C3 write-side scale validation — unit coverage for `decimalPlaces` and
 * `checkEnteredScale` (see the doc comments on both in mechanic-input.ts;
 * read those before touching this file, the three-branch rule and the
 * `unitAmount` exemption are argued there, not repeated here).
 */

import { Mechanic, MechanicType } from '../../database/entities/mechanic.entity';
import { checkEnteredScale, decimalPlaces } from './mechanic-input';

function makeMechanic(code: string, mechanicType: MechanicType): Mechanic {
  return { code, mechanicType } as Mechanic;
}

describe('decimalPlaces', () => {
  it('integer -> 0', () => {
    expect(decimalPlaces(100)).toBe(0);
    expect(decimalPlaces(0)).toBe(0);
    expect(decimalPlaces(-42)).toBe(0);
  });

  it('1 decimal', () => {
    expect(decimalPlaces(100.5)).toBe(1);
  });

  it('2 decimals', () => {
    expect(decimalPlaces(100.05)).toBe(2);
  });

  it('4 decimals', () => {
    expect(decimalPlaces(0.0125)).toBe(4);
  });

  // The exponential branch — String(1e-7) is "1e-7", whose naive
  // `indexOf('.')` reading would be 0 decimals (exactly backwards). This is
  // the specific bug the mantissa/exponent handling in decimalPlaces exists
  // to avoid — see the function's doc comment.
  describe('exponential notation (the branch the doc comment calls out)', () => {
    it('1e-7 -> 7 decimals, not 0', () => {
      expect(decimalPlaces(1e-7)).toBe(7);
    });

    it('1.5e-7 -> 8 decimals (mantissa has 1 decimal + 7 from the exponent)', () => {
      expect(decimalPlaces(1.5e-7)).toBe(8);
    });

    it('1e21 -> 0 decimals (large-magnitude exponential, still an integer)', () => {
      expect(decimalPlaces(1e21)).toBe(0);
    });
  });
});

describe('checkEnteredScale', () => {
  describe('PERCENT mechanics (kind: rate) — bounded 0-100', () => {
    const mechanic = makeMechanic('CPP_ON_PCT', MechanicType.PERCENT);

    it.each([0, 50, 100])('%s is within bounds -> null', (value) => {
      expect(checkEnteredScale(mechanic, value)).toBeNull();
    });

    it('-1 -> violation, reason cites the percentage bound', () => {
      const violation = checkEnteredScale(mechanic, -1);
      expect(violation).not.toBeNull();
      expect(violation?.kind).toBe('rate');
      expect(violation?.reason).toMatch(/percentage/i);
      expect(violation?.reason).toMatch(/0 and 100/);
    });

    it('100.01 -> violation, reason cites the percentage bound', () => {
      const violation = checkEnteredScale(mechanic, 100.01);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/percentage/i);
    });

    it('150 -> violation, reason cites the percentage bound', () => {
      const violation = checkEnteredScale(mechanic, 150);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/percentage/i);
    });

    it('NaN -> violation (finite-number precondition, not the range check)', () => {
      const violation = checkEnteredScale(mechanic, NaN);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/finite/i);
    });

    it('Infinity -> violation (finite-number precondition)', () => {
      const violation = checkEnteredScale(mechanic, Infinity);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/finite/i);
    });
  });

  describe('AMOUNT_PER_UNIT mechanics (kind: unitAmount) — deliberately exempt from the sub-kuruş rule', () => {
    const mechanic = makeMechanic('PRICE_SUP', MechanicType.AMOUNT_PER_UNIT);

    it('0.0125 TRY/unit -> null — the deliberate exemption (see the ⚠️ block on checkEnteredScale). ' +
      'This is a POSITIVE test of the exemption itself, not just "no violation": if a kuruş rule is ' +
      'ever added to this branch by mistake, this is the assertion that must go red.', () => {
      const violation = checkEnteredScale(mechanic, 0.0125);
      expect(violation).toBeNull();
    });

    it('NaN -> violation (finite-number precondition applies even to the exempt branch)', () => {
      const violation = checkEnteredScale(mechanic, NaN);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/finite/i);
    });

    it('Infinity -> violation (finite-number precondition applies even to the exempt branch)', () => {
      const violation = checkEnteredScale(mechanic, Infinity);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/finite/i);
    });
  });

  describe('AMOUNT mechanics (kind: totalAmount) — at most 2 decimals (kuruş)', () => {
    const mechanic = makeMechanic('VIS_LS', MechanicType.AMOUNT);

    it.each([100, 100.5, 100.05])('%s (<= 2 decimals) -> null', (value) => {
      expect(checkEnteredScale(mechanic, value)).toBeNull();
    });

    it('100.005 (3 decimals, sub-kuruş) -> violation, reason cites kuruş rounding', () => {
      const violation = checkEnteredScale(mechanic, 100.005);
      expect(violation).not.toBeNull();
      expect(violation?.kind).toBe('totalAmount');
      expect(violation?.reason).toMatch(/kuru/i);
    });

    it('NaN -> violation (finite-number precondition)', () => {
      const violation = checkEnteredScale(mechanic, NaN);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/finite/i);
    });

    it('Infinity -> violation (finite-number precondition)', () => {
      const violation = checkEnteredScale(mechanic, Infinity);
      expect(violation).not.toBeNull();
      expect(violation?.reason).toMatch(/finite/i);
    });
  });

  describe('unrecognised mechanic_type — refuses to guess (throws via toMechanicInput)', () => {
    it('propagates the throw from toMechanicInput rather than swallowing/defaulting it', () => {
      const mechanic = makeMechanic(
        'UNKNOWN-MEC',
        'SOMETHING_ELSE' as MechanicType,
      );
      expect(() => checkEnteredScale(mechanic, 10)).toThrow(
        /Cannot determine scale for mechanic "UNKNOWN-MEC"/,
      );
    });
  });
});
