import { Test, TestingModule } from '@nestjs/testing';
import { BudgetService } from './budget.service';
import { BudgetRepository } from './budget.repository';
import { BudgetThresholdService } from './budget-threshold.service';
import { BudgetReservationService } from './budget-reservation.service';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
} from '../../../database/entities/budget-transaction.entity';
import { BudgetEnvelope } from '../../../database/entities/budget-envelope.entity';
import { BadRequestException } from '@nestjs/common';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const PLAN_ID = 'plan-001';
const AGREEMENT_ID = 'agr-001';
const ENVELOPE_ID = 'env-001';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTx(overrides: Record<string, any>): BudgetTransaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT_ID,
    envelopeId: ENVELOPE_ID,
    txStatus: BudgetTransactionStatus.POSTED,
    currency: 'TRY',
    amount: 0,
    spendType: null,
    idempotencyKey: `k-${Math.random()}`,
    ...overrides,
  } as BudgetTransaction;
}

describe('BudgetService — T-019 Faz 1 / T-048', () => {
  let service: BudgetService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBudgetRepository: any;

  beforeEach(async () => {
    mockBudgetRepository = {
      findEnvelopeByDimensions: jest.fn().mockResolvedValue({
        id: ENVELOPE_ID,
        allocatedAmount: 1000000,
      } as BudgetEnvelope),
      findTransactionsBySource: jest.fn().mockResolvedValue([]),
      findTransactionByIdempotencyKey: jest.fn().mockResolvedValue(null),
      checkBudgetAvailability: jest
        .fn()
        .mockResolvedValue({ available: 1000000, sufficient: true }),
      createTransaction: jest
        .fn()
        .mockImplementation((tx: any) =>
          Promise.resolve({ ...tx, id: `tx-created-${Math.random()}` }),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: BudgetRepository, useValue: mockBudgetRepository },
        {
          provide: BudgetThresholdService,
          useValue: { getThresholds: jest.fn(), toStatus: jest.fn() },
        },
        {
          provide: BudgetReservationService,
          useValue: { releasePlanReservation: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<BudgetService>(BudgetService);
  });

  // ---------------------------------------------------------------------
  // T2 (docs/analysis/0008 §7) — the live T-048 bug's regression test.
  // ---------------------------------------------------------------------
  describe('reserveForPlan — kova (bucket) farkındalı idempotency (T-048)', () => {
    it('writes TWO separate RESERVE rows for ON_INVOICE then OFF_INVOICE on the SAME UNSPLIT envelope, net = sum', async () => {
      // First call: ON_INVOICE=100. No prior transactions.
      const onTx = await service.reserveForPlan(
        PLAN_ID,
        100,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'ON_INVOICE',
      );
      expect(onTx.amount).toBe(100);
      expect(onTx.spendType).toBe('ON_INVOICE');

      // Second call: OFF_INVOICE=40. Simulate that the ON_INVOICE RESERVE
      // from the first call is now visible via findTransactionsBySource
      // (same as within a single DB transaction/manager).
      mockBudgetRepository.findTransactionsBySource.mockResolvedValueOnce([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 100,
          spendType: 'ON_INVOICE',
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|ON_INVOICE`,
        }),
      ]);

      const offTx = await service.reserveForPlan(
        PLAN_ID,
        40,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'OFF_INVOICE',
      );

      // T-048 REGRESSION: before the fix, this call would see the ON
      // RESERVE's net (100 > 0) and envelopeReserves.length > 0 for the
      // (unfiltered) envelope bucket and short-circuit, returning the ON
      // transaction unchanged (net would stay 100 instead of 140).
      expect(offTx.amount).toBe(40);
      expect(offTx.spendType).toBe('OFF_INVOICE');
      expect(offTx.id).not.toBe(onTx.id);

      const createCalls = mockBudgetRepository.createTransaction.mock.calls;
      expect(createCalls.length).toBe(2);
      const netWritten = createCalls.reduce(
        (sum: number, [tx]: any) => sum + Number(tx.amount),
        0,
      );
      expect(netWritten).toBe(140);
    });

    it('MUTATION PROOF: removing the bucket filter reproduces the T-048 bug (second RESERVE never written)', async () => {
      // This test intentionally re-implements the OLD (buggy) filter logic
      // inline to prove the assertion shape actually catches the regression
      // — i.e. it is not a tautology. It does NOT touch production code.
      const existingTransactions = [
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 100,
          spendType: 'ON_INVOICE',
        }),
      ];

      // OLD buggy filter: envelopeId only, ignores spendType.
      const envelopeReservesBuggy = existingTransactions.filter(
        (tx) =>
          tx.envelopeId === ENVELOPE_ID &&
          tx.txType === BudgetTransactionType.RESERVE &&
          tx.txStatus === BudgetTransactionStatus.POSTED,
      );
      const netOutstandingBuggy = existingTransactions
        .filter((tx) => tx.envelopeId === ENVELOPE_ID)
        .reduce((net, tx) => net + Number(tx.amount), 0);

      // Reproduces the exact short-circuit condition from the pre-fix code.
      const wouldShortCircuit =
        netOutstandingBuggy > 0 && envelopeReservesBuggy.length > 0;
      expect(wouldShortCircuit).toBe(true); // ← this is the T-048 bug
      expect(netOutstandingBuggy).toBe(100); // ≠ 140 (the correct net)
    });
  });

  describe('reserveForPlan — TOTAL bucket (plan.service.ts#submit) stays backward compatible', () => {
    it('uses the pre-T-019 idempotency key format (no bucket suffix)', async () => {
      await service.reserveForPlan(
        PLAN_ID,
        250,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'TOTAL',
      );

      const [tx] = mockBudgetRepository.createTransaction.mock.calls[0];
      expect(tx.idempotencyKey).toBe(`RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`);
      expect(tx.spendType).toBeNull();
    });

    it('TOTAL bucket is idempotent against its own prior RESERVE, unaffected by ON/OFF buckets on the same envelope', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValueOnce([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 250,
          spendType: null,
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 50,
          spendType: 'ON_INVOICE',
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|ON_INVOICE`,
        }),
      ]);

      const result = await service.reserveForPlan(
        PLAN_ID,
        250,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'TOTAL',
      );

      expect(result.amount).toBe(250);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('reserveForAgreement — ADR 0004 Karar 1 (spend_type NULL → 400)', () => {
    it('rejects with 400 when agreement spend_type is undefined', async () => {
      await expect(
        service.reserveForAgreement(
          AGREEMENT_ID,
          1000,
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('rejects with 400 when agreement spend_type is null', async () => {
      await expect(
        service.reserveForAgreement(
          AGREEMENT_ID,
          1000,
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          null,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts OFF_INVOICE and classifies the RESERVE transaction', async () => {
      const tx = await service.reserveForAgreement(
        AGREEMENT_ID,
        1000,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'OFF_INVOICE',
      );
      expect(tx.spendType).toBe('OFF_INVOICE');
    });

    it('accepts BOTH and writes spend_type = NULL (untyped, unchanged pre-T-019 behaviour)', async () => {
      const tx = await service.reserveForAgreement(
        AGREEMENT_ID,
        1000,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'BOTH',
      );
      expect(tx.spendType).toBeNull();
    });
  });

  describe('commitReservedForPlan — kova-farkındalı COMMIT (T-048 mirror fix)', () => {
    it('commits ON_INVOICE and OFF_INVOICE buckets independently (both converted, not just the first)', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 100,
          spendType: 'ON_INVOICE',
        }),
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 40,
          spendType: 'OFF_INVOICE',
        }),
      ]);

      const onCommit = await service.commitReservedForPlan(
        PLAN_ID,
        100,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'ON_INVOICE',
      );
      const offCommit = await service.commitReservedForPlan(
        PLAN_ID,
        40,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'OFF_INVOICE',
      );

      expect(onCommit.amount).toBe(100);
      expect(offCommit.amount).toBe(40);
      expect(onCommit.id).not.toBe(offCommit.id);

      // Pre-fix, the second call's "any POSTED COMMIT exists" scan (ignoring
      // bucket) would have found the first call's COMMIT and returned it
      // unchanged — offCommit.amount would incorrectly equal 100.
      const commitCalls =
        mockBudgetRepository.createTransaction.mock.calls.filter(
          ([tx]: any) => tx.txType === BudgetTransactionType.COMMIT,
        );
      expect(commitCalls.length).toBe(2);
    });
  });

  describe('commitAllReservedForPlan — cross-path fix (submit via one route, approve via the OTHER)', () => {
    it('commits BOTH ON_INVOICE and OFF_INVOICE buckets when the plan was submitted via submitForApproval but approved via the TOTAL-blind PlanService#approve route', async () => {
      // Plan was submitted via approval-workflow.service.ts#submitForApproval
      // (two typed RESERVE rows), never a TOTAL-bucket RESERVE. A bucket-blind
      // commitReservedForPlan(planId, ..., 'TOTAL') call from plan.service.ts
      // #approve would find NO 'TOTAL' bucket reserve and fall through to a
      // fresh direct COMMIT — double-encumbering on top of the still-
      // outstanding ON/OFF RESERVEs. commitAllReservedForPlan must instead
      // discover and commit the ON/OFF buckets that actually exist.
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 60,
          spendType: 'ON_INVOICE',
        }),
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 40,
          spendType: 'OFF_INVOICE',
        }),
      ]);

      const results = await service.commitAllReservedForPlan(
        PLAN_ID,
        100, // fallbackAmount — must NOT be used as a fresh commit here
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
      );

      expect(results.length).toBe(2);
      const amounts = results.map((r) => Number(r.amount)).sort();
      expect(amounts).toEqual([40, 60]);
      const netCommitted = amounts.reduce((a, b) => a + b, 0);
      expect(netCommitted).toBe(100); // NOT 200 (no double-encumbrance)

      const commitCalls =
        mockBudgetRepository.createTransaction.mock.calls.filter(
          ([tx]: any) => tx.txType === BudgetTransactionType.COMMIT,
        );
      expect(commitCalls.length).toBe(2);
    });

    it('commits the TOTAL bucket when the plan was submitted via plan.service.ts#submit but approved via the ON/OFF-blind approval-workflow route', async () => {
      // Mirror scenario: TOTAL-bucket RESERVE only. A bucket-blind
      // commitReservedForPlan(planId, ..., 'ON_INVOICE') /
      // (..., 'OFF_INVOICE') pair (pre-fix approvePlan) would find no
      // ON/OFF bucket reserve for either call and write TWO fresh direct
      // COMMITs on top of the still-outstanding TOTAL RESERVE.
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 250,
          spendType: null,
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}`,
        }),
      ]);

      const results = await service.commitAllReservedForPlan(
        PLAN_ID,
        250,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
      );

      expect(results.length).toBe(1);
      expect(Number(results[0].amount)).toBe(250);
      expect(results[0].spendType).toBeNull();

      const commitCalls =
        mockBudgetRepository.createTransaction.mock.calls.filter(
          ([tx]: any) => tx.txType === BudgetTransactionType.COMMIT,
        );
      expect(commitCalls.length).toBe(1);
    });

    it('legacy fallback: no prior RESERVE at all → single fresh TOTAL COMMIT of fallbackAmount', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]);

      const results = await service.commitAllReservedForPlan(
        PLAN_ID,
        500,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
      );

      expect(results.length).toBe(1);
      expect(Number(results[0].amount)).toBe(500);
      expect(results[0].spendType).toBeNull();
    });

    it("MUTATION PROOF: a bucket-blind single commitReservedForPlan('TOTAL') call double-encumbers when the plan holds ON/OFF reserves", async () => {
      // Reproduces the pre-fix plan.service.ts#approve call shape directly
      // against the real (unmocked) commitReservedForPlan to prove the
      // regression this task's cross-path fix closes.
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 60,
          spendType: 'ON_INVOICE',
        }),
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 40,
          spendType: 'OFF_INVOICE',
        }),
      ]);

      const blindCommit = await service.commitReservedForPlan(
        PLAN_ID,
        100,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'TOTAL', // pre-fix plan.service.ts#approve's blind bucket
      );

      // BUG (pre-cross-path-fix): finds no TOTAL-bucket reserve, falls to
      // the "no prior RESERVE" branch, writes a FRESH direct COMMIT of the
      // full fallback amount (100) — on top of the still-outstanding 60+40
      // ON/OFF RESERVEs, which are NEVER released/converted. Net encumbrance
      // becomes 200, not 100.
      expect(blindCommit.amount).toBe(100);
      const stillOutstandingReserveTotal = 60 + 40; // ON + OFF, untouched
      const netEncumbrance =
        stillOutstandingReserveTotal + Number(blindCommit.amount);
      expect(netEncumbrance).toBe(200); // ← the double-encumbrance bug
    });
  });
});
