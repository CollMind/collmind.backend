import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgreementService } from './agreement.service';
import { AgreementRepository } from './agreement.repository';
import { BudgetService } from '../../../shared/budget/budget.service';
import { BudgetReservationService } from '../../../shared/budget/budget-reservation.service';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { KpiEngineService } from '../../../shared/kpi-engine/kpi-engine.service';
import { TacticService } from '../../../master-data/tactic/tactic.service';
import { CplService } from '../../../master-data/cpl/cpl.service';
import { ChannelService } from '../../../master-data/channel/channel.service';
import { MechanicService } from '../../../master-data/mechanic/mechanic.service';
import { CategoryService } from '../../../master-data/category/category.service';
import { FuService } from '../../../master-data/forecasting-unit/fu.service';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
import {
  Agreement,
  AgreementStatus,
} from '../../../../database/entities/agreement.entity';
import { UserRole } from '../../../../database/entities/user.entity';

describe('AgreementService — T-028e (CM kategori-scope türetme + enforcement) / T-032 (audit)', () => {
  let service: AgreementService;
  let agreementRepo: jest.Mocked<AgreementRepository>;
  let accessScope: jest.Mocked<AccessScopeService>;
  let budgetReservationService: jest.Mocked<BudgetReservationService>;
  let approvalService: jest.Mocked<ApprovalService>;
  let adminAuditService: jest.Mocked<AdminAuditService>;
  let budgetService: { reserveForAgreement: jest.Mock };
  // T-034b — see plan.service.spec.ts's identical field comment.
  let queryRunnerManager: { count: jest.Mock; getRepository: jest.Mock };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: typeof queryRunnerManager;
  };
  let dataSource: { createQueryRunner: jest.Mock };

  const tenantId = 'tenant-1';
  const userId = 'user-1';
  const userEmail = 'user-1@wella.com';
  const cmActor = { userId: 'cm-1', role: UserRole.CATEGORY_MANAGER };
  const adminActor = { userId: 'admin-1', role: UserRole.ADMIN };

  const baseAgreement: Partial<Agreement> = {
    id: 'agreement-1',
    agreementCode: 'STA-2026-001',
    status: AgreementStatus.PENDING,
    approvalRequestId: 'approval-1',
    cplId: 'cpl-1',
    fuId: 'fu-1',
    categoryId: undefined,
    channel: { id: 'channel-1', code: 'NKA' } as any,
    capTotalAmount: 1000,
    periodMonth: '2026-01',
    currency: 'TRY',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgreementService,
        {
          provide: AgreementRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByCode: jest.fn(),
            findAll: jest.fn(),
            updateUnversioned: jest.fn(),
            updateVersioned: jest.fn(),
            updateStatus: jest.fn(),
            softDelete: jest.fn(),
            generateAgreementCode: jest.fn(),
            // T-034b
            findByIdForUpdate: jest.fn(),
            updateStatusCas: jest.fn(),
          },
        },
        {
          provide: BudgetService,
          useValue: {
            reserveForAgreement: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: DataSource,
          useValue: { createQueryRunner: jest.fn() },
        },
        {
          provide: BudgetReservationService,
          useValue: { releaseAgreementReservation: jest.fn() },
        },
        {
          provide: ApprovalService,
          useValue: {
            createRequest: jest.fn(),
            approve: jest.fn(),
            reject: jest.fn(),
          },
        },
        { provide: KpiEngineService, useValue: { calculateFu: jest.fn() } },
        {
          provide: TacticService,
          useValue: { findOne: jest.fn(), findAll: jest.fn() },
        },
        { provide: CplService, useValue: { findOne: jest.fn() } },
        { provide: ChannelService, useValue: { findOne: jest.fn() } },
        { provide: MechanicService, useValue: { findOne: jest.fn() } },
        { provide: CategoryService, useValue: { findOne: jest.fn() } },
        { provide: FuService, useValue: { findOne: jest.fn() } },
        {
          provide: AccessScopeService,
          useValue: {
            resolveScope: jest.fn(),
            isInScope: jest.fn(),
            assertEntityInScope: jest.fn(),
            applyToQueryBuilder: jest.fn(),
          },
        },
        {
          provide: AdminAuditService,
          useValue: {
            logAdminAction: jest
              .fn()
              .mockResolvedValue({ isHighRisk: false, alertSent: false }),
            flushPendingAlert: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AgreementService);
    agreementRepo = module.get(AgreementRepository);
    accessScope = module.get(AccessScopeService);
    budgetReservationService = module.get(BudgetReservationService);
    approvalService = module.get(ApprovalService);
    adminAuditService = module.get(AdminAuditService);
    budgetService = module.get(BudgetService);

    // T-034b — see plan.service.spec.ts's identical setup.
    queryRunnerManager = {
      count: jest.fn(),
      getRepository: jest.fn(),
    };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: queryRunnerManager,
    };
    dataSource = module.get(DataSource);
    dataSource.createQueryRunner.mockReturnValue(queryRunner);
  });

  afterEach(() => jest.clearAllMocks());

  describe('category derivation (findById scope check)', () => {
    it('uses agreement.categoryId directly when set (priority over FU->GU)', async () => {
      agreementRepo.findById.mockResolvedValue({
        ...baseAgreement,
        categoryId: 'cat-direct',
        forecastingUnit: {
          genericUnit: { categoryId: 'cat-from-fu' },
        } as any,
      } as Agreement);
      accessScope.resolveScope.mockResolvedValue({ kind: 'UNRESTRICTED' });
      accessScope.isInScope.mockReturnValue(true);

      await service.findById('agreement-1', tenantId, cmActor);

      expect(accessScope.isInScope).toHaveBeenCalledWith(
        { kind: 'UNRESTRICTED' },
        { cplId: 'cpl-1', categoryId: 'cat-direct' },
      );
    });

    it('derives category via forecastingUnit.genericUnit when agreement.categoryId is empty', async () => {
      agreementRepo.findById.mockResolvedValue({
        ...baseAgreement,
        categoryId: undefined,
        forecastingUnit: {
          genericUnit: { categoryId: 'cat-from-fu' },
        } as any,
      } as Agreement);
      accessScope.resolveScope.mockResolvedValue({ kind: 'UNRESTRICTED' });
      accessScope.isInScope.mockReturnValue(true);

      await service.findById('agreement-1', tenantId, cmActor);

      expect(accessScope.isInScope).toHaveBeenCalledWith(
        { kind: 'UNRESTRICTED' },
        { cplId: 'cpl-1', categoryId: 'cat-from-fu' },
      );
    });

    it('fails closed (categoryId=null) when neither agreement.categoryId nor FU->GU chain resolves', async () => {
      agreementRepo.findById.mockResolvedValue({
        ...baseAgreement,
        categoryId: undefined,
        forecastingUnit: { genericUnit: undefined } as any,
      } as Agreement);
      accessScope.resolveScope.mockResolvedValue({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'cat-x' }],
      });
      accessScope.isInScope.mockReturnValue(false);

      await expect(
        service.findById('agreement-1', tenantId, cmActor),
      ).rejects.toThrow(NotFoundException);

      expect(accessScope.isInScope).toHaveBeenCalledWith(expect.anything(), {
        cplId: 'cpl-1',
        categoryId: null,
      });
    });
  });

  describe('approve — CM category-scope enforcement', () => {
    const pendingAgreement = {
      ...baseAgreement,
      categoryId: 'cat-1',
    } as Agreement;

    it('CM within scope: approve succeeds', async () => {
      agreementRepo.findById
        .mockResolvedValueOnce(pendingAgreement) // pre-tx read
        .mockResolvedValueOnce({
          ...pendingAgreement,
          status: AgreementStatus.APPROVED,
        } as Agreement); // post-commit re-read
      agreementRepo.findByIdForUpdate.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);
      accessScope.resolveScope.mockResolvedValue({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'cat-1' }],
      });
      accessScope.assertEntityInScope.mockImplementation(() => undefined);

      const result = await service.approve(
        'agreement-1',
        tenantId,
        userId,
        'ok',
        userEmail,
        cmActor,
      );

      expect(accessScope.assertEntityInScope).toHaveBeenCalledWith(
        expect.anything(),
        { categoryId: 'cat-1' },
      );
      expect(result.status).toBe(AgreementStatus.APPROVED);
    });

    it('CM out of scope: approve throws 403, no budget reservation attempted', async () => {
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      accessScope.resolveScope.mockResolvedValue({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'cat-other' }],
      });
      accessScope.assertEntityInScope.mockImplementation(() => {
        throw new ForbiddenException(
          'Access denied: entity is outside your authorized scope',
        );
      });

      await expect(
        service.approve(
          'agreement-1',
          tenantId,
          userId,
          'ok',
          userEmail,
          cmActor,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(approvalService.approve).not.toHaveBeenCalled();
      // T-032: 403 short-circuits before any state change — no audit row.
      expect(adminAuditService.logAdminAction).not.toHaveBeenCalled();
    });

    it('ADMIN actor: no scope check performed (assertEntityInScope not called)', async () => {
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);

      await service.approve(
        'agreement-1',
        tenantId,
        userId,
        'ok',
        userEmail,
        adminActor,
      );

      expect(accessScope.resolveScope).not.toHaveBeenCalled();
      expect(accessScope.assertEntityInScope).not.toHaveBeenCalled();
    });
  });

  describe('reject — CM category-scope enforcement', () => {
    const pendingAgreement = {
      ...baseAgreement,
      categoryId: 'cat-1',
    } as Agreement;

    it('CM out of scope: reject throws 403, no budget release attempted', async () => {
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      accessScope.resolveScope.mockResolvedValue({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'cat-other' }],
      });
      accessScope.assertEntityInScope.mockImplementation(() => {
        throw new ForbiddenException(
          'Access denied: entity is outside your authorized scope',
        );
      });

      await expect(
        service.reject(
          'agreement-1',
          tenantId,
          userId,
          'nope',
          userEmail,
          cmActor,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(approvalService.reject).not.toHaveBeenCalled();
      expect(
        budgetReservationService.releaseAgreementReservation,
      ).not.toHaveBeenCalled();
      // T-032: 403 short-circuits before any state change — no audit row.
      expect(adminAuditService.logAdminAction).not.toHaveBeenCalled();
    });

    it('CM within scope: reject succeeds', async () => {
      agreementRepo.findById
        .mockResolvedValueOnce(pendingAgreement)
        .mockResolvedValueOnce({
          ...pendingAgreement,
          status: AgreementStatus.REJECTED,
        } as Agreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);
      accessScope.resolveScope.mockResolvedValue({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'cat-1' }],
      });
      accessScope.assertEntityInScope.mockImplementation(() => undefined);

      const result = await service.reject(
        'agreement-1',
        tenantId,
        userId,
        'nope',
        userEmail,
        cmActor,
      );

      expect(result.status).toBe(AgreementStatus.REJECTED);
    });
  });

  describe('T-032: audit immutable — submit/approve/reject/cancel write to admin_audit_logs', () => {
    it('submit: writes SUBMIT audit row with previous/new status', async () => {
      const draftAgreement = {
        ...baseAgreement,
        status: AgreementStatus.DRAFT,
        approvalRequestId: undefined,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(draftAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(draftAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);
      approvalService.createRequest.mockResolvedValue({
        id: 'approval-2',
      } as any);

      await service.submit('agreement-1', tenantId, userId, userEmail);

      expect(adminAuditService.logAdminAction).toHaveBeenCalledWith(
        tenantId,
        userId,
        userEmail,
        'SUBMIT',
        'AGREEMENT',
        'agreement-1',
        undefined,
        'SUCCESS',
        { previousStatus: AgreementStatus.DRAFT },
        expect.objectContaining({ newStatus: AgreementStatus.PENDING }),
        undefined,
        { manager: queryRunnerManager },
      );
    });

    it('submit: audit-write failure rolls back the transaction (T-034b real atomicity) and re-throws', async () => {
      const draftAgreement = {
        ...baseAgreement,
        status: AgreementStatus.DRAFT,
        approvalRequestId: undefined,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(draftAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(draftAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);
      approvalService.createRequest.mockResolvedValue({
        id: 'approval-2',
      } as any);
      adminAuditService.logAdminAction.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        service.submit('agreement-1', tenantId, userId, userEmail),
      ).rejects.toThrow('db down');

      // T-034b: real transaction — one rollback undoes the status write +
      // approval-request creation together. No manual revert-to-DRAFT call.
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(agreementRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('approve: writes APPROVE audit row (high-risk)', async () => {
      const pendingAgreement = {
        ...baseAgreement,
        status: AgreementStatus.PENDING,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);

      await service.approve(
        'agreement-1',
        tenantId,
        userId,
        'ok',
        userEmail,
        adminActor,
      );

      expect(adminAuditService.logAdminAction).toHaveBeenCalledWith(
        tenantId,
        userId,
        userEmail,
        'APPROVE',
        'AGREEMENT',
        'agreement-1',
        undefined,
        'SUCCESS',
        { previousStatus: AgreementStatus.PENDING },
        expect.objectContaining({ newStatus: AgreementStatus.APPROVED }),
        'ok',
        { manager: queryRunnerManager },
      );
      expect(budgetService.reserveForAgreement).toHaveBeenCalledWith(
        pendingAgreement.id,
        pendingAgreement.capTotalAmount,
        pendingAgreement.channel!.code,
        pendingAgreement.periodMonth,
        pendingAgreement.currency,
        tenantId,
        userId,
        queryRunnerManager,
      );
      expect(adminAuditService.flushPendingAlert).toHaveBeenCalled();
    });

    it('approve: audit-write failure rolls back (RESERVE + status + approval decision together) and re-throws — T-034b real atomicity', async () => {
      const pendingAgreement = {
        ...baseAgreement,
        status: AgreementStatus.PENDING,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);
      adminAuditService.logAdminAction.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        service.approve(
          'agreement-1',
          tenantId,
          userId,
          'ok',
          userEmail,
          adminActor,
        ),
      ).rejects.toThrow('db down');

      // T-034b: real transaction replaces the old "release RESERVE, revert
      // to PENDING" compensation — one rollback undoes everything, so the
      // explicit compensation call is gone.
      expect(
        budgetReservationService.releaseAgreementReservation,
      ).not.toHaveBeenCalled();
      expect(agreementRepo.updateStatus).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('reject: writes REJECT audit row and does not release budget itself (defensive release is separate)', async () => {
      const pendingAgreement = {
        ...baseAgreement,
        status: AgreementStatus.PENDING,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);

      await service.reject(
        'agreement-1',
        tenantId,
        userId,
        'nope',
        userEmail,
        adminActor,
      );

      expect(adminAuditService.logAdminAction).toHaveBeenCalledWith(
        tenantId,
        userId,
        userEmail,
        'REJECT',
        'AGREEMENT',
        'agreement-1',
        undefined,
        'SUCCESS',
        { previousStatus: AgreementStatus.PENDING },
        { newStatus: AgreementStatus.REJECTED, rejectionReason: 'nope' },
        'nope',
        { manager: queryRunnerManager },
      );
    });

    it('reject: audit-write failure rolls back (status + approval decision together) and re-throws — T-034b real atomicity', async () => {
      const pendingAgreement = {
        ...baseAgreement,
        status: AgreementStatus.PENDING,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);
      adminAuditService.logAdminAction.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        service.reject(
          'agreement-1',
          tenantId,
          userId,
          'nope',
          userEmail,
          adminActor,
        ),
      ).rejects.toThrow('db down');

      expect(agreementRepo.updateStatus).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      // Defensive release block (best-effort, outside the transaction) must
      // not run once the transaction itself already threw.
      expect(
        budgetReservationService.releaseAgreementReservation,
      ).not.toHaveBeenCalled();
    });

    it('cancel: writes CANCEL audit row after budget release + status-CAS update (T-042 real transaction)', async () => {
      const approvedAgreement = {
        ...baseAgreement,
        status: AgreementStatus.APPROVED,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(approvedAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(approvedAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);

      await service.cancel(
        'agreement-1',
        tenantId,
        userId,
        'no longer needed',
        userEmail,
      );

      expect(
        budgetReservationService.releaseAgreementReservation,
      ).toHaveBeenCalledWith(
        'agreement-1',
        tenantId,
        userId,
        'CANCEL',
        queryRunnerManager,
      );
      expect(agreementRepo.updateStatusCas).toHaveBeenCalledWith(
        queryRunnerManager,
        'agreement-1',
        tenantId,
        AgreementStatus.APPROVED,
        expect.objectContaining({
          status: AgreementStatus.CANCELLED,
          updatedBy: userId,
        }),
      );
      expect(adminAuditService.logAdminAction).toHaveBeenCalledWith(
        tenantId,
        userId,
        userEmail,
        'CANCEL',
        'AGREEMENT',
        'agreement-1',
        undefined,
        'SUCCESS',
        { previousStatus: AgreementStatus.APPROVED },
        {
          newStatus: AgreementStatus.CANCELLED,
          reason: 'no longer needed',
        },
        'no longer needed',
        { manager: queryRunnerManager },
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(adminAuditService.flushPendingAlert).toHaveBeenCalled();
    });

    it('cancel: allows ACTIVE agreements too (single-status CAS uses the status actually read under the row lock)', async () => {
      const activeAgreement = {
        ...baseAgreement,
        status: AgreementStatus.ACTIVE,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(activeAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(activeAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);

      await service.cancel('agreement-1', tenantId, userId, 'ok', userEmail);

      expect(agreementRepo.updateStatusCas).toHaveBeenCalledWith(
        queryRunnerManager,
        'agreement-1',
        tenantId,
        AgreementStatus.ACTIVE,
        expect.objectContaining({ status: AgreementStatus.CANCELLED }),
      );
    });

    it('cancel: audit-write failure rolls back the transaction (budget release + status-CAS together, T-042 real atomicity) and re-throws', async () => {
      const approvedAgreement = {
        ...baseAgreement,
        status: AgreementStatus.APPROVED,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(approvedAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(approvedAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(1);
      adminAuditService.logAdminAction.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        service.cancel(
          'agreement-1',
          tenantId,
          userId,
          'no longer needed',
          userEmail,
        ),
      ).rejects.toThrow('db down');

      // T-042: real transaction — one rollback undoes the budget release +
      // status-CAS together. No "AUDIT LOG MISSING, manual reconciliation"
      // compensation path anymore (that reasoning is stale, see method
      // header comment); this is now identical to submit/approve/reject.
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(adminAuditService.flushPendingAlert).not.toHaveBeenCalled();
    });

    it('cancel: only APPROVED or ACTIVE agreements can be cancelled (guard runs on the locked row)', async () => {
      const draftAgreement = {
        ...baseAgreement,
        status: AgreementStatus.DRAFT,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(draftAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(draftAgreement);

      await expect(
        service.cancel('agreement-1', tenantId, userId, 'no', userEmail),
      ).rejects.toThrow('Only APPROVED or ACTIVE agreements can be cancelled');

      expect(
        budgetReservationService.releaseAgreementReservation,
      ).not.toHaveBeenCalled();
      expect(agreementRepo.updateStatusCas).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('cancel: concurrent status change under the lock (status-CAS affected=0) surfaces 409, not a silent overwrite', async () => {
      const approvedAgreement = {
        ...baseAgreement,
        status: AgreementStatus.APPROVED,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(approvedAgreement);
      agreementRepo.findByIdForUpdate.mockResolvedValue(approvedAgreement);
      agreementRepo.updateStatusCas.mockResolvedValue(0);

      await expect(
        service.cancel('agreement-1', tenantId, userId, 'no', userEmail),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_STATE_TRANSITION',
        }),
      });

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('update: writes UPDATE audit row scoped to changed fields only (DRAFT agreement)', async () => {
      const draftAgreement = {
        ...baseAgreement,
        status: AgreementStatus.DRAFT,
        capTotalAmount: 1000,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(draftAgreement);
      agreementRepo.updateVersioned.mockResolvedValue({
        ...draftAgreement,
        capTotalAmount: 2000,
      } as Agreement);

      await service.update(
        'agreement-1',
        { capTotalAmount: 2000, version: 1 } as any,
        tenantId,
        userId,
        userEmail,
      );

      expect(adminAuditService.logAdminAction).toHaveBeenCalledWith(
        tenantId,
        userId,
        userEmail,
        'UPDATE',
        'AGREEMENT',
        'agreement-1',
        undefined,
        'SUCCESS',
        { capTotalAmount: 1000 },
        { capTotalAmount: 2000 },
      );
    });

    it('update: audit-write failure does NOT fail the (already persisted) edit — best-effort, non-blocking', async () => {
      const draftAgreement = {
        ...baseAgreement,
        status: AgreementStatus.DRAFT,
        capTotalAmount: 1000,
      } as Agreement;
      agreementRepo.findById.mockResolvedValue(draftAgreement);
      agreementRepo.updateVersioned.mockResolvedValue({
        ...draftAgreement,
        capTotalAmount: 2000,
      } as Agreement);
      adminAuditService.logAdminAction.mockRejectedValueOnce(
        new Error('db down'),
      );

      const result = await service.update(
        'agreement-1',
        { capTotalAmount: 2000, version: 1 } as any,
        tenantId,
        userId,
        userEmail,
      );

      expect(result.capTotalAmount).toBe(2000);
    });
  });
});
