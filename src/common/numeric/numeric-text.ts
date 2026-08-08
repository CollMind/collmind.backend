/**
 * T-105: the one place a human-written number becomes a canonical numeric literal.
 *
 * Replaces four separate implementations that disagreed with each other
 * (`docs/analysis/0015-numeric-string-parsing-measurement.md` in the meta-repo).
 * Measured before this existed:
 *
 *     "1.234,56"  ->  1.23456   in three of them   (1000x too SMALL)
 *     "1234,56"   ->  123456    in two of them     (100x too BIG)
 *     "1.234,56"  ->  undefined in the fourth      (silently dropped)
 *
 * The same character meant opposite things in two parsers of the same product:
 * one read `,` as a decimal point, another deleted it as a thousands separator.
 *
 * IT RETURNS A STRING, NOT A NUMBER — and that is the design, not an oversight.
 *
 * Producing a `number` here would make this an IEEE-754 entry point on a money
 * path, which is exactly what the money-float guard exists to find. Writing the
 * digit accumulation by hand would hide it from the detector without changing the
 * risk by one bit — a filter that looks right and does nothing, inverted. So this
 * module hands back a canonical literal and lets each caller convert with the
 * primitive that suits it:
 *
 *     money      ->  moneyFromNumericString(canonical)   exact, minor units
 *     counts     ->  Number(canonical)                   safe: regex-constrained
 *
 * `Number()` on the output is safe in a way `Number()` on raw input never was: the
 * grammar below admits only `-?\d+(\.\d+)?`, so none of `""` -> 0, `"0x10"` -> 16,
 * `"1e5"` -> 100000 or `"Infinity"` -> Infinity can occur. Those four hazards —
 * still open in `DecimalTransformer` and deferred there to phase F4 — cannot arise
 * here at all. That is what "strict parser" buys, and it is why this file needs no
 * entry in `exactness-primitives.txt`: it contains no float entry point to exempt.
 *
 * ⚠️ BEHAVIOURAL TWIN: `collmind.frontend/src/utils/numberUtils.ts`
 *
 * The frontend carries the same grammar, because the two repos share no package
 * (measured T-106: no root `package.json`, no workspace, separate remotes). IF THE
 * GRAMMAR CHANGES HERE IT MUST CHANGE THERE — and `numberUtils.test.ts` mirrors
 * this module's spec case for case, so a divergence turns that suite red.
 *
 * The reference is written on both sides deliberately. A test catches divergence
 * only once someone has thought to update it; a pointer in the file makes the
 * person editing the grammar look at the other copy while they are editing.
 *
 * AMBIGUITY IS REFUSED, NEVER GUESSED (product decision, 2026-08-07)
 *
 *     "1.234"  ->  1234? or 1.234?  Unknowable. REJECTED.
 *
 * Guessing is what produced the 1000x defect: the old code guessed "thousands"
 * only when it saw two or more separators, and guessed "decimal" otherwise. A
 * wrong guess on money is a wrong number that looks like a right one.
 */

export type NumericTextFailure =
  /** Empty or whitespace-only. Callers decide whether that is an error. */
  | 'EMPTY'
  /** A single separator followed by exactly three digits: `1.234`, `1,234`. */
  | 'AMBIGUOUS_SEPARATOR'
  /** Anything the grammar does not admit, including `Infinity` and `1e5`. */
  | 'MALFORMED';

export interface NumericTextOk {
  readonly ok: true;
  /** Canonical `-?\d+(\.\d+)?`. Safe to hand to `moneyFromNumericString`. */
  readonly canonical: string;
}

export interface NumericTextErr {
  readonly ok: false;
  readonly reason: NumericTextFailure;
  readonly input: string;
}

export type NumericTextResult = NumericTextOk | NumericTextErr;

/**
 * Turkish-language message for a row-level rejection, safe to show a user.
 *
 * ⚠️ EVERY SUGGESTION THIS RETURNS MUST PARSE. The first version suggested
 * `'1,234,00'` (which this parser rejects) and, for `12345.678`, `'12345678'` —
 * a number a THOUSAND times larger than one of the two readings. A parser that
 * refuses to guess and then hands the user a wrong guess has moved the defect into
 * the error message. `suggestionsParse` in the spec feeds these back in.
 */
export function describeNumericTextFailure(err: NumericTextErr): string {
  switch (err.reason) {
    case 'EMPTY':
      return 'Sayı değeri boş.';
    case 'AMBIGUOUS_SEPARATOR': {
      const [whole, frac] = err.input.replace(/^[+-]/, '').split(/[.,]/);
      // Both readings, each written in a form the grammar accepts. The decimal one
      // gets a fourth digit precisely because three would be ambiguous again.
      return (
        `Belirsiz sayı biçimi: '${err.input}'. ` +
        `Binlik ayraç kastediyorsanız '${whole}${frac}', ` +
        `ondalık kastediyorsanız '${whole},${frac}0' yazın.`
      );
    }
    case 'MALFORMED':
      return `Geçersiz sayı biçimi: '${err.input}'.`;
  }
}

