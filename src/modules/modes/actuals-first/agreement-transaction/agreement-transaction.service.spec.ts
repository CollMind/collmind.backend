import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AgreementTransactionService } from './agreement-transaction.service';
import { AgreementTransactionRepository } from './agreement-transaction.repository';
import { LedgerService } from '../ledger/ledger.service';
import { AgreementService } from '../agreement/agreement.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import {
  AgreementStatus,
  SpendType as AgreementSpendType,
} from '../../../../database/entities/agreement.entity';
import { BudgetSpendType } from '../../../../database/entities/budget-envelope.entity';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const AGREEMENT_ID = 'agr-001';

function buildAgreement(spendType: AgreementSpendType | null | undefined) {
  return {
    id: AGREEMENT_ID,
    status: AgreementStatus.APPROVED,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    capTotalAmount: 1000000,
    periodMonth: '2026-01',
    channel: { code: 'NKA' },
    cplId: 'cpl-1',
    fuId: 'fu-1',
    tacticId: 'tactic-1',
    mechanicId: 'mechanic-1',
    spendType,
  } as any;
}

function buildDto() {
  return {
    agreementId: AGREEMENT_ID,
    invoiceNo: 'INV-001',
    invoiceDate: '2026-01-15',
    fiscalPeriod: '2026-01',
    amount: 1000,
    currency: 'TRY',
  };
}

function splitGuardError() {
  return new BadRequestException({
    statusCode: 400,
    code: 'SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION',
    message: 'split dimension',
  });
}

