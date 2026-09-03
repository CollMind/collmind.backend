import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaselineVolumeService } from './baseline-volume.service';
import { BaselineVolumeAcceptanceStatus } from '../../../database/entities/baseline-volume.entity';
import {
  ImportBatchRowReason,
  ImportBatchRowStatus,
} from '../../../database/entities/baseline-volume-import-batch-row.entity';
import { Sku } from '../../../database/entities/sku.entity';
import { Cpl } from '../../../database/entities/cpl.entity';
import { BaselineVolumeRepository } from './baseline-volume.repository';
import { BaselineVolumeFileParserService } from './services/baseline-volume-file-parser.service';
import { BaselineVolumeLookupService } from './services/baseline-volume-lookup.service';
import { AdminAuditService } from '../../../common/services/admin-audit.service';

const TENANT_ID = 'tenant-001';
const USER_CTX = { userId: 'user-1', userEmail: 'admin@collmind.com' };

const SKU_1 = { id: 'sku-1', code: 'SKU-001' } as unknown as Sku;
const CPL_1 = { id: 'cpl-1', code: 'CPL-001' } as unknown as Cpl;

function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

interface MockRepository {
  createBatch: jest.Mock;
  findExistingGrainKeys: jest.Mock;
  insertRowsChunked: jest.Mock;
  insertBatchRowsChunked: jest.Mock;
  findBatchById: jest.Mock;
  countByAcceptance: jest.Mock;
}

interface MockLookupService {
  buildIndex: jest.Mock;
}

interface MockFileParser {
  parseCSV: jest.Mock;
  parseExcel: jest.Mock;
}

interface MockAuditService {
  logAdminAction: jest.Mock;
}

/**
 * `BL-2` — `BaselineVolumeService.ingest()` orkestrasyonu. `sales-actuals
 * .service.spec.ts`'in aynı mock deseni (repository/lookup/parser/audit
 * mock'lanır, `DataSource.transaction` doğrudan callback'i çağırır).
 *
 * Üç sözleşme sınanıyor:
 *   1. Q20/`§3` — eksik anahtarlı satır tabloya HİÇ girmez (`keyUnresolvedRows`).
 *   2. `§4` — anahtarı çözülen ama değeri geçersiz satır `REJECTED` yazılır
 *      (`formatRejectedRows`), tabloya bir SATIR olarak GİRER.
 *   3. `DUPLICATE_GRAIN` — dosya-içi VE DB'de önceden var olan grain ayrı ayrı
 *      yakalanır, ikisi de `REJECTED` yazılır.
 */
