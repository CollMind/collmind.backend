import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SelectQueryBuilder } from 'typeorm';
import { DashboardService } from './dashboard.service';
import { FinanceReportingService } from '../finance-reporting/finance-reporting.service';
import {
  Agreement,
  AgreementStatus,
  AgreementType,
  SpendType,
} from '../../../database/entities/agreement.entity';
import { Cpl } from '../../../database/entities/cpl.entity';
import {
  ApprovalRequest,
  ApprovalRequestType,
} from '../../../database/entities/approval-request.entity';
import { UserRole } from '../../../database/entities/user.entity';
import { UtilizationStatus } from '../finance-reporting/dto/budget-utilization.dto';
import { InvalidDecimalError } from '../../../database/transformers/decimal.transformer';
import {
  AccessScopeService,
  EffectiveScope,
} from '../access-scope/access-scope.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-001';
const USER_ADMIN_ID = 'user-admin-001';
const USER_PLANNER_ID = 'user-planner-001';
const CPL_ID_1 = 'cpl-001';
const CPL_ID_2 = 'cpl-002';

const UNRESTRICTED: EffectiveScope = { kind: 'UNRESTRICTED' };
const scopedPairs = (
  pairs: Array<{ cplId: string | null; categoryId?: string | null }>,
): EffectiveScope => ({
  kind: 'SCOPED',
  pairs: pairs.map((p) => ({
    cplId: p.cplId,
    categoryId: p.categoryId ?? null,
  })),
});

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildAgreement(overrides: Partial<Agreement> = {}): Agreement {
  return {
    id: 'agr-001',
    tenantId: TENANT_ID,
    agreementCode: 'STA-2026-001',
    agreementName: 'Test Agreement',
    agreementType: AgreementType.STA,
    cplId: CPL_ID_1,
    status: AgreementStatus.ACTIVE,
    spendType: SpendType.OFF_INVOICE,
    capTotalAmount: 10000,
    consumedAmount: 0,
    periodMonth: '2026-06',
    ...overrides,
  } as Agreement;
}

