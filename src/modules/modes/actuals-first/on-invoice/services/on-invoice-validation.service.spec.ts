import { Test, TestingModule } from '@nestjs/testing';
import { OnInvoiceValidationService } from './on-invoice-validation.service';
import { CustomerService } from '../../../../customer/customer.service';
import { SkuService } from '../../../../master-data/sku/sku.service';
import { BudgetService } from '../../../../shared/budget/budget.service';
import { BudgetThresholdService } from '../../../../shared/budget/budget-threshold.service';
import { OnInvoiceRepository } from '../on-invoice.repository';
import { UtilizationStatus } from '../../../../shared/finance-reporting/dto/budget-utilization.dto';
import { InvalidDecimalError } from '../../../../../database/transformers/decimal.transformer';
import { CustomerStatus } from '../../../../../database/entities/customer.entity';
import { ParsedOnInvoiceRow } from './on-invoice-file-parser.service';

/**
 * FIRST SPEC FOR THIS FILE. It had none — and in this codebase an untested file
 * is a file that accumulates defects (T-089 found three classes in a sibling
 * service with zero tests). These cover the T-098 failure path only; the rest of
 * the service is still unguarded and that is worth knowing.
 */

const TENANT_ID = 'tenant-001';

// simulateBudgetImpact groups by channel|category|fiscalPeriod, and only reads
// these fields off the row/result pair.
const row = (discount: number) => ({
  dto: { fiscalPeriod: '2026-06', discount },
  originalRowNumber: 1,
});
const result = () => ({
  rowNumber: 1,
  isValid: true,
  errors: [],
  warnings: [],
  channel: 'MT',
  category: 'HAIR',
});

