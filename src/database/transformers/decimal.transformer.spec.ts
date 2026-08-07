import { DecimalTransformer, InvalidDecimalError } from './decimal.transformer';

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

  // T-097: this block used to read
  //
  //     it('should return null for non-numeric input instead of NaN', ...)
  //     expect(DecimalTransformer.from('not-a-number')).toBeNull();
  //
  // and it was PINNING THE DEFECT. Returning `null` told a money path "no value"
  // for something that was in fact unreadable — CLAUDE.md §2.5. The test made
  // that a contract, so anyone fixing it would have seen a red suite and
  // concluded the fix was wrong. Recorded rather than quietly rewritten: a test
  // that locks current behaviour instead of correct behaviour is worth being
  // able to recognise later.
  describe('unconvertible input (T-097)', () => {
    it('throws instead of returning null — a money path must not receive "no value" for unreadable input', () => {
      expect(() => DecimalTransformer.from('not-a-number')).toThrow(
        InvalidDecimalError,
      );
    });

    // Separate test, and separate on purpose: `Number.isNaN(Infinity)` is false,
    // so the old guard let this through as a money value. NaN at least makes
    // every comparison false and gets noticed; Infinity clears every threshold
    // and fills every CAP while looking like a result.
    it('throws on Infinity, which the previous Number.isNaN guard let pass', () => {
      expect(() => DecimalTransformer.from('Infinity')).toThrow(
        InvalidDecimalError,
      );
      expect(() => DecimalTransformer.from('-Infinity')).toThrow(
        InvalidDecimalError,
      );
    });

    // ⚠️ These pin what is still WRONG, so the gap cannot be lost. `Number()`'s
    // own coercions survive the fix; closing them needs a strict parser, which
    // means removing `Number()`, which means MoneyMinor — phase F4, blocked on
    // D-15/D-16/D-17.
    //
    // WHEN F4 LANDS these two tests are REVERSED, not deleted:
    //
    //     expect(() => DecimalTransformer.from('')).toThrow(InvalidDecimalError);
    //
    // and the `STILL WRONG:` prefix comes off the test name. Deleting them would
    // remove the only place the closed gap is named; reversing them keeps the
    // history of what the contract used to permit. Until then they go red the
    // moment someone tightens `Number()` by accident, which is the point.
    it('STILL WRONG: an empty string becomes 0 rather than an error (§2.5, awaiting F4)', () => {
      expect(DecimalTransformer.from('')).toBe(0);
      expect(DecimalTransformer.from('   ')).toBe(0);
    });

    it('STILL WRONG: hexadecimal and exponential literals are accepted (awaiting F4)', () => {
      expect(DecimalTransformer.from('0x10')).toBe(16);
      expect(DecimalTransformer.from('1e5')).toBe(100000);
    });
  });

  // T-098: the value must stay reachable for diagnosis and stay OUT of the
  // message, because `on-invoice.service.ts` persists `error.message` into an
  // entry's validation_errors — a message reaches storage, and from there a user.
  describe('error shape (T-098)', () => {
    const grab = (fn: () => unknown): InvalidDecimalError => {
      try {
        fn();
      } catch (e) {
        return e as InvalidDecimalError;
      }
      throw new Error('expected the call to throw, and it did not');
    };

    // The property is INVARIANCE, not the absence of a substring. Asserting the
    // message does not contain the value is a weaker test that can pass by
    // accident: `JSON.stringify(NaN)` is `"null"`, so a message interpolating the
    // value would still not contain the text "NaN". Comparing two throws with
    // different inputs pins what actually matters — the message cannot vary with
    // the value, therefore it cannot carry it.
    it('produces a message that does not depend on the offending value', () => {
      const a = grab(() => DecimalTransformer.from('not-a-number'));
      const b = grab(() => DecimalTransformer.from('0xZZ-different-value'));

      expect(a.message).toBe(b.message);
      expect(a.message).not.toContain('not-a-number');
    });

    it('keeps the offending value reachable in context, on both sides', () => {
      expect(
        grab(() => DecimalTransformer.from('not-a-number')).context,
      ).toEqual({ rawValue: 'not-a-number' });
      expect(grab(() => DecimalTransformer.to(NaN)).context.rawValue).toBeNaN();
    });
  });

  it('should pass values through unchanged on write', () => {
    expect(DecimalTransformer.to(500000)).toBe(500000);
    expect(DecimalTransformer.to(null)).toBeNull();
    expect(DecimalTransformer.to(undefined)).toBeUndefined();
  });

  // T-097 second half. `from` throwing is only safe if `to` cannot create the row
  // that makes it throw: measured, `numeric(15,2)` accepts NaN and returns it as
  // the text `NaN`, so without this the fix would turn a silently-null row into
  // one no repository could read at all — repair paths included.
  describe('non-finite write (T-097)', () => {
    it('refuses NaN instead of storing it — a NaN row would be unreadable after the read-side fix', () => {
      expect(() => DecimalTransformer.to(NaN)).toThrow(InvalidDecimalError);
    });

    it('refuses Infinity, which Number.isNaN would not have caught', () => {
      expect(() => DecimalTransformer.to(Infinity)).toThrow(
        InvalidDecimalError,
      );
      expect(() => DecimalTransformer.to(-Infinity)).toThrow(
        InvalidDecimalError,
      );
    });

    // This test is the reason the guard checks `typeof value === 'number'` before
    // `Number.isFinite`, and it is the only test here that can tell the two
    // shapes apart: a bare `!Number.isFinite(value)` throws on EVERY string, and
    // this codebase assigns numeric strings to money properties routinely. So it
    // is not a redundant pass-through case — it pins the narrowing itself.
    it('leaves numeric strings alone — the guard must reject non-finite numbers, not all non-numbers', () => {
      expect(DecimalTransformer.to('100.00' as unknown as number)).toBe(
        '100.00',
      );
      expect(DecimalTransformer.to('0' as unknown as number)).toBe('0');
    });
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
