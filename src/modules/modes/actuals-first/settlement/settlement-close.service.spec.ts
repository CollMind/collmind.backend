import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SettlementCloseService } from './settlement-close.service';
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
import { BudgetReservationService } from '../../../shared/budget/budget-reservation.service';
import {
  Agreement,
  AgreementStatus,
} from '../../../../database/entities/agreement.entity';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const USER_EMAIL = 'admin@test.com';
const AGREEMENT_ID = 'agr-001';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAgreement(overrides: Record<string, any> = {}) {
  return {
    id: AGREEMENT_ID,
    tenantId: TENANT_ID,
    status: AgreementStatus.APPROVED,
    agreementCode: 'STA-2026-001',
    capTotalAmount: 50000,
    ...overrides,
  } as Agreement;
}

// ---------------------------------------------------------------------------
// Mock QueryRunner
// ---------------------------------------------------------------------------

function buildQueryRunner(
  findOneResult: Agreement | null = buildAgreement(),
  updateResult: any = undefined,
) {
  return {
    connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    startTransaction: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    commitTransaction: jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined),
    rollbackTransaction: jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined),
    release: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    manager: {
      findOne: jest
        .fn<Promise<Agreement | null>, any[]>()
        .mockResolvedValue(findOneResult),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: jest
        .fn<Promise<any>, any[]>()
        .mockResolvedValue(updateResult ?? { affected: 1 }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettlementCloseService', () => {
  let service: SettlementCloseService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAuditService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBudgetReservationService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDataSource: any;
  let mockQueryRunner: ReturnType<typeof buildQueryRunner>;

  // Helpers to rebuild service/mocks per test
  function setupWith(findOneResult: Agreement | null) {
    mockQueryRunner = buildQueryRunner(findOneResult);
    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };
  }

  beforeEach(async () => {
    mockQueryRunner = buildQueryRunner();
    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };
    mockAuditService = {
      logAdminAction: jest.fn().mockResolvedValue({
        id: 'audit-1',
        isHighRisk: true,
        alertSent: false,
      }),
      flushPendingAlert: jest.fn().mockResolvedValue(undefined),
    };
    mockBudgetReservationService = {
      releaseAgreementReservation: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementCloseService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: AdminAuditService, useValue: mockAuditService },
        {
          provide: BudgetReservationService,
          useValue: mockBudgetReservationService,
        },
      ],
    }).compile();

    service = module.get<SettlementCloseService>(SettlementCloseService);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path: APPROVED → CLOSED', () => {
    it('returns CLOSED status with agreementId and closedAt', async () => {
      const result = await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(result.agreementId).toBe(AGREEMENT_ID);
      expect(result.status).toBe('CLOSED');
      expect(result.closedAt).toBeInstanceOf(Date);
    });

    it('updates agreement to CLOSED with closedAt and closedBy in queryRunner', async () => {
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Agreement,
        { id: AGREEMENT_ID, tenantId: TENANT_ID },
        expect.objectContaining({
          status: AgreementStatus.CLOSED,
          closedBy: USER_ID,
          updatedBy: USER_ID,
        }),
      );
    });

    it('commits transaction on success', async () => {
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('releases queryRunner in finally block', async () => {
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    // T-014: high-risk alarm must fire only AFTER commit succeeds — not
    // before, and never inside the queryRunner transaction.
    it('T-014: passes queryRunner.manager to logAdminAction and calls flushPendingAlert only after commitTransaction()', async () => {
      const callOrder: string[] = [];
      mockAuditService.logAdminAction.mockImplementation(async () => {
        callOrder.push('logAdminAction');
        return { id: 'audit-1', isHighRisk: true, alertSent: false };
      });
      mockQueryRunner.commitTransaction.mockImplementation(async () => {
        callOrder.push('commitTransaction');
      });
      mockAuditService.flushPendingAlert.mockImplementation(async () => {
        callOrder.push('flushPendingAlert');
      });

      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      const auditCall = mockAuditService.logAdminAction.mock.calls[0];
      expect(auditCall[auditCall.length - 1]).toEqual({
        manager: mockQueryRunner.manager,
      });
      expect(callOrder).toEqual([
        'logAdminAction',
        'commitTransaction',
        'flushPendingAlert',
      ]);
      expect(mockAuditService.flushPendingAlert).toHaveBeenCalledWith({
        id: 'audit-1',
        isHighRisk: true,
        alertSent: false,
      });
    });

    // Coordinator-flagged bug fix: flushPendingAlert failing must NOT cause
    // a rollback of an already-committed transaction (would mask the real
    // outcome and return a false 500 for a successful close).
    it('T-014 fix: still returns success and does NOT roll back when flushPendingAlert rejects', async () => {
      mockAuditService.flushPendingAlert.mockRejectedValue(
        new Error('alert channel unavailable'),
      );

      const result = await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(result.status).toBe('CLOSED');
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });
  });

  describe('happy path: ACTIVE → CLOSED', () => {
    beforeEach(() => {
      setupWith(buildAgreement({ status: AgreementStatus.ACTIVE }));
    });

    it('allows closing ACTIVE agreement', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      const result = await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );
      expect(result.status).toBe('CLOSED');
    });
  });

  // -------------------------------------------------------------------------
  // Error: 409 ALREADY_SETTLED
  // -------------------------------------------------------------------------

  describe('error: ALREADY_SETTLED', () => {
    beforeEach(() => {
      setupWith(buildAgreement({ status: AgreementStatus.CLOSED }));
    });

    it('throws ConflictException with ALREADY_SETTLED code', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      const error = await service
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_SETTLED',
      });
    });

    it('rolls back on ALREADY_SETTLED', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await service
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch(() => null);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error: 409 NOT_SETTLEABLE_STATE — non-closeable statuses
  // -------------------------------------------------------------------------

  describe('error: NOT_SETTLEABLE_STATE', () => {
    const nonSettleableStatuses = [
      AgreementStatus.DRAFT,
      AgreementStatus.PENDING,
      AgreementStatus.REJECTED,
      AgreementStatus.CANCELLED,
    ] as const;

    for (const status of nonSettleableStatuses) {
      it(`throws NOT_SETTLEABLE_STATE for ${status} agreement`, async () => {
        const qr = buildQueryRunner(buildAgreement({ status }));
        const ds = { createQueryRunner: jest.fn().mockReturnValue(qr) };
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            SettlementCloseService,
            { provide: DataSource, useValue: ds },
            { provide: AdminAuditService, useValue: mockAuditService },
            {
              provide: BudgetReservationService,
              useValue: mockBudgetReservationService,
            },
          ],
        }).compile();
        const svc = module.get<SettlementCloseService>(SettlementCloseService);

        const error = await svc
          .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'NOT_SETTLEABLE_STATE',
        });
      });
    }

    it('rolls back on NOT_SETTLEABLE_STATE', async () => {
      const qr = buildQueryRunner(
        buildAgreement({ status: AgreementStatus.DRAFT }),
      );
      const ds = { createQueryRunner: jest.fn().mockReturnValue(qr) };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: ds },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      const svc = module.get<SettlementCloseService>(SettlementCloseService);

      await svc
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch(() => null);

      expect(qr.rollbackTransaction).toHaveBeenCalled();
      expect(qr.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error: 404 tenant isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation — 404', () => {
    it('throws NotFoundException when agreement not found for tenant', async () => {
      setupWith(null);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await expect(
        service.closeAgreement(
          AGREEMENT_ID,
          'tenant-OTHER',
          USER_ID,
          USER_EMAIL,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not expose cross-tenant data in error message', async () => {
      setupWith(null);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      const error = await service
        .closeAgreement(AGREEMENT_ID, 'tenant-OTHER', USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect((error as NotFoundException).message).not.toContain(
        'tenant-OTHER',
      );
    });

    it('rolls back on NotFoundException', async () => {
      setupWith(null);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await service
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch(() => null);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Optimistic lock / version conflict
  // -------------------------------------------------------------------------

  describe('optimistic lock conflict', () => {
    it('rolls back and rethrows when update throws version conflict error', async () => {
      mockQueryRunner.manager.update.mockRejectedValue(
        new Error('could not serialize access due to concurrent update'),
      );

      await expect(
        service.closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow(/serialize/);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  describe('audit log', () => {
    it('logs CLOSE action with AGREEMENT entityType', async () => {
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(mockAuditService.logAdminAction).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        'CLOSE',
        'AGREEMENT',
        AGREEMENT_ID,
        undefined,
        'SUCCESS',
        expect.objectContaining({ previousStatus: AgreementStatus.APPROVED }),
        expect.objectContaining({ newStatus: AgreementStatus.CLOSED }),
        undefined, // no justification
        { manager: mockQueryRunner.manager },
      );
    });

    it('includes justification in audit log when provided', async () => {
      const justification = 'Promotion ended, all invoices reconciled';

      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        { justification },
      );

      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        'CLOSE',
        'AGREEMENT',
        AGREEMENT_ID,
        undefined,
        'SUCCESS',
        expect.any(Object),
        expect.objectContaining({ justification }),
        justification,
        { manager: mockQueryRunner.manager },
      );
    });

    it('does NOT call audit log on error path (rollback)', async () => {
      setupWith(null); // will throw NotFoundException
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await service
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch(() => null);

      expect(mockAuditService.logAdminAction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // State machine: audit log error paths (409 state errors)
  // -------------------------------------------------------------------------

  describe('audit log NOT called on 409 error paths', () => {
    it('does NOT call audit log when ALREADY_SETTLED (409)', async () => {
      setupWith(buildAgreement({ status: AgreementStatus.CLOSED }));
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await service
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch(() => null);

      expect(mockAuditService.logAdminAction).not.toHaveBeenCalled();
    });

    it('does NOT call audit log when NOT_SETTLEABLE_STATE (409)', async () => {
      setupWith(buildAgreement({ status: AgreementStatus.DRAFT }));
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await service
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch(() => null);

      expect(mockAuditService.logAdminAction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Audit log ACTIVE → CLOSED path: previousStatus must be ACTIVE
  // -------------------------------------------------------------------------

  describe('audit log: previousStatus matches source agreement status', () => {
    it('logs previousStatus as ACTIVE when closing an ACTIVE agreement', async () => {
      setupWith(buildAgreement({ status: AgreementStatus.ACTIVE }));
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        'CLOSE',
        'AGREEMENT',
        AGREEMENT_ID,
        undefined,
        'SUCCESS',
        expect.objectContaining({ previousStatus: AgreementStatus.ACTIVE }),
        expect.objectContaining({ newStatus: AgreementStatus.CLOSED }),
        undefined,
        { manager: mockQueryRunner.manager },
      );
    });
  });

  // -------------------------------------------------------------------------
  // closedAt passed into update payload
  // -------------------------------------------------------------------------

  describe('closedAt field in update payload', () => {
    it('update payload includes closedAt as a Date instance', async () => {
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      const updateCall = mockQueryRunner.manager.update.mock.calls[0] as [
        unknown,
        unknown,
        Record<string, unknown>,
      ];
      const updatePayload = updateCall[2];
      expect(updatePayload.closedAt).toBeInstanceOf(Date);
    });

    it('closedAt in update payload matches closedAt in returned result', async () => {
      const result = await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      const updateCall = mockQueryRunner.manager.update.mock.calls[0] as [
        unknown,
        unknown,
        Record<string, unknown>,
      ];
      const updatePayload = updateCall[2];
      // Both should be Date instances; compare via getTime tolerance
      expect(
        Math.abs(
          (updatePayload.closedAt as Date).getTime() -
            result.closedAt.getTime(),
        ),
      ).toBeLessThan(50); // within 50ms
    });
  });

  // -------------------------------------------------------------------------
  // CRIT: Çift-sayım önlemi — NO LEDGER WRITE (T-003 dersi korunur)
  // T-030 (docs/analysis/0003) niyet değişikliği: close artık BÜTÇE RELEASE
  // yazar (BudgetReservationService üzerinden, aynı queryRunner transaction'ı
  // içinde) — bu kasıtlı ve gerekli (F1 sızıntı fix'i). Yasak olan hâlâ
  // LEDGER'a yazmak (consumed_amount hiçbir zaman close'da değişmemeli).
  // -------------------------------------------------------------------------

  describe('CRIT: no LEDGER write on close (double-counting prevention)', () => {
    it('does NOT touch any ledger entity via queryRunner.manager', async () => {
      // SettlementCloseService: DataSource, AdminAuditService,
      // BudgetReservationService alır — LedgerService/LedgerRepository
      // bu serviste bulunmamalı (bkz. constructor).
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      // queryRunner.manager.update yalnızca 1 kez çağrılmalı (agreement state
      // update). Bütçe RELEASE'i BudgetReservationService (mock'lu) üzerinden
      // gider, queryRunner.manager.update'i doğrudan çağırmaz.
      expect(mockQueryRunner.manager.update).toHaveBeenCalledTimes(1);
    });

    it('queryRunner.manager.update called exactly once (agreement status only — no ledger rows)', async () => {
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      // Tek update çağrısı: agreement.status = CLOSED
      // Eğer ledger entry yazılsaydı başka update/save çağrıları olurdu.
      const updateCalls = mockQueryRunner.manager.update.mock.calls;
      expect(updateCalls).toHaveLength(1);

      // Ve bu tek çağrı Agreement entity üzerinde olmalı
      expect(updateCalls[0][0]).toBe(Agreement);
    });

    it('queryRunner.manager.save is NOT called (no new ledger rows created)', async () => {
      // Ledger entry oluşturulsaydı manager.save çağrılırdı.
      // manager.save mock'ta tanımlı değil — undefined olmalı.
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect((mockQueryRunner.manager as any).save).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // T-030: budget RELEASE — çağrılır, aynı queryRunner transaction'ı içinde,
  // audit log'a öncesinde ve commit'ten önce.
  // -------------------------------------------------------------------------

  describe('T-030: budget reservation release on close', () => {
    it('calls releaseAgreementReservation with agreementId/tenantId/userId/CLOSE and queryRunner.manager', async () => {
      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(
        mockBudgetReservationService.releaseAgreementReservation,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockBudgetReservationService.releaseAgreementReservation,
      ).toHaveBeenCalledWith(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
        mockQueryRunner.manager,
      );
    });

    it('includes budgetReleases in audit log newValues', async () => {
      mockBudgetReservationService.releaseAgreementReservation.mockResolvedValueOnce(
        [
          {
            envelopeId: 'env-1',
            amount: 20000,
          },
        ],
      );

      await service.closeAgreement(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        'CLOSE',
        'AGREEMENT',
        AGREEMENT_ID,
        undefined,
        'SUCCESS',
        expect.any(Object),
        expect.objectContaining({
          budgetReleases: [{ envelopeId: 'env-1', amount: 20000 }],
        }),
        undefined,
        { manager: mockQueryRunner.manager },
      );
    });

    it('does NOT call releaseAgreementReservation on error path (rollback)', async () => {
      setupWith(null); // will throw NotFoundException
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SettlementCloseService,
          { provide: DataSource, useValue: mockDataSource },
          { provide: AdminAuditService, useValue: mockAuditService },
          {
            provide: BudgetReservationService,
            useValue: mockBudgetReservationService,
          },
        ],
      }).compile();
      service = module.get<SettlementCloseService>(SettlementCloseService);

      await service
        .closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch(() => null);

      expect(
        mockBudgetReservationService.releaseAgreementReservation,
      ).not.toHaveBeenCalled();
    });

    it('rolls back the whole transaction if releaseAgreementReservation throws', async () => {
      mockBudgetReservationService.releaseAgreementReservation.mockRejectedValueOnce(
        new Error('unexpected budget failure'),
      );

      await expect(
        service.closeAgreement(AGREEMENT_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow('unexpected budget failure');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      // Audit log must not be written if the release failed before it.
      expect(mockAuditService.logAdminAction).not.toHaveBeenCalled();
    });
  });
});
