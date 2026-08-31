import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FinanceReportingService } from './finance-reporting.service';
import { Plan, PlanFu } from '../../../database/entities/plan.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../../../database/entities/budget-envelope.entity';
import { UserRole } from '../../../database/entities/user.entity';
// T-270/Z21/Z24: `BudgetAllocation`/`BudgetAllocationService` providers REMOVED —
// `FinanceReportingService`'in constructor'ı hiçbirini enjekte etmiyordu (ölçüldü);
// bu iki `providers[]` girdisi gereksizdi.
import { BudgetRepository } from '../budget/budget.repository';
import {
  BudgetThresholdService,
  BudgetThresholds,
} from '../budget/budget-threshold.service';
import { UtilizationStatus } from './dto/budget-utilization.dto';
import { AccessScopeService } from '../access-scope/access-scope.service';
import { KpiEngineService } from '../kpi-engine/kpi-engine.service';
import { BudgetSummaryView } from '../../../database/entities/budget-summary.view-entity';

const TENANT = 'tenant-1';
const USER = 'user-1';

const THRESHOLDS: BudgetThresholds = {
  warning: 80,
  critical: 95,
  exceeded: 100,
};

function buildEnvelope(partial: Partial<BudgetEnvelope>): BudgetEnvelope {
  return {
    id: 'env-1',
    tenantId: TENANT,
    code: 'ENV-2026-NKA-Q1',
    name: 'NKA Q1',
    fiscalYear: '2026',
    period: '2026-01',
    allocatedAmount: 100000,
    consumedAmount: 0,
    availableAmount: 100000,
    status: BudgetEnvelopeStatus.ACTIVE,
    channel: 'NKA',
    category: 'HAIR_CARE',
    currency: 'TRY',
    ...partial,
  } as BudgetEnvelope;
}

