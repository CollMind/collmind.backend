import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import {
  BaselineVolume,
  BaselineVolumeAcceptanceStatus,
} from '../../../database/entities/baseline-volume.entity';
import { BaselineVolumeImportBatch } from '../../../database/entities/baseline-volume-import-batch.entity';

const CHUNK_SIZE = 500;

@Injectable()
export class BaselineVolumeRepository {
  constructor(
    @InjectRepository(BaselineVolumeImportBatch)
    private readonly batchRepo: Repository<BaselineVolumeImportBatch>,
    @InjectRepository(BaselineVolume)
    private readonly rowRepo: Repository<BaselineVolume>,
  ) {}

  async createBatch(
    manager: EntityManager,
    data: Partial<BaselineVolumeImportBatch>,
  ): Promise<BaselineVolumeImportBatch> {
    const repo = manager.getRepository(BaselineVolumeImportBatch);
    return repo.save(repo.create(data));
  }

  /**
   * Bu import'un dosyasındaki (tenant, sku, cpl, period) grain'lerini
   * DAHA ÖNCE tabloda var mı diye tek sorguda kontrol eder — `DUPLICATE_GRAIN`
   * kararını DB'nin `23505` fırlatmasına BIRAKMADAN, aynı transaction
   * içinde ÖNCEDEN alabilmek için (migration JSDoc'unun öngördüğü
   * `'DUPLICATE_GRAIN'` reason kodu — bkz. baseline-volume.service.ts).
   */
  async findExistingGrainKeys(
    manager: EntityManager,
    tenantId: string,
    keys: Array<{ skuId: string; cplId: string; period: string }>,
  ): Promise<Set<string>> {
    if (keys.length === 0) return new Set();

    const qb = manager
      .getRepository(BaselineVolume)
      .createQueryBuilder('bv')
      .select(['bv.skuId', 'bv.cplId', 'bv.period'])
      .where('bv.tenantId = :tenantId', { tenantId })
      .andWhere('bv.deletedAt IS NULL');

    const orClauses: string[] = [];
    const params: Record<string, unknown> = { tenantId };
    keys.forEach((k, i) => {
      orClauses.push(
        `(bv.sku_id = :sku${i} AND bv.cpl_id = :cpl${i} AND bv.period = :period${i})`,
      );
      params[`sku${i}`] = k.skuId;
      params[`cpl${i}`] = k.cplId;
      params[`period${i}`] = k.period;
    });
    qb.andWhere(`(${orClauses.join(' OR ')})`, params);

    const existing = await qb.getMany();
    return new Set(
      existing.map((row) => `${row.skuId}|${row.cplId}|${row.period}`),
    );
  }

  async insertRowsChunked(
    manager: EntityManager,
    rows: Partial<BaselineVolume>[],
  ): Promise<void> {
    const repo = manager.getRepository(BaselineVolume);
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await repo.insert(chunk);
    }
  }

  async findBatchById(
    tenantId: string,
    batchId: string,
  ): Promise<BaselineVolumeImportBatch | null> {
    return this.batchRepo.findOne({
      where: { id: batchId, tenantId, deletedAt: IsNull() },
    });
  }

  async findRowsByBatchId(
    tenantId: string,
    batchId: string,
  ): Promise<BaselineVolume[]> {
    return this.rowRepo.find({
      where: { tenantId, importBatchId: batchId, deletedAt: IsNull() },
      order: { period: 'ASC' },
    });
  }

  async countByAcceptance(
    tenantId: string,
    batchId: string,
  ): Promise<Record<BaselineVolumeAcceptanceStatus, number>> {
    const rows = await this.rowRepo.find({
      where: { tenantId, importBatchId: batchId, deletedAt: IsNull() },
      select: ['acceptanceStatus'],
    });
    const result: Record<BaselineVolumeAcceptanceStatus, number> = {
      [BaselineVolumeAcceptanceStatus.ACCEPTED]: 0,
      [BaselineVolumeAcceptanceStatus.REJECTED]: 0,
    };
    for (const row of rows) {
      result[row.acceptanceStatus]++;
    }
    return result;
  }
}
