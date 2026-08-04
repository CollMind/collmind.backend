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
 * That one place is `toMechanicInput` below. `buildMechanicValues` calls it on
 * the read side; `checkEnteredScale` calls it on the write side (C3). Nothing
 * else may re-derive "what does this number mean".
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

/* ------------------------------------------------------------------ *
 * C3 — WRITE-SIDE SCALE VALIDATION
 * ------------------------------------------------------------------ */

/**
 * How many decimal digits this number actually carries.
 *
 * Uses the shortest round-trip decimal string (`String(v)`), which is the
 * same text Postgres would receive, so "does this value survive
 * numeric(18,2)" is answered against the value that will really be sent —
 * not against a re-derived approximation. The exponential branch matters:
 * `String(1e-7)` is `"1e-7"`, whose naive `indexOf('.')` reading is 0
 * decimals, i.e. exactly backwards.
 */
export function decimalPlaces(value: number): number {
  const s = String(Math.abs(value));
  const e = s.indexOf('e');
  if (e === -1) {
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }
  const mantissa = s.slice(0, e);
  const exponent = Number(s.slice(e + 1));
  const dot = mantissa.indexOf('.');
  const mantissaDecimals = dot === -1 ? 0 : mantissa.length - dot - 1;
  return Math.max(0, mantissaDecimals - exponent);
}

export interface ScaleViolation {
  readonly code: string;
  readonly kind: MechanicInput['kind'];
  readonly value: number;
  readonly reason: string;
}

/**
 * Does this entry fit the column its scale routes it to?
 *
 * WHY THE WRITE SIDE, AND WHY THE GATE IS IN THE API RATHER THAN THE DB
 * The scale contract is defined by the `entered_*` columns (migration 1796).
 * But the planner's input does not reach those columns — it goes to the
 * `plan_fus.tactics` JSONB, which enforces nothing: a per-key scale constraint
 * cannot be expressed on a jsonb column (see this file's header). So the value
 * that violates the contract is accepted by the store, flows into KPI, spend
 * and approval, and is only rounded to the contract's precision if and when it
 * is ever materialised into a numeric column. The DB cannot be the gate here;
 * the API is the only place left. Rejecting at the write is also the only
 * point where the planner still knows what they meant. CLAUDE.md §2.5: an
 * unrepresentable input is an error, not a value to quietly adjust.
 *
 * THE RULE IS PER-BRANCH, AND THE BRANCHES ARE NOT SYMMETRIC.
 *
 *   rate        numeric(9,4)   percentage notation, bounded 0-100
 *   unitAmount  numeric(18,4)  TRY *per unit* — see the exemption below
 *   totalAmount numeric(18,2)  TRY total — sub-kuruş rejected
 *
 * ⚠️ `unitAmount` IS DELIBERATELY EXEMPT FROM THE SUB-KURUŞ RULE, AND THAT
 * EXEMPTION IS CORRECT. A per-unit amount is a PRICE, not a money total: a
 * support of 0.0125 TRY/unit over 800 000 units is 10 000 TRY, an ordinary
 * figure in this domain. Its column is numeric(18,4) precisely so those four
 * decimals survive. Applying "money has at most 2 decimals" here would
 * reject legitimate unit prices and push planners to round 0.0125 to 0.01 —
 * a 20% error on the resulting spend. The kuruş rule belongs to the value
 * that IS money (`totalAmount`), not to a rate that is multiplied into money
 * later. Do not "make the branches consistent".
 *
 * SCOPE, STATED SO THE SILENCE IS NOT READ AS A DECISION
 * - A tactics key with no matching active mechanic is not judged HERE, because
 *   it is an existence question rather than a scale one — but it IS decided:
 *   `unknownMechanicCodeError` in spend-calculation.service.ts raises a 400
 *   `UNKNOWN_MECHANIC_CODE`, and `PlanService#updateFuTactic` calls that same
 *   producer alongside this check. (An earlier revision of this comment claimed
 *   the question "has never been decided". That was wrong, and it was wrong for
 *   the reason CLAUDE.md §7 exists: the existing decision was never searched
 *   for. The correction is left visible here rather than quietly deleted.)
 * - Sub-0.0001 precision on `rate` and `unitAmount` is genuinely NOT decided,
 *   and neither is the sign question — a negative `totalAmount` or
 *   `unitAmount` passes today, while `rate` has a 0 floor. Only the
 *   `totalAmount` kuruş rule and the rate's 0-100 bound were settled. These
 *   gaps are recorded rather than closed by assumption (CLAUDE.md §2.4); see
 *   the C3 section of docs/verification/NUMERIC_CONTRACT_COLUMNS.md.
 */
