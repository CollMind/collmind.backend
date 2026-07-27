import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { SalesActualsService } from './sales-actuals.service';
import { SalesActualsRepository } from './sales-actuals.repository';
import { SalesActualsLookupService } from './services/sales-actuals-lookup.service';
import { SalesActualsValidationService } from './services/sales-actuals-validation.service';
import { CsvParserService } from '../../../../common/services/csv-parser.service';
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
import { SalesActualBatchStatus } from '../../../../database/entities/sales-actual-batch.entity';

const TENANT_ID = 'tenant-001';
const USER_CTX = { userId: 'user-1', userEmail: 'admin@wella.com' };

const CHANNEL_NKA = {
  id: 'chan-nka',
  code: 'NKA',
  name: 'National Key Accounts',
} as any;
const CPL_1 = {
  id: 'cpl-1',
  code: 'BS0501.50006',
  channelId: 'chan-nka',
} as any;
const CATEGORY_1 = {
  id: 'cat-1',
  code: 'CAT-SEKILLENDIRICI',
  name: 'Şekillendirici',
} as any;

function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

const VALID_CSV = [
  'cpl_code,category,channel_code,gross_amount,net_amount,discount_amount',
  'BS0501.50006,Şekillendirici,NKA,400000,360000,15000',
].join('\n');

