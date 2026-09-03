import { BaselineVolumeRepository } from './baseline-volume.repository';
import { ImportBatchRowStatus } from '../../../database/entities/baseline-volume-import-batch-row.entity';

/**
 * `BL-4 §5` — `computeSourceMatchRatio` yalnız `baseline-volume-coverage.
 * service.spec.ts`'in (`BL-3`) kapsadığı `coverageRatio` KAPISININ
 * KARDEŞİDİR, AYNI TABLO DEĞİL: bu sözleşme `main.baseline_volume_import_
 * batch_rows`'un `ACCEPTED`/toplam oranını taşır, kaynak `code-reviewer`
 * bulgusu `S1` — bugün 0 satır olduğu için hiçbir suite bu servisi DB'siz
 * sınamıyordu.
 *
 * K4 — `totalCount === 0 ⇒ sourceMatchRatio: null`, sahte `0`/`100` YOK.
 */
describe('BaselineVolumeRepository.computeSourceMatchRatio', () => {
  const TENANT_ID = 'tenant-repo-001';
  const BATCH_ID = 'batch-repo-001';

  function buildRepository(
    rawResult:
      | {
          matchedCount: string;
          totalCount: string;
        }
      | undefined,
  ) {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(rawResult),
    };
    const batchRowRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const repository = new BaselineVolumeRepository(
      {} as never,
      {} as never,
      batchRowRepo as never,
    );
    return { repository, qb, batchRowRepo };
  }

  it('totalCount=0 (boş batch — üretimde bugün ölçülemeyen dal, T-273 körlüğünün fixture ile kırılmış hâli) ⇒ sourceMatchRatio: null, sahte 0 ÜRETİLMEZ', async () => {
    const { repository } = buildRepository({
      matchedCount: '0',
      totalCount: '0',
    });

    const result = await repository.computeSourceMatchRatio(
      TENANT_ID,
      BATCH_ID,
    );

    expect(result.totalCount).toBe(0);
    expect(result.matchedCount).toBe(0);
    expect(result.sourceMatchRatio).toBeNull();
  });

  it('totalCount>0, matchedCount<totalCount ⇒ gerçek oran (RED tarafı) — UNMEASURABLE ile AYNI koşumda AYRIŞIYOR', async () => {
    const { repository } = buildRepository({
      matchedCount: '3',
      totalCount: '10',
    });

    const result = await repository.computeSourceMatchRatio(
      TENANT_ID,
      BATCH_ID,
    );

    expect(result.totalCount).toBe(10);
    expect(result.matchedCount).toBe(3);
    expect(result.sourceMatchRatio).toBeCloseTo(0.3, 10);
    expect(result.sourceMatchRatio).not.toBeNull();
  });

  it('matchedCount === totalCount (tam eşleşme) ⇒ sourceMatchRatio: 1 — 0 ile AYRIŞIR (payda>0 dalı, sahte "boş" DEĞİL)', async () => {
    const { repository } = buildRepository({
      matchedCount: '7',
      totalCount: '7',
    });

    const result = await repository.computeSourceMatchRatio(
      TENANT_ID,
      BATCH_ID,
    );

    expect(result.sourceMatchRatio).toBe(1);
  });

  it('getRawOne undefined dönerse (sürücü satır üretmezse) sessizce NaN değil, 0/0→null muamelesi görür', async () => {
    const { repository } = buildRepository(undefined);

    const result = await repository.computeSourceMatchRatio(
      TENANT_ID,
      BATCH_ID,
    );

    expect(result.totalCount).toBe(0);
    expect(result.sourceMatchRatio).toBeNull();
    expect(Number.isNaN(result.sourceMatchRatio as unknown as number)).toBe(
      false,
    );
  });

  it('sorgu doğru tabloyu (batch_row alias `r`, ACCEPTED filtresi) hedefliyor — parametre kanıtı', async () => {
    const { repository, qb } = buildRepository({
      matchedCount: '1',
      totalCount: '1',
    });

    await repository.computeSourceMatchRatio(TENANT_ID, BATCH_ID);

    expect(qb.where).toHaveBeenCalledWith('r.tenant_id = :tenantId', {
      tenantId: TENANT_ID,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('r.batch_id = :batchId', {
      batchId: BATCH_ID,
    });
    expect(qb.setParameter).toHaveBeenCalledWith(
      'accepted',
      ImportBatchRowStatus.ACCEPTED,
    );
  });
});

/**
 * `BL-4 §4`/K2 — `code-reviewer` bulgusu: `getBatchRows` `BL-4a` ÖNCESİ
 * `baseline_volumes`'u okuyordu, doğrusu `baseline_volume_import_batch_
 * rows`. Bugün `baseline_volume_import_batch_rows` DB'de 0 SATIR olduğu
 * için gerçek bir e2e koşumu bu regresyonu göremez (T-273 körlüğü) — bu
 * suite, hangi REPOSITORY'nin (`batchRowRepo` ↔ `rowRepo`) sorgulandığını
 * DB'siz, İKİ FARKLI mock ile ayırt eder: `rowRepo.find` çağrılırsa (yanlış
 * tabloya dönüş regresyonu) bu test KIRMIZI yanar.
 */
describe('BaselineVolumeRepository.findImportBatchRows — DOĞRU TABLO', () => {
  const TENANT_ID = 'tenant-repo-002';
  const BATCH_ID = 'batch-repo-002';

  it('batchRowRepo.find çağrılır, rowRepo.find HİÇ ÇAĞRILMAZ — sonuç batchRowRepo’dan gelir', async () => {
    const CORRECT_ROWS = [{ rowNo: 1, source: 'batch_rows' }];
    const WRONG_TABLE_ROWS = [{ id: 'x', source: 'baseline_volumes' }];

    const batchRowRepo = {
      find: jest.fn().mockResolvedValue(CORRECT_ROWS),
    };
    const rowRepo = {
      find: jest.fn().mockResolvedValue(WRONG_TABLE_ROWS),
    };

    const repository = new BaselineVolumeRepository(
      {} as never,
      rowRepo as never,
      batchRowRepo as never,
    );

    const result = await repository.findImportBatchRows(TENANT_ID, BATCH_ID);

    expect(result).toEqual(CORRECT_ROWS);
    expect(batchRowRepo.find).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, batchId: BATCH_ID },
      order: { rowNo: 'ASC' },
    });
    expect(rowRepo.find).not.toHaveBeenCalled();
  });

  it('filtreler (reason/status/rowNo) AND’lenerek batchRowRepo.find’a geçer', async () => {
    const batchRowRepo = { find: jest.fn().mockResolvedValue([]) };
    const rowRepo = { find: jest.fn() };
    const repository = new BaselineVolumeRepository(
      {} as never,
      rowRepo as never,
      batchRowRepo as never,
    );

    await repository.findImportBatchRows(TENANT_ID, BATCH_ID, {
      reason: 'SKU_NOT_FOUND' as never,
      status: 'REJECTED' as never,
      rowNo: 5,
    });

    expect(batchRowRepo.find).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        batchId: BATCH_ID,
        reason: 'SKU_NOT_FOUND',
        status: 'REJECTED',
        rowNo: 5,
      },
      order: { rowNo: 'ASC' },
    });
  });
});
