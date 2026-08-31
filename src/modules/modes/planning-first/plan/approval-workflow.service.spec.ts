import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { PlanRepository } from './plan.repository';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { Plan, PlanStatus } from '../../../../database/entities/plan.entity';
import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from '../../../../database/entities/plan-approval-history.entity';
import { ReviewPlanDto, ReviewDecision } from './dto/review-plan.dto';

describe('ApprovalWorkflowService', () => {
  let service: ApprovalWorkflowService;
  let planRepo: jest.Mocked<PlanRepository>;
  let approvalService: jest.Mocked<ApprovalService>;
  let budgetService: jest.Mocked<BudgetService>;
  let approvalHistoryRepo: jest.Mocked<Repository<PlanApprovalHistory>>;
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
        tactics: { CPP_ON_PCT: 10, DISPLAY_FEE: 5000 },
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
            // T-034b
            findByIdForUpdate: jest.fn(),
            updateStatusCas: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn(),
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
            // T-019b (§5.5): checkBudgetAvailability now resolves ON/OFF
            // envelopes independently and calls this per-envelope check
            // instead of getBudgetStatus.
            checkEnvelopeAvailability: jest.fn(),
            // T-056 adım 2 (docs/analysis/0009 §3.1/§3.2): the UNSPLIT
            // birleşik kural + SPLIT independent-envelope algorithm moved
            // OUT of this class into BudgetService — ApprovalWorkflowService
            // now only calls this ONE method and interprets its result. Its
            // own real behaviour is covered where it now lives
            // (budget.service.spec.ts's "checkPlanBudgetAvailability"
            // describe block); this mock only needs to stand in for the
            // CONTRACT so submitForApproval's orchestration (validationErrors,
            // gating reserveForPlan) is exercised.
            checkPlanBudgetAvailability: jest.fn(),
            // T-056 adım 3 (docs/analysis/0009 §3.2, §6 adım 3):
            // submitForApproval now calls this SINGLE method instead of two
            // separate `reserveForPlan` calls — the gate + ON→OFF ordering
            // moved into `BudgetService#reserveTypedForPlan` itself (real
            // behaviour covered in budget.service.spec.ts's
            // "reserveTypedForPlan" suite). This mock only needs to stand in
            // for the CONTRACT so submitForApproval's OWN orchestration
            // (which amounts it passes, in what shape) stays under test here.
            reserveTypedForPlan: jest.fn(),
            commitReservedForPlan: jest.fn(),
            commitAllReservedForPlan: jest.fn(),
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
          provide: AccessScopeService,
          useValue: {
            resolveScope: jest.fn(),
            isInScope: jest.fn().mockReturnValue(true),
            assertEntityInScope: jest.fn(),
            applyToQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ApprovalWorkflowService>(ApprovalWorkflowService);

    planRepo = module.get(PlanRepository);
    approvalService = module.get(ApprovalService);
    budgetService = module.get(BudgetService);
    approvalHistoryRepo = module.get(getRepositoryToken(PlanApprovalHistory));

    // T-019b / T-056 adım 2: safe default for tests that don't care about
    // the exact availability numbers (e.g. version-conflict tests, which
    // never reach the reservation writes) — submitForApproval
    // unconditionally calls checkPlanBudgetAvailability once, even for a
    // 0/0 spend plan.
    budgetService.checkPlanBudgetAvailability.mockResolvedValue({
      onInvoice: { available: 150000, requested: 0, sufficient: true },
      offInvoice: { available: 150000, requested: 0, sufficient: true },
      overallSufficient: true,
    });

    // T-034b — see plan.service.spec.ts's identical setup.
    queryRunnerManager = {
      count: jest.fn(),
      getRepository: jest.fn().mockReturnValue(approvalHistoryRepo),
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

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ⛔ `T-344` / `Z73 §1` — `submitForApproval` SUITE'İ BURADAN TAŞINDI,
  // SİLİNMEDİ. Rota öldü (`POST /plans/:id/submit-for-approval`), davranışı
  // canlı `POST /plans/:id/submit`'e geçti. Testlerin yeni evleri:
  //
  //   doğrulama + uyarı sözleşmesi  → `submission-checks.spec.ts` (saf)
  //   rota entegrasyonu (SubmissionResult, blocking/non-blocking)
  //                                 → `plan.service.spec.ts` › `submit`
  //   bütçe yeterliliği (UNSPLIT/SPLIT, ADR 0004 Karar 2)
  //                                 → `budget.service.spec.ts` ›
  //                                   `checkPlanBudgetAvailability`
  //
  // `DISIPLIN`: *"testler bir ŞARTNAMEDİR — kod silinse bile."*

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

      // T-332: `findByIdForUpdate` is a deliberately join-free projection
      // (approval-workflow.service.ts's `reviewPlan` docstring) — its
      // returned row NEVER carries `channel`. Mocking it with the same
      // relations-loaded `approvedPlan` object erases the one contract
      // difference between it and `findById`, which is exactly what let
      // T-331 (channelCode read off the locked/join-free row → always '')
      // ship with 1223/1223 unit green.
      const lockedPlan = {
        ...approvedPlan,
        channel: undefined,
      } as unknown as Plan;
      planRepo.findById.mockResolvedValue(approvedPlan);
      planRepo.findByIdForUpdate.mockResolvedValue(lockedPlan);
      planRepo.updateStatusCas.mockResolvedValue(1);
      approvalService.approve.mockResolvedValue({} as any);
      // T-029: commitAllBudgetForPlan now delegates to
      // commitAllReservedForPlan (RESERVE→COMMIT conversion, bucket-aware
      // cross-path fix — T-019/T-048), not the raw reserveForPlan.
      budgetService.commitAllReservedForPlan.mockResolvedValue([{} as any]);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(
        mockPlanId,
        mockTenantId,
        'reviewer-1',
        reviewDto,
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(PlanStatus.APPROVED);
      // T-034b: FOR UPDATE lock + status-CAS.
      expect(planRepo.findByIdForUpdate).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        queryRunnerManager,
      );
      expect(planRepo.updateStatusCas).toHaveBeenCalledWith(
        queryRunnerManager,
        mockPlanId,
        mockTenantId,
        PlanStatus.PENDING_APPROVAL,
        expect.objectContaining({
          status: PlanStatus.APPROVED,
          approvedAt: expect.any(Date),
          approvedById: 'reviewer-1',
        }),
      );
      expect(approvalService.approve).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      // T-332: channelCode MUST come from the pre-lock, relations-loaded
      // `findById` read ('NKA', mockPlan.channel.code) — NOT from the
      // join-free `findByIdForUpdate` row, which never carries `channel`
      // and would silently degrade to '' (T-331's production bug).
      expect(budgetService.commitAllReservedForPlan).toHaveBeenCalledWith(
        mockPlanId,
        expect.any(Number),
        'NKA',
        expect.any(String),
        expect.any(String),
        mockTenantId,
        'reviewer-1',
        queryRunnerManager,
        expect.anything(),
      );
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
      planRepo.findByIdForUpdate.mockResolvedValue(pendingPlan);
      planRepo.updateStatusCas.mockResolvedValue(1);
      approvalService.reject.mockResolvedValue({} as any);
      budgetService.releaseForPlan.mockResolvedValue(undefined);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(
        mockPlanId,
        mockTenantId,
        'reviewer-1',
        rejectDto,
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(PlanStatus.REJECTED);
      expect(budgetService.releaseForPlan).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        'reviewer-1',
        'REJECT',
        queryRunnerManager,
      );
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
      planRepo.findByIdForUpdate.mockResolvedValue(pendingPlan);
      planRepo.updateStatusCas.mockResolvedValue(1);
      budgetService.releaseForPlan.mockResolvedValue(undefined);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(
        mockPlanId,
        mockTenantId,
        'reviewer-1',
        requestChangesDto,
      );

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
        service.reviewPlan(
          mockPlanId,
          mockTenantId,
          'reviewer-1',
          requestChangesDto,
        ),
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
      planRepo.findByIdForUpdate.mockResolvedValue(pendingPlan);
      planRepo.updateStatusCas.mockResolvedValue(1);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.reviewPlan(
        mockPlanId,
        mockTenantId,
        'reviewer-1',
        escalateDto,
      );

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
      planRepo.findByIdForUpdate.mockResolvedValue(pendingPlan);
      planRepo.updateStatusCas.mockResolvedValue(1);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      await service.escalateToFinance(
        mockPlanId,
        mockTenantId,
        mockUserId,
        'High spend',
        'Comments',
      );

      expect(planRepo.findByIdForUpdate).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        queryRunnerManager,
      );
      expect(planRepo.updateStatusCas).toHaveBeenCalledWith(
        queryRunnerManager,
        mockPlanId,
        mockTenantId,
        PlanStatus.PENDING_APPROVAL,
        expect.objectContaining({
          status: PlanStatus.PENDING_FINANCE_REVIEW,
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
      planRepo.findByIdForUpdate.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
        version: 1,
      } as Plan);

      await expect(
        service.escalateToFinance(
          mockPlanId,
          mockTenantId,
          mockUserId,
          'Reason',
          'Comments',
        ),
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

      const result = await service.getApprovalQueue(
        'reviewer-1',
        mockTenantId,
        {},
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockPlanId);
      expect(result[0].status).toBe(PlanStatus.PENDING_APPROVAL);
      expect(result[0].daysInQueue).toBeGreaterThanOrEqual(0);
    });

    it('should filter by category if provided', async () => {
      planRepo.findAll.mockResolvedValue([]);

      await service.getApprovalQueue('reviewer-1', mockTenantId, {
        categoryId: 'category-1',
      });

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

      const result = await service.getPlanApprovalHistory(
        mockPlanId,
        mockTenantId,
      );

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
