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
import { ApprovalService } from '../../../shared/approval/approval.service';
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
          const timestamp = Date.now().toString().slice(-4); // Last 4 digits of timestamp
          planCode = `${planCode}-${timestamp}`;
        }

        // Check if code already exists
        const existing = await this.planRepo.findByCode(planCode, tenantId);
        if (existing) {
          // Wait a bit before retrying
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
        
        // If duplicate key error, retry with new code
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
          // Wait before retrying (exponential backoff)
          if (attempt < maxAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
            continue;
          }
        }
        
        // If not a duplicate key error or max attempts reached, throw
        if (attempt === maxAttempts - 1 || (error.code !== '23505' && !error.message?.includes('duplicate key'))) {
          throw error;
        }
      }
    }

    // If we get here, all attempts failed
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

    // Only DRAFT plans can be edited
    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be edited');
    }

    // Update period month if start date changed
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

    // Recalculate plan totals
    await this.recalculatePlan(planId, tenantId);

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

    // Recalculate FU and SKU values
    await this.recalculateFu(planFu.id, tenantId);
    await this.recalculatePlan(planId, tenantId);

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

    // Recalculate SKU, FU, and Plan
    await this.recalculateSku(planSku.id, tenantId);
    await this.recalculateFu(planFu.id, tenantId);
    await this.recalculatePlan(planId, tenantId);

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
    await this.recalculatePlan(planId, tenantId);
  }

  async submit(id: string, tenantId: string, userId: string): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be submitted');
    }

    // Validate plan has at least one FU
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

    // Update plan with approval request ID and status
    return this.planRepo.updateStatus(id, tenantId, PlanStatus.PENDING_APPROVAL, {
      approvalRequestId: approvalRequest.id,
      updatedBy: userId,
    });
  }

  async approve(id: string, tenantId: string, userId: string, comments?: string): Promise<Plan> {
    const plan = await this.findById(id, tenantId);

    if (plan.status !== PlanStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only PENDING_APPROVAL plans can be approved');
    }

    if (!plan.approvalRequestId) {
      throw new BadRequestException('Approval request not found');
    }

    // Create budget reservation
    try {
      await this.budgetService.reserveForPlan(
        plan.id,
        plan.totalSpend,
        plan.channel.code,
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

    // Update plan status
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

    // Update approval request
    await this.approvalService.reject(
      plan.approvalRequestId,
      tenantId,
      userId,
      { reason },
    );

    // Update plan status back to DRAFT
    return this.planRepo.updateStatus(id, tenantId, PlanStatus.REJECTED, {
      rejectedAt: new Date(),
      rejectedById: userId,
      rejectionReason: reason,
      updatedBy: userId,
    });
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const plan = await this.findById(id, tenantId);

    // Only allow deletion of DRAFT plans
    if (plan.status !== PlanStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT plans can be deleted');
    }

    // Release budget reservations if any
    if (plan.totalSpend > 0) {
      await this.budgetService.releaseForPlan(id, tenantId);
    }

    // Soft delete the plan
    await this.planRepo.softDelete(id, tenantId);
  }

  // Recalculation methods (simplified - will be replaced with KPI engine)
  private async recalculateSku(planSkuId: string, tenantId: string): Promise<void> {
    const planSku = await this.planRepo['planSkuRepo'].findOne({
      where: { id: planSkuId },
      relations: ['sku', 'planFu'],
    });

    if (!planSku) return;

    const sku = planSku.sku;
    const plannedVolume = planSku.plannedVolume || 0;
    const unitPrice = sku.unitPrice || 0;
    const cogs = sku.cogs || 0;

    // Calculate basic KPIs
    const plannedTurnover = plannedVolume * unitPrice;
    const tacticSpend = 0; // Will be calculated from FU tactics
    const plannedGp = plannedTurnover - (plannedVolume * cogs) - tacticSpend;
    const gpRoi = tacticSpend > 0 ? (plannedGp / tacticSpend) * 100 : null;

    // Determine RAG status (simplified - will use KPI engine)
    let ragStatus = 'GREEN';
    if (gpRoi !== null) {
      if (gpRoi < 0) ragStatus = 'RED';
      else if (gpRoi < 15) ragStatus = 'AMBER';
    }

    await this.planRepo['planSkuRepo'].update(
      { id: planSkuId },
      {
        plannedTurnover,
        tacticSpend,
        plannedGp,
        gpRoi: gpRoi ?? undefined,
        ragStatus,
      },
    );
  }

  private async recalculateFu(planFuId: string, tenantId: string): Promise<void> {
    const planFu = await this.planRepo['planFuRepo'].findOne({
      where: { id: planFuId },
      relations: ['planSkus'],
    });

    if (!planFu) return;

    // Aggregate SKU values
    let totalPlannedVolume = 0;
    let totalSpend = 0;
    let totalGp = 0;

    for (const planSku of planFu.planSkus || []) {
      totalPlannedVolume += planSku.plannedVolume || 0;
      totalSpend += planSku.tacticSpend || 0;
      totalGp += planSku.plannedGp || 0;
    }

    const gpRoi = totalSpend > 0 ? (totalGp / totalSpend) * 100 : null;

    // Determine RAG status (aggregate from SKUs)
    const skuRags = planFu.planSkus?.map(s => s.ragStatus).filter(Boolean) || [];
    let ragStatus = 'GREEN';
    if (skuRags.includes('RED')) ragStatus = 'RED';
    else if (skuRags.includes('AMBER')) ragStatus = 'AMBER';

    await this.planRepo['planFuRepo'].update(
      { id: planFuId },
      {
        totalPlannedVolume,
        totalSpend,
        totalGp,
        gpRoi: gpRoi ?? undefined,
        ragStatus,
      },
    );
  }

  private async recalculatePlan(planId: string, tenantId: string): Promise<void> {
    const plan = await this.findById(planId, tenantId);

    // Aggregate FU values
    let totalPlannedVolume = 0;
    let totalSpend = 0;
    let totalGp = 0;

    for (const planFu of plan.planFus || []) {
      totalPlannedVolume += planFu.totalPlannedVolume || 0;
      totalSpend += planFu.totalSpend || 0;
      totalGp += planFu.totalGp || 0;
    }

    const overallRoi = totalSpend > 0 ? (totalGp / totalSpend) * 100 : null;

    // Determine RAG status (aggregate from FUs)
    const fuRags = plan.planFus?.map(f => f.ragStatus).filter(Boolean) || [];
    let ragStatus = 'GREEN';
    if (fuRags.includes('RED')) ragStatus = 'RED';
    else if (fuRags.includes('AMBER')) ragStatus = 'AMBER';

    await this.planRepo.update(planId, tenantId, {
      totalPlannedVolume,
      totalSpend,
      totalGp,
      overallRoi: overallRoi ?? undefined,
      ragStatus,
    });
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
        const baseVol = planSku.baseVolume || 0;
        const unitPrice = sku.unitPrice || 0;
        const cogs = sku.cogs || 0;
        baseVolume += baseVol;
        baseGp += (baseVol * unitPrice) - (baseVol * cogs);
      }
    }

    const incrementalGp = plan.totalGp - baseGp;
    const currentRoi = plan.overallRoi || null;
    
    // Target ROI: Default 20% (will be configurable from KPI config)
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

    // Get all tactics for this tenant to map codes to names and spend types
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
          
          // Determine spend type from tactic entity or fallback to code analysis
          let isOffInvoice = false;
          if (tactic?.spendType === 'OFF_INVOICE') {
            isOffInvoice = true;
          } else if (tactic?.spendType === 'ON_INVOICE') {
            isOffInvoice = false;
          } else {
            // Fallback: analyze code
            isOffInvoice = tacticCode.includes('OFF') || 
                          tacticCode.includes('DISPLAY') || 
                          tacticCode.includes('LUMP');
          }
          
          // Calculate spend from tactic value
          let tacticSpend = 0;
          if (tactic?.tacticType === 'DISCOUNT' || tacticCode.includes('PCT') || tacticCode.includes('%')) {
            // Percentage-based: calculate from planned turnover
            const plannedTurnover = planFu.planSkus?.reduce((sum, sku) => {
              return sum + ((sku.plannedVolume || 0) * (sku.sku.unitPrice || 0));
            }, 0) || 0;
            tacticSpend = plannedTurnover * (value / 100);
          } else {
            // Lumpsum
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

    // FU ROI Comparison
    const fuRoiComparison = (plan.planFus || []).map(planFu => ({
      fuId: planFu.fuId,
      fuName: planFu.fu.name,
      roi: planFu.gpRoi || null,
    }));

    // Spend Breakdown by Tactic
    const totalSpendForBreakdown = Array.from(tacticSpendMap.values()).reduce((sum, val) => sum + val.spend, 0);
    const spendBreakdown = Array.from(tacticSpendMap.entries()).map(([tacticCode, data]) => ({
      tacticCode,
      tacticName: data.name,
      spend: data.spend,
      percentage: totalSpendForBreakdown > 0 ? (data.spend / totalSpendForBreakdown) * 100 : 0,
    }));

    // Volume Analysis
    let plannedVolume = 0;
    const fuDetails = (plan.planFus || []).map(planFu => {
      let fuBaseVolume = 0;
      let fuPlannedVolume = 0;
      
      for (const planSku of planFu.planSkus || []) {
        fuBaseVolume += planSku.baseVolume || 0;
        fuPlannedVolume += planSku.plannedVolume || 0;
      }
      
      plannedVolume += fuPlannedVolume;
      
      return {
        fuId: planFu.fuId,
        fuName: planFu.fu.name,
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
        totalSpend: plan.totalSpend,
        plannedGp: plan.totalGp,
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
