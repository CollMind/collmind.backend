import {
  readEnteredRaw,
  readEnteredValue,
  numericTextToNumber,
} from '../../../common/numeric/mechanic-input';
import {
  rateFromNumericString,
  rateToPercent,
} from '../../../common/numeric/rate';
import {
  moneyFromNumericString,
  moneyToMajorUnits,
} from '../../../common/numeric/money';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan, PlanFu } from '../../../database/entities/plan.entity';
import {
  Mechanic,
  MechanicCategory,
} from '../../../database/entities/mechanic.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { BudgetAllocationService } from '../budget/budget-allocation.service';
import { MechanicService } from '../../master-data/mechanic/mechanic.service';
import {
  InputValidationResult,
  CombinationValidationResult,
  BudgetValidationResult,
  PreSubmissionValidation,
  ValidationError,
  ErrorSeverity,
  ErrorCategory,
} from './dto/validation-result.dto';
import { BudgetCheckContext } from '../budget/dto/budget-check-context.dto';

@Injectable()
export class SpendValidationService {
  private readonly logger = new Logger(SpendValidationService.name);

  // Configurable thresholds
  private readonly MAX_ON_INVOICE_DISCOUNT = 50; // Warning threshold
  private readonly MAX_OFF_INVOICE_DISCOUNT = 30; // Warning threshold
  private readonly MAX_COMBINED_DISCOUNT = 60; // Hard limit
  private readonly BUDGET_WARNING_THRESHOLD = 80; // %

  constructor(
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(PlanFu)
    private readonly planFuRepository: Repository<PlanFu>,
    @InjectRepository(Mechanic)
    private readonly mechanicRepository: Repository<Mechanic>,
    @InjectRepository(PlanMechanicValue)
    private readonly planMechanicValueRepository: Repository<PlanMechanicValue>,
    private readonly budgetAllocationService: BudgetAllocationService,
    private readonly mechanicService: MechanicService,
  ) {}