describe('BaselineVolumeService.ingest', () => {
  let service: BaselineVolumeService;
  let mockRepository: MockRepository;
  let mockLookupService: MockLookupService;
  let mockFileParser: MockFileParser;
  let mockAuditService: MockAuditService;
  let mockDataSource: { transaction: jest.Mock };
  let mockManager: EntityManager;

  beforeEach(() => {
    mockManager = {} as EntityManager;
    mockDataSource = {
      transaction: jest.fn(
        async (cb: (manager: EntityManager) => Promise<unknown>) =>
          cb(mockManager),
      ),
    };

    mockRepository = {
      createBatch: jest
        .fn()
        .mockImplementation((_manager, data) =>
          Promise.resolve({ id: 'batch-1', ...data }),
        ),
      findExistingGrainKeys: jest.fn().mockResolvedValue(new Set()),
      insertRowsChunked: jest.fn().mockResolvedValue(undefined),
      insertBatchRowsChunked: jest.fn().mockResolvedValue(undefined),
      findBatchById: jest.fn(),
      countByAcceptance: jest.fn(),
    };

    mockLookupService = {
      buildIndex: jest.fn().mockResolvedValue({
        skuByCode: new Map([[SKU_1.code, SKU_1]]),
        cplByCode: new Map([[CPL_1.code, CPL_1]]),
      }),
    };

    mockFileParser = {
      parseCSV: jest.fn(),
      parseExcel: jest.fn(),
    };

    mockAuditService = {
      logAdminAction: jest.fn().mockResolvedValue(undefined),
    };

    service = new BaselineVolumeService(
      mockDataSource as unknown as DataSource,
      mockFileParser as unknown as BaselineVolumeFileParserService,
      mockLookupService as unknown as BaselineVolumeLookupService,
      mockRepository as unknown as BaselineVolumeRepository,
      mockAuditService as unknown as AdminAuditService,
    );
  });

  it('eksik anahtarlı satır tabloya HİÇ girmez, tam satır ACCEPTED yazılır (AYNI koşum, Q20/§3)', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: { sku_code: 'SKU-001' },
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
      {
        originalRowNumber: 3,
        originalRowData: { sku_code: 'SKU-002' },
        skuCode: 'SKU-002', // katalogda YOK
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 500,
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    expect(result.acceptedRows).toBe(1);
    expect(result.keyUnresolvedRows).toHaveLength(1);
    expect(result.keyUnresolvedRows[0].reasonCode).toBe('SKU_NOT_FOUND');
    expect(result.keyUnresolvedRows[0].rowNumber).toBe(3);

    // Yalnız 1 satır (SKU-002'nin satırı DEĞİL) insertRowsChunked'a gitti.
    const insertedRows = mockRepository.insertRowsChunked.mock.calls[0][1];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].skuId).toBe(SKU_1.id);
    expect(insertedRows[0].acceptanceStatus).toBe(
      BaselineVolumeAcceptanceStatus.ACCEPTED,
    );
  });

  it('anahtarı çözülen ama base_volume negatif olan satır REJECTED yazılır (§4 — tabloya SATIR olarak girer)', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: -5,
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    expect(result.acceptedRows).toBe(0);
    expect(result.formatRejectedRows).toHaveLength(1);
    expect(result.formatRejectedRows[0].reasonCode).toBe('NEGATIVE_VOLUME');

    const insertedRows = mockRepository.insertRowsChunked.mock.calls[0][1];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].acceptanceStatus).toBe(
      BaselineVolumeAcceptanceStatus.REJECTED,
    );
    expect(insertedRows[0].reason).toBe('NEGATIVE_VOLUME');
    expect(insertedRows[0].baseVolume).toBeUndefined();
  });

  it('dosya-içi yinelenen grain: ikinci satır DUPLICATE_GRAIN olarak REJECTED yazılır', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
      {
        originalRowNumber: 3,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02', // AYNI grain
        baseVolume: 2000,
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    expect(result.acceptedRows).toBe(1);
    expect(result.formatRejectedRows).toHaveLength(1);
    expect(result.formatRejectedRows[0].reasonCode).toBe('DUPLICATE_GRAIN');
    expect(result.formatRejectedRows[0].rowNumber).toBe(3);
  });

  it('DB’de önceden var olan grain: ACCEPTED olacak satır DUPLICATE_GRAIN olarak REJECTED’e çevrilir', async () => {
    mockRepository.findExistingGrainKeys.mockResolvedValue(
      new Set([`${SKU_1.id}|${CPL_1.id}|2026-02`]),
    );
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    expect(result.acceptedRows).toBe(0);
    expect(result.formatRejectedRows).toHaveLength(1);
    expect(result.formatRejectedRows[0].reasonCode).toBe('DUPLICATE_GRAIN');

    const insertedRows = mockRepository.insertRowsChunked.mock.calls[0][1];
    expect(insertedRows[0].acceptanceStatus).toBe(
      BaselineVolumeAcceptanceStatus.REJECTED,
    );
  });

  it('hiçbir satırın anahtarı çözülemezse BadRequestException fırlatır, batch oluşturmaz', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-UNKNOWN',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
    ]);

    await expect(
      service.ingest(TENANT_ID, USER_CTX, {
        fileName: 'baseline.csv',
        fileBuffer: csvBuffer('irrelevant'),
        contentType: 'text/csv',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockRepository.createBatch).not.toHaveBeenCalled();
  });
});

