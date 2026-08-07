import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvalidDecimalError } from '../../../../database/transformers/decimal.transformer';
import { asUserFacing } from '../../../../common/errors/user-facing';
import { OnInvoiceService } from './on-invoice.service';
import { OnInvoiceRepository } from './on-invoice.repository';
import { OnInvoiceFileParserService } from './services/on-invoice-file-parser.service';
import { OnInvoiceValidationService } from './services/on-invoice-validation.service';
import { CustomerService } from '../../../customer/customer.service';
import { SkuService } from '../../../master-data/sku/sku.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  OnInvoiceBatch,
  OnInvoiceBatchStatus,
} from '../../../../database/entities/on-invoice-batch.entity';
import { OnInvoiceEntryStatus } from '../../../../database/entities/on-invoice-entry.entity';
import { BudgetSpendType } from '../../../../database/entities/budget-envelope.entity';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const BATCH_ID = 'batch-001';

function splitGuardError() {
  return new BadRequestException({
    statusCode: 400,
    code: 'SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION',
    message: 'split dimension',
  });
}

// T-057 madde 4 (ölçüm sonucu, docs/analysis/0008 §5.7): OnInvoiceService is
// unconditionally ON_INVOICE (ledger entry hardcodes SpendType.ON_INVOICE,
// no field anywhere varies it).
//
// Team Lead bağımsız doğrulama (2026-08-03) — madde 3'teki canlı regresyonla
// AYNI SINIF: HER ZAMAN tipli çözüm kullanmak, `findEnvelopeByDimensions`'ın
// tipli-eşleşme sırasının (§5.1) AYNI kanal + AYNI yıldaki alakasız bir
// dönemde yaratılmış bir tipli zarfı UNSPLIT boyutun GERÇEK zarfının yerine
// geçirmesine yol açardı. Düzeltme: T-056 adım 6 deseni — ÖNCE unqualified
// çağrı, tipli çözüme yalnızca bu ÇAĞRININ KENDİSİ split guard'ına çarparsa
// geçilir.
describe('OnInvoiceService — T-057 madde 4 (envelope resolution)', () => {
  let service: OnInvoiceService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let customerService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let skuService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let budgetService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ledgerService: any;

  function buildEntry() {
    return {
      id: 'entry-1',
      customerId: 'cust-1',
      skuId: 'sku-1',
      fiscalPeriod: '2026-01',
      discount: 500,
      invoiceDate: new Date('2026-01-15'),
      status: OnInvoiceEntryStatus.PENDING,
    };
  }

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findEntriesByBatchId: jest.fn(),
      updateBatch: jest.fn().mockResolvedValue({}),
      updateEntry: jest.fn().mockResolvedValue({}),
    };
    customerService = { findOne: jest.fn() };
    skuService = { findOne: jest.fn() };
    budgetService = { findEnvelopeByDimensions: jest.fn() };
    ledgerService = { createEntry: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnInvoiceService,
        { provide: OnInvoiceRepository, useValue: repository },
        { provide: OnInvoiceFileParserService, useValue: {} },
        { provide: OnInvoiceValidationService, useValue: {} },
        { provide: CustomerService, useValue: customerService },
        { provide: SkuService, useValue: skuService },
        { provide: BudgetService, useValue: budgetService },
        { provide: LedgerService, useValue: ledgerService },
      ],
    }).compile();

    service = module.get(OnInvoiceService);

    repository.findById.mockResolvedValue({
      id: BATCH_ID,
      status: OnInvoiceBatchStatus.VALIDATED,
    } as OnInvoiceBatch);
    repository.findEntriesByBatchId.mockResolvedValue([buildEntry()]);
    customerService.findOne.mockResolvedValue({
      id: 'cust-1',
      channel: 'NKA',
      cplId: 'cpl-1',
    });
    skuService.findOne.mockResolvedValue({
      id: 'sku-1',
      fuId: 'fu-1',
      genericUnit: { category: { code: 'CAT-1' } },
    });
  });

  it('UNSPLIT dimension: unqualified lookup ONLY — no typed call, byte-for-byte pre-existing behaviour', async () => {
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-legacy',
    });

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledTimes(1);
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledWith(
      TENANT_ID,
      'NKA',
      '2026-01',
      'CAT-1',
    );
    expect(repository.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({
        status: OnInvoiceEntryStatus.POSTED,
        budgetEnvelopeId: 'env-legacy',
      }),
    );
  });

  it('GENUINELY SPLIT dimension: unqualified call throws the guard, THEN typed ON_INVOICE lookup resolves the correct twin', async () => {
    budgetService.findEnvelopeByDimensions
      .mockRejectedValueOnce(splitGuardError())
      .mockResolvedValueOnce({ id: 'env-on' });

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledTimes(2);
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenNthCalledWith(
      1,
      TENANT_ID,
      'NKA',
      '2026-01',
      'CAT-1',
    );
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenNthCalledWith(
      2,
      TENANT_ID,
      'NKA',
      '2026-01',
      'CAT-1',
      BudgetSpendType.ON_INVOICE,
    );
    expect(repository.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({
        status: OnInvoiceEntryStatus.POSTED,
        budgetEnvelopeId: 'env-on',
      }),
    );
  });

  it('an UNRELATED exception from the lookup is caught by the per-entry error handler (ERROR status, not silently posted)', async () => {
    const unrelated = new Error('unrelated boom');
    budgetService.findEnvelopeByDimensions.mockRejectedValue(unrelated);

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledTimes(1);
    expect(repository.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ status: OnInvoiceEntryStatus.ERROR }),
    );
  });

  // T-098: `validation_errors` is stored and returned by GET /on-invoice/entries,
  // so whatever lands there has left the server. The ERROR-status test above says
  // nothing about the text — which is how `error.message` sat in a persisted,
  // user-visible field unnoticed.
  //
  // THE THREE TESTS BELOW ARE ONE SET. Each alone is satisfied by a rule nobody
  // wants:
  //   - blanket redaction passes the last two and fails the first
  //   - blanket preservation passes the first and fails the last two
  //   - `instanceof HttpException` — the attempt this replaced — passes the first
  //     and the last, and FAILS THE MIDDLE ONE. That is exactly why it was
  //     reverted: the reachable throwers on this path emit `Customer with ID
  //     <uuid> not found` and the split guard's developer text, and neither was
  //     written for an uploader.
  //
  // Only "redact by default, exempt by declaration" satisfies all three.
  it('KEEPS a message explicitly declared user-facing', async () => {
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      asUserFacing(
        new NotFoundException(
          'Budget envelope bulunamadı: MT / HAIR / 2026-06',
        ),
      ),
    );

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    const persisted = (repository.updateEntry as jest.Mock).mock.calls.find(
      ([id]) => id === 'entry-1',
    )?.[1];

    expect(persisted.validationErrors[0].message).toContain(
      'Budget envelope bulunamadı: MT / HAIR / 2026-06',
    );
  });

  // The third call site of `diagnosticsOf`. The other two are asserted in their own
  // specs; without this one, this site could pass the bare error — losing `context`
  // and the stack — and nothing here would notice.
  it('hands the logger the offending value, not just the redacted message', async () => {
    const error = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      new InvalidDecimalError('CORRUPT-9'),
    );

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    expect(String(error.mock.calls[0]?.[1])).toContain('CORRUPT-9');
  });

  // The counter-example that killed `instanceof HttpException`. This is a real
  // NotFoundException carrying a real internal UUID, exactly what
  // `customerService.findOne` throws on this path — and it must NOT survive to the
  // entry just because of its class.
  it('REDACTS an unmarked HttpException — the class is not a declaration', async () => {
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      new NotFoundException(
        'Customer with ID 3f2a9c1e-7b44-4d0a-9c31-8e5b2d6f0a77 not found',
      ),
    );

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    const persisted = (repository.updateEntry as jest.Mock).mock.calls.find(
      ([id]) => id === 'entry-1',
    )?.[1];

    expect(persisted.validationErrors[0].message).not.toContain(
      '3f2a9c1e-7b44-4d0a-9c31-8e5b2d6f0a77',
    );
    expect(persisted.validationErrors[0].message).toContain(
      'NotFoundException',
    );
  });

  it('does not persist the internal error message into validation_errors', async () => {
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      new Error('column budget_envelopes.available_amount is "NaN"'),
    );

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    const persisted = (repository.updateEntry as jest.Mock).mock.calls.find(
      ([id]) => id === 'entry-1',
    )?.[1];

    expect(persisted.validationErrors[0].message).not.toContain('NaN');
    expect(persisted.validationErrors[0].message).not.toContain(
      'available_amount',
    );
    // The kind of failure is still recorded — this is not a blanket redaction.
    expect(persisted.validationErrors[0].message).toContain('Error');
  });

  // Independent bug found while producing T-057's e2e evidence (unrelated
  // to spend-type resolution, pre-existing at HEAD — `git show HEAD`
  // confirms `entry.invoiceDate.toISOString()` predates this task):
  // TypeORM hydrates a `type: 'date'` column as a plain 'YYYY-MM-DD'
  // STRING, not a `Date` — `findEntriesByBatchId` (the REAL repository)
  // always returns entries in that shape, so `buildEntry()`'s `new
  // Date(...)` above does NOT reproduce production's actual return shape.
  // This test uses a raw string deliberately, matching real hydration.
  it('REGRESSION (independent finding, fixed alongside T-057): entry.invoiceDate as a raw string (real TypeORM date-column hydration shape) does not crash — ledger entry is still POSTED', async () => {
    repository.findEntriesByBatchId.mockResolvedValue([
      { ...buildEntry(), invoiceDate: '2026-01-15' },
    ]);
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-legacy',
    });

    await service.processBatch(BATCH_ID, TENANT_ID, USER_ID);

    expect(ledgerService.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ postingDate: '2026-01-15' }),
      TENANT_ID,
      USER_ID,
      expect.any(String),
    );
    expect(repository.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ status: OnInvoiceEntryStatus.POSTED }),
    );
  });
});
