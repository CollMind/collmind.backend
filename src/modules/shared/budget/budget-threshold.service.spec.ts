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

    // T-101: these two used to assert the same object, and that WAS the defect —
    // four different situations produced one indistinguishable result. The values
    // are still the defaults; what is new is that the caller can tell why.
    //
    // The camouflage was total: the seeded configuration holds exactly the
    // hardcoded defaults (80/95/100, measured in the live DB), so a fallback firing
    // and a configuration being read looked identical from every angle.
    it('reports no-configuration as such, not as a configured value', async () => {
      repo.find.mockResolvedValue([]);

      const t = await service.getThresholds(mockTenantId);

      expect(t).toEqual({
        warning: 80,
        critical: 95,
        exceeded: 100,
        source: 'default',
        reason: 'no-configuration',
      });
    });

    // `unavailable`, not `default`: "nothing is configured" and "we could not read
    // the configuration" are different facts, and merging them is the error-as-data
    // defect T-098 removed one layer up.
    it('reports a read failure as unavailable, distinct from no-configuration', async () => {
      repo.find.mockRejectedValue(new Error('DB error'));

      const t = await service.getThresholds(mockTenantId);

      expect(t.source).toBe('unavailable');
      expect(t.reason).toBe('read-failed');
      expect({ w: t.warning, c: t.critical, e: t.exceeded }).toEqual({
        w: 80,
        c: 95,
        e: 100,
      });
    });

    // A read failure is transient; caching it would stretch one bad moment across
    // the whole TTL and hide a recovery.
    it('does not cache a read failure', async () => {
      repo.find.mockRejectedValueOnce(new Error('DB error'));
      await service.getThresholds(mockTenantId);

      repo.find.mockResolvedValue([
        makeConfig(AlertLevel.WARNING_80, 60),
        makeConfig(AlertLevel.CRITICAL_95, 70),
        makeConfig(AlertLevel.EXCEEDED_100, 80),
      ]);
      const t = await service.getThresholds(mockTenantId);

      expect(t.source).toBe('config');
      expect(t.warning).toBe(60);
    });

    // T-101 (K3): all three from the configuration, or all three from the defaults.
    // The old code seeded with defaults and overwrote what it found, so this case
    // produced {60, 95, 100} — neither the configuration nor the defaults, and
    // marked as neither.
    it('does not mix a partial configuration with defaults', async () => {
      repo.find.mockResolvedValue([makeConfig(AlertLevel.WARNING_80, 60)]);

      const t = await service.getThresholds(mockTenantId);

      expect(t).toEqual({
        warning: 80,
        critical: 95,
        exceeded: 100,
        source: 'default',
        reason: 'partial-configuration',
      });
    });

    // The measured worst case: one invalid value used to leave
    // {warning: 80, critical: 70}, where 75% is RED without ever being AMBER —
    // an ordering no configuration could express.
    it('rejects the whole configuration when one value is invalid', async () => {
      repo.find.mockResolvedValue([
        makeConfig(AlertLevel.WARNING_80, 'abc' as unknown as number),
        makeConfig(AlertLevel.CRITICAL_95, 70),
        makeConfig(AlertLevel.EXCEEDED_100, 80),
      ]);

      const t = await service.getThresholds(mockTenantId);

      expect(t.reason).toBe('invalid-value');
      expect(t.warning).toBe(80);
      expect(t.critical).toBe(95);
    });

    // T-101 (K4). Every level is present and valid; only the ORDER is wrong.
    it('rejects a complete but unordered configuration', async () => {
      repo.find.mockResolvedValue([
        makeConfig(AlertLevel.WARNING_80, 90),
        makeConfig(AlertLevel.CRITICAL_95, 70),
        makeConfig(AlertLevel.EXCEEDED_100, 80),
      ]);

      const t = await service.getThresholds(mockTenantId);

      expect(t.reason).toBe('unordered');
      expect(t.source).toBe('default');
    });

    // There is no unique constraint on (tenant_id, alert_level) and no ORDER BY,
    // so "the last row wins" means "whichever Postgres returned last" — the same
    // request could resolve differently twice.
    it('refuses duplicate levels rather than letting one win arbitrarily', async () => {
      repo.find.mockResolvedValue([
        makeConfig(AlertLevel.WARNING_80, 60),
        makeConfig(AlertLevel.WARNING_80, 70),
        makeConfig(AlertLevel.CRITICAL_95, 80),
        makeConfig(AlertLevel.EXCEEDED_100, 90),
      ]);

      const t = await service.getThresholds(mockTenantId);

      expect(t.reason).toBe('duplicate-level');
      expect(t.source).toBe('default');
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
