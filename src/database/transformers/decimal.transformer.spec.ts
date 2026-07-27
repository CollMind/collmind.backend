import { DecimalTransformer } from './decimal.transformer';

describe('DecimalTransformer', () => {
  it('should preserve null/undefined on read', () => {
    expect(DecimalTransformer.from(null)).toBeNull();
    expect(DecimalTransformer.from(undefined)).toBeUndefined();
  });

  it('should convert numeric strings from the pg driver into numbers', () => {
    expect(DecimalTransformer.from('500000.00')).toBe(500000);
    expect(DecimalTransformer.from('8187.00')).toBe(8187);
    expect(DecimalTransformer.from('100')).toBe(100);
    expect(DecimalTransformer.from('99.99')).toBe(99.99);
  });

  it('should return null for non-numeric input instead of NaN', () => {
    expect(DecimalTransformer.from('not-a-number')).toBeNull();
  });

  it('should pass values through unchanged on write', () => {
    expect(DecimalTransformer.to(500000)).toBe(500000);
    expect(DecimalTransformer.to(null)).toBeNull();
    expect(DecimalTransformer.to(undefined)).toBeUndefined();
  });

  describe('T-026 D-2 regression: decimal comparisons after transformation', () => {
    // Before the fix, TypeORM returned `decimal` columns as raw strings, so
    // `available >= requested` was a LEXICOGRAPHIC string comparison, e.g.
    // '500000.00' >= '8187.00' === false (because '5' < '8' as characters).
    // After applying DecimalTransformer at the entity/view boundary, the
    // comparison must be a correct NUMERIC comparison.

    it('500000.00 available vs 8187.00 requested -> sufficient (numeric >=)', () => {
      const available = DecimalTransformer.from('500000.00') as number;
      const requested = DecimalTransformer.from('8187.00') as number;

      // Sanity check: this is exactly the case that was broken by string comparison.
      expect('500000.00' >= '8187.00').toBe(false);

      expect(available >= requested).toBe(true);
    });

    it('100 available vs 100 requested -> sufficient (equal, numeric >=)', () => {
      const available = DecimalTransformer.from('100') as number;
      const requested = DecimalTransformer.from('100') as number;

      expect(available >= requested).toBe(true);
    });

    it('99.99 available vs 100 requested -> insufficient (numeric >=)', () => {
      const available = DecimalTransformer.from('99.99') as number;
      const requested = DecimalTransformer.from('100') as number;

      expect(available >= requested).toBe(false);
    });
  });
});
