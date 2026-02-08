import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agreement, AgreementStatus, AgreementType } from '../../../../database/entities/agreement.entity';

@Injectable()
export class AgreementRepository {
  constructor(
    @InjectRepository(Agreement)
    private readonly repo: Repository<Agreement>,
  ) {}

  async create(data: Partial<Agreement>): Promise<Agreement> {
    const agreement = this.repo.create(data);
    return this.repo.save(agreement);
  }

  async findById(id: string, tenantId: string): Promise<Agreement | null> {
    return this.repo.findOne({
      where: { id, tenantId },
      relations: ['cpl', 'channel', 'category', 'forecastingUnit', 'tactic', 'mechanic'],
    });
  }

  async findByCode(code: string, tenantId: string): Promise<Agreement | null> {
    return this.repo.findOne({
      where: { agreementCode: code, tenantId },
    });
  }

  async findAll(tenantId: string, filters?: {
    status?: AgreementStatus;
    cplId?: string;
    channelId?: string;
  }): Promise<Agreement[]> {
    const query = this.repo.createQueryBuilder('agreement')
      .where('agreement.tenantId = :tenantId', { tenantId })
      .andWhere('agreement.deletedAt IS NULL');

    if (filters?.status) {
      query.andWhere('agreement.status = :status', { status: filters.status });
    }
    if (filters?.cplId) {
      query.andWhere('agreement.cplId = :cplId', { cplId: filters.cplId });
    }
    if (filters?.channelId) {
      query.andWhere('agreement.channelId = :channelId', { channelId: filters.channelId });
    }

    return query.orderBy('agreement.createdAt', 'DESC').getMany();
  }

  async update(id: string, tenantId: string, data: Partial<Agreement>): Promise<Agreement> {
    await this.repo.update({ id, tenantId }, data);
    const updated = await this.findById(id, tenantId);
    if (!updated) {
      throw new Error('Agreement not found after update');
    }
    return updated;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: AgreementStatus,
    additionalFields?: Partial<Agreement>,
  ): Promise<Agreement> {
    const updateData = { status, ...additionalFields };
    return this.update(id, tenantId, updateData);
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.repo.softDelete({ id, tenantId });
  }

  async generateAgreementCode(tenantId: string, type: AgreementType): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `${type}-${year}-`;
    
    // Find the highest sequence number for this type and year
    const agreements = await this.repo
      .createQueryBuilder('agreement')
      .where('agreement.tenantId = :tenantId', { tenantId })
      .andWhere('agreement.agreementType = :type', { type })
      .andWhere('agreement.agreementCode LIKE :prefix', { prefix: `${prefix}%` })
      .andWhere('agreement.deletedAt IS NULL')
      .orderBy('agreement.agreementCode', 'DESC')
      .limit(1)
      .getOne();

    let sequence = 1;
    if (agreements && agreements.agreementCode) {
      const lastCode = agreements.agreementCode;
      const lastSequence = parseInt(lastCode.split('-')[2], 10);
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    const sequenceStr = String(sequence).padStart(3, '0');
    return `${prefix}${sequenceStr}`;
  }
}

