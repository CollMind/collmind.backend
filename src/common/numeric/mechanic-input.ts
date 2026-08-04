/**
 * MechanicInput — the planner's raw entry, tagged with the scale it means.
 * ADR 0007 Karar 4 as corrected by errata E2, method J1 (docs/analysis/0013).
 *
 * WHY A UNION AND NOT A NUMBER
 * `plan_fus.tactics` is a `Record<string, number>` and stays one: a per-key
 * scale constraint cannot be expressed on a `jsonb` column, so changing its
 * shape (J2) would add no DB guarantee while breaking the API contract. The
 * scale therefore has to be resolved on read — and it must be resolved in
 * exactly ONE place, or the two resolutions drift.
 *
 * That one place is `toMechanicInput` below. `buildMechanicValues` calls it;
 * C3's write-side validation will call the same function. Nothing else may
 * re-derive "what does this number mean".
 *
 * WHAT THIS IS NOT
 * These carry plain `number`, not MoneyMinor/RateMicro. Converting the
 * arithmetic to branded types is representation change — ratchet work under
 * ADR 0007 K9, not F2. The union carries the DISTINCTION; the branded types
 * would carry the EXACTNESS. This phase delivers only the first.
 */

import { Mechanic, MechanicType } from '../../database/entities/mechanic.entity';

export type MechanicInput =
  /** Percentage notation, 0-100. PERCENT mechanics. */
  | { readonly kind: 'rate'; readonly code: string; readonly percent: number }
  /** TRY per unit. AMOUNT_PER_UNIT mechanics — a price, not a total. */
  | {
      readonly kind: 'unitAmount';
      readonly code: string;
      readonly tryPerUnit: number;
    }
  /** TRY total. AMOUNT mechanics (lumpsum). */
  | {
      readonly kind: 'totalAmount';
      readonly code: string;
      readonly tryTotal: number;
    };

/**
 * THE single derivation point. Scale comes from `mechanic_type`, which is the
 * discriminator the data already carries — measured live 2026-08-04, 6/6
 * mechanics consistent:
 *
 *   PERCENT          → rate         (on/off_invoice_discount)
 *   AMOUNT_PER_UNIT  → unitAmount   (per_unit_support)
 *   AMOUNT           → totalAmount  (lumpsum_spend)
 *
 * An unrecognised type throws rather than defaulting: guessing a scale is how a
 * percentage becomes a TRY amount silently (CLAUDE.md §2.5).
 */
export function toMechanicInput(mechanic: Mechanic, raw: number): MechanicInput {
  switch (mechanic.mechanicType) {
    case MechanicType.PERCENT:
      return { kind: 'rate', code: mechanic.code, percent: raw };
    case MechanicType.AMOUNT_PER_UNIT:
      return { kind: 'unitAmount', code: mechanic.code, tryPerUnit: raw };
    case MechanicType.AMOUNT:
      return { kind: 'totalAmount', code: mechanic.code, tryTotal: raw };
    default:
      throw new Error(
        `Cannot determine scale for mechanic "${mechanic.code}": ` +
          `unrecognised mechanic_type "${mechanic.mechanicType}". ` +
          `Refusing to guess — see ADR 0007 Karar 4.`,
      );
  }
}

/**
 * Collapse the union back to the raw number the existing arithmetic expects.
 *
 * ⚠️ THIS IS WHERE THE DISTINCTION IS DELIBERATELY LOST — see T-078.
 *
 * `?? 0` folds two different states into one: "no value entered for this
 * mechanic" and "the planner entered zero". Those are not the same thing —
 * in lumpsum distribution, receiving a zero share and receiving no share are
 * different outcomes, and ADR 0006 Karar 2 ("a null-base SKU gets no share")
 * lives in exactly that family.
 *
 * It is kept for now because the BUSINESS consequence has not been measured.
 * Making it visible before measuring risks surfacing the right error in the
 * wrong place. T-078 carries that measurement.
 *
 * The union above means the distinction is now CARRIED IN THE TYPE and only
 * collapsed here — so T-078 reduces to applying a decision at the four unwrap
 * sites, not to building a new data path.
 */
export function rawOf(input: MechanicInput | undefined): number {
  if (!input) return 0;
  switch (input.kind) {
    case 'rate':
      return input.percent;
    case 'unitAmount':
      return input.tryPerUnit;
    case 'totalAmount':
      return input.tryTotal;
  }
}