  /**
   * Validate all inputs for a FU
   */
  async validateInputs(
    tenantId: string,
    planFuId: string,
  ): Promise<InputValidationResult> {
    const planFu = await this.planFuRepository.findOne({
      where: { id: planFuId, tenantId },
      relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
    });

    if (!planFu) {
      throw new Error(`Plan FU with ID ${planFuId} not found`);
    }

    const errors: ValidationError[] = [];

    for (const pmv of planFu.planMechanicValues || []) {
      const mechanic = pmv.mechanic;
      if (!mechanic) continue;

      // F2/C2b-2: read from the semantic column via the shared derivation
      // point. `readEnteredRaw` (not `readEnteredValue`) because the null check
      // below IS the semantics — an empty entry is skipped, not validated as 0.
      const enteredValue = readEnteredRaw(pmv, mechanic);
      if (enteredValue === null || enteredValue === undefined) {
        continue; // Skip empty values
      }

      // Type validation
      if (mechanic.inputType === 'percentage') {
        if (enteredValue < 0 || enteredValue > 100) {
          errors.push({
            severity: ErrorSeverity.ERROR,
            category: ErrorCategory.INPUT_ERROR,
            message: `${mechanic.name}: Percentage must be between 0 and 100`,
            field: mechanic.code,
            fuId: planFuId,
            suggestion: `Enter a value between 0 and 100`,
          });
        }
        // T-085: the decimal-places check that used to sit here is GONE, and it
        // could not have been repaired in place.
        //
        // It read `enteredValue.toString().split('.')[1].length`. The value is a
        // transformer-less `numeric` column, so it is already a string padded to
        // the column's scale: `entered_rate_pct` is `numeric(9,4)` and hands back
        // "5.0000" whatever the planner typed. The check therefore measured the
        // COLUMN SCALE, not the entry — it answered 4 every time and reported
        // "Maximum 2 decimal places allowed" for every percentage mechanic,
        // including a plain 10%. Four of the six seeded mechanics tripped it.
        //
        // It cannot be fixed by parsing better: the information it wants is gone
        // by the time this code runs. `numeric(9,4)` pads on write, and how many
        // places the planner actually typed is not recoverable from storage.
        //
        // The rule belongs at the write boundary, where the input still exists —
        // and that is where it already is: `checkEnteredScale` (F2/C3) rejects
        // sub-kuruş values on the one column whose scale makes that meaningful,
        // before anything is stored. Verified before removing this: the write
        // path is closed — `AddFuDto.tactics` was removed in T-079, so
        // `updateFuTactic` is the only route to `plan_fus.tactics` and the gate
        // runs ahead of its write.
        //
        // ⚠️ CONSEQUENCE, RECORDED SO IT IS NOT REDISCOVERED AS A BUG:
        // `PRICE_SUP` (AMOUNT_PER_UNIT, `numeric(18,4)`) now has NO decimal
        // limit. That is correct. C3 exempts unit amounts from the kuruş rule on
        // purpose — a per-unit price legitimately carries four decimals, and
        // 0.0125 TRY/unit over 800 000 units is an ordinary figure. A two-decimal
        // limit on a four-decimal column was the wrong rule, not a missing one.
      } else if (mechanic.inputType === 'currency') {
        if (enteredValue < 0) {
          errors.push({
            severity: ErrorSeverity.ERROR,
            category: ErrorCategory.INPUT_ERROR,
            message: `${mechanic.name}: Amount cannot be negative`,
            field: mechanic.code,
            fuId: planFuId,
          });
        }
        // T-085: decimal-places check removed — see the percentage branch above.
      } else if (mechanic.inputType === 'units') {
        if (enteredValue < 0) {
          errors.push({
            severity: ErrorSeverity.ERROR,
            category: ErrorCategory.INPUT_ERROR,
            message: `${mechanic.name}: Units cannot be negative`,
            field: mechanic.code,
            fuId: planFuId,
          });
        }
        // T-085: `Number.isInteger(enteredValue)` and the decimal count that sat
        // behind it are both gone. The gate was broken in its own right —
        // `Number.isInteger("1.0000")` is ALWAYS false for a string, so every
        // units entry fell through to the count — and the count itself measured
        // the column scale rather than the entry. See the percentage branch.
      }

      // Min/Max validation.
      //
      // T-085: BOTH SIDES are normalised before comparing, regardless of which
      // shape either one arrives in. AT THE TIME OF THE FIX, `enteredValue` came
      // straight off a transformer-less `numeric` column and `mechanic.minValue`
      // / `maxValue` — `numeric(18,4)`, still transformer-less today — were the
      // same, so this used to be a STRING comparison, wrong in both directions:
      //
      //   "5.0000"  < "10.0000"   ->  false   a real min violation, MISSED
      //   "50.0000" > "100.0000"  ->  true    a valid value, REPORTED
      //
      // Lexicographic order, on a live route (GET /spend-calculation/
      // validate-inputs/:planFuId). The missed violation is the worse half: it
      // is silent, on a financial validation path (CLAUDE.md §2.5).
      //
      // ⚠️ "`enteredValue` comes straight off a transformer-less numeric column"
      // IS NOW ONLY TRUE FOR A PERCENT MECHANIC (review, T-197/T-221,
      // 2026-08-15). `entered_unit_amount`/`entered_total_amount` carry
      // `UnitPriceTransformer`/`MoneyTransformer` as of this turn, so
      // `enteredValue` is a `number` for AMOUNT_PER_UNIT/AMOUNT mechanics and a
      // `string` for PERCENT — `numericTextToNumber` below handles either
      // (`typeof value === 'number' ? value : …parse…`), which is why this gate
      // needed no code change, only this comment's premise corrected.
      // `mechanic.minValue`/`maxValue` remain transformer-less on BOTH sides of
      // this comparison regardless of mechanic type.
      //
      // The sibling comparisons in this method are NOT affected and were checked
      // rather than assumed: `enteredValue < 0`, `> 100` and the combined-discount
      // ceiling each have a real number on one side, and `number < string`
      // coerces the string numerically. Only string-versus-string is broken.
      const entered = numericTextToNumber(enteredValue);
      if (mechanic.minValue !== null && mechanic.minValue !== undefined) {
        if (entered < numericTextToNumber(mechanic.minValue)) {
          errors.push({
            severity: ErrorSeverity.ERROR,
            category: ErrorCategory.INPUT_ERROR,
            message: `${mechanic.name}: Value must be at least ${mechanic.minValue}`,
            field: mechanic.code,
            fuId: planFuId,
            suggestion: `Enter a value >= ${mechanic.minValue}`,
          });
        }
      }

      if (mechanic.maxValue !== null && mechanic.maxValue !== undefined) {
        if (entered > numericTextToNumber(mechanic.maxValue)) {
          errors.push({
            severity: ErrorSeverity.ERROR,
            category: ErrorCategory.INPUT_ERROR,
            message: `${mechanic.name}: Value must be at most ${mechanic.maxValue}`,
            field: mechanic.code,
            fuId: planFuId,
            suggestion: `Enter a value <= ${mechanic.maxValue}`,
          });
        }
      }
    }

    const errorCount = errors.filter(
      (e) => e.severity === ErrorSeverity.ERROR,
    ).length;
    const warningCount = errors.filter(
      (e) => e.severity === ErrorSeverity.WARNING,
    ).length;

    return {
      isValid: errorCount === 0,
      errors,
      errorCount,
      warningCount,
    };
  }

