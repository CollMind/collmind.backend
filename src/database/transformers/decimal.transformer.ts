import { ValueTransformer } from 'typeorm';

/**
 * TypeORM `decimal` sütunları driver seviyesinde string olarak döner
 * (pg parser BIGINT/NUMERIC güvenliği için). Bu transformer entity
 * sınırında sayıya çevirir; null/undefined korunur.
 */
export class InvalidDecimalError extends Error {
  constructor(value: unknown) {
    super(
      `Cannot read a decimal column value: ${JSON.stringify(value)} does not ` +
        `convert to a finite number. Refusing to hand a money path NaN or Infinity.`,
    );
    this.name = 'InvalidDecimalError';
  }
}

export const DecimalTransformer: ValueTransformer = {
  /**
   * T-097: the WRITE side rejects a non-finite number instead of storing it.
   *
   * This exists because of what the read side turned out to be. Measured
   * 2026-08-07, PostgreSQL 16, schema `main`:
   *
   *     insert into t (v numeric(15,2)) values ('NaN');  -> INSERT 0 1
   *     select v::text                                   -> NaN
   *     insert ... values ('Infinity');                   -> ERROR, numeric
   *                                                          field overflow
   *
   * `numeric(15,2)` STORES NaN and returns it as the text `NaN`; only ±Infinity
   * is refused, and only because these columns carry a scale. `pg` serialises
   * `NaN` with `String(value)`, so a service that assigns NaN to a money field
   * writes it silently — no CHECK constraint stands in the way (measured: zero
   * `contype='c'` in this schema).
   *
   * Without this guard, `from`'s throw would make such a row UNREADABLE through
   * the ORM — including by any repair path, since those go through repositories
   * too. Before T-097 the row read back as `null`: wrong, but recoverable. A read
   * guard is only safe when the write side cannot create what it refuses to read.
   *
   * The check is deliberately narrow — `typeof value === 'number'` first. The
   * declared parameter type is a claim, not a guarantee: this codebase assigns
   * numeric STRINGS to money properties in many places (that is the whole reason
   * the read side exists), and a bare `!Number.isFinite(value)` would reject
   * `"100.00"` and break working writes. Only an actual non-finite `number` —
   * always a bug, never a value — is refused here.
   *
   * Measured, not assumed: dropping the narrowing turns two tests red, and one of
   * them is the plain pass-through case, because `Number.isFinite(null)` is also
   * false — a bare guard would make every nullable money column unwritable. The
   * narrowing protects more than the string case that motivated it.
   */
  to: (value?: number | null): number | null | undefined => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new InvalidDecimalError(value);
    }
    return value;
  },

  /**
   * T-097: unconvertible input THROWS. It used to return `null`, which handed a
   * money path "no value" for something that was in fact unreadable —
   * CLAUDE.md §2.5, the silent-default prohibition, in the one place every money
   * column passes through.
   *
   * The check is `Number.isFinite`, not `Number.isNaN`. `Number.isNaN(Infinity)`
   * is false, so `"Infinity"` used to sail straight through as a money value.
   * That is worse than NaN: NaN makes every comparison false and eventually gets
   * noticed, while Infinity clears every threshold, fills every CAP, and
   * propagates into sums as a plausible-looking outcome.
   *
   * REACHABLE — see the measurement on `to` above. An earlier version of this
   * comment claimed the opposite ("not reachable from the database today"),
   * which was wrong for NaN and was corrected in the same task that wrote it.
   * That claim is worth remembering as a shape: "impossible" / "cannot happen" /
   * "unreachable" in a comment is a licence for the next reader to skip a guard,
   * so it has to be measured before it is written, not after.
   *
   * ⚠️ WHAT THIS DOES *NOT* CLOSE — do not read the check as input validation.
   * ALL of `Number()`'s implicit coercions survive. The four below are EXAMPLES,
   * not an exhaustive list (`"0b101"`, `"0o17"`, `" 12 "`, `".5"`, `"\t\n"` and
   * others behave the same way):
   *
   *     ""      -> 0        an empty string becomes ZERO, not an error.
   *                         §2.5's silent default, still here.
   *     "   "   -> 0        same
   *     "0x10"  -> 16       hexadecimal accepted
   *     "1e5"   -> 100000   exponential accepted — but only while it stays
   *                         finite: `"1e400"` overflows to Infinity and now
   *                         throws, so this one is half-closed by the fix above.
   *
   * Closing them means replacing `Number()` with a strict parser, and that is
   * not a local change: `Number()` is what makes this transformer lossy in the
   * first place (ADR 0007 F1, re-verified in the meta-repo's
   * `collmind.team:docs/analysis/0014-transformer-scope-measurement.md` — the
   * measurement and decision documents live there, not in this submodule), and
   * removing it means moving to `MoneyMinor`, which by definition changes every
   * reader of all five entities. That is phase F4, and F4 is blocked on the open
   * product questions D-15/D-16/D-17 (`collmind.team:docs/contracts/SYSTEM_INVARIANTS.md`).
   *
   * So this is a partial guarantee, and partial protection is more dangerous
   * than none when it is mistaken for the whole thing — which is why the gap is
   * written here rather than left for someone to infer from the code.
   *
   * ⚠️ The error message carries the raw column value. Measured 2026-08-07: no
   * global exception filter echoes `exception.message` (`main.ts` registers only
   * a `ValidationPipe`; the single filter is scoped to `NotFoundException`), so
   * Nest's default turns this into `{"statusCode":500,"message":"Internal server
   * error"}` and the value reaches the server log only — which is where it is
   * wanted, for diagnosis. Adding a filter that echoes messages would put a money
   * value in an HTTP response; that is the condition to re-check, not this line.
   */
  from: (value?: string | null): number | null | undefined => {
    if (value === null || value === undefined) return value;
    const num = Number(value);
    if (!Number.isFinite(num)) throw new InvalidDecimalError(value);
    return num;
  },
};
