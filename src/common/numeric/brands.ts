/**
 * Branded numeric scales — ADR 0007 Karar 3a (as corrected by errata E1).
 *
 * WHAT A BRAND ACTUALLY DOES — measured, not assumed
 * ADR Karar 3a originally claimed `MoneyMinor * RateMicro` is a compile error.
 * It is not. Measured on TypeScript 5.9.3 (see docs/analysis/0013 §3.1):
 *
 *   const prod  = m * r;                 // COMPILES  (typeof prod === number)
 *   const wide: number     = m * r;      // COMPILES  <- the leak
 *   const stored: MoneyMinor = m * r;    // TS2322    <- the real gate
 *   m > r                                // COMPILES  (cross-brand compare not caught)
 *   m as RateMicro                       // TS2352    (direct cross-cast IS caught)
 *   n as unknown as MoneyMinor           // COMPILES  <- closed by ESLint, not by tsc
 *
 * So the brand is not an OPERATOR gate, it is a SLOT gate: you may write the
 * arithmetic, but you cannot store the result anywhere that is branded. That
 * moves enforcement to the persistence boundary — which is exactly where ADR
 * 0007 wants it.
 *
 * TWO CONSEQUENCES, both load-bearing:
 *
 * 1. A plain `number` slot bypasses the gate completely. Hence the rule in
 *    errata E1 / K3: in new modules no entity column, DTO field or repository
 *    signature carrying money or rate may be typed `number`. Without that rule
 *    these brands are decoration. It is enforced by the number-slot ESLint rule
 *    (see .eslintrc.js) over the paths declared in scripts/guards/new-modules.txt.
 *
 * 2. Even same-scale addition widens to `number` (`m + m` is not MoneyMinor).
 *    So every operation must go through a helper. The helper module is not a
 *    convenience layer, it is structural.
 *
 * EXTENSIBILITY (ADR 0007 A7)
 * A third brand (VolumeMilli, deferred to D-07) is added by declaring another
 * `Scale` member and its alias below — nothing else changes. Helper signatures
 * are written against `Branded<S>` or against one concrete scale, never against
 * a closed union of "the two brands", so adding a third does not touch them.
 */

/** Scale tags. Add a member to introduce a new brand — see A7 note above. */
export type Scale = 'money' | 'rate';

/**
 * The brand carrier. `number & {…}` keeps runtime cost at exactly zero: a
 * branded value IS a number at runtime, the tag exists only in the type system.
 */
export type Branded<S extends Scale> = number & { readonly __scale: S };

/** Money in minor units (kuruş). 1 TRY === 100 MoneyMinor. */
export type MoneyMinor = Branded<'money'>;

/**
 * Rate in micro units: 1 RateMicro === 0.0001 percent.
 * So 3.25% === 32500 RateMicro.
 *
 * NAMING (errata E3): the ADR first called this `RateBps`. A basis point is
 * 0.01% — this scale is 1/100 of that, so `RateBps` promised 325 where the
 * value is 32500. Name and scale must agree; `Micro` is the honest prefix for
 * 1e-6 of unity (0.0001% === 1e-6).
 */
export type RateMicro = Branded<'rate'>;

/** Runtime scale factors. Exported so tests can assert against them rather than
 * re-typing magic numbers (a second copy of 100 is a second source of truth). */
export const MONEY_SCALE = 100; // minor units per TRY
export const RATE_SCALE = 1_000_000; // micro units per unit (i.e. per 100%)
export const RATE_PERCENT_SCALE = 10_000; // micro units per 1 percent