describe('OnInvoiceValidationService — budget impact failure path (T-098)', () => {
  let service: OnInvoiceValidationService;
  let budgetService: {
    findEnvelopeByDimensions: jest.Mock;
    getEnvelopeBudgetSummary: jest.Mock;
  };
  let budgetThresholdService: {
    getThresholds: jest.Mock;
    toStatus: jest.Mock;
    isExceeded: jest.Mock;
  };

  const simulate = () =>
    (service as any).simulateBudgetImpact(
      [row(1000)],
      [result()],
      TENANT_ID,
    ) as Promise<{
      rows: Array<{
        envelopeCode: string;
        current: number | null;
        after: number | null;
        status: UtilizationStatus | null;
        dataStatus: 'ok' | 'unavailable';
      }>;
      thresholdSource: string;
      thresholdReason?: string;
    }>;

  beforeEach(async () => {
    budgetService = {
      findEnvelopeByDimensions: jest.fn(),
      // INV-B-009 / Z45 §3: the service now cross-checks the envelope's
      // stale snapshot column against the canonical view before trusting
      // either. Default: no divergence (matches `envelope.availableAmount`/
      // `allocatedAmount` set by each test) — individual tests below reflect
      // the same figures unless explicitly testing the divergence path.
      getEnvelopeBudgetSummary: jest.fn(),
    };
    budgetThresholdService = {
      getThresholds: jest.fn().mockResolvedValue({
        warning: 80,
        critical: 95,
        exceeded: 100,
        source: 'config',
      }),
      toStatus: jest.fn().mockReturnValue(UtilizationStatus.GREEN),
      isExceeded: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnInvoiceValidationService,
        { provide: CustomerService, useValue: {} },
        { provide: SkuService, useValue: {} },
        { provide: BudgetService, useValue: budgetService },
        { provide: BudgetThresholdService, useValue: budgetThresholdService },
        { provide: OnInvoiceRepository, useValue: {} },
      ],
    }).compile();

    service = module.get(OnInvoiceValidationService);
    jest.spyOn(service['logger'], 'warn').mockImplementation();
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  // The defect this replaces: the catch pushed `current: 0, status: RED`. Zero is
  // a valid budget figure and RED is a finding, so a failure entered the report
  // wearing two disguises at once.
  it('reports an unreadable envelope as unavailable, not as a zero balance', async () => {
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      new InvalidDecimalError('NaN'),
    );

    const [impact] = (await simulate()).rows;

    expect(impact.dataStatus).toBe('unavailable');
    expect(impact.current).toBeNull();
    expect(impact.after).toBeNull();
  });

  // Separate from the assertion above on purpose: `current: null` and
  // `status: null` are two different disguises, and a fix for one does not imply
  // the other. RED would have made the failure look like a threshold breach.
  it('does not dress the failure up as a RED finding', async () => {
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      new InvalidDecimalError('NaN'),
    );

    const [impact] = (await simulate()).rows;

    expect(impact.status).toBeNull();
  });

  // The point of redacting the message (T-098/1) was to relocate the value, not
  // delete it. Without this assertion the logger call could pass the bare error —
  // which Nest renders via Error.toString(), dropping context and stack — and
  // every other test here would stay green while diagnosis was gone.
  it('hands the logger the offending value, not just the redacted message', () => {
    const warn = jest.spyOn(service['logger'], 'warn');
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      new InvalidDecimalError('CORRUPT-42'),
    );

    return simulate().then(() => {
      const diagnostics = warn.mock.calls[0]?.[1];
      expect(String(diagnostics)).toContain('CORRUPT-42');
    });
  });

  // The row must survive. An envelope absent from a budget-impact report reads as
  // "not affected" — the same lie, inverted.
  it('keeps the row so the envelope cannot read as unaffected', async () => {
    budgetService.findEnvelopeByDimensions.mockRejectedValue(
      new InvalidDecimalError('NaN'),
    );

    const impacts = (await simulate()).rows;

    expect(impacts).toHaveLength(1);
    expect(impacts[0].envelopeCode).toContain('MT');
  });

  // T-101: RED means "this upload breaches YOUR threshold". When the thresholds
  // are product defaults nobody configured, that sentence is false, so the verdict
  // is withheld rather than asserted.
  //
  // The FIGURES stay — `dataStatus` is still 'ok' and the amounts are real. Marking
  // the row unavailable would make the UI print "hesaplanamadı" over numbers it had
  // computed correctly: the row's data and the threshold's provenance are two
  // different facts.
  it("withholds the RAG verdict when thresholds are not the tenant's own", async () => {
    budgetThresholdService.getThresholds.mockResolvedValue({
      warning: 80,
      critical: 95,
      exceeded: 100,
      source: 'default',
      reason: 'no-configuration',
    });
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-1',
      availableAmount: 5000,
      allocatedAmount: 10000,
    });
    budgetService.getEnvelopeBudgetSummary.mockResolvedValue({
      availableAmount: 5000,
      allocatedAmount: 10000,
    });

    const result = await simulate();

    expect(result.rows[0].status).toBeNull();
    expect(result.rows[0].dataStatus).toBe('ok');
    expect(result.rows[0].current).toBe(5000);
    expect(result.thresholdSource).toBe('default');
    expect(result.thresholdReason).toBe('no-configuration');
  });

  // Without this, every assertion above would also pass on a service that
  // returned `unavailable` unconditionally. It is what makes them distinguishing.
  it('still reports real figures when the envelope reads fine', async () => {
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-1',
      availableAmount: 5000,
      allocatedAmount: 10000,
    });
    budgetService.getEnvelopeBudgetSummary.mockResolvedValue({
      availableAmount: 5000,
      allocatedAmount: 10000,
    });

    const [impact] = (await simulate()).rows;

    expect(impact.dataStatus).toBe('ok');
    expect(impact.current).toBe(5000);
    expect(impact.status).toBe(UtilizationStatus.GREEN);
  });

  // INV-B-009 / Z45 §3 — REPRO PİNİ: `budget_envelopes.available_amount`
  // (the stale snapshot column) and `v_budget_summary.available_amount`
  // (the canonical, ledger-derived view) disagree — as measured live on
  // ENV-2026-NKA-Q1/Q2 (two of four envelopes, diff ₺96.500/₺75.000). The
  // service must not silently trust either number: it reports the row as
  // unavailable (same failure shape as an unreadable envelope, T-098),
  // never a wrong RAG verdict built on a stale figure.
  it('[YAPISAL] refuses to trust a stale envelope column that disagrees with v_budget_summary (INV-B-009)', async () => {
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-divergent',
      availableAmount: 500000, // stale column — never decremented by RESERVE
      allocatedAmount: 500000,
    });
    budgetService.getEnvelopeBudgetSummary.mockResolvedValue({
      availableAmount: 403500, // canonical — allocated(500000) - reserved(95000) - consumed(1500)
      allocatedAmount: 500000,
    });

    const [impact] = (await simulate()).rows;

    expect(impact.dataStatus).toBe('unavailable');
    expect(impact.current).toBeNull();
    expect(impact.status).toBeNull();
  });

  // Positive control for the pin above: when the two sources AGREE, the row
  // is 'ok' and carries the canonical (view) figure — proving the divergence
  // check, not some unrelated failure, is what flips the previous case.
  it('[YAPISAL] reports ok using the canonical view figure when column and view agree', async () => {
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-agree',
      availableAmount: 200000,
      allocatedAmount: 200000,
    });
    budgetService.getEnvelopeBudgetSummary.mockResolvedValue({
      availableAmount: 200000,
      allocatedAmount: 200000,
    });

    const [impact] = (await simulate()).rows;

    expect(impact.dataStatus).toBe('ok');
    expect(impact.current).toBe(200000);
  });
});

