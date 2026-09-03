import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  BaselineVolume,
  BaselineVolumeAcceptanceStatus,
} from '../../../database/entities/baseline-volume.entity';
import { BaselineVolumeImportBatch } from '../../../database/entities/baseline-volume-import-batch.entity';
import {
  BaselineVolumeImportBatchRow,
  ImportBatchRowReason,
  ImportBatchRowStatus,
} from '../../../database/entities/baseline-volume-import-batch-row.entity';

const CHUNK_SIZE = 500;

/** `BL-4 §5` — teşhis ekranının satır filtresi. Hepsi opsiyonel (AND'lenir). */
export interface ImportBatchRowFilter {
  reason?: ImportBatchRowReason;
  status?: ImportBatchRowStatus;
  rowNo?: number;
}

/**
 * `BL-4 §5` — `sourceMatchRatio` (eşleşen satır / dosya satırı, BATCH
 * BAŞLIĞI metriği, TEŞHİS). `coverageRatio`'nun (KAPI,
 * `baseline-volume-coverage.service.ts`) KARIŞTIRILMAMASI GEREKEN kardeşi —
 * `Z87 §3`/brief `§5a`.
 *
 * ⚠️ `totalCount === 0` (boş batch) ⇒ `sourceMatchRatio: null` — `0/0` BİR
 * ORAN DEĞİLDİR (coverage kapısıyla AYNI disiplin, brief `§5a`).
 */
export interface SourceMatchRatioResult {
  matchedCount: number;
  totalCount: number;
  /** `null` YALNIZ `totalCount === 0` iken (boş batch, oran tanımsız). */
  sourceMatchRatio: number | null;
}

@Injectable()
export class BaselineVolumeRepository {
  constructor(
    @InjectRepository(BaselineVolumeImportBatch)
    private readonly batchRepo: Repository<BaselineVolumeImportBatch>,
    @InjectRepository(BaselineVolume)
    private readonly rowRepo: Repository<BaselineVolume>,
    @InjectRepository(BaselineVolumeImportBatchRow)
    private readonly batchRowRepo: Repository<BaselineVolumeImportBatchRow>,
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

  /**
   * `BL-3 ADIM 4` — teşhis raporunun kalıcı evi (`Z87`). `insertRowsChunked`
   * ile AYNI desen: `manager.getRepository` (transaction-scoped), chunk'lı
   * `insert` (yalnız INSERT — bu tablo IMMUTABLE, `update`/`delete` hiç yok).
   */
  async insertBatchRowsChunked(
    manager: EntityManager,
    rows: Partial<BaselineVolumeImportBatchRow>[],
  ): Promise<void> {
    const repo = manager.getRepository(BaselineVolumeImportBatchRow);
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      // `raw` (`Record<string, unknown>`, jsonb) TypeORM'un derin-partial
      // eşlemesiyle recursive olarak uyuşmuyor (yalnız `unknown` değerli
      // index-signature'lar için ölçülen bir tip-uyumsuzluğu, DAVRANIŞ
      // DEĞİL) — `QueryDeepPartialEntity` ile açık cast, `any` DEĞİL.
      await repo.insert(
        chunk as QueryDeepPartialEntity<BaselineVolumeImportBatchRow>[],
      );
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

  /**
   * `BL-4 §4` — teşhis ekranının KAYNAĞI: `baseline_volumes` DEĞİL,
   * `baseline_volume_import_batch_rows` (`BL-3 ADIM 4`). `keyUnresolvedRows`
   * (anahtarı hiç çözülemeyen satırlar) `baseline_volumes`'a HİÇ GİRMEZ ama
   * bu tabloda YAŞAR — teşhis ekranı bu yüzden BU tabloyu okur, o tabloyu
   * DEĞİL.
   */
  async findImportBatchRows(
    tenantId: string,
    batchId: string,
    filter?: ImportBatchRowFilter,
  ): Promise<BaselineVolumeImportBatchRow[]> {
    const where: Record<string, unknown> = { tenantId, batchId };
    if (filter?.reason !== undefined) where.reason = filter.reason;
    if (filter?.status !== undefined) where.status = filter.status;
    if (filter?.rowNo !== undefined) where.rowNo = filter.rowNo;
    return this.batchRowRepo.find({ where, order: { rowNo: 'ASC' } });
  }

  /**
   * `BL-4 §5` — `sourceMatchRatio`: `ACCEPTED` (batch_rows) satır sayısı /
   * TOPLAM kaynak satır sayısı. ⛔ ÖZET KOLON YOK (`INV-B-009`) — SORGUYLA
   * türer, `main.baseline_volume_import_batch_rows` + tenant scope'un
   * DIŞINDA hiçbir kalıcı kopya yazılmaz.
   */
  async computeSourceMatchRatio(
    tenantId: string,
    batchId: string,
  ): Promise<SourceMatchRatioResult> {
    const raw = await this.batchRowRepo
      .createQueryBuilder('r')
      .select(`COUNT(*) FILTER (WHERE r.status = :accepted)`, 'matchedCount')
      .addSelect('COUNT(*)', 'totalCount')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.batch_id = :batchId', { batchId })
      .setParameter('accepted', ImportBatchRowStatus.ACCEPTED)
      .getRawOne<{ matchedCount: string; totalCount: string }>();

    const totalCount = Number(raw?.totalCount ?? 0);
    const matchedCount = Number(raw?.matchedCount ?? 0);

    if (totalCount === 0) {
      // ⛔ `0/0` BİR ORAN DEĞİLDİR — coverage kapısıyla AYNI disiplin.
      return { matchedCount, totalCount, sourceMatchRatio: null };
    }

    return {
      matchedCount,
      totalCount,
      sourceMatchRatio: matchedCount / totalCount,
    };
  }
}
