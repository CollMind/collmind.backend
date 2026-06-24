import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettlementSummaryService } from './settlement-summary.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import {
  Agreement,
  AgreementStatus,
  SpendType,
} from '../../../../database/entities/agreement.entity';
import { UserScope } from '../../../../database/entities/user-scope.entity';
import { UserRole } from '../../../../database/entities/user.entity';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const AGR_ID_1 = 'agr-001';
const AGR_ID_2 = 'agr-002';
const CPL_ID_1 = 'cpl-001';
const CPL_ID_2 = 'cpl-002';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAgreement(
  id: string,
  overrides: Record<string, any> = {},
): Partial<Agreement> {
  return {
    id,
    agreementCode: `STA-2026-${id}`,
    agreementName: `Agreement ${id}`,
    tenantId: TENANT_ID,
    cplId: CPL_ID_1,
    status: AgreementStatus.APPROVED,
    spendType: SpendType.OFF_INVOICE,
    capTotalAmount: 50000,
    periodMonth: '2026-06',
    closedAt: undefined,
    closedBy: undefined,
    ...overrides,
  };
}

function buildUserScope(cplId: string): Partial<UserScope> {
  return {
    userId: USER_ID,
    cplId,
    isActive: true,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function buildAgreementRepoMock(agreements: Partial<Agreement>[]) {
  // getMany'i zincirleme builder ile simüle et
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(agreements),
  };

  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    _qb: qb, // testlerde erişim için
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettlementSummaryService', () => {
  let service: SettlementSummaryService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAgreementRepo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUserScopeRepo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLedgerRepo: any;

  async function buildModule(
    agreements: Partial<Agreement>[],
    userScopes: Partial<UserScope>[],
    ledgerSums: Map<string, number>,
  ) {
    mockAgreementRepo = buildAgreementRepoMock(agreements);
    mockUserScopeRepo = {
      find: jest.fn().mockResolvedValue(userScopes),
    };
    mockLedgerRepo = {
      sumByAgreementId: jest
        .fn()
        .mockImplementation((agreementId: string) =>
          Promise.resolve(ledgerSums.get(agreementId) ?? 0),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementSummaryService,
        {
          provide: getRepositoryToken(Agreement),
          useValue: mockAgreementRepo,
        },
        {
          provide: getRepositoryToken(UserScope),
          useValue: mockUserScopeRepo,
        },
        { provide: LedgerRepository, useValue: mockLedgerRepo },
      ],
    }).compile();

    return module.get<SettlementSummaryService>(SettlementSummaryService);
  }

  // -------------------------------------------------------------------------
  // Planner scope: boş scope → boş summary
  // -------------------------------------------------------------------------

  describe('Planner scope: empty CPL scope → empty summary', () => {
    it('returns zero counts and empty lines when Planner has no assigned CPLs', async () => {
      service = await buildModule([], [], new Map());
      // Planner with no active scopes
      mockUserScopeRepo.find = jest.fn().mockResolvedValue([]);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.PLANNER,
        {},
      );

      expect(result.totalCount).toBe(0);
      expect(result.lines).toHaveLength(0);
      expect(result.totalClaimAmount).toBe(0);
      expect(result.totalInvoicedAmount).toBe(0);
      expect(result.totalRemainingAmount).toBeNull();
    });

    it('does NOT call agreementRepo when Planner scope is empty (short-circuit)', async () => {
      service = await buildModule([], [], new Map());
      mockUserScopeRepo.find = jest.fn().mockResolvedValue([]);

      await service.getSummary(TENANT_ID, USER_ID, UserRole.PLANNER, {});

      // Agreement repo should not be queried at all
      expect(mockAgreementRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Direction-aware invoiced amount: reversals düşer
  // -------------------------------------------------------------------------

  describe('direction-aware invoiced amount: reversals auto-deducted', () => {
    it('uses ledger sumByAgreementId (DEBIT − CREDIT) not raw transaction sum', async () => {
      const agr = buildAgreement(AGR_ID_1, { capTotalAmount: 100000 });
      // Net after reversal: 60000 (DEBIT=80000 − CREDIT=20000)
      const ledgerSums = new Map([[AGR_ID_1, 60000]]);

      service = await buildModule([agr], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.lines[0].invoicedAmount).toBe(60000);
      expect(result.lines[0].claimAmount).toBe(100000);
      expect(result.lines[0].remainingAmount).toBe(40000);
    });

    it('invoiced decreases correctly after reversal (net = DEBIT - CREDIT)', async () => {
      // Scenario: originally 50000 debited, then 15000 reversed → net = 35000
      const agr = buildAgreement(AGR_ID_1, { capTotalAmount: 50000 });
      const ledgerSums = new Map([[AGR_ID_1, 35000]]);

      service = await buildModule([agr], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.lines[0].invoicedAmount).toBe(35000);
      expect(result.lines[0].remainingAmount).toBe(15000);
      expect(mockLedgerRepo.sumByAgreementId).toHaveBeenCalledWith(
        AGR_ID_1,
        TENANT_ID,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Division-by-zero → null (BRD kuralı)
  // -------------------------------------------------------------------------

  describe('division-by-zero guard: capTotalAmount === 0 → remainingAmount null', () => {
    it('returns null remainingAmount when claimAmount is 0', async () => {
      const agr = buildAgreement(AGR_ID_1, { capTotalAmount: 0 });
      const ledgerSums = new Map([[AGR_ID_1, 0]]);

      service = await buildModule([agr], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.lines[0].remainingAmount).toBeNull();
    });

    it('returns null totalRemainingAmount when totalClaimAmount is 0', async () => {
      service = await buildModule([], [], new Map());

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.totalRemainingAmount).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Count logic
  // -------------------------------------------------------------------------

  describe('count aggregation', () => {
    it('counts CLOSED as closedCount', async () => {
      const agr1 = buildAgreement(AGR_ID_1, { status: AgreementStatus.CLOSED });
      const agr2 = buildAgreement(AGR_ID_2, {
        status: AgreementStatus.APPROVED,
      });
      const ledgerSums = new Map([
        [AGR_ID_1, 0],
        [AGR_ID_2, 0],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.closedCount).toBe(1);
    });

    it('counts APPROVED and ACTIVE as pendingCount', async () => {
      const agr1 = buildAgreement(AGR_ID_1, {
        status: AgreementStatus.APPROVED,
      });
      const agr2 = buildAgreement(AGR_ID_2, { status: AgreementStatus.ACTIVE });
      const ledgerSums = new Map([
        [AGR_ID_1, 0],
        [AGR_ID_2, 0],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.pendingCount).toBe(2);
    });

    it('counts ACTIVE and CLOSED as settledCount', async () => {
      const agr1 = buildAgreement(AGR_ID_1, { status: AgreementStatus.ACTIVE });
      const agr2 = buildAgreement(AGR_ID_2, { status: AgreementStatus.CLOSED });
      const ledgerSums = new Map([
        [AGR_ID_1, 0],
        [AGR_ID_2, 0],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.settledCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Planner scope: CPL-scoped filter
  // -------------------------------------------------------------------------

  describe('Planner scope: filters by assigned CPLs', () => {
    it('non-Planner (ADMIN) does not apply CPL scope restriction', async () => {
      const agr1 = buildAgreement(AGR_ID_1, { cplId: CPL_ID_1 });
      const agr2 = buildAgreement(AGR_ID_2, { cplId: CPL_ID_2 });
      const ledgerSums = new Map([
        [AGR_ID_1, 0],
        [AGR_ID_2, 0],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      await service.getSummary(TENANT_ID, USER_ID, UserRole.ADMIN, {});

      // UserScope should NOT be queried for ADMIN
      expect(mockUserScopeRepo.find).not.toHaveBeenCalled();
    });

    it('Planner queries userScopeRepo to get allowed CPLs', async () => {
      const scopes = [buildUserScope(CPL_ID_1)];
      const agr = buildAgreement(AGR_ID_1, { cplId: CPL_ID_1 });
      const ledgerSums = new Map([[AGR_ID_1, 0]]);

      service = await buildModule([agr], scopes, ledgerSums);
      mockUserScopeRepo.find = jest.fn().mockResolvedValue(scopes);

      await service.getSummary(TENANT_ID, USER_ID, UserRole.PLANNER, {});

      // tenantId ZORUNLU — cross-tenant CPL sızıntısını önler (B-1)
      expect(mockUserScopeRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID, tenantId: TENANT_ID, isActive: true },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Tenant isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    // B-1: cross-tenant CPL sızıntısı testi
    // userScopeRepo.find her zaman tenantId ile çağrılmalı;
    // aksi hâlde farklı tenant'a ait UserScope satırları Planner'a görünür.
    it('Planner CPL scope query includes tenantId to prevent cross-tenant leakage (B-1)', async () => {
      const OTHER_TENANT_ID = 'tenant-OTHER';
      const scopes = [buildUserScope(CPL_ID_1)];
      const agr = buildAgreement(AGR_ID_1, { cplId: CPL_ID_1 });
      const ledgerSums = new Map([[AGR_ID_1, 0]]);

      service = await buildModule([agr], scopes, ledgerSums);
      mockUserScopeRepo.find = jest.fn().mockResolvedValue(scopes);

      // Caller tenant = TENANT_ID; başka bir tenant'ın (OTHER_TENANT_ID) scope'u sızmamalı
      await service.getSummary(TENANT_ID, USER_ID, UserRole.PLANNER, {});

      const callArgs = mockUserScopeRepo.find.mock.calls[0][0];
      // tenantId TENANT_ID olmalı — OTHER_TENANT_ID ASLA eşleşmemeli
      expect(callArgs.where).toMatchObject({
        userId: USER_ID,
        tenantId: TENANT_ID,
        isActive: true,
      });
      expect(callArgs.where.tenantId).not.toBe(OTHER_TENANT_ID);
    });

    it('all ledger queries use the caller tenantId', async () => {
      const agr = buildAgreement(AGR_ID_1);
      const ledgerSums = new Map([[AGR_ID_1, 25000]]);

      service = await buildModule([agr], [], ledgerSums);

      await service.getSummary(TENANT_ID, USER_ID, UserRole.ADMIN, {});

      expect(mockLedgerRepo.sumByAgreementId).toHaveBeenCalledWith(
        AGR_ID_1,
        TENANT_ID,
      );
    });

    it('ledger is called once per agreement — no cross-agreement aggregation', async () => {
      const agr1 = buildAgreement(AGR_ID_1);
      const agr2 = buildAgreement(AGR_ID_2);
      const ledgerSums = new Map([
        [AGR_ID_1, 10000],
        [AGR_ID_2, 20000],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      await service.getSummary(TENANT_ID, USER_ID, UserRole.ADMIN, {});

      expect(mockLedgerRepo.sumByAgreementId).toHaveBeenCalledTimes(2);
      expect(mockLedgerRepo.sumByAgreementId).toHaveBeenCalledWith(
        AGR_ID_1,
        TENANT_ID,
      );
      expect(mockLedgerRepo.sumByAgreementId).toHaveBeenCalledWith(
        AGR_ID_2,
        TENANT_ID,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Multi-agreement totals aggregation
  // -------------------------------------------------------------------------

  describe('multi-agreement totals', () => {
    it('totalClaimAmount sums all agreements capTotalAmount', async () => {
      const agr1 = buildAgreement(AGR_ID_1, { capTotalAmount: 30000 });
      const agr2 = buildAgreement(AGR_ID_2, {
        capTotalAmount: 70000,
        status: AgreementStatus.ACTIVE,
      });
      const ledgerSums = new Map([
        [AGR_ID_1, 10000],
        [AGR_ID_2, 20000],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.totalClaimAmount).toBe(100000);
      expect(result.totalInvoicedAmount).toBe(30000);
      expect(result.totalRemainingAmount).toBe(70000);
      expect(result.totalCount).toBe(2);
    });

    it('totalRemainingAmount is null when totalClaimAmount is 0 (BRD division-by-zero guard)', async () => {
      const agr1 = buildAgreement(AGR_ID_1, { capTotalAmount: 0 });
      const agr2 = buildAgreement(AGR_ID_2, {
        capTotalAmount: 0,
        status: AgreementStatus.ACTIVE,
      });
      const ledgerSums = new Map([
        [AGR_ID_1, 0],
        [AGR_ID_2, 0],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.totalRemainingAmount).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Over-invoiced edge case: invoicedAmount > claimAmount → negative remaining
  // BRD: negatif ROI geçerlidir; remaining de negatif olabilir (capped değil)
  // -------------------------------------------------------------------------

  describe('over-invoiced edge case: invoicedAmount > claimAmount', () => {
    it('returns negative remainingAmount when invoiced exceeds claim (no floor/cap)', async () => {
      // Supplier invoiced more than the agreement cap — remaining goes negative
      const agr = buildAgreement(AGR_ID_1, { capTotalAmount: 50000 });
      const ledgerSums = new Map([[AGR_ID_1, 60000]]); // 10000 over-invoiced

      service = await buildModule([agr], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.lines[0].invoicedAmount).toBe(60000);
      expect(result.lines[0].claimAmount).toBe(50000);
      expect(result.lines[0].remainingAmount).toBe(-10000); // negative, not null
    });

    it('totalRemainingAmount is negative when over-invoiced across agreements', async () => {
      const agr1 = buildAgreement(AGR_ID_1, { capTotalAmount: 40000 });
      const agr2 = buildAgreement(AGR_ID_2, {
        capTotalAmount: 20000,
        status: AgreementStatus.ACTIVE,
      });
      const ledgerSums = new Map([
        [AGR_ID_1, 45000], // over by 5000
        [AGR_ID_2, 18000], // under by 2000
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.totalClaimAmount).toBe(60000);
      expect(result.totalInvoicedAmount).toBe(63000);
      expect(result.totalRemainingAmount).toBe(-3000);
    });
  });

  // -------------------------------------------------------------------------
  // settledCount = ON_INVOICE + CLOSED (BRD: kısmen veya tam tamamlanmış)
  // BRD görev tanımı: settledCount = ACTIVE || CLOSED
  // -------------------------------------------------------------------------

  describe('settledCount BRD definition: ACTIVE || CLOSED only', () => {
    it('APPROVED agreement is NOT counted in settledCount', async () => {
      const agr = buildAgreement(AGR_ID_1, {
        status: AgreementStatus.APPROVED,
      });
      const ledgerSums = new Map([[AGR_ID_1, 0]]);

      service = await buildModule([agr], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.settledCount).toBe(0);
      expect(result.pendingCount).toBe(1);
    });

    it('mixed statuses: settledCount excludes APPROVED', async () => {
      const agr1 = buildAgreement(AGR_ID_1, {
        status: AgreementStatus.APPROVED,
      });
      const agr2 = buildAgreement(AGR_ID_2, { status: AgreementStatus.ACTIVE });
      const ledgerSums = new Map([
        [AGR_ID_1, 0],
        [AGR_ID_2, 0],
      ]);

      service = await buildModule([agr1, agr2], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.settledCount).toBe(1); // only ACTIVE
      expect(result.pendingCount).toBe(2); // APPROVED + ACTIVE
      expect(result.closedCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // RBAC: non-Planner roles must NOT query UserScope
  // -------------------------------------------------------------------------

  describe('RBAC: non-Planner roles skip UserScope query', () => {
    const nonPlannerRoles = [
      UserRole.ADMIN,
      UserRole.CATEGORY_MANAGER,
      UserRole.FINANCE_MANAGER,
      UserRole.FINANCE,
      UserRole.READONLY,
    ] as const;

    for (const role of nonPlannerRoles) {
      it(`${role} does not call userScopeRepo.find`, async () => {
        const agr = buildAgreement(AGR_ID_1);
        const ledgerSums = new Map([[AGR_ID_1, 0]]);

        service = await buildModule([agr], [], ledgerSums);

        await service.getSummary(TENANT_ID, USER_ID, role, {});

        expect(mockUserScopeRepo.find).not.toHaveBeenCalled();
      });
    }
  });

  // -------------------------------------------------------------------------
  // closedAt/closedBy propagation
  // -------------------------------------------------------------------------

  describe('closed metadata propagated to lines', () => {
    it('CLOSED agreement line includes closedAt and closedBy from entity', async () => {
      const closedAt = new Date('2026-06-20T10:00:00Z');
      const closedBy = 'user-admin-001';
      const agr = buildAgreement(AGR_ID_1, {
        status: AgreementStatus.CLOSED,
        closedAt,
        closedBy,
      });
      const ledgerSums = new Map([[AGR_ID_1, 50000]]);

      service = await buildModule([agr], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.lines[0].closedAt).toEqual(closedAt);
      expect(result.lines[0].closedBy).toBe(closedBy);
    });

    it('APPROVED agreement line has undefined closedAt and closedBy', async () => {
      const agr = buildAgreement(AGR_ID_1, {
        status: AgreementStatus.APPROVED,
        closedAt: undefined,
        closedBy: undefined,
      });
      const ledgerSums = new Map([[AGR_ID_1, 0]]);

      service = await buildModule([agr], [], ledgerSums);

      const result = await service.getSummary(
        TENANT_ID,
        USER_ID,
        UserRole.ADMIN,
        {},
      );

      expect(result.lines[0].closedAt).toBeUndefined();
      expect(result.lines[0].closedBy).toBeUndefined();
    });
  });
});
