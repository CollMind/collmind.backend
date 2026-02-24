import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PlanRepository } from './plan.repository';
import { CreatePlanDto, UpdatePlanDto, AddFuDto, UpdateFuTacticDto, UpdateSkuVolumeDto } from './dto';
import { Plan, PlanStatus, PlanFu, PlanSku } from '../../../../database/entities/plan.entity';
import { BudgetService } from '../../../shared/budget/budget.service';
import { BudgetEnvelopeStatus } from '../../../../database/entities/budget-envelope.entity';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { KpiEngineService, CalculationResult, SkuCalculationContext } from '../../../shared/kpi-engine/kpi-engine.service';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ForecastingUnit } from '../../../../database/entities/forecasting-unit.entity';
import { Sku } from '../../../../database/entities/sku.entity';
import { Tactic } from '../../../../database/entities/tactic.entity';

@Injectable()
export class PlanService {
  constructor(
    private readonly planRepo: PlanRepository,
    private readonly budgetService: BudgetService,
    private readonly approvalService: ApprovalService,
    private readonly kpiEngine: KpiEngineService,
    @InjectRepository(ForecastingUnit)
    private readonly fuRepo: Repository<ForecastingUnit>,
    @InjectRepository(Sku)
    private readonly skuRepo: Repository<Sku>,
    @InjectRepository(Tactic)
    private readonly tacticRepo: Repository<Tactic>,
  ) {}

