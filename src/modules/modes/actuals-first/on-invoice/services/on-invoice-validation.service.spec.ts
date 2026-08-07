import { Test, TestingModule } from '@nestjs/testing';
import { OnInvoiceValidationService } from './on-invoice-validation.service';
import { CustomerService } from '../../../../customer/customer.service';
import { SkuService } from '../../../../master-data/sku/sku.service';
import { BudgetService } from '../../../../shared/budget/budget.service';
import { BudgetThresholdService } from '../../../../shared/budget/budget-threshold.service';
import { OnInvoiceRepository } from '../on-invoice.repository';
import { UtilizationStatus } from '../../../../shared/finance-reporting/dto/budget-utilization.dto';
import { InvalidDecimalError } from '../../../../../database/transformers/decimal.transformer';

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
  let budgetService: { findEnvelopeByDimensions: jest.Mock };
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
    ) as Promise<
      Array<{
        envelopeCode: string;
        current: number | null;
        after: number | null;
        status: UtilizationStatus | null;
        dataStatus: 'ok' | 'unavailable';
      }>
    >;

  beforeEach(async () => {
    budgetService = { findEnvelopeByDimensions: jest.fn() };
    budgetThresholdService = {
      getThresholds: jest.fn().mockResolvedValue({}),
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

    const [impact] = await simulate();

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

    const [impact] = await simulate();

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

    const impacts = await simulate();

    expect(impacts).toHaveLength(1);
    expect(impacts[0].envelopeCode).toContain('MT');
  });

  // Without this, every assertion above would also pass on a service that
  // returned `unavailable` unconditionally. It is what makes them distinguishing.
  it('still reports real figures when the envelope reads fine', async () => {
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      availableAmount: 5000,
      allocatedAmount: 10000,
    });

    const [impact] = await simulate();

    expect(impact.dataStatus).toBe('ok');
    expect(impact.current).toBe(5000);
    expect(impact.status).toBe(UtilizationStatus.GREEN);
  });
});
