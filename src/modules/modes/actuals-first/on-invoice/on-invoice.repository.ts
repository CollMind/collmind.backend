import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { OnInvoiceEntry } from '../../../../database/entities/on-invoice-entry.entity';
import { OnInvoiceBatch } from '../../../../database/entities/on-invoice-batch.entity';

@Injectable()
export class OnInvoiceRepository {
  constructor(
    @InjectRepository(OnInvoiceEntry)
    private readonly entryRepo: Repository<OnInvoiceEntry>,
    @InjectRepository(OnInvoiceBatch)
    private readonly batchRepo: Repository<OnInvoiceBatch>,
  ) {}

  // Batch operations
  async createBatch(data: Partial<OnInvoiceBatch>): Promise<OnInvoiceBatch> {
    const batch = this.batchRepo.create(data);
    return this.batchRepo.save(batch);
  }

  async updateBatch(
    id: string,
    data: Partial<OnInvoiceBatch>,
    tenantId: string,
  ): Promise<OnInvoiceBatch> {
    await this.batchRepo.update(id, data);
    const batch = await this.findById(id, tenantId);
    if (!batch) {
      throw new Error('Batch not found after update');
    }
    return batch;
  }

  async findById(id: string, tenantId: string): Promise<OnInvoiceBatch | null> {
    return this.batchRepo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: ['entries'],
    });
  }

  async findByBatchCode(
    batchCode: string,
    tenantId: string,
  ): Promise<OnInvoiceBatch | null> {
    return this.batchRepo.findOne({
      where: { batchCode, tenantId, deletedAt: IsNull() },
      relations: ['entries'],
    });
  }

  async findAllBatches(
    tenantId: string,
    filters?: {
      fiscalPeriod?: string;
      status?: string;
    },
  ): Promise<OnInvoiceBatch[]> {
    const query = this.batchRepo
      .createQueryBuilder('batch')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.deletedAt IS NULL');

    if (filters?.fiscalPeriod) {
      query.andWhere('batch.fiscalPeriod = :fiscalPeriod', {
        fiscalPeriod: filters.fiscalPeriod,
      });
    }
    if (filters?.status) {
      query.andWhere('batch.status = :status', { status: filters.status });
    }

    return query.orderBy('batch.createdAt', 'DESC').getMany();
  }

  // Entry operations
  async createEntry(data: Partial<OnInvoiceEntry>): Promise<OnInvoiceEntry> {
    const entry = this.entryRepo.create(data);
    return this.entryRepo.save(entry);
  }

  async createEntriesBatch(
    data: Partial<OnInvoiceEntry>[],
  ): Promise<OnInvoiceEntry[]> {
    const entries = this.entryRepo.create(data);
    return this.entryRepo.save(entries);
  }

  async findEntryById(
    id: string,
    tenantId: string,
  ): Promise<OnInvoiceEntry | null> {
    return this.entryRepo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: ['customer', 'sku', 'batch', 'budgetEnvelope'],
    });
  }

  async findEntriesByBatchId(
    batchId: string,
    tenantId: string,
  ): Promise<OnInvoiceEntry[]> {
    return this.entryRepo.find({
      where: { batchId, tenantId, deletedAt: IsNull() },
      relations: ['customer', 'sku'],
      order: { rowNumber: 'ASC' },
    });
  }

  async findByIdempotencyKey(
    key: string,
    tenantId: string,
  ): Promise<OnInvoiceEntry | null> {
    return this.entryRepo.findOne({
      where: { idempotencyKey: key, tenantId, deletedAt: IsNull() },
    });
  }

  async findAllEntries(
    tenantId: string,
    filters?: {
      batchId?: string;
      customerId?: string;
      skuId?: string;
      fiscalPeriod?: string;
      discountType?: string;
      invoiceDateFrom?: Date;
      invoiceDateTo?: Date;
      status?: string;
    },
  ): Promise<OnInvoiceEntry[]> {
    try {
      const query = this.entryRepo
        .createQueryBuilder('entry')
        .leftJoinAndSelect('entry.customer', 'customer')
        .leftJoinAndSelect('entry.sku', 'sku')
        .leftJoinAndSelect('entry.batch', 'batch')
        .where('entry.tenantId = :tenantId', { tenantId })
        .andWhere('entry.deletedAt IS NULL');

      if (filters?.batchId) {
        query.andWhere('entry.batchId = :batchId', {
          batchId: filters.batchId,
        });
      }
      if (filters?.customerId) {
        query.andWhere('entry.customerId = :customerId', {
          customerId: filters.customerId,
        });
      }
      if (filters?.skuId) {
        query.andWhere('entry.skuId = :skuId', { skuId: filters.skuId });
      }
      if (filters?.fiscalPeriod) {
        query.andWhere('entry.fiscalPeriod = :fiscalPeriod', {
          fiscalPeriod: filters.fiscalPeriod,
        });
      }
      if (filters?.discountType) {
        query.andWhere('entry.discountType = :discountType', {
          discountType: filters.discountType,
        });
      }
      if (filters?.invoiceDateFrom) {
        query.andWhere('entry.invoiceDate >= :invoiceDateFrom', {
          invoiceDateFrom: filters.invoiceDateFrom,
        });
      }
      if (filters?.invoiceDateTo) {
        query.andWhere('entry.invoiceDate <= :invoiceDateTo', {
          invoiceDateTo: filters.invoiceDateTo,
        });
      }
      if (filters?.status) {
        query.andWhere('entry.status = :status', { status: filters.status });
      }

      return await query.orderBy('entry.invoiceDate', 'DESC').getMany();
    } catch (error) {
      console.error('Error in findAllEntries:', error);
      throw error;
    }
  }

  async sumDiscountByBatch(batchId: string, tenantId: string): Promise<number> {
    const result = await this.entryRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.discount), 0)', 'total')
      .where('entry.batchId = :batchId', { batchId })
      .andWhere('entry.tenantId = :tenantId', { tenantId })
      .andWhere('entry.deletedAt IS NULL')
      .andWhere('entry.status = :status', { status: 'POSTED' })
      .getRawOne();
    return parseFloat(result.total) || 0;
  }

  async countByBatchAndStatus(
    batchId: string,
    status: string,
    tenantId: string,
  ): Promise<number> {
    return this.entryRepo.count({
      where: { batchId, status: status as any, tenantId, deletedAt: IsNull() },
    });
  }

  async updateEntry(
    id: string,
    data: Partial<OnInvoiceEntry>,
  ): Promise<OnInvoiceEntry> {
    await this.entryRepo.update(id, data);
    const entry = await this.entryRepo.findOne({ where: { id } });
    if (!entry) {
      throw new Error('Entry not found after update');
    }
    return entry;
  }

  async countEntries(tenantId: string): Promise<number> {
    return this.entryRepo.count({
      where: { tenantId, deletedAt: IsNull() },
    });
  }
}
