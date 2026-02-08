import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AgreementTransaction } from '../../../../database/entities/agreement-transaction.entity';

@Injectable()
export class AgreementTransactionRepository {
  constructor(
    @InjectRepository(AgreementTransaction)
    private readonly repo: Repository<AgreementTransaction>,
  ) {}

  async create(data: Partial<AgreementTransaction>): Promise<AgreementTransaction> {
    const transaction = this.repo.create(data);
    return this.repo.save(transaction);
  }

  async createBatch(data: Partial<AgreementTransaction>[]): Promise<AgreementTransaction[]> {
    const transactions = this.repo.create(data);
    return this.repo.save(transactions);
  }

  async findById(id: string, tenantId: string): Promise<AgreementTransaction | null> {
    return this.repo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: ['agreement'],
    });
  }

  async findByIdempotencyKey(key: string, tenantId: string): Promise<AgreementTransaction | null> {
    return this.repo.findOne({
      where: { idempotencyKey: key, tenantId, deletedAt: IsNull() },
    });
  }

  async findByAgreementId(agreementId: string, tenantId: string): Promise<AgreementTransaction[]> {
    return this.repo.find({
      where: { agreementId, tenantId, deletedAt: IsNull() },
      order: { invoiceDate: 'DESC' },
    });
  }

  async findByBatchId(batchId: string, tenantId: string): Promise<AgreementTransaction[]> {
    return this.repo.find({
      where: { batchId, tenantId, deletedAt: IsNull() },
      order: { rowNumber: 'ASC' },
    });
  }

  async findAll(tenantId: string, filters?: {
    agreementId?: string;
    batchId?: string;
    invoiceDateFrom?: Date;
    invoiceDateTo?: Date;
  }): Promise<AgreementTransaction[]> {
    const query = this.repo.createQueryBuilder('tx')
      .leftJoinAndSelect('tx.agreement', 'agreement')
      .where('tx.tenantId = :tenantId', { tenantId })
      .andWhere('tx.deletedAt IS NULL');

    if (filters?.agreementId) {
      query.andWhere('tx.agreementId = :agreementId', { agreementId: filters.agreementId });
    }
    if (filters?.batchId) {
      query.andWhere('tx.batchId = :batchId', { batchId: filters.batchId });
    }
    if (filters?.invoiceDateFrom) {
      query.andWhere('tx.invoiceDate >= :invoiceDateFrom', { invoiceDateFrom: filters.invoiceDateFrom });
    }
    if (filters?.invoiceDateTo) {
      query.andWhere('tx.invoiceDate <= :invoiceDateTo', { invoiceDateTo: filters.invoiceDateTo });
    }

    return query.orderBy('tx.invoiceDate', 'DESC').getMany();
  }

  async sumByAgreementId(agreementId: string, tenantId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.agreementId = :agreementId', { agreementId })
      .andWhere('tx.tenantId = :tenantId', { tenantId })
      .andWhere('tx.deletedAt IS NULL')
      .getRawOne();
    return parseFloat(result.total) || 0;
  }
}

