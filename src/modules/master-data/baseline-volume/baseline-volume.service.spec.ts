import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaselineVolumeService } from './baseline-volume.service';
import { BaselineVolumeAcceptanceStatus } from '../../../database/entities/baseline-volume.entity';
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
  findBatchById: jest.Mock;
  findRowsByBatchId: jest.Mock;
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
      findBatchById: jest.fn(),
      findRowsByBatchId: jest.fn(),
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
