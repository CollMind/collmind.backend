import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FinanceReportingService } from './finance-reporting.service';
import {
  Plan,
  PlanFu,
  PlanStatus,
} from '../../../database/entities/plan.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { BudgetEnvelope } from '../../../database/entities/budget-envelope.entity';
import { MechanicCategory } from '../../../database/entities/mechanic.entity';
import { BudgetRepository } from '../budget/budget.repository';
import {
  BudgetThresholdService,
  BudgetThresholds,
} from '../budget/budget-threshold.service';
import { UtilizationStatus } from './dto/budget-utilization.dto';
import { AccessScopeService } from '../access-scope/access-scope.service';
import { ReportGranularity } from './dto/report-filters.dto';

/**
 * T-093 — coverage for `spendOf()` in finance-reporting.service.ts.
 *
 * ⚠️ STALE PREMISE, CORRECTED (review, 2026-08-15): this used to say the
 * fixtures "deliberately use STRING money values (the real pg-driver shape for
 * `numeric` columns without a TypeORM transformer)". As of T-197/T-221 that
 * shape is no longer real for any of the three columns under test —
 * `calculated_spend` now carries `MoneyTransformer` and both LTA spend columns
 * already carried `DecimalTransformer` before this turn — so TypeORM always
 * hands back a `number` here. See the corrected comment on `spendOf()` itself
 * for the full account; this fixture is updated to match (`number`, not
 * `string`), which is what production actually delivers.
 *
 * `spendOf()`'s own `String()`+`moneyFromNumericString` conversion still runs
 * regardless of the input's type, so it does not need a string input to be
 * exercised — the accumulation behaviour these tests check (AT LEAST TWO rows
 * per accumulator, since a single row cannot expose `0 + x` string-concatenation
 * even when it WAS reachable) is unaffected by the type change. See T-089/T-091
 * for the original defect shape this class of test guards against.
 */

const TENANT = 'tenant-1';

const THRESHOLDS: BudgetThresholds = {
  warning: 80,
  critical: 95,
  exceeded: 100,
};

function buildPlan(partial: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    planCode: 'PLAN-1',
    planName: 'Plan 1',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-31'),
    status: PlanStatus.APPROVED,
    ragStatus: 'RED',
    overallRoi: 10,
    ...partial,
  } as Plan;
}

function buildMechanic(category: MechanicCategory, code = 'MECH'): any {
  return { code, category };
}

/**
 * A `plan_mechanic_values.calculated_spend` row as TypeORM hands it back:
 * a `number`, via `MoneyTransformer` (was a STRING before T-197/T-221; see
 * the module comment above).
 */
function buildPmv(
  calculatedSpend: number,
  category: MechanicCategory,
  code = 'MECH',
): any {
  return { calculatedSpend, mechanic: buildMechanic(category, code) };
}

/**
 * A `plan_skus` row with the LTA spend columns as TypeORM hands them back:
 * `number`, via `DecimalTransformer` (was a STRING before this entity picked
 * up a transformer; see the module comment above).
 */
function buildPlanSku(
  plannedLtaOnInvoiceSpend: number,
  plannedLtaOffInvoiceSpend: number,
): any {
  return { plannedLtaOnInvoiceSpend, plannedLtaOffInvoiceSpend };
}

function buildPlanFu(planMechanicValues: any[], planSkus: any[] = []): any {
  return { planMechanicValues, planSkus };
}

/** Chainable TypeORM QueryBuilder mock — every method returns `this`. */
function buildQueryBuilder(overrides: Record<string, any> = {}) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getManyAndCount: jest.fn(),
    ...overrides,
  };
  return qb;
}