  /**
   * Validate mechanic combinations
   */
  async validateCombinations(
    tenantId: string,
    planFuId: string,
  ): Promise<CombinationValidationResult> {
    const planFu = await this.planFuRepository.findOne({
      where: { id: planFuId, tenantId },
      relations: [
        'planMechanicValues',
        'planMechanicValues.mechanic',
        'planSkus',
        'planSkus.sku',
      ],
    });

    if (!planFu) {
      throw new Error(`Plan FU with ID ${planFuId} not found`);
    }

    const errors: ValidationError[] = [];
    const conflicts: string[] = [];

    // Get all active mechanics for this FU
    const activeMechanics = (planFu.planMechanicValues || [])
      .filter((pmv) => {
        // "Is this mechanic actually in play?" — absent and zero both mean no,
        // which is ADR 0008 ("for a planner's entry there is no meaning
        // difference between null and 0") applied at a filter rather than in
        // arithmetic.
        //
        // T-085: the zero half of that never worked. The predicate read
        // `v !== 0` against `v` from a transformer-less `numeric` column at the
        // time (`entered_rate_pct` — a PERCENT mechanic in the reported case),
        // so `v` was the STRING "0.0000" — and `"0.0000" !== 0` is always true
        // because strict inequality never coerces across types. Every
        // zero-valued mechanic stayed in `activeMechanics`.
        //
        // What that produced downstream: two mutually-exclusive mechanics both
        // entered as 0% were reported as a CONFLICT, and the per-mechanic
        // combined-discount ceiling counted mechanics contributing nothing. The
        // decision ADR 0008 records was correct and the code was written to
        // apply it — a type mismatch simply meant it never did.
        //
        // ⚠️ `v` is not always a string today (review, T-197/T-221, 2026-08-15):
        // `readEnteredRaw` reads whichever column `enteredColumnFor(mechanic)`
        // selects, and only `entered_rate_pct` remains transformer-less;
        // `entered_unit_amount`/`entered_total_amount` now arrive as `number`.
        // `numericTextToNumber(v) !== 0` below is unaffected either way — it is
        // a type-check-then-parse, not a fix scoped to strings — so this
        // predicate is still correct for the mechanic types it did not
        // originally have to handle; only the "so it is the STRING" premise
        // above was mechanic-type-specific and is corrected here, not the code.
        //
        // `readEnteredRaw` (not `readEnteredValue`) is still the right read: the
        // null check below is the semantics here, and `?? 0` would erase the
        // difference between "no row value" and "a zero the planner typed"
        // before this predicate could see either.
        if (!pmv.mechanic) return false;
        const v = readEnteredRaw(pmv, pmv.mechanic);
        if (v === null || v === undefined) return false;
        return numericTextToNumber(v) !== 0;
      })
      .map((pmv) => pmv.mechanic)
      .filter((m) => m !== null) as Mechanic[];

    // Check mutually exclusive mechanics
    for (const mechanic of activeMechanics) {
      if (
        mechanic.mutuallyExclusiveWith &&
        mechanic.mutuallyExclusiveWith.length > 0
      ) {
        const conflictingCodes = activeMechanics
          .filter((m) => mechanic.mutuallyExclusiveWith?.includes(m.code))
          .map((m) => m.code);

        if (conflictingCodes.length > 0) {
          conflicts.push(`${mechanic.code} <-> ${conflictingCodes.join(', ')}`);
          errors.push({
            severity: ErrorSeverity.ERROR,
            category: ErrorCategory.COMBINATION_ERROR,
            message: `${mechanic.name} cannot be used with: ${conflictingCodes.join(', ')}`,
            field: mechanic.code,
            fuId: planFuId,
            suggestion: `Remove one of the conflicting mechanics`,
          });
        }
      }
    }

    // Calculate total discounts
    const planSkus = planFu.planSkus || [];
    const totalPlannedGsv = planSkus.reduce((sum, sku) => {
      const volume = Number(sku.plannedVolume) || 0;
      const price = Number(sku.sku?.unitPrice) || 0;
      return sum + volume * price;
    }, 0);

    let totalOnInvoiceDiscount = 0;
    let totalOffInvoiceDiscount = 0;

    for (const pmv of planFu.planMechanicValues || []) {
      const mechanic = pmv.mechanic;
      // Truthiness only here (0 and "not entered" both skip), so the
      // `?? 0` collapse in readEnteredValue preserves behaviour exactly.
      const entered = readEnteredValue(pmv, mechanic);
      if (!entered) continue;

      // T-089: ONE conversion point, and it produces a NUMBER.
      //
      // This used to be `totalOnInvoiceDiscount += entered` inside each branch.
      // `entered` is used below ONLY inside the PERCENT branch (`entered_rate_pct`,
      // which remains transformer-less today — review, T-197/T-221, 2026-08-15;
      // `entered_unit_amount`/`entered_total_amount` now carry a transformer and
      // arrive as `number`, but neither reaches this line: the non-PERCENT branch
      // recomputes its contribution from `pmv.calculatedSpend` instead). For a
      // PERCENT mechanic `entered` comes off that transformer-less `decimal`
      // column, i.e. it is a STRING, so `0 + "10.0000"` was concatenation, not
      // addition. The accumulator turned into a string on the first PERCENT
      // mechanic:
      //
      //   %10 then %5  ->  "010.00005.0000"
      //   combined     ->  "010.00005.00000"   ->  Number(...) is NaN
      //   NaN > 60     ->  false
      //
      // Every one of the four ceilings below (`MAX_ON_INVOICE`,
      // `MAX_OFF_INVOICE`, `MAX_COMBINED = 60`, and the per-mechanic
      // `maxCombinedDiscountPercentage`) was therefore SILENTLY DEAD for
      // PERCENT mechanics — no error, no wrong number, simply never firing. A
      // planner could enter 10% + 5% + 90% and pass.
      //
      // The non-PERCENT branch was always fine: `spend / gsv * 100` coerces
      // numerically. So the defect was mechanic-type dependent, which is part
      // of why it survived — and the plan-level rollup made it worse to spot,
      // returning a correct-looking 10 for a single-mechanic FU (`Number(
      // "010.0000")` is 10) and NaN only once a second mechanic appeared.
      //
      // WHY THE CONVERSION LIVES HERE AND NOT IN THE BRANCHES
      // There are four accumulation sites. Converting at each would be four
      // conversion points that drift apart. Collapsing them into one
      // `contribution` means the value is a number BEFORE it can reach any
      // accumulator, and a new accumulator cannot reintroduce the bug.
      //
      // `rateFromNumericString` (not `Number()`) parses the numeric(9,4) text
      // exactly and throws on anything it cannot represent, instead of
      // producing a quiet NaN (CLAUDE.md §2.5). It also keeps this file off the
      // ratchet: the parsing lives in `src/common/numeric/`.
      const contribution =
        mechanic.mechanicType === 'PERCENT'
          ? rateToPercent(rateFromNumericString(String(entered)))
          : totalPlannedGsv > 0
            ? (pmv.calculatedSpend / totalPlannedGsv) * 100
            : 0;

      if (mechanic.category === MechanicCategory.ON_INVOICE_DISCOUNT) {
        totalOnInvoiceDiscount += contribution;
      } else if (
        mechanic.category === MechanicCategory.OFF_INVOICE_DISCOUNT ||
        mechanic.category === MechanicCategory.PER_UNIT_SUPPORT ||
        mechanic.category === MechanicCategory.LUMPSUM_SPEND
      ) {
        totalOffInvoiceDiscount += contribution;
      }
    }

    const combinedDiscount = totalOnInvoiceDiscount + totalOffInvoiceDiscount;

    // Check thresholds
    if (totalOnInvoiceDiscount > this.MAX_ON_INVOICE_DISCOUNT) {
      errors.push({
        severity: ErrorSeverity.WARNING,
        category: ErrorCategory.COMBINATION_ERROR,
        message: `Total On-Invoice discount (${totalOnInvoiceDiscount.toFixed(1)}%) exceeds recommended threshold (${this.MAX_ON_INVOICE_DISCOUNT}%)`,
        fuId: planFuId,
        suggestion: `Reduce On-Invoice discounts to stay below ${this.MAX_ON_INVOICE_DISCOUNT}%`,
      });
    }

    if (totalOffInvoiceDiscount > this.MAX_OFF_INVOICE_DISCOUNT) {
      errors.push({
        severity: ErrorSeverity.WARNING,
        category: ErrorCategory.COMBINATION_ERROR,
        message: `Total Off-Invoice discount (${totalOffInvoiceDiscount.toFixed(1)}%) exceeds recommended threshold (${this.MAX_OFF_INVOICE_DISCOUNT}%)`,
        fuId: planFuId,
        suggestion: `Reduce Off-Invoice discounts to stay below ${this.MAX_OFF_INVOICE_DISCOUNT}%`,
      });
    }

    if (combinedDiscount > this.MAX_COMBINED_DISCOUNT) {
      errors.push({
        severity: ErrorSeverity.ERROR,
        category: ErrorCategory.COMBINATION_ERROR,
        message: `Combined discount (${combinedDiscount.toFixed(1)}%) exceeds maximum allowed (${this.MAX_COMBINED_DISCOUNT}%)`,
        fuId: planFuId,
        suggestion: `Reduce total discounts to stay below ${this.MAX_COMBINED_DISCOUNT}%`,
      });
    }

    // Check max combined discount per mechanic
    for (const mechanic of activeMechanics) {
      if (
        mechanic.maxCombinedDiscountPercentage !== null &&
        mechanic.maxCombinedDiscountPercentage !== undefined
      ) {
        if (combinedDiscount > mechanic.maxCombinedDiscountPercentage) {
          errors.push({
            severity: ErrorSeverity.ERROR,
            category: ErrorCategory.COMBINATION_ERROR,
            message: `Combined discount (${combinedDiscount.toFixed(1)}%) exceeds maximum (${mechanic.maxCombinedDiscountPercentage}%) defined by ${mechanic.name}`,
            field: mechanic.code,
            fuId: planFuId,
            suggestion: `Reduce total discounts to stay below ${mechanic.maxCombinedDiscountPercentage}%`,
          });
        }
      }
    }

    return {
      isValid:
        errors.filter((e) => e.severity === ErrorSeverity.ERROR).length === 0,
      totalOnInvoiceDiscount,
      totalOffInvoiceDiscount,
      combinedDiscount,
      errors,
      conflicts,
    };
  }

