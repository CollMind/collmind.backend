import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { PlanRepository } from './plan.repository';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { Plan, PlanStatus } from '../../../../database/entities/plan.entity';
import { PlanApprovalHistory, ApprovalHistoryAction } from '../../../../database/entities/plan-approval-history.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';
import { SubmitForApprovalDto } from './dto/submit-for-approval.dto';
import { ReviewPlanDto, ReviewDecision } from './dto/review-plan.dto';

describe('ApprovalWorkflowService', () => {
  let service: ApprovalWorkflowService;
  let planRepo: jest.Mocked<PlanRepository>;
  let approvalService: jest.Mocked<ApprovalService>;
  let budgetService: jest.Mocked<BudgetService>;
  let approvalHistoryRepo: jest.Mocked<Repository<PlanApprovalHistory>>;
  let tacticRepo: jest.Mocked<Repository<Tactic>>;

  const mockTenantId = 'tenant-1';
  const mockUserId = 'user-1';
  const mockPlanId = 'plan-1';
  const mockApprovalRequestId = 'approval-request-1';

  const mockPlan: Partial<Plan> = {
    id: mockPlanId,
    planCode: 'PLAN-2026-Q1-001',
    planName: 'Test Plan',
    status: PlanStatus.DRAFT,
    periodMonth: '2026-01',
    totalSpend: 100000,
    onInvoiceSpend: 60000,
    offInvoiceSpend: 40000,
    ragStatus: 'GREEN',
    planFus: [
      {
        id: 'plan-fu-1',
        fuId: 'fu-1',
        tactics: { 'CPP_ON_PCT': 10, 'DISPLAY_FEE': 5000 },
        planSkus: [
          {
            id: 'plan-sku-1',
            skuId: 'sku-1',
            plannedVolume: 1000,
            sku: { id: 'sku-1', unitPrice: 100 } as any,
          } as any,
        ],
        fu: { id: 'fu-1', code: 'FU-001', name: 'Test FU' } as any,
      } as any,
    ],
    channel: { id: 'channel-1', code: 'NKA', name: 'NKA Channel' } as any,
    category: { id: 'category-1', code: 'DAIRY', name: 'Dairy' } as any,
    cpl: { id: 'cpl-1', code: 'CPL-001', name: 'Test CPL' } as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalWorkflowService,
        {
          provide: PlanRepository,
          useValue: {
            findById: jest.fn(),
            updateStatus: jest.fn(),
            findAll: jest.fn(),
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
          provide: BudgetService,
          useValue: {
            findEnvelopeByDimensions: jest.fn(),
            getBudgetStatus: jest.fn(),
            reserveForPlan: jest.fn(),
            releaseForPlan: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlanApprovalHistory),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
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

    service = module.get<ApprovalWorkflowService>(ApprovalWorkflowService);
    planRepo = module.get(PlanRepository);
    approvalService = module.get(ApprovalService);
    budgetService = module.get(BudgetService);
    approvalHistoryRepo = module.get(getRepositoryToken(PlanApprovalHistory));
    tacticRepo = module.get(getRepositoryToken(Tactic));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submitForApproval', () => {
    const submitDto: SubmitForApprovalDto = {
      submissionNotes: 'Test submission notes',
    };

    it('should successfully submit plan for approval', async () => {
      const mockTactics: Tactic[] = [
        {
          id: 'tactic-1',
          code: 'CPP_ON_PCT',
          name: 'CPP On Invoice %',
          spendType: 'ON_INVOICE',
          tacticType: 'DISCOUNT' as any,
          isActive: true,
          mechanics: [],
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Tactic,
        {
          id: 'tactic-2',
          code: 'DISPLAY_FEE',
          name: 'Display Fee',
          spendType: 'OFF_INVOICE',
          tacticType: 'LUMP_SUM' as any,
          isActive: true,
          mechanics: [],
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Tactic,
      ];

      const mockEnvelope = {
        id: 'envelope-1',
        code: 'NKA/2026-01',
        allocatedAmount: 200000,
      };

      const mockBudgetStatus = {
        totalAllocation: 200000,
        available: 150000,
        reserved: 30000,
        consumed: 20000,
        planned: 0,
        status: 'GREEN' as const,
      };

      const mockApprovalRequest = {
        id: mockApprovalRequestId,
        requestType: ApprovalRequestType.PLAN,
      };

      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      tacticRepo.find.mockResolvedValue(mockTactics);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(mockEnvelope as any);
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);
      approvalService.createRequest.mockResolvedValue(mockApprovalRequest as any);
      planRepo.updateStatus.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        approvalRequestId: mockApprovalRequestId,
      } as Plan);
      budgetService.reserveForPlan.mockResolvedValue({} as any);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.submitForApproval(mockPlanId, mockTenantId, mockUserId, submitDto);

      expect(result.success).toBe(true);
      expect(result.status).toBe(PlanStatus.PENDING_APPROVAL);
      expect(planRepo.updateStatus).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        PlanStatus.PENDING_APPROVAL,
        expect.objectContaining({
          submissionNotes: submitDto.submissionNotes,
          submittedById: mockUserId,
        }),
      );
      expect(approvalService.createRequest).toHaveBeenCalled();
      expect(budgetService.reserveForPlan).toHaveBeenCalledTimes(2); // On and Off Invoice
    });

    it('should fail if plan is not in DRAFT status', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan);

      await expect(
        service.submitForApproval(mockPlanId, mockTenantId, mockUserId, submitDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fail if plan has no FUs', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        planFus: [],
      } as Plan);
      tacticRepo.find.mockResolvedValue([]);

      const result = await service.submitForApproval(mockPlanId, mockTenantId, mockUserId, submitDto);

      expect(result.success).toBe(false);
      expect(result.validationErrors).toContain('Plan must have at least one FU');
    });

    it('should fail if FU has no tactics', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        planFus: [
          {
            ...mockPlan.planFus![0],
            tactics: {},
          },
        ],
      } as Plan);

      tacticRepo.find.mockResolvedValue([]);

      const result = await service.submitForApproval(mockPlanId, mockTenantId, mockUserId, submitDto);

      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
    });

    it('should fail if budget is insufficient', async () => {
      const mockTactics: Tactic[] = [
        {
          id: 'tactic-1',
          code: 'CPP_ON_PCT',
          name: 'CPP On Invoice %',
          spendType: 'ON_INVOICE',
          tacticType: 'DISCOUNT' as any,
          isActive: true,
          mechanics: [],
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Tactic,
      ];

      const mockEnvelope = {
        id: 'envelope-1',
        allocatedAmount: 50000,
      };

      const mockBudgetStatus = {
        totalAllocation: 50000,
        available: 10000,
        reserved: 30000,
        consumed: 10000,
        planned: 0,
        status: 'RED' as const,
      };

      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      tacticRepo.find.mockResolvedValue(mockTactics);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(mockEnvelope as any);
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);

      const result = await service.submitForApproval(mockPlanId, mockTenantId, mockUserId, submitDto);

      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
      expect(result.validationErrors?.some(err => err.includes('Insufficient budget'))).toBe(true);
    });

    it('should add warning for RED RAG status', async () => {
      const mockTactics: Tactic[] = [
        {
          id: 'tactic-1',
          code: 'CPP_ON_PCT',
          name: 'CPP On Invoice %',
          spendType: 'ON_INVOICE',
          tacticType: 'DISCOUNT' as any,
          isActive: true,
          mechanics: [],
          tenantId: mockTenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Tactic,
      ];

      const mockEnvelope = {
        id: 'envelope-1',
        allocatedAmount: 200000,
      };

      const mockBudgetStatus = {
        totalAllocation: 200000,
        available: 150000,
        reserved: 30000,
        consumed: 20000,
        planned: 0,
        status: 'GREEN' as const,
      };

      const mockApprovalRequest = {
        id: mockApprovalRequestId,
        requestType: ApprovalRequestType.PLAN,
      };

      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        ragStatus: 'RED',
      } as Plan);
      tacticRepo.find.mockResolvedValue(mockTactics);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(mockEnvelope as any);
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);
      approvalService.createRequest.mockResolvedValue(mockApprovalRequest as any);
      planRepo.updateStatus.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan);
      budgetService.reserveForPlan.mockResolvedValue({} as any);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.submitForApproval(mockPlanId, mockTenantId, mockUserId, submitDto);

      expect(result.success).toBe(true);
      expect(result.budgetCheck.warnings).toBeDefined();
      expect(result.budgetCheck.warnings?.some(w => w.includes('RED RAG status'))).toBe(true);
    });
  });

  describe('reviewPlan', () => {
    const reviewDto: ReviewPlanDto = {
      decision: ReviewDecision.APPROVE,
      comments: 'Approved',
    };

    it('should successfully approve plan', async () => {
      const approvedPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        approvalRequestId: mockApprovalRequestId,
        onInvoiceSpend: 60000,
        offInvoiceSpend: 40000,
      } as Plan;

      planRepo.findById.mockResolvedValue(approvedPlan);
      planRepo.updateStatus.mockResolvedValue({
        ...approvedPlan,
        status: PlanStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: 'reviewer-1',
      } as Plan);
      approvalService.approve.mockResolvedValue({} as any);
      // commitBudgetForPlan uses reserveForPlan internally, so we mock that
      budgetService.reserveForPlan.mockResolvedValue({} as any);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', reviewDto);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(PlanStatus.APPROVED);
      expect(planRepo.updateStatus).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        PlanStatus.APPROVED,
        expect.objectContaining({
          approvedAt: expect.any(Date),
          approvedById: 'reviewer-1',
        }),
      );
      expect(approvalService.approve).toHaveBeenCalled();
    });

    it('should successfully reject plan', async () => {
      const rejectDto: ReviewPlanDto = {
        decision: ReviewDecision.REJECT,
        rejectionReason: 'Budget insufficient',
        comments: 'Rejected due to budget constraints',
      };

      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        approvalRequestId: mockApprovalRequestId,
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);
      planRepo.updateStatus.mockResolvedValue({
        ...pendingPlan,
        status: PlanStatus.REJECTED,
      } as Plan);
      approvalService.reject.mockResolvedValue({} as any);
      budgetService.releaseForPlan.mockResolvedValue(undefined);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', rejectDto);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(PlanStatus.REJECTED);
      expect(budgetService.releaseForPlan).toHaveBeenCalledWith(mockPlanId, mockTenantId);
      expect(approvalService.reject).toHaveBeenCalled();
    });

    it('should fail to reject without reason', async () => {
      const rejectDto: ReviewPlanDto = {
        decision: ReviewDecision.REJECT,
        comments: 'Rejected',
      };

      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);

      await expect(
        service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', rejectDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully request changes', async () => {
      const requestChangesDto: ReviewPlanDto = {
        decision: ReviewDecision.REQUEST_CHANGES,
        comments: 'Please update volume projections',
        specificChanges: ['Update SKU volumes', 'Recalculate ROI'],
      };

      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        submittedById: 'planner-1',
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);
      planRepo.updateStatus.mockResolvedValue({
        ...pendingPlan,
        status: PlanStatus.DRAFT,
      } as Plan);
      budgetService.releaseForPlan.mockResolvedValue(undefined);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', requestChangesDto);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(PlanStatus.DRAFT);
      expect(budgetService.releaseForPlan).toHaveBeenCalled();
    });

    it('should fail to request changes without comments', async () => {
      const requestChangesDto: ReviewPlanDto = {
        decision: ReviewDecision.REQUEST_CHANGES,
      };

      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);

      await expect(
        service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', requestChangesDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully escalate to finance', async () => {
      const escalateDto: ReviewPlanDto = {
        decision: ReviewDecision.ESCALATE,
        escalationReason: 'High spend amount requires finance review',
        comments: 'Escalating due to budget concerns',
      };

      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        submittedById: 'planner-1',
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);
      planRepo.updateStatus.mockResolvedValue({
        ...pendingPlan,
        status: PlanStatus.PENDING_FINANCE_REVIEW,
        pendingFinanceReview: true,
      } as Plan);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', escalateDto);

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(PlanStatus.PENDING_FINANCE_REVIEW);
    });

    it('should fail to escalate without reason', async () => {
      const escalateDto: ReviewPlanDto = {
        decision: ReviewDecision.ESCALATE,
        comments: 'Escalating',
      };

      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);

      await expect(
        service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', escalateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prevent self-approval', async () => {
      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        submittedById: mockUserId,
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);

      await expect(
        service.reviewPlan(mockPlanId, mockTenantId, mockUserId, reviewDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should fail if plan is not in reviewable status', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
      } as Plan);

      await expect(
        service.reviewPlan(mockPlanId, mockTenantId, 'reviewer-1', reviewDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('escalateToFinance', () => {
    it('should successfully escalate plan to finance', async () => {
      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan;

      planRepo.findById.mockResolvedValue(pendingPlan);
      planRepo.updateStatus.mockResolvedValue({
        ...pendingPlan,
        status: PlanStatus.PENDING_FINANCE_REVIEW,
        pendingFinanceReview: true,
        escalationReason: 'High spend',
        escalatedAt: new Date(),
        escalatedById: mockUserId,
      } as Plan);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      await service.escalateToFinance(mockPlanId, mockTenantId, mockUserId, 'High spend', 'Comments');

      expect(planRepo.updateStatus).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        PlanStatus.PENDING_FINANCE_REVIEW,
        expect.objectContaining({
          pendingFinanceReview: true,
          escalationReason: 'High spend',
        }),
      );
    });

    it('should fail if plan is not in PENDING_APPROVAL status', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
      } as Plan);

      await expect(
        service.escalateToFinance(mockPlanId, mockTenantId, mockUserId, 'Reason', 'Comments'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getApprovalQueue', () => {
    it('should return pending plans for approval queue', async () => {
      const pendingPlan = {
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
        submittedAt: new Date('2026-01-01'),
        submittedBy: {
          id: 'planner-1',
          fullName: 'Test Planner',
          email: 'planner@test.com',
        } as any,
        pendingFinanceReview: false,
      } as Plan;

      // Mock findAll to return the plan only for PENDING_APPROVAL status
      // Return empty array for PENDING_FINANCE_REVIEW to avoid duplicates
      planRepo.findAll.mockImplementation((tenantId: string, filters?: any) => {
        if (filters?.status === PlanStatus.PENDING_APPROVAL) {
          return Promise.resolve([pendingPlan]);
        }
        return Promise.resolve([]);
      });

      const result = await service.getApprovalQueue('reviewer-1', mockTenantId, {});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockPlanId);
      expect(result[0].status).toBe(PlanStatus.PENDING_APPROVAL);
      expect(result[0].daysInQueue).toBeGreaterThanOrEqual(0);
    });

    it('should filter by category if provided', async () => {
      planRepo.findAll.mockResolvedValue([]);

      await service.getApprovalQueue('reviewer-1', mockTenantId, { categoryId: 'category-1' });

      // getApprovalQueue calls findAll multiple times for different statuses
      expect(planRepo.findAll).toHaveBeenCalled();
    });
  });

  describe('getPlanApprovalHistory', () => {
    it('should return approval history for a plan', async () => {
      const mockHistory: PlanApprovalHistory[] = [
        {
          id: 'history-1',
          planId: mockPlanId,
          action: ApprovalHistoryAction.SUBMITTED,
          actionedById: mockUserId,
          comments: 'Submitted for approval',
        } as PlanApprovalHistory,
        {
          id: 'history-2',
          planId: mockPlanId,
          action: ApprovalHistoryAction.APPROVED,
          actionedById: 'reviewer-1',
          comments: 'Approved',
        } as PlanApprovalHistory,
      ];

      approvalHistoryRepo.find.mockResolvedValue(mockHistory);

      const result = await service.getPlanApprovalHistory(mockPlanId, mockTenantId);

      expect(result).toHaveLength(2);
      expect(result[0].action).toBe(ApprovalHistoryAction.SUBMITTED);
      expect(result[1].action).toBe(ApprovalHistoryAction.APPROVED);
      expect(approvalHistoryRepo.find).toHaveBeenCalledWith({
        where: { planId: mockPlanId, tenantId: mockTenantId },
        relations: ['actionedBy'],
        order: { createdAt: 'ASC' },
      });
    });
  });
});
