import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgreementRepository } from './agreement.repository';
import { Agreement } from '../../../../database/entities/agreement.entity';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { STALE_VERSION_CODE } from '../../../shared/persistence/versioned-update.helper';

/**
 * T-034 — Layer 2 (parametric), Agreement side. Mirrors
 * plan.repository.spec.ts. See that file's header comment for the
 * companion "mutation kanıtı" step (temporarily drop the version predicate
 * from applyVersionedUpdate and confirm these go red).
 */
describe('AgreementRepository — T-034 optimistic locking (CAS)', () => {
  let repo: AgreementRepository;
  let repoMock: { update: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    repoMock = { update: jest.fn(), findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgreementRepository,
        { provide: getRepositoryToken(Agreement), useValue: repoMock },
        {
          provide: AccessScopeService,
          useValue: { applyToQueryBuilder: jest.fn() },
        },
      ],
    }).compile();

    repo = module.get(AgreementRepository);
  });

  describe('updateVersioned (agreements.version)', () => {
    it('affected=1 -> returns the updated row', async () => {
      repoMock.update.mockResolvedValue({ affected: 1 });
      repoMock.findOne.mockResolvedValue({ id: 'agr-1', version: 6 });

      await expect(
        repo.updateVersioned('agr-1', 'tenant-1', 5, { agreementName: 'x' }),
      ).resolves.toBeDefined();

      const [where, set] = repoMock.update.mock.calls[0];
      expect(where).toEqual({ id: 'agr-1', tenantId: 'tenant-1', version: 5 });
      expect(typeof set.version).toBe('function');
    });

    it('affected=0 + row exists -> ConflictException STALE_VERSION', async () => {
      repoMock.update.mockResolvedValue({ affected: 0 });
      repoMock.findOne.mockResolvedValue({ id: 'agr-1', version: 9 });

      await expect(
        repo.updateVersioned('agr-1', 'tenant-1', 5, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 409,
          code: STALE_VERSION_CODE,
          entity: 'AGREEMENT',
          expectedVersion: 5,
          currentVersion: 9,
        }),
      });
      await expect(
        repo.updateVersioned('agr-1', 'tenant-1', 5, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('affected=0 + row gone -> NotFoundException', async () => {
      repoMock.update.mockResolvedValue({ affected: 0 });
      repoMock.findOne.mockResolvedValue(null);

      await expect(
        repo.updateVersioned('agr-1', 'tenant-1', 5, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deliberate CAS bypass', () => {
    it('updateUnversioned / updateStatus never add a version predicate or bump', async () => {
      repoMock.update.mockResolvedValue({ affected: 1 });
      repoMock.findOne.mockResolvedValue({ id: 'agr-1' });

      await repo.updateUnversioned('agr-1', 'tenant-1', { kpiResults: {} });
      let [where, set] = repoMock.update.mock.calls[0];
      expect(where).toEqual({ id: 'agr-1', tenantId: 'tenant-1' });
      expect(set.version).toBeUndefined();

      repoMock.update.mockClear();
      await repo.updateStatus('agr-1', 'tenant-1', 'CLOSED' as any);
      [where, set] = repoMock.update.mock.calls[0];
      expect(where.version).toBeUndefined();
      expect(set.version).toBeUndefined();
    });
  });

  /**
   * T-034 code-review follow-up (2026-07-29): `delete()` was found entirely
   * exempt from optimistic locking. Mirrors
   * plan.repository.spec.ts#softDeleteVersioned.
   */
  describe('softDeleteVersioned (destructive — CAS, code-review follow-up)', () => {
    it('sends `version: expectedVersion` in the WHERE and a version-bump fragment in the SET (mutation-proof-bearing)', async () => {
      repoMock.update.mockResolvedValue({ affected: 1 });

      await repo.softDeleteVersioned('agr-1', 'tenant-1', 5);

      expect(repoMock.update).toHaveBeenCalledTimes(1);
      const [where, set] = repoMock.update.mock.calls[0];
      expect(where).toEqual(
        expect.objectContaining({
          id: 'agr-1',
          tenantId: 'tenant-1',
          version: 5,
        }),
      );
      expect(typeof set.version).toBe('function');
      expect(set.version()).toBe('"version" + 1');
      expect(set.deletedAt).toBeInstanceOf(Date);
    });

    it('affected=0 + row exists -> ConflictException STALE_VERSION', async () => {
      repoMock.update.mockResolvedValue({ affected: 0 });
      repoMock.findOne.mockResolvedValue({ id: 'agr-1', version: 9 });

      await expect(
        repo.softDeleteVersioned('agr-1', 'tenant-1', 5),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 409,
          code: STALE_VERSION_CODE,
          entity: 'AGREEMENT',
          expectedVersion: 5,
          currentVersion: 9,
        }),
      });
    });

    it('affected=0 + row gone -> NotFoundException', async () => {
      repoMock.update.mockResolvedValue({ affected: 0 });
      repoMock.findOne.mockResolvedValue(null);

      await expect(
        repo.softDeleteVersioned('agr-1', 'tenant-1', 5),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * T-034b — state transitions (submit/approve/reject) use `FOR UPDATE` +
   * status-CAS, not version-CAS. See plan.repository.spec.ts's identical
   * block for the full rationale.
   */
  describe('T-034b — findByIdForUpdate / updateStatusCas', () => {
    it('findByIdForUpdate locks via the given manager (pessimistic_write), no relations', async () => {
      const managerMock = {
        findOne: jest.fn().mockResolvedValue({ id: 'agr-1' }),
      };

      const result = await repo.findByIdForUpdate(
        'agr-1',
        'tenant-1',
        managerMock as any,
      );

      expect(managerMock.findOne).toHaveBeenCalledWith(
        Agreement,
        expect.objectContaining({
          where: { id: 'agr-1', tenantId: 'tenant-1' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(result).toEqual({ id: 'agr-1' });
    });

    it('updateStatusCas writes WHERE status = expectedStatus and returns affected count', async () => {
      const managerMock = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const affected = await repo.updateStatusCas(
        managerMock as any,
        'agr-1',
        'tenant-1',
        'PENDING' as any,
        { status: 'APPROVED' } as any,
      );

      expect(affected).toBe(1);
      expect(managerMock.update).toHaveBeenCalledWith(
        Agreement,
        { id: 'agr-1', tenantId: 'tenant-1', status: 'PENDING' },
        { status: 'APPROVED' },
      );
    });

    it('updateStatusCas returns 0 when the row is not in the expected status (mutation-proof anchor)', async () => {
      const managerMock = {
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      const affected = await repo.updateStatusCas(
        managerMock as any,
        'agr-1',
        'tenant-1',
        'PENDING' as any,
        { status: 'APPROVED' } as any,
      );

      expect(affected).toBe(0);
    });
  });
});
