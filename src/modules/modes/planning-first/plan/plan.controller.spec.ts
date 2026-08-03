import { Test, TestingModule } from '@nestjs/testing';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { SubmitForApprovalDto } from './dto/submit-for-approval.dto';
import { ReviewPlanDto, ReviewDecision } from './dto/review-plan.dto';
import { PlanStatus } from '../../../../database/entities/plan.entity';
import { UserRole } from '../../../../database/entities/user.entity';
import { RecalcMetricsInterceptor } from '../../../../common/interceptors/recalc-metrics.interceptor';
import { RecalcTelemetryContext } from '../../../../common/services/recalc-telemetry.service';

describe('PlanController', () => {
  let controller: PlanController;
  let planService: jest.Mocked<PlanService>;
  let approvalWorkflowService: jest.Mocked<ApprovalWorkflowService>;

  const mockTenantId = 'tenant-1';
  const mockUser = { id: 'user-1', role: UserRole.CATEGORY_MANAGER };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanController],
      providers: [
        {
          provide: PlanService,
          useValue: {
            findById: jest.fn(),
            findAll: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            submit: jest.fn(),
            approve: jest.fn(),
            reject: jest.fn(),
            delete: jest.fn(),
            checkBudget: jest.fn(),
            getAnalysis: jest.fn(),
            calculateKpis: jest.fn(),
            recalculatePlanWithKpiEngine: jest.fn(),
          },
        },
        {
          provide: ApprovalWorkflowService,
          useValue: {
            submitForApproval: jest.fn(),
            reviewPlan: jest.fn(),
            escalateToFinance: jest.fn(),
            getApprovalQueue: jest.fn(),
            getPlanApprovalHistory: jest.fn(),
          },
        },
        // T-046b: several endpoints carry `@UseInterceptors(RecalcMetricsInterceptor)`
        // — Nest resolves it as a controller-scoped provider even in this
        // unit-level TestingModule (no HTTP request actually goes through
        // it here, but DI still needs to construct it).
        RecalcMetricsInterceptor,
        RecalcTelemetryContext,
      ],
    }).compile();

    controller = module.get<PlanController>(PlanController);
    planService = module.get(PlanService);
    approvalWorkflowService = module.get(ApprovalWorkflowService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submitForApproval', () => {
    it('should call ApprovalWorkflowService.submitForApproval', async () => {
      const planId = 'plan-1';
      const dto: SubmitForApprovalDto = {
        submissionNotes: 'Test notes',
      };

      const mockResult = {
        success: true,
        planId,
        status: PlanStatus.PENDING_APPROVAL,
        budgetCheck: {
          onInvoice: { available: 100000, requested: 60000, sufficient: true },
          offInvoice: { available: 100000, requested: 40000, sufficient: true },
          overallSufficient: true,
        },
        approvalRequestId: 'approval-request-1',
      };

      approvalWorkflowService.submitForApproval.mockResolvedValue(mockResult);

      // T-056 adım 7: bu uç artık @Res({ passthrough: true }) alıyor
      // (Deprecation başlığı yazmak için) — response nesnesini elle mock'la.
      const mockRes = { setHeader: jest.fn() } as unknown as {
        setHeader: jest.Mock;
      };

      const result = await controller.submitForApproval(
        planId,
        dto,
        mockTenantId,
        mockUser,
        mockRes as never,
      );

      expect(approvalWorkflowService.submitForApproval).toHaveBeenCalledWith(
        planId,
        mockTenantId,
        mockUser.id,
        dto,
        { userId: mockUser.id, role: mockUser.role },
      );
      expect(result).toEqual(mockResult);
    });

    it('T-056 adım 7: sets the HTTP Deprecation response header', async () => {
      const planId = 'plan-1';
      const dto: SubmitForApprovalDto = { submissionNotes: 'Test notes' };
      approvalWorkflowService.submitForApproval.mockResolvedValue({
        success: true,
        planId,
        status: PlanStatus.PENDING_APPROVAL,
        budgetCheck: {
          onInvoice: { available: 100000, requested: 60000, sufficient: true },
          offInvoice: { available: 100000, requested: 40000, sufficient: true },
          overallSufficient: true,
        },
        approvalRequestId: 'approval-request-1',
      });
      const mockRes = { setHeader: jest.fn() } as unknown as {
        setHeader: jest.Mock;
      };

      await controller.submitForApproval(
        planId,
        dto,
        mockTenantId,
        mockUser,
        mockRes as never,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    });
  });

  describe('getApprovalQueue', () => {
    it('should call ApprovalWorkflowService.getApprovalQueue', async () => {
      const filters = { status: [PlanStatus.PENDING_APPROVAL] };
      const mockQueue = [
        {
          id: 'plan-1',
          planCode: 'PLAN-2026-Q1-001',
          planName: 'Test Plan',
          status: PlanStatus.PENDING_APPROVAL,
          daysInQueue: 2,
        },
      ];

      approvalWorkflowService.getApprovalQueue.mockResolvedValue(
        mockQueue as any,
      );

      const result = await controller.getApprovalQueue(
        filters,
        mockTenantId,
        mockUser,
      );

      expect(approvalWorkflowService.getApprovalQueue).toHaveBeenCalledWith(
        mockUser.id,
        mockTenantId,
        filters,
        mockUser.role,
      );
      expect(result).toEqual(mockQueue);
    });
  });

  describe('reviewPlan', () => {
    it('should call ApprovalWorkflowService.reviewPlan with APPROVE decision', async () => {
      const planId = 'plan-1';
      const dto: ReviewPlanDto = {
        decision: ReviewDecision.APPROVE,
        comments: 'Approved',
      };

      const mockResult = {
        success: true,
        planId,
        newStatus: PlanStatus.APPROVED,
        message: 'Plan approved successfully',
      };

      approvalWorkflowService.reviewPlan.mockResolvedValue(mockResult);

      const result = await controller.reviewPlan(
        planId,
        dto,
        mockTenantId,
        mockUser,
      );

      expect(approvalWorkflowService.reviewPlan).toHaveBeenCalledWith(
        planId,
        mockTenantId,
        mockUser.id,
        dto,
        mockUser.role,
      );
      expect(result).toEqual(mockResult);
    });

    it('should call ApprovalWorkflowService.reviewPlan with REJECT decision', async () => {
      const planId = 'plan-1';
      const dto: ReviewPlanDto = {
        decision: ReviewDecision.REJECT,
        rejectionReason: 'Budget insufficient',
        comments: 'Rejected',
      };

      const mockResult = {
        success: true,
        planId,
        newStatus: PlanStatus.REJECTED,
        message: 'Plan rejected',
      };

      approvalWorkflowService.reviewPlan.mockResolvedValue(mockResult);

      const result = await controller.reviewPlan(
        planId,
        dto,
        mockTenantId,
        mockUser,
      );

      expect(approvalWorkflowService.reviewPlan).toHaveBeenCalledWith(
        planId,
        mockTenantId,
        mockUser.id,
        dto,
        mockUser.role,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('escalateToFinance', () => {
    it('should call ApprovalWorkflowService.escalateToFinance', async () => {
      const planId = 'plan-1';
      const body = {
        reason: 'High spend amount',
        comments: 'Escalating to finance',
      };

      approvalWorkflowService.escalateToFinance.mockResolvedValue(undefined);

      await controller.escalateToFinance(planId, body, mockTenantId, mockUser);

      expect(approvalWorkflowService.escalateToFinance).toHaveBeenCalledWith(
        planId,
        mockTenantId,
        mockUser.id,
        body.reason,
        body.comments,
        { userId: mockUser.id, role: mockUser.role },
      );
    });
  });

  describe('getApprovalHistory', () => {
    it('should call ApprovalWorkflowService.getPlanApprovalHistory', async () => {
      const planId = 'plan-1';
      const mockHistory = [
        {
          id: 'history-1',
          planId,
          action: 'SUBMITTED',
          actionedById: 'user-1',
        },
      ];

      approvalWorkflowService.getPlanApprovalHistory.mockResolvedValue(
        mockHistory as any,
      );

      const result = await controller.getApprovalHistory(
        planId,
        mockTenantId,
        mockUser,
      );

      expect(
        approvalWorkflowService.getPlanApprovalHistory,
      ).toHaveBeenCalledWith(planId, mockTenantId, {
        userId: mockUser.id,
        role: mockUser.role,
      });
      expect(result).toEqual(mockHistory);
    });
  });
});
