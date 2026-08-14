import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { BudgetAllocationService } from './budget-allocation.service';
import {
  BudgetAllocation,
  PeriodType,
} from '../../../database/entities/budget-allocation.entity';
import {
  BudgetTransactionLog,
  BudgetTransactionType,
} from '../../../database/entities/budget-transaction-log.entity';
import { Plan } from '../../../database/entities/plan.entity';
import { BudgetCheckContext } from './dto/budget-check-context.dto';
import { SpendBreakdown } from '../spend-calculation/dto/spend-breakdown.dto';
import { BudgetThresholdService } from './budget-threshold.service';
import { UtilizationStatus } from '../finance-reporting/dto/budget-utilization.dto';

const mockBudgetThresholdService = {
  getThresholds: jest
    .fn()
    .mockResolvedValue({ warning: 80, critical: 95, exceeded: 100 }),
  toStatus: jest.fn().mockImplementation((percent: number) => {
    if (percent >= 95) return UtilizationStatus.RED;
    if (percent >= 80) return UtilizationStatus.AMBER;
    return UtilizationStatus.GREEN;
  }),
  isExceeded: jest
    .fn()
    .mockImplementation(
      (percent: number, thresholds: { exceeded: number }) =>
        percent >= thresholds.exceeded,
    ),
};

