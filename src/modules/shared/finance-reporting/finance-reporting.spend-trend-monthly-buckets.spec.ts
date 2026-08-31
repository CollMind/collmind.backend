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
import { BudgetThresholdService } from '../budget/budget-threshold.service';
import { AccessScopeService } from '../access-scope/access-scope.service';
import { KpiEngineService } from '../kpi-engine/kpi-engine.service';
import { ReportGranularity } from './dto/report-filters.dto';
import { ComparisonType } from './dto/variance-report.dto';

/**
 * getSpendTrend — MONTHLY bucket contract (Z63, hüküm `(c)`).
 *
 * ⛔ THE CONTRACT THIS FILE PINS, in one sentence (it is the same sentence the
 * production code carries, deliberately — see `getSpendTrend`):
 *
 *     A MONTHLY bucket IS a calendar month: its boundaries are the 1st of the
 *     month and its label is that month, and the edge buckets may be PARTIAL
 *     (a query starting 15 January produces a January bucket covering 15-31,
 *     still labelled January).
 *
 * ⛔ THE DEFECT (measured before the fix, T-329):
 *
 *     const periodEnd = new Date(currentDate);
 *     periodEnd.setMonth(periodEnd.getMonth() + 1);      // overflows
 *     currentDate.setMonth(currentDate.getMonth() + 1);  // and ACCUMULATES
 *
 *     startDate=2026-01-31, endDate=2026-06-30
 *       -> buckets 2026-01-31 · 2026-03-03 · 2026-04-03 · 2026-05-03 · 2026-06-03
 *          ⛔ FEBRUARY IS ABSENT ENTIRELY
 *       and February's spend does not vanish — it is FOLDED into a January
 *       bucket that silently spans 31 days too many. One month reads bigger
 *       than it is, another does not exist.
 *
 *     startDate=2026-01-28 (poz. kontrol) -> 01-28 · 02-28 · 03-28 · … , every
 *     month present: `setMonth` only overflows when the start day does not
 *     exist in the target month, which is why this defect is asleep on ~28
 *     days of every month (`DISIPLIN`: a calendar-driven "flake" is not a
 *     flake). The pin below is therefore PARAMETRIC over 28/29/30/31 rather
 *     than written on whatever day it happened to be written.
 *
 * ⚠️ WHY A RECONCILIATION LINE (Z63 §2 ii): in the February case the TOTAL
 * moved too — the run of buckets no longer partitioned the requested window,
 * so plans were counted in the wrong bucket and the trailing bucket reached
 * past the window. Checking buckets one by one can miss an accumulating
 * drift; `sum(buckets) === sum(plans)` cannot.
 */

const TENANT = 'tenant-1';

const THRESHOLDS = { warning: 80, critical: 95, exceeded: 100 };

/**
 * A `planRepository.createQueryBuilder` mock that REPRODUCES the date
 * predicate of `getFilteredPlans` (`plan.startDate >= :startDate` AND
 * `plan.endDate <= :endDate`, i.e. only plans FULLY CONTAINED in the window
 * reach the bucket loop).
 *
 * ⚠️ Faithfulness matters here and was measured: with a permissive mock the
 * §7.1 pin below asserted a number production cannot produce — the previous
 * window's trailing bucket picked up a plan that the SQL layer had already
 * excluded. `DISIPLIN`: "bir mock, taklit ettiği şeyin TİPİNE/DAVRANIŞINA
 * bağlanmalı" — a mock that is looser than production turns a green into a
 * statement about the mock.
 */
type QueryBuilderMock = {
  where: jest.Mock;
  andWhere: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
};

/** The subset of `getFilteredPlans`' bound parameters this mock reproduces. */
type DateBounds = { startDate?: string; endDate?: string };

function buildFilteringPlanQueryBuilder(plans: Plan[]): QueryBuilderMock {
  const bounds: DateBounds = {};
  const qb: QueryBuilderMock = {
    where: jest.fn(() => qb),
    andWhere: jest.fn((_sql: string, params: DateBounds = {}) => {
      if (params.startDate) bounds.startDate = params.startDate;
      if (params.endDate) bounds.endDate = params.endDate;
      return qb;
    }),
    leftJoinAndSelect: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getMany: jest.fn(() =>
      Promise.resolve(
        plans.filter(
          (p) =>
            (!bounds.startDate || p.startDate >= new Date(bounds.startDate)) &&
            (!bounds.endDate || p.endDate <= new Date(bounds.endDate)),
        ),
      ),
    ),
    getManyAndCount: jest.fn(),
  };
  return qb;
}