const DIGITS_ONLY = /^\d+$/;

/**
 * A thousands group is ALWAYS exactly three digits, and the leading group is one
 * to three. This is the fact the whole grammar rests on: it is what makes
 * `1.234` ambiguous and `1.23` not.
 */
function isThousandsGrouped(parts: string[]): boolean {
  if (parts.length < 2) return false;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

export function parseNumericText(input: unknown): NumericTextResult {
  if (input === null || input === undefined) {
    return { ok: false, reason: 'EMPTY', input: '' };
  }

  const raw = String(input).trim();
  if (raw === '') return { ok: false, reason: 'EMPTY', input: raw };

  const signMatch = /^([+-]?)(.*)$/.exec(raw);
  const sign = signMatch![1] === '-' ? '-' : '';
  const body = signMatch![2];
  if (body === '') return { ok: false, reason: 'MALFORMED', input: raw };

  // Only digits, dots and commas may appear. This is where `Infinity`, `1e5`,
  // `0x10`, currency symbols and stray whitespace are refused — by the grammar,
  // not by a special case for each.
  if (!/^[\d.,]+$/.test(body)) {
    return { ok: false, reason: 'MALFORMED', input: raw };
  }

  const hasDot = body.includes('.');
  const hasComma = body.includes(',');

  // (1) No separator at all: plain integer.
  if (!hasDot && !hasComma) {
    return DIGITS_ONLY.test(body)
      ? { ok: true, canonical: `${sign}${body}` }
      : { ok: false, reason: 'MALFORMED', input: raw };
  }

  // (2) BOTH separators present: the LAST one is the decimal point, the other is
  // the thousands separator. Nothing to guess — `1.234,56` and `1,234.56` are
  // each unambiguous, and they are the two forms real locales produce.
  if (hasDot && hasComma) {
    const decimalSep =
      body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    const groupSep = decimalSep === '.' ? ',' : '.';
    const [wholePart, ...rest] = body.split(decimalSep);
    if (rest.length !== 1)
      return { ok: false, reason: 'MALFORMED', input: raw };
    const frac = rest[0];
    if (!DIGITS_ONLY.test(frac)) {
      return { ok: false, reason: 'MALFORMED', input: raw };
    }
    const groups = wholePart.split(groupSep);
    if (!isThousandsGrouped(groups)) {
      return { ok: false, reason: 'MALFORMED', input: raw };
    }
    return { ok: true, canonical: `${sign}${groups.join('')}.${frac}` };
  }

  // (3) ONE kind of separator.
  const sep = hasDot ? '.' : ',';
  const parts = body.split(sep);

  // (3a) It appears more than once: it can only be a thousands separator, and the
  // grouping must be exact. `1.234.567` -> 1234567.
  if (parts.length > 2) {
    return isThousandsGrouped(parts)
      ? { ok: true, canonical: `${sign}${parts.join('')}` }
      : { ok: false, reason: 'MALFORMED', input: raw };
  }

  // (3b) It appears exactly once.
  const [whole, frac] = parts;
  if (!DIGITS_ONLY.test(whole) || !DIGITS_ONLY.test(frac)) {
    return { ok: false, reason: 'MALFORMED', input: raw };
  }

  // THE AMBIGUOUS CASE, and the only one. It needs BOTH sides to be checkable as a
  // thousands grouping, which is why two conditions appear here and not one:
  //
  //   right side: exactly three digits  — a group is always exactly three
  //   left  side: one to three digits   — so is the LEADING group
  //
  // `1.234` satisfies both, so it could be 1234 or 1.234, and is refused.
  // `1234.567` satisfies only the first: `1234` is not a legal leading group, so
  // the thousands reading is impossible and the value can only be 1234.567.
  //
  // The first version of this check looked at `frac` alone and rejected
  // `1234.567` too — the shape an ERP exports a three-decimal quantity in, read
  // correctly before T-105. Refusing what we CAN read is not caution; it is the
  // same failure as guessing, pointed the other way.
  // A leading thousands group never starts with 0: 125 is written `125`, never
  // `0,125`. So `0.125` can only be a decimal. Found by the frontend twin's
  // round-trip test (T-110) and applied here to keep the two identical.
  if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(whole)) {
    return { ok: false, reason: 'AMBIGUOUS_SEPARATOR', input: raw };
  }

  return { ok: true, canonical: `${sign}${whole}.${frac}` };
}

/**
 * Optional-field wrapper. `undefined` means ABSENT and nothing else.
 *
 * Deliberately separate from `parseNumericText`: the customer importer used to
 * return `undefined` for both "no value given" and "value was unreadable", which
 * merged a legitimate absence with a §2.5 silent failure. Here an unreadable value
 * still comes back as an error the caller must handle.
 */
export function parseOptionalNumericText(
  input: unknown,
): NumericTextResult | undefined {
  if (input === null || input === undefined) return undefined;
  if (String(input).trim() === '') return undefined;
  return parseNumericText(input);
}
