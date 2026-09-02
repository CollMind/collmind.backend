import { OffInvoiceValidationService } from './off-invoice-validation.service';
import { AgreementStatus } from '../../../../../database/entities/agreement.entity';
import { ParsedOffInvoiceRow } from './off-invoice-file-parser.service';

/**
 * FIRST SPEC FOR THIS FILE. It had none.
 *
 * T-126: `OffInvoiceFileParserService`'s getters no longer THROW for a
 * present-but-unreadable cell — they collect into `ParsedOffInvoiceRow.
 * parseErrors` instead (see that file's own spec). This is the OTHER half of
 * the contract: `validateRow` must (a) fold every entry of `row.parseErrors`
 * into its own `ValidationError` list, with the row's correct `rowNumber`,
 * and (b) NOT also emit the generic "zorunludur"/"pozitif olmalıdır" message
 * for the SAME field — that would double-report a single failure under two
 * different messages, one specific (the parse reason) and one generic and
 * misleading (a present-but-unreadable value is not "not specified").
 */

const TENANT_ID = 'tenant-001';

const AGREEMENT = {
  id: 'agreement-1',
  status: AgreementStatus.ACTIVE,
  capTotalAmount: 100000,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
};

function buildRow(
  overrides: Partial<ParsedOffInvoiceRow> = {},
): ParsedOffInvoiceRow {
  return {
    dto: {
      agreementId: 'agreement-1',
      invoiceNo: 'INV-1',
      invoiceDate: '2026-01-15',
      amount: 100,
      currency: 'TRY',
      notes: undefined,
    },
    originalRowNumber: 2,
    originalRowData: {},
    fiscalPeriod: '2026-01',
    ...overrides,
  };
}

