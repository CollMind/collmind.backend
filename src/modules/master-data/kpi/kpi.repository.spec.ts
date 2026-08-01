import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { KpiRepository } from './kpi.repository';
import { Kpi } from '../../../database/entities/kpi.entity';
import { STALE_VERSION_CODE } from '../../shared/persistence/versioned-update.helper';

/**
 * T-039 — Layer 2 (parametric): does `KpiRepository#updateVersioned`
 * actually route through the CAS predicate (`applyVersionedUpdate`,
 * shared with T-034), and does the deliberate additive-rollout bypass
 * (`#updateUnversioned`, used when the caller omits `version`) skip the
 * check while still bumping the stored version? See the T-039 task report
 * for the companion mutation-proof (temporarily removing
 * `AND version = :expected` from `versioned-update.helper.ts` and
 * confirming this suite goes red).
 */
describe('KpiRepository — T-039 optimistic locking (CAS)', () => {
  let repo: KpiRepository;
  let kpiRepoMock: { update: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    kpiRepoMock = { update: jest.fn(), findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KpiRepository,
        { provide: getRepositoryToken(Kpi), useValue: kpiRepoMock },
      ],
    }).compile();

    repo = module.get(KpiRepository);
  });

  describe('updateVersioned', () => {
    it('writes a single conditional UPDATE (id + tenantId + version predicate, version bump in SET)', async () => {
      kpiRepoMock.update.mockResolvedValue({ affected: 1 });
      kpiRepoMock.findOne.mockResolvedValue({
        id: 'kpi-1',
        tenantId: 'tenant-1',
        version: 6,
      } as Kpi);

      await repo.updateVersioned('tenant-1', 'kpi-1', 5, {
        formulaText: 'PLAN_VOL * 2',
      });

      expect(kpiRepoMock.update).toHaveBeenCalledWith(
        { id: 'kpi-1', tenantId: 'tenant-1', version: 5 },
        expect.objectContaining({
          formulaText: 'PLAN_VOL * 2',
          version: expect.any(Function),
        }),
      );
    });

    it('affected=1 -> returns the updated row (no exception)', async () => {
      kpiRepoMock.update.mockResolvedValue({ affected: 1 });
      kpiRepoMock.findOne.mockResolvedValue({
        id: 'kpi-1',
        tenantId: 'tenant-1',
        version: 6,
        formulaText: 'PLAN_VOL * 2',
      } as Kpi);

      const result = await repo.updateVersioned('tenant-1', 'kpi-1', 5, {
        formulaText: 'PLAN_VOL * 2',
      });

      expect(result.version).toBe(6);
      expect(result.formulaText).toBe('PLAN_VOL * 2');
    });

    it('affected=0 + row still exists -> ConflictException STALE_VERSION (not silently swallowed)', async () => {
      kpiRepoMock.update.mockResolvedValue({ affected: 0 });
      kpiRepoMock.findOne.mockResolvedValue({
        id: 'kpi-1',
        tenantId: 'tenant-1',
        version: 9,
        kpiCode: 'GP_ROI_PCT',
        formulaText: 'CURRENT_FORMULA',
      } as Kpi);

      const attempt = () =>
        repo.updateVersioned('tenant-1', 'kpi-1', 5, {
          formulaText: 'ATTEMPTED_FORMULA',
        });

      await expect(attempt()).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 409,
          code: STALE_VERSION_CODE,
          entity: 'KPI',
          expectedVersion: 5,
          currentVersion: 9,
        }),
      });
      await expect(attempt()).rejects.toBeInstanceOf(ConflictException);
    });

    it('affected=0 + row no longer exists -> NotFoundException (not 409)', async () => {
      kpiRepoMock.update.mockResolvedValue({ affected: 0 });
      kpiRepoMock.findOne.mockResolvedValue(null);

      await expect(
        repo.updateVersioned('tenant-1', 'kpi-1', 5, {
          formulaText: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateUnversioned — deliberate bypass (additive rollout: caller omitted `version`)', () => {
    it('writes WITHOUT a version predicate in the WHERE, but still bumps version in the SET', async () => {
      kpiRepoMock.update.mockResolvedValue({ affected: 1 });
      kpiRepoMock.findOne.mockResolvedValue({
        id: 'kpi-1',
        tenantId: 'tenant-1',
        version: 2,
      } as Kpi);

      await repo.updateUnversioned('tenant-1', 'kpi-1', {
        formulaText: 'PLAN_VOL * 3',
      });

      const [whereArg, setArg] = kpiRepoMock.update.mock.calls[0];
      expect(whereArg).toEqual({ id: 'kpi-1', tenantId: 'tenant-1' });
      expect(whereArg).not.toHaveProperty('version');
      expect(setArg).toEqual(
        expect.objectContaining({
          formulaText: 'PLAN_VOL * 3',
          version: expect.any(Function),
        }),
      );
    });

    it('never throws ConflictException, regardless of concurrent writes (no CAS enforced)', async () => {
      kpiRepoMock.update.mockResolvedValue({ affected: 1 });
      kpiRepoMock.findOne.mockResolvedValue({
        id: 'kpi-1',
        tenantId: 'tenant-1',
        version: 99,
      } as Kpi);

      await expect(
        repo.updateUnversioned('tenant-1', 'kpi-1', { isActive: false }),
      ).resolves.toBeDefined();
    });

    it('row not found -> NotFoundException', async () => {
      kpiRepoMock.update.mockResolvedValue({ affected: 0 });
      kpiRepoMock.findOne.mockResolvedValue(null);

      await expect(
        repo.updateUnversioned('tenant-1', 'missing-kpi', {
          isActive: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
