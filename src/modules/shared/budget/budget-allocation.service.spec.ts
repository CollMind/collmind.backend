import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

      budgetTransactionLogRepo.findOne.mockResolvedValue(
        mockReservation as BudgetTransactionLog,
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
   * `offInvoiceAmount` (budget_transaction_logs, no transformer) load as
   * STRINGS. Under the old code `allocation.onInvoiceUtilized +=
   * reservation.onInvoiceAmount` was string concatenation, not addition.
   *
   * A SINGLE commit against a zero baseline hides this
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
     * `onInvoiceAmount`/`offInvoiceAmount` are typed `number` on
     * `BudgetTransactionLog`, but the column carries no transformer, so the
     * pg driver returns STRINGS at runtime. Passing a JS number here would
     * not exercise the defect this test exists to catch (T-091 task note;
     * mirrors the T-089/T-080 lesson already documented in
     * spend-validation.service.spec.ts).
     */
    function mockReservation(
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
        mockReservation('plan-a', allocation, '100.00', '40.00'),
      );
      await service.commitBudget(mockTenantId, mockUserId, 'plan-a');

      budgetTransactionLogRepo.findOne.mockResolvedValueOnce(
        mockReservation('plan-b', allocation, '75.50', '10.25'),
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
});