export function checkEnteredScale(
  mechanic: Mechanic,
  raw: number,
): ScaleViolation | null {
  const input = toMechanicInput(mechanic, raw);
  const code = mechanic.code;

  // Precondition for every branch below: a non-finite number has no scale to
  // check, and reaches the driver as `NaN`/`Infinity` for a numeric column.
  if (!Number.isFinite(raw)) {
    return {
      code,
      kind: input.kind,
      value: raw,
      reason: 'value must be a finite number',
    };
  }

  switch (input.kind) {
    case 'rate':
      // Same bound as chk_pmv_rate_range on entered_rate_pct (migration 1796).
      // That CHECK does not fire on this request — the write lands in the
      // JSONB, not that column — so this is not a duplicate guard but the
      // enforcement of the same contract at the only layer that can enforce it
      // here. If the bound ever changes, both must move together.
      if (input.percent < 0 || input.percent > 100) {
        return {
          code,
          kind: 'rate',
          value: raw,
          reason: 'percentage must be between 0 and 100',
        };
      }
      return null;

    case 'unitAmount':
      // Exempt by design — see the ⚠️ block above before adding anything here.
      return null;

    case 'totalAmount':
      if (decimalPlaces(input.tryTotal) > 2) {
        return {
          code,
          kind: 'totalAmount',
          value: raw,
          reason:
            'a TRY total carries at most 2 decimals (kuruş); ' +
            'storing it would silently round the amount',
        };
      }
      return null;
  }
}

/**
 * Which `plan_mechanic_values` column carries this mechanic's entry.
 *
 * Derived from the SAME discriminator as `toMechanicInput` — `mechanic_type` —
 * so the column layer and the JSONB layer cannot disagree about what a mechanic
 * means. Two independent mappings is the failure this repo has recorded seven
 * times.
 */
export type EnteredColumn =
  | 'enteredRatePct'
  | 'enteredUnitAmount'
  | 'enteredTotalAmount';

export function enteredColumnFor(mechanic: Mechanic): EnteredColumn {
  switch (toMechanicInput(mechanic, 0).kind) {
    case 'rate':
      return 'enteredRatePct';
    case 'unitAmount':
      return 'enteredUnitAmount';
    case 'totalAmount':
      return 'enteredTotalAmount';
  }
}

/**
 * Read the entry from whichever semantic column this mechanic uses.
 *
 * ⚠️ The `?? 0` here is the same collapse `rawOf` makes — see T-078. Preserved
 * deliberately: C2b ports the reader, it does not decide the "no value vs zero"
 * question.
 */
export function readEnteredValue(
  pmv: Partial<Record<EnteredColumn, number | null | undefined>>,
  mechanic: Mechanic,
): number {
  return readEnteredRaw(pmv, mechanic) ?? 0;
}

/**
 * Null-preserving read — "no value entered" stays distinguishable from "zero
 * entered".
 *
 * Some callers depend on that distinction and must NOT go through
 * `readEnteredValue`: the min/max validation skips entirely when nothing was
 * entered, and collapsing null to 0 there would make it validate a value the
 * planner never typed. This is the same distinction T-078 will decide for the
 * arithmetic path; here it is already load-bearing, so it is preserved rather
 * than deferred.
 */
export function readEnteredRaw(
  pmv: Partial<Record<EnteredColumn, number | null | undefined>>,
  mechanic: Mechanic,
): number | null | undefined {
  return pmv[enteredColumnFor(mechanic)];
}

/**
 * "Was anything entered for this row?" — scale-independent, mechanic not needed.
 *
 * This is the one read that legitimately does NOT go through the derivation
 * point, and the reason is worth stating rather than leaving as an exception:
 * the caller does not need to know WHICH scale was entered, only whether an
 * entry exists. The DB `CHECK` (chk_pmv_at_most_one_entered, errata E12)
 * guarantees at most one of the three is non-null, so "any of the three is
 * non-null" is exactly equivalent to the old `entered_value != null`.
 *
 * Why it matters that this exists: the approval path loads
 * `planFus.planMechanicValues` WITHOUT the `mechanic` relation
 * (plan.repository.ts:70). Forcing that read through `enteredColumnFor` would
 * have required adding a join to the approval query — a change beyond
 * representation, on the approval path. Needing LESS than the derivation point
 * is not the same as bypassing it.
 */
export function hasEnteredValue(
  pmv: Partial<Record<EnteredColumn, number | null | undefined>>,
): boolean {
  return (
    pmv.enteredRatePct != null ||
    pmv.enteredUnitAmount != null ||
    pmv.enteredTotalAmount != null
  );
}
