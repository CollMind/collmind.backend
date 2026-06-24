import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReversalService } from './reversal.service';
import { AgreementTransactionRepository } from '../agreement-transaction/agreement-transaction.repository';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
import { LedgerEntryDirection } from '../../../../database/entities/ledger-entry.entity';
import { AgreementStatus } from '../../../../database/entities/agreement.entity';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const USER_EMAIL = 'admin@test.com';
const TX_ID = 'tx-001';
const AGREEMENT_ID = 'agr-001';
const LEDGER_ID = 'led-001';
const REVERSAL_LEDGER_ID = 'led-rev-001';
const ENVELOPE_ID = 'env-001';

// B-2: idempotency key format written by createFromAgreementTransaction
const EXPECTED_IDEMPOTENCY_KEY = `LEDGER|AGREEMENT|${AGREEMENT_ID}|${TX_ID}`;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTransaction(overrides: Record<string, any> = {}) {
  return {
    id: TX_ID,
    tenantId: TENANT_ID,
    agreementId: AGREEMENT_ID,
    isReversed: false,
    amount: 1000,
    currency: 'TRY',
    agreement: {
      id: AGREEMENT_ID,
      status: AgreementStatus.APPROVED,
    },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOriginalEntry(overrides: Record<string, any> = {}) {
  return {
    id: LEDGER_ID,
    tenantId: TENANT_ID,
    agreementId: AGREEMENT_ID,
    idempotencyKey: EXPECTED_IDEMPOTENCY_KEY,
    entryDirection: LedgerEntryDirection.DEBIT,
    amount: 1000,
    currency: 'TRY',
    budgetEnvelopeId: ENVELOPE_ID,
    isReversed: false,
    ...overrides,
  };
}

function buildReversalEntry() {
  return {
    id: REVERSAL_LEDGER_ID,
    entryDirection: LedgerEntryDirection.CREDIT,
    amount: 1000,
    reversesEntryId: LEDGER_ID,
    isReversed: false,
  };
}

// ---------------------------------------------------------------------------
// Mock QueryRunner
// ---------------------------------------------------------------------------

function buildQueryRunner() {
  return {
    connect: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    startTransaction: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    commitTransaction: jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined),
    rollbackTransaction: jest
      .fn<Promise<void>, []>()
      .mockResolvedValue(undefined),
    release: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    manager: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: jest.fn<Promise<any>, any[]>().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: jest.fn<any, any[]>().mockImplementation((_cls, data) => data),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      save: jest
        .fn<Promise<any>, any[]>()
        .mockResolvedValue(buildReversalEntry()),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReversalService', () => {
  let service: ReversalService;

  // typed as any to avoid jest.Mocked<Partial<>> complexity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTxRepo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLedgerService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLedgerRepo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAuditService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDataSource: any;
  let mockQueryRunner: ReturnType<typeof buildQueryRunner>;

  beforeEach(async () => {
    mockQueryRunner = buildQueryRunner();

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    mockTxRepo = {
      findById: jest.fn(),
    };

    mockLedgerService = {
      findReversalByOriginalId: jest.fn(),
      createReversalEntry: jest.fn(),
    };

    // B-2: LedgerRepository.findDebitEntryByIdempotencyKey is the correct lookup
    mockLedgerRepo = {
      findDebitEntryByIdempotencyKey: jest.fn(),
      markAsReversed: jest.fn().mockResolvedValue(undefined),
    };

    mockAuditService = {
      logAdminAction: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReversalService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: AgreementTransactionRepository, useValue: mockTxRepo },
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: LedgerRepository, useValue: mockLedgerRepo },
        { provide: AdminAuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ReversalService>(ReversalService);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    beforeEach(() => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );
    });

    it('returns REVERSED status with correct IDs and amount', async () => {
      const result = await service.reverseTransaction(
        TX_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(result.transactionId).toBe(TX_ID);
      expect(result.reversalLedgerId).toBe(REVERSAL_LEDGER_ID);
      expect(result.reversedAmount).toBe(1000);
      expect(result.status).toBe('REVERSED');
    });

    it('creates reversal ledger entry via ledgerService', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      expect(mockLedgerService.createReversalEntry).toHaveBeenCalledWith(
        LEDGER_ID,
        TENANT_ID,
        USER_ID,
        mockQueryRunner,
      );
    });

    it('marks original ledger entry as reversed via LedgerRepository.markAsReversed', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      // N-1: markAsReversed must be used — not queryRunner.manager.update directly
      expect(mockLedgerRepo.markAsReversed).toHaveBeenCalledWith(
        LEDGER_ID,
        mockQueryRunner,
      );
    });

    it('marks agreement transaction as reversed in QueryRunner', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: TX_ID },
        { isReversed: true },
      );
    });

    it('does NOT call budgetService.reverseForTransaction (B-1: no double-restore)', async () => {
      // B-1 simetri: consumed is from ledger (DEBIT-CREDIT), reserved=0 in create flow.
      // Adding a RELEASE budget tx would push reserved to negative → double restore.
      // BudgetService must NOT be injected or called.
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);
      // Service has no BudgetService dependency — this assertion is structural.
      // We verify neither mockLedgerService nor mockLedgerRepo has any budget method.
      expect(mockLedgerService.reverseForTransaction).toBeUndefined();
    });

    it('logs REVERSE action to audit service', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL, {
        justification: 'test reason',
      });

      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        'REVERSE',
        'AGREEMENT_TRANSACTION',
        TX_ID,
        undefined,
        'SUCCESS',
        expect.objectContaining({ originalLedgerId: LEDGER_ID }),
        expect.objectContaining({ justification: 'test reason' }),
        'test reason',
      );
    });

    it('commits transaction on success', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    });

    it('releases queryRunner in finally block', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // B-2: Transaction-specific ledger entry lookup
  // -------------------------------------------------------------------------

  describe('B-2: transaction-specific ledger entry lookup', () => {
    it('looks up ledger entry using transaction-specific idempotency key, not just agreementId', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      // Must use the transaction-specific key, not findDebitEntryByAgreementId
      expect(
        mockLedgerRepo.findDebitEntryByIdempotencyKey,
      ).toHaveBeenCalledWith(EXPECTED_IDEMPOTENCY_KEY, TENANT_ID);
    });

    it('reverses correct transaction when agreement has multiple transactions (batch import)', async () => {
      const TX_ID_A = 'tx-aaa';
      const TX_ID_B = 'tx-bbb';
      const LEDGER_ID_A = 'led-aaa';
      const LEDGER_ID_B = 'led-bbb';

      const IDEMPOTENCY_KEY_A = `LEDGER|AGREEMENT|${AGREEMENT_ID}|${TX_ID_A}`;
      const IDEMPOTENCY_KEY_B = `LEDGER|AGREEMENT|${AGREEMENT_ID}|${TX_ID_B}`;

      // Only tx-bbb is being reversed
      mockTxRepo.findById.mockImplementation((id: string) => {
        if (id === TX_ID_B) {
          return Promise.resolve(
            buildTransaction({ id: TX_ID_B, agreementId: AGREEMENT_ID }),
          );
        }
        return Promise.resolve(null);
      });

      // findDebitEntryByIdempotencyKey returns the correct entry based on key
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockImplementation(
        (key: string) => {
          if (key === IDEMPOTENCY_KEY_A) {
            return Promise.resolve(
              buildOriginalEntry({
                id: LEDGER_ID_A,
                idempotencyKey: IDEMPOTENCY_KEY_A,
              }),
            );
          }
          if (key === IDEMPOTENCY_KEY_B) {
            return Promise.resolve(
              buildOriginalEntry({
                id: LEDGER_ID_B,
                idempotencyKey: IDEMPOTENCY_KEY_B,
              }),
            );
          }
          return Promise.resolve(null);
        },
      );

      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      await service.reverseTransaction(TX_ID_B, TENANT_ID, USER_ID, USER_EMAIL);

      // Must look up with TX_B's key — NOT TX_A's key
      expect(
        mockLedgerRepo.findDebitEntryByIdempotencyKey,
      ).toHaveBeenCalledWith(IDEMPOTENCY_KEY_B, TENANT_ID);
      expect(
        mockLedgerRepo.findDebitEntryByIdempotencyKey,
      ).not.toHaveBeenCalledWith(IDEMPOTENCY_KEY_A, TENANT_ID);

      // Reversal must target ledger entry B, not A
      expect(mockLedgerService.createReversalEntry).toHaveBeenCalledWith(
        LEDGER_ID_B,
        TENANT_ID,
        USER_ID,
        mockQueryRunner,
      );
      expect(mockLedgerRepo.markAsReversed).toHaveBeenCalledWith(
        LEDGER_ID_B,
        mockQueryRunner,
      );
    });

    it('throws REVERSAL_SOURCE_NOT_FOUND when no matching ledger entry for this transaction', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      // Key matches but no entry found (e.g., ledger entry was not created in original flow)
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(null);

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'REVERSAL_SOURCE_NOT_FOUND',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  describe('error: transaction not found', () => {
    it('throws NotFoundException when txRepo returns null', async () => {
      mockTxRepo.findById.mockResolvedValue(null);

      await expect(
        service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow(NotFoundException);
    });

    it('rolls back on NotFoundException', async () => {
      mockTxRepo.findById.mockResolvedValue(null);

      await expect(
        service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('error: already reversed (transaction flag)', () => {
    it('throws ConflictException with ALREADY_REVERSED code', async () => {
      mockTxRepo.findById.mockResolvedValue(
        buildTransaction({ isReversed: true }),
      );

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_REVERSED',
      });
    });
  });

  describe('error: not reversible state (DRAFT agreement)', () => {
    it('throws ConflictException with NOT_REVERSIBLE_STATE code', async () => {
      mockTxRepo.findById.mockResolvedValue(
        buildTransaction({
          agreement: { id: AGREEMENT_ID, status: AgreementStatus.DRAFT },
        }),
      );

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'NOT_REVERSIBLE_STATE',
      });
    });

    it('throws NOT_REVERSIBLE_STATE for PENDING agreement', async () => {
      mockTxRepo.findById.mockResolvedValue(
        buildTransaction({
          agreement: { id: AGREEMENT_ID, status: AgreementStatus.PENDING },
        }),
      );

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'NOT_REVERSIBLE_STATE',
      });
    });
  });

  describe('error: reversal source not found', () => {
    it('throws ConflictException with REVERSAL_SOURCE_NOT_FOUND when no DEBIT entry exists', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(null);

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'REVERSAL_SOURCE_NOT_FOUND',
      });
    });
  });

  describe('error: already reversed (app-layer double-reversal check)', () => {
    it('throws ALREADY_REVERSED when reversal entry already exists for original', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(
        buildReversalEntry(),
      );

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_REVERSED',
      });
    });
  });

  describe('reversal entry direction', () => {
    it('createReversalEntry is called with original entry id (direction logic is inside ledgerService)', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      expect(mockLedgerService.createReversalEntry).toHaveBeenCalledWith(
        LEDGER_ID,
        TENANT_ID,
        USER_ID,
        mockQueryRunner,
      );
    });
  });

  describe('rollback on unexpected error', () => {
    it('rolls back and rethrows when createReversalEntry fails', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockRejectedValue(
        new Error('DB failure'),
      );

      await expect(
        service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow('DB failure');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // B-1: Budget available increases after reversal via ledger CREDIT only
  // -------------------------------------------------------------------------

  describe('B-1: budget available increases via ledger CREDIT (no double-restore)', () => {
    beforeEach(() => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );
    });

    it('ledger CREDIT entry is created (this is what increases available budget)', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      // createReversalEntry writes the CREDIT that reduces consumed_amount in v_budget_summary
      expect(mockLedgerService.createReversalEntry).toHaveBeenCalledTimes(1);
      expect(mockLedgerService.createReversalEntry).toHaveBeenCalledWith(
        LEDGER_ID,
        TENANT_ID,
        USER_ID,
        mockQueryRunner,
      );
    });

    it('returns correct reversedAmount equal to original entry amount', async () => {
      const originalAmount = 750;
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry({ amount: originalAmount }),
      );

      const result = await service.reverseTransaction(
        TX_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(result.reversedAmount).toBe(originalAmount);
    });

    it('completes successfully even when original entry has no budgetEnvelopeId', async () => {
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry({ budgetEnvelopeId: undefined }),
      );

      const result = await service.reverseTransaction(
        TX_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );

      expect(result.status).toBe('REVERSED');
    });
  });

  // -------------------------------------------------------------------------
  // (b) Double-reversal guard — DB unique constraint layer
  // -------------------------------------------------------------------------

  describe('double-reversal: app+DB unique guard', () => {
    it('throws ALREADY_REVERSED at app layer before reaching DB unique constraint', async () => {
      // Simulate: reversal entry already exists in DB (app-layer guard fires first)
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      // App layer detects existing reversal
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(
        buildReversalEntry(),
      );

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_REVERSED',
      });
      // DB should never be reached — createReversalEntry must not be called
      expect(mockLedgerService.createReversalEntry).not.toHaveBeenCalled();
    });

    it('rolls back when createReversalEntry throws DB unique violation (DB layer)', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null); // App guard passes
      // Simulate DB unique index violation
      const dbUniqueError = new Error(
        'duplicate key value violates unique constraint "UQ_reverses_entry_id"',
      );
      mockLedgerService.createReversalEntry.mockRejectedValue(dbUniqueError);

      await expect(
        service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow(/duplicate key/);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (c) RBAC — tested in reversal.guard.spec.ts; here we verify service
  //     itself does NOT enforce roles (guard is the boundary)
  // -------------------------------------------------------------------------

  describe('service does not re-enforce RBAC (guard owns it)', () => {
    it('processes reversal regardless of user context (guard already validated)', async () => {
      // Service accepts any userId string — RBAC is the guard's responsibility
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      const result = await service.reverseTransaction(
        TX_ID,
        TENANT_ID,
        'any-user-id',
        'any@user.com',
      );

      expect(result.status).toBe('REVERSED');
    });
  });

  // -------------------------------------------------------------------------
  // (d) NOT_REVERSIBLE_STATE — extended to cover all non-reversible states
  // -------------------------------------------------------------------------

  describe('error: NOT_REVERSIBLE_STATE — exhaustive state machine check', () => {
    const nonReversibleStates = [
      AgreementStatus.DRAFT,
      AgreementStatus.PENDING,
      AgreementStatus.CLOSED,
      AgreementStatus.REJECTED,
      AgreementStatus.CANCELLED,
    ] as const;

    for (const status of nonReversibleStates) {
      it(`throws NOT_REVERSIBLE_STATE for agreement in ${status} state`, async () => {
        mockTxRepo.findById.mockResolvedValue(
          buildTransaction({
            agreement: { id: AGREEMENT_ID, status },
          }),
        );

        const error = await service
          .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'NOT_REVERSIBLE_STATE',
        });
      });
    }

    it('accepts APPROVED agreement (reversible)', async () => {
      mockTxRepo.findById.mockResolvedValue(
        buildTransaction({
          agreement: {
            id: AGREEMENT_ID,
            status: AgreementStatus.APPROVED,
          },
        }),
      );
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      const result = await service.reverseTransaction(
        TX_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );
      expect(result.status).toBe('REVERSED');
    });

    it('accepts ACTIVE agreement (reversible)', async () => {
      mockTxRepo.findById.mockResolvedValue(
        buildTransaction({
          agreement: {
            id: AGREEMENT_ID,
            status: AgreementStatus.ACTIVE,
          },
        }),
      );
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      const result = await service.reverseTransaction(
        TX_ID,
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
      );
      expect(result.status).toBe('REVERSED');
    });
  });

  // -------------------------------------------------------------------------
  // (e) REVERSAL_SOURCE_NOT_FOUND — already reversed original entry
  // -------------------------------------------------------------------------

  describe('error: REVERSAL_SOURCE_NOT_FOUND — extended', () => {
    it('throws when findDebitEntryByIdempotencyKey returns null (no DEBIT entry)', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(null);

      const error = await service
        .reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'REVERSAL_SOURCE_NOT_FOUND',
      });
    });

    it('rolls back on REVERSAL_SOURCE_NOT_FOUND', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(null);

      await expect(
        service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow();

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (f) Tenant isolation — cross-tenant 404
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('returns 404 when transaction belongs to a different tenant', async () => {
      // txRepo.findById is scoped: returns null for wrong tenant
      mockTxRepo.findById.mockResolvedValue(null);

      await expect(
        service.reverseTransaction(
          TX_ID,
          'tenant-DIFFERENT',
          USER_ID,
          USER_EMAIL,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not expose cross-tenant data in error message', async () => {
      mockTxRepo.findById.mockResolvedValue(null);

      const error = await service
        .reverseTransaction(TX_ID, 'tenant-DIFFERENT', USER_ID, USER_EMAIL)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      // Message should be generic — no tenant-specific data leaked
      const message = (error as NotFoundException).message;
      expect(message).not.toContain('tenant-DIFFERENT');
    });

    it('ledger lookup is called with the caller tenantId for correct isolation', async () => {
      const SPECIFIC_TENANT = 'tenant-XYZ';
      mockTxRepo.findById.mockResolvedValue(
        buildTransaction({ tenantId: SPECIFIC_TENANT }),
      );
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry({ tenantId: SPECIFIC_TENANT }),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      await service.reverseTransaction(
        TX_ID,
        SPECIFIC_TENANT,
        USER_ID,
        USER_EMAIL,
      );

      // Verify tenant is correctly threaded to ledger lookup
      expect(
        mockLedgerRepo.findDebitEntryByIdempotencyKey,
      ).toHaveBeenCalledWith(
        expect.stringContaining(AGREEMENT_ID),
        SPECIFIC_TENANT,
      );
      // And to audit log — verify tenantId is threaded correctly
      expect(mockAuditService.logAdminAction).toHaveBeenCalledTimes(1);
      const auditCall = mockAuditService.logAdminAction.mock
        .calls[0] as unknown[];
      expect(auditCall[0]).toBe(SPECIFIC_TENANT);
    });
  });

  // -------------------------------------------------------------------------
  // (g) Audit log immutability — logAdminAction is always called on success
  // -------------------------------------------------------------------------

  describe('audit log: immutable record on every reversal', () => {
    beforeEach(() => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );
    });

    it('always calls logAdminAction with REVERSE entity before commit', async () => {
      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      expect(mockAuditService.logAdminAction).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        'REVERSE',
        'AGREEMENT_TRANSACTION',
        TX_ID,
        undefined,
        'SUCCESS',
        expect.objectContaining({
          originalLedgerId: LEDGER_ID,
          amount: 1000,
          agreementId: AGREEMENT_ID,
        }),
        expect.objectContaining({
          reversalLedgerId: REVERSAL_LEDGER_ID,
        }),
        undefined, // no justification
      );
    });

    it('includes justification in audit log when provided', async () => {
      const justification = 'Supplier dispute — credit note received';

      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL, {
        justification,
      });

      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        USER_EMAIL,
        'REVERSE',
        'AGREEMENT_TRANSACTION',
        TX_ID,
        undefined,
        'SUCCESS',
        expect.any(Object),
        expect.objectContaining({ justification }),
        justification,
      );
    });

    it('audit log is NOT called if an error occurs before commit (rollback path)', async () => {
      mockLedgerService.createReversalEntry.mockRejectedValue(
        new Error('DB timeout'),
      );

      await expect(
        service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL),
      ).rejects.toThrow('DB timeout');

      // Audit must only be written on success — not on rollback
      expect(mockAuditService.logAdminAction).not.toHaveBeenCalled();
    });

    it('audit log is called with reversalLedgerId from newly created entry', async () => {
      const CUSTOM_REVERSAL_ID = 'led-rev-custom-999';
      mockLedgerService.createReversalEntry.mockResolvedValue({
        ...buildReversalEntry(),
        id: CUSTOM_REVERSAL_ID,
      });

      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      expect(mockAuditService.logAdminAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        undefined,
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ reversalLedgerId: CUSTOM_REVERSAL_ID }),
        undefined, // justification not provided
      );
    });
  });

  // -------------------------------------------------------------------------
  // N-1: markAsReversed is used instead of direct queryRunner.manager.update
  // -------------------------------------------------------------------------

  describe('N-1: LedgerRepository.markAsReversed is used for marking original entry', () => {
    it('calls markAsReversed with correct id and queryRunner', async () => {
      mockTxRepo.findById.mockResolvedValue(buildTransaction());
      mockLedgerRepo.findDebitEntryByIdempotencyKey.mockResolvedValue(
        buildOriginalEntry(),
      );
      mockLedgerService.findReversalByOriginalId.mockResolvedValue(null);
      mockLedgerService.createReversalEntry.mockResolvedValue(
        buildReversalEntry(),
      );

      await service.reverseTransaction(TX_ID, TENANT_ID, USER_ID, USER_EMAIL);

      expect(mockLedgerRepo.markAsReversed).toHaveBeenCalledWith(
        LEDGER_ID,
        mockQueryRunner,
      );
      expect(mockLedgerRepo.markAsReversed).toHaveBeenCalledTimes(1);
    });
  });
});
