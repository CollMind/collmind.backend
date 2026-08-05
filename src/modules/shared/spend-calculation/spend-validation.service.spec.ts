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
 *   - T-085 (not yet written): string comparison at minValue/maxValue
 *     (`validateInputs` ~:154/:167) + `Number.isInteger` on a string (~:138).
 *   - T-088 (unrelated service, similar pattern).
 *
 * T-085 should add its own top-level `describe('validateInputs — T-085 ...')`
 * block below and MAY reuse `createHarness`/`buildMechanic`/`buildPmv` rather
 * than duplicating the module wiring.
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
 * `entered_*` column matches `mechanic.mechanicType`, and — critically — is
 * accepted as a STRING by callers, because that is the real shape a
 * transformer-less `decimal` column returns from Postgres. Passing a JS
 * `number` here would silently skip the defect this file exists to catch
 * (T-089 task note; T-080 lost 11 tests to exactly this shortcut).
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
   * T-085 (not in scope here) will add:
   *   describe('validateInputs — T-085 (minValue/maxValue string compare + Number.isInteger)', ...)
   * reusing `createHarness`, `makeMechanic`, `buildPmv`, `buildPlanFu` above.
   * ================================================================ */
});