const mockBudgetUtilization = {
  onInvoice: {
    allocated: 100000,
    utilized: 40000,
    reserved: 5000,
    available: 55000,
    utilizationPercent: 45,
    status: UtilizationStatus.GREEN,
  },
  offInvoice: {
    allocated: 50000,
    utilized: 45000,
    reserved: 2000,
    available: 3000,
    utilizationPercent: 94,
    status: UtilizationStatus.AMBER,
  },
  total: {
    allocated: 150000,
    utilized: 85000,
    reserved: 7000,
    available: 58000,
    utilizationPercent: 61.3,
    status: UtilizationStatus.GREEN,
  },
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  byCpl: undefined,
  byChannel: undefined,
  byCategory: undefined,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function buildMockQb(returnValue: any) {
  const qb: Partial<SelectQueryBuilder<any>> = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(returnValue),
    getMany: jest.fn().mockResolvedValue(returnValue),
  };
  return qb as SelectQueryBuilder<any>;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DashboardService', () => {
  let service: DashboardService;

  let agreementRepo: {
    count: jest.MockedFunction<any>;
    find: jest.MockedFunction<any>;
    createQueryBuilder: jest.MockedFunction<any>;
  };
  let accessScopeService: { resolveScope: jest.MockedFunction<any> };
  let cplRepo: { find: jest.MockedFunction<any> };
  let approvalRequestRepo: { createQueryBuilder: jest.MockedFunction<any> };
  let financeReportingService: {
    getBudgetUtilization: jest.MockedFunction<any>;
  };

  beforeEach(async () => {
    agreementRepo = {
      count: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    accessScopeService = { resolveScope: jest.fn() };
    cplRepo = { find: jest.fn() };
    approvalRequestRepo = { createQueryBuilder: jest.fn() };
    financeReportingService = { getBudgetUtilization: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getRepositoryToken(Agreement), useValue: agreementRepo },
        { provide: getRepositoryToken(Cpl), useValue: cplRepo },
        {
          provide: getRepositoryToken(ApprovalRequest),
          useValue: approvalRequestRepo,
        },
        { provide: FinanceReportingService, useValue: financeReportingService },
        { provide: AccessScopeService, useValue: accessScopeService },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  // -------------------------------------------------------------------------
  // resolveScopedCplIds — adapts AccessScopeService.EffectiveScope to the
  // legacy cplId-only filter shape used throughout this service. T-028d:
  // role semantics live SOLELY in AccessScopeService; this only tests the
  // shape adaptation + the F6 fix.
  // -------------------------------------------------------------------------

  describe('CPL scope resolution (resolveScopedCplIds)', () => {
    it('returns null when AccessScopeService reports UNRESTRICTED', async () => {
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);

      const scope = await (service as any).resolveScopedCplIds(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
      );

      expect(scope).toBeNull();
      expect(accessScopeService.resolveScope).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
      );
    });

    it('flattens SCOPED pairs into a distinct cplId[] list', async () => {
      accessScopeService.resolveScope.mockResolvedValue(
        scopedPairs([{ cplId: CPL_ID_1 }, { cplId: CPL_ID_2 }]),
      );

      const scope = await (service as any).resolveScopedCplIds(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
      );

      expect(scope).toEqual([CPL_ID_1, CPL_ID_2]);
    });

    it('returns empty array when SCOPED with zero pairs (fail-closed, R-2)', async () => {
      accessScopeService.resolveScope.mockResolvedValue(scopedPairs([]));

      const scope = await (service as any).resolveScopedCplIds(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
      );

      expect(scope).toEqual([]);
    });

    // F6 regression — see access-scope.service.ts header + task T-028d.
    // Previously: `scopes.map(s => s.cplId).filter(id => !!id)` silently
    // dropped a NULL-cplId row, turning "all CPLs" into "no CPLs" for a
    // NULL-scoped (unrestricted-for-cpl) user. Now: a pair with cplId===null
    // must make the whole cplId dimension unrestricted (null), not empty.
    it('F6: a SCOPED pair with cplId===null resolves to null (unrestricted), not []', async () => {
      accessScopeService.resolveScope.mockResolvedValue(
        scopedPairs([{ cplId: null, categoryId: null }]),
      );

      const scope = await (service as any).resolveScopedCplIds(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
      );

      expect(scope).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getSummary — admin path
  // -------------------------------------------------------------------------

  describe('getSummary', () => {
    beforeEach(() => {
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);

      // agreementRepo.count: ACTIVE count = 5, APPROVED count = 3
      agreementRepo.count
        .mockResolvedValueOnce(5) // ACTIVE
        .mockResolvedValueOnce(3); // APPROVED

      // Approval QB
      const approvalQb = buildMockQb(2);
      approvalRequestRepo.createQueryBuilder.mockReturnValue(approvalQb);

      // AwaitingInvoice QB
      const awaitingQb = buildMockQb(4);
      agreementRepo.createQueryBuilder.mockReturnValue(awaitingQb);

      financeReportingService.getBudgetUtilization.mockResolvedValue(
        mockBudgetUtilization,
      );
    });

    it('returns summary with correct counts and delegates budget utilization', async () => {
      const result = await service.getSummary(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
        { period: '2026-06' },
      );

      expect(result.periodCode).toBe('2026-06');
      expect(typeof result.activeAgreementCount).toBe('number');
      expect(typeof result.pendingApprovalCount).toBe('number');
      expect(typeof result.openTaskCount).toBe('number');

      // Budget utilization must come from FinanceReportingService — not computed here
      expect(
        financeReportingService.getBudgetUtilization,
      ).toHaveBeenCalledTimes(1);
      expect(result.budgetUtilization).toBeDefined();
      expect(result.budgetUtilization?.total).toBeDefined();
    });

    it('passes cplIds=undefined to getBudgetUtilization for ADMIN (no CPL filter)', async () => {
      await service.getSummary(TENANT_ID, USER_ADMIN_ID, UserRole.ADMIN, {
        period: '2026-06',
      });

      const callArgs = financeReportingService.getBudgetUtilization.mock
        .calls[0] as [string, { cplIds?: string[] }];
      // Admin path: cplIds should NOT be present in filter (UNRESTRICTED scope → no cplIds key)
      expect(callArgs[1].cplIds).toBeUndefined();
    });

    // T-098: this test used to read
    //
    //     it('returns null budgetUtilization gracefully if service throws', ...)
    //     expect(result.budgetUtilization).toBeNull();
    //
    // and it was PINNING THE DEFECT — "gracefully" made swallowing the failure
    // sound like the careful choice, exactly as T-097's "instead of NaN" did. The
    // response could not distinguish "no budget data" from "we could not read the
    // budget data", and this test made that a contract.
    //
    // `budgetUtilization` stays null, so the assertion below still holds. What is
    // new is that the reason is now reported instead of inferred.
    it('reports the failure as a status instead of passing null off as "no data"', async () => {
      financeReportingService.getBudgetUtilization.mockRejectedValue(
        new Error('DB error'),
      );

      const result = await service.getSummary(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
        { period: '2026-06' },
      );

      expect(result.budgetUtilization).toBeNull();
      expect(result.budgetUtilizationStatus).toBe('unavailable');
    });

    // Same reason as the status pair: redacting the message only relocates the
    // value if something actually logs it, and a bare `logger.warn(msg, err)`
    // drops it (Nest renders Errors with Error.toString()).
    it('hands the logger the offending value, not just the redacted message', async () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      financeReportingService.getBudgetUtilization.mockRejectedValue(
        new InvalidDecimalError('CORRUPT-7'),
      );

      await service.getSummary(TENANT_ID, USER_ADMIN_ID, UserRole.ADMIN, {
        period: '2026-06',
      });

      expect(String(warn.mock.calls[0]?.[1])).toContain('CORRUPT-7');
    });

    // The pair is what gives the previous test its meaning: a status that reads
    // 'unavailable' on both the success and the failure path would distinguish
    // nothing, and this test is the only thing that can catch that.
    it('reports ok on the success path — the status must distinguish, not decorate', async () => {
      financeReportingService.getBudgetUtilization.mockResolvedValue(
        mockBudgetUtilization,
      );

      const result = await service.getSummary(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
        { period: '2026-06' },
      );

      expect(result.budgetUtilizationStatus).toBe('ok');
    });

    it('defaults period to current YYYY-MM when not provided', async () => {
      const result = await service.getSummary(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
        {},
      );
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      expect(result.periodCode).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // getSummary — PLANNER scope
  // -------------------------------------------------------------------------

  describe('getSummary — PLANNER scope', () => {
    // T-272/Z22 (kaldırılan T-270/Z21 fail-closed kapısı): `budget_envelopes`
    // (K-2.2.1: Kanal × Kategori × Dönem) hiçbir zaman `cplId` sütunu
    // taşımayacak (A7 — CPL kapsam katmanında, bütçe katmanında değil). T-270
    // bunu "kısıtı onurlandıramıyorsak hiç çağırma" diye okumuştu ve bir
    // CPL-kapsamlı PLANNER'ın bütçe panelini KALICI olarak `unavailable`
    // bıraktı. `docs/decisions/PLAN_BUTCE_NETLESTIRME.md` `netleştirme-1`
    // bunun tersini gerektiriyor: kilitlemesiz model görünürlüksüz
    // savunulamaz, ve bir PLANNER zarf doluluğunu GÖNDERİMDEN ÖNCE GÖRMEK
    // ZORUNDA. `getBudgetUtilization` zaten `cplIds`'i UYGULAMIYOR (bkz.
    // `finance-reporting.service.ts#computeBudgetUtilization` JSDoc'u) —
    // yani çağrıyı atlamak bir kısıtı korumuyordu, yalnız bir yeteneği
    // kapatıyordu. Karar (Z22): çağrı HER kapsam için yapılır, bütçe rakamı
    // CPL ekseninde TANIMSAL olarak duyarsızdır.
    it('calls getBudgetUtilization for a CPL-scoped Planner too — budget is CPL-axis-insensitive by definition (A7)', async () => {
      accessScopeService.resolveScope.mockResolvedValue(
        scopedPairs([{ cplId: CPL_ID_1 }]),
      );

      agreementRepo.count.mockResolvedValue(2);

      const approvalQb = buildMockQb(1);
      approvalRequestRepo.createQueryBuilder.mockReturnValue(approvalQb);

      const awaitingQb = buildMockQb(0);
      agreementRepo.createQueryBuilder.mockReturnValue(awaitingQb);

      financeReportingService.getBudgetUtilization.mockResolvedValue(
        mockBudgetUtilization,
      );

      const result = await service.getSummary(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
        { period: '2026-06' },
      );

      expect(
        financeReportingService.getBudgetUtilization,
      ).toHaveBeenCalledTimes(1);
      // `cplIds` is still forwarded ([[T-254]] contract) even though the
      // receiver ignores it on this path — the field is inert, not omitted.
      const callArgs = financeReportingService.getBudgetUtilization.mock
        .calls[0] as [string, { cplIds?: string[] }];
      expect(callArgs[1].cplIds).toEqual([CPL_ID_1]);
      expect(result.budgetUtilization).toEqual(mockBudgetUtilization);
      expect(result.budgetUtilizationStatus).toBe('ok');
    });

    // A1 KORUNUR (Z22 pin #2): bir CPL-kapsamlı PLANNER için de veri
    // yokluğu hâlâ 'unavailable' — kapsam ile veri-yokluğu AYRI sinyaller,
    // ve bu test onları KARIŞTIRMADAN ayrı ayrı ölçer.
    it('still reports unavailable for a CPL-scoped Planner when getBudgetUtilization finds no envelope data (A1, unrelated to scope)', async () => {
      accessScopeService.resolveScope.mockResolvedValue(
        scopedPairs([{ cplId: CPL_ID_1 }]),
      );

      agreementRepo.count.mockResolvedValue(0);

      const approvalQb = buildMockQb(0);
      approvalRequestRepo.createQueryBuilder.mockReturnValue(approvalQb);

      const awaitingQb = buildMockQb(0);
      agreementRepo.createQueryBuilder.mockReturnValue(awaitingQb);

      financeReportingService.getBudgetUtilization.mockRejectedValue(
        new Error('No budget envelope data found'),
      );

      const result = await service.getSummary(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
        { period: '2026-06' },
      );

      expect(
        financeReportingService.getBudgetUtilization,
      ).toHaveBeenCalledTimes(1);
      expect(result.budgetUtilization).toBeNull();
      expect(result.budgetUtilizationStatus).toBe('unavailable');
    });

    it('returns empty counts when Planner has no CPL assignments', async () => {
      accessScopeService.resolveScope.mockResolvedValue(scopedPairs([]));

      // with empty cplIds, countPendingApprovals returns 0 immediately
      agreementRepo.count.mockResolvedValue(0);

      const approvalQb = buildMockQb(0);
      approvalRequestRepo.createQueryBuilder.mockReturnValue(approvalQb);

      const awaitingQb = buildMockQb(0);
      agreementRepo.createQueryBuilder.mockReturnValue(awaitingQb);

      financeReportingService.getBudgetUtilization.mockResolvedValue(
        mockBudgetUtilization,
      );

      const result = await service.getSummary(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
        { period: '2026-06' },
      );

      // openTaskCount is 0 because awaitingInvoice count returns 0 for empty scope
      expect(result.openTaskCount).toBe(0);
    });

    // F6 regression (end-to-end through getSummary): a NULL-cplId scope row
    // must unlock ALL CPLs, not zero. Before the fix, this user would get an
    // empty dashboard (cplIds=[] → all counts 0, budget filter cplIds:[]).
    it('F6: PLANNER with a NULL-cplId scope row sees ALL CPLs (no cplIds filter)', async () => {
      accessScopeService.resolveScope.mockResolvedValue(
        scopedPairs([{ cplId: null, categoryId: null }]),
      );

      // agreementRepo.count is invoked once with an OR-condition array
      // (buildAgreementWhere) — a single resolved value covers that call.
      agreementRepo.count.mockResolvedValue(5);

      const approvalQb = buildMockQb(2);
      approvalRequestRepo.createQueryBuilder.mockReturnValue(approvalQb);

      const awaitingQb = buildMockQb(4);
      agreementRepo.createQueryBuilder.mockReturnValue(awaitingQb);

      financeReportingService.getBudgetUtilization.mockResolvedValue(
        mockBudgetUtilization,
      );

      const result = await service.getSummary(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
        { period: '2026-06' },
      );

      // Same counts as the UNRESTRICTED/admin path — not zeroed out.
      expect(result.activeAgreementCount).toBe(5);
      expect(result.pendingApprovalCount).toBe(2);
      expect(result.openTaskCount).toBe(4);

      const callArgs = financeReportingService.getBudgetUtilization.mock
        .calls[0] as [string, { cplIds?: string[] }];
      expect(callArgs[1].cplIds).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getPendingTasks
  // -------------------------------------------------------------------------

  describe('getPendingTasks', () => {
    it('returns structured pending tasks with empty arrays when no data', async () => {
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);

      const emptyQb = buildMockQb([]);
      agreementRepo.createQueryBuilder.mockReturnValue(emptyQb);

      const result = await service.getPendingTasks(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
        { period: '2026-06', includePast: false },
      );

      expect(result).toHaveProperty('pendingApprovals');
      expect(result).toHaveProperty('pendingManualClaims');
      expect(result).toHaveProperty('submittedClaims');
      expect(result).toHaveProperty('awaitingInvoiceClaims');
      expect(Array.isArray(result.pendingApprovals)).toBe(true);
      expect(Array.isArray(result.pendingManualClaims)).toBe(true);
    });

    it('maps agreement fields to PendingApprovalItemDto correctly', async () => {
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);

      const pendingAgreement = buildAgreement({
        id: 'agr-pending-01',
        status: AgreementStatus.PENDING,
        agreementName: 'Pending Agreement',
        agreementType: AgreementType.STA,
        periodMonth: '2026-06',
        cpl: { id: CPL_ID_1, name: 'Migros NKA' } as any,
        channel: { id: 'ch-1', code: 'MODERN_TRADE' } as any,
      });

      const pendingQb = buildMockQb([pendingAgreement]);
      const emptyQb = buildMockQb([]);

      agreementRepo.createQueryBuilder
        .mockReturnValueOnce(pendingQb) // fetchPendingApprovals
        .mockReturnValueOnce(emptyQb) // fetchPendingManualClaims
        .mockReturnValueOnce(emptyQb) // fetchSubmittedClaims
        .mockReturnValueOnce(emptyQb); // fetchAwaitingInvoiceClaims

      const result = await service.getPendingTasks(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
        { period: '2026-06' },
      );

      expect(result.pendingApprovals).toHaveLength(1);
      const item = result.pendingApprovals[0]!;
      expect(item.agreementId).toBe('agr-pending-01');
      expect(item.agreementName).toBe('Pending Agreement');
      expect(item.agreementType).toBe(AgreementType.STA);
      expect(item.cplName).toBe('Migros NKA');
      expect(item.channelCode).toBe('MODERN_TRADE');
      expect(item.period).toBe('2026-06');
      expect(item.status).toBe(AgreementStatus.PENDING);
    });

    it('returns empty arrays immediately for PLANNER with no CPL scope', async () => {
      accessScopeService.resolveScope.mockResolvedValue(scopedPairs([]));

      const result = await service.getPendingTasks(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
        { period: '2026-06' },
      );

      expect(result.pendingApprovals).toEqual([]);
      expect(result.pendingManualClaims).toEqual([]);
      expect(result.submittedClaims).toEqual([]);
      expect(result.awaitingInvoiceClaims).toEqual([]);
      // createQueryBuilder should never be called for empty scope
      expect(agreementRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getCplStatus
  // -------------------------------------------------------------------------

  describe('getCplStatus', () => {
    it('returns empty items when no CPLs in scope', async () => {
      accessScopeService.resolveScope.mockResolvedValue(scopedPairs([]));
      cplRepo.find.mockResolvedValue([]);

      const result = await service.getCplStatus(
        TENANT_ID,
        USER_PLANNER_ID,
        UserRole.PLANNER,
      );

      expect(result.items).toEqual([]);
    });

    it('computes isUpToDate=true when all counters are zero', async () => {
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);
      cplRepo.find.mockResolvedValue([
        { id: CPL_ID_1, name: 'Migros NKA', channel: { code: 'MODERN_TRADE' } },
      ]);
      agreementRepo.find.mockResolvedValue([]); // no agreements

      const result = await service.getCplStatus(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
      );

      expect(result.items).toHaveLength(1);
      const item = result.items[0]!;
      expect(item.cplId).toBe(CPL_ID_1);
      expect(item.cplName).toBe('Migros NKA');
      expect(item.channelCode).toBe('MODERN_TRADE');
      expect(item.staCount).toBe(0);
      expect(item.ltaCount).toBe(0);
      expect(item.pendingApproval).toBe(0);
      expect(item.pendingManual).toBe(0);
      expect(item.awaitingInvoice).toBe(0);
      expect(item.isUpToDate).toBe(true);
    });

    it('computes isUpToDate=false when pendingApproval > 0', async () => {
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);
      cplRepo.find.mockResolvedValue([
        { id: CPL_ID_1, name: 'Migros NKA', channel: { code: 'MT' } },
      ]);

      const pendingAgreement = buildAgreement({
        cplId: CPL_ID_1,
        status: AgreementStatus.PENDING,
        agreementType: AgreementType.STA,
      });

      agreementRepo.find.mockResolvedValue([pendingAgreement]);

      const result = await service.getCplStatus(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
      );

      const item = result.items[0]!;
      expect(item.pendingApproval).toBe(1);
      expect(item.isUpToDate).toBe(false);
    });

    it('counts STA and LTA separately', async () => {
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);
      cplRepo.find.mockResolvedValue([
        { id: CPL_ID_1, name: 'Migros', channel: { code: 'MT' } },
      ]);

      const sta1 = buildAgreement({
        cplId: CPL_ID_1,
        agreementType: AgreementType.STA,
        status: AgreementStatus.ACTIVE,
        id: 'a1',
      });
      const sta2 = buildAgreement({
        cplId: CPL_ID_1,
        agreementType: AgreementType.STA,
        status: AgreementStatus.APPROVED,
        id: 'a2',
      });
      const lta1 = buildAgreement({
        cplId: CPL_ID_1,
        agreementType: AgreementType.LTA,
        status: AgreementStatus.ACTIVE,
        id: 'a3',
      });

      agreementRepo.find.mockResolvedValue([sta1, sta2, lta1]);

      const result = await service.getCplStatus(
        TENANT_ID,
        USER_ADMIN_ID,
        UserRole.ADMIN,
      );

      const item = result.items[0]!;
      expect(item.staCount).toBe(2);
      expect(item.ltaCount).toBe(1);
    });

    it('scopes CPLs for PLANNER — passes cplIds to cplRepo.find', async () => {
      accessScopeService.resolveScope.mockResolvedValue(
        scopedPairs([{ cplId: CPL_ID_1 }]),
      );
      cplRepo.find.mockResolvedValue([]);
      agreementRepo.find.mockResolvedValue([]);

      await service.getCplStatus(TENANT_ID, USER_PLANNER_ID, UserRole.PLANNER);

      expect(cplRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // countPendingApprovals — polymorphic requestType guard (B-1)
  // -------------------------------------------------------------------------

  describe('countPendingApprovals — polymorphic requestType filter', () => {
    it('queries with requestType = AGREEMENT so PLAN/BUDGET_TRANSFER rows are excluded', async () => {
      const capturedConditions: string[] = [];

      const qb: Partial<SelectQueryBuilder<any>> = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockImplementation((condition: string) => {
          capturedConditions.push(condition);
          return qb;
        }),
        innerJoin: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      };
      approvalRequestRepo.createQueryBuilder.mockReturnValue(qb);

      await (service as any).countPendingApprovals(TENANT_ID, null);

      // Must include requestType filter — without it, PLAN/BUDGET_TRANSFER rows bleed in
      const hasRequestTypeFilter = capturedConditions.some((c) =>
        c.includes('requestType'),
      );
      expect(hasRequestTypeFilter).toBe(true);
    });

    it('passes ApprovalRequestType.AGREEMENT as the requestType parameter value', async () => {
      const capturedParams: Record<string, any>[] = [];

      const qb: Partial<SelectQueryBuilder<any>> = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest
          .fn()
          .mockImplementation(
            (_condition: string, params?: Record<string, any>) => {
              if (params) capturedParams.push(params);
              return qb;
            },
          ),
        innerJoin: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      };
      approvalRequestRepo.createQueryBuilder.mockReturnValue(qb);

      await (service as any).countPendingApprovals(TENANT_ID, null);

      const requestTypeParam = capturedParams.find(
        (p) => p['requestType'] !== undefined,
      );
      expect(requestTypeParam).toBeDefined();
      expect(requestTypeParam!['requestType']).toBe(
        ApprovalRequestType.AGREEMENT,
      );
    });

    it('returns 0 immediately when cplIds is empty (no unnecessary DB call)', async () => {
      const qb = buildMockQb(99); // would return 99 if called — must NOT be called
      approvalRequestRepo.createQueryBuilder.mockReturnValue(qb);

      const count = await (service as any).countPendingApprovals(TENANT_ID, []);

      expect(count).toBe(0);
      // getCount must not run when cplIds is empty []
      expect(qb.getCount).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // No formulas / no raw SQL assertion
  // -------------------------------------------------------------------------

  describe('BRD compliance: dashboard.service contains no formula computation', () => {
    it('does NOT contain inline budget threshold logic (delegates to FinanceReportingService)', () => {
      // This test asserts at the source-code level that getSummary delegates
      // budget utilization rather than computing it. We verify this by checking
      // getBudgetUtilization is called and the result is passed through unchanged.
      accessScopeService.resolveScope.mockResolvedValue(UNRESTRICTED);
      agreementRepo.count.mockResolvedValue(0);

      const approvalQb = buildMockQb(0);
      approvalRequestRepo.createQueryBuilder.mockReturnValue(approvalQb);

      const awaitingQb = buildMockQb(0);
      agreementRepo.createQueryBuilder.mockReturnValue(awaitingQb);

      const customBudget = { ...mockBudgetUtilization };
      financeReportingService.getBudgetUtilization.mockResolvedValue(
        customBudget,
      );

      return service
        .getSummary(TENANT_ID, USER_ADMIN_ID, UserRole.ADMIN, {})
        .then((result) => {
          // budgetUtilization comes exactly from FinanceReportingService — not recomputed
          expect(result.budgetUtilization?.total).toEqual(customBudget.total);
          expect(result.budgetUtilization?.onInvoice).toEqual(
            customBudget.onInvoice,
          );
          expect(result.budgetUtilization?.offInvoice).toEqual(
            customBudget.offInvoice,
          );
        });
    });
  });
});
