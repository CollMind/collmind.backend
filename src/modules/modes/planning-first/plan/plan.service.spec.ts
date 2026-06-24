import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanRepository } from './plan.repository';
import { BudgetService } from '../../../shared/budget/budget.service';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { KpiEngineService } from '../../../shared/kpi-engine/kpi-engine.service';
import {
  Plan,
  PlanStatus,
  PlanFu,
  PlanSku,
} from '../../../../database/entities/plan.entity';
import { ForecastingUnit } from '../../../../database/entities/forecasting-unit.entity';
import { Sku } from '../../../../database/entities/sku.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';

describe('PlanService', () => {
  let service: PlanService;
  let planRepo: jest.Mocked<PlanRepository>;
  let budgetService: jest.Mocked<BudgetService>;
  let approvalService: jest.Mocked<ApprovalService>;
  let kpiEngine: jest.Mocked<KpiEngineService>;
  let fuRepo: jest.Mocked<Repository<ForecastingUnit>>;
  let skuRepo: jest.Mocked<Repository<Sku>>;
  let tacticRepo: jest.Mocked<Repository<Tactic>>;

  const mockTenantId = 'tenant-1';
  const mockUserId = 'user-1';
  const mockPlanId = 'plan-1';

  const mockPlan: Partial<Plan> = {
    id: mockPlanId,
    planCode: 'PLAN-2026-Q1-001',
    planName: 'Test Plan',
    status: PlanStatus.DRAFT,
    periodMonth: '2026-01',
    totalSpend: 100000,
    onInvoiceSpend: 60000,
    offInvoiceSpend: 40000,
    channel: { id: 'channel-1', code: 'NKA', name: 'NKA Channel' } as any,
    category: { id: 'category-1', code: 'DAIRY', name: 'Dairy' } as any,
    cpl: { id: 'cpl-1', code: 'CPL-001', name: 'Test CPL' } as any,
    planFus: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanService,
        {
          provide: PlanRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findAll: jest.fn(),
            update: jest.fn(),
            updateStatus: jest.fn(),
            softDelete: jest.fn(),
            generatePlanCode: jest.fn(),
            addFu: jest.fn(),
            findPlanFu: jest.fn(),
            updatePlanFu: jest.fn(),
            removeFu: jest.fn(),
            addSku: jest.fn(),
            findPlanSku: jest.fn(),
            updatePlanSku: jest.fn(),
          },
        },
        {
          provide: BudgetService,
          useValue: {
            findEnvelopeByDimensions: jest.fn(),
            getBudgetStatus: jest.fn(),
            reserveForPlan: jest.fn(),
            releaseForPlan: jest.fn(),
          },
        },
        {
          provide: ApprovalService,
          useValue: {
            createRequest: jest.fn(),
            approve: jest.fn(),
            reject: jest.fn(),
          },
        },
        {
          provide: KpiEngineService,
          useValue: {
            calculateSku: jest.fn(),
            calculateFu: jest.fn(),
            calculatePlan: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ForecastingUnit),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Sku),
          useValue: {
            findBy: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Tactic),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PlanService>(PlanService);
    planRepo = module.get(PlanRepository);
    budgetService = module.get(BudgetService);
    approvalService = module.get(ApprovalService);
    kpiEngine = module.get(KpiEngineService);
    fuRepo = module.get(getRepositoryToken(ForecastingUnit));
    skuRepo = module.get(getRepositoryToken(Sku));
    tacticRepo = module.get(getRepositoryToken(Tactic));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submit', () => {
    it('should successfully submit plan for approval', async () => {
      const planWithFus = {
        ...mockPlan,
        planFus: [
          {
            id: 'plan-fu-1',
            fuId: 'fu-1',
          } as PlanFu,
        ],
      } as Plan;

      const mockApprovalRequest = {
        id: 'approval-request-1',
        requestType: ApprovalRequestType.PLAN,
      };

      planRepo.findById.mockResolvedValue(planWithFus as Plan);
      approvalService.createRequest.mockResolvedValue(
        mockApprovalRequest as any,
      );
      planRepo.updateStatus.mockResolvedValue({
        ...planWithFus,
        status: PlanStatus.PENDING_APPROVAL,
        approvalRequestId: mockApprovalRequest.id,
      } as Plan);

      const result = await service.submit(mockPlanId, mockTenantId, mockUserId);

      expect(result.status).toBe(PlanStatus.PENDING_APPROVAL);
      expect(approvalService.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestType: ApprovalRequestType.PLAN,
          entityType: 'PLAN',
          entityId: mockPlanId,
        }),
        mockTenantId,
        mockUserId,
      );
      expect(planRepo.updateStatus).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        PlanStatus.PENDING_APPROVAL,
        expect.objectContaining({
          approvalRequestId: mockApprovalRequest.id,
        }),
      );
    });

    it('should fail if plan is not in DRAFT status', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan);

      await expect(
        service.submit(mockPlanId, mockTenantId, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fail if plan has no FUs', async () => {
      planRepo.findById.mockResolvedValue(mockPlan as Plan);

      await expect(
        service.submit(mockPlanId, mockTenantId, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkBudget', () => {
    it('should return budget check result with sufficient budget', async () => {
      const mockEnvelope = {
        id: 'envelope-1',
        code: 'NKA/2026-01',
        name: 'NKA 2026-01 Budget',
        allocatedAmount: 200000,
        currency: 'TRY',
      };

      const mockBudgetStatus = {
        totalAllocation: 200000,
        available: 150000,
        reserved: 30000,
        consumed: 20000,
        planned: 0,
        status: 'GREEN' as const,
      };

      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(
        mockEnvelope as any,
      );
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);

      const result = await service.checkBudget(mockPlanId, mockTenantId);

      expect(result.hasBudget).toBe(true);
      expect(result.sufficient).toBe(true);
      expect(result.envelope?.id).toBe(mockEnvelope.id);
      expect(result.planTotalSpend).toBe(Number(mockPlan.totalSpend));
    });

    it('should return budget check result without envelope if not found', async () => {
      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(null);

      const result = await service.checkBudget(mockPlanId, mockTenantId);

      expect(result.hasBudget).toBe(false);
      expect(result.envelope).toBeUndefined();
    });
  });

  describe('approve', () => {
    it('should successfully approve plan with budget reservation', async () => {
      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        approvalRequestId: 'approval-request-1',
        totalSpend: 100000,
      } as Plan;

      const mockEnvelope = {
        id: 'envelope-1',
        allocatedAmount: 200000,
      };

      planRepo.findById.mockResolvedValue(pendingPlan as Plan);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(
        mockEnvelope as any,
      );
      budgetService.reserveForPlan.mockResolvedValue({} as any);
      approvalService.approve.mockResolvedValue({} as any);
      planRepo.updateStatus.mockResolvedValue({
        ...pendingPlan,
        status: PlanStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: mockUserId,
      } as Plan);

      const result = await service.approve(
        mockPlanId,
        mockTenantId,
        mockUserId,
        'Comments',
      );

      expect(result.status).toBe(PlanStatus.APPROVED);
      expect(budgetService.reserveForPlan).toHaveBeenCalled();
      expect(approvalService.approve).toHaveBeenCalled();
    });

    it('should fail if plan is not in PENDING_APPROVAL status', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
      } as Plan);

      await expect(
        service.approve(mockPlanId, mockTenantId, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reject', () => {
    it('should successfully reject plan', async () => {
      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        approvalRequestId: 'approval-request-1',
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan as Plan);
      approvalService.reject.mockResolvedValue({} as any);
      planRepo.updateStatus.mockResolvedValue({
        ...pendingPlan,
        status: PlanStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedById: mockUserId,
        rejectionReason: 'Budget insufficient',
      } as Plan);

      const result = await service.reject(
        mockPlanId,
        mockTenantId,
        mockUserId,
        'Budget insufficient',
      );

      expect(result.status).toBe(PlanStatus.REJECTED);
      expect(approvalService.reject).toHaveBeenCalled();
    });
  });
});