/**
 * `BL-3 ADIM 4` (`docs/process/BL3_DOGRULAMA_BRIEF.md` kapanış eki) —
 * `baseline_volume_import_batch_rows` satır yazarı + `Z87 §F12`'nin
 * "iki kanal → tek sözlük" hükmü.
 *
 * Her `it` `mockRepository.insertBatchRowsChunked`'ın aldığı satırları
 * migration `1823`'ün `CHK_..._acceptance_shape`'iyle (aynı CASE mantığı,
 * bkz. entity JSDoc'u) EL İLE karşılaştırır — gerçek Postgres CHECK'i BU
 * dosyada koşulamaz (DB'ye kalıcı yazma yasak, e2e kilitli); bu yüzden bu
 * testler DB-seviyesi kanıtın YERİNE geçmez, yalnız SERVİS'in ürettiği
 * şeklin CHECK'in izin verdiği kombinasyonlardan biri olduğunu (kod okunarak
 * türetilmiş referans tabloya göre) doğrular.
 */
describe('BaselineVolumeService.ingest — import_batch_rows satır yazarı', () => {
  let service: BaselineVolumeService;
  let mockRepository: MockRepository;
  let mockLookupService: MockLookupService;
  let mockFileParser: MockFileParser;
  let mockAuditService: MockAuditService;
  let mockDataSource: { transaction: jest.Mock };
  let mockManager: EntityManager;

  beforeEach(() => {
    mockManager = {} as EntityManager;
    mockDataSource = {
      transaction: jest.fn(
        async (cb: (manager: EntityManager) => Promise<unknown>) =>
          cb(mockManager),
      ),
    };

    mockRepository = {
      createBatch: jest
        .fn()
        .mockImplementation((_manager, data) =>
          Promise.resolve({ id: 'batch-1', ...data }),
        ),
      findExistingGrainKeys: jest.fn().mockResolvedValue(new Set()),
      insertRowsChunked: jest.fn().mockResolvedValue(undefined),
      insertBatchRowsChunked: jest.fn().mockResolvedValue(undefined),
      findBatchById: jest.fn(),
      countByAcceptance: jest.fn(),
    };

    mockLookupService = {
      buildIndex: jest.fn().mockResolvedValue({
        skuByCode: new Map([[SKU_1.code, SKU_1]]),
        cplByCode: new Map([[CPL_1.code, CPL_1]]),
      }),
    };

    mockFileParser = {
      parseCSV: jest.fn(),
      parseExcel: jest.fn(),
    };

    mockAuditService = {
      logAdminAction: jest.fn().mockResolvedValue(undefined),
    };

    service = new BaselineVolumeService(
      mockDataSource as unknown as DataSource,
      mockFileParser as unknown as BaselineVolumeFileParserService,
      mockLookupService as unknown as BaselineVolumeLookupService,
      mockRepository as unknown as BaselineVolumeRepository,
      mockAuditService as unknown as AdminAuditService,
    );
  });

  function insertedBatchRows(): Array<Record<string, unknown>> {
    return mockRepository.insertBatchRowsChunked.mock.calls[0][1];
  }

  it('PİN 2 — ACCEPTED satır: resolved_sku_id/resolved_cpl_id İKİSİ DE DOLU, reason NULL', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: { sku_code: 'SKU-001' },
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
    ]);

    await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    const rows = insertedBatchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowNo: 2,
      status: ImportBatchRowStatus.ACCEPTED,
      reason: undefined,
      resolvedSkuId: SKU_1.id,
      resolvedCplId: CPL_1.id,
      batchId: 'batch-1',
      tenantId: TENANT_ID,
    });
    expect(rows[0].raw).toEqual({ sku_code: 'SKU-001' });
  });

  it('SKU_NOT_FOUND — resolved_sku_id VE resolved_cpl_id İKİSİ DE NULL (CPL lookup’a hiç ulaşılmaz)', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 3,
        originalRowData: { sku_code: 'SKU-999' },
        skuCode: 'SKU-999',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 500,
      },
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
    ]);

    await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    const rows = insertedBatchRows();
    const row = rows.find((r) => r.rowNo === 3)!;
    expect(row.status).toBe(ImportBatchRowStatus.REJECTED);
    expect(row.reason).toBe(ImportBatchRowReason.SKU_NOT_FOUND);
    expect(row.resolvedSkuId).toBeUndefined();
    expect(row.resolvedCplId).toBeUndefined();
  });

  it('CPL_NOT_FOUND — resolved_sku_id DOLU (SKU zaten çözüldü), resolved_cpl_id NULL — SKU_NOT_FOUND’un SİMETRİĞİ DEĞİL', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-999',
        period: '2026-02',
        baseVolume: 1000,
      },
      {
        originalRowNumber: 3,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-03',
        baseVolume: 1000,
      },
    ]);

    await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    const rows = insertedBatchRows();
    const row = rows.find((r) => r.rowNo === 2)!;
    expect(row.status).toBe(ImportBatchRowStatus.REJECTED);
    expect(row.reason).toBe(ImportBatchRowReason.CPL_NOT_FOUND);
    expect(row.resolvedSkuId).toBe(SKU_1.id);
    expect(row.resolvedCplId).toBeUndefined();
  });

  it('İŞ 2 — period HÜCRESİ YAZILMIŞ ama PARSE EDİLEMEMİŞ ⇒ reasonCode INVALID_PERIOD (MISSING_REQUIRED_FIELD’e ÇEVRİLMEZ)', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: { period: '13/13/2026' },
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: undefined, // parser çözemedi
        baseVolume: 1000,
        parseErrors: [
          {
            field: 'period',
            error_type: 'INVALID_PERIOD',
            error_message: "Geçersiz tarih/dönem: '13/13/2026'.",
          },
        ],
      },
      {
        // Batch'in oluşabilmesi için en az bir ÇÖZÜLEBİLİR satır gerekir
        // (`NO_RESOLVABLE_ROWS` kapısı) — bu satırın kendisi test edilen
        // davranışın parçası DEĞİL, yalnız fixture'ı geçerli kılıyor.
        originalRowNumber: 3,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-03',
        baseVolume: 1000,
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    expect(result.keyUnresolvedRows).toHaveLength(1);
    expect(result.keyUnresolvedRows[0].reasonCode).toBe('INVALID_PERIOD');

    const rows = insertedBatchRows();
    expect(rows).toHaveLength(2); // satır 2 (INVALID_PERIOD) + satır 3 (ACCEPTED, fixture'ı geçerli kılan satır)
    expect(rows[0].status).toBe(ImportBatchRowStatus.REJECTED);
    expect(rows[0].reason).toBe(ImportBatchRowReason.INVALID_PERIOD);
    expect(rows[0].resolvedSkuId).toBeUndefined();
    expect(rows[0].resolvedCplId).toBeUndefined();
  });

  it('period hücresi TAMAMEN BOŞ ⇒ MISSING_REQUIRED_FIELD (INVALID_PERIOD DEĞİL — ayrık kümeler)', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: undefined, // hücre hiç yazılmamış, parseError YOK
        baseVolume: 1000,
      },
      {
        // Batch'in oluşabilmesi için en az bir ÇÖZÜLEBİLİR satır gerekir
        // (`NO_RESOLVABLE_ROWS` kapısı) — test edilen davranışın parçası DEĞİL.
        originalRowNumber: 3,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-03',
        baseVolume: 1000,
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    expect(result.keyUnresolvedRows[0].reasonCode).toBe(
      'MISSING_REQUIRED_FIELD',
    );

    const rows = insertedBatchRows();
    expect(rows[0].reason).toBe(ImportBatchRowReason.MISSING_REQUIRED_FIELD);
    expect(rows[0].resolvedSkuId).toBeUndefined();
    expect(rows[0].resolvedCplId).toBeUndefined();
  });

  it('MISSING_REQUIRED_FIELD (value-aşaması: base_volume boş, anahtar ZATEN çözülmüş) ⇒ resolved_* İKİSİ DE DOLU — key-aşamasının TERSİ', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: undefined, // hücre boş, format hatası YOK
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    expect(result.formatRejectedRows[0].reasonCode).toBe(
      'MISSING_REQUIRED_FIELD',
    );

    const rows = insertedBatchRows();
    expect(rows[0].reason).toBe(ImportBatchRowReason.MISSING_REQUIRED_FIELD);
    expect(rows[0].resolvedSkuId).toBe(SKU_1.id);
    expect(rows[0].resolvedCplId).toBe(CPL_1.id);
  });

  it('PİN 1 — KARIŞIK DOSYA: tam · SKU yok · değeri negatif · biçimi bozuk satırlar AYNI batch’te, HEPSİ import_batch_rows’ta', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2, // tam — ACCEPTED
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
      {
        originalRowNumber: 3, // SKU katalogda yok — key-unresolved
        originalRowData: {},
        skuCode: 'SKU-UNKNOWN',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 500,
      },
      {
        originalRowNumber: 4, // negatif değer — value-rejected
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-03',
        baseVolume: -10,
      },
      {
        originalRowNumber: 5, // biçimi bozuk — value-rejected
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-04',
        baseVolume: undefined,
        parseErrors: [
          {
            field: 'base_volume',
            error_type: 'INVALID_VOLUME_FORMAT',
            error_message: "Sayı değil: 'abc'.",
          },
        ],
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    // AYIRT EDİCİLİK: aynı dosyada HEM kabul HEM red var (§ pin 1 uyarısı).
    expect(result.acceptedRows).toBe(1);
    expect(result.keyUnresolvedRows).toHaveLength(1);
    expect(result.formatRejectedRows).toHaveLength(2);

    const rows = insertedBatchRows();
    // KÖPRÜ: dosyanın DÖRT satırının DÖRDÜ DE burada — accepted DAHİL.
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.rowNo).sort()).toEqual([2, 3, 4, 5]);

    const byRowNo = new Map(rows.map((r) => [r.rowNo, r]));
    expect(byRowNo.get(2)!.status).toBe(ImportBatchRowStatus.ACCEPTED);
    expect(byRowNo.get(3)!.reason).toBe(ImportBatchRowReason.SKU_NOT_FOUND);
    expect(byRowNo.get(4)!.reason).toBe(ImportBatchRowReason.NEGATIVE_VOLUME);
    expect(byRowNo.get(5)!.reason).toBe(
      ImportBatchRowReason.INVALID_VOLUME_FORMAT,
    );
    // tüm satırlar AYNI batch_id altında — köprü batch_id+row_no üzerinden.
    for (const r of rows) {
      expect(r.batchId).toBe('batch-1');
    }
  });

  it('DUPLICATE_GRAIN (ADIM 3, DB’de önceden var) ⇒ batch_rows’a da REJECTED/DUPLICATE_GRAIN olarak yansır (finalRows’tan zip’lenir)', async () => {
    mockRepository.findExistingGrainKeys.mockResolvedValue(
      new Set([`${SKU_1.id}|${CPL_1.id}|2026-02`]),
    );
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: {},
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
    ]);

    await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'baseline.csv',
      fileBuffer: csvBuffer('irrelevant'),
      contentType: 'text/csv',
    });

    const rows = insertedBatchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(ImportBatchRowStatus.REJECTED);
    expect(rows[0].reason).toBe(ImportBatchRowReason.DUPLICATE_GRAIN);
    expect(rows[0].resolvedSkuId).toBe(SKU_1.id);
    expect(rows[0].resolvedCplId).toBe(CPL_1.id);
  });

  it('§2.5 — originalRowData YOKSA (beklenmeyen parser çıktısı) sessizce {} yazmaz, açık hata fırlatır', async () => {
    mockFileParser.parseCSV.mockResolvedValue([
      {
        originalRowNumber: 2,
        originalRowData: undefined,
        skuCode: 'SKU-001',
        cplCode: 'CPL-001',
        period: '2026-02',
        baseVolume: 1000,
      },
    ]);

    await expect(
      service.ingest(TENANT_ID, USER_CTX, {
        fileName: 'baseline.csv',
        fileBuffer: csvBuffer('irrelevant'),
        contentType: 'text/csv',
      }),
    ).rejects.toThrow(/originalRowData/);
  });
});