/**
 * T-126: `OnInvoiceFileParserService`'s getters (`getDateValue`,
 * `getNumberValue`, `getDiscountType`) no longer THROW for a
 * present-but-unreadable cell — they collect into `ParsedOnInvoiceRow.
 * parseErrors` instead (see that file's own spec). This is the OTHER half of
 * the contract: `validateRow` must fold every entry into its own
 * `ValidationError` list with the row's correct `rowNumber`, and NOT also
 * emit the generic "zorunludur"/"pozitif olmalıdır" message for the SAME
 * field.
 */
describe('OnInvoiceValidationService — parseErrors integration (T-126)', () => {
  let service: OnInvoiceValidationService;
  let customerService: { findByCode: jest.Mock };
  let skuService: { findByCode: jest.Mock };
  let repository: {
    findByIdempotencyKey: jest.Mock;
  };

  const CUSTOMER = {
    id: 'cust-1',
    code: 'CUST-1',
    status: CustomerStatus.ACTIVE,
    channel: 'MT',
  };
  const SKU = {
    id: 'sku-1',
    code: 'SKU-1',
    isActive: true,
    genericUnit: { category: { code: 'HAIR' } },
  };

  function buildRow(
    overrides: Partial<ParsedOnInvoiceRow> = {},
  ): ParsedOnInvoiceRow {
    return {
      dto: {
        customerCode: 'CUST-1',
        invoiceNo: 'INV-1',
        invoiceDate: '2026-01-15',
        fiscalPeriod: '2026-01',
        skuCode: 'SKU-1',
        quantity: 10,
        listPrice: 100,
        actualPrice: 95,
        discount: 5,
        discountType: 'CPP_ON' as any,
        currency: 'TRY',
      },
      originalRowNumber: 2,
      originalRowData: {},
      ...overrides,
    };
  }

  beforeEach(async () => {
    customerService = { findByCode: jest.fn().mockResolvedValue(CUSTOMER) };
    skuService = { findByCode: jest.fn().mockResolvedValue(SKU) };
    repository = { findByIdempotencyKey: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnInvoiceValidationService,
        { provide: CustomerService, useValue: customerService },
        { provide: SkuService, useValue: skuService },
        { provide: BudgetService, useValue: {} },
        { provide: BudgetThresholdService, useValue: {} },
        { provide: OnInvoiceRepository, useValue: repository },
      ],
    }).compile();

    service = module.get(OnInvoiceValidationService);
  });

  it('a sound row with no parseErrors is reported as valid, with the correct rowNumber', async () => {
    const row = buildRow({ originalRowNumber: 5 });

    const result = await service.validateRow(row, TENANT_ID);

    expect(result.isValid).toBe(true);
    expect(result.rowNumber).toBe(5);
  });

  it('a row.parseErrors entry is folded into the ValidationError list, with the row-level rowNumber attached', async () => {
    const row = buildRow({
      originalRowNumber: 9,
      dto: {
        ...buildRow().dto,
        invoiceDate: undefined,
      },
      parseErrors: [
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: "Tanınmayan tarih biçimi: '3/4/26'.",
        },
      ],
    });

    const result = await service.validateRow(row, TENANT_ID);

    expect(result.isValid).toBe(false);
    const dateErrors = result.errors.filter((e) => e.field === 'invoice_date');
    expect(dateErrors).toEqual([
      {
        rowNumber: 9,
        field: 'invoice_date',
        severity: 'ERROR',
        message: "Tanınmayan tarih biçimi: '3/4/26'.",
        originalRowData: row.originalRowData,
      },
    ]);
  });

  it('does NOT also emit the generic "Fatura tarihi zorunludur" message when invoice_date already has a parseErrors entry', async () => {
    const row = buildRow({
      dto: { ...buildRow().dto, invoiceDate: undefined },
      parseErrors: [
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: "Tanınmayan tarih biçimi: '3/4/26'.",
        },
      ],
    });

    const result = await service.validateRow(row, TENANT_ID);

    const dateErrors = result.errors.filter((e) => e.field === 'invoice_date');
    expect(dateErrors).toHaveLength(1);
  });

  // Contrast case: a genuinely absent invoice_date must still get the
  // generic message — otherwise the suppression guard above could be
  // satisfied by a service that dropped the generic check altogether.
  it('DOES emit the generic "Fatura tarihi zorunludur" message when invoice_date is genuinely absent (no parseErrors entry)', async () => {
    const row = buildRow({
      dto: { ...buildRow().dto, invoiceDate: undefined },
      parseErrors: undefined,
    });

    const result = await service.validateRow(row, TENANT_ID);

    const dateErrors = result.errors.filter((e) => e.field === 'invoice_date');
    expect(dateErrors).toEqual([
      {
        rowNumber: row.originalRowNumber,
        field: 'invoice_date',
        severity: 'ERROR',
        message: 'Fatura tarihi zorunludur',
        originalRowData: row.originalRowData,
      },
    ]);
  });

  // `quantity` is the field the code's own guard comment calls out: without
  // `!parseErrorFields.has('quantity')`, `undefined` would ALSO satisfy the
  // generic "zorunlu" presence check below, double-reporting the same cell.
  it('a quantity parseErrors entry suppresses the generic "Miktar pozitif bir sayı olmalıdır" message', async () => {
    const row = buildRow({
      dto: { ...buildRow().dto, quantity: undefined },
      parseErrors: [
        {
          field: 'quantity',
          error_type: 'INVALID_AMOUNT',
          error_message: "Tanınmayan sayı biçimi: 'çöp'.",
        },
      ],
    });

    const result = await service.validateRow(row, TENANT_ID);

    const quantityErrors = result.errors.filter((e) => e.field === 'quantity');
    expect(quantityErrors).toEqual([
      {
        rowNumber: row.originalRowNumber,
        field: 'quantity',
        severity: 'ERROR',
        message: "Tanınmayan sayı biçimi: 'çöp'.",
        originalRowData: row.originalRowData,
      },
    ]);
  });

  it('a discount_type parseErrors entry suppresses the generic "İndirim tipi zorunludur" message', async () => {
    const row = buildRow({
      dto: { ...buildRow().dto, discountType: undefined },
      parseErrors: [
        {
          field: 'discount_type',
          error_type: 'INVALID_ENUM',
          error_message: "Geçersiz indirim tipi: 'XYZ'.",
        },
      ],
    });

    const result = await service.validateRow(row, TENANT_ID);

    const discountTypeErrors = result.errors.filter(
      (e) => e.field === 'discount_type',
    );
    expect(discountTypeErrors).toEqual([
      {
        rowNumber: row.originalRowNumber,
        field: 'discount_type',
        severity: 'ERROR',
        message: "Geçersiz indirim tipi: 'XYZ'.",
        originalRowData: row.originalRowData,
      },
    ]);
  });

  // Two-row fixture — item 3 of the task body ("teslimin kendisi"): one
  // sound row, one broken row, each reported with its own correct
  // rowNumber; validateBatch does not stop or reject anything.
  it('end-to-end (validateBatch): a sound row and a broken row are BOTH reported, each with its own correct rowNumber', async () => {
    const soundRow = buildRow({ originalRowNumber: 2 });
    const brokenRow = buildRow({
      originalRowNumber: 3,
      dto: { ...buildRow().dto, invoiceDate: undefined },
      parseErrors: [
        {
          field: 'invoice_date',
          error_type: 'INVALID_DATE',
          error_message: "Tanınmayan tarih biçimi: '3/4/26'.",
        },
      ],
    });

    const results = await service.validateBatch(
      [soundRow, brokenRow],
      TENANT_ID,
    );

    expect(results).toHaveLength(2);
    expect(results[0].rowNumber).toBe(2);
    expect(results[0].isValid).toBe(true);
    expect(results[1].rowNumber).toBe(3);
    expect(results[1].isValid).toBe(false);
    expect(
      results[1].errors.find((e) => e.field === 'invoice_date')?.rowNumber,
    ).toBe(3);
  });
});
