import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Plan,
  PlanStatus,
  PlanFu,
  PlanSku,
} from '../../../../database/entities/plan.entity';
import {
  AccessScopeService,
  EffectiveScope,
} from '../../../shared/access-scope/access-scope.service';

@Injectable()
export class PlanRepository {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(PlanFu)
    private readonly planFuRepo: Repository<PlanFu>,
    @InjectRepository(PlanSku)
    private readonly planSkuRepo: Repository<PlanSku>,
    private readonly accessScope: AccessScopeService,
  ) {}

  async create(data: Partial<Plan>): Promise<Plan> {
    const plan = this.planRepo.create(data);
    return this.planRepo.save(plan);
  }

  async findById(id: string, tenantId: string): Promise<Plan | null> {
    return this.planRepo.findOne({
      where: { id, tenantId },
      relations: [
        'cpl',
        'channel',
        'category',
        'region',
        'planFus',
        'planFus.fu',
        'planFus.planSkus',
        'planFus.planSkus.sku',
        'planFus.planMechanicValues',
        'approvedBy',
        'rejectedBy',
        // 'submittedBy', // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
        // 'escalatedBy', // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
      ],
    });
  }

  async findByCode(code: string, tenantId: string): Promise<Plan | null> {
    return this.planRepo.findOne({
      where: { planCode: code, tenantId },
    });
  }

  async findAll(
    tenantId: string,
    filters?: {
      status?: PlanStatus;
      cplId?: string;
      channelId?: string;
      categoryId?: string;
    },
    /**
     * T-028b: CM kategori-scoped okuma (docs/analysis/0004-rbac-brd-alignment.md
     * §3). Yalnızca çağıran taraf (PlanService) SCOPED bir scope geçtiğinde
     * uygulanır — UNRESTRICTED için no-op, undefined için de no-op (geriye
     * uyumlu; PLANNER enforcement T-028c'nin işi, burada bilerek dokunulmadı).
     */
    scope?: EffectiveScope,
  ): Promise<Plan[]> {
    const query = this.planRepo
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .andWhere('plan.deletedAt IS NULL');

    if (filters?.status) {
      query.andWhere('plan.status = :status', { status: filters.status });
    }
    if (filters?.cplId) {
      query.andWhere('plan.cplId = :cplId', { cplId: filters.cplId });
    }
    if (filters?.channelId) {
      query.andWhere('plan.channelId = :channelId', {
        channelId: filters.channelId,
      });
    }
    if (filters?.categoryId) {
      query.andWhere('plan.categoryId = :categoryId', {
        categoryId: filters.categoryId,
      });
    }
    if (scope) {
      this.accessScope.applyToQueryBuilder(query, 'plan', scope);
    }

    return (
      query
        .leftJoinAndSelect('plan.cpl', 'cpl')
        .leftJoinAndSelect('plan.channel', 'channel')
        .leftJoinAndSelect('plan.category', 'category')
        // .leftJoinAndSelect('plan.submittedBy', 'submittedBy') // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
        // .leftJoinAndSelect('plan.escalatedBy', 'escalatedBy') // TODO: Uncomment after migration AddApprovalWorkflowFieldsToPlans is run
        .leftJoinAndSelect('plan.approvedBy', 'approvedBy')
        .leftJoinAndSelect('plan.rejectedBy', 'rejectedBy')
        .leftJoinAndSelect('plan.planFus', 'planFus')
        .leftJoinAndSelect('planFus.fu', 'fu')
        .leftJoinAndSelect('planFus.planSkus', 'planSkus')
        .leftJoinAndSelect('planSkus.sku', 'sku')
        .orderBy('plan.createdAt', 'DESC')
        .getMany()
    );
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<Plan>,
  ): Promise<Plan> {
    await this.planRepo.update({ id, tenantId }, data);
    const updated = await this.findById(id, tenantId);
    if (!updated) {
      throw new Error('Plan not found after update');
    }
    return updated;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: PlanStatus,
    additionalFields?: Partial<Plan>,
  ): Promise<Plan> {
    const updateData = { status, ...additionalFields };
    return this.update(id, tenantId, updateData);
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.planRepo.softDelete({ id, tenantId });
  }

  async generatePlanCode(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const quarter = Math.ceil(month / 3);
    const prefix = `PLAN-${year}-Q${quarter}-`;

    // Find the highest sequence number for this quarter and year
    const plans = await this.planRepo
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .andWhere('plan.planCode LIKE :prefix', { prefix: `${prefix}%` })
      .andWhere('plan.deletedAt IS NULL')
      .orderBy('plan.planCode', 'DESC')
      .limit(1)
      .getOne();

    let sequence = 1;
    if (plans && plans.planCode) {
      const lastCode = plans.planCode;
      // Handle both formats: PLAN-2026-Q1-001 and PLAN-2026-Q1-001-1234
      const codeWithoutSuffix = lastCode.split('-').slice(0, 4).join('-');
      const parts = codeWithoutSuffix.split('-');
      if (parts.length >= 4) {
        const lastSequence = parseInt(parts[3], 10);
        if (!isNaN(lastSequence)) {
          sequence = lastSequence + 1;
        }
      }
    }

    // Add timestamp suffix to ensure uniqueness (last 4 digits)
    const timestamp = Date.now().toString().slice(-4);
    const sequenceStr = String(sequence).padStart(3, '0');
    return `${prefix}${sequenceStr}-${timestamp}`;
  }

  // PlanFU methods
  async addFu(
    planId: string,
    fuId: string,
    tenantId: string,
    userId: string,
    tactics?: Record<string, number>,
  ): Promise<PlanFu> {
    const planFu = this.planFuRepo.create({
      planId,
      fuId,
      tenantId,
      createdBy: userId,
      tactics,
      totalPlannedVolume: 0,
      totalSpend: 0,
      totalGp: 0,
    });
    return this.planFuRepo.save(planFu);
  }

  async findPlanFu(planId: string, fuId: string): Promise<PlanFu | null> {
    return this.planFuRepo.findOne({
      where: { planId, fuId },
      relations: ['fu', 'planSkus', 'planSkus.sku'],
    });
  }

  async updatePlanFu(planFuId: string, data: Partial<PlanFu>): Promise<PlanFu> {
    await this.planFuRepo.update({ id: planFuId }, data);
    const updated = await this.planFuRepo.findOne({
      where: { id: planFuId },
      relations: ['fu', 'planSkus', 'planSkus.sku'],
    });
    if (!updated) {
      throw new Error('PlanFU not found after update');
    }
    return updated;
  }

  async removeFu(planFuId: string): Promise<void> {
    await this.planFuRepo.delete({ id: planFuId });
  }

  // PlanSKU methods
  async addSku(
    planFuId: string,
    skuId: string,
    tenantId: string,
    userId: string,
    baseVolume?: number,
    plannedVolume?: number,
  ): Promise<PlanSku> {
    const planSku = this.planSkuRepo.create({
      planFuId,
      skuId,
      tenantId,
      createdBy: userId,
      baseVolume,
      plannedVolume,
      incrementalVolume:
        plannedVolume && baseVolume ? plannedVolume - baseVolume : 0,
    });
    return this.planSkuRepo.save(planSku);
  }

  async findPlanSku(planFuId: string, skuId: string): Promise<PlanSku | null> {
    return this.planSkuRepo.findOne({
      where: { planFuId, skuId },
      relations: ['sku', 'planFu'],
    });
  }

  async updatePlanSku(
    planSkuId: string,
    data: Partial<PlanSku>,
  ): Promise<PlanSku> {
    await this.planSkuRepo.update({ id: planSkuId }, data);
    const updated = await this.planSkuRepo.findOne({
      where: { id: planSkuId },
      relations: ['sku', 'planFu'],
    });
    if (!updated) {
      throw new Error('PlanSKU not found after update');
    }
    return updated;
  }

  async removeSku(planSkuId: string): Promise<void> {
    await this.planSkuRepo.delete({ id: planSkuId });
  }
}
