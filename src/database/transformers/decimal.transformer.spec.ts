import {
  DecimalTransformer,
  MoneyTransformer,
  UnitPriceTransformer,
  InvalidDecimalError,
} from './decimal.transformer';
import type { ValueTransformer } from 'typeorm';

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

/**
 * T-221: before commit `919da09`, `MoneyTransformer` was a full object alias of
 * `DecimalTransformer` (`export const MoneyTransformer = DecimalTransformer`),
 * and `UnitPriceTransformer.to`/`.from` were the SAME function references as
 * `DecimalTransformer.to`/`.from`. Neither fact was covered here — the whole
 * suite above only ever imports `DecimalTransformer`, so 36 assertions existed
 * for it and 0 for the other two exports. This section closes that gap.
 */
describe('MoneyTransformer / UnitPriceTransformer — behavioural pin (T-221)', () => {
  const transformers: Array<[string, ValueTransformer]> = [
    ['MoneyTransformer', MoneyTransformer],
    ['UnitPriceTransformer', UnitPriceTransformer],
  ];

  describe.each(transformers)('%s', (_name, transformer) => {
    it('preserves null/undefined on read', () => {
      expect(transformer.from!(null)).toBeNull();
      expect(transformer.from!(undefined)).toBeUndefined();
    });

    it('preserves null/undefined on write', () => {
      expect(transformer.to!(null)).toBeNull();
      expect(transformer.to!(undefined)).toBeUndefined();
    });

    it('converts numeric strings from the pg driver into numbers', () => {
      expect(transformer.from!('500000.00')).toBe(500000);
      expect(transformer.from!('99.99')).toBe(99.99);
    });

    it('passes finite values through unchanged on write', () => {
      expect(transformer.to!(500000)).toBe(500000);
      expect(transformer.to!(12.3456)).toBe(12.3456);
    });

    it('throws InvalidDecimalError on write for a non-finite number (NaN, Infinity, -Infinity)', () => {
      expect(() => transformer.to!(NaN)).toThrow(InvalidDecimalError);
      expect(() => transformer.to!(Infinity)).toThrow(InvalidDecimalError);
      expect(() => transformer.to!(-Infinity)).toThrow(InvalidDecimalError);
    });

    it('leaves numeric strings alone on write — narrowing is not shared-by-accident with DecimalTransformer only', () => {
      expect(transformer.to!('100.00' as unknown as number)).toBe('100.00');
    });

    it('throws InvalidDecimalError on read for unconvertible input', () => {
      expect(() => transformer.from!('not-a-number')).toThrow(
        InvalidDecimalError,
      );
      expect(() => transformer.from!('Infinity')).toThrow(
        InvalidDecimalError,
      );
    });

    // T-098: the message must not carry the raw value, on every transformer that
    // throws it — not just on DecimalTransformer, which is all the suite above
    // measured.
    it('produces a message that does not depend on the offending value (T-098)', () => {
      const grab = (fn: () => unknown): InvalidDecimalError => {
        try {
          fn();
        } catch (e) {
          return e as InvalidDecimalError;
        }
        throw new Error('expected the call to throw, and it did not');
      };

      const a = grab(() => transformer.from!('not-a-number'));
      const b = grab(() => transformer.from!('0xZZ-different-value'));

      expect(a.message).toBe(b.message);
      expect(a.message).not.toContain('not-a-number');
      expect(a.context).toEqual({ rawValue: 'not-a-number' });
    });
  });
});