/**
 * Chainable QueryBuilder mock that returns `plans` UNFILTERED — the bucket
 * loop then sees rows production's SQL layer would have narrowed. Used where a
 * pin must isolate the bucket layer's own contract (pin 3); pin 4 uses the
 * filtering builder above instead.
 */
function buildQueryBuilder(plans: Plan[] = []): QueryBuilderMock {
  const qb: QueryBuilderMock = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    leftJoinAndSelect: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getMany: jest.fn(() => Promise.resolve(plans)),
    getManyAndCount: jest.fn(),
  };
  return qb;
}

function buildPlan(id: string, startDate: string, endDate: string): Plan {
  return {
    id,
    planCode: id.toUpperCase(),
    planName: id,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    status: PlanStatus.APPROVED,
    ragStatus: 'GREEN',
    overallRoi: 10,
  } as Plan;
}

describe('getSpendTrend — MONTHLY kova sözleşmesi (takvim ayı, Z63/T-329)', () => {
  let service: FinanceReportingService;
  let planRepository: { createQueryBuilder: jest.Mock };
  let planFuRepository: { find: jest.Mock };

  beforeEach(async () => {
    planRepository = { createQueryBuilder: jest.fn() };
    planFuRepository = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReportingService,
        { provide: getRepositoryToken(Plan), useValue: planRepository },
        { provide: getRepositoryToken(PlanFu), useValue: planFuRepository },
        { provide: getRepositoryToken(PlanMechanicValue), useValue: {} },
        { provide: getRepositoryToken(MechanicSpendBreakdown), useValue: {} },
        {
          provide: getRepositoryToken(BudgetEnvelope),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(buildQueryBuilder()),
          },
        },
        {
          provide: BudgetThresholdService,
          useValue: {
            getThresholds: jest.fn().mockResolvedValue(THRESHOLDS),
            toStatus: jest.fn(),
          },
        },
        {
          provide: BudgetRepository,
          useValue: { getAllBudgetSummaries: jest.fn().mockResolvedValue([]) },
        },
        { provide: AccessScopeService, useValue: {} },
        {
          // `T-343`/`Z71 §1`: Target-ROI hedefi konfigürasyondan okunuyor.
          // ⛔ Mock `null` DÖNER: eşik okunamadığında below-target yolu
          // hiçbir plan işaretlememeli (`§2.5` — uydurulmuş hedefe yargı
          // yok). Bu, testlerin mevcut beklentilerini DEĞİŞTİRMEZ ve
          // varsayılan davranışın "sessiz eşik" OLMADIĞINI de pinler.
          provide: KpiEngineService,
          useValue: { getKpiConfig: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(FinanceReportingService);
  });

  /**
   * ⛔ PIN 1 — RELATIONSHIP pin, not a date pin (Z63 §2 ii).
   *
   * The four month-end start days are parameters, not a hand-picked date: the
   * defect fires for 29/30/31 in a 28-day February and is asleep for 28, so a
   * pin written on a single day is either always-red or always-green for the
   * wrong reason.
   */
  describe.each([28, 29, 30, 31])(
    'başlangıç 2026-01-%d (ay-sonu, parametrik)',
    (startDay: number) => {
      const startDate = `2026-01-${startDay}`;

      it('HER AY TAM BİR KEZ: Ocak..Haziran, atlanan/tekrarlanan ay YOK', async () => {
        planRepository.createQueryBuilder.mockReturnValue(
          buildQueryBuilder([]),
        );

        const report = await service.getSpendTrend(
          TENANT,
          { startDate, endDate: '2026-06-30' },
          ReportGranularity.MONTHLY,
        );

        const labels = report.dataPoints.map((dp) => dp.date);

        // Boundaries are the 1st of the month — including the FIRST bucket,
        // which is partial (it covers 31 Jan only when startDay=31) but is
        // still labelled January.
        expect(labels).toEqual([
          '2026-01-01',
          '2026-02-01',
          '2026-03-01',
          '2026-04-01',
          '2026-05-01',
          '2026-06-01',
        ]);

        // Stated separately from the equality above so a failure says WHICH
        // property broke: February present (the measured defect), and no
        // month twice.
        const months = labels.map((d) => d.slice(0, 7));
        expect(months).toContain('2026-02');
        expect(new Set(months).size).toBe(months.length);
      });
    },
  );

  /**
   * ⛔ PIN 2 — MUTABAKAT (Z63 §2 ii). Six plans, one per calendar month, each
   * with a DIFFERENT spend, each contained in its own month: a bucket run that
   * partitions the window must reproduce every plan exactly once, so
   * `sum(buckets) === sum(plans)` AND each month carries its own plan's spend.
   *
   * The per-month assertion is what catches the FOLDING half of the defect
   * (February's spend landing in an over-wide January bucket); the sum is what
   * catches the accumulating half (a bucket run that drifts off the window and
   * loses or double-counts a plan).
   */
  it('MUTABAKAT: toplam = kovaların toplamı = planların toplamı, ay ayrımı korunur', async () => {
    // Plan `m` lives entirely inside calendar month `m`. January's sits on the
    // 31st so that it is inside the (partial) first bucket of a 01-31 query —
    // a plan before the query start is outside the window by construction and
    // would not belong in this reconciliation.
    const spendByPlan: Record<string, number> = {
      'plan-01': 100,
      'plan-02': 200,
      'plan-03': 300,
      'plan-04': 400,
      'plan-05': 500,
      'plan-06': 600,
    };
    const plans = [
      buildPlan('plan-01', '2026-01-31', '2026-01-31'),
      buildPlan('plan-02', '2026-02-10', '2026-02-20'),
      buildPlan('plan-03', '2026-03-10', '2026-03-20'),
      buildPlan('plan-04', '2026-04-10', '2026-04-20'),
      buildPlan('plan-05', '2026-05-10', '2026-05-20'),
      buildPlan('plan-06', '2026-06-10', '2026-06-20'),
    ];

    planRepository.createQueryBuilder.mockReturnValue(buildQueryBuilder(plans));
    planFuRepository.find.mockImplementation(
      ({ where }: { where: { planId: string } }) =>
        Promise.resolve([
          {
            planMechanicValues: [
              {
                calculatedSpend: spendByPlan[where.planId],
                mechanic: {
                  code: 'ON-MECH',
                  category: MechanicCategory.ON_INVOICE_DISCOUNT,
                },
              },
            ],
            planSkus: [],
          },
        ]),
    );

    const report = await service.getSpendTrend(
      TENANT,
      { startDate: '2026-01-31', endDate: '2026-06-30' },
      ReportGranularity.MONTHLY,
    );

    const byMonth = Object.fromEntries(
      report.dataPoints.map((dp) => [dp.date.slice(0, 7), dp.total]),
    );
    expect(byMonth).toEqual({
      '2026-01': 100,
      '2026-02': 200,
      '2026-03': 300,
      '2026-04': 400,
      '2026-05': 500,
      '2026-06': 600,
    });

    const bucketSum = report.dataPoints.reduce((s, dp) => s + dp.total, 0);
    const planSum = Object.values(spendByPlan).reduce((s, v) => s + v, 0);
    expect(bucketSum).toBe(planSum); // 2100
    expect(report.totalOnInvoice + report.totalOffInvoice).toBe(planSum);
  });

  /**
   * ⛔ PIN 3 — the leading edge is PARTIAL and that is LEGITIMATE (Z63 §2 i).
   *
   * A mid-month start must not shift the grid: the January bucket covers
   * 15-31 and is still labelled January. Without this, a fix could "pass" pin
   * 1 by rounding the start down to the 1st and silently WIDENING the window
   * to include spend the caller did not ask for.
   *
   * ⚠️ THE PERMISSIVE MOCK IS DELIBERATE HERE (unlike pin 4). In production
   * `getFilteredPlans` ALSO excludes the 5 January plan at the SQL layer
   * (`plan.startDate >= :startDate`), so with a faithful mock this assertion
   * would be carried by SQL and would stay green even if the bucket loop
   * started the first bucket at the 1st — i.e. it would stop discriminating
   * (`§2.7` #6: "kapsam var, ayırt etme gücü yok"). Feeding the bucket loop a
   * row the SQL layer would have filtered isolates the BUCKET layer's own
   * contract: `periodStart` is the QUERY start, not the month start.
   * Verified by mutation (`periodStart = startOfUtcMonth(currentDate)`):
   * this test goes red (1600 instead of 700), pins 1/2/4 stay green.
   */
  it('AY ORTASI başlangıç: ilk kova KISMİ (15-31) ama etiketi yine Ocak, pencere GENİŞLEMEZ', async () => {
    // A plan on 5 January is BEFORE the requested window. If the first bucket
    // were normalised down to 01-01 it would be counted; it must not be.
    const plans = [
      buildPlan('plan-before', '2026-01-05', '2026-01-06'),
      buildPlan('plan-inside', '2026-01-20', '2026-01-21'),
    ];
    planRepository.createQueryBuilder.mockReturnValue(buildQueryBuilder(plans));
    planFuRepository.find.mockImplementation(
      ({ where }: { where: { planId: string } }) =>
        Promise.resolve([
          {
            planMechanicValues: [
              {
                calculatedSpend: where.planId === 'plan-inside' ? 700 : 900,
                mechanic: {
                  code: 'ON-MECH',
                  category: MechanicCategory.ON_INVOICE_DISCOUNT,
                },
              },
            ],
            planSkus: [],
          },
        ]),
    );

    const report = await service.getSpendTrend(
      TENANT,
      { startDate: '2026-01-15', endDate: '2026-02-10' },
      ReportGranularity.MONTHLY,
    );

    expect(report.dataPoints.map((dp) => dp.date)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
    // 700 only: the 5 January plan is outside the requested window and the
    // January bucket starts at the QUERY start, not at the 1st.
    expect(report.dataPoints[0].total).toBe(700);
  });

  /**
   * ⛔ PIN 4 — §7.1: `getVarianceAnalysis` PREVIOUS_PERIOD is an INDIRECT
   * consumer (it calls `getSpendTrend` twice, both MONTHLY). Its `planned*`
   * figures are the previous window's bucket totals, so a bucket run that
   * drifts off the window moves a number the user reads as "geçen dönem".
   * This pins the relationship — previous-period total equals the sum of the
   * plans actually inside the previous window — rather than a literal.
   */
  it('§7.1 DOLAYLI TÜKETİCİ: variance PREVIOUS_PERIOD, önceki pencerenin planlarını TAM BİR KEZ sayar', async () => {
    // Window 2026-04-01 .. 2026-05-31 (60 days) -> previous window
    // 2026-01-31 .. 2026-04-01, i.e. a MONTH-END start — which is what makes
    // this pin DISCRIMINATING rather than merely green: with the defect the
    // previous window's buckets are [01-31, 03-03) and [03-03, 04-03), so
    // `plan-prev` (01-03 March .. 05 March) STRADDLES the 03-03 boundary and
    // is counted TWICE -> planned = 2000. Measured before the fix.
    // With calendar-month boundaries (01-31|02-01|03-01|04-01) it falls in
    // March alone -> planned = 1000.
    const plans = [
      buildPlan('plan-prev', '2026-03-01', '2026-03-05'),
      buildPlan('plan-cur', '2026-04-05', '2026-04-06'),
    ];
    // ⚠️ The FILTERING mock here (unlike pin 3, which deliberately uses the
    // permissive one): `getVarianceAnalysis` issues a SECOND query for the
    // previous window, and reproducing the SQL date predicate is what keeps
    // this pin a statement about production rather than about the mock.
    planRepository.createQueryBuilder.mockImplementation(() =>
      buildFilteringPlanQueryBuilder(plans),
    );
    planFuRepository.find.mockImplementation(
      ({ where }: { where: { planId: string } }) =>
        Promise.resolve([
          {
            planMechanicValues: [
              {
                calculatedSpend: where.planId === 'plan-prev' ? 1000 : 250,
                mechanic: {
                  code: 'ON-MECH',
                  category: MechanicCategory.ON_INVOICE_DISCOUNT,
                },
              },
            ],
            planSkus: [],
          },
        ]),
    );

    const report = await service.getVarianceAnalysis(
      TENANT,
      { startDate: '2026-04-01', endDate: '2026-05-31' },
      ComparisonType.PREVIOUS_PERIOD,
    );

    const total = report.variances.find((v) => v.category === 'Total');
    expect(total).toBeDefined();
    // planned = previous window's spend (plan-prev, 1000) — counted ONCE.
    expect(total!.planned).toBe(1000);
    // actual = current window's spend (plan-cur, 250).
    expect(total!.actual).toBe(250);
  });
});
