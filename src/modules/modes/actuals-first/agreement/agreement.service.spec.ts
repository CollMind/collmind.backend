import { Test, TestingModule } from '@nestjs/testing';
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
import {
  Agreement,
  AgreementStatus,
} from '../../../../database/entities/agreement.entity';
import { UserRole } from '../../../../database/entities/user.entity';

describe('AgreementService — T-028e (CM kategori-scope türetme + enforcement)', () => {
  let service: AgreementService;
  let agreementRepo: jest.Mocked<AgreementRepository>;
  let accessScope: jest.Mocked<AccessScopeService>;
  let budgetReservationService: jest.Mocked<BudgetReservationService>;
  let approvalService: jest.Mocked<ApprovalService>;

  const tenantId = 'tenant-1';
  const userId = 'user-1';
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
            update: jest.fn(),
            updateStatus: jest.fn(),
            softDelete: jest.fn(),
            generateAgreementCode: jest.fn(),
          },
        },
        {
          provide: BudgetService,
          useValue: { reserveForAgreement: jest.fn() },
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
      ],
    }).compile();

    service = module.get(AgreementService);
    agreementRepo = module.get(AgreementRepository);
    accessScope = module.get(AccessScopeService);
    budgetReservationService = module.get(BudgetReservationService);
    approvalService = module.get(ApprovalService);
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
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      accessScope.resolveScope.mockResolvedValue({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'cat-1' }],
      });
      accessScope.assertEntityInScope.mockImplementation(() => undefined);
      agreementRepo.updateStatus.mockResolvedValue({
        ...pendingAgreement,
        status: AgreementStatus.APPROVED,
      } as Agreement);

      const result = await service.approve(
        'agreement-1',
        tenantId,
        userId,
        'ok',
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
        service.approve('agreement-1', tenantId, userId, 'ok', cmActor),
      ).rejects.toThrow(ForbiddenException);

      expect(approvalService.approve).not.toHaveBeenCalled();
    });

    it('ADMIN actor: no scope check performed (assertEntityInScope not called)', async () => {
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      agreementRepo.updateStatus.mockResolvedValue({
        ...pendingAgreement,
        status: AgreementStatus.APPROVED,
      } as Agreement);

      await service.approve('agreement-1', tenantId, userId, 'ok', adminActor);

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
        service.reject('agreement-1', tenantId, userId, 'nope', cmActor),
      ).rejects.toThrow(ForbiddenException);

      expect(approvalService.reject).not.toHaveBeenCalled();
      expect(
        budgetReservationService.releaseAgreementReservation,
      ).not.toHaveBeenCalled();
    });

    it('CM within scope: reject succeeds', async () => {
      agreementRepo.findById.mockResolvedValue(pendingAgreement);
      accessScope.resolveScope.mockResolvedValue({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'cat-1' }],
      });
      accessScope.assertEntityInScope.mockImplementation(() => undefined);
      agreementRepo.updateStatus.mockResolvedValue({
        ...pendingAgreement,
        status: AgreementStatus.REJECTED,
      } as Agreement);

      const result = await service.reject(
        'agreement-1',
        tenantId,
        userId,
        'nope',
        cmActor,
      );

      expect(result.status).toBe(AgreementStatus.REJECTED);
    });
  });
});
