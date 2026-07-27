import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import {
  SalesActualBatch,
  SalesActualBatchStatus,
} from '../../../../database/entities/sales-actual-batch.entity';
import { SalesActual } from '../../../../database/entities/sales-actual.entity';

const CHUNK_SIZE = 500;

/**
 * Tüm okuma sorguları `status = 'ACTIVE'` filtresini burada tek yerden
 * uygular ("güncel gerçek" = ACTIVE batch satırları). TTM'de bu filtre her
 * sorguya elle yazılıyordu — sızıntı riskini önlemek için tek noktaya alındı.
 */
@Injectable()
export class SalesActualsRepository {
  constructor(
    @InjectRepository(SalesActualBatch)
    private readonly batchRepo: Repository<SalesActualBatch>,
    @InjectRepository(SalesActual)
    private readonly rowRepo: Repository<SalesActual>,
  ) {}

  /** Scope için mevcut ACTIVE batch'i satır kilidiyle (FOR UPDATE) bul. Aynı transaction manager'ı kullanır. */
  async findActiveBatchForUpdate(
    manager: EntityManager,
    tenantId: string,
    fiscalPeriod: string,
    cplId: string,
    categoryId: string,
    channelId: string,
  ): Promise<SalesActualBatch | null> {
    return manager
      .getRepository(SalesActualBatch)
      .createQueryBuilder('batch')
      .setLock('pessimistic_write')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.fiscalPeriod = :fiscalPeriod', { fiscalPeriod })
      .andWhere('batch.cplId = :cplId', { cplId })
      .andWhere('batch.categoryId = :categoryId', { categoryId })
      .andWhere('batch.channelId = :channelId', { channelId })
      .andWhere('batch.status = :status', {
        status: SalesActualBatchStatus.ACTIVE,
      })
      .andWhere('batch.deletedAt IS NULL')
      .getOne();
  }

  async createBatch(
    manager: EntityManager,
    data: Partial<SalesActualBatch>,
  ): Promise<SalesActualBatch> {
    const repo = manager.getRepository(SalesActualBatch);
    return repo.save(repo.create(data));
  }

  /**
   * ÖNEMLİ SIRA: Bu, yeni ACTIVE batch INSERT edilmeden ÖNCE çağrılmalı.
   * Partial unique index (`ux_sales_actual_batches_active_scope`) aynı
   * scope'ta yalnızca TEK ACTIVE satıra izin verir — eski satır REPLACED'e
   * çevrilmeden yeni ACTIVE satır eklenirse 23505 (constraint violation)
   * oluşur. `replacedByBatchId` bu adımda henüz bilinmez (yeni batch id'si
   * insert'ten sonra oluşur); `linkReplacement` ile ayrıca set edilir.
   */
  async markReplacedStatus(
    manager: EntityManager,
    batchId: string,
  ): Promise<void> {
    await manager.getRepository(SalesActualBatch).update(batchId, {
      status: SalesActualBatchStatus.REPLACED,
      replacedAt: new Date(),
    });
  }

  /** Yeni batch oluşturulduktan SONRA eski batch'in replacedByBatchId'ini bağlar. */
  async linkReplacement(
    manager: EntityManager,
    batchId: string,
    replacedByBatchId: string,
  ): Promise<void> {
    await manager.getRepository(SalesActualBatch).update(batchId, {
      replacedByBatchId,
    });
  }

  async insertRowsChunked(
    manager: EntityManager,
    rows: Partial<SalesActual>[],
  ): Promise<void> {
    const repo = manager.getRepository(SalesActual);
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await repo.insert(chunk);
    }
  }

  // ── Okuma (yalnızca ACTIVE batch) ─────────────────────────────────────

  async findBatchById(
    tenantId: string,
    batchId: string,
  ): Promise<SalesActualBatch | null> {
    return this.batchRepo.findOne({
      where: { id: batchId, tenantId, deletedAt: IsNull() },
    });
  }

  async findBatches(
    tenantId: string,
    filters?: { fiscalPeriod?: string; status?: SalesActualBatchStatus },
  ): Promise<SalesActualBatch[]> {
    const qb = this.batchRepo
      .createQueryBuilder('batch')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.deletedAt IS NULL');

    if (filters?.fiscalPeriod) {
      qb.andWhere('batch.fiscalPeriod = :fiscalPeriod', {
        fiscalPeriod: filters.fiscalPeriod,
      });
    }
    if (filters?.status) {
      qb.andWhere('batch.status = :status', { status: filters.status });
    } else {
      qb.andWhere('batch.status = :status', {
        status: SalesActualBatchStatus.ACTIVE,
      });
    }

    return qb.orderBy('batch.createdAt', 'DESC').getMany();
  }

  async findRowsByBatchId(
    tenantId: string,
    batchId: string,
  ): Promise<SalesActual[]> {
    return this.rowRepo.find({
      where: { tenantId, batchId, deletedAt: IsNull() },
      order: { sourceRowNumber: 'ASC' },
    });
  }

  /** ACTIVE batch'lerin satırları üzerinden CPL/Category/Channel/period toplamı. */
  async summarize(
    tenantId: string,
    filters?: {
      fiscalPeriod?: string;
      cplId?: string;
      categoryId?: string;
      channelId?: string;
    },
  ): Promise<{
    grossTotal: number;
    netTotal: number;
    discountTotal: number;
    rowCount: number;
  }> {
    const qb = this.rowRepo
      .createQueryBuilder('row')
      .innerJoin(
        SalesActualBatch,
        'batch',
        'batch.id = row.batchId AND batch.status = :status AND batch.deletedAt IS NULL',
        { status: SalesActualBatchStatus.ACTIVE },
      )
      .where('row.tenantId = :tenantId', { tenantId })
      .andWhere('row.deletedAt IS NULL')
      .select('COALESCE(SUM(row.grossAmount), 0)', 'grossTotal')
      .addSelect('COALESCE(SUM(row.netAmount), 0)', 'netTotal')
      .addSelect('COALESCE(SUM(row.discountAmount), 0)', 'discountTotal')
      .addSelect('COUNT(*)', 'rowCount');

    if (filters?.fiscalPeriod) {
      qb.andWhere('row.fiscalPeriod = :fiscalPeriod', {
        fiscalPeriod: filters.fiscalPeriod,
      });
    }
    if (filters?.cplId) {
      qb.andWhere('row.cplId = :cplId', { cplId: filters.cplId });
    }
    if (filters?.categoryId) {
      qb.andWhere('row.categoryId = :categoryId', {
        categoryId: filters.categoryId,
      });
    }
    if (filters?.channelId) {
      qb.andWhere('row.channelId = :channelId', {
        channelId: filters.channelId,
      });
    }

    const raw = await qb.getRawOne();
    return {
      grossTotal: parseFloat(raw.grossTotal) || 0,
      netTotal: parseFloat(raw.netTotal) || 0,
      discountTotal: parseFloat(raw.discountTotal) || 0,
      rowCount: parseInt(raw.rowCount, 10) || 0,
    };
  }
}
