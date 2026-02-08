import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { LedgerEntry } from '../../../../database/entities/ledger-entry.entity';

@Injectable()
export class LedgerRepository {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly repo: Repository<LedgerEntry>,
  ) {}

  async create(data: Partial<LedgerEntry>): Promise<LedgerEntry> {
    const entry = this.repo.create(data);
    return this.repo.save(entry);
  }

  async findById(id: string, tenantId: string): Promise<LedgerEntry | null> {
    return this.repo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
  }

  async findByIdempotencyKey(key: string, tenantId: string): Promise<LedgerEntry | null> {
    return this.repo.findOne({
      where: { idempotencyKey: key, tenantId, deletedAt: IsNull() },
    });
  }

  async findByAgreementId(agreementId: string, tenantId: string): Promise<LedgerEntry[]> {
    return this.repo.find({
      where: { agreementId, tenantId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async findByEnvelopeId(envelopeId: string, tenantId: string): Promise<LedgerEntry[]> {
    return this.repo.find({
      where: { budgetEnvelopeId: envelopeId, tenantId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(tenantId: string, filters?: {
    agreementId?: string;
    budgetEnvelopeId?: string;
    periodMonth?: string;
    spendType?: string;
  }): Promise<LedgerEntry[]> {
    const query = this.repo.createQueryBuilder('ledger')
      .where('ledger.tenantId = :tenantId', { tenantId })
      .andWhere('ledger.deletedAt IS NULL');

    if (filters?.agreementId) {
      query.andWhere('ledger.agreementId = :agreementId', { agreementId: filters.agreementId });
    }
    if (filters?.budgetEnvelopeId) {
      query.andWhere('ledger.budgetEnvelopeId = :budgetEnvelopeId', { budgetEnvelopeId: filters.budgetEnvelopeId });
    }
    if (filters?.periodMonth) {
      query.andWhere('ledger.periodMonth = :periodMonth', { periodMonth: filters.periodMonth });
    }
    if (filters?.spendType) {
      query.andWhere('ledger.spendType = :spendType', { spendType: filters.spendType });
    }

    return query.orderBy('ledger.createdAt', 'DESC').getMany();
  }

  async sumByAgreementId(agreementId: string, tenantId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('ledger')
      .select('COALESCE(SUM(ledger.amount), 0)', 'total')
      .where('ledger.agreementId = :agreementId', { agreementId })
      .andWhere('ledger.tenantId = :tenantId', { tenantId })
      .andWhere('ledger.deletedAt IS NULL')
      .getRawOne();
    return parseFloat(result.total) || 0;
  }

  async sumByEnvelopeId(envelopeId: string, tenantId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('ledger')
      .select('COALESCE(SUM(ledger.amount), 0)', 'total')
      .where('ledger.budgetEnvelopeId = :envelopeId', { envelopeId })
      .andWhere('ledger.tenantId = :tenantId', { tenantId })
      .andWhere('ledger.deletedAt IS NULL')
      .getRawOne();
    return parseFloat(result.total) || 0;
  }
}

