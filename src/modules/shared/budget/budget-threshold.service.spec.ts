import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BudgetThresholdService } from './budget-threshold.service';
import {
  BudgetAlertConfiguration,
  AlertLevel,
  NotificationChannel,
} from '../../../database/entities/budget-alert-configuration.entity';
import { UtilizationStatus } from '../finance-reporting/dto/budget-utilization.dto';

describe('BudgetThresholdService', () => {
  let service: BudgetThresholdService;
  let repo: jest.Mocked<Repository<BudgetAlertConfiguration>>;

  const mockTenantId = 'tenant-1';

  const makeConfig = (
    alertLevel: AlertLevel,
    thresholdPercent: number,
  ): BudgetAlertConfiguration =>
    ({
      tenantId: mockTenantId,
      alertLevel,
      thresholdPercent,
      notificationChannels: [NotificationChannel.IN_APP],
      isActive: true,
    }) as BudgetAlertConfiguration;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetThresholdService,
        {
          provide: getRepositoryToken(BudgetAlertConfiguration),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BudgetThresholdService>(BudgetThresholdService);
    repo = module.get(getRepositoryToken(BudgetAlertConfiguration));

    // Invalidate cache before each test
    service.invalidateCache(mockTenantId);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.invalidateCache(mockTenantId);
  });

  // ─── getThresholds ──────────────────────────────────────────────────────────

  describe('getThresholds', () => {
    it('returns config-driven thresholds when rows exist', async () => {
      repo.find.mockResolvedValue([
        makeConfig(AlertLevel.WARNING_80, 80),
        makeConfig(AlertLevel.CRITICAL_95, 95),
        makeConfig(AlertLevel.EXCEEDED_100, 100),
      ]);

      const t = await service.getThresholds(mockTenantId);

      expect(t.warning).toBe(80);
      expect(t.critical).toBe(95);
      expect(t.exceeded).toBe(100);
    });

    it('falls back to {80, 95, 100} when no rows exist', async () => {
      repo.find.mockResolvedValue([]);

      const t = await service.getThresholds(mockTenantId);

      expect(t).toEqual({ warning: 80, critical: 95, exceeded: 100 });
    });

    it('falls back to defaults when DB throws', async () => {
      repo.find.mockRejectedValue(new Error('DB error'));

      const t = await service.getThresholds(mockTenantId);

      expect(t).toEqual({ warning: 80, critical: 95, exceeded: 100 });
    });

    it('returns cached value on second call without hitting DB again', async () => {
      repo.find.mockResolvedValue([
        makeConfig(AlertLevel.WARNING_80, 80),
        makeConfig(AlertLevel.CRITICAL_95, 95),
        makeConfig(AlertLevel.EXCEEDED_100, 100),
      ]);

      await service.getThresholds(mockTenantId);
      await service.getThresholds(mockTenantId);

      expect(repo.find).toHaveBeenCalledTimes(1);
    });

    it('uses custom threshold values when configured', async () => {
      repo.find.mockResolvedValue([
        makeConfig(AlertLevel.WARNING_80, 70),
        makeConfig(AlertLevel.CRITICAL_95, 90),
        makeConfig(AlertLevel.EXCEEDED_100, 105),
      ]);

      const t = await service.getThresholds(mockTenantId);

      expect(t.warning).toBe(70);
      expect(t.critical).toBe(90);
      expect(t.exceeded).toBe(105);
    });
  });

  // ─── toStatus ───────────────────────────────────────────────────────────────

  describe('toStatus — boundary conditions with default thresholds {80, 95, 100}', () => {
    const defaultT = { warning: 80, critical: 95, exceeded: 100 };

    it('79.9 → GREEN (below warning)', () => {
      expect(service.toStatus(79.9, defaultT)).toBe(UtilizationStatus.GREEN);
    });

    it('80 → AMBER (exactly at warning)', () => {
      expect(service.toStatus(80, defaultT)).toBe(UtilizationStatus.AMBER);
    });

    it('94.9 → AMBER (below critical)', () => {
      expect(service.toStatus(94.9, defaultT)).toBe(UtilizationStatus.AMBER);
    });

    it('95 → RED (exactly at critical)', () => {
      expect(service.toStatus(95, defaultT)).toBe(UtilizationStatus.RED);
    });

    it('99.9 → RED (above critical, below exceeded)', () => {
      expect(service.toStatus(99.9, defaultT)).toBe(UtilizationStatus.RED);
    });

    it('100 → RED (exactly at exceeded)', () => {
      expect(service.toStatus(100, defaultT)).toBe(UtilizationStatus.RED);
    });

    it('0 → GREEN', () => {
      expect(service.toStatus(0, defaultT)).toBe(UtilizationStatus.GREEN);
    });

    it('110 → RED (over budget)', () => {
      expect(service.toStatus(110, defaultT)).toBe(UtilizationStatus.RED);
    });
  });

  describe('toStatus — custom thresholds {70, 90, 105}', () => {
    const customT = { warning: 70, critical: 90, exceeded: 105 };

    it('69.9 → GREEN', () => {
      expect(service.toStatus(69.9, customT)).toBe(UtilizationStatus.GREEN);
    });

    it('70 → AMBER', () => {
      expect(service.toStatus(70, customT)).toBe(UtilizationStatus.AMBER);
    });

    it('89.9 → AMBER', () => {
      expect(service.toStatus(89.9, customT)).toBe(UtilizationStatus.AMBER);
    });

    it('90 → RED', () => {
      expect(service.toStatus(90, customT)).toBe(UtilizationStatus.RED);
    });
  });

  // ─── isExceeded ─────────────────────────────────────────────────────────────

  describe('isExceeded', () => {
    const defaultT = { warning: 80, critical: 95, exceeded: 100 };

    it('99.9 → false', () => {
      expect(service.isExceeded(99.9, defaultT)).toBe(false);
    });

    it('100 → true', () => {
      expect(service.isExceeded(100, defaultT)).toBe(true);
    });

    it('110 → true', () => {
      expect(service.isExceeded(110, defaultT)).toBe(true);
    });
  });

  // ─── Cross-tenant isolation ─────────────────────────────────────────────────

  describe('cross-tenant cache isolation', () => {
    it('caches thresholds per tenant independently', async () => {
      const tenantA = 'tenant-A';
      const tenantB = 'tenant-B';

      repo.find
        .mockResolvedValueOnce([
          makeConfig(AlertLevel.WARNING_80, 75),
          makeConfig(AlertLevel.CRITICAL_95, 90),
          makeConfig(AlertLevel.EXCEEDED_100, 100),
        ])
        .mockResolvedValueOnce([
          makeConfig(AlertLevel.WARNING_80, 80),
          makeConfig(AlertLevel.CRITICAL_95, 95),
          makeConfig(AlertLevel.EXCEEDED_100, 100),
        ]);

      service.invalidateCache(tenantA);
      service.invalidateCache(tenantB);

      const tA = await service.getThresholds(tenantA);
      const tB = await service.getThresholds(tenantB);

      expect(tA.warning).toBe(75);
      expect(tB.warning).toBe(80);
    });
  });
});
