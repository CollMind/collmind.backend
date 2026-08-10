import { pickCell, hasCellValue } from './pick-cell';

/**
 * T-107 adım 2 — `pickCell` is the primitive that replaced ~57 `row.a ||
 * row.b || row.c` alias chains across the three importers. Its whole reason
 * to exist is the one thing `||` cannot express: ABSENCE (`null`/
 * `undefined`) is not the same question as FALSY (`0`, `false`, `''`). See
 * the module's own docstring for the measured regression this closes.
 *
 * §2.7 lesson 6 ("kapsam var, ayırt etme gücü yok"): a suite that only ever
 * puts the real value in the FIRST key would never distinguish `pickCell`
 * from a correct-looking `??` chain that happened to work by accident of
 * position.
 *
 * ⚠️ MEASURED (T-107 adım 2 review, B4 — `pickCell` mutated back to an
 * `a || b || c` chain, all cases below re-run): the claim that used to sit
 * here — "every case below is exercised at least once with the real value
 * NOT in the first key, so a regression back to `||` would go red here" —
 * was wrong for exactly the two cases that put the value under the LAST
 * key with nothing after it. In a strict `||` chain, once the target value
 * is the FINAL operand, there is nothing left to override it — `a || b ||
 * c` and `pickCell(row, 'a', 'b', 'c')` agree whenever the correct value
 * sits at the chain's own tail, regardless of whether the value is `0`,
 * `false`, or truthy. Under this mutation both "LAST key" tests below
 * stayed GREEN; only the two "FIRST key" tests (and the single-key
 * presence-check case, for an unrelated reason — see its own comment) went
 * RED. The "LAST key" tests are still worth keeping — they pin the exact
 * shape `pick-cell.ts`'s docstring measures — but they are NOT regression
 * detectors for a `||`-reversion; only a case where the real value is
 * followed by at least one more alias in the chain is.
 */
describe('pickCell (T-107 adım 2)', () => {
  it('returns a real `false` sitting under the FIRST key', () => {
    expect(pickCell({ a: false, b: undefined }, 'a', 'b')).toBe(false);
  });

  // MEASURED (T-107 adım 2 review, B4): this does NOT distinguish pickCell
  // from an `a || b || c` chain — `c` is the chain's last operand, so
  // `undefined || null || false` and pickCell's "first present" scan agree
  // (`false`). Kept because it pins the exact shape `pick-cell.ts`'s own
  // docstring measures (a real `false`/`0` surviving under the LAST alias
  // spelling), NOT as a `||`-regression detector — see the file-level
  // comment above for the mutation that showed this.
  it('returns a real `false` sitting under the LAST key (pins the shape; does NOT by itself distinguish from `||` — see file header)', () => {
    expect(pickCell({ a: undefined, b: null, c: false }, 'a', 'b', 'c')).toBe(
      false,
    );
  });

  it('returns a real `0` sitting under the FIRST key', () => {
    expect(pickCell({ a: 0, b: 99 }, 'a', 'b')).toBe(0);
  });

  // MEASURED (T-107 adım 2 review, B4): same as the `false`/LAST-key case
  // above — `c` is the chain's last operand, so this does NOT distinguish
  // pickCell from `||`. Kept to pin the docstring's own measured shape
  // (creditLimit=0 surviving under a non-first alias), not as a regression
  // detector.
  it('returns a real `0` sitting under the LAST key (pins the shape; does NOT by itself distinguish from `||` — see file header)', () => {
    expect(pickCell({ a: null, b: undefined, c: 0 }, 'a', 'b', 'c')).toBe(0);
  });

  it("returns a real `''` (explicit blank string) — distinct from a genuinely absent cell", () => {
    expect(pickCell({ a: '' }, 'a')).toBe('');
  });

  it('treats `null` as absent and moves to the next alias', () => {
    expect(pickCell({ a: null, b: 'value' }, 'a', 'b')).toBe('value');
  });

  it('treats `undefined` as absent and moves to the next alias', () => {
    expect(pickCell({ a: undefined, b: 'value' }, 'a', 'b')).toBe('value');
  });

  it('returns `undefined` when every alias is absent', () => {
    expect(pickCell({ a: null, b: undefined }, 'a', 'b')).toBeUndefined();
  });

  it('returns `undefined` when none of the given keys exist on the row at all', () => {
    expect(pickCell({}, 'a', 'b', 'c')).toBeUndefined();
  });

  it('returns the FIRST present value, not the last, when multiple aliases are simultaneously present (header collision)', () => {
    expect(pickCell({ a: 'first', b: 'second' }, 'a', 'b')).toBe('first');
  });

  it('a single-key call behaves like a plain presence check', () => {
    expect(pickCell({ a: 'only' }, 'a')).toBe('only');
    expect(pickCell({ a: null }, 'a')).toBeUndefined();
  });
});

/**
 * T-107 adım 2 review (B1) — `hasCellValue` answers "is this ROW blank",
 * which `pickCell(...) !== undefined` answered wrongly for the CSV branch
 * (`csv-parser`'s blank-cell value is `''`, never `null`/`undefined` — see
 * `pick-cell.ts`'s own doc for the measured `,,,`-row-takes-down-the-whole-
 * file regression this closes). The bar is: `null`, `undefined`, and an
 * empty-after-trim string are "nothing was typed here"; a real `0` or
 * `false` — the exact values `pickCell` exists to stop losing — count as
 * PRESENT, same as any other value.
 */
describe('hasCellValue (T-107 adım 2 review, B1)', () => {
  it('a real `0` counts as present', () => {
    expect(hasCellValue({ a: 0 }, 'a')).toBe(true);
  });

  it('a real `false` counts as present', () => {
    expect(hasCellValue({ a: false }, 'a')).toBe(true);
  });

  it('a real string `"0"` counts as present', () => {
    expect(hasCellValue({ a: '0' }, 'a')).toBe(true);
  });

  it('`null` counts as absent', () => {
    expect(hasCellValue({ a: null }, 'a')).toBe(false);
  });

  it('`undefined` counts as absent', () => {
    expect(hasCellValue({ a: undefined }, 'a')).toBe(false);
  });

  it('an empty string counts as absent', () => {
    expect(hasCellValue({ a: '' }, 'a')).toBe(false);
  });

  it('a whitespace-only string counts as absent (the `,,,` CSV shape — csv-parser never trims)', () => {
    expect(hasCellValue({ a: '   ' }, 'a')).toBe(false);
  });

  it('checks every alias before declaring absence — a real `0` under a NON-first alias still counts as present', () => {
    expect(hasCellValue({ a: null, b: undefined, c: 0 }, 'a', 'b', 'c')).toBe(
      true,
    );
  });

  it('a row where every aliased column is blank is absent (the `,,,` CSV row shape)', () => {
    expect(hasCellValue({ a: '', b: '', c: undefined }, 'a', 'b', 'c')).toBe(
      false,
    );
  });

  it('returns `false` when none of the given keys exist on the row at all', () => {
    expect(hasCellValue({}, 'a', 'b', 'c')).toBe(false);
  });
});