/**
 * T-221: the measured defect was not "the three exports behave differently
 * today" — before the fix they behaved IDENTICALLY, which was the problem.
 * `MoneyTransformer` was `DecimalTransformer` (same object); `UnitPriceTransformer.to`
 * and `.from` were the same function references as `DecimalTransformer`'s. A
 * reference-identity check (below) is cheap and catches the object-alias shape
 * of the defect, but it does NOT catch a shared-body shape: if a future edit
 * introduced a `wrap(fn)` helper that returned three DIFFERENT closures which
 * all delegated to one shared inner function, `.to`/`.from` would be three
 * distinct references again while remaining coupled — the reference check
 * would stay green and the isolation would still be gone.
 *
 * The behavioural test below adds coverage the reference check cannot give:
 * mutating ONE transformer's `to`/`from` at runtime and measuring that the
 * other two do not move. It reproduces the shared-body shape of the defect —
 * Karar 6's future kuruş rounding landing in `MoneyTransformer.to` and
 * silently reaching `DecimalTransformer`'s 49 columns (or
 * `UnitPriceTransformer`'s, which K-2.1.12 exempts) — by actually installing
 * a rounding function and measuring the other two.
 *
 * ⚠️ IT IS NOT "THE ONE THAT ACTUALLY MATTERS" — an earlier revision of this
 * comment said so, and the measured matrix below it CONTRADICTS that: the
 * behavioural/patch test is BLIND to the `UnitPrice.to = Decimal.to` static
 * function-reference shape (2 red only under the reference check, 0 under
 * patch), while the reference-identity check is BLIND to a shared-primitive
 * shape (0 red under reference, 4 red under patch). Neither test subsumes the
 * other; both are needed to cover the shapes measured so far. Read the matrix
 * below before deciding which check "matters" — this paragraph does not
 * decide that.
 */
/**
 * ⚡ BU BLOĞUN NEYİ YAKALADIĞI — ÖLÇÜLDÜ (Team Lead, 2026-08-15).
 *
 * Dört mutasyon şekli, dördü de derlendi (`tsc` 0) ve testler GERÇEKTEN koştu
 * (başarısızlıklar assertion, derleme hatası değil — §2.7: derlenmeyen bir
 * mutasyon hiçbir şey kanıtlamaz):
 *
 *   mutasyon                                    referans  patch  passthrough
 *   ------------------------------------------  --------  -----  -----------
 *   `Money = Decimal` (obje takma adı)             ✅        ✅        —      7 kırmızı
 *      ↑ ORİJİNAL BLOCKER'ın ta kendisi
 *   `UnitPrice.to = Decimal.to` (statik fn adı)    ✅        ❌        ❌      2 kırmızı
 *   paylaşılan birincile yuvarlama koymak          ❌        ✅        ✅      4 kırmızı
 *      ↑ `K-2.1.12`'yi koruyan TEK kontrol
 *   `wrap()` fabrikası (ayrı closure, tek gövde)   ❌        ❌        ❌      38 YEŞİL
 *
 * ⚠️ İlk üç şekil için üç test türü de gerekli: hiçbiri diğerinin yerini
 * tutmuyor, ve her biri en az bir şekli TEK BAŞINA yakalıyor.
 *
 * Dördüncü satır bir kapsam boşluğu DEĞİL: `wrap()` davranışı değiştirmez, yani
 * ortada yakalanacak bir kusur yoktur. Ama bir risk ŞEKLİDİR — biri o paylaşılan
 * gövdeye `Karar 6` yuvarlamasını koyarsa, o an üçüncü satıra dönüşür ve
 * passthrough testleri kırmızıya döner.
 *
 * 📌 Bu matris bir düzeltmeden doğdu: testleri yazan ajan "davranışsal patch
 * testleri paylaşılan bir sarmalayıcıyı yakalar" dedi. Ölçüldü — YAKALAMIYOR
 * (dördüncü satır, 38/38 yeşil). Runtime patch bir objenin KENDİ property'sini
 * değiştirir; paylaşılan bir gövdeyi görmez. Yakalayan şey passthrough
 * assertion'larıdır, ve yalnız davranış gerçekten değiştiğinde.
 */