describe('OffInvoiceValidationService — parseErrors integration (T-126)', () => {
  let service: OffInvoiceValidationService;
  let agreementService: { findById: jest.Mock; findByCode: jest.Mock };
  let txRepository: {
    sumByAgreementId: jest.Mock;
    findByIdempotencyKey: jest.Mock;
  };

  beforeEach(() => {
    agreementService = {
      findById: jest.fn().mockResolvedValue(AGREEMENT),
      findByCode: jest.fn().mockResolvedValue(AGREEMENT),
    };
    txRepository = {
      sumByAgreementId: jest.fn().mockResolvedValue(0),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    };
    service = new OffInvoiceValidationService(
      agreementService as any,
      txRepository as any,
    );
  });

  it('a row with no parseErrors and all fields valid is reported as valid, with the correct rowNumber', async () => {
    const row = buildRow({ originalRowNumber: 5 });

    const result = await service.validateRow(row, TENANT_ID);

    expect(result.isValid).toBe(true);
    expect(result.rowNumber).toBe(5);
    expect(result.errors).toHaveLength(0);
  });

  it('a row.parseErrors entry is folded into the ValidationError list, with the row-level rowNumber attached', async () => {
    const row = buildRow({
      originalRowNumber: 7,
      dto: {
        agreementId: 'agreement-1',
        invoiceNo: 'INV-1',
        invoiceDate: undefined, // present-but-unreadable, per the parser contract
        amount: 100,
        currency: 'TRY',
        notes: undefined,
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
        rowNumber: 7,
        field: 'invoice_date',
        severity: 'ERROR',
        message: "Tanınmayan tarih biçimi: '3/4/26'.",
        originalRowData: row.originalRowData,
      },
    ]);
  });

  // The double-report this guards against: `parseErrorFields.has('invoice_date')`
  // must suppress the generic "Fatura tarihi zorunludur" branch — otherwise a
  // single unreadable cell would produce TWO errors for the same field, one
  // specific (the real reason) and one generic and misleading (a
  // present-but-unreadable value is not "not specified").
  it('does NOT also emit the generic "Fatura tarihi zorunludur" message for a field that already has a parseErrors entry', async () => {
    const row = buildRow({
      dto: {
        agreementId: 'agreement-1',
        invoiceNo: 'INV-1',
        invoiceDate: undefined,
        amount: 100,
        currency: 'TRY',
        notes: undefined,
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

    const dateErrors = result.errors.filter((e) => e.field === 'invoice_date');
    expect(dateErrors).toHaveLength(1);
    expect(
      dateErrors.some((e) => e.message === 'Fatura tarihi zorunludur'),
    ).toBe(false);
  });

  // Contrast case: a GENUINELY absent invoice_date (no parseErrors entry —
  // the field was simply never given) must still produce the generic
  // "zorunludur" message. Without this, the guard above could be satisfied
  // by a service that stopped emitting the generic message altogether,
  // silently dropping coverage for the legitimately-absent case.
  it('DOES emit the generic "Fatura tarihi zorunludur" message when invoice_date is genuinely absent (no parseErrors entry)', async () => {
    const row = buildRow({
      dto: {
        agreementId: 'agreement-1',
        invoiceNo: 'INV-1',
        invoiceDate: undefined,
        amount: 100,
        currency: 'TRY',
        notes: undefined,
      },
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

  // Same suppression, `amount` field: an unparseable amount already has a
  // specific error; the generic "Tutar pozitif bir sayı olmalıdır" must not
  // also fire, and the cap-check branch (which needs a real number to
  // compare) must be skipped rather than compare `undefined` against the cap.
  it('an amount parseErrors entry suppresses the generic positivity message and the cap-check branch', async () => {
    const row = buildRow({
      dto: {
        agreementId: 'agreement-1',
        invoiceNo: 'INV-1',
        invoiceDate: '2026-01-15',
        amount: undefined,
        currency: 'TRY',
        notes: undefined,
      },
      parseErrors: [
        {
          field: 'amount',
          error_type: 'INVALID_AMOUNT',
          error_message: "Tanınmayan sayı biçimi: 'çöp'.",
        },
      ],
    });

    const result = await service.validateRow(row, TENANT_ID);

    const amountErrors = result.errors.filter((e) => e.field === 'amount');
    expect(amountErrors).toEqual([
      {
        rowNumber: row.originalRowNumber,
        field: 'amount',
        severity: 'ERROR',
        message: "Tanınmayan sayı biçimi: 'çöp'.",
        originalRowData: row.originalRowData,
      },
    ]);
    expect(txRepository.sumByAgreementId).not.toHaveBeenCalled();
  });

  // Same suppression, `fiscal_period` field: a present-but-unreadable
  // fiscal_period already has a specific error from the parser; the generic
  // "belirtilmedi" WARNING must not also fire, and the row must not fall
  // through to a fiscal-period-vs-invoice-date comparison against
  // `undefined`.
  it('a fiscal_period parseErrors entry suppresses the generic "belirtilmedi" warning', async () => {
    const row = buildRow({
      fiscalPeriod: undefined,
      parseErrors: [
        {
          field: 'fiscal_period',
          error_type: 'INVALID_DATE',
          error_message: "Geçersiz fiscal period formatı: 'çöp'.",
        },
      ],
    });

    const result = await service.validateRow(row, TENANT_ID);

    const fpWarnings = result.warnings.filter(
      (w) => w.field === 'fiscal_period',
    );
    expect(fpWarnings).toHaveLength(0);
    const fpErrors = result.errors.filter((e) => e.field === 'fiscal_period');
    expect(fpErrors).toEqual([
      {
        rowNumber: row.originalRowNumber,
        field: 'fiscal_period',
        severity: 'ERROR',
        message: "Geçersiz fiscal period formatı: 'çöp'.",
        originalRowData: row.originalRowData,
      },
    ]);
  });

  // Two-row fixture — item 3 of the task body ("teslimin kendisi"): one
  // broken row, one sound row. The sound row is valid; the broken row is
  // reported with its OWN, correct rowNumber; validateBatch does not stop
  // or reject anything at the batch level.
  it('end-to-end (validateBatch): a sound row and a broken row are BOTH reported, each with its own correct rowNumber', async () => {
    const soundRow = buildRow({ originalRowNumber: 2 });
    const brokenRow = buildRow({
      originalRowNumber: 3,
      dto: {
        agreementId: 'agreement-1',
        invoiceNo: 'INV-2',
        invoiceDate: undefined,
        amount: 100,
        currency: 'TRY',
        notes: undefined,
      },
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

  // T-333 (Z81 §4): a row.fiscalPeriod that disagrees with the period
  // derived from invoiceDate used to be a WARNING (isValid stayed true). A
  // mismatched fiscal_period is a wrong budget-envelope KEY, not a cosmetic
  // discrepancy — "yarım anahtar, tam anahtar kadar yanlış eşleşir" — so it
  // must REJECT the row (§2.5 class: silent-wrong-match is not acceptable).
  describe('fiscal_period vs invoiceDate mismatch (T-333 / Z81 §4)', () => {
    it('rejects the row (ERROR, isValid=false) when fiscalPeriod disagrees with the invoiceDate-derived period', async () => {
      const row = buildRow({
        fiscalPeriod: '2026-02',
        dto: {
          agreementId: 'agreement-1',
          invoiceNo: 'INV-3',
          invoiceDate: '2026-01-15', // -> derived period 2026-01
          amount: 100,
          currency: 'TRY',
          notes: undefined,
        },
      });

      const result = await service.validateRow(row, TENANT_ID);

      expect(result.isValid).toBe(false);
      const mismatchError = result.errors.find(
        (e) => e.field === 'fiscal_period',
      );
      expect(mismatchError).toBeDefined();
      expect(mismatchError!.severity).toBe('ERROR');
      // Message must not collide with the format-validation ERROR
      // ("Fiscal Period formatı hatalı") — this is a DIFFERENT failure class.
      expect(mismatchError!.message).not.toContain('formatı hatalı');
      expect(
        result.warnings.find((w) => w.field === 'fiscal_period'),
      ).toBeUndefined();
    });

    it('stays valid when fiscalPeriod agrees with the invoiceDate-derived period', async () => {
      const row = buildRow({
        fiscalPeriod: '2026-01',
        dto: {
          agreementId: 'agreement-1',
          invoiceNo: 'INV-4',
          invoiceDate: '2026-01-15',
          amount: 100,
          currency: 'TRY',
          notes: undefined,
        },
      });

      const result = await service.validateRow(row, TENANT_ID);

      expect(result.isValid).toBe(true);
      expect(
        result.errors.find((e) => e.field === 'fiscal_period'),
      ).toBeUndefined();
    });

    // TZ-bağımsızlık: T-333'ün kökü local getMonth()/getFullYear() idi.
    // Ayın son gününde (UTC gece yarısı parse), local getter batı TZ'de bir
    // gün/ay geriye kayardı. `toPeriodMonthUtc` kullanıldığı için bu artık
    // process TZ'sinden bağımsız olmalı.
    it('derives the period on UTC components regardless of process TZ (month-boundary date)', async () => {
      const row = buildRow({
        fiscalPeriod: '2026-02',
        dto: {
          agreementId: 'agreement-1',
          invoiceNo: 'INV-5',
          invoiceDate: '2026-02-01', // date-only ISO -> UTC midnight
          amount: 100,
          currency: 'TRY',
          notes: undefined,
        },
      });

      const result = await service.validateRow(row, TENANT_ID);

      expect(result.isValid).toBe(true);
      expect(
        result.errors.find((e) => e.field === 'fiscal_period'),
      ).toBeUndefined();
    });
  });
});
