import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpendValidationService } from './spend-validation.service';
import { Plan, PlanFu } from '../../../database/entities/plan.entity';
import {
  Mechanic,
  MechanicCategory,
  MechanicType,
  InputType,
} from '../../../database/entities/mechanic.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { BudgetAllocationService } from '../budget/budget-allocation.service';
import { MechanicService } from '../../master-data/mechanic/mechanic.service';
import { ErrorSeverity, ErrorCategory } from './dto/validation-result.dto';

/* ------------------------------------------------------------------ *
 * Shared fixtures / harness — T-089 introduces this spec file.
 *
 * `spend-validation.service.ts` has THREE known defect classes (see file
 * header, T-089 comment block at :275-307):
 *   - T-089 (this file): accumulator concatenation in `validateCombinations`
 *     — every threshold silently dead for PERCENT mechanics.
 *   - T-085 (below): string comparison at minValue/maxValue (`validateInputs`
 *     min/max block) + the decimal-place gate that measured column scale
 *     instead of planner intent + the `activeMechanics` zero-string filter
 *     in `validateCombinations`.
 *   - T-088 (unrelated service, similar pattern).
 * ------------------------------------------------------------------ */

const TENANT_ID = 'tenant-1';
const FU_ID = 'fu-1';
const PLAN_ID = 'plan-1';

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

/**
 * Mechanic fixture. Defaults to a PERCENT / ON_INVOICE_DISCOUNT mechanic with
 * no combination constraints — tests override only what they need.
 */
function makeMechanic(overrides: Partial<Mechanic> = {}): Mechanic {
  const base = {
    id: nextId('mech'),
    tenantId: TENANT_ID,
    code: 'CPP_ON',
    name: 'CPP On-Invoice',
    tacticId: nextId('tactic'),
    mechanicType: MechanicType.PERCENT,
    category: MechanicCategory.ON_INVOICE_DISCOUNT,
    inputType: InputType.PERCENTAGE,
    isActive: true,
    showInGrid: true,
    trackAgainstBudget: true,
    mutuallyExclusiveWith: undefined,
    maxCombinedDiscountPercentage: undefined,
    minValue: undefined,
    maxValue: undefined,
  };
  return { ...base, ...overrides } as Mechanic;
}

/**
 * PlanMechanicValue fixture. `entered` is written into whatever
 * `entered_*` column matches `mechanic.mechanicType`, and its type
 * (`string | number | null`) is left to the CALLER to choose deliberately.
 *
 * WHICH SHAPE TO PASS DEPENDS ON THE MECHANIC TYPE (review, T-197/T-221,
 * 2026-08-15 — this comment used to say `entered` is unconditionally "accepted
 * as a STRING… because that is the real shape a transformer-less `decimal`
 * column returns from Postgres", which is now only true for PERCENT):
 *
 *   PERCENT          entered_rate_pct     STRING  — still no transformer
 *   AMOUNT_PER_UNIT  entered_unit_amount  NUMBER  — UnitPriceTransformer
 *   AMOUNT           entered_total_amount NUMBER  — MoneyTransformer
 *
 * Passing a STRING for PERCENT (the default `makeMechanic()` type, and what
 * most tests in this file exercise) is still load-bearing: it is the real
 * shape a transformer-less `decimal` column returns from Postgres, and
 * passing a JS number there would silently skip the defect this file exists
 * to catch (T-089 task note; T-080 lost 11 tests to exactly this shortcut).
 * For AMOUNT_PER_UNIT/AMOUNT tests, pass a NUMBER — passing a string there
 * now tests a shape production cannot produce (§2.7 mock-drift).
 */
function buildPmv(
  mechanic: Mechanic,
  entered: string | number | null,
  overrides: Partial<PlanMechanicValue> = {},
): PlanMechanicValue {
  const pmv: any = {
    id: nextId('pmv'),
    tenantId: TENANT_ID,
    planFuId: FU_ID,
    mechanicId: mechanic.id,
    mechanic,
    calculatedSpend: 0,
    onInvoiceAmount: 0,
    offInvoiceAmount: 0,
    enteredRatePct: null,
    enteredUnitAmount: null,
    enteredTotalAmount: null,
    ...overrides,
  };

  if (entered !== null) {
    switch (mechanic.mechanicType) {
      case MechanicType.PERCENT:
        pmv.enteredRatePct = entered;
        break;
      case MechanicType.AMOUNT_PER_UNIT:
        pmv.enteredUnitAmount = entered;
        break;
      case MechanicType.AMOUNT:
        pmv.enteredTotalAmount = entered;
        break;
    }
  }

  return pmv as PlanMechanicValue;
}

