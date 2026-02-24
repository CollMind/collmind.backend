import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { LTAAgreement, LTAAgreementStatus } from '../../../database/entities/lta-agreement.entity';

@Injectable()
export class LTAAgreementRepository {
  constructor(
    @InjectRepository(LTAAgreement)
    private readonly repository: Repository<LTAAgreement>,
  ) {}

  async findByCode(tenantId: string, agreementCode: string): Promise<LTAAgreement | null> {
    return this.repository.findOne({
      where: { tenantId, agreementCode },
      relations: ['cpl', 'rates', 'rates.channelEntity', 'rates.categoryEntity'],
    });
  }

  async findById(tenantId: string, id: string): Promise<LTAAgreement | null> {
    return this.repository.findOne({
      where: { tenantId, id },
      relations: ['cpl', 'rates', 'rates.channelEntity', 'rates.categoryEntity', 'planOverrides'],
    });
  }

  async findAllByTenant(tenantId: string, status?: LTAAgreementStatus): Promise<LTAAgreement[]> {
    const where: any = { tenantId };
    if (status) {
      where.status = status;
    }
    return this.repository.find({
      where,
      relations: ['cpl', 'rates'],
      order: { effectiveDate: 'DESC' },
    });
  }

  async findActiveForCPL(
    tenantId: string,
    cplId: string,
    date: Date,
  ): Promise<LTAAgreement | null> {
    return this.repository
      .createQueryBuilder('lta')
      .where('lta.tenantId = :tenantId', { tenantId })
      .andWhere('lta.cplId = :cplId', { cplId })
      .andWhere('lta.status = :status', { status: LTAAgreementStatus.ACTIVE })
      .andWhere('lta.effectiveDate <= :date', { date })
      .andWhere('(lta.expiryDate IS NULL OR lta.expiryDate >= :date)', { date })
      .leftJoinAndSelect('lta.cpl', 'cpl')
      .leftJoinAndSelect('lta.rates', 'rates')
      .leftJoinAndSelect('rates.channelEntity', 'channelEntity')
      .leftJoinAndSelect('rates.categoryEntity', 'categoryEntity')
      .orderBy('lta.effectiveDate', 'DESC')
      .getOne();
  }

  async findOverlappingAgreements(
    tenantId: string,
    cplId: string,
    effectiveDate: Date,
    expiryDate: Date | null,
    excludeId?: string,
  ): Promise<LTAAgreement[]> {
    const query = this.repository
      .createQueryBuilder('lta')
      .where('lta.tenantId = :tenantId', { tenantId })
      .andWhere('lta.cplId = :cplId', { cplId })
      .andWhere('lta.status != :terminated', { terminated: LTAAgreementStatus.TERMINATED })
      .andWhere(
        `(
          (lta.effectiveDate <= :effectiveDate AND (lta.expiryDate IS NULL OR lta.expiryDate >= :effectiveDate))
          OR
          (:expiryDate IS NOT NULL AND lta.effectiveDate <= :expiryDate AND (lta.expiryDate IS NULL OR lta.expiryDate >= :expiryDate))
          OR
          (lta.effectiveDate >= :effectiveDate AND (lta.expiryDate IS NULL OR (:expiryDate IS NOT NULL AND lta.expiryDate <= :expiryDate)))
        )`,
        { effectiveDate, expiryDate },
      );

    if (excludeId) {
      query.andWhere('lta.id != :excludeId', { excludeId });
    }

    return query.getMany();
  }

  create(entity: Partial<LTAAgreement>): LTAAgreement {
    return this.repository.create(entity);
  }

  async save(entity: LTAAgreement): Promise<LTAAgreement> {
    return this.repository.save(entity);
  }

  async softRemove(entity: LTAAgreement): Promise<LTAAgreement> {
    return this.repository.softRemove(entity);
  }
}