  /**
   * Validate budget impact
   */
  async validateBudgetImpact(
    tenantId: string,
    planId: string,
  ): Promise<BudgetValidationResult> {
    const plan = await this.planRepository.findOne({
      where: { id: planId, tenantId },
      relations: [
        'planFus',
        'planFus.planMechanicValues',
        'planFus.planMechanicValues.mechanic',
        'cpl',
        'channel',
        'category',
      ],
    });

    if (!plan) {
      throw new Error(`Plan with ID ${planId} not found`);
    }

    // Calculate total spends
    let totalOnInvoiceSpend = 0;
    let totalOffInvoiceSpend = 0;

    for (const planFu of plan.planFus || []) {
      for (const pmv of planFu.planMechanicValues || []) {
        const mechanic = pmv.mechanic;
        if (!mechanic || !pmv.calculatedSpend) continue;

        // T-091: ONE conversion point, and it produces a NUMBER.
        //
        // ⚠️ STALE PREMISE, CORRECTED (review, T-197/T-221, 2026-08-15):
        // `calculatedSpend` now carries `transformer: MoneyTransformer`
        // (`plan-mechanic-value.entity.ts`) and arrives as a `number`, not a
        // STRING. AT THE TIME OF THE ORIGINAL FIX it was a `numeric(18,2)`
        // column with no transformer, so `0 + "100.00"` was concatenation. Two
        // or more mechanics turned the total into "0100.0050.00", which then
        // went out as `estimatedOnInvoiceSpend` and reached `checkAvailability`,
        // where `available >= "0100.0050.00"` is a NaN comparison and therefore
        // always false: every plan reported "Insufficient On-Invoice budget",
        // and the shortfall message rendered the literal text "Shortfall: NaN".
        //
        // Same shape as T-089: with a SINGLE mechanic it worked by accident
        // (`Number("0100.00")` is 100) and only broke once a second appeared.
        //
        // The conversion below is KEPT even though the column is transformer'd
        // now: `moneyFromNumericString(String(...))` is correct for either a
        // `number` or a `string` input (`String()` normalises first), so this
        // stays a no-op-shaped safety net rather than a live defect path — the
        // same reasoning as `finance-reporting.service.ts`'s `spendOf()`.
        //
        // ⚠️ STALE PREMISE, CORRECTED (review, T-197/T-221, 2026-08-15): the
        // "parses the text digit-wise instead of routing it through `Number()`"
        // rationale below no longer applies at THIS call site.
        // `pmv.calculatedSpend` already passed through `Number()` once, inside
        // `MoneyTransformer.from`, before this line runs — the pg driver's
        // exact decimal string is gone by this point, so parsing
        // `String(pmv.calculatedSpend)` digit-wise recovers no precision that
        // was not already settled. What survives, and is why the call is
        // kept: an explicit throw instead of a quiet NaN (§2.5) and the
        // branded `MoneyMinor` conversion. The column is scale 2 — measured —
        // so it cannot throw on legitimate data. `moneyToMajorUnits` returns
        // TRY, which is the representation these accumulators already use:
        // this is a correctness fix, not a representation change (ADR 0007 K9).
        const spend = moneyToMajorUnits(
          moneyFromNumericString(String(pmv.calculatedSpend)),
        );

        if (mechanic.category === MechanicCategory.ON_INVOICE_DISCOUNT) {
          totalOnInvoiceSpend += spend;
        } else {
          totalOffInvoiceSpend += spend;
        }
      }
    }

    // Check budget availability
    const context: BudgetCheckContext = {
      cplId: plan.cplId,
      channel: plan.channel?.code || '',
      category: plan.category?.code || '',
      periodStart: plan.startDate.toISOString().split('T')[0],
      periodEnd: plan.endDate.toISOString().split('T')[0],
      estimatedOnInvoiceSpend: totalOnInvoiceSpend,
      estimatedOffInvoiceSpend: totalOffInvoiceSpend,
    };

    const availability = await this.budgetAllocationService.checkAvailability(
      tenantId,
      context,
    );

    const errors: ValidationError[] = [];
    const suggestions: string[] = [];

    if (!availability.onInvoiceSufficient) {
      errors.push({
        severity: ErrorSeverity.ERROR,
        category: ErrorCategory.BUDGET_ERROR,
        message: `Insufficient On-Invoice budget. Shortfall: ${availability.onInvoiceShortfall.toFixed(2)}`,
        suggestion:
          availability.suggestions.find((s: string) =>
            s.includes('On-Invoice'),
          ) || 'Reduce On-Invoice spends',
      });
      suggestions.push(
        ...availability.suggestions.filter((s: string) =>
          s.includes('On-Invoice'),
        ),
      );
    } else if (availability.onInvoiceAvailable > 0) {
      const utilizationPercent =
        (totalOnInvoiceSpend /
          (totalOnInvoiceSpend + availability.onInvoiceAvailable)) *
        100;
      if (utilizationPercent >= this.BUDGET_WARNING_THRESHOLD) {
        errors.push({
          severity: ErrorSeverity.WARNING,
          category: ErrorCategory.BUDGET_ERROR,
          message: `On-Invoice budget utilization is ${utilizationPercent.toFixed(1)}% (warning threshold: ${this.BUDGET_WARNING_THRESHOLD}%)`,
        });
      }
    }

    if (!availability.offInvoiceSufficient) {
      errors.push({
        severity: ErrorSeverity.ERROR,
        category: ErrorCategory.BUDGET_ERROR,
        message: `Insufficient Off-Invoice budget. Shortfall: ${availability.offInvoiceShortfall.toFixed(2)}`,
        suggestion:
          availability.suggestions.find((s: string) =>
            s.includes('Off-Invoice'),
          ) || 'Reduce Off-Invoice spends',
      });
      suggestions.push(
        ...availability.suggestions.filter((s: string) =>
          s.includes('Off-Invoice'),
        ),
      );
    } else if (availability.offInvoiceAvailable > 0) {
      const utilizationPercent =
        (totalOffInvoiceSpend /
          (totalOffInvoiceSpend + availability.offInvoiceAvailable)) *
        100;
      if (utilizationPercent >= this.BUDGET_WARNING_THRESHOLD) {
        errors.push({
          severity: ErrorSeverity.WARNING,
          category: ErrorCategory.BUDGET_ERROR,
          message: `Off-Invoice budget utilization is ${utilizationPercent.toFixed(1)}% (warning threshold: ${this.BUDGET_WARNING_THRESHOLD}%)`,
        });
      }
    }

    return {
      isSufficient:
        availability.onInvoiceSufficient && availability.offInvoiceSufficient,
      onInvoiceAvailable: availability.onInvoiceAvailable,
      offInvoiceAvailable: availability.offInvoiceAvailable,
      onInvoiceShortfall: availability.onInvoiceShortfall,
      offInvoiceShortfall: availability.offInvoiceShortfall,
      errors,
      suggestions,
    };
  }