describe('BudgetAllocationService', () => {
  let service: BudgetAllocationService;
  let budgetAllocationRepo: jest.Mocked<Repository<BudgetAllocation>>;
  let budgetTransactionLogRepo: jest.Mocked<Repository<BudgetTransactionLog>>;
  let planRepo: jest.Mocked<Repository<Plan>>;
  let dataSource: DataSource;

  const mockTenantId = 'tenant-1';
  const mockUserId = 'user-1';
  const mockAllocationId = 'allocation-1';
  const mockPlanId = 'plan-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetAllocationService,
        {
          provide: getRepositoryToken(BudgetAllocation),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(BudgetTransactionLog),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Plan),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          // T-096/2: the service now writes the balance and its transaction log
          // inside one `dataSource.transaction`. The mock runs the callback with
          // a manager whose `getRepository` hands back the SAME mocked repos, so
          // existing assertions on `budgetAllocationRepo.save` keep working and
          // the transactional path is exercised rather than stubbed away.
          provide: DataSource,
          useValue: {
            transaction: (cb: any) =>
              cb({
                getRepository: (entity: any) =>
                  entity === BudgetAllocation
                    ? budgetAllocationRepo
                    : budgetTransactionLogRepo,
              }),
          },
        },
        {
          provide: BudgetThresholdService,
          useValue: mockBudgetThresholdService,
        },
      ],
    }).compile();

    service = module.get<BudgetAllocationService>(BudgetAllocationService);
    budgetAllocationRepo = module.get(getRepositoryToken(BudgetAllocation));
    budgetTransactionLogRepo = module.get(
      getRepositoryToken(BudgetTransactionLog),
    );
    planRepo = module.get(getRepositoryToken(Plan));
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAllocation', () => {
    it('should create budget allocation successfully', async () => {
      const dto = {
        periodType: PeriodType.MONTHLY,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        fiscalYear: 2025,
        cplId: 'cpl-1',
        channel: 'NKA',
        category: 'Dairy',
        onInvoiceBudget: 100000,
        offInvoiceBudget: 50000,
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      budgetAllocationRepo.create.mockReturnValue({
        id: mockAllocationId,
      } as any);
      budgetAllocationRepo.save.mockResolvedValue({
        id: mockAllocationId,
        ...dto,
      } as any);
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      budgetTransactionLogRepo.save.mockResolvedValue({} as any);

      const result = await service.createAllocation(
        mockTenantId,
        mockUserId,
        dto,
      );

      expect(result).toBeDefined();
      expect(budgetAllocationRepo.save).toHaveBeenCalled();
    });

    it('should throw error if no dimension specified', async () => {
      const dto = {
        periodType: PeriodType.MONTHLY,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        fiscalYear: 2025,
        onInvoiceBudget: 100000,
        offInvoiceBudget: 50000,
      };

      await expect(
        service.createAllocation(mockTenantId, mockUserId, dto),
      ).rejects.toThrow('At least one dimension');
    });

    it('should throw error if overlapping allocation exists', async () => {
      const dto = {
        periodType: PeriodType.MONTHLY,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        fiscalYear: 2025,
        cplId: 'cpl-1',
        onInvoiceBudget: 100000,
        offInvoiceBudget: 50000,
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'existing' }]),
      };

      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      await expect(
        service.createAllocation(mockTenantId, mockUserId, dto),
      ).rejects.toThrow('already exists');
    });
  });

  describe('checkAvailability', () => {
    it('should return availability result with sufficient budget', async () => {
      const context: BudgetCheckContext = {
        cplId: 'cpl-1',
        channel: 'NKA',
        category: 'Dairy',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        estimatedOnInvoiceSpend: 50000,
        estimatedOffInvoiceSpend: 25000,
      };

      const mockAllocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 50000,
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockAllocation),
      };

      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      const result = await service.checkAvailability(mockTenantId, context);

      expect(result.onInvoiceSufficient).toBe(true);
      expect(result.offInvoiceSufficient).toBe(true);
      expect(result.onInvoiceShortfall).toBe(0);
      expect(result.offInvoiceShortfall).toBe(0);
    });

    it('should return availability result with insufficient budget', async () => {
      const context: BudgetCheckContext = {
        cplId: 'cpl-1',
        channel: 'NKA',
        category: 'Dairy',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        estimatedOnInvoiceSpend: 150000,
        estimatedOffInvoiceSpend: 75000,
      };

      const mockAllocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 50000,
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockAllocation),
      };

      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      const result = await service.checkAvailability(mockTenantId, context);

      expect(result.onInvoiceSufficient).toBe(false);
      expect(result.offInvoiceSufficient).toBe(false);
      expect(result.onInvoiceShortfall).toBe(50000);
      expect(result.offInvoiceShortfall).toBe(25000);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('reserveBudget', () => {
    it('should reserve budget for a plan', async () => {
      const amounts: SpendBreakdown = {
        skuId: 'sku-1',
        base: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        planned: {
          ltaOnInvoice: 10000,
          ltaOffInvoice: 5000,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 10000,
          totalOffInvoice: 5000,
          totalSpend: 15000,
        },
        incremental: {
          onInvoice: 10000,
          offInvoice: 5000,
          total: 15000,
        },
      };

      const mockPlan: Partial<Plan> = {
        id: mockPlanId,
        cplId: 'cpl-1',
        channel: { code: 'NKA' } as any,
        category: { code: 'Dairy' } as any,
        periodMonth: '2025-01',
      };

      const mockAllocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 50000,
        hardLimitMode: false,
      };

      planRepo.findOne.mockResolvedValue(mockPlan as Plan);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockAllocation),
      };

      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      budgetAllocationRepo.save.mockResolvedValue(
        mockAllocation as BudgetAllocation,
      );
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      budgetTransactionLogRepo.save.mockResolvedValue({} as any);

      await service.reserveBudget(
        mockTenantId,
        mockUserId,
        mockPlanId,
        amounts,
      );

      expect(budgetAllocationRepo.save).toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).toHaveBeenCalled();
    });
  });

  describe('commitBudget', () => {
    it('should commit reserved budget to utilized', async () => {
      const mockReservation: Partial<BudgetTransactionLog> = {
        id: 'tx-1',
        planId: mockPlanId,
        onInvoiceAmount: 10000,
        offInvoiceAmount: 5000,
        budgetAllocation: {
          id: mockAllocationId,
          onInvoiceReserved: 10000,
          onInvoiceUtilized: 0,
          offInvoiceReserved: 5000,
          offInvoiceUtilized: 0,
        } as BudgetAllocation,
      };

      // T-095: `commitBudget` issues TWO different `findOne` calls now — the
      // RESERVATION lookup (`{ tenantId, planId, transactionType }`) and the
      // idempotency read inside `createTransaction`
      // (`{ idempotencyKey, tenantId, deletedAt }`). One unconditional mock
      // answers both with the reservation row, so the second read sees "this
      // COMMIT already exists" and the write is skipped — the test fails against
      // correct production code. The two `where` shapes share no predicate and
      // cannot collide in production, so the mock has to look at what it is
      // handed.
      budgetTransactionLogRepo.findOne.mockImplementation((opts: any) =>
        Promise.resolve(
          opts?.where?.idempotencyKey
            ? null
            : (mockReservation as BudgetTransactionLog),
        ),
      );
      budgetAllocationRepo.save.mockResolvedValue({} as BudgetAllocation);
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      budgetTransactionLogRepo.save.mockResolvedValue({} as any);

      await service.commitBudget(mockTenantId, mockUserId, mockPlanId);

      expect(budgetAllocationRepo.save).toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).toHaveBeenCalled();
    });
  });

  /* ================================================================ *
   * T-091 — commitBudget: `+=` string-concatenation fix
   *
   * `allocation.onInvoiceUtilized` / `offInvoiceUtilized` load through
   * DecimalTransformer as NUMBERS. `reservation.onInvoiceAmount` /
   * `offInvoiceAmount` (budget_transaction_logs) load as NUMBERS too, as of
   * T-197/T-221 — `budget-transaction-log.entity.ts` now declares
   * `transformer: MoneyTransformer` on both columns (was: no transformer,
   * STRINGS; see `mockReservation`'s own comment below for the fixture-side
   * correction). Under the ORIGINAL code — before either fix —
   * `allocation.onInvoiceUtilized += reservation.onInvoiceAmount` was string
   * concatenation, not addition; today `commitBudget` does not rely on the
   * column type either way, converting through
   * `moneyFromNumericString(String(reservation.onInvoiceAmount))` first.
   *
   * A SINGLE commit against a zero baseline hides the ORIGINAL defect
   * (`0 + "100.00" -> "0100.00" -> Number(...)` happens to read back as 100).
   * These tests start from a NON-ZERO baseline and run TWO CONSECUTIVE
   * commits — the shape in which the defect cannot hide — and assert on
   * what was actually handed to `budgetAllocationRepository.save()` on each
   * call (a snapshot captured at save time), i.e. what would have been
   * persisted, not a value read later off the mutated live object.
   * ================================================================ */
  describe('commitBudget — T-091 (accumulator string-concat fix)', () => {
    function makeAllocation(): BudgetAllocation {
      return {
        id: mockAllocationId,
        onInvoiceUtilized: 500,
        onInvoiceReserved: 300,
        offInvoiceUtilized: 200,
        offInvoiceReserved: 150,
      } as BudgetAllocation;
    }

    /**
     * `onInvoiceAmount`/`offInvoiceAmount` were typed `number` on
     * `BudgetTransactionLog` while the column carried NO transformer, so the
     * pg driver returned STRINGS at runtime and this fixture matched that
     * (T-091 task note; mirrored the T-089/T-080 lesson documented in
     * spend-validation.service.spec.ts).
     *
     * ⚠️ STALE AS OF T-197/T-221 (review, 2026-08-15): `budget-transaction-log.entity.ts`
     * now declares `transformer: MoneyTransformer` on both columns, so TypeORM's
     * `.from()` ALWAYS returns a `number` here — a string can no longer reach this
     * point through the repository. Passing a string kept the fixture testing a
     * shape production cannot produce (§2.7 mock-drift: "the mock, not the
     * assertion, had drifted from the type it mimics").
     *
     * The fixture now takes `number`, matching what TypeORM actually hands back.
     * This does NOT remove coverage of the original string-concatenation defect
     * class: `commitBudget` still converts every amount through
     * `moneyFromNumericString(String(reservation.onInvoiceAmount))` before
     * accumulating (`budget-allocation.service.ts`) rather than trusting the
     * column type, and that conversion's string-parsing path is covered directly
     * by `moneyFromNumericString`'s own suite
     * (`src/common/numeric/numeric.property.spec.ts`). What THIS test still
     * verifies — and is the reason it exists — is unchanged: that TWO
     * CONSECUTIVE commits accumulate numerically rather than hiding a
     * regression the way a single commit against a zero baseline would.
     */
    function mockReservation(
      planId: string,
      allocation: BudgetAllocation,
      onInvoiceAmount: number,
      offInvoiceAmount: number,
    ): BudgetTransactionLog {
      return {
        id: `tx-${planId}`,
        planId,
        onInvoiceAmount,
        offInvoiceAmount,
        budgetAllocation: allocation,
      } as unknown as BudgetTransactionLog;
    }

    async function runTwoConsecutiveCommits(): Promise<BudgetAllocation[]> {
      const allocation = makeAllocation();
      const savedSnapshots: BudgetAllocation[] = [];
      budgetAllocationRepo.save.mockImplementation(async (a: any) => {
        savedSnapshots.push({ ...a });
        return a;
      });
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      budgetTransactionLogRepo.save.mockResolvedValue({} as any);

      budgetTransactionLogRepo.findOne.mockResolvedValueOnce(
        mockReservation('plan-a', allocation, 100.0, 40.0),
      );
      await service.commitBudget(mockTenantId, mockUserId, 'plan-a');

      budgetTransactionLogRepo.findOne.mockResolvedValueOnce(
        mockReservation('plan-b', allocation, 75.5, 10.25),
      );
      await service.commitBudget(mockTenantId, mockUserId, 'plan-b');

      return savedSnapshots;
    }

    it('onInvoiceUtilized: accumulates correctly (as a NUMBER) across two consecutive commits, on the saved snapshot', async () => {
      const savedSnapshots = await runTwoConsecutiveCommits();

      expect(savedSnapshots).toHaveLength(2);
      // After commit 1: 500 + 100.00 = 600
      expect(savedSnapshots[0].onInvoiceUtilized).toBe(600);
      expect(typeof savedSnapshots[0].onInvoiceUtilized).toBe('number');
      // After commit 2: 600 + 75.50 = 675.5 — not "6000100.0075.50" -> NaN.
      expect(savedSnapshots[1].onInvoiceUtilized).toBe(675.5);
      expect(typeof savedSnapshots[1].onInvoiceUtilized).toBe('number');
      expect(Number.isNaN(savedSnapshots[1].onInvoiceUtilized)).toBe(false);
    });

    it('offInvoiceUtilized: accumulates correctly (as a NUMBER) across two consecutive commits, on the saved snapshot', async () => {
      const savedSnapshots = await runTwoConsecutiveCommits();

      expect(savedSnapshots).toHaveLength(2);
      // After commit 1: 200 + 40.00 = 240
      expect(savedSnapshots[0].offInvoiceUtilized).toBe(240);
      expect(typeof savedSnapshots[0].offInvoiceUtilized).toBe('number');
      // After commit 2: 240 + 10.25 = 250.25 — not a concatenated string.
      expect(savedSnapshots[1].offInvoiceUtilized).toBe(250.25);
      expect(typeof savedSnapshots[1].offInvoiceUtilized).toBe('number');
      expect(Number.isNaN(savedSnapshots[1].offInvoiceUtilized)).toBe(false);
    });

    it('onInvoiceReserved / offInvoiceReserved: the `-=` side (already correct pre-fix) still moves in lockstep with the shared conversion', async () => {
      const savedSnapshots = await runTwoConsecutiveCommits();

      // After commit 1: reserved 300 - 100.00 = 200; 150 - 40.00 = 110
      expect(savedSnapshots[0].onInvoiceReserved).toBe(200);
      expect(savedSnapshots[0].offInvoiceReserved).toBe(110);
      // After commit 2: 200 - 75.50 = 124.5; 110 - 10.25 = 99.75
      expect(savedSnapshots[1].onInvoiceReserved).toBe(124.5);
      expect(savedSnapshots[1].offInvoiceReserved).toBe(99.75);
    });
  });

  /* ================================================================ *
   * T-221 — commitBudget(): pin the `String()` + moneyFromNumericString`
   * conversion (budget-allocation.service.ts:523-528) ITSELF, independent
   * of what `budget_transaction_logs` produces today.
   *
   * The T-091 block above now feeds NUMBER reservation amounts, because
   * that is what `BudgetTransactionLog.onInvoiceAmount`/`offInvoiceAmount`
   * actually deliver today (`MoneyTransformer`, as of T-197/T-221 — see the
   * doc comment on the conversion block in the service). A mutation that
   * replaces the conversion with a raw passthrough
   * (`reservation.onInvoiceAmount as unknown as number`) is INVISIBLE to
   * T-091's number fixtures: for a finite number, `x` and
   * `moneyToMajorUnits(moneyFromNumericString(String(x)))` agree, so `+=`
   * and `-=` behave identically either way. Measured independently
   * (review, 2026-08-15): T-091's three tests all stayed green under that
   * exact mutation, and only the unrelated `T-094` "commits normally …
   * (owning) tenantId" test (which happens to still use string fixtures)
   * caught it.
   *
   * The service's own doc comment on that block says the wrapping is kept
   * DELIBERATELY, "so it stays safe if a future column on this path ever
   * loses its transformer" — i.e. STRING input is a supported contract, not
   * a stale assumption. This block pins that contract directly, with its
   * own two-consecutive-commits, non-zero-baseline shape (T-091's own
   * reasoning: a single commit against a zero baseline hides
   * `0 + "100.00" -> "0100.00" -> Number(...)` reading back as 100 by
   * accident), so the conversion cannot be quietly deleted without a test
   * noticing — kept separate from T-091 so neither block can be
   * "simplified" into the other without losing what it pins.
   * ================================================================ */
  describe('commitBudget — T-221 (String() conversion contract, string reservation amounts)', () => {
    function makeAllocation(): BudgetAllocation {
      return {
        id: mockAllocationId,
        onInvoiceUtilized: 500,
        onInvoiceReserved: 300,
        offInvoiceUtilized: 200,
        offInvoiceReserved: 150,
      } as BudgetAllocation;
    }

    function mockStringReservation(
      planId: string,
      allocation: BudgetAllocation,
      onInvoiceAmount: string,
      offInvoiceAmount: string,
    ): BudgetTransactionLog {
      return {
        id: `tx-${planId}`,
        planId,
        onInvoiceAmount: onInvoiceAmount as unknown as number,
        offInvoiceAmount: offInvoiceAmount as unknown as number,
        budgetAllocation: allocation,
      } as unknown as BudgetTransactionLog;
    }

    it('accumulates numerically (as a NUMBER, not by string concatenation) across two consecutive commits, on the saved snapshot, when reservation.onInvoiceAmount/offInvoiceAmount arrive as STRINGS', async () => {
      const allocation = makeAllocation();
      const savedSnapshots: BudgetAllocation[] = [];
      budgetAllocationRepo.save.mockImplementation(async (a: any) => {
        savedSnapshots.push({ ...a });
        return a;
      });
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      budgetTransactionLogRepo.save.mockResolvedValue({} as any);

      budgetTransactionLogRepo.findOne.mockResolvedValueOnce(
        mockStringReservation('plan-a', allocation, '100.00', '40.00'),
      );
      await service.commitBudget(mockTenantId, mockUserId, 'plan-a');

      budgetTransactionLogRepo.findOne.mockResolvedValueOnce(
        mockStringReservation('plan-b', allocation, '75.50', '10.25'),
      );
      await service.commitBudget(mockTenantId, mockUserId, 'plan-b');

      expect(savedSnapshots).toHaveLength(2);

      // After commit 1: 500 + "100.00" = 600, not "500100.00".
      expect(savedSnapshots[0].onInvoiceUtilized).toBe(600);
      expect(typeof savedSnapshots[0].onInvoiceUtilized).toBe('number');
      // After commit 2: 600 + "75.50" = 675.5, not a concatenated string.
      expect(savedSnapshots[1].onInvoiceUtilized).toBe(675.5);
      expect(typeof savedSnapshots[1].onInvoiceUtilized).toBe('number');
      expect(Number.isNaN(savedSnapshots[1].onInvoiceUtilized)).toBe(false);

      // After commit 1: 200 + "40.00" = 240.
      expect(savedSnapshots[0].offInvoiceUtilized).toBe(240);
      expect(typeof savedSnapshots[0].offInvoiceUtilized).toBe('number');
      // After commit 2: 240 + "10.25" = 250.25.
      expect(savedSnapshots[1].offInvoiceUtilized).toBe(250.25);
      expect(typeof savedSnapshots[1].offInvoiceUtilized).toBe('number');
      expect(Number.isNaN(savedSnapshots[1].offInvoiceUtilized)).toBe(false);

      // The `-=` side, moving in lockstep with the shared conversion.
      expect(savedSnapshots[0].onInvoiceReserved).toBe(200);
      expect(savedSnapshots[0].offInvoiceReserved).toBe(110);
      expect(savedSnapshots[1].onInvoiceReserved).toBe(124.5);
      expect(savedSnapshots[1].offInvoiceReserved).toBe(99.75);
    });
  });

  /* ================================================================ *
   * T-094 — tenant isolation (INV-T-001)
   *
   * `commitBudget`, `releaseBudget`, `adjustUtilization` all received
   * `tenantId` as their first parameter but never put it in the
   * `budgetTransactionLogRepository.findOne` `where` clause — only
   * `planId` (+ `transactionType`) scoped the lookup. A caller passing
   * tenant B's id with tenant A's planId could still find and mutate
   * tenant A's reservation/commit row and its linked allocation.
   *
   * These tests do NOT use `mockResolvedValue`/`mockResolvedValueOnce`
   * (which return the fixture unconditionally, regardless of `where`).
   * Instead `findOne` is mocked to inspect `options.where` and return
   * `null` unless `tenantId` (and `planId`/`transactionType`) match the
   * fixture — i.e. the mock behaves like a real, tenant-scoped SQL
   * WHERE clause. Without this, the test would still pass after
   * reverting the `tenantId` predicate in the service, and prove
   * nothing (see task note: "bu testin can damarı budur").
   * ================================================================ */
  describe('tenant isolation — commitBudget / releaseBudget / adjustUtilization (T-094, INV-T-001)', () => {
    const tenantA = 'tenant-A';
    const tenantB = 'tenant-B';
    const crossTenantPlanId = 'plan-cross-tenant';

    function makeAllocationA(): BudgetAllocation {
      return {
        id: 'allocation-A',
        onInvoiceReserved: 300,
        onInvoiceUtilized: 500,
        offInvoiceReserved: 150,
        offInvoiceUtilized: 200,
      } as BudgetAllocation;
    }

    /**
     * Simulates a tenant-scoped repository: only returns the row when the
     * `where` clause passed by the service actually matches the fixture's
     * tenant (and the other predicates). This is what makes these tests
     * capable of failing if the `tenantId` predicate is removed from the
     * service query.
     */
    function mockTenantScopedFindOne(
      repo: any,
      row: any,
      expectedWhere: Record<string, unknown>,
    ) {
      repo.findOne.mockImplementation(async (options: any) => {
        const where = options?.where ?? {};
        const matches = Object.entries(expectedWhere).every(
          ([key, value]) => where[key] === value,
        );
        return matches ? row : null;
      });
    }

    describe('commitBudget', () => {
      it('does not commit tenant A budget when called with tenant B tenantId (row not found)', async () => {
        const allocationA = makeAllocationA();
        const reservationA = {
          id: 'tx-A',
          planId: crossTenantPlanId,
          onInvoiceAmount: '100.00' as unknown as number,
          offInvoiceAmount: '40.00' as unknown as number,
          budgetAllocation: allocationA,
        } as unknown as BudgetTransactionLog;

        mockTenantScopedFindOne(budgetTransactionLogRepo, reservationA, {
          tenantId: tenantA,
          planId: crossTenantPlanId,
          transactionType: BudgetTransactionType.RESERVATION,
        });

        await expect(
          service.commitBudget(tenantB, mockUserId, crossTenantPlanId),
        ).rejects.toThrow(NotFoundException);

        expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
        // A's allocation must be untouched.
        expect(allocationA.onInvoiceReserved).toBe(300);
        expect(allocationA.onInvoiceUtilized).toBe(500);
        expect(allocationA.offInvoiceReserved).toBe(150);
        expect(allocationA.offInvoiceUtilized).toBe(200);
      });

      it('commits normally when called with the correct (owning) tenantId', async () => {
        const allocationA = makeAllocationA();
        const reservationA = {
          id: 'tx-A',
          planId: crossTenantPlanId,
          onInvoiceAmount: '100.00' as unknown as number,
          offInvoiceAmount: '40.00' as unknown as number,
          budgetAllocation: allocationA,
        } as unknown as BudgetTransactionLog;

        mockTenantScopedFindOne(budgetTransactionLogRepo, reservationA, {
          tenantId: tenantA,
          planId: crossTenantPlanId,
          transactionType: BudgetTransactionType.RESERVATION,
        });
        budgetAllocationRepo.save.mockResolvedValue({} as BudgetAllocation);
        budgetTransactionLogRepo.create.mockReturnValue({} as any);
        budgetTransactionLogRepo.save.mockResolvedValue({} as any);

        await service.commitBudget(tenantA, mockUserId, crossTenantPlanId);

        expect(budgetAllocationRepo.save).toHaveBeenCalled();
        expect(allocationA.onInvoiceReserved).toBe(200);
        expect(allocationA.onInvoiceUtilized).toBe(600);
        expect(allocationA.offInvoiceReserved).toBe(110);
        expect(allocationA.offInvoiceUtilized).toBe(240);
      });
    });

    describe('releaseBudget', () => {
      it('does not release tenant A budget when called with tenant B tenantId (row not found, logs warning and returns)', async () => {
        const allocationA = makeAllocationA();
        const reservationA = {
          id: 'tx-A',
          planId: crossTenantPlanId,
          onInvoiceAmount: '100.00' as unknown as number,
          offInvoiceAmount: '40.00' as unknown as number,
          budgetAllocation: allocationA,
        } as unknown as BudgetTransactionLog;

        mockTenantScopedFindOne(budgetTransactionLogRepo, reservationA, {
          tenantId: tenantA,
          planId: crossTenantPlanId,
          transactionType: BudgetTransactionType.RESERVATION,
        });
        const warnSpy = jest
          .spyOn((service as any).logger, 'warn')
          .mockImplementation(() => undefined);

        await expect(
          service.releaseBudget(tenantB, mockUserId, crossTenantPlanId),
        ).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalled();
        expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
        expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();
        // A's allocation must be untouched.
        expect(allocationA.onInvoiceReserved).toBe(300);
        expect(allocationA.offInvoiceReserved).toBe(150);
      });

      it('releases normally when called with the correct (owning) tenantId', async () => {
        const allocationA = makeAllocationA();
        const reservationA = {
          id: 'tx-A',
          planId: crossTenantPlanId,
          onInvoiceAmount: '100.00' as unknown as number,
          offInvoiceAmount: '40.00' as unknown as number,
          budgetAllocation: allocationA,
        } as unknown as BudgetTransactionLog;

        mockTenantScopedFindOne(budgetTransactionLogRepo, reservationA, {
          tenantId: tenantA,
          planId: crossTenantPlanId,
          transactionType: BudgetTransactionType.RESERVATION,
        });
        budgetAllocationRepo.save.mockResolvedValue({} as BudgetAllocation);
        budgetTransactionLogRepo.create.mockReturnValue({} as any);
        budgetTransactionLogRepo.save.mockResolvedValue({} as any);

        await service.releaseBudget(tenantA, mockUserId, crossTenantPlanId);

        expect(budgetAllocationRepo.save).toHaveBeenCalled();
        expect(allocationA.onInvoiceReserved).toBe(200);
        expect(allocationA.offInvoiceReserved).toBe(110);
      });
    });

    describe('adjustUtilization', () => {
      const newAmounts: SpendBreakdown = {
        skuId: 'sku-1',
        base: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        planned: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 120,
          totalOffInvoice: 45,
          totalSpend: 165,
        },
        incremental: {
          onInvoice: 120,
          offInvoice: 45,
          total: 165,
        },
      } as SpendBreakdown;

      it('does not adjust tenant A budget when called with tenant B tenantId (row not found)', async () => {
        const allocationA = makeAllocationA();
        const commitA = {
          id: 'tx-commit-A',
          planId: crossTenantPlanId,
          onInvoiceAmount: '100.00' as unknown as number,
          offInvoiceAmount: '40.00' as unknown as number,
          budgetAllocation: allocationA,
        } as unknown as BudgetTransactionLog;

        mockTenantScopedFindOne(budgetTransactionLogRepo, commitA, {
          tenantId: tenantA,
          planId: crossTenantPlanId,
          transactionType: BudgetTransactionType.COMMIT,
        });

        await expect(
          service.adjustUtilization(
            tenantB,
            mockUserId,
            crossTenantPlanId,
            newAmounts,
            'revision',
          ),
        ).rejects.toThrow(NotFoundException);

        expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
        // A's allocation must be untouched.
        expect(allocationA.onInvoiceUtilized).toBe(500);
        expect(allocationA.offInvoiceUtilized).toBe(200);
      });

      it('adjusts normally when called with the correct (owning) tenantId', async () => {
        const allocationA = makeAllocationA();
        const commitA = {
          id: 'tx-commit-A',
          planId: crossTenantPlanId,
          onInvoiceAmount: '100.00' as unknown as number,
          offInvoiceAmount: '40.00' as unknown as number,
          budgetAllocation: allocationA,
        } as unknown as BudgetTransactionLog;

        mockTenantScopedFindOne(budgetTransactionLogRepo, commitA, {
          tenantId: tenantA,
          planId: crossTenantPlanId,
          transactionType: BudgetTransactionType.COMMIT,
        });
        budgetAllocationRepo.save.mockResolvedValue({} as BudgetAllocation);
        budgetTransactionLogRepo.create.mockReturnValue({} as any);
        budgetTransactionLogRepo.save.mockResolvedValue({} as any);

        await service.adjustUtilization(
          tenantA,
          mockUserId,
          crossTenantPlanId,
          newAmounts,
          'revision',
        );

        expect(budgetAllocationRepo.save).toHaveBeenCalled();
        // onInvoiceDiff = 120 - 100 = 20 -> 500 + 20 = 520
        expect(allocationA.onInvoiceUtilized).toBe(520);
        // offInvoiceDiff = 45 - 40 = 5 -> 200 + 5 = 205
        expect(allocationA.offInvoiceUtilized).toBe(205);
      });
    });
  });

  /* ================================================================ *
   * T-096/2 — fault injection: the transaction wrap must actually carry
   * the failure, not just look like it does.
   *
   * A green suite without this proves nothing on its own ("it never
   * throws" and "it's correctly wrapped" look identical from outside).
   * These tests make the log write inside `createTransaction` fail and
   * check two things per method:
   *   1. the error is NOT swallowed — it propagates out of the service
   *      method to the caller (a mocked `DataSource.transaction` cannot
   *      demonstrate a real ROLLBACK, but it CAN demonstrate that the
   *      exception is not caught anywhere between the failing write and
   *      the caller — which is the precondition for a real transaction
   *      to roll back at all);
   *   2. which repo.save calls were actually reached before the throw —
   *      this differs by write order and is the part worth asserting,
   *      because it is the part that regresses silently if someone
   *      "simplifies" the transaction wrapper back into two calls.
   *
   * The injected error mirrors a real one: T-096/1 fixed a duplicate
   * column mapping (Postgres 42701) that could surface exactly as a log
   * write failing after the balance write had already gone through.
   * ================================================================ */
  describe('T-096/2 — transaction wrap: fault injection proves rollback boundary, not just green tests', () => {
    const simulatedDbError = () =>
      new Error('duplicate column mapping for "amount" (42701)');

    it('reserveBudget (save -> log order): log write fails inside the transaction -> the balance save has ALREADY been issued (it would be rolled back by a real DB transaction; the mock cannot show the rollback itself, only that save was reached before the throw) and the error is not swallowed', async () => {
      const amounts: SpendBreakdown = {
        skuId: 'sku-1',
        base: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        planned: {
          ltaOnInvoice: 10000,
          ltaOffInvoice: 5000,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 10000,
          totalOffInvoice: 5000,
          totalSpend: 15000,
        },
        incremental: {
          onInvoice: 10000,
          offInvoice: 5000,
          total: 15000,
        },
      };

      const mockPlan: Partial<Plan> = {
        id: mockPlanId,
        cplId: 'cpl-1',
        channel: { code: 'NKA' } as any,
        category: { code: 'Dairy' } as any,
        periodMonth: '2025-01',
      };

      const mockAllocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 50000,
        hardLimitMode: false,
        onInvoiceReserved: 0,
        offInvoiceReserved: 0,
      };

      planRepo.findOne.mockResolvedValue(mockPlan as Plan);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockAllocation),
      };
      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      budgetAllocationRepo.save.mockResolvedValue(
        mockAllocation as BudgetAllocation,
      );
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      // The fault: the log write inside the SAME transaction fails.
      budgetTransactionLogRepo.save.mockRejectedValue(simulatedDbError());

      await expect(
        service.reserveBudget(mockTenantId, mockUserId, mockPlanId, amounts),
      ).rejects.toThrow(/42701/);

      // Failure signature for save -> log: balance save WAS called before
      // the throw escaped the transaction callback.
      expect(budgetAllocationRepo.save).toHaveBeenCalledTimes(1);
      expect(budgetTransactionLogRepo.save).toHaveBeenCalledTimes(1);
    });

    it('updateAllocation: an ADJUSTMENT log failure inside the transaction propagates rather than being swallowed (T-096/3 reordered this method to save -> log; the previous assertion pinned an intermediate state a transaction makes unobservable)', async () => {
      const allocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        tenantId: mockTenantId,
        onInvoiceBudget: 100000,
        offInvoiceBudget: 50000,
        onInvoiceUtilized: 0,
        onInvoiceReserved: 0,
        offInvoiceUtilized: 0,
        offInvoiceReserved: 0,
      };

      budgetAllocationRepo.findOne.mockResolvedValue(
        allocation as BudgetAllocation,
      );
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      // The fault: the ADJUSTMENT log write fails.
      budgetTransactionLogRepo.save.mockRejectedValue(simulatedDbError());

      await expect(
        service.updateAllocation(mockTenantId, mockUserId, mockAllocationId, {
          onInvoiceBudget: 150000, // adjustment = 150000 - 100000 = 50000 !== 0
        }),
      ).rejects.toThrow(/42701/);

      // T-096/3: this assertion USED TO READ `budgetAllocationRepo.save` was
      // never called, because the log ran first. The reorder inverted that, and
      // this test is the only thing in the suite that noticed — which is the
      // point worth recording: what it was pinning is an INTERMEDIATE state, and
      // an intermediate state inside a transaction is not observable. Either
      // both writes land or neither does, whatever their order. The reorder is
      // behaviourally neutral and this assertion had been describing an
      // implementation detail rather than a contract.
      //
      // What still matters, and is asserted below: the error propagates rather
      // than being swallowed, and the log write was attempted exactly once.
      expect(budgetTransactionLogRepo.save).toHaveBeenCalledTimes(1);
      expect(budgetAllocationRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  /* ================================================================ *
   * T-096/2 — manager routing: proves the wrap is not a no-op.
   *
   * The default mock in this file routes `m.getRepository(...)` to the
   * SAME injected repo mocks the service also holds directly, which is
   * correct for exercising the transactional code path but, by itself,
   * cannot distinguish "the manager was used" from "the manager was
   * ignored and the default-connection repo was used instead" — both
   * would show the same calls on the same mock objects.
   *
   * This test swaps in a `DataSource.transaction` implementation that
   * hands the callback a manager with its OWN distinct repo doubles, then
   * asserts writes landed on those doubles and NOT on the service's
   * directly-injected repos. That is the only way to show `manager` is
   * actually threaded through `createTransaction` rather than merely
   * accepted and dropped.
   * ================================================================ */
  describe('T-096/2 — manager routing: transaction writes go through the callback manager, not the default-connection repository', () => {
    it('createAllocation: log write uses manager.getRepository(BudgetTransactionLog) / manager.getRepository(BudgetAllocation), never the directly-injected default repos', async () => {
      const dto = {
        periodType: PeriodType.MONTHLY,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        fiscalYear: 2025,
        cplId: 'cpl-1',
        onInvoiceBudget: 100000,
        offInvoiceBudget: 50000,
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      budgetAllocationRepo.create.mockReturnValue({
        id: mockAllocationId,
      } as any);

      const distinctAllocationRepo = {
        save: jest.fn().mockResolvedValue({ id: mockAllocationId }),
      };
      const distinctLogRepo = {
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
        // T-095: `createTransaction` now reads by idempotency key before
        // writing. A stub without `findOne` throws `not a function` — the
        // routing assertion would fail for a reason unrelated to routing.
        // `null` = "no row yet", so the write proceeds and routing is what the
        // test actually observes.
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockManager = {
        getRepository: jest.fn((entity: any) =>
          entity === BudgetAllocation ? distinctAllocationRepo : distinctLogRepo,
        ),
      };
      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((cb: any) => cb(mockManager));

      await service.createAllocation(mockTenantId, mockUserId, dto);

      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetAllocation,
      );
      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetTransactionLog,
      );
      expect(distinctAllocationRepo.save).toHaveBeenCalledTimes(1);
      expect(distinctLogRepo.save).toHaveBeenCalledTimes(1);

      // Proof the wrap is not a no-op: the directly-injected default repos
      // (what the pre-fix code would have used) were NOT touched.
      expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();
    });

    it('reserveBudget: balance save + RESERVATION log use manager.getRepository(...), never the directly-injected default repos — proves it writes through the manager, not the default connection', async () => {
      const amounts: SpendBreakdown = {
        skuId: 'sku-1',
        base: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        planned: {
          ltaOnInvoice: 10000,
          ltaOffInvoice: 5000,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 10000,
          totalOffInvoice: 5000,
          totalSpend: 15000,
        },
        incremental: {
          onInvoice: 10000,
          offInvoice: 5000,
          total: 15000,
        },
      };

      const mockPlan: Partial<Plan> = {
        id: mockPlanId,
        cplId: 'cpl-1',
        channel: { code: 'NKA' } as any,
        category: { code: 'Dairy' } as any,
        periodMonth: '2025-01',
      };

      const mockAllocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 50000,
        hardLimitMode: false,
        onInvoiceReserved: 0,
        offInvoiceReserved: 0,
      };

      planRepo.findOne.mockResolvedValue(mockPlan as Plan);

      // findMatchingAllocation is called twice on this path (once directly,
      // once inside checkAvailability) — both are reads and go through the
      // default-connection query builder regardless of the transaction wrap;
      // that is expected and not what this test is checking.
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockAllocation),
      };
      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      const distinctAllocationRepo = {
        save: jest.fn().mockResolvedValue(mockAllocation),
      };
      const distinctLogRepo = {
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
        // T-095: `createTransaction` now reads by idempotency key before
        // writing. A stub without `findOne` throws `not a function` — the
        // routing assertion would fail for a reason unrelated to routing.
        // `null` = "no row yet", so the write proceeds and routing is what the
        // test actually observes.
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockManager = {
        getRepository: jest.fn((entity: any) =>
          entity === BudgetAllocation ? distinctAllocationRepo : distinctLogRepo,
        ),
      };
      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((cb: any) => cb(mockManager));

      await service.reserveBudget(
        mockTenantId,
        mockUserId,
        mockPlanId,
        amounts,
      );

      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetAllocation,
      );
      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetTransactionLog,
      );
      expect(distinctAllocationRepo.save).toHaveBeenCalledTimes(1);
      expect(distinctLogRepo.save).toHaveBeenCalledTimes(1);

      // Proof the wrap is not a no-op: the directly-injected default repos'
      // save() (what the pre-fix code would have used) were NOT touched.
      expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();
    });

    it('commitBudget: balance save + COMMIT log use manager.getRepository(...), never the directly-injected default repos — proves it writes through the manager, not the default connection', async () => {
      const mockReservation: Partial<BudgetTransactionLog> = {
        id: 'tx-1',
        planId: mockPlanId,
        onInvoiceAmount: 10000,
        offInvoiceAmount: 5000,
        budgetAllocation: {
          id: mockAllocationId,
          onInvoiceReserved: 10000,
          onInvoiceUtilized: 0,
          offInvoiceReserved: 5000,
          offInvoiceUtilized: 0,
        } as BudgetAllocation,
      };

      // This findOne is a read and stays on the default-connection repo
      // regardless of the transaction wrap — expected, not under test here.
      budgetTransactionLogRepo.findOne.mockResolvedValue(
        mockReservation as BudgetTransactionLog,
      );

      const distinctAllocationRepo = {
        save: jest.fn().mockResolvedValue({}),
      };
      const distinctLogRepo = {
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
        // T-095: `createTransaction` now reads by idempotency key before
        // writing. A stub without `findOne` throws `not a function` — the
        // routing assertion would fail for a reason unrelated to routing.
        // `null` = "no row yet", so the write proceeds and routing is what the
        // test actually observes.
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockManager = {
        getRepository: jest.fn((entity: any) =>
          entity === BudgetAllocation ? distinctAllocationRepo : distinctLogRepo,
        ),
      };
      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((cb: any) => cb(mockManager));

      await service.commitBudget(mockTenantId, mockUserId, mockPlanId);

      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetAllocation,
      );
      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetTransactionLog,
      );
      expect(distinctAllocationRepo.save).toHaveBeenCalledTimes(1);
      expect(distinctLogRepo.save).toHaveBeenCalledTimes(1);

      expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();
    });

    it('releaseBudget: balance save + RELEASE log use manager.getRepository(...), never the directly-injected default repos — proves it writes through the manager, not the default connection', async () => {
      const mockReservation: Partial<BudgetTransactionLog> = {
        id: 'tx-1',
        planId: mockPlanId,
        onInvoiceAmount: 10000,
        offInvoiceAmount: 5000,
        budgetAllocation: {
          id: mockAllocationId,
          onInvoiceReserved: 10000,
          offInvoiceReserved: 5000,
        } as BudgetAllocation,
      };

      budgetTransactionLogRepo.findOne.mockResolvedValue(
        mockReservation as BudgetTransactionLog,
      );

      const distinctAllocationRepo = {
        save: jest.fn().mockResolvedValue({}),
      };
      const distinctLogRepo = {
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
        // T-095: `createTransaction` now reads by idempotency key before
        // writing. A stub without `findOne` throws `not a function` — the
        // routing assertion would fail for a reason unrelated to routing.
        // `null` = "no row yet", so the write proceeds and routing is what the
        // test actually observes.
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockManager = {
        getRepository: jest.fn((entity: any) =>
          entity === BudgetAllocation ? distinctAllocationRepo : distinctLogRepo,
        ),
      };
      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((cb: any) => cb(mockManager));

      await service.releaseBudget(mockTenantId, mockUserId, mockPlanId);

      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetAllocation,
      );
      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetTransactionLog,
      );
      expect(distinctAllocationRepo.save).toHaveBeenCalledTimes(1);
      expect(distinctLogRepo.save).toHaveBeenCalledTimes(1);

      expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();
    });

    it('adjustUtilization: balance save + ADJUSTMENT log use manager.getRepository(...), never the directly-injected default repos — proves it writes through the manager, not the default connection', async () => {
      const newAmounts: SpendBreakdown = {
        skuId: 'sku-1',
        base: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        planned: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 120,
          totalOffInvoice: 45,
          totalSpend: 165,
        },
        incremental: {
          onInvoice: 120,
          offInvoice: 45,
          total: 165,
        },
      } as SpendBreakdown;

      const existingCommit: Partial<BudgetTransactionLog> = {
        id: 'tx-commit-1',
        planId: mockPlanId,
        onInvoiceAmount: 100,
        offInvoiceAmount: 40,
        budgetAllocation: {
          id: mockAllocationId,
          onInvoiceUtilized: 500,
          offInvoiceUtilized: 200,
        } as BudgetAllocation,
      };

      // This findOne is a read and stays on the default-connection repo
      // regardless of the transaction wrap — expected (T-094), not under
      // test here.
      budgetTransactionLogRepo.findOne.mockResolvedValue(
        existingCommit as BudgetTransactionLog,
      );

      const distinctAllocationRepo = {
        save: jest.fn().mockResolvedValue({}),
      };
      const distinctLogRepo = {
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
        // T-095: `createTransaction` now reads by idempotency key before
        // writing. A stub without `findOne` throws `not a function` — the
        // routing assertion would fail for a reason unrelated to routing.
        // `null` = "no row yet", so the write proceeds and routing is what the
        // test actually observes.
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockManager = {
        getRepository: jest.fn((entity: any) =>
          entity === BudgetAllocation ? distinctAllocationRepo : distinctLogRepo,
        ),
      };
      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((cb: any) => cb(mockManager));

      await service.adjustUtilization(
        mockTenantId,
        mockUserId,
        mockPlanId,
        newAmounts,
        'revision',
      );

      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetAllocation,
      );
      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetTransactionLog,
      );
      expect(distinctAllocationRepo.save).toHaveBeenCalledTimes(1);
      expect(distinctLogRepo.save).toHaveBeenCalledTimes(1);

      expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();
    });

    it('updateAllocation: BOTH ADJUSTMENT logs (on-invoice + off-invoice) and the final balance save use manager.getRepository(...), never the directly-injected default repos — proves it writes through the manager, not the default connection', async () => {
      const allocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        tenantId: mockTenantId,
        onInvoiceBudget: 100000,
        offInvoiceBudget: 50000,
        onInvoiceUtilized: 0,
        onInvoiceReserved: 0,
        offInvoiceUtilized: 0,
        offInvoiceReserved: 0,
      };

      // This findOne is a read and stays on the default-connection repo
      // regardless of the transaction wrap — expected, not under test here.
      budgetAllocationRepo.findOne.mockResolvedValue(
        allocation as BudgetAllocation,
      );

      const distinctAllocationRepo = {
        save: jest.fn().mockResolvedValue({}),
      };
      const distinctLogRepo = {
        create: jest.fn().mockReturnValue({}),
        save: jest.fn().mockResolvedValue({}),
        // T-095: `createTransaction` now reads by idempotency key before
        // writing. A stub without `findOne` throws `not a function` — the
        // routing assertion would fail for a reason unrelated to routing.
        // `null` = "no row yet", so the write proceeds and routing is what the
        // test actually observes.
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockManager = {
        getRepository: jest.fn((entity: any) =>
          entity === BudgetAllocation ? distinctAllocationRepo : distinctLogRepo,
        ),
      };
      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((cb: any) => cb(mockManager));

      // Both dimensions change (both non-zero adjustments) so BOTH
      // ADJUSTMENT logs are written, in addition to the final allocation
      // save — three writes in total, all of which must go through the
      // manager.
      await service.updateAllocation(mockTenantId, mockUserId, mockAllocationId, {
        onInvoiceBudget: 150000, // adjustment = 150000 - 100000 = 50000 !== 0
        offInvoiceBudget: 80000, // adjustment = 80000 - 50000 = 30000 !== 0
      });

      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetAllocation,
      );
      expect(mockManager.getRepository).toHaveBeenCalledWith(
        BudgetTransactionLog,
      );
      // Two ADJUSTMENT logs (on-invoice + off-invoice) + one final
      // allocation save.
      expect(distinctLogRepo.save).toHaveBeenCalledTimes(2);
      expect(distinctAllocationRepo.save).toHaveBeenCalledTimes(1);

      expect(budgetAllocationRepo.save).not.toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();
    });
  });

  /* ================================================================ *
   * T-095 — `createTransaction`'s read-before-write on the idempotency key
   * (budget-allocation.service.ts, `private createTransaction`, guarded by
   * `if (idempotencyKey)`). Partial UNIQUE index: migration
   * `1798000000000-AddPartialIdempotencyIndexToBudgetTransactionLogs.ts`
   * (`UNIQUE (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
   * is the DB-level backstop for the race this read cannot see; it has its
   * own, separate e2e proof against a real database
   * (test/budget-transaction-logs-idempotency.e2e-spec.ts) and is
   * deliberately NOT re-proven here.
   *
   * `createTransaction` is private and its return value is discarded by
   * every real caller (`reserveBudget`/`commitBudget`/`releaseBudget`/
   * `createAllocation`/`updateAllocation`/`adjustUtilization` all just
   * `await` it). These tests go through a PUBLIC method
   * (`reserveBudget`/`createAllocation`) as the task requires, and use
   * `jest.spyOn(service as any, 'createTransaction')` WITHOUT a mock
   * implementation (pass-through) purely to observe what the private
   * method actually returned on that call — the spy does not change
   * behaviour, it only makes an otherwise-discarded return value visible.
   *
   * MOCK SHAPE WARNING (from the task brief, repeated here because it is
   * the whole point of this block): `budgetTransactionLogRepo.findOne`
   * must genuinely inspect `where.idempotencyKey` / `where.tenantId`
   * against the fixture and return `null` on mismatch — the same shape as
   * the T-094 `mockTenantScopedFindOne` helper above. A mock that returns
   * the fixture row unconditionally would keep this whole block GREEN even
   * if the `if (idempotencyKey)` guard, or the read itself, were deleted
   * from the service — proving nothing (this is exactly the trap the T-096
   * fault-injection block above was written to avoid falling into again).
   * ================================================================ */
  describe('createTransaction — idempotency read-before-write (T-095)', () => {
    function mockIdempotencyScopedFindOne(
      repo: jest.Mocked<Repository<BudgetTransactionLog>>,
      row: BudgetTransactionLog,
      expectedKey: string,
      expectedTenantId: string,
    ) {
      repo.findOne.mockImplementation(async (options: any) => {
        const where = options?.where ?? {};
        if (
          where.idempotencyKey === expectedKey &&
          where.tenantId === expectedTenantId
        ) {
          return row;
        }
        return null;
      });
    }

    function reserveBudgetAmounts(): SpendBreakdown {
      return {
        skuId: 'sku-1',
        base: {
          ltaOnInvoice: 0,
          ltaOffInvoice: 0,
          totalOnInvoice: 0,
          totalOffInvoice: 0,
          totalSpend: 0,
        },
        planned: {
          ltaOnInvoice: 10000,
          ltaOffInvoice: 5000,
          promoOnInvoice: {},
          promoOffInvoice: {},
          totalPromoOnInvoice: 0,
          totalPromoOffInvoice: 0,
          totalOnInvoice: 10000,
          totalOffInvoice: 5000,
          totalSpend: 15000,
        },
        incremental: {
          onInvoice: 10000,
          offInvoice: 5000,
          total: 15000,
        },
      };
    }

    function stubReserveBudgetReads() {
      const mockPlan: Partial<Plan> = {
        id: mockPlanId,
        cplId: 'cpl-1',
        channel: { code: 'NKA' } as any,
        category: { code: 'Dairy' } as any,
        periodMonth: '2025-01',
      };
      const mockAllocation: Partial<BudgetAllocation> = {
        id: mockAllocationId,
        onInvoiceAvailable: 100000,
        offInvoiceAvailable: 50000,
        hardLimitMode: false,
        onInvoiceReserved: 0,
        offInvoiceReserved: 0,
      };

      planRepo.findOne.mockResolvedValue(mockPlan as Plan);
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockAllocation),
      };
      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      budgetAllocationRepo.save.mockResolvedValue(
        mockAllocation as BudgetAllocation,
      );
    }

    it('reserveBudget: existing row for (tenantId, idempotencyKey) short-circuits — the log repo\'s create/save are NEVER called, and the private write resolves to the EXISTING row (not a newly-created one)', async () => {
      stubReserveBudgetReads();

      const expectedKey = `RESERVE|PLAN|${mockPlanId}|${mockAllocationId}`;
      const existingRow = {
        id: 'existing-tx-1',
        idempotencyKey: expectedKey,
        tenantId: mockTenantId,
        budgetAllocationId: mockAllocationId,
        transactionType: BudgetTransactionType.RESERVATION,
        onInvoiceAmount: 10000,
        offInvoiceAmount: 5000,
      } as unknown as BudgetTransactionLog;

      mockIdempotencyScopedFindOne(
        budgetTransactionLogRepo,
        existingRow,
        expectedKey,
        mockTenantId,
      );

      const createTransactionSpy = jest.spyOn(
        service as any,
        'createTransaction',
      );

      await service.reserveBudget(
        mockTenantId,
        mockUserId,
        mockPlanId,
        reserveBudgetAmounts(),
      );

      // The read genuinely happened, scoped to (tenantId, idempotencyKey) — not
      // an unconditional stub that would pass even if the guard were removed.
      expect(budgetTransactionLogRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idempotencyKey: expectedKey,
            tenantId: mockTenantId,
            deletedAt: IsNull(),
          }),
        }),
      );

      // The short-circuit: no new log row is created or saved.
      expect(budgetTransactionLogRepo.create).not.toHaveBeenCalled();
      expect(budgetTransactionLogRepo.save).not.toHaveBeenCalled();

      // What the private write actually returned to its caller — the existing
      // row, not a fresh one. (The balance save itself is unconditional and
      // runs before this guard in reserveBudget — see the task's own note on
      // createTransaction; not this block's concern.)
      expect(createTransactionSpy).toHaveBeenCalledTimes(1);
      await expect(createTransactionSpy.mock.results[0].value).resolves.toBe(
        existingRow,
      );
    });

    it('reserveBudget: no existing row for (tenantId, idempotencyKey) — normal write path runs, log repo create+save ARE called, and the private write resolves to the newly-created row', async () => {
      stubReserveBudgetReads();

      const expectedKey = `RESERVE|PLAN|${mockPlanId}|${mockAllocationId}`;

      // Genuinely inspects the where clause (fails loudly if the service ever
      // stops passing idempotencyKey/tenantId here) and always returns null —
      // there is no existing row in this scenario.
      budgetTransactionLogRepo.findOne.mockImplementation(
        async (options: any) => {
          const where = options?.where ?? {};
          expect(where.idempotencyKey).toBe(expectedKey);
          expect(where.tenantId).toBe(mockTenantId);
          return null;
        },
      );

      const createdRow = { id: 'new-tx-1' } as unknown as BudgetTransactionLog;
      budgetTransactionLogRepo.create.mockReturnValue(createdRow as any);
      budgetTransactionLogRepo.save.mockResolvedValue(createdRow as any);

      const createTransactionSpy = jest.spyOn(
        service as any,
        'createTransaction',
      );

      await service.reserveBudget(
        mockTenantId,
        mockUserId,
        mockPlanId,
        reserveBudgetAmounts(),
      );

      expect(budgetTransactionLogRepo.findOne).toHaveBeenCalledTimes(1);
      expect(budgetTransactionLogRepo.create).toHaveBeenCalledTimes(1);
      expect(budgetTransactionLogRepo.save).toHaveBeenCalledTimes(1);

      expect(createTransactionSpy).toHaveBeenCalledTimes(1);
      await expect(createTransactionSpy.mock.results[0].value).resolves.toBe(
        createdRow,
      );
    });

    it('createAllocation (ALLOCATION type, no idempotency key passed): the idempotency read is skipped entirely — `if (idempotencyKey)` guard, same reason the partial index exists (ALLOCATION/ADJUSTMENT rows legitimately carry no key)', async () => {
      const dto = {
        periodType: PeriodType.MONTHLY,
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        fiscalYear: 2025,
        cplId: 'cpl-1',
        onInvoiceBudget: 100000,
        offInvoiceBudget: 50000,
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      budgetAllocationRepo.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      budgetAllocationRepo.create.mockReturnValue({
        id: mockAllocationId,
      } as any);
      budgetAllocationRepo.save.mockResolvedValue({
        id: mockAllocationId,
        ...dto,
      } as any);
      budgetTransactionLogRepo.create.mockReturnValue({} as any);
      budgetTransactionLogRepo.save.mockResolvedValue({} as any);

      await service.createAllocation(mockTenantId, mockUserId, dto);

      // The can't-hide assertion: if the `if (idempotencyKey)` guard were ever
      // removed (read runs unconditionally with idempotencyKey === undefined),
      // this would flip to `toHaveBeenCalled()`.
      expect(budgetTransactionLogRepo.findOne).not.toHaveBeenCalled();

      // The write itself still happens normally — only the READ is skipped.
      expect(budgetTransactionLogRepo.create).toHaveBeenCalledTimes(1);
      expect(budgetTransactionLogRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