describe('FinanceReportingService — T-093 spend accumulator regression coverage', () => {
  let service: FinanceReportingService;
  let planRepository: { createQueryBuilder: jest.Mock };
  let planFuRepository: { find: jest.Mock };
  // T-270/Z21 (A2): `getBudgetAtRisk` (below) reads budget totals through
  // `computeBudgetUtilization`, now sourced from `BudgetEnvelope` (envelope
  // model), not the retired `BudgetAllocation`. `getMany` resolves `[]` by
  // default — same "no budget data" shape the old `find()` mock had, and
  // the fixture this suite's `getBudgetAtRisk` test relies on (it never
  // asserts on budget totals, only `redPlans`/`totalSpend`).
  let budgetEnvelopeQueryBuilder: ReturnType<typeof buildQueryBuilder>;
  let budgetEnvelopeRepository: { createQueryBuilder: jest.Mock };
  let budgetRepository: { getAllBudgetSummaries: jest.Mock };
  let budgetThresholdService: {
    getThresholds: jest.Mock;
    toStatus: jest.Mock;
  };

  beforeEach(async () => {
    planRepository = { createQueryBuilder: jest.fn() };
    planFuRepository = { find: jest.fn() };
    budgetEnvelopeQueryBuilder = buildQueryBuilder({
      getMany: jest.fn().mockResolvedValue([]),
    });
    budgetEnvelopeRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(budgetEnvelopeQueryBuilder),
    };
    budgetRepository = {
      getAllBudgetSummaries: jest.fn().mockResolvedValue([]),
    };
    budgetThresholdService = {
      getThresholds: jest.fn().mockResolvedValue(THRESHOLDS),
      toStatus: jest.fn((percent: number, t: BudgetThresholds) => {
        if (percent >= t.critical) return UtilizationStatus.RED;
        if (percent >= t.warning) return UtilizationStatus.AMBER;
        return UtilizationStatus.GREEN;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReportingService,
        { provide: getRepositoryToken(Plan), useValue: planRepository },
        { provide: getRepositoryToken(PlanFu), useValue: planFuRepository },
        { provide: getRepositoryToken(PlanMechanicValue), useValue: {} },
        { provide: getRepositoryToken(MechanicSpendBreakdown), useValue: {} },
        {
          provide: getRepositoryToken(BudgetEnvelope),
          useValue: budgetEnvelopeRepository,
        },
        { provide: BudgetThresholdService, useValue: budgetThresholdService },
        { provide: BudgetRepository, useValue: budgetRepository },
        { provide: AccessScopeService, useValue: {} },
      ],
    }).compile();

    service = module.get(FinanceReportingService);
  });

  describe('getSpendTrend (GET /finance-reporting/spend-trend)', () => {
    it('sums two mechanic rows + two SKU LTA rows into correct numbers, not concatenated strings', async () => {
      const plan = buildPlan({
        id: 'plan-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
      });
      const qb = buildQueryBuilder({
        getMany: jest.fn().mockResolvedValue([plan]),
      });
      planRepository.createQueryBuilder.mockReturnValue(qb);

      const planFu = buildPlanFu(
        [
          buildPmv(100.0, MechanicCategory.ON_INVOICE_DISCOUNT, 'ON-MECH'),
          buildPmv(50.0, MechanicCategory.OFF_INVOICE_DISCOUNT, 'OFF-MECH'),
        ],
        [buildPlanSku(20.0, 5.0), buildPlanSku(10.0, 15.0)],
      );
      planFuRepository.find.mockResolvedValue([planFu]);

      const report = await service.getSpendTrend(
        TENANT,
        { startDate: '2026-01-01', endDate: '2026-01-01' },
        ReportGranularity.DAILY,
      );

      expect(report.dataPoints).toHaveLength(1);
      const dp = report.dataPoints[0];

      // onInvoice = pmv(100) + ltaOn(20) + ltaOn(10) = 130 — three additions
      // to the SAME accumulator; a concatenation bug cannot survive this.
      for (const field of [
        'onInvoice',
        'offInvoice',
        'total',
        'ltaOnInvoice',
        'ltaOffInvoice',
        'promoOnInvoice',
        'promoOffInvoice',
      ] as const) {
        expect(typeof dp[field]).toBe('number');
        expect(Number.isNaN(dp[field] as number)).toBe(false);
      }

      expect(dp.onInvoice).toBe(130);
      expect(dp.offInvoice).toBe(70);
      expect(dp.total).toBe(200);
      expect(dp.ltaOnInvoice).toBe(30);
      expect(dp.ltaOffInvoice).toBe(20);
      expect(dp.promoOnInvoice).toBe(100);
      expect(dp.promoOffInvoice).toBe(50);

      expect(typeof report.totalOnInvoice).toBe('number');
      expect(typeof report.totalOffInvoice).toBe('number');
      expect(report.totalOnInvoice).toBe(130);
      expect(report.totalOffInvoice).toBe(70);
    });
  });

  describe('getBudgetAtRisk (GET /finance-reporting/budget-at-risk)', () => {
    it('sums two mechanic rows across a RED plan into a correct numeric totalSpend', async () => {
      const plan = buildPlan({
        id: 'plan-red',
        planName: 'Red Plan',
        ragStatus: 'RED',
        overallRoi: 5,
      });
      const qb = buildQueryBuilder({
        getMany: jest.fn().mockResolvedValue([plan]),
      });
      planRepository.createQueryBuilder.mockReturnValue(qb);

      const planFu = buildPlanFu([
        buildPmv(100.0, MechanicCategory.ON_INVOICE_DISCOUNT),
        buildPmv(50.0, MechanicCategory.OFF_INVOICE_DISCOUNT),
      ]);
      planFuRepository.find.mockResolvedValue([planFu]);

      const report = await service.getBudgetAtRisk(TENANT, {});

      expect(report.redPlans).toHaveLength(1);
      const riskPlan = report.redPlans[0];

      expect(typeof riskPlan.totalSpend).toBe('number');
      expect(Number.isNaN(riskPlan.totalSpend)).toBe(false);
      expect(riskPlan.totalSpend).toBe(150);

      expect(typeof report.redPlansSpend).toBe('number');
      expect(report.redPlansSpend).toBe(150);
      expect(report.totalAtRisk).toBe(150);
    });
  });

  describe('getPlanPerformance (~:555, GET /finance-reporting/plan-performance)', () => {
    it('sums two mechanic rows per plan into correct numeric totalSpend/onInvoiceSpend/offInvoiceSpend', async () => {
      const plan = buildPlan({
        id: 'plan-perf',
        planName: 'Perf Plan',
        planCode: 'PLAN-PERF',
      });
      const qb = buildQueryBuilder({
        getManyAndCount: jest.fn().mockResolvedValue([[plan], 1]),
      });
      planRepository.createQueryBuilder.mockReturnValue(qb);

      const planFu = buildPlanFu([
        buildPmv(100.0, MechanicCategory.ON_INVOICE_DISCOUNT),
        buildPmv(50.0, MechanicCategory.OFF_INVOICE_DISCOUNT),
      ]);
      planFuRepository.find.mockResolvedValue([planFu]);

      const result = await service.getPlanPerformance(TENANT, {}, {});

      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];

      for (const field of [
        'totalSpend',
        'onInvoiceSpend',
        'offInvoiceSpend',
      ] as const) {
        expect(typeof row[field]).toBe('number');
        expect(Number.isNaN(row[field] as number)).toBe(false);
      }

      expect(row.totalSpend).toBe(150);
      expect(row.onInvoiceSpend).toBe(100);
      expect(row.offInvoiceSpend).toBe(50);
    });
  });

  describe('getCashFlowProjection (~:862, GET /finance-reporting/cash-flow-projection)', () => {
    it('sums two mechanic rows per plan into correct numeric on/off invoice outflow', async () => {
      const plan = buildPlan({
        id: 'plan-cf',
        planName: 'CF Plan',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
      });
      const qb = buildQueryBuilder({
        getMany: jest.fn().mockResolvedValue([plan]),
      });
      planRepository.createQueryBuilder.mockReturnValue(qb);

      const planFu = buildPlanFu([
        buildPmv(100.0, MechanicCategory.ON_INVOICE_DISCOUNT),
        buildPmv(50.0, MechanicCategory.OFF_INVOICE_DISCOUNT),
      ]);
      planFuRepository.find.mockResolvedValue([planFu]);

      const report = await service.getCashFlowProjection(TENANT, {}, 3);

      expect(report.projections.length).toBeGreaterThan(0);

      const onInvoiceProj = report.projections.find(
        (p) => p.onInvoiceOutflow > 0,
      );
      const offInvoiceProj = report.projections.find(
        (p) => p.offInvoiceOutflow > 0,
      );

      expect(onInvoiceProj).toBeDefined();
      expect(offInvoiceProj).toBeDefined();
      expect(typeof onInvoiceProj!.onInvoiceOutflow).toBe('number');
      expect(Number.isNaN(onInvoiceProj!.onInvoiceOutflow)).toBe(false);
      expect(onInvoiceProj!.onInvoiceOutflow).toBe(100);
      expect(typeof offInvoiceProj!.offInvoiceOutflow).toBe('number');
      expect(Number.isNaN(offInvoiceProj!.offInvoiceOutflow)).toBe(false);
      expect(offInvoiceProj!.offInvoiceOutflow).toBe(50);

      expect(typeof report.totalOnInvoiceOutflow).toBe('number');
      expect(typeof report.totalOffInvoiceOutflow).toBe('number');
      expect(typeof report.totalOutflow).toBe('number');
      expect(report.totalOnInvoiceOutflow).toBe(100);
      expect(report.totalOffInvoiceOutflow).toBe(50);
      expect(report.totalOutflow).toBe(150);
    });
  });

  // Not explicitly requested in T-093's test list, but getSpendComposition
  // (~:405) reads the same STRING `calculatedSpend` shape into the same
  // vulnerable accumulator pattern and is listed as an affected call site in
  // the task's "Ne düzeltildi" section. Added for coverage-gap closure —
  // flagged in the QA report as an addition beyond the explicit list.
  describe('getSpendComposition (~:405, GET /finance-reporting/spend-composition) — extra coverage', () => {
    it('sums two mechanic rows of the same category into a correct numeric amount', async () => {
      const plan = buildPlan({ id: 'plan-comp' });
      const qb = buildQueryBuilder({
        getMany: jest.fn().mockResolvedValue([plan]),
      });
      planRepository.createQueryBuilder.mockReturnValue(qb);

      const planFu = buildPlanFu([
        buildPmv(100.0, MechanicCategory.ON_INVOICE_DISCOUNT, 'ON-MECH'),
        buildPmv(50.0, MechanicCategory.ON_INVOICE_DISCOUNT, 'ON-MECH'),
      ]);
      planFuRepository.find.mockResolvedValue([planFu]);

      const report = await service.getSpendComposition(TENANT, {});

      expect(report.onInvoice).toHaveLength(1);
      const slice = report.onInvoice[0];

      expect(typeof slice.amount).toBe('number');
      expect(Number.isNaN(slice.amount)).toBe(false);
      expect(slice.amount).toBe(150);

      expect(typeof report.totalOnInvoice).toBe('number');
      expect(report.totalOnInvoice).toBe(150);
    });
  });

  /* ================================================================ *
   * T-221 — spendOf(): pin the String()+moneyFromNumericString
   * conversion ITSELF, independent of what today's columns produce.
   *
   * The five T-093 tests above now feed NUMBER fixtures, because that is
   * what `calculatedSpend` / `plannedLtaOnInvoiceSpend` /
   * `plannedLtaOffInvoiceSpend` actually deliver today (MoneyTransformer /
   * DecimalTransformer — see the module comment above and `spendOf()`'s own
   * doc comment in finance-reporting.service.ts). A mutation that deletes
   * `spendOf()`'s conversion and returns its input unchanged is INVISIBLE to
   * those five tests: for a finite number, `x` and
   * `moneyToMajorUnits(moneyFromNumericString(String(x)))` agree, so nothing
   * distinguishes correct code from a raw passthrough. Measured
   * independently (review, 2026-08-15): the five T-093 tests all stayed
   * green under that exact mutation.
   *
   * `spendOf`'s signature (`number | string`) is kept "so it stays safe if a
   * future column on this path ever loses its transformer" — per its own
   * doc comment — i.e. STRING input is a DELIBERATELY supported contract,
   * not a stale assumption left over from before the transformers existed.
   * This test feeds strings directly to pin that contract, so the
   * conversion cannot be quietly deleted without a test noticing —
   * independent of whatever shape the live entities happen to produce this
   * week.
   * ================================================================ */
  describe('getSpendTrend — spendOf() String() conversion contract (T-221)', () => {
    it('sums two mechanic rows + two SKU LTA rows into correct numbers, not concatenated strings, when the repository hands back STRING money values (a supported non-number input shape for spendOf())', async () => {
      const plan = buildPlan({
        id: 'plan-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
      });
      const qb = buildQueryBuilder({
        getMany: jest.fn().mockResolvedValue([plan]),
      });
      planRepository.createQueryBuilder.mockReturnValue(qb);

      const planFu = buildPlanFu(
        [
          buildPmv(
            '100.00' as any,
            MechanicCategory.ON_INVOICE_DISCOUNT,
            'ON-MECH',
          ),
          buildPmv(
            '50.00' as any,
            MechanicCategory.OFF_INVOICE_DISCOUNT,
            'OFF-MECH',
          ),
        ],
        [
          buildPlanSku('20.00' as any, '5.00' as any),
          buildPlanSku('10.00' as any, '15.00' as any),
        ],
      );
      planFuRepository.find.mockResolvedValue([planFu]);

      const report = await service.getSpendTrend(
        TENANT,
        { startDate: '2026-01-01', endDate: '2026-01-01' },
        ReportGranularity.DAILY,
      );

      expect(report.dataPoints).toHaveLength(1);
      const dp = report.dataPoints[0];

      for (const field of [
        'onInvoice',
        'offInvoice',
        'total',
        'ltaOnInvoice',
        'ltaOffInvoice',
        'promoOnInvoice',
        'promoOffInvoice',
      ] as const) {
        expect(typeof dp[field]).toBe('number');
        expect(Number.isNaN(dp[field] as number)).toBe(false);
      }

      // onInvoice = pmv(100) + ltaOn(20) + ltaOn(10) = 130 — three additions
      // to the same accumulator; a `raw as unknown as number` passthrough
      // (no String()/parse) would concatenate these into a non-numeric or
      // wrong-value result instead.
      expect(dp.onInvoice).toBe(130);
      expect(dp.offInvoice).toBe(70);
      expect(dp.total).toBe(200);
      expect(dp.ltaOnInvoice).toBe(30);
      expect(dp.ltaOffInvoice).toBe(20);
      expect(dp.promoOnInvoice).toBe(100);
      expect(dp.promoOffInvoice).toBe(50);

      expect(report.totalOnInvoice).toBe(130);
      expect(report.totalOffInvoice).toBe(70);
    });
  });
});