// T-057 madde 3 (docs/analysis/0008 §5.7, ADR 0004 Karar 3):
// `AgreementTransactionService#create`'in ledger-posting envelope lookup'u
// (agreement-transaction.service.ts:142 civarı).
//
// Team Lead bağımsız doğrulama (2026-08-03) — canlı regresyon bulundu ve
// kapatıldı: ilk teslim agreement.spendType TİPLİYSE HER ZAMAN tipli
// çözümü kullanıyordu (dönem/dimension bağımsız). `findEnvelopeByDimensions`
// tipli aramada spend_type eşleşmesini dönem eşleşmesinden ÖNCE sıralar
// (§5.1) — yani AYNI kanal + AYNI yıldaki TAMAMEN alakasız bir dönemde
// (ör. role-journey.e2e-spec.ts'in A19 test fixture'ı, NKA/2026-09) test
// amaçlı yaratılmış tipli bir zarf, bu agreement'ın GERÇEK UNSPLIT zarfının
// (ör. NKA/2026-02) yerine geçebiliyordu — role-journey C9c'de canlı
// "Insufficient budget" 400'üne yol açtı (SQL kanıtı: T-057 teslim
// notlarında). Düzeltme: T-056 adım 6 deseni artık BURADA da uygulanıyor —
// ÖNCE unqualified çağrı (bugünkü UNSPLIT davranışının ta kendisi), tipli
// çözüme yalnızca bu ÇAĞRININ KENDİSİ split guard'ına çarparsa geçilir.
describe('AgreementTransactionService — T-057 madde 3 (agreement spend_type resolution)', () => {
  let service: AgreementTransactionService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txRepo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ledgerService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agreementService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let budgetService: any;

  beforeEach(async () => {
    txRepo = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      sumByAgreementId: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((tx: any) =>
          Promise.resolve({ ...tx, id: 'tx-created' }),
        ),
    };
    ledgerService = {
      createFromAgreementTransaction: jest.fn().mockResolvedValue({}),
    };
    agreementService = {
      findById: jest.fn(),
    };
    budgetService = {
      findEnvelopeByDimensions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgreementTransactionService,
        { provide: AgreementTransactionRepository, useValue: txRepo },
        { provide: LedgerService, useValue: ledgerService },
        { provide: AgreementService, useValue: agreementService },
        { provide: BudgetService, useValue: budgetService },
      ],
    }).compile();

    service = module.get(AgreementTransactionService);
  });

  it('ON_INVOICE agreement on an UNSPLIT dimension: unqualified lookup ONLY — no typed call, byte-for-byte pre-existing behaviour', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.ON_INVOICE),
    );
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-legacy',
      code: 'NKA/2026-01',
    });

    await service.create(buildDto() as any, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledTimes(1);
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledWith(
      TENANT_ID,
      'NKA',
      '2026-01',
    );
    expect(ledgerService.createFromAgreementTransaction).toHaveBeenCalledWith(
      AGREEMENT_ID,
      'tx-created',
      1000,
      expect.any(Date),
      '2026-01',
      'env-legacy',
      expect.any(Object),
      TENANT_ID,
      USER_ID,
    );
  });

  it('ON_INVOICE agreement on a GENUINELY SPLIT dimension: unqualified call throws the guard, THEN typed lookup resolves the correct twin', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.ON_INVOICE),
    );
    budgetService.findEnvelopeByDimensions
      .mockRejectedValueOnce(splitGuardError())
      .mockResolvedValueOnce({ id: 'env-on', code: 'NKA/2026-01-ON' });

    await service.create(buildDto() as any, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledTimes(2);
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenNthCalledWith(
      1,
      TENANT_ID,
      'NKA',
      '2026-01',
    );
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenNthCalledWith(
      2,
      TENANT_ID,
      'NKA',
      '2026-01',
      undefined,
      BudgetSpendType.ON_INVOICE,
    );
    expect(ledgerService.createFromAgreementTransaction).toHaveBeenCalledWith(
      AGREEMENT_ID,
      'tx-created',
      1000,
      expect.any(Date),
      '2026-01',
      'env-on',
      expect.any(Object),
      TENANT_ID,
      USER_ID,
    );
  });

  it('OFF_INVOICE agreement on a GENUINELY SPLIT dimension: typed lookup resolves the OFF twin', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.OFF_INVOICE),
    );
    budgetService.findEnvelopeByDimensions
      .mockRejectedValueOnce(splitGuardError())
      .mockResolvedValueOnce({ id: 'env-off', code: 'NKA/2026-01-OFF' });

    await service.create(buildDto() as any, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenNthCalledWith(
      2,
      TENANT_ID,
      'NKA',
      '2026-01',
      undefined,
      BudgetSpendType.OFF_INVOICE,
    );
  });

  it('BOTH agreement on an UNSPLIT dimension: unqualified lookup, unaffected (pre-existing behaviour)', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.BOTH),
    );
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-legacy',
      code: 'NKA/2026-01',
    });

    await service.create(buildDto() as any, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledTimes(1);
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledWith(
      TENANT_ID,
      'NKA',
      '2026-01',
    );
    expect(ledgerService.createFromAgreementTransaction).toHaveBeenCalledWith(
      AGREEMENT_ID,
      'tx-created',
      1000,
      expect.any(Date),
      '2026-01',
      'env-legacy',
      expect.any(Object),
      TENANT_ID,
      USER_ID,
    );
  });

  it('NULL spend_type agreement on an UNSPLIT dimension: unqualified lookup, unaffected', async () => {
    agreementService.findById.mockResolvedValue(buildAgreement(undefined));
    budgetService.findEnvelopeByDimensions.mockResolvedValue({
      id: 'env-legacy',
      code: 'NKA/2026-01',
    });

    await service.create(buildDto() as any, TENANT_ID, USER_ID);

    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledWith(
      TENANT_ID,
      'NKA',
      '2026-01',
    );
  });

  it('BOTH agreement on a SPLIT dimension → 400 AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED, no ledger entry written', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.BOTH),
    );
    budgetService.findEnvelopeByDimensions.mockRejectedValue(splitGuardError());

    await expect(
      service.create(buildDto() as any, TENANT_ID, USER_ID),
    ).rejects.toMatchObject({
      response: { code: 'AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED' },
    });
    expect(ledgerService.createFromAgreementTransaction).not.toHaveBeenCalled();
  });

  // T-057 B2 (code-reviewer, 2026-08-04): orphan-row regression guard —
  // envelope resolution (and its AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED reject)
  // must run BEFORE `txRepo.create()` (a real DB `save`). If it runs after,
  // the 400 still leaves a written row behind that a subsequent
  // `sumByAgreementId` cap check would silently consume — a "yarım durum"
  // ADR 0004 Karar 2 exists to prevent.
  it('B2 — BOTH agreement on a SPLIT dimension: 400 means NO transaction row is ever written (txRepo.create not called)', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.BOTH),
    );
    budgetService.findEnvelopeByDimensions.mockRejectedValue(splitGuardError());

    await expect(
      service.create(buildDto() as any, TENANT_ID, USER_ID),
    ).rejects.toMatchObject({
      response: { code: 'AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED' },
    });
    expect(txRepo.create).not.toHaveBeenCalled();
  });

  it('NULL spend_type agreement on a SPLIT dimension → 400 AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED', async () => {
    agreementService.findById.mockResolvedValue(buildAgreement(null));
    budgetService.findEnvelopeByDimensions.mockRejectedValue(splitGuardError());

    await expect(
      service.create(buildDto() as any, TENANT_ID, USER_ID),
    ).rejects.toMatchObject({
      response: { code: 'AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED' },
    });
    expect(txRepo.create).not.toHaveBeenCalled();
  });

  it('an UNRELATED BadRequestException from the lookup still propagates as-is (guard specificity)', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.BOTH),
    );
    const unrelated = new BadRequestException('some other error');
    budgetService.findEnvelopeByDimensions.mockRejectedValue(unrelated);

    await expect(
      service.create(buildDto() as any, TENANT_ID, USER_ID),
    ).rejects.toBe(unrelated);
  });

  it('MUTATION-PROOF SETUP: an unrelated BadRequestException on a TYPED agreement also propagates as-is (not swallowed by the split branch)', async () => {
    agreementService.findById.mockResolvedValue(
      buildAgreement(AgreementSpendType.ON_INVOICE),
    );
    const unrelated = new BadRequestException('some other error');
    budgetService.findEnvelopeByDimensions.mockRejectedValue(unrelated);

    await expect(
      service.create(buildDto() as any, TENANT_ID, USER_ID),
    ).rejects.toBe(unrelated);
    expect(budgetService.findEnvelopeByDimensions).toHaveBeenCalledTimes(1);
  });
});
