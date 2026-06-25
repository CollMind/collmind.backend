import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanRepository } from './plan.repository';
import { BudgetService } from '../../../shared/budget/budget.service';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { KpiEngineService } from '../../../shared/kpi-engine/kpi-engine.service';
import { SpendCalculationService } from '../../../shared/spend-calculation/spend-calculation.service';
import {
  Plan,
  PlanStatus,
  PlanFu,
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
  let spendCalc: jest.Mocked<SpendCalculationService>;

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
          provide: SpendCalculationService,
          useValue: {
            calculateAllSpendsForSKU: jest.fn(),
            calculateAllSpendsForFU: jest.fn(),
            calculateCompleteSKUFinancialMetrics: jest.fn(),
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
    spendCalc = module.get(SpendCalculationService);
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

  /**
   * BRD Parite Test Matrisi — Set A (happy path)
   *
   * Inputs (from parity-analysis.md Set A):
   *   SKU-A: planVol=4200, baseVol=3200, BPTT=4.00, COGS=1.80
   *   SKU-B: planVol=3500, baseVol=2800, BPTT=3.50, COGS=1.50
   *   CPP_ON_PCT=10, VIS_LS=2000, PRICE_SUP_PER_UNIT=0.25
   *   LTA: on=0 (no LTA in Set A baseline), off=0
   *   Expected: TOTAL_PLANNED_SPEND(FU)≈6830, INCR_GP≈695, GP_ROI≈10.18, RAG=AMBER
   *
   * These tests verify that recalculatePlanWithKpiEngine uses SpendCalc as
   * the authoritative spend source and passes BRD-required context fields.
   */
  describe('recalculatePlanWithKpiEngine — BRD parity (Set A)', () => {
    /**
     * Build a minimal SpendBreakdown stub for a SKU.
     * In Set A: no LTA (all zeroes), INCR_SPEND = TOTAL_PLANNED_SPEND.
     */
    const makeSpendBreakdown = (
      totalPlannedSpend: number,
      baseTotalSpend: number,
    ) => ({
      skuId: 'sku-x',
      base: {
        ltaOnInvoice: 0,
        ltaOffInvoice: 0,
        totalOnInvoice: baseTotalSpend,
        totalOffInvoice: 0,
        totalSpend: baseTotalSpend,
      },
      planned: {
        ltaOnInvoice: 0,
        ltaOffInvoice: 0,
        promoOnInvoice: {},
        promoOffInvoice: {},
        totalPromoOnInvoice: totalPlannedSpend,
        totalPromoOffInvoice: 0,
        totalOnInvoice: totalPlannedSpend,
        totalOffInvoice: 0,
        totalSpend: totalPlannedSpend,
      },
      incremental: {
        onInvoice: totalPlannedSpend - baseTotalSpend,
        offInvoice: 0,
        total: totalPlannedSpend - baseTotalSpend,
      },
    });

    it('should call SpendCalculationService for each SKU (BRD context injection)', async () => {
      // Set A: SKU-A only for simplicity — validate that spendCalc is called
      const planWithFus = {
        ...mockPlan,
        cplId: 'cpl-1',
        channel: { id: 'ch-1', code: 'NKA', name: 'NKA' } as any,
        category: { id: 'cat-1', code: 'DAIRY', name: 'Dairy' } as any,
        planFus: [
          {
            id: 'fu-1',
            fuId: 'fu-1',
            planId: mockPlanId,
            tactics: { CPP_ON_PCT: 10 },
            planSkus: [
              {
                id: 'ps-1',
                skuId: 'sku-a',
                baseVolume: 3200,
                plannedVolume: 4200,
                sku: { id: 'sku-a', unitPrice: 4.0, cogs: 1.8 },
              },
            ],
          } as any,
        ],
      } as Plan;

      // SpendCalc stub for SKU-A: total planned spend = CPP_ON(10% of 4200*4=16800) = 1680
      const skuASpend = makeSpendBreakdown(1680, 0);
      spendCalc.calculateAllSpendsForSKU.mockResolvedValue(skuASpend as any);

      // KPI engine returns BRD-correct values
      kpiEngine.calculateSku.mockResolvedValue({
        PLANNED_GP: {
          kpiCode: 'PLANNED_GP',
          value: 8330.4,
          displayFormat: 'currency',
          decimalPlaces: 2,
          ragStatus: null,
        },
        BASE_GP: {
          kpiCode: 'BASE_GP',
          value: 7136,
          displayFormat: 'currency',
          decimalPlaces: 2,
          ragStatus: null,
        },
        INCR_GP: {
          kpiCode: 'INCR_GP',
          value: 1194.4,
          displayFormat: 'currency',
          decimalPlaces: 2,
          ragStatus: null,
        },
        INCR_SPEND: {
          kpiCode: 'INCR_SPEND',
          value: 1680,
          displayFormat: 'currency',
          decimalPlaces: 2,
          ragStatus: null,
        },
        GP_ROI_PCT: {
          kpiCode: 'GP_ROI_PCT',
          value: 71.1,
          displayFormat: 'percentage',
          decimalPlaces: 1,
          ragStatus: 'GREEN',
        },
        PLANNED_TO: {
          kpiCode: 'PLANNED_TO',
          value: 15120,
          displayFormat: 'currency',
          decimalPlaces: 2,
          ragStatus: null,
        },
      } as any);
      kpiEngine.calculateFu.mockResolvedValue({} as any);
      kpiEngine.calculatePlan.mockResolvedValue({} as any);

      planRepo.findById
        .mockResolvedValueOnce(planWithFus)
        .mockResolvedValueOnce({ ...planWithFus, planFus: [] } as any);
      planRepo.findPlanSku.mockResolvedValue({
        id: 'ps-1',
        plannedVolume: 4200,
        plannedGp: 8330.4,
      } as any);
      planRepo.updatePlanSku.mockResolvedValue(undefined as any);
      planRepo.updatePlanFu.mockResolvedValue(undefined as any);
      planRepo.update.mockResolvedValue({} as any);

      await service.recalculatePlanWithKpiEngine(mockPlanId, mockTenantId);

      // Verify SpendCalc was called (authoritative spend source)
      expect(spendCalc.calculateAllSpendsForSKU).toHaveBeenCalledTimes(1);

      // Verify KPI engine context contains BRD-required LTA + spend fields
      const engineCtx = kpiEngine.calculateSku.mock.calls[0][1];
      expect(engineCtx).toMatchObject({
        BASE_VOL: 3200,
        PLAN_VOL: 4200,
        BPTT: 4.0,
        COGS: 1.8,
        // BRD external fields (Gap G fix)
        PLANNED_LTA_ON: 0,
        PLANNED_LTA_OFF: 0,
        BASE_LTA_ON: 0,
        BASE_LTA_OFF: 0,
        TOTAL_PLANNED_SPEND: 1680,
        BASE_TOTAL_SPEND: 0,
        INCR_SPEND: 1680,
      });
    });

    it('should persist GP_ROI_PCT from engine only — no fallback arithmetic (BUG #1 fix)', async () => {
      // If engine returns null for GP_ROI_PCT (e.g. INCR_SPEND=0 → div-by-zero),
      // persistedGpRoi must be null — not a hardcoded fallback calculation.
      const planWithFus = {
        ...mockPlan,
        cplId: 'cpl-1',
        channel: { id: 'ch-1', code: 'NKA', name: 'NKA' } as any,
        category: { id: 'cat-1', code: 'DAIRY', name: 'Dairy' } as any,
        planFus: [
          {
            id: 'fu-1',
            fuId: 'fu-1',
            planId: mockPlanId,
            tactics: {},
            planSkus: [
              {
                id: 'ps-1',
                skuId: 'sku-a',
                baseVolume: 3200,
                plannedVolume: 4200,
                sku: { id: 'sku-a', unitPrice: 4.0, cogs: 1.8 },
              },
            ],
          } as any,
        ],
      } as Plan;

      // Set D: INCR_SPEND=0 → ROI must be null (div-by-zero BRD rule)
      const skuNoSpend = makeSpendBreakdown(0, 0);
      spendCalc.calculateAllSpendsForSKU.mockResolvedValue(skuNoSpend as any);

      kpiEngine.calculateSku.mockResolvedValue({
        GP_ROI_PCT: {
          kpiCode: 'GP_ROI_PCT',
          value: null,
          displayFormat: 'percentage',
          decimalPlaces: 1,
          ragStatus: null,
        },
      } as any);
      kpiEngine.calculateFu.mockResolvedValue({} as any);
      kpiEngine.calculatePlan.mockResolvedValue({} as any);

      planRepo.findById
        .mockResolvedValueOnce(planWithFus)
        .mockResolvedValueOnce({ ...planWithFus, planFus: [] } as any);
      planRepo.findPlanSku.mockResolvedValue({
        id: 'ps-1',
        plannedVolume: 4200,
        plannedGp: null,
      } as any);
      planRepo.updatePlanSku.mockResolvedValue(undefined as any);
      planRepo.updatePlanFu.mockResolvedValue(undefined as any);
      planRepo.update.mockResolvedValue({} as any);

      await service.recalculatePlanWithKpiEngine(mockPlanId, mockTenantId);

      const updateCall = planRepo.updatePlanSku.mock.calls[0][1];
      // Set D: SPEND=0 → ROI null (not a fallback number)
      expect(updateCall.gpRoi).toBeUndefined(); // null → undefined (persist as null)
      // No RAG should be set from hardcode
      expect(updateCall.ragStatus).toBeUndefined();
    });

    it('should surface KPI engine errors instead of silently swallowing them', async () => {
      const planWithFus = {
        ...mockPlan,
        cplId: 'cpl-1',
        planFus: [
          {
            id: 'fu-1',
            fuId: 'fu-1',
            planId: mockPlanId,
            tactics: {},
            planSkus: [
              {
                id: 'ps-1',
                skuId: 'sku-a',
                baseVolume: 100,
                plannedVolume: 200,
                sku: { id: 'sku-a', unitPrice: 10, cogs: 5 },
              },
            ],
          } as any,
        ],
      } as Plan;

      spendCalc.calculateAllSpendsForSKU.mockResolvedValue(
        makeSpendBreakdown(500, 0) as any,
      );
      kpiEngine.calculateSku.mockRejectedValue(
        new Error('KPI engine internal error'),
      );
      planRepo.findById.mockResolvedValue(planWithFus);

      // Error must propagate — not silently caught
      await expect(
        service.recalculatePlanWithKpiEngine(mockPlanId, mockTenantId),
      ).rejects.toThrow('KPI engine internal error');
    });
  });
});
