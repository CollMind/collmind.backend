import {
  parseNumericText,
  parseOptionalNumericText,
  describeNumericTextFailure,
  NumericTextErr,
} from './numeric-text';

/**
 * Every cell of the measurement matrix in `0015-numeric-string-parsing-measurement.md`
 * becomes a case here — but against ONE parser instead of four, which is the point
 * of T-105.
 */

const ok = (input: string): string => {
  const r = parseNumericText(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} for ${input}`);
  return r.canonical;
};
const fail = (input: string): NumericTextErr => {
  const r = parseNumericText(input);
  if (r.ok)
    throw new Error(`expected failure, got ${r.canonical} for ${input}`);
  return r;
};

describe('parseNumericText (T-105)', () => {
  describe('formats that arrive today — none of these may change', () => {
    it.each([
      ['7250.00', '7250.00'], // our own CSV template
      ['400000', '400000'], // Wella actuals fixtures
      ['185.00', '185.00'], // e2e upload bodies
      ['0', '0'],
      ['-1234.56', '-1234.56'],
    ])('%s -> %s', (input, expected) => {
      expect(ok(input)).toBe(expected);
    });
  });

  describe('the two defects this replaces', () => {
    // 1000x too small in three parsers. `split('.').length > 2` demanded TWO
    // separators, so millions were right and 1.000,00–999.999,99 was wrong — the
    // most common range on an FMCG invoice.
    it.each([
      ['1.234,56', '1234.56'],
      ['1.000,00', '1000.00'],
      ['999.999,99', '999999.99'],
    ])('tr-TR %s -> %s (was 1000x too small)', (input, expected) => {
      expect(ok(input)).toBe(expected);
    });

    // 100x too big in the two invoice parsers, which deleted the comma.
    it('1234,56 -> 1234.56 (was 100x too big)', () => {
      expect(ok('1234,56')).toBe('1234.56');
    });
  });

  describe('both separators present — the last one is the decimal point', () => {
    it.each([
      ['1.234.567,89', '1234567.89'],
      ['1,234,567.89', '1234567.89'],
      ['1,234.56', '1234.56'],
    ])('%s -> %s', (input, expected) => {
      expect(ok(input)).toBe(expected);
    });

    // Grouping is validated, not assumed: a "thousands" separator that does not
    // group by three is not a thousands separator.
    it.each(['1.23.456,78', '12.34,56'])('rejects mis-grouped %s', (input) => {
      expect(fail(input).reason).toBe('MALFORMED');
    });
  });

  describe('ambiguity is refused, never guessed', () => {
    it.each(['1.234', '1,234', '12.345', '999,999'])(
      '%s is ambiguous',
      (input) => {
        expect(fail(input).reason).toBe('AMBIGUOUS_SEPARATOR');
      },
    );

    // The boundary, and the reason it sits at three: a thousands group is ALWAYS
    // exactly three digits, so these cannot be one.
    it.each([
      ['185.5', '185.5'],
      ['1.23', '1.23'],
      ['1.2345', '1.2345'],
      ['1,2', '1.2'],
    ])('%s is NOT ambiguous -> %s', (input, expected) => {
      expect(ok(input)).toBe(expected);
    });

    it('explains itself in a message a row-level error can carry', () => {
      expect(describeNumericTextFailure(fail('1.234'))).toContain('1.234');
      expect(describeNumericTextFailure(fail('1.234'))).toContain('Belirsiz');
    });
  });

  describe('the hazards that never arise because Number() is not used', () => {
    // Each of these is a live defect in DecimalTransformer, deferred there to F4.
    // Here they cannot happen: the grammar admits digits, dots and commas only.
    it.each(['Infinity', '-Infinity', '1e5', '1e999', '0x10', '0b101', 'abc'])(
      '%s is malformed, not silently converted',
      (input) => {
        expect(fail(input).reason).toBe('MALFORMED');
      },
    );

    it('an empty string is EMPTY, not zero', () => {
      expect(fail('').reason).toBe('EMPTY');
      expect(fail('   ').reason).toBe('EMPTY');
    });
  });

  // Without this, every assertion above would also pass on a parser that accepted
  // everything and returned the input unchanged.
  it('is not simply permissive', () => {
    expect(parseNumericText('12,34,56').ok).toBe(false);
    expect(parseNumericText('..').ok).toBe(false);
    expect(parseNumericText('1..2').ok).toBe(false);
    expect(parseNumericText('-').ok).toBe(false);
  });
});

describe('parseOptionalNumericText (T-105)', () => {
  // The customer importer used to return `undefined` for BOTH "not given" and
  // "unreadable", merging an absence with a §2.5 silent failure.
  it('returns undefined only for an absent value', () => {
    expect(parseOptionalNumericText(undefined)).toBeUndefined();
    expect(parseOptionalNumericText(null)).toBeUndefined();
    expect(parseOptionalNumericText('')).toBeUndefined();
    expect(parseOptionalNumericText('   ')).toBeUndefined();
  });

  it('reports an unreadable value as an error rather than an absence', () => {
    const r = parseOptionalNumericText('1.234');
    expect(r).toBeDefined();
    expect(r!.ok).toBe(false);
  });

  it('passes a readable value through', () => {
    const r = parseOptionalNumericText('1.234,56');
    expect(r!.ok).toBe(true);
    expect((r as { canonical: string }).canonical).toBe('1234.56');
  });
});
