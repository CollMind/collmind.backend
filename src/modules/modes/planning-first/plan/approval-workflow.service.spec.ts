import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApprovalWorkflowService } from './approval-workflow.service';
import { PlanRepository } from './plan.repository';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { KpiEngineService } from '../../../shared/kpi-engine/kpi-engine.service';
import { Kpi } from '../../../../database/entities/kpi.entity';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { SpendCalculationService } from '../../../shared/spend-calculation/spend-calculation.service';
import { Plan, PlanStatus } from '../../../../database/entities/plan.entity';
import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from '../../../../database/entities/plan-approval-history.entity';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';
import { SubmitForApprovalDto } from './dto/submit-for-approval.dto';
import { UtilizationStatus } from '../../../shared/finance-reporting/dto/budget-utilization.dto';
import { ReviewPlanDto, ReviewDecision } from './dto/review-plan.dto';

describe('ApprovalWorkflowService', () => {
  let service: ApprovalWorkflowService;
  let planRepo: jest.Mocked<PlanRepository>;
  let approvalService: jest.Mocked<ApprovalService>;
  let budgetService: jest.Mocked<BudgetService>;
  let spendCalc: jest.Mocked<SpendCalculationService>;
  let approvalHistoryRepo: jest.Mocked<Repository<PlanApprovalHistory>>;
  let kpiEngine: { getKpiConfig: jest.Mock };
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
        // T-017: SpendCalculationService is now the authoritative source for
        // on/off-invoice breakdown (replaces tacticRepo + string-hack).
        {
          provide: SpendCalculationService,
          useValue: {
            calculateAllSpendsForFU: jest.fn(),
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
        {
          // `T-343`/`Z71 §1`: Target-ROI hedefi konfigürasyondan okunuyor.
          // ⛔ Mock `null` DÖNER: eşik okunamadığında below-target yolu
          // hiçbir plan işaretlememeli (`§2.5` — uydurulmuş hedefe yargı
          // yok). Bu, testlerin mevcut beklentilerini DEĞİŞTİRMEZ ve
          // varsayılan davranışın "sessiz eşik" OLMADIĞINI de pinler.
          provide: KpiEngineService,
          useValue: { getKpiConfig: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<ApprovalWorkflowService>(ApprovalWorkflowService);

    kpiEngine = module.get(KpiEngineService);
    planRepo = module.get(PlanRepository);
    approvalService = module.get(ApprovalService);
    budgetService = module.get(BudgetService);
    spendCalc = module.get(SpendCalculationService);
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

  describe('submitForApproval', () => {
    // T-034b (code-review fix): K5 exception — submitForApproval() also
    // validates plans.version now (mirrors PlanService#submit).
    const submitDto: SubmitForApprovalDto = {
      submissionNotes: 'Test submission notes',
      version: 1,
    };

    it('should successfully submit plan for approval', async () => {
      // T-017: SpendCalc now provides on/off breakdown (mechanic.category driven)
      // CPP_ON_PCT → ON_INVOICE_DISCOUNT → onInvoice; DISPLAY_FEE → LUMPSUM_SPEND → offInvoice
      const mockFuSpendBreakdown = {
        fuId: 'plan-fu-1',
        skuBreakdowns: [],
        aggregatedBase: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedPlanned: {
          ltaOnInvoice: 200,
          ltaOffInvoice: 100,
          promoOnInvoice: { CPP_ON_PCT: 9800 },
          promoOffInvoice: { DISPLAY_FEE: 5000 },
          totalPromoOnInvoice: 9800,
          totalPromoOffInvoice: 5000,
          totalOnInvoice: 10000, // on-invoice total
          totalOffInvoice: 5100, // off-invoice total
          totalSpend: 15100,
        },
        aggregatedIncremental: {
          onInvoice: 10000,
          offInvoice: 5100,
          total: 15100,
        },
      };

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
        status: UtilizationStatus.GREEN,
      };

      const mockApprovalRequest = {
        id: mockApprovalRequestId,
        requestType: ApprovalRequestType.PLAN,
      };

      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      planRepo.findByIdForUpdate.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
        version: 1,
      } as Plan);
      spendCalc.calculateAllSpendsForFU.mockResolvedValue(
        mockFuSpendBreakdown as any,
      );
      budgetService.findEnvelopeByDimensions.mockResolvedValue(
        mockEnvelope as any,
      );
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);
      // T-019b: findEnvelopeByDimensions resolves the SAME mockEnvelope for
      // both ON_INVOICE and OFF_INVOICE (unsplit/legacy fixture) —
      // checkBudgetAvailability's combined-pool branch calls
      // checkEnvelopeAvailability ONCE with (on+off).
      budgetService.checkEnvelopeAvailability.mockImplementation(
        (_tenantId: string, _envelopeId: string, amount: number) =>
          Promise.resolve({
            available: mockBudgetStatus.available,
            sufficient: amount <= mockBudgetStatus.available,
          }),
      );
      approvalService.createRequest.mockResolvedValue(
        mockApprovalRequest as any,
      );
      planRepo.updateStatusCas.mockResolvedValue(1);
      budgetService.reserveTypedForPlan.mockResolvedValue([
        {} as any,
        {} as any,
      ]);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.submitForApproval(
        mockPlanId,
        mockTenantId,
        mockUserId,
        submitDto,
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe(PlanStatus.PENDING_APPROVAL);
      // T-034b: FOR UPDATE lock taken before the transition.
      expect(planRepo.findByIdForUpdate).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        queryRunnerManager,
      );
      expect(planRepo.updateStatusCas).toHaveBeenCalledWith(
        queryRunnerManager,
        mockPlanId,
        mockTenantId,
        PlanStatus.DRAFT,
        expect.objectContaining({
          status: PlanStatus.PENDING_APPROVAL,
          submissionNotes: submitDto.submissionNotes,
          submittedById: mockUserId,
          // T-017: on/off breakdown now comes from SpendCalc
          onInvoiceSpend: 10000,
          offInvoiceSpend: 5100,
        }),
      );
      expect(approvalService.createRequest).toHaveBeenCalled();
      // T-056 adım 3: single call carrying BOTH amounts, replacing the old
      // two-call (On and Off Invoice) orchestration.
      expect(budgetService.reserveTypedForPlan).toHaveBeenCalledTimes(1);
      expect(budgetService.reserveTypedForPlan).toHaveBeenCalledWith(
        mockPlanId,
        { onInvoice: 10000, offInvoice: 5100 },
        expect.any(String),
        expect.any(String),
        'TRY',
        mockTenantId,
        mockUserId,
        queryRunnerManager,
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should fail if plan is not in DRAFT status', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan);

      await expect(
        service.submitForApproval(
          mockPlanId,
          mockTenantId,
          mockUserId,
          submitDto,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // T-034b (code-review fix): K5 exception must hold on BOTH canonical
    // submit paths, not just PlanService#submit.
    it('rejects with 409 MISSING_VERSION when version is omitted', async () => {
      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      planRepo.findByIdForUpdate.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
        version: 1,
      } as Plan);
      spendCalc.calculateAllSpendsForFU.mockResolvedValue({
        fuId: 'plan-fu-1',
        skuBreakdowns: [],
        aggregatedBase: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedPlanned: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedIncremental: { onInvoice: 0, offInvoice: 0, total: 0 },
      } as any);
      budgetService.findEnvelopeByDimensions.mockResolvedValue({
        id: 'envelope-1',
      } as any);
      budgetService.getBudgetStatus.mockResolvedValue({
        totalAllocation: 200000,
        available: 150000,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: 'GREEN' as any,
      });

      await expect(
        service.submitForApproval(mockPlanId, mockTenantId, mockUserId, {
          submissionNotes: 'no version',
        }),
      ).rejects.toThrow('version');
      expect(planRepo.updateStatusCas).not.toHaveBeenCalled();
      expect(approvalService.createRequest).not.toHaveBeenCalled();
      expect(budgetService.reserveTypedForPlan).not.toHaveBeenCalled();
    });

    it('rejects with 409 STALE_VERSION when the client version does not match the locked row', async () => {
      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      planRepo.findByIdForUpdate.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
        version: 5,
      } as Plan);
      spendCalc.calculateAllSpendsForFU.mockResolvedValue({
        fuId: 'plan-fu-1',
        skuBreakdowns: [],
        aggregatedBase: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedPlanned: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedIncremental: { onInvoice: 0, offInvoice: 0, total: 0 },
      } as any);
      budgetService.findEnvelopeByDimensions.mockResolvedValue({
        id: 'envelope-1',
      } as any);
      budgetService.getBudgetStatus.mockResolvedValue({
        totalAllocation: 200000,
        available: 150000,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: 'GREEN' as any,
      });

      await expect(
        service.submitForApproval(
          mockPlanId,
          mockTenantId,
          mockUserId,
          submitDto, // version: 1, but the locked row is at version 5
        ),
      ).rejects.toThrow('modified by another user');
      expect(planRepo.updateStatusCas).not.toHaveBeenCalled();
      expect(approvalService.createRequest).not.toHaveBeenCalled();
      expect(budgetService.reserveTypedForPlan).not.toHaveBeenCalled();
    });

    it('should fail if plan has no FUs', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        planFus: [],
      } as Plan);
      // No FUs → calculateSpendBreakdown iterates empty array; SpendCalc not called.

      const result = await service.submitForApproval(
        mockPlanId,
        mockTenantId,
        mockUserId,
        submitDto,
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toContain(
        'Plan must have at least one FU',
      );
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

      // Validation fails before SpendCalc is called (empty tactics check)

      const result = await service.submitForApproval(
        mockPlanId,
        mockTenantId,
        mockUserId,
        submitDto,
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
    });

    /**
     * S-3: validation must use planMechanicValues (SpendCalc's source) not just tactics JSONB.
     * FU with planMechanicValues having an enteredValue but no tactics JSONB is valid.
     */
    it('should pass validation for FU with planMechanicValues but no tactics JSONB (S-3)', async () => {
      const mockFuSpendBreakdown = {
        fuId: 'plan-fu-1',
        skuBreakdowns: [],
        aggregatedBase: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedPlanned: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          promoOnInvoice: { CPP_ON: 5000 },
          promoOffInvoice: {},
          totalPromoOnInvoice: 5000,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 5000,
          totalOffInvoice: 0,
          totalSpend: 5000,
        },
        aggregatedIncremental: { onInvoice: 5000, offInvoice: 0, total: 5000 },
      };

      const mockEnvelope = { id: 'env-1', allocatedAmount: 200000 };
      const mockBudgetStatus = {
        totalAllocation: 200000,
        available: 150000,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: 'GREEN' as any,
      };
      const mockApprovalRequest = {
        id: mockApprovalRequestId,
        requestType: ApprovalRequestType.PLAN,
      };

      // FU has planMechanicValues with an entry (semantic column) but NO tactics JSONB
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        planFus: [
          {
            ...mockPlan.planFus![0],
            tactics: {}, // empty tactics JSONB
            planMechanicValues: [{ enteredRatePct: 10, mechanicId: 'mech-1' }],
          },
        ],
      } as Plan);

      planRepo.findByIdForUpdate.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
        version: 1,
      } as Plan);
      spendCalc.calculateAllSpendsForFU.mockResolvedValue(
        mockFuSpendBreakdown as any,
      );
      budgetService.findEnvelopeByDimensions.mockResolvedValue(
        mockEnvelope as any,
      );
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);
      // T-019b: findEnvelopeByDimensions resolves the SAME mockEnvelope for
      // both ON_INVOICE and OFF_INVOICE (unsplit/legacy fixture) —
      // checkBudgetAvailability's combined-pool branch calls
      // checkEnvelopeAvailability ONCE with (on+off).
      budgetService.checkEnvelopeAvailability.mockImplementation(
        (_tenantId: string, _envelopeId: string, amount: number) =>
          Promise.resolve({
            available: mockBudgetStatus.available,
            sufficient: amount <= mockBudgetStatus.available,
          }),
      );
      approvalService.createRequest.mockResolvedValue(
        mockApprovalRequest as any,
      );
      planRepo.updateStatusCas.mockResolvedValue(1);
      budgetService.reserveTypedForPlan.mockResolvedValue([{} as any]);
      approvalHistoryRepo.create.mockReturnValue({} as any);
      approvalHistoryRepo.save.mockResolvedValue({} as any);

      const result = await service.submitForApproval(
        mockPlanId,
        mockTenantId,
        mockUserId,
        submitDto,
      );

      // Should succeed — planMechanicValues provides the mechanic data for SpendCalc
      expect(result.success).toBe(true);
    });

    it('should fail validation for FU with neither planMechanicValues nor tactics (S-3)', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        planFus: [
          {
            ...mockPlan.planFus![0],
            tactics: {}, // no tactics
            planMechanicValues: [], // no mechanic values either
          },
        ],
      } as Plan);

      const result = await service.submitForApproval(
        mockPlanId,
        mockTenantId,
        mockUserId,
        submitDto,
      );

      expect(result.success).toBe(false);
      expect(
        result.validationErrors?.some(
          (err) =>
            err.includes('no mechanic values') || err.includes('no tactics'),
        ),
      ).toBe(true);
    });

    it('should fail if budget is insufficient', async () => {
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
        status: UtilizationStatus.RED,
      };

      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      spendCalc.calculateAllSpendsForFU.mockResolvedValue({
        fuId: 'plan-fu-1',
        skuBreakdowns: [],
        aggregatedBase: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedPlanned: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 30000,
          totalPromoOffInvoice: 10000,
          totalOnInvoice: 30000,
          totalOffInvoice: 10000,
          totalSpend: 40000,
        },
        aggregatedIncremental: {
          onInvoice: 30000,
          offInvoice: 10000,
          total: 40000,
        },
      } as any);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(
        mockEnvelope as any,
      );
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);
      // T-056 adım 2: the UNSPLIT-combined-pool arithmetic (on=30000,
      // off=10000, one shared 10000-available envelope → both individually
      // AND combined insufficient) now lives in and is verified against
      // REAL code in budget.service.spec.ts's "checkPlanBudgetAvailability"
      // suite. This mock reproduces exactly what that algorithm returns for
      // these inputs (unchanged numbers) so submitForApproval's OWN
      // orchestration (validationErrors, no-reserve-on-insufficient) stays
      // under test here.
      budgetService.checkPlanBudgetAvailability.mockResolvedValue({
        onInvoice: {
          available: mockBudgetStatus.available,
          requested: 30000,
          sufficient: false,
        },
        offInvoice: {
          available: mockBudgetStatus.available,
          requested: 10000,
          sufficient: true,
        },
        overallSufficient: false,
      });

      const result = await service.submitForApproval(
        mockPlanId,
        mockTenantId,
        mockUserId,
        submitDto,
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
      expect(
        result.validationErrors?.some((err) =>
          err.includes('Insufficient budget'),
        ),
      ).toBe(true);
    });

    // T-019 Faz 1 / ADR 0004 Karar 2 (docs/analysis/0008 §7 T3): atomic
    // block — even when EACH type individually fits the shared UNSPLIT
    // envelope (on=60<=100, off=60<=100), the COMBINED request (120) must
    // be rejected entirely, and reserveTypedForPlan (T-056 adım 3: the
    // single engine call) may not fire at all (no partial reservation).
    // This is the exact regression §5.5's "birleşik
    // kural" (onEnv.id === offEnv.id → on+off <= available) protects
    // against — removing it would let two individually-fitting amounts
    // both pass and together overshoot.
    it('ADR 0004 Karar 2: rejects atomically when on+off together exceed the shared UNSPLIT envelope, even though EACH individually fits (T3)', async () => {
      const mockEnvelope = {
        id: 'envelope-1',
        allocatedAmount: 100,
      };

      const mockBudgetStatus = {
        totalAllocation: 100,
        available: 100,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: UtilizationStatus.GREEN,
      };

      planRepo.findById.mockResolvedValue(mockPlan as Plan);
      spendCalc.calculateAllSpendsForFU.mockResolvedValue({
        fuId: 'plan-fu-1',
        skuBreakdowns: [],
        aggregatedBase: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        aggregatedPlanned: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 60,
          totalPromoOffInvoice: 60,
          totalOnInvoice: 60,
          totalOffInvoice: 60,
          totalSpend: 120,
        },
        aggregatedIncremental: {
          onInvoice: 60,
          offInvoice: 60,
          total: 120,
        },
      } as any);
      budgetService.findEnvelopeByDimensions.mockResolvedValue(
        mockEnvelope as any,
      );
      budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);
      // T-056 adım 2: the "birleşik kural" arithmetic this test's name
      // refers to (on=60, off=60, individually fit a shared 100-available
      // envelope but TOGETHER (120) do not) now lives in — and is verified
      // against REAL code in — budget.service.spec.ts's
      // "checkPlanBudgetAvailability" suite (same T3 case, ported
      // verbatim). This mock reproduces exactly what that algorithm returns
      // for these inputs so submitForApproval's OWN orchestration (atomic
      // gate BEFORE the reserveTypedForPlan call) stays under test here.
      budgetService.checkPlanBudgetAvailability.mockResolvedValue({
        onInvoice: { available: 100, requested: 60, sufficient: true },
        offInvoice: { available: 100, requested: 60, sufficient: true },
        overallSufficient: false,
      });

      const result = await service.submitForApproval(
        mockPlanId,
        mockTenantId,
        mockUserId,
        submitDto,
      );

      expect(result.success).toBe(false);
      expect(result.budgetCheck?.onInvoice.sufficient).toBe(true); // 60 <= 100
      expect(result.budgetCheck?.offInvoice.sufficient).toBe(true); // 60 <= 100
      expect(result.budgetCheck?.overallSufficient).toBe(false); // 120 > 100
      expect(
        result.validationErrors?.some((err) =>
          err.includes('Insufficient budget'),
        ),
      ).toBe(true);
      // MUTATION-GUARDING assertion: no reservation write of ANY kind
      // happened — the atomic block must fire strictly BEFORE the
      // reserveTypedForPlan call (queryRunner transaction never opened).
      expect(budgetService.reserveTypedForPlan).not.toHaveBeenCalled();
    });

    /**
     * `Z70 §1` + `Z71 §1` — UYARI KATMANI KADRAN DİLİNE ÇEVRİLDİ.
     *
     * ⛔ Bu blok eskiden **tek** bir testti (*"should add warning for RED RAG
     * status"*) çünkü **tek bir kötü-durum** vardı. Kadran (`Z66 §2`) o tek
     * durumu üçe böldü ve `T-342`'nin ilk turu uyarı katmanını **hiç
     * güncellemedi** — ölçülmüş sonuç (geçiş matrisi, `green=20 · amber=10`):
     *
     * ```
     * iTO > 0 dilimi     ÖNCE     SONRA    uyarı
     * iGP ≤ 0            RED   →  AMBER    KAYBOLUYORDU
     * 0 < ROI < 10       RED   →  GREEN    KAYBOLUYORDU  ⛔ ve yerine "İYİ"
     * 10 ≤ ROI < 20      AMBER →  GREEN    KAYBOLUYORDU  ⛔ ve yerine "İYİ"
     * ```
     *
     * ⚠️ İkinci ve üçüncü satır bir sessizleşme DEĞİL, **karşı yönde
     * güvence**ydi — `DISIPLIN`: *"beklenen yöne yanılan hata, ters yöne
     * yanılandan tehlikelidir."*
     */
    describe('RAG + Target-ROI uyarıları (Z70 §1 · Z71 §1)', () => {
      /**
       * ⛔ `T-343` review `B1` — **MOCK ÜRETİMİN ŞEKLİNE BAĞLANDI.**
       * Eşik parametresi eskiden `number | null`'dı; üretimde `pg` sürücüsü
       * `numeric` kolonu **DİZGE** döndürüyor (`"20.0000"`, canlı DB'de
       * ölçüldü) çünkü `Kpi` entity'sinde transformer YOK. Mock sayı
       * verdiği için testler **doğru olan mock'u** ölçüyordu ve üretimdeki
       * `toFixed` çökmesini göremiyordu (`§2.7`: *"bir mock, taklit ettiği
       * şeyin TİPİNE bağlanmalı"*). Artık iki şekil de veriliyor.
       */
      async function submitWithPlanState(
        planOverrides: Partial<Plan>,
        targetRoiThreshold: number | string | null = null,
      ) {
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
          status: UtilizationStatus.GREEN,
        };

        const mockApprovalRequest = {
          id: mockApprovalRequestId,
          requestType: ApprovalRequestType.PLAN,
        };

        planRepo.findById.mockResolvedValue({
          ...mockPlan,
          ...planOverrides,
        } as Plan);
        spendCalc.calculateAllSpendsForFU.mockResolvedValue({
          fuId: 'plan-fu-1',
          skuBreakdowns: [],
          aggregatedBase: {
            ltaOnInvoice: 0,
            ltaOffInvoice: 0,
            totalOnInvoice: 0,
            totalOffInvoice: 0,
            totalSpend: 0,
          },
          aggregatedPlanned: {
            ltaOnInvoice: 0,
            ltaOffInvoice: 0,
            promoOnInvoice: {},
            promoOffInvoice: {},
            totalPromoOnInvoice: 10000,
            totalPromoOffInvoice: 5000,
            totalOnInvoice: 10000,
            totalOffInvoice: 5000,
            totalSpend: 15000,
          },
          aggregatedIncremental: {
            onInvoice: 10000,
            offInvoice: 5000,
            total: 15000,
          },
        } as any);
        budgetService.findEnvelopeByDimensions.mockResolvedValue(
          mockEnvelope as any,
        );
        budgetService.getBudgetStatus.mockResolvedValue(mockBudgetStatus);
        // T-019b: findEnvelopeByDimensions resolves the SAME mockEnvelope for
        // both ON_INVOICE and OFF_INVOICE (unsplit/legacy fixture) —
        // checkBudgetAvailability's combined-pool branch calls
        // checkEnvelopeAvailability ONCE with (on+off).
        budgetService.checkEnvelopeAvailability.mockImplementation(
          (_tenantId: string, _envelopeId: string, amount: number) =>
            Promise.resolve({
              available: mockBudgetStatus.available,
              sufficient: amount <= mockBudgetStatus.available,
            }),
        );
        approvalService.createRequest.mockResolvedValue(
          mockApprovalRequest as any,
        );
        planRepo.findByIdForUpdate.mockResolvedValue({
          ...mockPlan,
          status: PlanStatus.DRAFT,
          version: 1,
        } as Plan);
        planRepo.updateStatusCas.mockResolvedValue(1);
        budgetService.reserveTypedForPlan.mockResolvedValue([{} as any]);
        approvalHistoryRepo.create.mockReturnValue({} as any);
        approvalHistoryRepo.save.mockResolvedValue({} as any);

        kpiEngine.getKpiConfig.mockResolvedValue(
          targetRoiThreshold === null
            ? null
            : ({ targetRoiThreshold } as unknown as Kpi),
        );

        const result = await service.submitForApproval(
          mockPlanId,
          mockTenantId,
          mockUserId,
          submitDto,
        );
        expect(result.success).toBe(true);
        return result.budgetCheck.warnings ?? [];
      }

      it('`RED` ⇒ "ciro kaybı" — kadran dilinde, eski genel cümle DEĞİL', async () => {
        const warnings = await submitWithPlanState({ ragStatus: 'RED' });
        expect(warnings.some((w) => w.includes('Ciro kaybı'))).toBe(true);
        // ⛔ AYIRT EDİCİ: `RED` uyarısı `AMBER` cümlesini TAŞIMAZ.
        expect(warnings.some((w) => w.includes('Kârsız büyüme'))).toBe(false);
      });

      it('⭐ `AMBER` ⇒ "kârsız büyüme" — kadranın DOĞURDUĞU uyarı', async () => {
        // Bu satır `T-342`'nin ilk turunda YOKTU: `AMBER` doğdu, uyarı
        // yüzeyinden düştü. `Z70 §1` onu tam amaçlandığı yere koyuyor.
        const warnings = await submitWithPlanState({ ragStatus: 'AMBER' });
        expect(warnings.some((w) => w.includes('Kârsız büyüme'))).toBe(true);
        expect(warnings.some((w) => w.includes('Ciro kaybı'))).toBe(false);
      });

      it("⛔ `B1` — eşik `pg`'den DİZGE gelse de uyarı ÜRETİLİR, ÇÖKMEZ", async () => {
        // ⛔ Üretimin GERÇEK şekli: `"20.0000"`. Normalizasyon
        // `evaluateTargetRoi`'de olmasaydı bu test bir `TypeError` ile
        // düşerdi (`threshold.toFixed is not a function`) — reprodüksiyon
        // koşuldu ve çökme GÖRÜLDÜ (`T-343` kapanış raporu).
        const warnings = await submitWithPlanState(
          { ragStatus: 'GREEN', overallRoi: 10.5 },
          '20.0000',
        );
        expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(true);
        // Ve mesaj SAYISAL biçimlenmiş olmalı — dizge sızarsa "%20.0000"
        // ya da bir çökme görürdük.
        expect(warnings.some((w) => w.includes('%20.0'))).toBe(true);
      });

      it("⛔ `B1` — ÇÖZÜLEMEYEN dizge eşik ⇒ uyarı YOK (`0`'a çökmez)", async () => {
        const warnings = await submitWithPlanState(
          { ragStatus: 'GREEN', overallRoi: 1 },
          'yirmi',
        );
        expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(false);
      });

      it('⭐ `GREEN` ∧ ROI < hedef ⇒ "hedefin altında" — SESSİZLEŞMEYEN dilim', async () => {
        // `10 ≤ ROI < 20`: eski model `AMBER` derdi, kadran `GREEN` diyor.
        // Bu uyarı olmasaydı ekranda YALNIZCA "İYİ" kalırdı.
        const warnings = await submitWithPlanState(
          { ragStatus: 'GREEN', overallRoi: 10.5 },
          20,
        );
        expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(true);
        // ⛔ Ve kadran uyarılarından HİÇBİRİ eşlik etmez — iki eksen AYRI.
        expect(warnings.some((w) => w.includes('Ciro kaybı'))).toBe(false);
        expect(warnings.some((w) => w.includes('Kârsız büyüme'))).toBe(false);
      });

      it('`GREEN` ∧ ROI ≥ hedef ⇒ HİÇBİR uyarı yok (yanlış alarm üretilmez)', async () => {
        const warnings = await submitWithPlanState(
          { ragStatus: 'GREEN', overallRoi: 25 },
          20,
        );
        expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(false);
      });

      it('⛔ hedef KONFİGÜRE DEĞİLSE below-target uyarısı ÜRETİLMEZ (`§2.5`)', async () => {
        // Uydurulmuş bir hedefe göre yargı vermek, sessiz varsayılanın
        // uyarı katmanındaki hâli olurdu.
        const warnings = await submitWithPlanState(
          { ragStatus: 'GREEN', overallRoi: 1 },
          null,
        );
        expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(false);
      });

      it('⭐ `S1` — renk yok + `LTA_ONLY` ⇒ "değerlendirme dışı", KUSUR DEĞİL', async () => {
        const warnings = await submitWithPlanState({
          ragStatus: null,
          ragExclusionReason: 'LTA_ONLY',
        });
        expect(warnings.some((w) => w.includes('Değerlendirme dışı'))).toBe(
          true,
        );
        // ⛔ AYIRT EDİCİ: meşru yokluk "hesaplanamadı" diye raporlanmaz.
        expect(warnings.some((w) => w.includes('hesaplanamadı'))).toBe(false);
      });

      it('renk yok + sebep yok ⇒ "RAG hesaplanamadı" — ve bu AYRI bir cümle', async () => {
        const warnings = await submitWithPlanState({
          ragStatus: null,
          ragExclusionReason: null,
        });
        expect(warnings.some((w) => w.includes('hesaplanamadı'))).toBe(true);
        expect(warnings.some((w) => w.includes('Değerlendirme dışı'))).toBe(
          false,
        );
      });

      it('tanınmayan bir dışlama sebebi MEŞRU YOKLUK sayılmaz', async () => {
        const warnings = await submitWithPlanState({
          ragStatus: null,
          ragExclusionReason: 'SOMETHING_NEW',
        });
        expect(warnings.some((w) => w.includes('hesaplanamadı'))).toBe(true);
      });
    });

    // -----------------------------------------------------------------
    // T-019b (§5.5 SPLIT regime + ADR 0004 Karar 2 kapsam netleştirmesi,
    // 2026-08-02): ON and OFF resolve to DIFFERENT envelopes.
    // -----------------------------------------------------------------
    describe('checkBudgetAvailability — SPLIT dimension (ON/OFF distinct envelopes)', () => {
      function mockSplitFuBreakdown(onInvoice: number, offInvoice: number) {
        return {
          fuId: 'plan-fu-1',
          skuBreakdowns: [],
          aggregatedBase: {
            ltaOnInvoice: 0,
            ltaOffInvoice: 0,
            totalOnInvoice: 0,
            totalOffInvoice: 0,
            totalSpend: 0,
          },
          aggregatedPlanned: {
            ltaOnInvoice: 0,
            ltaOffInvoice: 0,
            promoOnInvoice: {},
            promoOffInvoice: {},
            totalPromoOnInvoice: onInvoice,
            totalPromoOffInvoice: offInvoice,
            totalOnInvoice: onInvoice,
            totalOffInvoice: offInvoice,
            totalSpend: onInvoice + offInvoice,
          },
          aggregatedIncremental: {
            onInvoice,
            offInvoice,
            total: onInvoice + offInvoice,
          },
        } as any;
      }

      // T-056 adım 2: the SPLIT-regime (independent per-envelope) arithmetic
      // this describe block exercises now lives in — and is verified
      // against REAL code in — budget.service.spec.ts's
      // "checkPlanBudgetAvailability" suite (same 3 cases, ported
      // verbatim). Each `it` below sets `checkPlanBudgetAvailability`
      // directly to the exact value that algorithm returns for its inputs,
      // so submitForApproval's OWN orchestration (whether/with what
      // amounts reserveTypedForPlan is called) stays under test here.

      it('a plan spending ONLY on-invoice is not blocked by an exhausted off-invoice envelope (Karar 2 eki: harcanmayan tip zarfın durumu planı bloklamaz)', async () => {
        budgetService.checkPlanBudgetAvailability.mockResolvedValue({
          onInvoice: { available: 100000, requested: 50000, sufficient: true },
          offInvoice: { available: 0, requested: 0, sufficient: true },
          overallSufficient: true,
        });
        planRepo.findById.mockResolvedValue(mockPlan as Plan);
        planRepo.findByIdForUpdate.mockResolvedValue({
          ...mockPlan,
          status: PlanStatus.DRAFT,
          version: 1,
        } as Plan);
        spendCalc.calculateAllSpendsForFU.mockResolvedValue(
          mockSplitFuBreakdown(50000, 0),
        );
        approvalService.createRequest.mockResolvedValue({
          id: mockApprovalRequestId,
          requestType: ApprovalRequestType.PLAN,
        } as any);
        planRepo.updateStatusCas.mockResolvedValue(1);
        budgetService.reserveTypedForPlan.mockResolvedValue([{} as any]);
        approvalHistoryRepo.create.mockReturnValue({} as any);
        approvalHistoryRepo.save.mockResolvedValue({} as any);

        const result = await service.submitForApproval(
          mockPlanId,
          mockTenantId,
          mockUserId,
          submitDto,
        );

        expect(result.success).toBe(true);
        expect(result.budgetCheck?.overallSufficient).toBe(true);
        expect(result.budgetCheck?.offInvoice.requested).toBe(0);
        // T-056 adım 3: single reserveTypedForPlan call carrying BOTH
        // amounts — the "only the ON leg reserves, no OFF_INVOICE write for
        // a zero amount" guarantee now lives INSIDE reserveTypedForPlan
        // (real behaviour covered in budget.service.spec.ts's
        // "reserveTypedForPlan" suite); here we assert submitForApproval
        // passes the raw {onInvoice, offInvoice} shape through unchanged.
        expect(budgetService.reserveTypedForPlan).toHaveBeenCalledTimes(1);
        expect(budgetService.reserveTypedForPlan).toHaveBeenCalledWith(
          mockPlanId,
          { onInvoice: 50000, offInvoice: 0 },
          expect.any(String),
          expect.any(String),
          'TRY',
          mockTenantId,
          mockUserId,
          expect.anything(),
        );
      });

      it('a plan spending BOTH types is rejected ATOMICALLY when only the off-invoice envelope is insufficient — on leg individually fits but whole request blocked', async () => {
        // off envelope nearly exhausted (10000 available, 20000 requested)
        budgetService.checkPlanBudgetAvailability.mockResolvedValue({
          onInvoice: { available: 100000, requested: 50000, sufficient: true },
          offInvoice: { available: 10000, requested: 20000, sufficient: false },
          overallSufficient: false,
        });
        planRepo.findById.mockResolvedValue(mockPlan as Plan);
        spendCalc.calculateAllSpendsForFU.mockResolvedValue(
          mockSplitFuBreakdown(50000, 20000), // off (20000) > off available (10000)
        );

        const result = await service.submitForApproval(
          mockPlanId,
          mockTenantId,
          mockUserId,
          submitDto,
        );

        expect(result.success).toBe(false);
        expect(result.budgetCheck?.onInvoice.sufficient).toBe(true);
        expect(result.budgetCheck?.offInvoice.sufficient).toBe(false);
        expect(result.budgetCheck?.overallSufficient).toBe(false);
        expect(budgetService.reserveTypedForPlan).not.toHaveBeenCalled();
      });

      it('a plan spending BOTH types succeeds when both typed envelopes are independently sufficient', async () => {
        budgetService.checkPlanBudgetAvailability.mockResolvedValue({
          onInvoice: { available: 100000, requested: 50000, sufficient: true },
          offInvoice: { available: 100000, requested: 30000, sufficient: true },
          overallSufficient: true,
        });
        planRepo.findById.mockResolvedValue(mockPlan as Plan);
        planRepo.findByIdForUpdate.mockResolvedValue({
          ...mockPlan,
          status: PlanStatus.DRAFT,
          version: 1,
        } as Plan);
        spendCalc.calculateAllSpendsForFU.mockResolvedValue(
          mockSplitFuBreakdown(50000, 30000),
        );
        approvalService.createRequest.mockResolvedValue({
          id: mockApprovalRequestId,
          requestType: ApprovalRequestType.PLAN,
        } as any);
        planRepo.updateStatusCas.mockResolvedValue(1);
        budgetService.reserveTypedForPlan.mockResolvedValue([{} as any]);
        approvalHistoryRepo.create.mockReturnValue({} as any);
        approvalHistoryRepo.save.mockResolvedValue({} as any);

        const result = await service.submitForApproval(
          mockPlanId,
          mockTenantId,
          mockUserId,
          submitDto,
        );

        expect(result.success).toBe(true);
        expect(result.budgetCheck?.overallSufficient).toBe(true);
        // T-056 adım 3: single call carrying both amounts (was: 2 separate
        // reserveForPlan calls).
        expect(budgetService.reserveTypedForPlan).toHaveBeenCalledTimes(1);
        expect(budgetService.reserveTypedForPlan).toHaveBeenCalledWith(
          mockPlanId,
          { onInvoice: 50000, offInvoice: 30000 },
          expect.any(String),
          expect.any(String),
          'TRY',
          mockTenantId,
          mockUserId,
          expect.anything(),
        );
      });
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