describe('transformer isolation — T-221', () => {
  it('DecimalTransformer, MoneyTransformer and UnitPriceTransformer are three distinct objects', () => {
    expect(MoneyTransformer).not.toBe(DecimalTransformer);
    expect(UnitPriceTransformer).not.toBe(DecimalTransformer);
    expect(MoneyTransformer).not.toBe(UnitPriceTransformer);
  });

  it('`to` is a distinct function reference on each of the three transformers', () => {
    expect(DecimalTransformer.to).not.toBe(MoneyTransformer.to);
    expect(DecimalTransformer.to).not.toBe(UnitPriceTransformer.to);
    expect(MoneyTransformer.to).not.toBe(UnitPriceTransformer.to);
  });

  it('`from` is a distinct function reference on each of the three transformers', () => {
    expect(DecimalTransformer.from).not.toBe(MoneyTransformer.from);
    expect(DecimalTransformer.from).not.toBe(UnitPriceTransformer.from);
    expect(MoneyTransformer.from).not.toBe(UnitPriceTransformer.from);
  });

  // ⚡ The behavioural test: patch one transformer's `to`/`from`, measure the
  // other two. Reference-identity alone cannot catch a shared-body regression
  // (see the block comment above); this can, because it reproduces the actual
  // failure shape — a rounding edit landing on one export and leaking into the
  // others.
  describe('patch one transformer at runtime, measure that the other two do not move', () => {
    const originalDecimalTo = DecimalTransformer.to;
    const originalDecimalFrom = DecimalTransformer.from;
    const originalMoneyTo = MoneyTransformer.to;
    const originalMoneyFrom = MoneyTransformer.from;

    const roundToTwoOnWrite = (value?: number | null) =>
      typeof value === 'number' ? Math.round(value * 100) / 100 : value;
    const roundToTwoOnRead = (value?: string | null) =>
      value === null || value === undefined
        ? value
        : Math.round(Number(value) * 100) / 100;

    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (DecimalTransformer as any).to = originalDecimalTo;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (DecimalTransformer as any).from = originalDecimalFrom;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MoneyTransformer as any).to = originalMoneyTo;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MoneyTransformer as any).from = originalMoneyFrom;

      // Restoration is measured, not assumed (CLAUDE.md §2.7): a failed
      // restore would leave every LATER test in this file running against a
      // patched transformer, which is exactly the kind of cross-test
      // contamination this afterEach exists to prevent.
      expect(DecimalTransformer.to).toBe(originalDecimalTo);
      expect(DecimalTransformer.from).toBe(originalDecimalFrom);
      expect(MoneyTransformer.to).toBe(originalMoneyTo);
      expect(MoneyTransformer.from).toBe(originalMoneyFrom);
    });

    it('patching DecimalTransformer.to with kuruş rounding does not move Money.to / UnitPrice.to', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (DecimalTransformer as any).to = roundToTwoOnWrite;

      expect(DecimalTransformer.to!(12.3456)).toBe(12.35); // patch landed
      expect(MoneyTransformer.to!(12.3456)).toBe(12.3456); // UNAFFECTED
      expect(UnitPriceTransformer.to!(12.3456)).toBe(12.3456); // UNAFFECTED
    });

    it('patching DecimalTransformer.from with kuruş rounding does not move Money.from / UnitPrice.from', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (DecimalTransformer as any).from = roundToTwoOnRead;

      expect(DecimalTransformer.from!('12.3456')).toBe(12.35); // patch landed
      expect(MoneyTransformer.from!('12.3456')).toBe(12.3456); // UNAFFECTED
      expect(UnitPriceTransformer.from!('12.3456')).toBe(12.3456); // UNAFFECTED
    });

    // This is the shape Karar 6 will actually land: rounding added to
    // MoneyTransformer.to specifically, because Money columns (not all
    // DecimalTransformer columns, not UnitPrice) are the kuruş-rule target.
    it('patching MoneyTransformer.to with kuruş rounding does not move Decimal.to / UnitPrice.to', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MoneyTransformer as any).to = roundToTwoOnWrite;

      expect(MoneyTransformer.to!(12.3456)).toBe(12.35); // patch landed
      expect(DecimalTransformer.to!(12.3456)).toBe(12.3456); // UNAFFECTED
      expect(UnitPriceTransformer.to!(12.3456)).toBe(12.3456); // UNAFFECTED
    });

    it('patching MoneyTransformer.from with kuruş rounding does not move Decimal.from / UnitPrice.from', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (MoneyTransformer as any).from = roundToTwoOnRead;

      expect(MoneyTransformer.from!('12.3456')).toBe(12.35); // patch landed
      expect(DecimalTransformer.from!('12.3456')).toBe(12.3456); // UNAFFECTED
      expect(UnitPriceTransformer.from!('12.3456')).toBe(12.3456); // UNAFFECTED
    });
  });
});
