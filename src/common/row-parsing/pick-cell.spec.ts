import { pickCell } from './pick-cell';

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
 * position. Every case below is exercised at least once with the real value
 * NOT in the first key, so a regression back to `||`-shaped "first truthy"
 * selection would go red here specifically for that reason, not by luck.
 */
describe('pickCell (T-107 adım 2)', () => {
  it('returns a real `false` sitting under the FIRST key', () => {
    expect(pickCell({ a: false, b: undefined }, 'a', 'b')).toBe(false);
  });

  it('returns a real `false` sitting under the LAST key (the exact shape that leaked under `||`)', () => {
    expect(pickCell({ a: undefined, b: null, c: false }, 'a', 'b', 'c')).toBe(
      false,
    );
  });

  it('returns a real `0` sitting under the FIRST key', () => {
    expect(pickCell({ a: 0, b: 99 }, 'a', 'b')).toBe(0);
  });

  it('returns a real `0` sitting under the LAST key (the exact shape measured in the docstring: creditLimit=0 lost through a non-last alias)', () => {
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