  async create(
    dto: CreatePlanDto,
    tenantId: string,
    userId: string,
  ): Promise<Plan> {
    // Calculate period month from start date
    const startDate = new Date(dto.startDate);
    const periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

    // Retry logic for plan code generation (handle race conditions)
    const maxAttempts = 10;
    let lastError: any;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Generate plan code
        let planCode = await this.planRepo.generatePlanCode(tenantId);

        // If not first attempt, add suffix to make it unique
        if (attempt > 0) {
          const timestamp = Date.now().toString().slice(-4);
          planCode = `${planCode}-${timestamp}`;
        }

        // Check if code already exists
        const existing = await this.planRepo.findByCode(planCode, tenantId);
        if (existing) {
          await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
          continue;
        }

        // Try to create plan
        const plan = await this.planRepo.create({
          ...dto,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          planCode,
          periodMonth,
          tenantId,
          status: PlanStatus.DRAFT,
          createdBy: userId,
          totalPlannedVolume: 0,
          totalSpend: 0,
          totalGp: 0,
        });

        return plan;
      } catch (error: any) {
        lastError = error;
        
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
          if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
            continue;
          }
        }
        
        if (attempt === maxAttempts - 1 || (error.code !== '23505' && !error.message?.includes('duplicate key'))) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      `Unable to create plan: ${lastError?.message || 'Unknown error'}`
    );
  }

  async findById(id: string, tenantId: string): Promise<Plan> {
    const plan = await this.planRepo.findById(id, tenantId);
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${id} not found`);
    }
    return plan;
  }

  async findAll(tenantId: string, filters?: {
    status?: PlanStatus;
    cplId?: string;
    channelId?: string;
    categoryId?: string;
  }): Promise<Plan[]> {
    return this.planRepo.findAll(tenantId, filters);
  }

  async findPendingApprovals(tenantId: string): Promise<Plan[]> {
    return this.planRepo.findAll(tenantId, { status: PlanStatus.PENDING_APPROVAL });
  }

  async update(
    id: string,
    dto: UpdatePlanDto,
    tenantId: string,
    userId: string,
  ): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be edited');
    }

    const { startDate: dtoStartDate, endDate: dtoEndDate, ...dtoWithoutDates } = dto;
    const updateData: Partial<Plan> = { ...dtoWithoutDates, updatedBy: userId };
    
    if (dtoStartDate) {
      const startDate = new Date(dtoStartDate);
      updateData.periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
      updateData.startDate = startDate;
    }
    if (dtoEndDate) {
      updateData.endDate = new Date(dtoEndDate);
    }

    return this.planRepo.update(id, tenantId, updateData);
  }

  async addFu(
    planId: string,
    dto: AddFuDto,
    tenantId: string,
    userId: string,
  ): Promise<PlanFu> {
    const plan = await this.findById(planId, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    // Verify FU exists and is plannable
    const fu = await this.fuRepo.findOne({ where: { id: dto.fuId, tenantId } });
    if (!fu) {
      throw new NotFoundException(`Forecasting Unit with ID ${dto.fuId} not found`);
    }
    if (!fu.isPlannable) {
      throw new BadRequestException(`Forecasting Unit ${fu.code} is not plannable`);
    }

    // Check if FU already added
    const existing = await this.planRepo.findPlanFu(planId, dto.fuId);
    if (existing) {
      throw new ConflictException('FU already added to this plan');
    }

    // Add FU to plan
    const planFu = await this.planRepo.addFu(planId, dto.fuId, tenantId, userId, dto.tactics);

    // Auto-add all SKUs for this FU
    const skus = await this.skuRepo.findBy({ fuId: dto.fuId, tenantId, isActive: true });
    for (const sku of skus) {
      await this.planRepo.addSku(planFu.id, sku.id, tenantId, userId);
    }

    // Recalculate plan totals using KPI engine
    await this.recalculatePlanWithKpiEngine(planId, tenantId);

    return this.planRepo.findPlanFu(planId, dto.fuId) as Promise<PlanFu>;
  }

  async updateFuTactic(
    planId: string,
    fuId: string,
    dto: UpdateFuTacticDto,
    tenantId: string,
  ): Promise<PlanFu> {
    const plan = await this.findById(planId, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    // Update tactics
    await this.planRepo.updatePlanFu(planFu.id, {
      tactics: dto.tactics || planFu.tactics,
    });

    // Recalculate using KPI engine
    await this.recalculatePlanWithKpiEngine(planId, tenantId);

    return this.planRepo.findPlanFu(planId, fuId) as Promise<PlanFu>;
  }

  async updateSkuVolume(
    planId: string,
    fuId: string,
    skuId: string,
    dto: UpdateSkuVolumeDto,
    tenantId: string,
  ): Promise<PlanSku> {
    const plan = await this.findById(planId, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    const planSku = await this.planRepo.findPlanSku(planFu.id, skuId);
    if (!planSku) {
      throw new NotFoundException('SKU not found in this plan');
    }

    // Update volumes
    const incrementalVolume = dto.plannedVolume && dto.baseVolume
      ? dto.plannedVolume - dto.baseVolume
      : dto.plannedVolume && planSku.baseVolume
      ? dto.plannedVolume - planSku.baseVolume
      : planSku.incrementalVolume;

    await this.planRepo.updatePlanSku(planSku.id, {
      baseVolume: dto.baseVolume ?? planSku.baseVolume,
      plannedVolume: dto.plannedVolume ?? planSku.plannedVolume,
      incrementalVolume,
    });

    // Recalculate using KPI engine
    await this.recalculatePlanWithKpiEngine(planId, tenantId);

    return this.planRepo.findPlanSku(planFu.id, skuId) as Promise<PlanSku>;
  }

  async removeFu(planId: string, fuId: string, tenantId: string): Promise<void> {
    const plan = await this.findById(planId, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be modified');
    }

    const planFu = await this.planRepo.findPlanFu(planId, fuId);
    if (!planFu) {
      throw new NotFoundException('FU not found in this plan');
    }

    await this.planRepo.removeFu(planFu.id);
    await this.recalculatePlanWithKpiEngine(planId, tenantId);
  }

  async submit(id: string, tenantId: string, userId: string): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be submitted');
    }

    if (!plan.planFus || plan.planFus.length === 0) {
      throw new BadRequestException('Plan must have at least one FU before submission');
    }

    // Create approval request
    const approvalRequest = await this.approvalService.createRequest(
      {
        requestType: ApprovalRequestType.PLAN,
        entityType: 'PLAN',
        entityId: plan.id,
      },
      tenantId,
      userId,
    );

    return this.planRepo.updateStatus(id, tenantId, PlanStatus.PENDING_APPROVAL, {
      approvalRequestId: approvalRequest.id,
      updatedBy: userId,
    });
  }

  /**
   * Check budget availability for a plan before approval
   */
  async checkBudget(id: string, tenantId: string): Promise<{
    hasBudget: boolean;
    planTotalSpend: number;
    channel: string;
    channelName: string;
    period: string;
    envelope?: {
      id: string;
      code: string;
      name: string;
      allocatedAmount: number;
      availableAmount: number;
      currency: string;
    };
    sufficient?: boolean;
  }> {
    const plan = await this.findById(id, tenantId);
    const channelCode = plan.channel?.code || '';
    const channelName = plan.channel?.name || channelCode;

    const envelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      plan.periodMonth,
    );

    if (!envelope) {
      return {
        hasBudget: false,
        planTotalSpend: Number(plan.totalSpend),
        channel: channelCode,
        channelName,
        period: plan.periodMonth,
      };
    }

    // Check availability
    const budgetStatus = await this.budgetService.getBudgetStatus(
      tenantId,
      channelCode,
      undefined,
      plan.periodMonth,
    );

    return {
      hasBudget: true,
      planTotalSpend: Number(plan.totalSpend),
      channel: channelCode,
      channelName,
      period: plan.periodMonth,
      envelope: {
        id: envelope.id,
        code: envelope.code,
        name: envelope.name,
        allocatedAmount: Number(envelope.allocatedAmount),
        availableAmount: budgetStatus.available,
        currency: envelope.currency,
      },
      sufficient: budgetStatus.available >= Number(plan.totalSpend),
    };
  }

  async approve(
    id: string,
    tenantId: string,
    userId: string,
    comments?: string,
    autoCreateBudget?: boolean,
    budgetAmount?: number,
  ): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only PENDING_APPROVAL plans can be approved');
    }

    if (!plan.approvalRequestId) {
      throw new BadRequestException('Approval request not found');
    }

    const channelCode = plan.channel?.code || '';

    // Check if budget envelope exists
    const existingEnvelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      plan.periodMonth,
    );

    if (!existingEnvelope && autoCreateBudget) {
      // Auto-create budget envelope
      const allocatedAmount = budgetAmount || Math.max(Number(plan.totalSpend) * 2, 100000);
      const periodLabel = plan.periodMonth; // e.g., "2026-01"
      const fiscalYear = plan.periodMonth.substring(0, 4);

      await this.budgetService.createEnvelope(tenantId, {
        code: `${channelCode}/${periodLabel}`,
        name: `${plan.channel?.name || channelCode} - ${periodLabel} Bütçesi`,
        fiscalYear,
        period: periodLabel,
        allocatedAmount,
        status: BudgetEnvelopeStatus.ACTIVE,
        currency: 'TRY',
        metadata: {
          channel: channelCode,
          autoCreated: true,
          createdForPlanId: plan.id,
        },
      });
    } else if (!existingEnvelope && !autoCreateBudget) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channelCode}, period: ${plan.periodMonth}. Use autoCreateBudget to create one automatically.`,
      );
    }

    // Create budget reservation
    try {
      await this.budgetService.reserveForPlan(
        plan.id,
        plan.totalSpend,
        channelCode,
        plan.periodMonth,
        'TRY',
        tenantId,
        userId,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(`Budget reservation failed: ${errorMessage}`);
    }

    // Update approval request
    await this.approvalService.approve(
      plan.approvalRequestId,
      tenantId,
      userId,
      { comments },
    );

    return this.planRepo.updateStatus(id, tenantId, PlanStatus.APPROVED, {
      approvedAt: new Date(),
      approvedById: userId,
      updatedBy: userId,
    });
  }

  async reject(
    id: string,
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only PENDING_APPROVAL plans can be rejected');
    }

    if (!plan.approvalRequestId) {
      throw new BadRequestException('Approval request not found');
    }

    await this.approvalService.reject(
      plan.approvalRequestId,
      tenantId,
      userId,
      { reason },
    );

    return this.planRepo.updateStatus(id, tenantId, PlanStatus.REJECTED, {
      rejectedAt: new Date(),
      rejectedById: userId,
      rejectionReason: reason,
      updatedBy: userId,
    });
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be deleted');
    }

    if (plan.totalSpend > 0) {
      await this.budgetService.releaseForPlan(id, tenantId);
    }

    await this.planRepo.softDelete(id, tenantId);
  }

  /**
   * Full KPI engine recalculation for the entire plan
   * Follows BRD hierarchy: SKU → FU → PLAN
   */
  async recalculatePlanWithKpiEngine(planId: string, tenantId: string): Promise<void> {
    const plan = await this.findById(planId, tenantId);
    if (!plan.planFus || plan.planFus.length === 0) return;

    // Get all tactics for tactic spend calculation
    const allTactics = await this.tacticRepo.find({ where: { tenantId } });
    const tacticMap = new Map(allTactics.map(t => [t.code, t]));

    const allFuResults: Array<Record<string, CalculationResult>> = [];

    for (const planFu of plan.planFus) {
      const skuResults: Array<Record<string, CalculationResult>> = [];

      // Calculate tactic spend for this FU
      const fuTacticTotalSpend = this.calculateFuTacticSpend(planFu, tacticMap);

      for (const planSku of planFu.planSkus || []) {
        const sku = planSku.sku;
        const baseVol = Number(planSku.baseVolume) || 0;
        const planVol = Number(planSku.plannedVolume) || 0;
        const unitPrice = Number(sku.unitPrice) || 0;
        const cogs = Number(sku.cogs) || 0;

        // Distribute FU tactic spend proportionally across SKUs
        const fuPlannedVolume = planFu.planSkus?.reduce((sum, s) =>
          sum + (Number(s.plannedVolume) || 0), 0) || 0;
        const skuShareRatio = fuPlannedVolume > 0 ? planVol / fuPlannedVolume : 0;
        const skuTacticSpend = fuTacticTotalSpend * skuShareRatio;

        // Build context for KPI engine
        const context: SkuCalculationContext = {
          BASE_VOL: baseVol,
          PLAN_VOL: planVol,
          BPTT: unitPrice,
          COGS: cogs,
          // Inject computed intermediary values
          INCR_VOL: planVol - baseVol,
          PLAN_TURNOVER: planVol * unitPrice,
          TACTIC_SPEND: skuTacticSpend,
          BASE_TURNOVER: baseVol * unitPrice,
          PLAN_COGS: planVol * cogs,
          GP: (planVol * unitPrice) - (planVol * cogs) - skuTacticSpend,
        };

        // Try KPI engine first
        let kpiResults: Record<string, CalculationResult>;
        try {
          kpiResults = await this.kpiEngine.calculateSku(tenantId, context);
        } catch {
          // Fallback to basic calculations if KPI engine fails
          kpiResults = {};
        }

        skuResults.push(kpiResults);

        // Extract values from KPI results or fallback
        const incrementalVolume = planVol - baseVol;
        const plannedTurnover = planVol * unitPrice;
        const plannedGp = kpiResults['GP']?.value ?? ((planVol * unitPrice) - (planVol * cogs) - skuTacticSpend);
        const gpRoi = kpiResults['GP_ROI_PCT']?.value ?? (skuTacticSpend > 0 ? (plannedGp / skuTacticSpend) * 100 : null);
        
        // RAG from KPI engine or fallback
        let ragStatus = kpiResults['GP_ROI_PCT']?.ragStatus || 'GREEN';
        if (!kpiResults['GP_ROI_PCT']) {
          if (gpRoi !== null) {
            if (gpRoi < 0) ragStatus = 'RED';
            else if (gpRoi < 15) ragStatus = 'AMBER';
          }
        }

        await this.planRepo.updatePlanSku(planSku.id, {
          incrementalVolume,
          plannedTurnover,
          tacticSpend: skuTacticSpend,
          plannedGp,
          gpRoi: gpRoi ?? undefined,
          ragStatus,
        });
      }

      // Calculate FU level using KPI engine
      let fuKpiResults: Record<string, CalculationResult>;
      try {
        fuKpiResults = await this.kpiEngine.calculateFu(
          tenantId,
          skuResults,
          planFu.tactics || {},
        );
      } catch {
        fuKpiResults = {};
      }

      // Aggregate SKU values for FU
      let fuTotalPlannedVolume = 0;
      let fuTotalGp = 0;

      for (const planSku of planFu.planSkus || []) {
        // Re-read to get updated values
        const updated = await this.planRepo.findPlanSku(planFu.id, planSku.skuId);
        if (updated) {
          fuTotalPlannedVolume += Number(updated.plannedVolume) || 0;
          fuTotalGp += Number(updated.plannedGp) || 0;
        }
      }

      const fuGpRoi = fuKpiResults['GP_ROI_PCT']?.value ?? (fuTacticTotalSpend > 0 ? (fuTotalGp / fuTacticTotalSpend) * 100 : null);
      
      let fuRagStatus = fuKpiResults['GP_ROI_PCT']?.ragStatus || 'GREEN';
      if (!fuKpiResults['GP_ROI_PCT']) {
        if (fuGpRoi !== null) {
          if (fuGpRoi < 0) fuRagStatus = 'RED';
          else if (fuGpRoi < 15) fuRagStatus = 'AMBER';
        }
      }

      await this.planRepo.updatePlanFu(planFu.id, {
        totalPlannedVolume: fuTotalPlannedVolume,
        totalSpend: fuTacticTotalSpend,
        totalGp: fuTotalGp,
        gpRoi: fuGpRoi ?? undefined,
        ragStatus: fuRagStatus,
      });

      allFuResults.push(fuKpiResults);
    }

    // Plan level aggregation
    let planTotalPlannedVolume = 0;
    let planTotalSpend = 0;
    let planTotalGp = 0;

    // Re-read FUs to get updated aggregations
    const updatedPlan = await this.findById(planId, tenantId);
    for (const planFu of updatedPlan.planFus || []) {
      planTotalPlannedVolume += Number(planFu.totalPlannedVolume) || 0;
      planTotalSpend += Number(planFu.totalSpend) || 0;
      planTotalGp += Number(planFu.totalGp) || 0;
    }

    // Plan-level KPI calculation
    let planKpiResults: Record<string, CalculationResult>;
    try {
      planKpiResults = await this.kpiEngine.calculatePlan(tenantId, allFuResults);
    } catch {
      planKpiResults = {};
    }

    const overallRoi = planKpiResults['GP_ROI_PCT']?.value ?? (planTotalSpend > 0 ? (planTotalGp / planTotalSpend) * 100 : null);

    let planRagStatus = planKpiResults['GP_ROI_PCT']?.ragStatus || 'GREEN';
    if (!planKpiResults['GP_ROI_PCT']) {
      const fuRags = updatedPlan.planFus?.map(f => f.ragStatus).filter(Boolean) || [];
      if (fuRags.includes('RED')) planRagStatus = 'RED';
      else if (fuRags.includes('AMBER')) planRagStatus = 'AMBER';
    }

    await this.planRepo.update(planId, tenantId, {
      totalPlannedVolume: planTotalPlannedVolume,
      totalSpend: planTotalSpend,
      totalGp: planTotalGp,
      overallRoi: overallRoi ?? undefined,
      ragStatus: planRagStatus,
    });
  }

  /**
   * Calculate total tactic spend for an FU based on tactic definitions
   */
  private calculateFuTacticSpend(
    planFu: PlanFu,
    tacticMap: Map<string, Tactic>,
  ): number {
    let totalTacticSpend = 0;

    if (!planFu.tactics) return 0;

    for (const [tacticCode, value] of Object.entries(planFu.tactics)) {
      const tactic = tacticMap.get(tacticCode);

      // Calculate based on tactic type
      if (tactic?.tacticType === 'DISCOUNT' || tacticCode.includes('PCT') || tacticCode.includes('%')) {
        // Percentage-based tactic: % of planned turnover
        const plannedTurnover = planFu.planSkus?.reduce((sum, sku) => {
          return sum + ((Number(sku.plannedVolume) || 0) * (Number(sku.sku?.unitPrice) || 0));
        }, 0) || 0;
        totalTacticSpend += plannedTurnover * (value / 100);
      } else {
        // Lumpsum tactic
        totalTacticSpend += value;
      }
    }

    return totalTacticSpend;
  }

  /**
   * Calculate KPIs for a plan and return results (API endpoint)
   */
  async calculateKpis(planId: string, tenantId: string): Promise<{
    planKpis: Record<string, CalculationResult>;
    fuKpis: Array<{ fuId: string; fuName: string; kpis: Record<string, CalculationResult> }>;
  }> {
    // Trigger full recalculation
    await this.recalculatePlanWithKpiEngine(planId, tenantId);

    const plan = await this.findById(planId, tenantId);
    const allTactics = await this.tacticRepo.find({ where: { tenantId } });
    const tacticMap = new Map(allTactics.map(t => [t.code, t]));

    const fuKpis: Array<{ fuId: string; fuName: string; kpis: Record<string, CalculationResult> }> = [];

    const allFuResults: Array<Record<string, CalculationResult>> = [];

    for (const planFu of plan.planFus || []) {
      const skuResults: Array<Record<string, CalculationResult>> = [];

      const fuTacticTotalSpend = this.calculateFuTacticSpend(planFu, tacticMap);

      for (const planSku of planFu.planSkus || []) {
        const sku = planSku.sku;
        const baseVol = Number(planSku.baseVolume) || 0;
        const planVol = Number(planSku.plannedVolume) || 0;
        const unitPrice = Number(sku.unitPrice) || 0;
        const cogsVal = Number(sku.cogs) || 0;

        const fuPlannedVolume = planFu.planSkus?.reduce((sum, s) =>
          sum + (Number(s.plannedVolume) || 0), 0) || 0;
        const skuShareRatio = fuPlannedVolume > 0 ? planVol / fuPlannedVolume : 0;
        const skuTacticSpend = fuTacticTotalSpend * skuShareRatio;

        const context: SkuCalculationContext = {
          BASE_VOL: baseVol,
          PLAN_VOL: planVol,
          BPTT: unitPrice,
          COGS: cogsVal,
          INCR_VOL: planVol - baseVol,
          PLAN_TURNOVER: planVol * unitPrice,
          TACTIC_SPEND: skuTacticSpend,
          BASE_TURNOVER: baseVol * unitPrice,
          PLAN_COGS: planVol * cogsVal,
          GP: (planVol * unitPrice) - (planVol * cogsVal) - skuTacticSpend,
        };

        try {
          const kpiResults = await this.kpiEngine.calculateSku(tenantId, context);
          skuResults.push(kpiResults);
        } catch {
          skuResults.push({});
        }
      }

      let fuKpiResults: Record<string, CalculationResult>;
      try {
        fuKpiResults = await this.kpiEngine.calculateFu(
          tenantId,
          skuResults,
          planFu.tactics || {},
        );
      } catch {
        fuKpiResults = {};
      }

      fuKpis.push({
        fuId: planFu.fuId,
        fuName: planFu.fu?.name || planFu.fuId,
        kpis: fuKpiResults,
      });
      allFuResults.push(fuKpiResults);
    }

    let planKpis: Record<string, CalculationResult>;
    try {
      planKpis = await this.kpiEngine.calculatePlan(tenantId, allFuResults);
    } catch {
      planKpis = {};
    }

    return { planKpis, fuKpis };
  }

  async getAnalysis(planId: string, tenantId: string): Promise<{
    gpRoiPerformance: {
      currentRoi: number | null;
      targetRoi: number;
      incrementalGp: number;
      status: 'BELOW_TARGET' | 'ON_TARGET' | 'ABOVE_TARGET';
    };
    financialSummary: {
      totalSpend: number;
      plannedGp: number;
    };
    onOffSplit: {
      onInvoice: number;
      offInvoice: number;
      total: number;
    };
    fuRoiComparison: Array<{
      fuId: string;
      fuName: string;
      roi: number | null;
    }>;
    spendBreakdown: Array<{
      tacticCode: string;
      tacticName: string;
      spend: number;
      percentage: number;
    }>;
    volumeAnalysis: {
      baseVolume: number;
      plannedVolume: number;
      incrementalVolume: number;
      upliftPercentage: number;
      fuDetails: Array<{
        fuId: string;
        fuName: string;
        baseVolume: number;
        plannedVolume: number;
        uplift: number;
      }>;
    };
  }> {
    const plan = await this.findById(planId, tenantId);

    // Calculate base GP (from base volumes)
    let baseGp = 0;
    let baseVolume = 0;
    for (const planFu of plan.planFus || []) {
      for (const planSku of planFu.planSkus || []) {
        const sku = planSku.sku;
        const baseVol = Number(planSku.baseVolume) || 0;
        const unitPrice = Number(sku.unitPrice) || 0;
        const cogs = Number(sku.cogs) || 0;
        baseVolume += baseVol;
        baseGp += (baseVol * unitPrice) - (baseVol * cogs);
      }
    }

    const incrementalGp = Number(plan.totalGp) - baseGp;
    const currentRoi = plan.overallRoi ? Number(plan.overallRoi) : null;
    
    // Target ROI from KPI engine thresholds (if defined) or default 20%
    const targetRoi = 20.0;
    const status = currentRoi === null 
      ? 'BELOW_TARGET' 
      : currentRoi >= targetRoi 
        ? 'ABOVE_TARGET' 
        : currentRoi >= targetRoi * 0.5 
          ? 'ON_TARGET' 
          : 'BELOW_TARGET';

    // Calculate ON/OFF Invoice split from tactics
    let onInvoiceSpend = 0;
    let offInvoiceSpend = 0;
    const tacticSpendMap = new Map<string, { spend: number; name: string }>();

    const allTactics = await this.tacticRepo.find({
      where: { tenantId },
      select: ['code', 'name', 'spendType', 'tacticType'],
    });
    const tacticMap = new Map(allTactics.map(t => [t.code, t]));

    for (const planFu of plan.planFus || []) {
      if (planFu.tactics) {
        for (const [tacticCode, value] of Object.entries(planFu.tactics)) {
          const tactic = tacticMap.get(tacticCode);
          const tacticName = tactic?.name || tacticCode;
          
          let isOffInvoice = false;
          if (tactic?.spendType === 'OFF_INVOICE') {
            isOffInvoice = true;
          } else if (tactic?.spendType === 'ON_INVOICE') {
            isOffInvoice = false;
          } else {
            isOffInvoice = tacticCode.includes('OFF') || 
                          tacticCode.includes('DISPLAY') || 
                          tacticCode.includes('LUMP');
          }
          
          let tacticSpend = 0;
          if (tactic?.tacticType === 'DISCOUNT' || tacticCode.includes('PCT') || tacticCode.includes('%')) {
            const plannedTurnover = planFu.planSkus?.reduce((sum, sku) => {
              return sum + ((Number(sku.plannedVolume) || 0) * (Number(sku.sku.unitPrice) || 0));
            }, 0) || 0;
            tacticSpend = plannedTurnover * (value / 100);
          } else {
            tacticSpend = value;
          }

          if (isOffInvoice) {
            offInvoiceSpend += tacticSpend;
          } else {
            onInvoiceSpend += tacticSpend;
          }

          const existing = tacticSpendMap.get(tacticCode);
          if (existing) {
            existing.spend += tacticSpend;
          } else {
            tacticSpendMap.set(tacticCode, { spend: tacticSpend, name: tacticName });
          }
        }
      }
    }

    const fuRoiComparison = (plan.planFus || []).map(planFu => ({
      fuId: planFu.fuId,
      fuName: planFu.fu?.name || planFu.fuId,
      roi: planFu.gpRoi ? Number(planFu.gpRoi) : null,
    }));

    const totalSpendForBreakdown = Array.from(tacticSpendMap.values()).reduce((sum, val) => sum + val.spend, 0);
    const spendBreakdown = Array.from(tacticSpendMap.entries()).map(([tacticCode, data]) => ({
      tacticCode,
      tacticName: data.name,
      spend: data.spend,
      percentage: totalSpendForBreakdown > 0 ? (data.spend / totalSpendForBreakdown) * 100 : 0,
    }));

    let plannedVolume = 0;
    const fuDetails = (plan.planFus || []).map(planFu => {
      let fuBaseVolume = 0;
      let fuPlannedVolume = 0;
      
      for (const planSku of planFu.planSkus || []) {
        fuBaseVolume += Number(planSku.baseVolume) || 0;
        fuPlannedVolume += Number(planSku.plannedVolume) || 0;
      }
      
      plannedVolume += fuPlannedVolume;
      
      return {
        fuId: planFu.fuId,
        fuName: planFu.fu?.name || planFu.fuId,
        baseVolume: fuBaseVolume,
        plannedVolume: fuPlannedVolume,
        uplift: fuBaseVolume > 0 ? ((fuPlannedVolume - fuBaseVolume) / fuBaseVolume) * 100 : 0,
      };
    });

    const incrementalVolume = plannedVolume - baseVolume;
    const upliftPercentage = baseVolume > 0 ? (incrementalVolume / baseVolume) * 100 : 0;

    return {
      gpRoiPerformance: {
        currentRoi,
        targetRoi,
        incrementalGp,
        status,
      },
      financialSummary: {
        totalSpend: Number(plan.totalSpend),
        plannedGp: Number(plan.totalGp),
      },
      onOffSplit: {
        onInvoice: onInvoiceSpend,
        offInvoice: offInvoiceSpend,
        total: onInvoiceSpend + offInvoiceSpend,
      },
      fuRoiComparison,
      spendBreakdown,
      volumeAnalysis: {
        baseVolume,
        plannedVolume,
        incrementalVolume,
        upliftPercentage,
        fuDetails,
      },
    };
  }
}