describe('SalesActualsService.ingest', () => {
  let service: SalesActualsService;
  let mockRepository: any;
  let mockLookupService: any;
  let mockCsvParser: any;
  let mockAuditService: any;
  let mockDataSource: any;
  let mockManager: any;

  beforeEach(async () => {
    mockManager = {}; // repository çağrılarını mock'luyoruz, manager sadece geçirilen değer

    mockDataSource = {
      transaction: jest.fn(async (cb: any) => cb(mockManager)),
    };

    mockRepository = {
      findActiveBatchForUpdate: jest.fn().mockResolvedValue(null),
      createBatch: jest
        .fn()
        .mockImplementation((_manager, data) =>
          Promise.resolve({ id: 'new-batch-id', ...data }),
        ),
      insertRowsChunked: jest.fn().mockResolvedValue(undefined),
      markReplacedStatus: jest.fn().mockResolvedValue(undefined),
      linkReplacement: jest.fn().mockResolvedValue(undefined),
    };

    mockLookupService = {
      buildIndex: jest.fn().mockResolvedValue({
        cplByCode: new Map([[CPL_1.code, CPL_1]]),
        channelByCode: new Map([[CHANNEL_NKA.code, CHANNEL_NKA]]),
        channelById: new Map([[CHANNEL_NKA.id, CHANNEL_NKA]]),
        categoryByCode: new Map([[CATEGORY_1.code, CATEGORY_1]]),
        categoryByNormalizedName: new Map([['şekillendirici', [CATEGORY_1]]]),
      }),
    };

    mockCsvParser = {
      parse: jest.fn(),
    };

    mockAuditService = {
      logAdminAction: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesActualsService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: CsvParserService, useValue: mockCsvParser },
        { provide: SalesActualsLookupService, useValue: mockLookupService },
        SalesActualsValidationService,
        { provide: SalesActualsRepository, useValue: mockRepository },
        { provide: AdminAuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<SalesActualsService>(SalesActualsService);
  });

  it('yeni scope için batch oluşturur, audit SALES_ACTUALS_UPLOAD loglar (CREATED)', async () => {
    mockCsvParser.parse.mockResolvedValue([
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '400000',
        net_amount: '360000',
        discount_amount: '15000',
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'actuals_2026-01.csv',
      fileBuffer: csvBuffer(VALID_CSV),
      sourceType: 'FILE_UPLOAD' as any,
    });

    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].status).toBe('CREATED');
    expect(result.validRows).toBe(1);
    expect(result.errorRows).toBe(0);
    expect(mockRepository.createBatch).toHaveBeenCalledTimes(1);
    expect(mockRepository.linkReplacement).not.toHaveBeenCalled();
    expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
      TENANT_ID,
      USER_CTX.userId,
      USER_CTX.userEmail,
      'SALES_ACTUALS_UPLOAD',
      'SalesActualBatch',
      'new-batch-id',
      undefined,
      'SUCCESS',
      undefined,
      expect.objectContaining({ totals: expect.any(Object) }),
    );
  });

  it('aynı fileHash ile tekrar yüklenirse IDEMPOTENT_DUPLICATE — yeni batch yaratılmaz', async () => {
    const fileBuffer = csvBuffer(VALID_CSV);
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

    mockRepository.findActiveBatchForUpdate.mockResolvedValue({
      id: 'existing-batch-id',
      fileHash,
      validRows: 1,
      grossTotal: 400000,
      netTotal: 360000,
      discountTotal: 15000,
    });

    mockCsvParser.parse.mockResolvedValue([
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '400000',
        net_amount: '360000',
        discount_amount: '15000',
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'actuals_2026-01.csv',
      fileBuffer,
      sourceType: 'FILE_UPLOAD' as any,
    });

    expect(result.batches[0].status).toBe('IDEMPOTENT_DUPLICATE');
    expect(result.batches[0].batchId).toBe('existing-batch-id');
    expect(mockRepository.createBatch).not.toHaveBeenCalled();
    expect(mockRepository.linkReplacement).not.toHaveBeenCalled();
    expect(mockAuditService.logAdminAction).not.toHaveBeenCalled();
  });

  it('farklı fileHash ile tekrar yüklenirse eski batch REPLACED olur, satırlar silinmez (hard delete yok)', async () => {
    mockRepository.findActiveBatchForUpdate.mockResolvedValue({
      id: 'old-batch-id',
      fileHash: 'DIFFERENT-HASH',
      validRows: 1,
      grossTotal: 100,
      netTotal: 90,
      discountTotal: 5,
    });

    mockCsvParser.parse.mockResolvedValue([
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '400000',
        net_amount: '360000',
        discount_amount: '15000',
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'actuals_2026-01.csv',
      fileBuffer: csvBuffer(VALID_CSV),
      sourceType: 'FILE_UPLOAD' as any,
    });

    expect(result.batches[0].status).toBe('REPLACED');
    expect(result.batches[0].replacedBatchId).toBe('old-batch-id');
    expect(mockRepository.createBatch).toHaveBeenCalledTimes(1);
    // Hard delete YOK — repository'de herhangi bir delete/remove metodu YOK,
    // yalnızca status flip (markReplacedStatus) + FK bağlama (linkReplacement).
    expect(mockRepository.markReplacedStatus).toHaveBeenCalledWith(
      mockManager,
      'old-batch-id',
    );
    expect(mockRepository.linkReplacement).toHaveBeenCalledWith(
      mockManager,
      'old-batch-id',
      'new-batch-id',
    );
    expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
      TENANT_ID,
      USER_CTX.userId,
      USER_CTX.userEmail,
      'SALES_ACTUALS_REPLACE',
      'SalesActualBatch',
      'new-batch-id',
      undefined,
      'SUCCESS',
      expect.objectContaining({ oldBatchId: 'old-batch-id' }),
      expect.objectContaining({ newBatchId: 'new-batch-id' }),
    );
  });

  it('tüm satırlar geçersizse 400 fırlatır, batch/transaction başlatılmaz', async () => {
    mockCsvParser.parse.mockResolvedValue([
      {
        cpl_code: 'UNKNOWN',
        category: 'Bilinmeyen',
        channel_code: 'XX',
        gross_amount: '',
      },
    ]);

    await expect(
      service.ingest(TENANT_ID, USER_CTX, {
        fileName: 'actuals_2026-01.csv',
        fileBuffer: csvBuffer('irrelevant'),
        sourceType: 'FILE_UPLOAD' as any,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  });

  it('kısmi geçersiz satırlar: geçerliler yüklenir, hatalar doğru kodla döner', async () => {
    mockCsvParser.parse.mockResolvedValue([
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '400000',
      },
      {
        cpl_code: 'UNKNOWN-CPL',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '100',
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'actuals_2026-01.csv',
      fileBuffer: csvBuffer(VALID_CSV),
      sourceType: 'FILE_UPLOAD' as any,
    });

    expect(result.validRows).toBe(1);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0].code).toBe('UNKNOWN_CPL');
    expect(result.batches).toHaveLength(1);
  });

  it('fiscalPeriod query verilmezse dosya adından çıkarır (actuals_YYYY-MM.csv)', async () => {
    mockCsvParser.parse.mockResolvedValue([
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '500000',
      },
    ]);

    const result = await service.ingest(TENANT_ID, USER_CTX, {
      fileName: 'actuals_2026-02.csv',
      fileBuffer: csvBuffer('irrelevant'),
      sourceType: 'FILE_UPLOAD' as any,
    });

    expect(result.fiscalPeriod).toBe('2026-02');
  });

  it('fiscalPeriod ne query ne dosya adından çıkarılabiliyorsa 400', async () => {
    mockCsvParser.parse.mockResolvedValue([]);

    await expect(
      service.ingest(TENANT_ID, USER_CTX, {
        fileName: 'random-name.csv',
        fileBuffer: csvBuffer('irrelevant'),
        sourceType: 'FILE_UPLOAD' as any,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('eşzamanlı yükleme (unique constraint 23505) -> 409 Conflict', async () => {
    mockCsvParser.parse.mockResolvedValue([
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '400000',
      },
    ]);
    mockRepository.findActiveBatchForUpdate.mockRejectedValue({
      code: '23505',
    });

    await expect(
      service.ingest(TENANT_ID, USER_CTX, {
        fileName: 'actuals_2026-01.csv',
        fileBuffer: csvBuffer(VALID_CSV),
        sourceType: 'FILE_UPLOAD' as any,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('SalesActualBatchStatus enum ACTIVE/REPLACED değerlerini korur (regresyon güvencesi)', () => {
    expect(SalesActualBatchStatus.ACTIVE).toBe('ACTIVE');
    expect(SalesActualBatchStatus.REPLACED).toBe('REPLACED');
  });
});