function buildPlanFu(
  planMechanicValues: PlanMechanicValue[],
  planSkus: unknown[] = [],
): PlanFu {
  return {
    id: FU_ID,
    tenantId: TENANT_ID,
    planId: PLAN_ID,
    planMechanicValues,
    planSkus,
  } as unknown as PlanFu;
}

interface ServiceHarness {
  service: SpendValidationService;
  planRepo: jest.Mocked<Repository<Plan>>;
  planFuRepo: jest.Mocked<Repository<PlanFu>>;
  mechanicRepo: jest.Mocked<Repository<Mechanic>>;
  planMechanicValueRepo: jest.Mocked<Repository<PlanMechanicValue>>;
  budgetAllocationService: jest.Mocked<BudgetAllocationService>;
  mechanicService: jest.Mocked<MechanicService>;
}

async function createHarness(): Promise<ServiceHarness> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SpendValidationService,
      {
        provide: getRepositoryToken(Plan),
        useValue: { findOne: jest.fn(), find: jest.fn() },
      },
      {
        provide: getRepositoryToken(PlanFu),
        useValue: { findOne: jest.fn(), find: jest.fn() },
      },
      {
        provide: getRepositoryToken(Mechanic),
        useValue: { findOne: jest.fn(), find: jest.fn() },
      },
      {
        provide: getRepositoryToken(PlanMechanicValue),
        useValue: { findOne: jest.fn(), find: jest.fn() },
      },
      {
        provide: BudgetAllocationService,
        useValue: { checkAvailability: jest.fn() },
      },
      {
        provide: MechanicService,
        useValue: {},
      },
    ],
  }).compile();

  return {
    service: module.get(SpendValidationService),
    planRepo: module.get(getRepositoryToken(Plan)),
    planFuRepo: module.get(getRepositoryToken(PlanFu)),
    mechanicRepo: module.get(getRepositoryToken(Mechanic)),
    planMechanicValueRepo: module.get(getRepositoryToken(PlanMechanicValue)),
    budgetAllocationService: module.get(BudgetAllocationService),
    mechanicService: module.get(MechanicService),
  };
}

/** Numeric-looking percent, e.g. "55.0%" — the shape `.toFixed(1)` produces. */
const NUMERIC_PERCENT = /\d+\.\d%/;