  /**
   * Validate before submission (all validations)
   */
  async validateBeforeSubmission(
    tenantId: string,
    planId: string,
  ): Promise<PreSubmissionValidation> {
    const plan = await this.planRepository.findOne({
      where: { id: planId, tenantId },
      relations: ['planFus'],
    });

    if (!plan) {
      throw new Error(`Plan with ID ${planId} not found`);
    }

    // Run all validations
    const inputValidations: InputValidationResult[] = [];
    const combinationValidations: CombinationValidationResult[] = [];

    for (const planFu of plan.planFus || []) {
      const inputValidation = await this.validateInputs(tenantId, planFu.id);
      inputValidations.push(inputValidation);

      const combinationValidation = await this.validateCombinations(
        tenantId,
        planFu.id,
      );
      combinationValidations.push(combinationValidation);
    }

    const budgetValidation = await this.validateBudgetImpact(tenantId, planId);

    // Combine all errors
    const allErrors: ValidationError[] = [];
    inputValidations.forEach((iv) => allErrors.push(...iv.errors));
    combinationValidations.forEach((cv) => allErrors.push(...cv.errors));
    allErrors.push(...budgetValidation.errors);

    const blockingErrors = allErrors.filter(
      (e) => e.severity === ErrorSeverity.ERROR,
    );
    const warnings = allErrors.filter(
      (e) => e.severity === ErrorSeverity.WARNING,
    );

    // Generate auto-fix suggestions
    const autoFixSuggestions: string[] = [];
    budgetValidation.suggestions.forEach((s) => autoFixSuggestions.push(s));

    // Add suggestions from combination validation
    combinationValidations.forEach((cv) => {
      cv.errors.forEach((e) => {
        if (e.suggestion) {
          autoFixSuggestions.push(e.suggestion);
        }
      });
    });

    return {
      canSubmit: blockingErrors.length === 0,
      hasBlockingErrors: blockingErrors.length > 0,
      inputValidation: {
        isValid: inputValidations.every((iv) => iv.isValid),
        errors: allErrors.filter(
          (e) => e.category === ErrorCategory.INPUT_ERROR,
        ),
        errorCount: allErrors.filter(
          (e) =>
            e.category === ErrorCategory.INPUT_ERROR &&
            e.severity === ErrorSeverity.ERROR,
        ).length,
        warningCount: allErrors.filter(
          (e) =>
            e.category === ErrorCategory.INPUT_ERROR &&
            e.severity === ErrorSeverity.WARNING,
        ).length,
      },
      combinationValidation: {
        isValid: combinationValidations.every((cv) => cv.isValid),
        totalOnInvoiceDiscount:
          combinationValidations.reduce(
            (sum, cv) => sum + cv.totalOnInvoiceDiscount,
            0,
          ) / combinationValidations.length,
        totalOffInvoiceDiscount:
          combinationValidations.reduce(
            (sum, cv) => sum + cv.totalOffInvoiceDiscount,
            0,
          ) / combinationValidations.length,
        combinedDiscount:
          combinationValidations.reduce(
            (sum, cv) => sum + cv.combinedDiscount,
            0,
          ) / combinationValidations.length,
        errors: allErrors.filter(
          (e) => e.category === ErrorCategory.COMBINATION_ERROR,
        ),
        conflicts: combinationValidations.flatMap((cv) => cv.conflicts),
      },
      budgetValidation,
      allErrors,
      totalErrorCount: blockingErrors.length,
      totalWarningCount: warnings.length,
      autoFixSuggestions: [...new Set(autoFixSuggestions)], // Remove duplicates
    };
  }
}