function buildSummary(partial: Partial<BudgetSummaryView>): BudgetSummaryView {
  return {
    envelopeId: 'env-1',
    tenantId: TENANT,
    code: 'ENV-2026-NKA-Q1',
    name: 'NKA Q1',
    fiscalYear: '2026',
    period: '2026-01',
    allocatedAmount: 100000,
    currency: 'TRY',
    status: 'ACTIVE',
    reservedAmount: 0,
    consumedAmount: 0,
    availableAmount: 100000,
    utilizationPct: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as BudgetSummaryView;
}

describe('FinanceReportingService — getBudgetVarianceReport (T-023)', () => {
  let service: FinanceReportingService;
  let envelopeRepo: { createQueryBuilder: jest.Mock };
  let qb: any;
  let budgetRepository: { getAllBudgetSummaries: jest.Mock };
  let budgetThresholdService: {
    getThresholds: jest.Mock;
    toStatus: jest.Mock;
  };
  let accessScopeService: {
    resolveScope: jest.Mock;
    applyToQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    envelopeRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    budgetRepository = { getAllBudgetSummaries: jest.fn() };
    budgetThresholdService = {
      getThresholds: jest.fn().mockResolvedValue(THRESHOLDS),
      toStatus: jest.fn((percent: number, t: BudgetThresholds) => {
        if (percent >= t.critical) return UtilizationStatus.RED;
        if (percent >= t.warning) return UtilizationStatus.AMBER;
        return UtilizationStatus.GREEN;
      }),
    };
    accessScopeService = {
      resolveScope: jest.fn().mockResolvedValue({ kind: 'UNRESTRICTED' }),
      applyToQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceReportingService,
        { provide: getRepositoryToken(Plan), useValue: {} },
        { provide: getRepositoryToken(PlanFu), useValue: {} },
        { provide: getRepositoryToken(PlanMechanicValue), useValue: {} },
        { provide: getRepositoryToken(MechanicSpendBreakdown), useValue: {} },
        { provide: getRepositoryToken(BudgetEnvelope), useValue: envelopeRepo },
        { provide: BudgetThresholdService, useValue: budgetThresholdService },
        { provide: BudgetRepository, useValue: budgetRepository },
        { provide: AccessScopeService, useValue: accessScopeService },
        {
          // `T-343`/`Z71 §1`: Target-ROI hedefi konfigürasyondan.
          // Mock `null` döner ⇒ below-target yolu hiçbir planı işaretlemez.
          provide: KpiEngineService,
          useValue: { getKpiConfig: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(FinanceReportingService);
  });

  it('resolves scope via AccessScopeService and applies it to the envelope query', async () => {
    qb.getMany.mockResolvedValue([]);

    await service.getBudgetVarianceReport(
      TENANT,
      USER,
      UserRole.CATEGORY_MANAGER,
      {},
    );

    expect(accessScopeService.resolveScope).toHaveBeenCalledWith(
      TENANT,
      USER,
      UserRole.CATEGORY_MANAGER,
    );
    expect(accessScopeService.applyToQueryBuilder).toHaveBeenCalledWith(
      qb,
      'envelope',
      { kind: 'UNRESTRICTED' },
    );
  });

  it('returns an empty report (no DB reads beyond the envelope query) when no envelopes match', async () => {
    qb.getMany.mockResolvedValue([]);

    const report = await service.getBudgetVarianceReport(
      TENANT,
      USER,
      UserRole.ADMIN,
      {},
    );

    expect(report.items).toEqual([]);
    expect(report.total.allocated).toBe(0);
    expect(report.total.variancePercent).toBeNull();
    expect(budgetRepository.getAllBudgetSummaries).not.toHaveBeenCalled();
  });

  it('computes variance from CONSUMED (not reserved), keeps reserved as separate info-only field', async () => {
    const envelope = buildEnvelope({ id: 'env-1', allocatedAmount: 100000 });
    qb.getMany.mockResolvedValue([envelope]);
    budgetRepository.getAllBudgetSummaries.mockResolvedValue([
      buildSummary({
        envelopeId: 'env-1',
        allocatedAmount: 100000,
        reservedAmount: 40000, // encumbered — NOT part of the variance calc
        consumedAmount: 30000, // GERÇEKLEŞEN — variance source
        availableAmount: 30000,
      }),
    ]);

    const report = await service.getBudgetVarianceReport(
      TENANT,
      USER,
      UserRole.ADMIN,
      {},
    );

    expect(report.items).toHaveLength(1);
    const item = report.items[0];
    expect(item.reserved).toBe(40000);
    expect(item.consumed).toBe(30000);
    // variance = consumed - allocated = 30000 - 100000 = -70000 (under budget on actuals)
    expect(item.variance).toBe(-70000);
    expect(item.variancePercent).toBeCloseTo(-70, 5);
    // utilization (threshold basis) = (reserved+consumed)/allocated*100 = 70%
    expect(item.utilizationPercent).toBeCloseTo(70, 5);
    expect(item.status).toBe(UtilizationStatus.GREEN);
  });

  it('allocated=0 → variancePercent/utilizationPercent/status are null (never Infinity/NaN/0)', async () => {
    const envelope = buildEnvelope({ id: 'env-zero', allocatedAmount: 0 });
    qb.getMany.mockResolvedValue([envelope]);
    budgetRepository.getAllBudgetSummaries.mockResolvedValue([
      buildSummary({
        envelopeId: 'env-zero',
        allocatedAmount: 0,
        reservedAmount: 0,
        consumedAmount: 5000, // spend against a zero-allocation envelope
        availableAmount: -5000,
      }),
    ]);

    const report = await service.getBudgetVarianceReport(
      TENANT,
      USER,
      UserRole.ADMIN,
      {},
    );

    const item = report.items[0];
    expect(item.variancePercent).toBeNull();
    expect(item.utilizationPercent).toBeNull();
    expect(item.status).toBeNull();
    expect(Number.isFinite(item.variancePercent as any)).toBe(false);
  });

  it('groups by channel/category/period and each group variance derives from summed consumed vs summed allocated', async () => {
    const envelopes = [
      buildEnvelope({
        id: 'e1',
        channel: 'NKA',
        category: 'HAIR_CARE',
        fiscalYear: '2026',
        period: '2026-01',
        allocatedAmount: 100000,
      }),
      buildEnvelope({
        id: 'e2',
        channel: 'ECOM',
        category: 'HAIR_CARE',
        fiscalYear: '2026',
        period: '2026-01',
        allocatedAmount: 50000,
      }),
    ];
    qb.getMany.mockResolvedValue(envelopes);
    budgetRepository.getAllBudgetSummaries.mockResolvedValue([
      buildSummary({
        envelopeId: 'e1',
        allocatedAmount: 100000,
        reservedAmount: 10000,
        consumedAmount: 20000,
        availableAmount: 70000,
      }),
      buildSummary({
        envelopeId: 'e2',
        allocatedAmount: 50000,
        reservedAmount: 5000,
        consumedAmount: 10000,
        availableAmount: 35000,
      }),
    ]);

    const report = await service.getBudgetVarianceReport(
      TENANT,
      USER,
      UserRole.ADMIN,
      {},
    );

    expect(report.byChannel).toHaveLength(2);
    const category = report.byCategory.find((g) => g.key === 'HAIR_CARE')!;
    expect(category.envelopeCount).toBe(2);
    expect(category.allocated).toBe(150000);
    expect(category.consumed).toBe(30000);
    expect(category.variance).toBe(30000 - 150000);

    const period = report.byPeriod.find((g) => g.key === '2026/2026-01')!;
    expect(period.allocated).toBe(150000);

    expect(report.total.allocated).toBe(150000);
    expect(report.total.consumed).toBe(30000);
    expect(report.total.reserved).toBe(15000);
  });

  it('skips envelopes with no matching v_budget_summary row (no-recompute — never re-derives amounts from raw rows)', async () => {
    const envelope = buildEnvelope({ id: 'orphan-env' });
    qb.getMany.mockResolvedValue([envelope]);
    budgetRepository.getAllBudgetSummaries.mockResolvedValue([]); // no summary row

    const report = await service.getBudgetVarianceReport(
      TENANT,
      USER,
      UserRole.ADMIN,
      {},
    );

    expect(report.items).toEqual([]);
    expect(report.total.allocated).toBe(0);
  });
});
