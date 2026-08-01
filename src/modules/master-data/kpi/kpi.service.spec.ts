import { Test, TestingModule } from '@nestjs/testing';
import { KpiService } from './kpi.service';
import { KpiRepository } from './kpi.repository';
import { PlanService } from '../../modes/planning-first/plan/plan.service';
import { KpiEngineService } from '../../shared/kpi-engine/kpi-engine.service';
import {
  Kpi,
  FormulaType,
  CalculationLevel,
  DisplayFormat,
} from '../../../database/entities/kpi.entity';

/**
 * T-039 — `KpiService#update` dispatch: does supplying `version` route
 * through the CAS write (`updateVersioned`), and does omitting it route
 * through the additive-rollout bypass (`updateUnversioned`) — never both,
 * never neither? And does every write path invalidate
 * `KpiEngineService`'s formula/threshold cache (the actual "dinamik formül"
 * bug this task fixes — `clearCache` had zero non-test callers before)?
 */
describe('KpiService — T-039 optimistic locking dispatch + cache invalidation', () => {
  let service: KpiService;
  let kpiRepository: jest.Mocked<KpiRepository>;
  let kpiEngineService: jest.Mocked<KpiEngineService>;

  const baseKpi: Kpi = {
    id: 'kpi-1',
    tenantId: 'tenant-1',
    kpiCode: 'TEST_KPI',
    kpiName: 'Test KPI',
    kpiGroup: 'Test',
    formulaType: FormulaType.EXPRESSION,
    formulaText: 'PLAN_VOL',
    calculationOrder: 4,
    calculationLevel: CalculationLevel.SKU,
    displayFormat: DisplayFormat.NUMBER,
    decimalPlaces: 2,
    showInGrid: false,
    isActive: true,
    version: 3,
  } as Kpi;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KpiService,
        {
          provide: KpiRepository,
          useValue: {
            findByCode: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
            updateVersioned: jest.fn(),
            updateUnversioned: jest.fn(),
          },
        },
        { provide: PlanService, useValue: { findById: jest.fn() } },
        {
          provide: KpiEngineService,
          useValue: { clearCache: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(KpiService);
    kpiRepository = module.get(KpiRepository);
    kpiEngineService = module.get(KpiEngineService);

    kpiRepository.findOne.mockResolvedValue({ ...baseKpi });
  });

  describe('update()', () => {
    it('version supplied -> calls updateVersioned (not updateUnversioned), strips `version` from the write payload', async () => {
      kpiRepository.updateVersioned.mockResolvedValue({
        ...baseKpi,
        version: 4,
        formulaText: 'PLAN_VOL * 2',
      });

      await service.update('tenant-1', 'kpi-1', {
        formulaText: 'PLAN_VOL * 2',
        version: 3,
      });

      expect(kpiRepository.updateVersioned).toHaveBeenCalledWith(
        'tenant-1',
        'kpi-1',
        3,
        expect.objectContaining({ formulaText: 'PLAN_VOL * 2' }),
      );
      expect(kpiRepository.updateVersioned).toHaveBeenCalledWith(
        'tenant-1',
        'kpi-1',
        3,
        expect.not.objectContaining({ version: expect.anything() }),
      );
      expect(kpiRepository.updateUnversioned).not.toHaveBeenCalled();
    });

    it('version omitted -> calls updateUnversioned (not updateVersioned) — additive rollout, frontend does not send `version` yet', async () => {
      kpiRepository.updateUnversioned.mockResolvedValue({
        ...baseKpi,
        version: 4,
        formulaText: 'PLAN_VOL * 3',
      });

      await service.update('tenant-1', 'kpi-1', {
        formulaText: 'PLAN_VOL * 3',
      });

      expect(kpiRepository.updateUnversioned).toHaveBeenCalledWith(
        'tenant-1',
        'kpi-1',
        expect.objectContaining({ formulaText: 'PLAN_VOL * 3' }),
      );
      expect(kpiRepository.updateVersioned).not.toHaveBeenCalled();
    });

    it('any successful update invalidates the KPI engine cache for the tenant (the dynamic-formula staleness fix)', async () => {
      kpiRepository.updateUnversioned.mockResolvedValue({
        ...baseKpi,
        version: 4,
      });

      await service.update('tenant-1', 'kpi-1', { isActive: false });

      expect(kpiEngineService.clearCache).toHaveBeenCalledWith('tenant-1');
    });

    it('a stale-version CAS rejection propagates without invalidating the cache (nothing was written)', async () => {
      const conflict = new Error('STALE_VERSION');
      kpiRepository.updateVersioned.mockRejectedValue(conflict);

      await expect(
        service.update('tenant-1', 'kpi-1', {
          formulaText: 'x',
          version: 1,
        }),
      ).rejects.toThrow(conflict);

      expect(kpiEngineService.clearCache).not.toHaveBeenCalled();
    });
  });

  describe('create() / remove() — also invalidate the engine cache', () => {
    it('create() clears the cache after a successful save', async () => {
      kpiRepository.findByCode.mockResolvedValue(null);
      kpiRepository.create.mockReturnValue({
        ...baseKpi,
        id: undefined,
      } as any);
      kpiRepository.save.mockResolvedValue({ ...baseKpi });

      await service.create('tenant-1', {
        kpiCode: 'NEW_KPI',
        kpiName: 'New KPI',
        kpiGroup: 'Test',
        formulaType: FormulaType.EXPRESSION,
        formulaText: 'PLAN_VOL',
        calculationOrder: 4,
        calculationLevel: CalculationLevel.SKU,
        displayFormat: DisplayFormat.NUMBER,
      });

      expect(kpiEngineService.clearCache).toHaveBeenCalledWith('tenant-1');
    });

    it('remove() clears the cache after a successful soft-delete', async () => {
      kpiRepository.softRemove.mockResolvedValue({ ...baseKpi });

      await service.remove('tenant-1', 'kpi-1');

      expect(kpiEngineService.clearCache).toHaveBeenCalledWith('tenant-1');
    });
  });
});