describe('SpendValidationService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  /* ================================================================ *
   * T-089 — validateCombinations: accumulator NaN fix
   *
   * Real method name is `validateCombinations` (the task brief referred to
   * it informally as "validateCombinationRules"; there is no method by that
   * name in the file — noted for the record, not acted on beyond using the
   * correct name here).
   * ================================================================ */
  describe('validateCombinations — T-089 (accumulator NaN fix)', () => {
    let h: ServiceHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    // ---- A + B: each of the four ceilings fires independently, and each
    // proves its `.toFixed` call is alive (it would throw
    // "toFixed is not a function" if the accumulator were still a string).

    it('fires MAX_ON_INVOICE_DISCOUNT (50) alone when only on-invoice exceeds it', async () => {
      const mechanic = makeMechanic({
        code: 'ON_1',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const pmv = buildPmv(mechanic, '55.0000');
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      expect(result.totalOnInvoiceDiscount).toBe(55);
      expect(result.totalOffInvoiceDiscount).toBe(0);
      expect(result.combinedDiscount).toBe(55);

      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err.severity).toBe(ErrorSeverity.WARNING);
      expect(err.category).toBe(ErrorCategory.COMBINATION_ERROR);
      expect(err.message).toMatch(/On-Invoice discount/);
      expect(err.message).toMatch(NUMERIC_PERCENT);
      expect(err.message).toContain('55.0%');
      expect(err.message).toContain('50%');
    });

    it('fires MAX_OFF_INVOICE_DISCOUNT (30) alone when only off-invoice exceeds it', async () => {
      const mechanic = makeMechanic({
        code: 'OFF_1',
        category: MechanicCategory.OFF_INVOICE_DISCOUNT,
      });
      const pmv = buildPmv(mechanic, '35.0000');
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      expect(result.totalOnInvoiceDiscount).toBe(0);
      expect(result.totalOffInvoiceDiscount).toBe(35);
      expect(result.combinedDiscount).toBe(35);

      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err.severity).toBe(ErrorSeverity.WARNING);
      expect(err.category).toBe(ErrorCategory.COMBINATION_ERROR);
      expect(err.message).toMatch(/Off-Invoice discount/);
      expect(err.message).toMatch(NUMERIC_PERCENT);
      expect(err.message).toContain('35.0%');
      expect(err.message).toContain('30%');
    });

    it('fires MAX_COMBINED_DISCOUNT (60, hard limit) when the sum exceeds it even though neither leg alone does', async () => {
      const onMechanic = makeMechanic({
        code: 'ON_2',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const offMechanic = makeMechanic({
        code: 'OFF_2',
        category: MechanicCategory.OFF_INVOICE_DISCOUNT,
      });
      // 40 <= 50 (no on-invoice warning), 25 <= 30 (no off-invoice warning),
      // 40 + 25 = 65 > 60 (combined hard limit fires).
      const pmvs = [
        buildPmv(onMechanic, '40.0000'),
        buildPmv(offMechanic, '25.0000'),
      ];
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu(pmvs));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      expect(result.totalOnInvoiceDiscount).toBe(40);
      expect(result.totalOffInvoiceDiscount).toBe(25);
      expect(result.combinedDiscount).toBe(65);

      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err.severity).toBe(ErrorSeverity.ERROR);
      expect(err.category).toBe(ErrorCategory.COMBINATION_ERROR);
      expect(err.message).toMatch(/Combined discount/);
      expect(err.message).toMatch(NUMERIC_PERCENT);
      expect(err.message).toContain('65.0%');
      expect(err.message).toContain('60%');
      expect(result.isValid).toBe(false);
    });

    it('fires the per-mechanic maxCombinedDiscountPercentage ceiling even when the class-wide 60% limit is not reached', async () => {
      const mechanic = makeMechanic({
        code: 'ON_3',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        maxCombinedDiscountPercentage: 20,
      });
      // 25 <= 50 (no on-invoice warning), 25 <= 60 (no class-wide hard limit),
      // but 25 > this mechanic's own 20% ceiling.
      const pmv = buildPmv(mechanic, '25.0000');
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      expect(result.combinedDiscount).toBe(25);
      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err.severity).toBe(ErrorSeverity.ERROR);
      expect(err.category).toBe(ErrorCategory.COMBINATION_ERROR);
      expect(err.message).toMatch(/Combined discount/);
      expect(err.message).toMatch(/defined by/);
      expect(err.message).toMatch(NUMERIC_PERCENT);
      expect(err.message).toContain('25.0%');
      expect(err.message).toContain('20%');
      expect(err.field).toBe('ON_3');
    });

    // ---- C: the accumulator itself is a number, never a concatenated string.

    it('accumulates STRING-typed entered values (numeric(9,4) shape) into numbers, not concatenated strings', async () => {
      const onMechanic = makeMechanic({
        code: 'ON_4',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const offMechanic = makeMechanic({
        code: 'OFF_4',
        category: MechanicCategory.OFF_INVOICE_DISCOUNT,
      });
      // This is the exact scenario from the T-089 comment block: 10% then
      // 5%. Under the old code this produced the string "010.00005.0000"
      // for combinedDiscount and NaN once coerced to a number.
      const pmvs = [
        buildPmv(onMechanic, '10.0000'),
        buildPmv(offMechanic, '5.0000'),
      ];
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu(pmvs));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      expect(typeof result.totalOnInvoiceDiscount).toBe('number');
      expect(typeof result.totalOffInvoiceDiscount).toBe('number');
      expect(typeof result.combinedDiscount).toBe('number');
      expect(Number.isNaN(result.totalOnInvoiceDiscount)).toBe(false);
      expect(Number.isNaN(result.totalOffInvoiceDiscount)).toBe(false);
      expect(Number.isNaN(result.combinedDiscount)).toBe(false);

      // Not "010.00005.0000" -> NaN; the real arithmetic sum.
      expect(result.totalOnInvoiceDiscount).toBe(10);
      expect(result.totalOffInvoiceDiscount).toBe(5);
      expect(result.combinedDiscount).toBe(15);
    });

    it('accumulates three STRING-typed same-category mechanics without string concatenation', async () => {
      const m1 = makeMechanic({
        code: 'ON_5A',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const m2 = makeMechanic({
        code: 'ON_5B',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const m3 = makeMechanic({
        code: 'ON_5C',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const pmvs = [
        buildPmv(m1, '1.0000'),
        buildPmv(m2, '2.0000'),
        buildPmv(m3, '3.0000'),
      ];
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu(pmvs));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      // Old (broken) behaviour would have produced the string
      // "01.00002.00003.0000" and Number(...) => NaN.
      expect(result.totalOnInvoiceDiscount).toBe(6);
      expect(typeof result.totalOnInvoiceDiscount).toBe('number');
      expect(Number.isNaN(result.totalOnInvoiceDiscount)).toBe(false);
    });
  });

  /* ================================================================ *
   * T-089 — D: plan-level rollup must not leak NaN for a multi-mechanic FU
   * ================================================================ */
  describe('validateBeforeSubmission — T-089 (plan-level rollup)', () => {
    let h: ServiceHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    it('does not produce NaN in combinationValidation.combinedDiscount for a multi-mechanic FU', async () => {
      const onMechanic = makeMechanic({
        code: 'ON_ROLLUP',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const offMechanic = makeMechanic({
        code: 'OFF_ROLLUP',
        category: MechanicCategory.OFF_INVOICE_DISCOUNT,
      });
      const pmvs = [
        buildPmv(onMechanic, '10.0000'),
        buildPmv(offMechanic, '5.0000'),
      ];
      const planFu = buildPlanFu(pmvs);

      const plan: Partial<Plan> = {
        id: PLAN_ID,
        tenantId: TENANT_ID,
        cplId: 'cpl-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
        channel: { code: 'NKA' } as any,
        category: { code: 'DAIRY' } as any,
        planFus: [planFu],
      };

      // Same mocked plan object services both `planRepository.findOne` calls
      // inside `validateBeforeSubmission` (relations: ['planFus']) and inside
      // `validateBudgetImpact` (relations incl. planFus.planMechanicValues,
      // cpl, channel, category) — the mock does not filter by relations, so
      // one fixture with everything both call sites need is sufficient.
      h.planRepo.findOne.mockResolvedValue(plan as Plan);
      h.planFuRepo.findOne.mockResolvedValue(planFu);
      h.budgetAllocationService.checkAvailability.mockResolvedValue({
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 100000,
        onInvoiceSufficient: true,
        offInvoiceSufficient: true,
        onInvoiceShortfall: 0,
        offInvoiceShortfall: 0,
        suggestions: [],
      } as any);

      const result = await h.service.validateBeforeSubmission(
        TENANT_ID,
        PLAN_ID,
      );

      expect(typeof result.combinationValidation.combinedDiscount).toBe(
        'number',
      );
      expect(Number.isNaN(result.combinationValidation.combinedDiscount)).toBe(
        false,
      );
      expect(result.combinationValidation.combinedDiscount).toBe(15);
      expect(result.combinationValidation.totalOnInvoiceDiscount).toBe(10);
      expect(result.combinationValidation.totalOffInvoiceDiscount).toBe(5);
    });
  });

  /* ================================================================ *
   * T-091 — validateBudgetImpact: `totalOnInvoiceSpend` /
   * `totalOffInvoiceSpend` accumulator string-concat fix
   *
   * AT THE TIME OF THE FIX, `pmv.calculatedSpend` was a `numeric(18,2)`
   * column with NO transformer — a STRING at runtime despite the TS type on
   * `PlanMechanicValue` saying `number` (same shape as the T-089 `entered`
   * defect, different field) — and `totalOnInvoiceSpend +=
   * pmv.calculatedSpend` was string concatenation under the old code.
   *
   * ⚠️ STALE PREMISE, CORRECTED (review, T-197/T-221, 2026-08-15):
   * `calculated_spend` now carries `transformer: MoneyTransformer`
   * (`plan-mechanic-value.entity.ts`), so TypeORM always returns a `number`
   * here — a string can no longer reach this point through the repository.
   * The fixtures below are updated to match. This does not remove the
   * accumulation coverage: `validateBudgetImpact` still converts through
   * `moneyFromNumericString(String(pmv.calculatedSpend))` before summing
   * rather than trusting the column type (see the doc comment on that call
   * site), and TWO+ mechanics per category still exercises accumulation
   * across more than one addition — the shape that would reveal a naive `+=`
   * regression regardless of whether the addend started as a string or a
   * number.
   * ================================================================ */
  describe('validateBudgetImpact — T-091 (accumulator string-concat fix)', () => {
    let h: ServiceHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    function buildPlan(planFus: PlanFu[]): Partial<Plan> {
      return {
        id: PLAN_ID,
        tenantId: TENANT_ID,
        cplId: 'cpl-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
        channel: { code: 'NKA' } as any,
        category: { code: 'DAIRY' } as any,
        planFus,
      };
    }

    it('sums calculatedSpend (NUMBER, MoneyTransformer shape) into correct NUMBERS for estimatedOnInvoiceSpend / estimatedOffInvoiceSpend — not NaN, not concatenated strings', async () => {
      const onMechanic = makeMechanic({
        code: 'ON_SPEND',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const offMechanic = makeMechanic({
        code: 'OFF_SPEND',
        category: MechanicCategory.OFF_INVOICE_DISCOUNT,
      });

      // Two mechanics per category — the shape that reveals `+=`
      // concatenation (a single mechanic per category would pass by
      // accident, per the T-089/T-091 lesson documented above).
      const pmvs = [
        buildPmv(onMechanic, null, {
          calculatedSpend: 100.0,
        }),
        buildPmv(onMechanic, null, {
          calculatedSpend: 50.25,
        }),
        buildPmv(offMechanic, null, {
          calculatedSpend: 20.0,
        }),
        buildPmv(offMechanic, null, {
          calculatedSpend: 15.75,
        }),
      ];
      const planFu = buildPlanFu(pmvs);
      const plan = buildPlan([planFu]);

      h.planRepo.findOne.mockResolvedValue(plan as Plan);
      h.budgetAllocationService.checkAvailability.mockResolvedValue({
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 100000,
        onInvoiceSufficient: true,
        offInvoiceSufficient: true,
        onInvoiceShortfall: 0,
        offInvoiceShortfall: 0,
        suggestions: [],
      } as any);

      const result = await h.service.validateBudgetImpact(TENANT_ID, PLAN_ID);

      expect(h.budgetAllocationService.checkAvailability).toHaveBeenCalledTimes(
        1,
      );
      const [, context] =
        h.budgetAllocationService.checkAvailability.mock.calls[0];
      expect(typeof context.estimatedOnInvoiceSpend).toBe('number');
      expect(typeof context.estimatedOffInvoiceSpend).toBe('number');
      expect(Number.isNaN(context.estimatedOnInvoiceSpend)).toBe(false);
      expect(Number.isNaN(context.estimatedOffInvoiceSpend)).toBe(false);
      // Not "0100.0050.25" -> NaN; the real arithmetic sum.
      expect(context.estimatedOnInvoiceSpend).toBe(150.25);
      expect(context.estimatedOffInvoiceSpend).toBe(35.75);
      expect(result.isSufficient).toBe(true);
    });
  });

  /* ================================================================ *
   * T-091 — end-to-end: the literal "Shortfall: NaN" message fix
   *
   * The T-091 defect was a CHAIN, not a single-file bug: this service's
   * broken `totalOnInvoiceSpend` accumulator produced NaN ->
   * `estimatedOnInvoiceSpend: NaN` -> BudgetAllocationService.checkAvailability
   * computed `available >= NaN` (always false, so EVERY plan reported
   * "Insufficient On-Invoice budget" regardless of real budget) and
   * `Math.max(0, NaN - available)` (NaN shortfall) -> rendered here as the
   * literal string "Shortfall: NaN". Mocking BudgetAllocationService (as the
   * harness above does) cannot reproduce that chain — this block wires the
   * REAL BudgetAllocationService.checkAvailability behind
   * SpendValidationService instead, both plain classes constructed directly
   * (no Nest DI needed for either).
   * ================================================================ */
  describe('validateBudgetImpact — T-091 end-to-end (real checkAvailability, "Shortfall: NaN" message)', () => {
    function createEndToEndHarness() {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };
      const allocationRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      };
      const thresholdService = {
        getThresholds: jest.fn(),
        isExceeded: jest.fn(),
      };

      const realBudgetAllocationService = new BudgetAllocationService(
        allocationRepo as any,
        {} as any,
        {} as any,
        // T-096/2: DataSource, injected so balance writes and their transaction
        // logs share one transaction. Unused on this path.
        {} as any,
        thresholdService as any,
      );

      const spendPlanRepo = { findOne: jest.fn() };

      const service = new SpendValidationService(
        spendPlanRepo as any,
        {} as any,
        {} as any,
        {} as any,
        realBudgetAllocationService,
        {} as any,
      );

      return { service, spendPlanRepo, queryBuilder };
    }

    it('produces a numeric "Shortfall: X.XX" message — not the literal "Shortfall: NaN" — for a multi-mechanic on-invoice overspend', async () => {
      const { service, spendPlanRepo, queryBuilder } = createEndToEndHarness();

      const onMechanic1 = makeMechanic({
        code: 'ON_E2E_1',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      const onMechanic2 = makeMechanic({
        code: 'ON_E2E_2',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
      });
      // Two on-invoice mechanics: under the old code the second `+=`
      // concatenated the strings, producing NaN for totalOnInvoiceSpend.
      const pmvs = [
        buildPmv(onMechanic1, null, {
          calculatedSpend: 600.0,
        }),
        buildPmv(onMechanic2, null, {
          calculatedSpend: 500.0,
        }),
      ];
      const planFu = buildPlanFu(pmvs);
      const plan: Partial<Plan> = {
        id: PLAN_ID,
        tenantId: TENANT_ID,
        cplId: 'cpl-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
        channel: { code: 'NKA' } as any,
        category: { code: 'DAIRY' } as any,
        planFus: [planFu],
      };
      spendPlanRepo.findOne.mockResolvedValue(plan as Plan);

      // Real allocation with only 100 available on-invoice -> real shortfall.
      queryBuilder.getOne.mockResolvedValue({
        id: 'alloc-e2e',
        onInvoiceAvailable: 100,
        offInvoiceAvailable: 100000,
      });

      const result = await service.validateBudgetImpact(TENANT_ID, PLAN_ID);

      expect(result.isSufficient).toBe(false);
      // totalOnInvoiceSpend = 600 + 500 = 1100; available = 100.
      expect(result.onInvoiceShortfall).toBe(1000);
      expect(Number.isNaN(result.onInvoiceShortfall)).toBe(false);

      const budgetError = result.errors.find((e) =>
        e.message.includes('Insufficient On-Invoice budget'),
      );
      expect(budgetError).toBeDefined();
      expect(budgetError!.message).toBe(
        'Insufficient On-Invoice budget. Shortfall: 1000.00',
      );
      expect(budgetError!.message).not.toContain('NaN');
    });
  });

  /* ================================================================ *
   * T-085 — validateInputs: min/max STRING comparison fix
   *
   * AT THE TIME OF THE FIX, `enteredValue` (off a transformer-less `numeric`
   * column) and `mechanic.minValue`/`maxValue` (also transformer-less
   * `numeric(18,4)`) were compared directly, i.e. as STRINGS: lexicographic
   * order, not numeric order. "5.0000" < "10.0000" is false (a real min
   * violation went unreported); "50.0000" > "100.0000" is true (a valid
   * value was flagged).
   *
   * ⚠️ STALE PREMISE, CORRECTED (review, T-197/T-221, 2026-08-15):
   * `enteredValue` is transformer-less ONLY for PERCENT (`entered_rate_pct`).
   * AMOUNT_PER_UNIT/AMOUNT now carry `UnitPriceTransformer`/
   * `MoneyTransformer` and arrive as a `number` (`buildPmv`'s doc comment
   * above has the full table). The PERCENT fixtures below still pass min/max
   * as STRINGS — that stays load-bearing, it is the real shape a
   * transformer-less column returns. `mechanic.minValue`/`maxValue` stay
   * transformer-less on BOTH sides regardless of mechanic type (ADR 0007
   * Karar 4 — the min/max/default_value/step_increment split has not
   * landed), so the "MAX_REAL" test below deliberately passes a NUMBER for
   * `entered` (AMOUNT) against a STRING `maxValue`, exercising the
   * number-vs-string leg `numericTextToNumber` normalises — not a fixture
   * left over from before this correction.
   * ================================================================ */
  describe('validateInputs — T-085 (min/max string-comparison fix)', () => {
    let h: ServiceHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    it('reports a min violation that lexicographic string comparison used to miss ("5.0000" < "10.0000" is false as strings)', async () => {
      const mechanic = makeMechanic({
        code: 'MIN_MISS',
        inputType: InputType.PERCENTAGE,
        minValue: '10.0000' as unknown as number,
      });
      const pmv = buildPmv(mechanic, '5.0000');
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateInputs(TENANT_ID, FU_ID);

      expect(result.isValid).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      const [err] = result.errors;
      expect(err.severity).toBe(ErrorSeverity.ERROR);
      expect(err.category).toBe(ErrorCategory.INPUT_ERROR);
      expect(err.field).toBe('MIN_MISS');
      expect(err.message).toContain('Value must be at least 10.0000');
    });

    it('does not report a max violation for a genuinely valid value ("50.0000" > "100.0000" was true as strings)', async () => {
      const mechanic = makeMechanic({
        code: 'MINMAX_OK',
        inputType: InputType.PERCENTAGE,
        minValue: '0.0000' as unknown as number,
        maxValue: '100.0000' as unknown as number,
      });
      const pmv = buildPmv(mechanic, '50.0000');
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateInputs(TENANT_ID, FU_ID);

      expect(result.errors).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.isValid).toBe(true);
    });

    it('still reports a genuine max violation once compared numerically', async () => {
      // AMOUNT/currency here (not percentage) so the assertion isolates the
      // min/max gate from the separate 0-100 range check on percentages.
      // `entered` is a NUMBER here (not a string like the PERCENT cases
      // above): `mechanicType: AMOUNT` reads through `entered_total_amount`,
      // which carries `MoneyTransformer` as of T-197/T-221 — see `buildPmv`'s
      // doc comment. `mechanic.maxValue` stays a string: `mechanics.max_value`
      // remains transformer-less regardless of mechanic type.
      const mechanic = makeMechanic({
        code: 'MAX_REAL',
        inputType: InputType.CURRENCY,
        mechanicType: MechanicType.AMOUNT,
        category: MechanicCategory.LUMPSUM_SPEND,
        maxValue: '100.0000' as unknown as number,
      });
      const pmv = buildPmv(mechanic, 150.0);
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateInputs(TENANT_ID, FU_ID);

      expect(result.isValid).toBe(false);
      expect(result.errorCount).toBe(1);
      const [err] = result.errors;
      expect(err.severity).toBe(ErrorSeverity.ERROR);
      expect(err.field).toBe('MAX_REAL');
      expect(err.message).toContain('Value must be at most 100.0000');
    });
  });

  /* ================================================================ *
   * T-085 — validateInputs: decimal-place gate removed
   *
   * The removed check measured the COLUMN'S scale (`numeric(9,4)` always
   * renders 4 fraction digits, e.g. "10.0000"), not what the planner typed.
   * It fired "Maximum 2 decimal places allowed" for every percentage
   * mechanic. C3 (write-side `checkEnteredScale`) is the real gate and
   * exempts unit amounts on purpose (4-decimal per-unit prices are legit).
   * ================================================================ */
  describe('validateInputs — T-085 (decimal-place gate removed)', () => {
    let h: ServiceHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    it('does not produce "Maximum 2 decimal places" for a plain percentage entry (used to fire for every percentage mechanic, e.g. a plain 10%)', async () => {
      const mechanic = makeMechanic({
        code: 'PCT_NODEC',
        inputType: InputType.PERCENTAGE,
      });
      const pmv = buildPmv(mechanic, '10.0000');
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateInputs(TENANT_ID, FU_ID);

      expect(result.errors).toHaveLength(0);
      expect(result.isValid).toBe(true);
      expect(
        result.errors.some((e) => e.message.toLowerCase().includes('decimal')),
      ).toBe(false);
    });

    it('does not produce a decimal-place error for a PRICE_SUP-shaped units/AMOUNT_PER_UNIT mechanic with a 4-decimal entry (consistent with C3\'s unit-amount exemption)', async () => {
      // `entered` is a NUMBER here: `mechanicType: AMOUNT_PER_UNIT` reads
      // through `entered_unit_amount`, which carries `UnitPriceTransformer`
      // as of T-197/T-221 — see `buildPmv`'s doc comment.
      const mechanic = makeMechanic({
        code: 'PRICE_SUP',
        inputType: InputType.UNITS,
        mechanicType: MechanicType.AMOUNT_PER_UNIT,
        category: MechanicCategory.PER_UNIT_SUPPORT,
      });
      const pmv = buildPmv(mechanic, 0.0125);
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu([pmv]));

      const result = await h.service.validateInputs(TENANT_ID, FU_ID);

      expect(result.errors).toHaveLength(0);
      expect(result.isValid).toBe(true);
      expect(
        result.errors.some((e) => e.message.toLowerCase().includes('decimal')),
      ).toBe(false);
    });
  });

  /* ================================================================ *
   * T-085 — validateCombinations: `activeMechanics` filter STRING bug
   *
   * The predicate read `v !== 0` against a transformer-less `numeric`
   * column, i.e. a STRING: `"0.0000" !== 0` is always true (strict
   * inequality never coerces across types), so a zero-valued mechanic never
   * left `activeMechanics`. Downstream: two mutually-exclusive mechanics
   * both entered as 0% were reported as a CONFLICT even though neither is
   * actually in play (ADR 0008: absent and zero both mean "not entered").
   * ================================================================ */
  describe('validateCombinations — T-085 (activeMechanics zero-string filter fix)', () => {
    let h: ServiceHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    it('does not report a mutual-exclusion conflict when both mutually exclusive mechanics are entered as "0.0000" (both inactive)', async () => {
      const mechA = makeMechanic({
        code: 'MX_A',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        mutuallyExclusiveWith: ['MX_B'],
      });
      const mechB = makeMechanic({
        code: 'MX_B',
        category: MechanicCategory.OFF_INVOICE_DISCOUNT,
        mutuallyExclusiveWith: ['MX_A'],
      });
      const pmvs = [buildPmv(mechA, '0.0000'), buildPmv(mechB, '0.0000')];
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu(pmvs));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      expect(result.conflicts).toHaveLength(0);
      expect(
        result.errors.some(
          (e) =>
            e.category === ErrorCategory.COMBINATION_ERROR &&
            e.message.includes('cannot be used with'),
        ),
      ).toBe(false);
    });

    it('treats only the non-zero mechanic as active: the "0.0000" one is excluded from mutual-exclusion checking even though the old string comparison ("0.0000" !== 0) always kept it', async () => {
      const mechZero = makeMechanic({
        code: 'MX_ZERO',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        mutuallyExclusiveWith: ['MX_ACTIVE'],
      });
      const mechActive = makeMechanic({
        code: 'MX_ACTIVE',
        category: MechanicCategory.OFF_INVOICE_DISCOUNT,
        mutuallyExclusiveWith: ['MX_ZERO'],
      });
      const pmvs = [
        buildPmv(mechZero, '0.0000'),
        buildPmv(mechActive, '10.0000'),
      ];
      h.planFuRepo.findOne.mockResolvedValue(buildPlanFu(pmvs));

      const result = await h.service.validateCombinations(TENANT_ID, FU_ID);

      // Old (buggy) code: "0.0000" !== 0 is always true -> MX_ZERO stayed in
      // activeMechanics -> a conflict with MX_ACTIVE was reported even
      // though MX_ZERO contributes nothing. Fixed code: MX_ZERO is excluded,
      // so there is no conflict to find.
      expect(result.conflicts).toHaveLength(0);
      expect(
        result.errors.some(
          (e) =>
            e.category === ErrorCategory.COMBINATION_ERROR &&
            e.message.includes('cannot be used with'),
        ),
      ).toBe(false);
    });
  });
});
