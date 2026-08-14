import { ValueTransformer } from 'typeorm';

/**
 * TypeORM `decimal` sütunları driver seviyesinde string olarak döner
 * (pg parser BIGINT/NUMERIC güvenliği için). Bu transformer entity
 * sınırında sayıya çevirir; null/undefined korunur.
 */
/**
 * T-098: the offending value lives in `context`, NOT in `message`.
 *
 * The message is persisted and returned. Measured: `on-invoice.service.ts` writes
 * `error.message` into the `validation_errors` JSONB of an entry, so anything in
 * the message reaches storage and, from there, a user. A money value must not
 * make that trip.
 *
 * The message alone is therefore not diagnostic on purpose — it says WHAT failed,
 * never WITH WHAT. Splitting them is what makes it unnecessary to audit every
 * catch block that touches a message: there is one place the value can leak from,
 * and it is closed here.
 *
 * ⚠️ `context` DOES NOT REACH A LOG ON ITS OWN. An earlier version of this comment
 * said it did ("which the logger prints"), and review measured that false: Nest's
 * ConsoleLogger renders an Error argument through `Error.toString()`, so a bare
 * `logger.warn(msg, err)` prints the redacted message and drops both `context` and
 * the stack. Redacting the message without changing the call sites would not have
 * moved the value — it would have deleted it.
 *
 * Callers must pass `diagnosticsOf(err)` (`src/common/errors/diagnostics.ts`).
 * That is the second time in two tasks an unmeasured "…and it is still available
 * over there" claim went into a comment; the rule is in CLAUDE.md §2.7 now, and
 * this comment is the counter-example it was written from.
 */
export class InvalidDecimalError extends Error {
  readonly context: { rawValue: unknown };

  constructor(value: unknown) {
    super(
      'Unreadable decimal column value: it does not convert to a finite ' +
        'number. Refusing to hand a money path NaN or Infinity.',
    );
    this.name = 'InvalidDecimalError';
    this.context = { rawValue: value };
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
   * ⚠️ The error message NO LONGER carries the raw column value — see
   * `InvalidDecimalError` above. An earlier version of this comment said the value
   * "reaches the server log only", having measured exception FILTERS and found
   * none that echo messages. That was wrong twice over, and both ways are worth
   * knowing:
   *
   *   - it can leak by being WRITTEN. `on-invoice.service.ts` persisted
   *     `error.message` into an entry's `validation_errors`.
   *   - it can leak by being RETHROWN. Nest echoes the message of an explicitly
   *     thrown HttpException, so any `throw new BadRequestException(\`…${message}\`)`
   *     puts it in the response body without a filter being involved —
   *     `approval-workflow.service.ts` and `on-invoice.service.ts` both do this.
   *
   * Measuring "which filters echo messages" answered a narrower question than the
   * one being asked. Where a value GOES has at least three ends — returned,
   * rethrown, stored — and a sweep of one of them proves nothing about the others
   * (CLAUDE.md §7.1).
   */
  from: (value?: string | null): number | null | undefined => {
    if (value === null || value === undefined) return value;
    const num = Number(value);
    if (!Number.isFinite(num)) throw new InvalidDecimalError(value);
    return num;
  },
};

/**
 * MoneyTransformer / UnitPriceTransformer — T-197/T-221 ikinci yarı (2026-08-14).
 *
 * Ürün sahibi kararı: **İKİ transformer**, ayrım kolonun ÖLÇEĞİYLE değil
 * SEMANTİĞİYLE:
 *
 *   MoneyTransformer      Alan A para        iki ondalık, kuruş kuralı
 *   UnitPriceTransformer  birim fiyat        dört ondalık, kuruş kuralından
 *                                            MUAF (`K-2.1.12`)
 *
 * BUGÜN İKİSİ AYNI DAVRANIYOR — ve bu bilerek böyle. `to`/`from` yalnız pg
 * sürücüsünün string↔number sınırını kapatıyor (Number()/finite-check); ADR
 * 0007 Karar 6'nın kuruş yuvarlama yardımcısı henüz yazılmadı (Uygulama sırası
 * adım 3, tamamlanmadı). Yardımcı yazıldığında yalnız `MoneyTransformer.to`
 * değişecek — `UnitPriceTransformer` K-2.1.12 gereği o değişikliğin dışında
 * kalmak ZORUNDA, bu yüzden ayrı bir nesne (aynı fonksiyonların referansı olsa
 * bile `DecimalTransformer`'ın kendisiyle aynı obje DEĞİL): `MoneyTransformer`
 * bir noktada kendi `to`'sunu değiştirdiğinde `UnitPriceTransformer`'ın onu
 * sessizce miras almaması gerekiyor, ve bunu obje kimliği garanti ediyor.
 *
 * `DecimalTransformer` adı KORUNUYOR — 49 kolonda (`plan`, `budget-allocation`,
 * `budget-envelope`, `budget-summary`, `sales-actual*`) hâlihazırda kullanılan,
 * T-097/T-098'in sertleştirdiği isim. Yeniden adlandırmak o dosyaları
 * gerekçesiz değiştirir (§7: "yeniden icat etme"). `MoneyTransformer` onun
 * ADR 0007'nin istediği isimle takma adıdır — YENİ bir implementasyon değil.
 */
export const MoneyTransformer: ValueTransformer = DecimalTransformer;

export const UnitPriceTransformer: ValueTransformer = {
  to: DecimalTransformer.to,
  from: DecimalTransformer.from,
};
