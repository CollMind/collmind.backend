import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanRepository } from './plan.repository';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { KpiEngineService } from '../../../shared/kpi-engine/kpi-engine.service';
import { SpendCalculationService } from '../../../shared/spend-calculation/spend-calculation.service';
import {
  Plan,
  PlanStatus,
  PlanFu,
} from '../../../../database/entities/plan.entity';
import { UserRole } from '../../../../database/entities/user.entity';
import { ForecastingUnit } from '../../../../database/entities/forecasting-unit.entity';
import { Sku } from '../../../../database/entities/sku.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';
import { UtilizationStatus } from '../../../shared/finance-reporting/dto/budget-utilization.dto';
import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from '../../../../database/entities/plan-approval-history.entity';

describe('PlanService', () => {
  let service: PlanService;
  let planRepo: jest.Mocked<PlanRepository>;
  let budgetService: jest.Mocked<BudgetService>;
  let approvalService: jest.Mocked<ApprovalService>;
  let kpiEngine: jest.Mocked<KpiEngineService>;
  let spendCalc: jest.Mocked<SpendCalculationService>;
  let approvalHistoryRepo: {
    create: jest.Mock;
    save: jest.Mock;
  };

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
            commitReservedForPlan: jest.fn(),
            releaseForPlan: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlanApprovalHistory),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
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

    service = module.get<PlanService>(PlanService);
    planRepo = module.get(PlanRepository);
    budgetService = module.get(BudgetService);
    approvalService = module.get(ApprovalService);
    kpiEngine = module.get(KpiEngineService);
    spendCalc = module.get(SpendCalculationService);
    approvalHistoryRepo = module.get(getRepositoryToken(PlanApprovalHistory));
    approvalHistoryRepo.create.mockImplementation((data: any) => data);
    approvalHistoryRepo.save.mockImplementation((data: any) =>
      Promise.resolve(data),
    );
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
      // No envelope yet for this channel/period → reservation is skipped
      // (best-effort; submission itself must not be blocked).
      budgetService.findEnvelopeByDimensions.mockResolvedValue(null);

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
      // T-029: audit — submit must write a SUBMITTED PlanApprovalHistory row.
      expect(approvalHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: mockPlanId,
          tenantId: mockTenantId,
          actionedById: mockUserId,
          action: ApprovalHistoryAction.SUBMITTED,
        }),
      );
      expect(approvalHistoryRepo.save).toHaveBeenCalled();
    });

    it('T-029: reserves budget (RESERVE) when an envelope already exists for the channel/period', async () => {
      const planWithFus = {
        ...mockPlan,
        totalSpend: 100000,
        planFus: [{ id: 'plan-fu-1', fuId: 'fu-1' } as PlanFu],
      } as Plan;

      planRepo.findById.mockResolvedValue(planWithFus as Plan);
      approvalService.createRequest.mockResolvedValue({
        id: 'approval-request-1',
      } as any);
      planRepo.updateStatus.mockResolvedValue({
        ...planWithFus,
        status: PlanStatus.PENDING_APPROVAL,
      } as Plan);
      budgetService.findEnvelopeByDimensions.mockResolvedValue({
        id: 'envelope-1',
      } as any);
      budgetService.reserveForPlan.mockResolvedValue({} as any);

      await service.submit(mockPlanId, mockTenantId, mockUserId);

      expect(budgetService.reserveForPlan).toHaveBeenCalledWith(
        mockPlanId,
        planWithFus.totalSpend,
        planWithFus.channel?.code,
        planWithFus.periodMonth,
        'TRY',
        mockTenantId,
        mockUserId,
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
        status: UtilizationStatus.GREEN,
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
      budgetService.commitReservedForPlan.mockResolvedValue({} as any);
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
      expect(budgetService.commitReservedForPlan).toHaveBeenCalledWith(
        mockPlanId,
        pendingPlan.totalSpend,
        pendingPlan.channel?.code,
        pendingPlan.periodMonth,
        'TRY',
        mockTenantId,
        mockUserId,
      );
      expect(approvalService.approve).toHaveBeenCalled();
      // T-029: audit — approve must write an APPROVED PlanApprovalHistory row.
      expect(approvalHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: mockPlanId,
          tenantId: mockTenantId,
          actionedById: mockUserId,
          action: ApprovalHistoryAction.APPROVED,
          comments: 'Comments',
        }),
      );
      expect(approvalHistoryRepo.save).toHaveBeenCalled();
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
      budgetService.releaseForPlan.mockResolvedValue(undefined);

      const result = await service.reject(
        mockPlanId,
        mockTenantId,
        mockUserId,
        'Budget insufficient',
      );

      expect(result.status).toBe(PlanStatus.REJECTED);
      expect(approvalService.reject).toHaveBeenCalled();
      // T-029: audit — reject must write a REJECTED PlanApprovalHistory row.
      expect(approvalHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: mockPlanId,
          tenantId: mockTenantId,
          actionedById: mockUserId,
          action: ApprovalHistoryAction.REJECTED,
          rejectionReason: 'Budget insufficient',
        }),
      );
      expect(approvalHistoryRepo.save).toHaveBeenCalled();
      // T-029: BRD Rejected → RELEASE outstanding budget encumbrance.
      expect(budgetService.releaseForPlan).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        mockUserId,
      );
    });
  });

  describe('returnToDraft (T-033: Rejected → Draft)', () => {
    const rejectedPlan = {
      ...mockPlan,
      status: PlanStatus.REJECTED,
      createdBy: mockUserId,
      submittedById: mockUserId,
      rejectedAt: new Date('2026-01-01'),
      rejectedById: 'reviewer-1',
      rejectionReason: 'Budget insufficient',
      approvalRequestId: 'approval-request-1',
      submittedAt: new Date('2025-12-31'),
    } as unknown as Plan;

    it('successfully returns a REJECTED plan to DRAFT', async () => {
      planRepo.findById.mockResolvedValue(rejectedPlan);
      planRepo.updateStatus.mockResolvedValue({
        ...rejectedPlan,
        status: PlanStatus.DRAFT,
        rejectedAt: undefined,
        rejectedById: undefined,
        rejectionReason: undefined,
        submittedAt: undefined,
        submittedById: undefined,
        approvalRequestId: undefined,
      } as Plan);

      const result = await service.returnToDraft(
        mockPlanId,
        mockTenantId,
        mockUserId,
        { userId: mockUserId, role: UserRole.PLANNER },
      );

      expect(result.status).toBe(PlanStatus.DRAFT);
      expect(planRepo.updateStatus).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        PlanStatus.DRAFT,
        expect.objectContaining({
          rejectedAt: null,
          rejectedById: null,
          rejectionReason: null,
          submittedAt: null,
          submittedById: null,
          approvalRequestId: null,
        }),
      );
      // T-033: audit — RETURNED_TO_DRAFT history row is written, existing
      // history is never deleted/updated (immutable, BRD "audit korunur").
      expect(approvalHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: mockPlanId,
          tenantId: mockTenantId,
          actionedById: mockUserId,
          action: ApprovalHistoryAction.RETURNED_TO_DRAFT,
        }),
      );
      expect(approvalHistoryRepo.save).toHaveBeenCalled();
      // T-033: no budget movement — reject() already RELEASEd; a fresh
      // RESERVE is only created by a subsequent submit().
      expect(budgetService.reserveForPlan).not.toHaveBeenCalled();
      expect(budgetService.releaseForPlan).not.toHaveBeenCalled();
      expect(budgetService.commitReservedForPlan).not.toHaveBeenCalled();
    });

    it('rejects with 409 NOT_REJECTED if plan is not REJECTED', async () => {
      planRepo.findById.mockResolvedValue({
        ...mockPlan,
        status: PlanStatus.DRAFT,
      } as Plan);

      await expect(
        service.returnToDraft(mockPlanId, mockTenantId, mockUserId, {
          userId: mockUserId,
          role: UserRole.PLANNER,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a non-owner PLANNER with 404 OUT_OF_SCOPE', async () => {
      planRepo.findById.mockResolvedValue(rejectedPlan);

      await expect(
        service.returnToDraft(mockPlanId, mockTenantId, 'other-planner', {
          userId: 'other-planner',
          role: UserRole.PLANNER,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(planRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('allows ADMIN regardless of plan ownership', async () => {
      planRepo.findById.mockResolvedValue(rejectedPlan);
      planRepo.updateStatus.mockResolvedValue({
        ...rejectedPlan,
        status: PlanStatus.DRAFT,
      } as Plan);

      const result = await service.returnToDraft(
        mockPlanId,
        mockTenantId,
        'admin-1',
        { userId: 'admin-1', role: UserRole.ADMIN },
      );

      expect(result.status).toBe(PlanStatus.DRAFT);
    });

    it('compensates (reverts to REJECTED) if history write fails', async () => {
      planRepo.findById.mockResolvedValue(rejectedPlan);
      planRepo.updateStatus.mockResolvedValueOnce({
        ...rejectedPlan,
        status: PlanStatus.DRAFT,
      } as Plan);
      planRepo.update.mockResolvedValueOnce({
        ...rejectedPlan,
        status: PlanStatus.REJECTED,
      } as Plan);
      approvalHistoryRepo.save.mockRejectedValueOnce(new Error('DB down'));

      await expect(
        service.returnToDraft(mockPlanId, mockTenantId, mockUserId, {
          userId: mockUserId,
          role: UserRole.PLANNER,
        }),
      ).rejects.toThrow('Failed to record approval history');

      // Compensation reverts status back to REJECTED with the original
      // rejection fields restored (not via updateStatus — a direct #update
      // call, since #updateStatus's `status` param is DRAFT-transition-
      // specific elsewhere in this file).
      expect(planRepo.update).toHaveBeenCalledWith(
        mockPlanId,
        mockTenantId,
        expect.objectContaining({
          status: PlanStatus.REJECTED,
          rejectionReason: rejectedPlan.rejectionReason,
        }),
      );
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

    /**
     * T-027 — KPI eksik-veri kuralı: COGS null → context'e null geçmeli
     * (0 DEĞİL), böylece formula-parser'ın dependency-null propagation'ı
     * PLANNED_GP/GP_ROI_PCT'i null'a düşürür ve fabrik %100/GREEN
     * yanılsaması oluşmaz. COGS=0 ise (gerçekten sıfır maliyet) context'e
     * 0 geçmeli — null'a çevrilmemeli.
     */
    it('T-027: missing COGS (sku.cogs undefined) propagates as null in KPI context, not 0', async () => {
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
                baseVolume: 800,
                plannedVolume: 1000,
                // No `cogs` on the SKU — real Wella seed scenario (T-027).
                sku: { id: 'sku-a', unitPrice: 100 },
              },
            ],
          } as any,
        ],
      } as Plan;

      const skuASpend = makeSpendBreakdown(1000, 0);
      spendCalc.calculateAllSpendsForSKU.mockResolvedValue(skuASpend as any);

      // KPI engine mock simulates the real dependency-null propagation:
      // PLANNED_GP/GP_ROI_PCT resolve to null when COGS is null.
      kpiEngine.calculateSku.mockResolvedValue({
        PLANNED_TO: {
          kpiCode: 'PLANNED_TO',
          value: 99000,
          displayFormat: 'currency',
          decimalPlaces: 2,
          ragStatus: null,
        },
        PLANNED_GP: {
          kpiCode: 'PLANNED_GP',
          value: null,
          displayFormat: 'currency',
          decimalPlaces: 2,
          ragStatus: null,
        },
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
        plannedVolume: 1000,
        plannedGp: null,
      } as any);
      planRepo.updatePlanSku.mockResolvedValue(undefined as any);
      planRepo.updatePlanFu.mockResolvedValue(undefined as any);
      planRepo.update.mockResolvedValue({} as any);

      await service.recalculatePlanWithKpiEngine(mockPlanId, mockTenantId);

      // The context handed to the KPI engine must carry COGS: null (not 0),
      // while BPTT/BASE_VOL/PLAN_VOL (all present) stay numeric.
      const engineCtx = kpiEngine.calculateSku.mock.calls[0][1];
      expect(engineCtx.COGS).toBeNull();
      expect(engineCtx.BPTT).toBe(100);
      expect(engineCtx.BASE_VOL).toBe(800);
      expect(engineCtx.PLAN_VOL).toBe(1000);

      // Persisted SKU result must reflect null GP/ROI/RAG — never a
      // fabricated 100%/GREEN — while PLANNED_TO (independent of COGS)
      // remains a real number.
      const updateCall = planRepo.updatePlanSku.mock.calls[0][1];
      expect(updateCall.plannedGp).toBeNull();
      expect(updateCall.gpRoi).toBeNull();
      expect(updateCall.ragStatus).toBeNull();
      expect(updateCall.plannedTurnover).toBe(99000);
    });

    it('T-027: COGS=0 (legitimately zero) is NOT coalesced to null in KPI context', async () => {
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
                baseVolume: 800,
                plannedVolume: 1000,
                // Explicit legitimate 0 (e.g. a free-goods SKU) — must stay 0.
                sku: { id: 'sku-a', unitPrice: 100, cogs: 0 },
              },
            ],
          } as any,
        ],
      } as Plan;

      const skuASpend = makeSpendBreakdown(1000, 0);
      spendCalc.calculateAllSpendsForSKU.mockResolvedValue(skuASpend as any);
      kpiEngine.calculateSku.mockResolvedValue({} as any);
      kpiEngine.calculateFu.mockResolvedValue({} as any);
      kpiEngine.calculatePlan.mockResolvedValue({} as any);

      planRepo.findById
        .mockResolvedValueOnce(planWithFus)
        .mockResolvedValueOnce({ ...planWithFus, planFus: [] } as any);
      planRepo.findPlanSku.mockResolvedValue({
        id: 'ps-1',
        plannedVolume: 1000,
        plannedGp: null,
      } as any);
      planRepo.updatePlanSku.mockResolvedValue(undefined as any);
      planRepo.updatePlanFu.mockResolvedValue(undefined as any);
      planRepo.update.mockResolvedValue({} as any);

      await service.recalculatePlanWithKpiEngine(mockPlanId, mockTenantId);

      const engineCtx = kpiEngine.calculateSku.mock.calls[0][1];
      expect(engineCtx.COGS).toBe(0);
      expect(engineCtx.COGS).not.toBeNull();
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
      // Set D: SPEND=0 → ROI null (not a fallback number).
      // T-027: null is now persisted EXPLICITLY (not `undefined`, which
      // TypeORM's `.update()` would skip and leave a stale prior value in
      // place) — a recalc that newly resolves to null must actually clear
      // the DB column.
      expect(updateCall.gpRoi).toBeNull();
      // No RAG should be set from hardcode
      expect(updateCall.ragStatus).toBeNull();
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
