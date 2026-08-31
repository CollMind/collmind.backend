import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BudgetService } from './budget.service';
import { BudgetRepository } from './budget.repository';
import { BudgetThresholdService } from './budget-threshold.service';
import { BudgetReservationService } from './budget-reservation.service';
import { BudgetTierNotificationService } from './budget-tier-notification.service';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
  BudgetTransactionSourceType,
} from '../../../database/entities/budget-transaction.entity';
import {
  BudgetEnvelope,
  BudgetSpendType,
} from '../../../database/entities/budget-envelope.entity';
import { BadRequestException, ConflictException } from '@nestjs/common';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDataSource: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryRunner: any;
  // T-321: exposed (not just inlined in the provider) so the
  // "assertNotBlocked call-site wiring" describe block below can assert on
  // calls / simulate a BLOCKED rejection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTierNotificationService: any;

  beforeEach(async () => {
    // T-019b: splitEnvelope() opens its own QueryRunner transaction; since
    // BudgetRepository is fully mocked below, `queryRunner.manager` is just
    // forwarded to those mocks unused — an empty object is enough.
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {},
    };
    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    mockBudgetRepository = {
      findEnvelopeByDimensions: jest.fn().mockResolvedValue({
        id: ENVELOPE_ID,
        allocatedAmount: 1000000,
      } as BudgetEnvelope),
      // T-019b (ADR 0004 Karar 3): strict typed lookup — no UNSPLIT
      // (spend_type IS NULL) fallback. Default: dimension is NOT split.
      findEnvelopeByDimensionsStrict: jest.fn().mockResolvedValue(null),
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
      // T-019b (splitEnvelope):
      findEnvelopeWithLock: jest.fn(),
      updateEnvelope: jest
        .fn()
        .mockImplementation((envelope: any) => Promise.resolve(envelope)),
      findTransactionsByEnvelope: jest.fn().mockResolvedValue([]),
      findEnvelopeByCode: jest.fn().mockResolvedValue(null),
      createEnvelope: jest
        .fn()
        .mockImplementation((envelope: any) =>
          Promise.resolve({ ...envelope, id: `env-off-${Math.random()}` }),
        ),
      // INV-B-009 / Z47 (available_amount dropped): findAllEnvelopes /
      // findEnvelopeById now enrich from v_budget_summary.
      findAllEnvelopes: jest.fn(),
      findEnvelopeById: jest.fn(),
      getAllBudgetSummaries: jest.fn(),
      getBudgetSummary: jest.fn(),
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
        // T-318: writeTransaction() calls this after every
        // budgetRepository.createTransaction — no-op mock here, this
        // suite's assertions are about the transaction data, not tiering
        // (BudgetTierNotificationService has its own spec).
        // T-321: assertNotBlocked() is called BEFORE the write at the three
        // new-encumbrance call sites — no-op mock here too (allow-by-default).
        // Bu suite kapının KENDİ davranışını sınamaz; ÇAĞRI-YERİ BAĞLANTISINI
        // sınar — aşağıdaki `T-321 — assertNotBlocked call-site wiring` bloğu.
        //
        // ⚠️ TEAM LEAD ÖLÇÜM HATASI, KAYDA (2026-08-29): bu yorumun bir ara
        // hâli "hiçbir test yok" diyordu. YANLIŞTI — ölçüm dosya AJAN
        // TARAFINDAN YAZILIRKEN alınmıştı (`+8 satır`, `grep 0`), oysa nihai
        // hâl `+188 satır` ve blok `:171`'de. `DISIPLIN`: bir ölçüm, ölçtüğü
        // şey DEĞİŞİRKEN alınırsa geçersizdir — ve "çürüten ölçüm de
        // ölçümdür, aynı şekil-doğrulamasına tabidir".
        //
        // Kapının KENDİ reddetme/geçirme davranışının pini ise HÂLÂ AÇIK ve
        // bu DOĞRUDUR (`CLAUDE.md §3`: "bir ajan kendi yazdığı kodun testini
        // YAZMAZ — o qa-engineer'ın işidir") ⇒ `T-330`, iki-eksen şartıyla:
        //   plan/taahhüt %100 aşımı  → REDDEDİLİR
        //   RESERVE→COMMIT dönüşümü  → GEÇER   (`K-2.2.7c`: süreç durmaz)
        {
          provide: BudgetTierNotificationService,
          useValue: (mockTierNotificationService = {
            evaluateAndNotify: jest.fn().mockResolvedValue(undefined),
            assertNotBlocked: jest.fn().mockResolvedValue(undefined),
          }),
        },
        // T-019b: BudgetService#splitEnvelope opens its own QueryRunner
        // transaction (mirrors ApprovalWorkflowService/PlanService pattern).
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<BudgetService>(BudgetService);
  });

  // ---------------------------------------------------------------------
  // T-321 (Z62 §1 2c) — assertNotBlocked call-site wiring. This describe
  // block does NOT re-test the gate's own reject/pass math (that's
  // budget-tier-notification.service.spec.ts's job, real DB-shaped
  // fixtures) — it proves the TWO-AXIS split lives where the task's
  // classification claims it does:
  //   plan/taahhüt (NEW encumbrance)     → gate IS called, and a rejection
  //                                          from it stops the write dead
  //   RESERVE→COMMIT conversion (NOT new) → gate is NEVER called
  // ---------------------------------------------------------------------
  describe('T-321 — assertNotBlocked call-site wiring (K-2.2.7a BLOCKED, two-axis split)', () => {
    it('reserveForAgreement: calls assertNotBlocked BEFORE writing, and a BLOCKED rejection stops the RESERVE write', async () => {
      await service.reserveForAgreement(
        AGREEMENT_ID,
        1000,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'OFF_INVOICE',
      );
      expect(mockTierNotificationService.assertNotBlocked).toHaveBeenCalledWith(
        TENANT_ID,
        ENVELOPE_ID,
        1000,
        undefined,
      );

      // MUTATION-SHAPED PROOF (without touching production code): the gate
      // rejecting must mean NO budget_transactions row is ever written —
      // if the call site awaited it but ignored the rejection, this would
      // fail.
      mockTierNotificationService.assertNotBlocked.mockRejectedValueOnce(
        new ConflictException({ code: 'BUDGET_BLOCK_THRESHOLD_EXCEEDED' }),
      );
      mockBudgetRepository.createTransaction.mockClear();
      await expect(
        service.reserveForAgreement(
          AGREEMENT_ID,
          1000,
          'NKA',
          '2026-01', // mockBudgetRepository.findTransactionsBySource/findTransactionByIdempotencyKey are stateless (both mocked, not really tracking the first call's write) — the T-030 existing-reserve short-circuit never fires here regardless of period
          'TRY',
          TENANT_ID,
          USER_ID,
          'OFF_INVOICE',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('reserveForPlan: calls assertNotBlocked BEFORE writing, and a BLOCKED rejection stops the RESERVE write', async () => {
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
      expect(mockTierNotificationService.assertNotBlocked).toHaveBeenCalledWith(
        TENANT_ID,
        ENVELOPE_ID,
        250,
        undefined,
      );

      mockTierNotificationService.assertNotBlocked.mockRejectedValueOnce(
        new ConflictException({ code: 'BUDGET_BLOCK_THRESHOLD_EXCEEDED' }),
      );
      mockBudgetRepository.createTransaction.mockClear();
      await expect(
        service.reserveForPlan(
          'plan-002', // distinct plan — not an idempotent no-op
          250,
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          'TOTAL',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('commitReservedForPlan — legacy fallback (NO prior RESERVE, genuinely NEW encumbrance): calls assertNotBlocked, and a BLOCKED rejection stops the COMMIT write', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]); // never reserved

      await service.commitReservedForPlan(
        PLAN_ID,
        500,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'TOTAL',
      );
      expect(mockTierNotificationService.assertNotBlocked).toHaveBeenCalledWith(
        TENANT_ID,
        ENVELOPE_ID,
        500,
        undefined,
      );

      mockTierNotificationService.assertNotBlocked.mockRejectedValueOnce(
        new ConflictException({ code: 'BUDGET_BLOCK_THRESHOLD_EXCEEDED' }),
      );
      mockBudgetRepository.createTransaction.mockClear();
      await expect(
        service.commitReservedForPlan(
          'plan-003',
          500,
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          'TOTAL',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it(
      'commitReservedForPlan — RESERVE→COMMIT CONVERSION (outstanding RESERVE exists, NOT a new encumbrance — RELEASE+COMMIT of the SAME amount): ' +
        'NEVER calls assertNotBlocked, even when the gate would reject everything (K-2.2.7c: this is not a "yeni giriş")',
      async () => {
        mockBudgetRepository.findTransactionsBySource.mockResolvedValue([
          buildTx({
            txType: BudgetTransactionType.RESERVE,
            amount: 300,
            spendType: null,
          }),
        ]);
        // Poison the gate — if the conversion path called it even once,
        // this whole test would reject.
        mockTierNotificationService.assertNotBlocked.mockRejectedValue(
          new ConflictException({ code: 'BUDGET_BLOCK_THRESHOLD_EXCEEDED' }),
        );

        const commit = await service.commitReservedForPlan(
          PLAN_ID,
          300,
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          'TOTAL',
        );

        expect(commit.amount).toBe(300);
        expect(
          mockTierNotificationService.assertNotBlocked,
        ).not.toHaveBeenCalled();
      },
    );
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

  describe('reserveForPlan — zarf-kapsamlı net (Team Lead review follow-up, T-056 F1)', () => {
    // computeBucketNet'in envelopeId parametresi olmadan önce, reserveForPlan
    // kendi (artık kaldırılmış) inline netOutstanding reduce'unu YALNIZ
    // `tx.envelopeId === envelope.id` ile filtreliyordu — computeBucketNet'e
    // genelleştirilirken bu kapsam bir opsiyonel parametreye dönüştü. Bu
    // testin varlık nedeni: parametrenin GERÇEKTEN kullanıldığını (yok
    // sayılmadığını) kanıtlamak. Senaryo artık teorik değil — T-019b'nin
    // split+re-home'u bir planı, AYNI kovada (ör. ON_INVOICE) İKİ FARKLI
    // zarfta RESERVE bırakmış hâlde bırakabiliyor: split-öncesi zarfta eski
    // (fully released) bir RESERVE, split-sonrası (hedef) zarfta ise henüz
    // hiç RESERVE yok. Zarf kapsaması olmadan, hedef zarfın net'i YANLIŞLIKLA
    // diğer zarfın outstanding RESERVE'ini de sayar → reserveForPlan
    // "outstanding zaten var" sanıp erken döner, hedef zarfa YENİ RESERVE
    // YAZMAZ — under-encumbrance (bu oturumun tekrar eden hata sınıfı).
    const ENVELOPE_A = ENVELOPE_ID; // hedef zarf (findEnvelopeByDimensions bunu döner)
    const ENVELOPE_B = 'env-002'; // planın GEÇMİŞTE rezerve ettiği FARKLI bir zarf

    it('envelope-B üzerinde net>0 bırakan bir RESERVE, envelope-A (hedef, net=0) için erken dönüşü TETİKLEMEMELİ — yeni RESERVE yazılmalı', async () => {
      mockBudgetRepository.findTransactionsBySource.mockResolvedValueOnce([
        // envelope-B: outstanding (net=500) — AYRI bir zarf, hedef DEĞİL.
        buildTx({
          envelopeId: ENVELOPE_B,
          txType: BudgetTransactionType.RESERVE,
          amount: 500,
          spendType: 'ON_INVOICE',
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_B}|ON_INVOICE`,
        }),
        // envelope-A (hedef): RESERVE + onu tam sıfırlayan RELEASE — net=0,
        // ama RESERVE satırının txStatus'u (T-033 gereği) hâlâ POSTED.
        buildTx({
          envelopeId: ENVELOPE_A,
          txType: BudgetTransactionType.RESERVE,
          amount: 200,
          spendType: 'ON_INVOICE',
          idempotencyKey: `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_A}|ON_INVOICE`,
        }),
        buildTx({
          envelopeId: ENVELOPE_A,
          txType: BudgetTransactionType.RELEASE,
          amount: 200,
          spendType: 'ON_INVOICE',
          idempotencyKey: `RELEASE|PLAN|${PLAN_ID}|${ENVELOPE_A}|ON_INVOICE`,
        }),
      ]);

      const result = await service.reserveForPlan(
        PLAN_ID,
        300,
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
        'ON_INVOICE',
      );

      // BUG (zarf kapsaması yoksayılırsa): netOutstanding envelope-B'nin
      // 500'ünü de sayar (500 + 0 = 500 > 0), envelopeReserves (hâlâ POSTED
      // olan envelope-A RESERVE'i) da bulunur → erken döner, HİÇ yeni
      // RESERVE yazılmaz, dönen satır envelope-A'nın ESKİ (zaten release
      // edilmiş) satırıdır.
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledTimes(1);
      expect(result.amount).toBe(300);
      expect(result.envelopeId).toBe(ENVELOPE_A);
      expect(result.spendType).toBe('ON_INVOICE');
      // GEN2: envelope-A'da bu bucket için önceden 1 RESERVE vardı (şimdi
      // release edilmiş) — T-033 jenerasyon disiplini korunuyor.
      expect(result.idempotencyKey).toBe(
        `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_A}|ON_INVOICE|GEN2`,
      );
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

    // -----------------------------------------------------------------
    // T-019b (ADR 0004 Karar 3, §5.7): BOTH agreement vs. a SPLIT dimension.
    // -----------------------------------------------------------------
    it('rejects BOTH with 400 AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED when the dimension has been split (a typed ON or OFF envelope exists)', async () => {
      mockBudgetRepository.findEnvelopeByDimensionsStrict.mockImplementation(
        (_t: string, _c: string, _p: string, _cat: string, spendType: string) =>
          Promise.resolve(
            spendType === 'ON_INVOICE' ? ({ id: 'env-on-1' } as any) : null,
          ),
      );

      await expect(
        service.reserveForAgreement(
          AGREEMENT_ID,
          1000,
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          'BOTH',
        ),
      ).rejects.toMatchObject({
        response: { code: 'AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED' },
      });
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('still accepts BOTH on an UNSPLIT dimension (no typed envelope found either side)', async () => {
      mockBudgetRepository.findEnvelopeByDimensionsStrict.mockResolvedValue(
        null,
      );

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
    it('commits BOTH ON_INVOICE and OFF_INVOICE buckets when the plan was submitted via the typed ON/OFF path but approved via the TOTAL-blind PlanService#approve route (T-344: o yol artik PlanService#submit)', async () => {
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

    // -----------------------------------------------------------------
    // T-057 F4 (ADR 0004 Karar 5, docs/analysis/0008 §4): the legacy
    // "never reserved" fallback used to resolve its 'TOTAL' bucket via an
    // UNQUALIFIED findEnvelopeByDimensions call — one of the tipsiz call
    // sites this task closes. These tests exercise it once that dimension
    // is actually SPLIT.
    // -----------------------------------------------------------------
    describe('legacy fallback on a SPLIT dimension (T-057 F4)', () => {
      function mockSplitDimensionGuard() {
        // Unqualified call (no 5th arg) → throws the T-019b split guard.
        // Typed calls (ON_INVOICE / OFF_INVOICE) resolve normally — mirrors
        // the real repository's contract (guard never fires when spendType
        // is given, §5.1).
        mockBudgetRepository.findEnvelopeByDimensions.mockImplementation(
          (
            _tenantId: string,
            _channel: string,
            _period: string,
            _category?: string,
            spendType?: string,
          ) => {
            if (!spendType) {
              return Promise.reject(
                new BadRequestException({
                  statusCode: 400,
                  code: 'SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION',
                  message: 'split dimension',
                }),
              );
            }
            return Promise.resolve({
              id: spendType === 'ON_INVOICE' ? 'env-on' : 'env-off',
              allocatedAmount: 1000000,
            } as BudgetEnvelope);
          },
        );
      }

      it('with a spendBreakdown: commits ON_INVOICE and OFF_INVOICE INDEPENDENTLY using the REAL evidence, never a fabricated split of fallbackAmount', async () => {
        mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]); // never reserved
        mockSplitDimensionGuard();

        // T-057 B3 (code-reviewer, 2026-08-04): fallbackAmount must now be
        // the on+off IDENTITY (100 = 60 + 40) — the new consistency gate
        // (mirrors plan.service.ts's PLAN_SPEND_BREAKDOWN_INCONSISTENT)
        // rejects any caller whose fallbackAmount disagrees with its own
        // spendBreakdown BEFORE this branch is even reached. That the
        // resulting commits are 60/40 (not e.g. a fabricated 50/50 split of
        // fallbackAmount) is still the thing this test proves; the
        // "fallbackAmount is never used as a fabrication source" claim is
        // now covered by the dedicated inconsistency test below (which uses
        // a genuinely mismatched fallbackAmount and asserts the 400).
        const results = await service.commitAllReservedForPlan(
          PLAN_ID,
          100, // fallbackAmount — must equal onInvoice + offInvoice (60 + 40)
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          undefined,
          { onInvoice: 60, offInvoice: 40 },
        );

        expect(results.length).toBe(2);
        const byType = new Map(
          results.map((r) => [r.spendType, Number(r.amount)]),
        );
        expect(byType.get(BudgetSpendType.ON_INVOICE)).toBe(60);
        expect(byType.get(BudgetSpendType.OFF_INVOICE)).toBe(40);
        // Not the fallbackAmount, and not a fabricated 50/50 split.
        expect(results.some((r) => Number(r.amount) === 999999)).toBe(false);
      });

      // T-057 B3 (code-reviewer, 2026-08-04): identity gate — `on + off`
      // must equal `fallbackAmount` exactly (§ same 0.01 epsilon as
      // plan.service.ts's submit-side PLAN_SPEND_BREAKDOWN_INCONSISTENT
      // gate). Without this, a caller whose `totalSpend`/`onInvoiceSpend`/
      // `offInvoiceSpend` columns disagree (stale recalc) would silently
      // commit the WRONG amount to the budget ledger.
      it('B3 — fallbackAmount disagrees with spendBreakdown sum → 400 PLAN_SPEND_BREAKDOWN_INCONSISTENT, no COMMIT written', async () => {
        mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]); // never reserved
        mockSplitDimensionGuard();

        await expect(
          service.commitAllReservedForPlan(
            PLAN_ID,
            999999, // fallbackAmount — deliberately inconsistent with 60 + 40
            'NKA',
            '2026-01',
            'TRY',
            TENANT_ID,
            USER_ID,
            undefined,
            { onInvoice: 60, offInvoice: 40 },
          ),
        ).rejects.toMatchObject({
          response: { code: 'PLAN_SPEND_BREAKDOWN_INCONSISTENT' },
        });
        const commitCalls =
          mockBudgetRepository.createTransaction.mock.calls.filter(
            ([tx]: any) => tx.txType === BudgetTransactionType.COMMIT,
          );
        expect(commitCalls.length).toBe(0);
      });

      it('spends only ON_INVOICE (offInvoice=0): writes ONE commit, not a zero-amount OFF_INVOICE row', async () => {
        mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]);
        mockSplitDimensionGuard();

        const results = await service.commitAllReservedForPlan(
          PLAN_ID,
          60,
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
          undefined,
          { onInvoice: 60, offInvoice: 0 },
        );

        expect(results.length).toBe(1);
        expect(results[0].spendType).toBe(BudgetSpendType.ON_INVOICE);
        expect(Number(results[0].amount)).toBe(60);
      });

      it('WITHOUT a spendBreakdown: rejects rather than guessing (400 PLAN_SPEND_BREAKDOWN_REQUIRED_FOR_SPLIT_DIMENSION), no COMMIT written', async () => {
        mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]);
        mockSplitDimensionGuard();

        await expect(
          service.commitAllReservedForPlan(
            PLAN_ID,
            500,
            'NKA',
            '2026-01',
            'TRY',
            TENANT_ID,
            USER_ID,
            // no manager, no spendBreakdown
          ),
        ).rejects.toMatchObject({
          response: {
            code: 'PLAN_SPEND_BREAKDOWN_REQUIRED_FOR_SPLIT_DIMENSION',
          },
        });
        const commitCalls =
          mockBudgetRepository.createTransaction.mock.calls.filter(
            ([tx]: any) => tx.txType === BudgetTransactionType.COMMIT,
          );
        expect(commitCalls.length).toBe(0);
      });

      it('WITH a zero-valued spendBreakdown (0/0): rejects the same way as no breakdown at all', async () => {
        mockBudgetRepository.findTransactionsBySource.mockResolvedValue([]);
        mockSplitDimensionGuard();

        await expect(
          service.commitAllReservedForPlan(
            PLAN_ID,
            500,
            'NKA',
            '2026-01',
            'TRY',
            TENANT_ID,
            USER_ID,
            undefined,
            { onInvoice: 0, offInvoice: 0 },
          ),
        ).rejects.toMatchObject({
          response: {
            code: 'PLAN_SPEND_BREAKDOWN_REQUIRED_FOR_SPLIT_DIMENSION',
          },
        });
      });
    });
  });

  // ---------------------------------------------------------------------
  // T-056 adım 2 (docs/analysis/0009 §2.4/§3.1/§3.2, §6 adım 2) — SAF
  // TAŞIMA: bu mantık `approval-workflow.service.ts`'in private
  // `checkBudgetAvailability`'siydi (T-019b, §5.5); şimdi
  // `BudgetService#checkPlanBudgetAvailability` olarak buraya taşındı.
  // Bu describe bloğu, önceden `approval-workflow.service.spec.ts`'te
  // ApprovalWorkflowService'in mocklanmış BudgetService'i üzerinden
  // dolaylı test edilen AYNI senaryoları (UNSPLIT birleşik kural, SPLIT
  // bağımsız zarf, ADR 0004 Karar 2 eki) şimdi GERÇEK kodu (mock sadece
  // `BudgetRepository`) çalıştırarak test eder — algoritmanın taşındığı
  // katmanda doğrudan kanıt (bkz. Team Lead task: "gevşetme değil,
  // korumanın doğru yere taşınması", 0009 §5.3'teki T-052 emsaliyle aynı
  // sınıf).
  // ---------------------------------------------------------------------
  describe('checkPlanBudgetAvailability — taşınmış budget-domain kontrolü (T-056 adım 2)', () => {
    function mockUnsplitEnvelope(allocatedAmount: number) {
      // UNSPLIT: ON_INVOICE ve OFF_INVOICE aramaları AYNI zarfa düşer
      // (spend_type IS NULL fallback) — §5.1.
      mockBudgetRepository.findEnvelopeByDimensions.mockResolvedValue({
        id: ENVELOPE_ID,
        allocatedAmount,
      } as BudgetEnvelope);
    }

    function mockAvailable(available: number) {
      mockBudgetRepository.checkBudgetAvailability.mockImplementation(
        (_envelopeId: string, _tenantId: string, requestedAmount: number) =>
          Promise.resolve({
            available,
            sufficient: requestedAmount <= available,
          }),
      );
    }

    it('UNSPLIT birleşik kural (§5.5, ADR 0004 Karar 2, T3): on=60 ve off=60 AYRI AYRI 100-lük havuza sığar ama BİRLİKTE (120) sığmaz → overallSufficient=false, on/off leg sufficient=true (informational)', async () => {
      mockUnsplitEnvelope(100);
      mockAvailable(100);

      const result = await service.checkPlanBudgetAvailability(
        TENANT_ID,
        'NKA',
        '2026-01',
        60,
        60,
      );

      expect(result.onInvoice.sufficient).toBe(true); // 60 <= 100
      expect(result.offInvoice.sufficient).toBe(true); // 60 <= 100
      expect(result.overallSufficient).toBe(false); // 120 > 100 — atomik kapı
      // Kombine sorgu — checkBudgetAvailability (on+off) ile TEK kez.
      expect(mockBudgetRepository.checkBudgetAvailability).toHaveBeenCalledWith(
        ENVELOPE_ID,
        TENANT_ID,
        120,
      );
    });

    it('UNSPLIT: on=50 ve off=30 birlikte (80) 100-lük havuza sığar → overallSufficient=true', async () => {
      mockUnsplitEnvelope(100);
      mockAvailable(100);

      const result = await service.checkPlanBudgetAvailability(
        TENANT_ID,
        'NKA',
        '2026-01',
        50,
        30,
      );

      expect(result.overallSufficient).toBe(true);
    });

    it('SPLIT + ADR 0004 Karar 2 eki: yalnız on-invoice harcayan plan, tükenmiş off-invoice zarfından ETKİLENMEZ (off=0 istek, off zarfı 0 available olsa da sufficient)', async () => {
      mockBudgetRepository.findEnvelopeByDimensions.mockImplementation(
        (
          _tenantId: string,
          _channel: string,
          _period: string,
          _category?: string,
          spendType?: string,
        ) =>
          Promise.resolve(
            spendType === BudgetSpendType.ON_INVOICE
              ? ({ id: 'env-on' } as BudgetEnvelope)
              : ({ id: 'env-off' } as BudgetEnvelope),
          ),
      );
      mockBudgetRepository.checkBudgetAvailability.mockImplementation(
        (envelopeId: string, _tenantId: string, requestedAmount: number) => {
          const available = envelopeId === 'env-on' ? 100000 : 0;
          return Promise.resolve({
            available,
            sufficient: requestedAmount <= available,
          });
        },
      );

      const result = await service.checkPlanBudgetAvailability(
        TENANT_ID,
        'NKA',
        '2026-01',
        50000,
        0,
      );

      expect(result.overallSufficient).toBe(true);
      expect(result.offInvoice.requested).toBe(0);
    });

    it('SPLIT: plan HER İKİ tipi de harcıyor, on zarfına tek başına sığıyor ama off zarfı yetersiz → BÜTÜN istek reddedilir (atomiklik, kısmi rezervasyon yok)', async () => {
      mockBudgetRepository.findEnvelopeByDimensions.mockImplementation(
        (
          _tenantId: string,
          _channel: string,
          _period: string,
          _category?: string,
          spendType?: string,
        ) =>
          Promise.resolve(
            spendType === BudgetSpendType.ON_INVOICE
              ? ({ id: 'env-on' } as BudgetEnvelope)
              : ({ id: 'env-off' } as BudgetEnvelope),
          ),
      );
      mockBudgetRepository.checkBudgetAvailability.mockImplementation(
        (envelopeId: string, _tenantId: string, requestedAmount: number) => {
          const available = envelopeId === 'env-on' ? 100000 : 10000;
          return Promise.resolve({
            available,
            sufficient: requestedAmount <= available,
          });
        },
      );

      const result = await service.checkPlanBudgetAvailability(
        TENANT_ID,
        'NKA',
        '2026-01',
        50000,
        20000, // off (20000) > off available (10000)
      );

      expect(result.onInvoice.sufficient).toBe(true);
      expect(result.offInvoice.sufficient).toBe(false);
      expect(result.overallSufficient).toBe(false);
    });

    it('SPLIT: her iki tip de bağımsız zarfına sığıyor → overallSufficient=true', async () => {
      mockBudgetRepository.findEnvelopeByDimensions.mockImplementation(
        (
          _tenantId: string,
          _channel: string,
          _period: string,
          _category?: string,
          spendType?: string,
        ) =>
          Promise.resolve(
            spendType === BudgetSpendType.ON_INVOICE
              ? ({ id: 'env-on' } as BudgetEnvelope)
              : ({ id: 'env-off' } as BudgetEnvelope),
          ),
      );
      mockBudgetRepository.checkBudgetAvailability.mockImplementation(
        (envelopeId: string, _tenantId: string, requestedAmount: number) => {
          const available = envelopeId === 'env-on' ? 100000 : 100000;
          return Promise.resolve({
            available,
            sufficient: requestedAmount <= available,
          });
        },
      );

      const result = await service.checkPlanBudgetAvailability(
        TENANT_ID,
        'NKA',
        '2026-01',
        50000,
        30000,
      );

      expect(result.overallSufficient).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // T-056 adım 3 (docs/analysis/0009 §3.2, §6 adım 3) — TEK rezervasyon
  // motoru. `ApprovalWorkflowService#submitForApproval` bu turdan itibaren
  // bu metodu çağırıyor (bkz. approval-workflow.service.spec.ts — orada
  // yalnız "hangi tutarlarla çağrıldı" doğrulanıyor, GERÇEK kapı/yazma
  // davranışı burada, gerçek `BudgetRepository` mock'una karşı test edilir).
  // ---------------------------------------------------------------------
  describe('reserveTypedForPlan — tek rezervasyon motoru (T-056 adım 3)', () => {
    it('MUTASYON 1 zemini — kapı yazımdan ÖNCE: on=60/off=60, UNSPLIT 100-lük paylaşılan havuz → BadRequestException, HİÇBİR RESERVE satırı yazılmaz (Karar 2, kısmi rezervasyon YOK)', async () => {
      mockBudgetRepository.findEnvelopeByDimensions.mockResolvedValue({
        id: ENVELOPE_ID,
        allocatedAmount: 100,
      } as BudgetEnvelope);
      mockBudgetRepository.checkBudgetAvailability.mockImplementation(
        (_envelopeId: string, _tenantId: string, requestedAmount: number) =>
          Promise.resolve({
            available: 100,
            sufficient: requestedAmount <= 100,
          }),
      );

      await expect(
        service.reserveTypedForPlan(
          PLAN_ID,
          { onInvoice: 60, offInvoice: 60 },
          'NKA',
          '2026-01',
          'TRY',
          TENANT_ID,
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      // Kapı yazımdan SONRAYA alınsaydı (veya atlansaydı), on=60 tek
      // başına 100-lük havuza sığdığı için ilk RESERVE yazılırdı — bu
      // assertion tam olarak "biri aşarsa hiçbir satır yazılmaz"
      // korumasını kilitler.
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('MUTASYON 2 zemini — yalnız fiilen harcanan tipler değerlendirilir/yazılır: off=0 iken OFF_INVOICE için ne kontrol ne yazma yapılır (dolu off zarfı planı bloklamaz)', async () => {
      mockBudgetRepository.findEnvelopeByDimensions.mockImplementation(
        (
          _tenantId: string,
          _channel: string,
          _period: string,
          _category?: string,
          spendType?: string,
        ) =>
          Promise.resolve(
            spendType === BudgetSpendType.ON_INVOICE
              ? ({ id: 'env-on' } as BudgetEnvelope)
              : ({ id: 'env-off' } as BudgetEnvelope),
          ),
      );
      // off-invoice zarfı TAMAMEN DOLU (0 available) — off=0 istendiği için
      // bu, planı bloklamamalı VE hiç yazılmamalı.
      mockBudgetRepository.checkBudgetAvailability.mockImplementation(
        (envelopeId: string, _tenantId: string, requestedAmount: number) => {
          const available = envelopeId === 'env-on' ? 100000 : 0;
          return Promise.resolve({
            available,
            sufficient: requestedAmount <= available,
          });
        },
      );

      const result = await service.reserveTypedForPlan(
        PLAN_ID,
        { onInvoice: 50000, offInvoice: 0 },
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
      );

      expect(result).toHaveLength(1);
      expect(result[0].spendType).toBe('ON_INVOICE');
      expect(result[0].amount).toBe(50000);
      // Mutasyon (off=0 tipi de değerlendirilip yazılırsa): bu 2 olurdu —
      // OFF_INVOICE için amount=0'lık gereksiz bir RESERVE satırı yazılırdı.
      expect(mockBudgetRepository.createTransaction).toHaveBeenCalledTimes(1);
      expect(mockBudgetRepository.createTransaction.mock.calls[0][0]).toEqual(
        expect.objectContaining({ spendType: 'ON_INVOICE', amount: 50000 }),
      );
    });

    it('on=0 && off=0 → no-op: boş dizi döner, kapı dahi atlanır (hiçbir tip harcanmıyor)', async () => {
      const result = await service.reserveTypedForPlan(
        PLAN_ID,
        { onInvoice: 0, offInvoice: 0 },
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
      );

      expect(result).toEqual([]);
      // Kapı (checkPlanBudgetAvailability) dahi çağrılmadı — envelope
      // lookup'ı hiç tetiklenmedi.
      expect(
        mockBudgetRepository.findEnvelopeByDimensions,
      ).not.toHaveBeenCalled();
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('her iki tip de harcanıyorsa: deterministik ON→OFF sırayla iki RESERVE yazılır, mevcut reserveForPlan (kova-farkındalı net/idempotency) DEĞİŞTİRİLMEDEN kullanılır', async () => {
      // beforeEach'in varsayılan mock'u: UNSPLIT, tek zarf (ENVELOPE_ID),
      // 1.000.000 available — hem ON hem OFF aynı zarfa düşer.
      const result = await service.reserveTypedForPlan(
        PLAN_ID,
        { onInvoice: 100, offInvoice: 40 },
        'NKA',
        '2026-01',
        'TRY',
        TENANT_ID,
        USER_ID,
      );

      expect(result).toHaveLength(2);
      expect(result[0].spendType).toBe('ON_INVOICE');
      expect(result[0].amount).toBe(100);
      expect(result[1].spendType).toBe('OFF_INVOICE');
      expect(result[1].amount).toBe(40);

      // Yazma sırası ON→OFF (0008 §6 R4 — deadlock disiplini).
      const createCalls = mockBudgetRepository.createTransaction.mock.calls;
      expect(createCalls).toHaveLength(2);
      expect(createCalls[0][0]).toEqual(
        expect.objectContaining({ spendType: 'ON_INVOICE', amount: 100 }),
      );
      expect(createCalls[1][0]).toEqual(
        expect.objectContaining({ spendType: 'OFF_INVOICE', amount: 40 }),
      );
      // T-019/T-048 key uzayı DOKUNULMADI — reserveForPlan'ın bugün
      // ürettiği |ON_INVOICE / |OFF_INVOICE sonekli formatın AYNISI.
      expect(createCalls[0][0].idempotencyKey).toBe(
        `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|ON_INVOICE`,
      );
      expect(createCalls[1][0].idempotencyKey).toBe(
        `RESERVE|PLAN|${PLAN_ID}|${ENVELOPE_ID}|OFF_INVOICE`,
      );
    });
  });

  // ---------------------------------------------------------------------
  // T-019b (Faz 2, docs/analysis/0008 §4) — splitEnvelope
  // ---------------------------------------------------------------------
  describe('splitEnvelope — Faz 2 split + append-only re-home', () => {
    function envelopeFixture(overrides: Record<string, any> = {}) {
      return {
        id: ENVELOPE_ID,
        tenantId: TENANT_ID,
        code: 'ENV-2026-NKA-Q1',
        name: 'NKA Q1 Budget',
        fiscalYear: '2026',
        period: '2026-01',
        allocatedAmount: 1000000,
        consumedAmount: 0,
        status: 'ACTIVE',
        currency: 'TRY',
        spendType: null,
        metadata: null,
        ...overrides,
      } as unknown as BudgetEnvelope;
    }

    it('happy path: no prior encumbrance — original id preserved as ON_INVOICE, OFF twin created, no re-home writes', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([]);

      const result = await service.splitEnvelope(
        TENANT_ID,
        USER_ID,
        ENVELOPE_ID,
        600000,
        400000,
      );

      expect(result.onEnvelope.id).toBe(ENVELOPE_ID); // id PRESERVED
      expect(result.onEnvelope.spendType).toBe(BudgetSpendType.ON_INVOICE);
      expect(result.onEnvelope.allocatedAmount).toBe(600000);
      expect(result.offEnvelope.id).not.toBe(ENVELOPE_ID); // NEW row
      expect(result.offEnvelope.spendType).toBe(BudgetSpendType.OFF_INVOICE);
      expect(result.offEnvelope.allocatedAmount).toBe(400000);
      expect(result.offEnvelope.code).toBe('ENV-2026-NKA-Q1-OFF');
      expect(result.rehomed).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('rejects with 409 ENVELOPE_ALREADY_SPLIT when spend_type is already set', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture({ spendType: BudgetSpendType.ON_INVOICE }),
      );

      await expect(
        service.splitEnvelope(TENANT_ID, USER_ID, ENVELOPE_ID, 600000, 400000),
      ).rejects.toMatchObject({
        response: { code: 'ENVELOPE_ALREADY_SPLIT' },
      });
      expect(mockBudgetRepository.createEnvelope).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('rejects with 400 when onInvoiceAllocated + offInvoiceAllocated != allocated_amount (Finance cannot resize from this endpoint)', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture({ allocatedAmount: 1000000 }),
      );

      await expect(
        service.splitEnvelope(TENANT_ID, USER_ID, ENVELOPE_ID, 600000, 500000), // sums to 1,100,000
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockBudgetRepository.createEnvelope).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('rejects with 409 UNTYPED_ENCUMBRANCE_PRESENT when untyped (spend_type IS NULL) net > 0 exists — no writes happen', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 50000,
          spendType: null, // TOTAL-bucket / untyped
          sourceType: BudgetTransactionSourceType.PLAN,
          sourceId: 'plan-untyped-1',
        }),
      ]);

      await expect(
        service.splitEnvelope(TENANT_ID, USER_ID, ENVELOPE_ID, 600000, 400000),
      ).rejects.toMatchObject({
        response: { code: 'UNTYPED_ENCUMBRANCE_PRESENT' },
      });
      expect(mockBudgetRepository.createEnvelope).not.toHaveBeenCalled();
      expect(mockBudgetRepository.updateEnvelope).not.toHaveBeenCalled();
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('re-homes an OFF_INVOICE-tagged RESERVE bucket: RELEASE(net) on the OLD envelope + RESERVE(net) on the NEW envelope, net conserved', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 75000,
          spendType: BudgetSpendType.OFF_INVOICE,
          sourceType: BudgetTransactionSourceType.AGREEMENT,
          sourceId: AGREEMENT_ID,
        }),
      ]);

      const result = await service.splitEnvelope(
        TENANT_ID,
        USER_ID,
        ENVELOPE_ID,
        925000,
        75000,
      );

      expect(result.rehomed).toEqual([
        {
          sourceType: BudgetTransactionSourceType.AGREEMENT,
          sourceId: AGREEMENT_ID,
          amount: 75000,
          txType: BudgetTransactionType.RESERVE,
        },
      ]);

      const calls = mockBudgetRepository.createTransaction.mock.calls.map(
        ([tx]: any) => tx,
      );
      expect(calls.length).toBe(2);

      const release = calls.find(
        (tx: any) => tx.txType === BudgetTransactionType.RELEASE,
      );
      expect(release.envelopeId).toBe(ENVELOPE_ID); // OLD (now ON_INVOICE) row
      expect(release.amount).toBe(75000);
      expect(release.spendType).toBe(BudgetSpendType.OFF_INVOICE);
      expect(release.idempotencyKey).toBe(
        `RELEASE|AGREEMENT|${AGREEMENT_ID}|${ENVELOPE_ID}|REHOME`,
      );

      const reserve = calls.find(
        (tx: any) => tx.txType === BudgetTransactionType.RESERVE,
      );
      expect(reserve.envelopeId).toBe(result.offEnvelope.id); // NEW row
      expect(reserve.amount).toBe(75000);
      expect(reserve.spendType).toBe(BudgetSpendType.OFF_INVOICE);
      expect(reserve.idempotencyKey).toBe(
        `RESERVE|AGREEMENT|${AGREEMENT_ID}|${result.offEnvelope.id}`,
      );

      // T1 ledger-conservation invariant (§7 T1): net BEFORE (75000 on the
      // single old envelope) === net AFTER (summed across BOTH envelopes:
      // old bucket net 75000-75000=0, new bucket net 75000-0=75000).
      const netBefore = 75000;
      const oldBucketNetAfter = 75000 - release.amount;
      const newBucketNetAfter = reserve.amount;
      expect(oldBucketNetAfter + newBucketNetAfter).toBe(netBefore);
    });

    it('re-homes a COMMITTED OFF_INVOICE bucket as COMMIT (not RESERVE) on the new envelope', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      // RESERVE(75000) converted to COMMIT(75000) via the normal
      // approve/convert flow (RELEASE|...|CONVERT + COMMIT) — net is still
      // 75000, but the LATEST state is "committed", not "reserved".
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 75000,
          spendType: BudgetSpendType.OFF_INVOICE,
          sourceType: BudgetTransactionSourceType.PLAN,
          sourceId: PLAN_ID,
        }),
        buildTx({
          txType: BudgetTransactionType.RELEASE,
          amount: 75000,
          spendType: BudgetSpendType.OFF_INVOICE,
          sourceType: BudgetTransactionSourceType.PLAN,
          sourceId: PLAN_ID,
        }),
        buildTx({
          txType: BudgetTransactionType.COMMIT,
          amount: 75000,
          spendType: BudgetSpendType.OFF_INVOICE,
          sourceType: BudgetTransactionSourceType.PLAN,
          sourceId: PLAN_ID,
        }),
      ]);

      const result = await service.splitEnvelope(
        TENANT_ID,
        USER_ID,
        ENVELOPE_ID,
        925000,
        75000,
      );

      expect(result.rehomed[0].txType).toBe(BudgetTransactionType.COMMIT);
      const calls = mockBudgetRepository.createTransaction.mock.calls.map(
        ([tx]: any) => tx,
      );
      const newSideWrite = calls.find(
        (tx: any) => tx.envelopeId === result.offEnvelope.id,
      );
      expect(newSideWrite.txType).toBe(BudgetTransactionType.COMMIT);
      expect(newSideWrite.idempotencyKey).toBe(
        `COMMIT|PLAN|${PLAN_ID}|${result.offEnvelope.id}`,
      );
    });

    it('does NOT re-home an ON_INVOICE-tagged bucket (it already correctly stays on the id-preserved ON row)', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 50000,
          spendType: BudgetSpendType.ON_INVOICE,
          sourceType: BudgetTransactionSourceType.PLAN,
          sourceId: PLAN_ID,
        }),
      ]);

      const result = await service.splitEnvelope(
        TENANT_ID,
        USER_ID,
        ENVELOPE_ID,
        600000,
        400000,
      );

      expect(result.rehomed).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    it('net<=0 OFF_INVOICE bucket (already fully released) is skipped — no-op, not an error', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 20000,
          spendType: BudgetSpendType.OFF_INVOICE,
          sourceType: BudgetTransactionSourceType.AGREEMENT,
          sourceId: AGREEMENT_ID,
        }),
        buildTx({
          txType: BudgetTransactionType.RELEASE,
          amount: 20000,
          spendType: BudgetSpendType.OFF_INVOICE,
          sourceType: BudgetTransactionSourceType.AGREEMENT,
          sourceId: AGREEMENT_ID,
        }),
      ]);

      const result = await service.splitEnvelope(
        TENANT_ID,
        USER_ID,
        ENVELOPE_ID,
        1000000,
        0,
      );

      expect(result.rehomed).toEqual([]);
      expect(mockBudgetRepository.createTransaction).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------
    // MUTATION PROOF (bağlayıcı kanıt #1, T-019b tuzağı): the `|REHOME`
    // idempotency-key suffix is NOT optional. Without it, the re-home
    // RELEASE key on the OLD envelope is BYTE-IDENTICAL to
    // `BudgetReservationService#releaseNetReservation`'s UNTYPED terminal
    // release key format (`RELEASE|<SRC>|<sourceId>|<envelopeId>`, no
    // spendType component — see that class's JSDoc kural #3). If this
    // source later legitimately needs an untyped-bucket release on the SAME
    // envelope (e.g. it also had an untyped/TOTAL-bucket reservation there),
    // `findTransactionByIdempotencyKey` would find THIS re-home row already
    // posted and treat the real release as a no-op — the reservation stays
    // outstanding FOREVER (T-030 F1's exact regression class).
    // -----------------------------------------------------------------
    it('MUTATION PROOF: the re-home RELEASE key must be DISTINCT from the UNTYPED terminal release key format for the same (source, envelope)', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([
        buildTx({
          txType: BudgetTransactionType.RESERVE,
          amount: 75000,
          spendType: BudgetSpendType.OFF_INVOICE,
          sourceType: BudgetTransactionSourceType.AGREEMENT,
          sourceId: AGREEMENT_ID,
        }),
      ]);

      await service.splitEnvelope(
        TENANT_ID,
        USER_ID,
        ENVELOPE_ID,
        925000,
        75000,
      );

      const release = mockBudgetRepository.createTransaction.mock.calls
        .map(([tx]: any) => tx)
        .find((tx: any) => tx.txType === BudgetTransactionType.RELEASE);

      // BudgetReservationService's OWN untyped-bucket key format (class
      // JSDoc kural #3 / T-053): `RELEASE|<SRC>|<sourceId>|<envelopeId>`.
      const untypedTerminalFormatKey = `RELEASE|AGREEMENT|${AGREEMENT_ID}|${ENVELOPE_ID}`;

      // Passes TODAY (suffix present). If `|REHOME` is removed from
      // splitEnvelope's release key, this assertion FLIPS to a collision
      // (idempotencyKey === untypedTerminalFormatKey) and the test goes RED.
      expect(release.idempotencyKey).not.toBe(untypedTerminalFormatKey);
      expect(release.idempotencyKey).toBe(`${untypedTerminalFormatKey}|REHOME`);
    });

    it('tenant isolation: envelope lookup is tenant-scoped (findEnvelopeWithLock called with the caller tenantId)', async () => {
      mockBudgetRepository.findEnvelopeWithLock.mockResolvedValue(
        envelopeFixture(),
      );
      mockBudgetRepository.findTransactionsByEnvelope.mockResolvedValue([]);

      await service.splitEnvelope(
        TENANT_ID,
        USER_ID,
        ENVELOPE_ID,
        600000,
        400000,
      );

      expect(mockBudgetRepository.findEnvelopeWithLock).toHaveBeenCalledWith(
        TENANT_ID,
        ENVELOPE_ID,
        queryRunner.manager,
      );
    });
  });

  // -------------------------------------------------------------------
  // INV-B-009 / Z47 — `budget_envelopes.available_amount` DROPPED.
  // `findAllEnvelopes`/`findEnvelopeById` used to return the bare entity
  // (which carried the now-dead column); they now enrich from
  // `v_budget_summary` so `GET /budget/envelopes` and `GET
  // /budget/envelopes/:id` keep serving an `availableAmount` field —
  // just always a live one. This is the discovered reader (not in the
  // original task brief): `collmind.frontend`'s envelope list/dashboard
  // components consume exactly these two endpoints.
  // -------------------------------------------------------------------
  describe('findAllEnvelopes / findEnvelopeById — INV-B-009 view enrichment', () => {
    it('findEnvelopeById attaches the canonical (view) availableAmount to the entity', async () => {
      mockBudgetRepository.findEnvelopeById.mockResolvedValue({
        id: ENVELOPE_ID,
        code: 'ENV-1',
        allocatedAmount: 1000000,
      } as BudgetEnvelope);
      mockBudgetRepository.getBudgetSummary.mockResolvedValue({
        envelopeId: ENVELOPE_ID,
        availableAmount: 403500,
        allocatedAmount: 1000000,
      });

      const result = await service.findEnvelopeById(TENANT_ID, ENVELOPE_ID);

      expect(mockBudgetRepository.getBudgetSummary).toHaveBeenCalledWith(
        ENVELOPE_ID,
        TENANT_ID,
      );
      expect(result.availableAmount).toBe(403500);
      expect(result.id).toBe(ENVELOPE_ID); // entity fields still present
    });

    it('findEnvelopeById throws (does not default to 0) when v_budget_summary has no row', async () => {
      mockBudgetRepository.findEnvelopeById.mockResolvedValue({
        id: ENVELOPE_ID,
        code: 'ENV-1',
        allocatedAmount: 1000000,
      } as BudgetEnvelope);
      mockBudgetRepository.getBudgetSummary.mockResolvedValue(null);

      await expect(
        service.findEnvelopeById(TENANT_ID, ENVELOPE_ID),
      ).rejects.toThrow(/INV-B-009/);
    });

    it('findAllEnvelopes joins each entity to its v_budget_summary row by envelopeId', async () => {
      mockBudgetRepository.findAllEnvelopes.mockResolvedValue([
        { id: 'env-a', code: 'A', allocatedAmount: 100 } as BudgetEnvelope,
        { id: 'env-b', code: 'B', allocatedAmount: 200 } as BudgetEnvelope,
      ]);
      mockBudgetRepository.getAllBudgetSummaries.mockResolvedValue([
        { envelopeId: 'env-b', availableAmount: 150, allocatedAmount: 200 },
        { envelopeId: 'env-a', availableAmount: 75, allocatedAmount: 100 },
      ]);

      const result = await service.findAllEnvelopes(TENANT_ID);

      expect(result.find((e) => e.id === 'env-a')?.availableAmount).toBe(75);
      expect(result.find((e) => e.id === 'env-b')?.availableAmount).toBe(150);
    });

    it('findAllEnvelopes throws (does not skip or default) when an envelope has no matching summary row', async () => {
      mockBudgetRepository.findAllEnvelopes.mockResolvedValue([
        { id: 'env-orphan', code: 'X', allocatedAmount: 100 } as BudgetEnvelope,
      ]);
      mockBudgetRepository.getAllBudgetSummaries.mockResolvedValue([]);

      await expect(service.findAllEnvelopes(TENANT_ID)).rejects.toThrow(
        /INV-B-009/,
      );
    });
  });
});
