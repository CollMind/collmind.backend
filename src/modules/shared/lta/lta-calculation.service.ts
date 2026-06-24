import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanSku } from '../../../database/entities/plan.entity';
import { Sku } from '../../../database/entities/sku.entity';
import { LTAAgreementService } from './lta-agreement.service';
import { LTASpendBreakdown } from './dto/lta-context.dto';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';
import { LTAContext } from './dto/lta-context.dto';

@Injectable()
export class LTACalculationService {
  constructor(
    @InjectRepository(PlanSku)
    private readonly planSkuRepository: Repository<PlanSku>,
    @InjectRepository(Sku)
    private readonly skuRepository: Repository<Sku>,
    private readonly ltaAgreementService: LTAAgreementService,
  ) {}

  async calculateBaseLTASpend(
    tenantId: string,
    planId: string,
    skuId: string,
    planContext: PlanContextDto,
  ): Promise<LTASpendBreakdown> {
    // Get plan SKU
    const planSku = await this.planSkuRepository
      .createQueryBuilder('planSku')
      .leftJoinAndSelect('planSku.sku', 'sku')
      .leftJoinAndSelect('planSku.planFu', 'planFu')
      .leftJoinAndSelect('planFu.plan', 'plan')
      .where('planSku.tenantId = :tenantId', { tenantId })
      .andWhere('planSku.skuId = :skuId', { skuId })
      .andWhere('plan.id = :planId', { planId })
      .getOne();

    if (!planSku) {
      throw new Error(
        `Plan SKU not found for planId: ${planId}, skuId: ${skuId}`,
      );
    }

    const sku = planSku.sku;
    const baseVolume = planSku.baseVolume || 0;
    const listPrice = sku.unitPrice || 0;

    // Calculate Base GSV
    const baseGsv = baseVolume * listPrice;

    // Get LTA context (with planId for override check)
    const ltaContext = await this.ltaAgreementService.getLTAForPlanContext(
      tenantId,
      planContext,
      planId,
    );

    if (!ltaContext) {
      // No LTA, return zeros
      return {
        baseLtaOnInvoiceSpend: 0,
        baseLtaOffInvoiceSpend: 0,
        plannedLtaOnInvoiceSpend: 0,
        plannedLtaOffInvoiceSpend: 0,
        baseGsv: 0,
        plannedGsv: 0,
        baseVolume: 0,
        plannedVolume: 0,
        listPrice: 0,
      };
    }

    // Calculate Base LTA On-Invoice
    // Base GSV * On-Invoice % = Base LTA On-Invoice
    const baseLtaOnInvoiceSpend =
      (baseGsv * ltaContext.finalOnInvoicePct) / 100;

    // Calculate Base LTA Off-Invoice
    // (Base GSV - Base LTA On-Invoice) * Off-Invoice % = Base LTA Off-Invoice
    const baseLtaOffInvoiceSpend =
      ((baseGsv - baseLtaOnInvoiceSpend) * ltaContext.finalOffInvoicePct) / 100;

    return {
      baseLtaOnInvoiceSpend,
      baseLtaOffInvoiceSpend,
      plannedLtaOnInvoiceSpend: 0, // Will be calculated separately
      plannedLtaOffInvoiceSpend: 0, // Will be calculated separately
      baseGsv,
      plannedGsv: 0, // Will be calculated separately
      baseVolume,
      plannedVolume: 0, // Will be calculated separately
      listPrice,
    };
  }

  async calculatePlannedLTASpend(
    tenantId: string,
    planId: string,
    skuId: string,
    planContext: PlanContextDto,
  ): Promise<LTASpendBreakdown> {
    // Get plan SKU
    const planSku = await this.planSkuRepository
      .createQueryBuilder('planSku')
      .leftJoinAndSelect('planSku.sku', 'sku')
      .leftJoinAndSelect('planSku.planFu', 'planFu')
      .leftJoinAndSelect('planFu.plan', 'plan')
      .where('planSku.tenantId = :tenantId', { tenantId })
      .andWhere('planSku.skuId = :skuId', { skuId })
      .andWhere('plan.id = :planId', { planId })
      .getOne();

    if (!planSku) {
      throw new Error(
        `Plan SKU not found for planId: ${planId}, skuId: ${skuId}`,
      );
    }

    const sku = planSku.sku;
    const plannedVolume = planSku.plannedVolume || 0;
    const listPrice = sku.unitPrice || 0;

    // Calculate Planned GSV
    const plannedGsv = plannedVolume * listPrice;

    // Get LTA context (with planId for override check)
    const ltaContext = await this.ltaAgreementService.getLTAForPlanContext(
      tenantId,
      planContext,
      planId,
    );

    if (!ltaContext) {
      // No LTA, return zeros
      return {
        baseLtaOnInvoiceSpend: 0,
        baseLtaOffInvoiceSpend: 0,
        plannedLtaOnInvoiceSpend: 0,
        plannedLtaOffInvoiceSpend: 0,
        baseGsv: 0,
        plannedGsv: 0,
        baseVolume: 0,
        plannedVolume: 0,
        listPrice: 0,
      };
    }

    // Calculate Planned LTA On-Invoice
    // Planned GSV * On-Invoice % = Planned LTA On-Invoice
    const plannedLtaOnInvoiceSpend =
      (plannedGsv * ltaContext.finalOnInvoicePct) / 100;

    // Calculate Planned LTA Off-Invoice
    // (Planned GSV - Planned LTA On-Invoice) * Off-Invoice % = Planned LTA Off-Invoice
    const plannedLtaOffInvoiceSpend =
      ((plannedGsv - plannedLtaOnInvoiceSpend) *
        ltaContext.finalOffInvoicePct) /
      100;

    return {
      baseLtaOnInvoiceSpend: 0, // Will be calculated separately
      baseLtaOffInvoiceSpend: 0, // Will be calculated separately
      plannedLtaOnInvoiceSpend,
      plannedLtaOffInvoiceSpend,
      baseGsv: 0, // Will be calculated separately
      plannedGsv,
      baseVolume: 0, // Will be calculated separately
      plannedVolume,
      listPrice,
    };
  }

  async getLTAForPlanContext(
    tenantId: string,
    planContext: PlanContextDto,
  ): Promise<LTAContext | null> {
    return this.ltaAgreementService.getLTAForPlanContext(tenantId, planContext);
  }
}
