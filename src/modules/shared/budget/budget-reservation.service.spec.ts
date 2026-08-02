import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import { BudgetReservationService } from './budget-reservation.service';
import { BudgetRepository } from './budget.repository';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
} from '../../../database/entities/budget-transaction.entity';
import { BudgetSpendType } from '../../../database/entities/budget-envelope.entity';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const AGREEMENT_ID = 'agr-001';
const PLAN_ID = 'plan-001';
const ENVELOPE_ID = 'env-001';
const ENVELOPE_ID_2 = 'env-002';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTx(overrides: Record<string, any>): BudgetTransaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT_ID,
    envelopeId: ENVELOPE_ID,
    txStatus: BudgetTransactionStatus.POSTED,
    currency: 'TRY',
    amount: 0,
    idempotencyKey: `k-${Math.random()}`,
    ...overrides,
  } as BudgetTransaction;
}

describe('BudgetReservationService', () => {
  let service: BudgetReservationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBudgetRepository: any;

  beforeEach(async () => {
    mockBudgetRepository = {
      findTransactionsBySource: jest.fn(),
      findTransactionByIdempotencyKey: jest.fn().mockResolvedValue(null),
      createTransaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetReservationService,
        { provide: BudgetRepository, useValue: mockBudgetRepository },
      ],
    }).compile();

    service = module.get<BudgetReservationService>(BudgetReservationService);
  });

  // -------------------------------------------------------------------------
  // Net calculation — TAM release, "reserve - consumed" DEĞİL (0003 §3)
  // -------------------------------------------------------------------------

  describe('net reservation calculation', () => {
    it('releases the FULL net RESERVE (not reserve-minus-consumed) — Ö2 numeric proof', async () => {
      // Zarf: allocated=600.000; agreement cap=20.000; DEBIT(consumed)=12.000
      // (consumed lives in ledger_entries, invisible to this service — it
      // only ever sees budget_transactions, so there is no way for it to
      // subtract consumed even by accident).
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 20000,
          idempotencyKey: 'RESERVE|AGREEMENT|agr-001|env-001',
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
      );

      expect(result).toHaveLength(1);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          txType: BudgetTransactionType.RELEASE,
          amount: 20000, // full net, not 20000-12000=8000
          envelopeId: ENVELOPE_ID,
          idempotencyKey: `RELEASE|AGREEMENT|${AGREEMENT_ID}|${ENVELOPE_ID}`,
        }),
        undefined,
      );
    });

    it('nets RESERVE and COMMIT together minus RELEASE (forward-compatible formula)', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 10000 }),
        buildTx({ txType: BudgetTransactionType.COMMIT, amount: 5000 }),
        buildTx({ txType: BudgetTransactionType.RELEASE, amount: 2000 }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
      );

      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 13000 }), // 10000+5000-2000
        undefined,
      );
    });

    it('handles multiple envelopes independently — one RELEASE per envelope', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          envelopeId: ENVELOPE_ID,
          txType: BudgetTransactionType.RESERVE,
          amount: 10000,
        }),
        buildTx({
          envelopeId: ENVELOPE_ID_2,
          txType: BudgetTransactionType.RESERVE,
          amount: 7000,
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: `release-${tx.envelopeId}` }),
      );

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
      );

      expect(result).toHaveLength(2);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ envelopeId: ENVELOPE_ID, amount: 10000 }),
        undefined,
      );
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ envelopeId: ENVELOPE_ID_2, amount: 7000 }),
        undefined,
      );
    });

    it('net=0 (already fully released) → no RELEASE written (no-op)', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 20000 }),
        buildTx({ txType: BudgetTransactionType.RELEASE, amount: 20000 }),
      ]);

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
      );

      expect(result).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('no transactions at all (e.g. REJECT before approve) → no-op, no throw', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]);

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'REJECT',
      );

      expect(result).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('ignores non-POSTED (e.g. CANCELLED) transactions', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 99999,
          txStatus: BudgetTransactionStatus.CANCELLED,
        }),
      ]);

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
      );

      expect(result).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — key identical across CLOSE/CANCEL/REJECT (0003 §4)
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    it('uses key RELEASE|AGREEMENT|<agreementId>|<envelopeId> regardless of reason', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 5000 }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CANCEL',
      );

      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `RELEASE|AGREEMENT|${AGREEMENT_ID}|${ENVELOPE_ID}`,
        }),
        undefined,
      );
    });

    it('a repeat call after an existing RELEASE for the envelope is a no-op (not a second RELEASE)', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 5000 }),
        buildTx({ txType: BudgetTransactionType.RELEASE, amount: 5000 }),
      ]);

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CANCEL',
      );

      expect(result).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('layer-2 defensive check: existing idempotency-key row found right before write → no-op, no throw', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 5000 }),
      ]);
      // Net computed from the read above is > 0, but a concurrent writer
      // already posted the RELEASE by the time we check right before write.
      mockBudgetRepository.findTransactionByIdempotencyKey.mockResolvedValue({
        id: 'concurrent-release',
      });

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
      );

      expect(result).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('unique-constraint violation on write (23505) is swallowed as a no-op, not thrown', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 5000 }),
      ]);
      mockBudgetRepository.createTransaction.mockRejectedValue({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      });

      const result = await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
      );

      expect(result).toEqual([]); // no ConflictException thrown
    });

    it('non-unique-constraint errors are rethrown (not swallowed)', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 5000 }),
      ]);
      mockBudgetRepository.createTransaction.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.releaseAgreementReservation(
          AGREEMENT_ID,
          TENANT_ID,
          USER_ID,
          'CLOSE',
        ),
      ).rejects.toThrow('connection lost');
    });
  });

  // -------------------------------------------------------------------------
  // Transaction-manager pass-through (Adım 1/2 — atomicity with caller's tx)
  // -------------------------------------------------------------------------

  describe('manager pass-through', () => {
    it('forwards the provided EntityManager to every repository call', async () => {
      const fakeManager = {} as EntityManager;
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 5000 }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CLOSE',
        fakeManager,
      );

      expect(
        mockBudgetRepository.findTransactionsBySource,
      ).toHaveBeenCalledWith(TENANT_ID, 'AGREEMENT', AGREEMENT_ID, fakeManager);
      expect(
        mockBudgetRepository.findTransactionByIdempotencyKey,
      ).toHaveBeenCalledWith(TENANT_ID, expect.any(String), fakeManager);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        fakeManager,
      );
    });

    it('works without a manager (falls back to injected repository — pre-existing callers)', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 5000 }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      await service.releaseAgreementReservation(
        AGREEMENT_ID,
        TENANT_ID,
        USER_ID,
        'CANCEL',
      );

      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Tenant isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('always scopes findTransactionsBySource by the given tenantId', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]);

      await service.releaseAgreementReservation(
        AGREEMENT_ID,
        'tenant-OTHER',
        USER_ID,
        'CLOSE',
      );

      expect(
        mockBudgetRepository.findTransactionsBySource,
      ).toHaveBeenCalledWith(
        'tenant-OTHER',
        'AGREEMENT',
        AGREEMENT_ID,
        undefined,
      );
    });

    it('writes the RELEASE transaction with the caller tenantId, not a hardcoded one', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          tenantId: 'tenant-OTHER',
          txType: BudgetTransactionType.RESERVE,
          amount: 5000,
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      await service.releaseAgreementReservation(
        AGREEMENT_ID,
        'tenant-OTHER',
        USER_ID,
        'CLOSE',
      );

      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-OTHER' }),
        undefined,
      );
    });
  });

  // -------------------------------------------------------------------------
  // releasePlanReservation — T-029 fix (code-review, 2026-07-27): 5th
  // double-count instance. Old `BudgetService#releaseForPlan` scanned raw
  // POSTED RESERVE/COMMIT rows and released each one found, under a
  // per-type idempotency key (`...|RESERVE`, `...|COMMIT`) that did not
  // collide with the CONVERT release written by `commitReservedForPlan` on
  // approve. Since RESERVE rows are never mutated (event-sourced), the
  // already-converted RESERVE was found again and released a second time —
  // net went negative. These tests reproduce the exact approve→compensation
  // trigger and assert the net-based fix: single RELEASE, net lands at 0,
  // never negative.
  // -------------------------------------------------------------------------

  describe('releasePlanReservation (T-029 fix — double-release regression)', () => {
    it('submit(RESERVE) -> approve(CONVERT release + COMMIT) -> release: nets to exactly 0 via ONE release, not two', async () => {
      // Reproduces PlanService#approve's compensation path: commitReservedForPlan
      // already wrote RELEASE|PLAN|<id>|<env>|CONVERT (100) + COMMIT (100) on
      // top of the original RESERVE (100). All three rows are POSTED and visible
      // to findTransactionsBySource — the bug was double-releasing on top of this.
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 100,
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
        buildTx({
          txType: BudgetTransactionType.RELEASE,
          amount: 100,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|CONVERT`,
        }),
        buildTx({
          txType: BudgetTransactionType.COMMIT,
          amount: 100,
          idempotencyKey: `COMMIT|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      const result = await service.releasePlanReservation(
        PLAN_ID,
        TENANT_ID,
        USER_ID,
        'APPROVE_COMPENSATION',
      );

      // Net = RESERVE(100) + COMMIT(100) - RELEASE_CONVERT(100) = 100.
      // Exactly ONE release transaction, not two (the old bug released the
      // still-POSTED RESERVE under a distinct `...|RESERVE` key AND the
      // COMMIT, landing net at -100).
      expect(result).toHaveLength(1);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledTimes(1);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          txType: BudgetTransactionType.RELEASE,
          amount: 100,
          envelopeId: ENVELOPE_ID,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
        undefined,
      );

      // Net after this release: 100 (RESERVE) + 100 (COMMIT) - 100 (CONVERT
      // release) - 100 (this release) = 0. Never negative.
      const netAfter = 100 + 100 - 100 - Number(result[0].amount);
      expect(netAfter).toBe(0);
    });

    it('submit(RESERVE) -> reject (no approve) -> release: nets to 0, unchanged from pre-existing behaviour', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 100,
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-1' }),
      );

      const result = await service.releasePlanReservation(
        PLAN_ID,
        TENANT_ID,
        USER_ID,
        'REJECT',
      );

      expect(result).toHaveLength(1);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 100,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
        undefined,
      );

      const netAfter = 100 - Number(result[0].amount);
      expect(netAfter).toBe(0);
    });

    it('a second releasePlanReservation call after the net-0 release above is a pure no-op (idempotent, no double-release)', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({ txType: BudgetTransactionType.RESERVE, amount: 100 }),
        buildTx({ txType: BudgetTransactionType.COMMIT, amount: 100 }),
        buildTx({
          txType: BudgetTransactionType.RELEASE,
          amount: 100,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|CONVERT`,
        }),
        buildTx({
          txType: BudgetTransactionType.RELEASE,
          amount: 100,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
      ]);

      const result = await service.releasePlanReservation(
        PLAN_ID,
        TENANT_ID,
        USER_ID,
        'APPROVE_COMPENSATION',
      );

      // net = 100 + 100 - 100 - 100 = 0 -> no-op, no third RELEASE.
      expect(result).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // T-053 fix — bucket-aware grouping (envelopeId, spendType), NOT envelopeId
  // alone. docs/analysis/0008 §5.4/§7 T4. Reproduces the plan-side
  // reject->resubmit live bug (task T-053): a plan's RESERVE rows can carry
  // DIFFERENT spendTypes on the SAME (Faz 1 UNSPLIT) envelope.
  // -------------------------------------------------------------------------

  describe('T-053 fix — kova-farkındalı (envelopeId, spendType) gruplama', () => {
    it('two spend-type buckets on the SAME envelope -> TWO typed RELEASE rows, each carrying its own spendType and net', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 10000,
          spendType: BudgetSpendType.ON_INVOICE,
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|ON_INVOICE`,
        }),
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 4500,
          spendType: BudgetSpendType.OFF_INVOICE,
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|OFF_INVOICE`,
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: `release-${tx.spendType}` }),
      );

      const result = await service.releasePlanReservation(
        PLAN_ID,
        TENANT_ID,
        USER_ID,
        'REJECT',
      );

      // Pre-fix: this would have been ONE untyped RELEASE of 14500 — the
      // exact bug that made resubmit's bucket-scoped netOutstanding blind
      // to the release (see task T-053 / A17 e2e proof).
      expect(result).toHaveLength(2);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          envelopeId: ENVELOPE_ID,
          spendType: BudgetSpendType.ON_INVOICE,
          amount: 10000,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|ON_INVOICE`,
        }),
        undefined,
      );
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          envelopeId: ENVELOPE_ID,
          spendType: BudgetSpendType.OFF_INVOICE,
          amount: 4500,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|OFF_INVOICE`,
        }),
        undefined,
      );
    });

    it('UNTYPED bucket (spend_type IS NULL) keeps the EXACT pre-T-053 idempotency key format — no suffix', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 5000,
          spendType: null,
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-untyped' }),
      );

      await service.releasePlanReservation(
        PLAN_ID,
        TENANT_ID,
        USER_ID,
        'REJECT',
      );

      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          spendType: null,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`, // NO suffix
        }),
        undefined,
      );
    });

    it('R2 regression guard: replaying a pre-T-019 (untyped) already-released source is a no-op — the UNTYPED key must still match the OLD row', async () => {
      // Simulates a source+envelope pair that was released BEFORE T-053
      // (untyped key, no suffix) — a second call (e.g. a duplicate
      // compensation retry) must find it via the SAME key and no-op, not
      // write a second (now-typed-format) RELEASE on top -> double refund.
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 5000,
          spendType: null,
        }),
        buildTx({
          txType: BudgetTransactionType.RELEASE,
          amount: 5000,
          spendType: null,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
      ]);

      const result = await service.releasePlanReservation(
        PLAN_ID,
        TENANT_ID,
        USER_ID,
        'REJECT',
      );

      expect(result).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('one bucket already net-zero (typed RELEASE exists), the other still outstanding -> releases ONLY the outstanding bucket', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 10000,
          spendType: BudgetSpendType.ON_INVOICE,
        }),
        buildTx({
          txType: BudgetTransactionType.RELEASE,
          amount: 10000,
          spendType: BudgetSpendType.ON_INVOICE,
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|ON_INVOICE`,
        }),
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 4500,
          spendType: BudgetSpendType.OFF_INVOICE,
        }),
      ]);
      mockBudgetRepository.createTransaction.mockImplementation((tx: any) =>
        Promise.resolve({ ...tx, id: 'release-off' }),
      );

      const result = await service.releasePlanReservation(
        PLAN_ID,
        TENANT_ID,
        USER_ID,
        'REJECT',
      );

      expect(result).toHaveLength(1);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledTimes(1);
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          spendType: BudgetSpendType.OFF_INVOICE,
          amount: 4500,
        }),
        undefined,
      );
    });
  });
});
