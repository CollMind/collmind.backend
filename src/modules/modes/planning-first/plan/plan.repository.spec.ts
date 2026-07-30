import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlanRepository, PLAN_RECALC_LOCK_NAMESPACE } from './plan.repository';
import {
  Plan,
  PlanFu,
  PlanSku,
} from '../../../../database/entities/plan.entity';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { STALE_VERSION_CODE } from '../../../shared/persistence/versioned-update.helper';

/**
 * T-034 — Layer 2 (parametric): does every CAS-guarded PlanRepository write
 * path actually route through the CAS predicate, and does the deliberate
 * bypass (#updateUnversioned / #updatePlanFuUnversioned /
 * #updatePlanSkuUnversioned) skip it? See task report §"Mutasyon kanıtı"
 * for the companion test that proves this isn't a false-positive (removing
 * the `AND version = :expected` predicate from the helper must turn these
 * red).
 */
describe('PlanRepository — T-034 optimistic locking (CAS)', () => {
  let repo: PlanRepository;
  let planRepoMock: { update: jest.Mock; findOne: jest.Mock };
  let planFuRepoMock: {
    update: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };
  let planSkuRepoMock: {
    update: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    planRepoMock = { update: jest.fn(), findOne: jest.fn() };
    planFuRepoMock = {
      update: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };
    planSkuRepoMock = {
      update: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanRepository,
        { provide: getRepositoryToken(Plan), useValue: planRepoMock },
        { provide: getRepositoryToken(PlanFu), useValue: planFuRepoMock },
        { provide: getRepositoryToken(PlanSku), useValue: planSkuRepoMock },
        {
          provide: AccessScopeService,
          useValue: { applyToQueryBuilder: jest.fn() },
        },
      ],
    }).compile();

    repo = module.get(PlanRepository);
  });

  describe.each([
    {
      name: 'updateVersioned (plans.version)',
      call: () =>
        repo.updateVersioned('plan-1', 'tenant-1', 5, { planName: 'x' }),
      repoMock: () => planRepoMock,
      entityCode: 'PLAN',
      id: 'plan-1',
    },
    {
      name: 'updatePlanFuVersioned (plan_fus.version)',
      call: () =>
        repo.updatePlanFuVersioned('fu-1', 'tenant-1', 5, { tactics: {} }),
      repoMock: () => planFuRepoMock,
      entityCode: 'PLAN_FU',
      id: 'fu-1',
    },
    {
      name: 'updatePlanSkuVersioned (plan_skus.version)',
      call: () =>
        repo.updatePlanSkuVersioned('sku-1', 'tenant-1', 5, {
          plannedVolume: 100,
        }),
      repoMock: () => planSkuRepoMock,
      entityCode: 'PLAN_SKU',
      id: 'sku-1',
    },
  ])('$name', ({ call, repoMock, entityCode, id }) => {
    it('affected=1 -> returns the updated row (no exception)', async () => {
      const mock = repoMock();
      mock.update.mockResolvedValue({ affected: 1 });
      mock.findOne.mockResolvedValue({ id: 'x', version: 6 });
      // updateVersioned/updatePlanFuVersioned/updatePlanSkuVersioned each
      // re-read via findById/findOne after a successful CAS — plans.version
      // path uses findById (needs relations), so also stub planFuRepo (no
      // effect on FU/SKU cases beyond an unused extra stub).
      planRepoMock.findOne.mockResolvedValue({ id: 'plan-1', version: 6 });

      await expect(call()).resolves.toBeDefined();
      expect(mock.update).toHaveBeenCalledTimes(1);
    });

    // Coordinator follow-up (2026-07-29): the "affected=1" test above only
    // proved a call happened, not WHAT was sent — CAS could be entirely
    // removed and this would still be green. This is the actual
    // mutation-proof-bearing assertion: the WHERE criteria passed to
    // `repo.update()` must literally contain `version: expectedVersion`,
    // and the SET payload must literally contain the raw-SQL version-bump
    // fragment. Removing the predicate from applyVersionedUpdate MUST turn
    // this test red (see T-034 task report "Mutasyon kanıtı" for the
    // pasted red-then-green proof covering all three tables).
    it('sends `version: expectedVersion` in the WHERE and a version-bump fragment in the SET (mutation-proof-bearing)', async () => {
      const mock = repoMock();
      mock.update.mockResolvedValue({ affected: 1 });
      mock.findOne.mockResolvedValue({ id: 'x', version: 6 });
      planRepoMock.findOne.mockResolvedValue({ id: 'plan-1', version: 6 });

      await call();

      expect(mock.update).toHaveBeenCalledTimes(1);
      const [where, set] = mock.update.mock.calls[0];
      expect(where).toEqual(
        expect.objectContaining({ id, tenantId: 'tenant-1', version: 5 }),
      );
      expect(typeof set.version).toBe('function');
      expect(set.version()).toBe('"version" + 1');
    });

    it('affected=0 + row still exists -> ConflictException STALE_VERSION (not silently swallowed)', async () => {
      const mock = repoMock();
      mock.update.mockResolvedValue({ affected: 0 });
      mock.findOne.mockResolvedValue({ id: 'x', version: 9 });

      await expect(call()).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 409,
          code: STALE_VERSION_CODE,
          entity: entityCode,
          expectedVersion: 5,
          currentVersion: 9,
        }),
      });
      await expect(call()).rejects.toBeInstanceOf(ConflictException);
    });

    it('affected=0 + row no longer exists -> NotFoundException (not 409)', async () => {
      const mock = repoMock();
      mock.update.mockResolvedValue({ affected: 0 });
      mock.findOne.mockResolvedValue(null);

      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deliberate CAS bypass (#updateUnversioned et al.) — never checks/bumps against a client-supplied expectedVersion', () => {
    it("updateUnversioned does not call applyVersionedUpdate's WHERE-version shape — plain tenant-scoped update", async () => {
      planRepoMock.update.mockResolvedValue({ affected: 1 });
      planRepoMock.findOne.mockResolvedValue({ id: 'plan-1' });

      await repo.updateUnversioned('plan-1', 'tenant-1', { totalSpend: 500 });

      expect(planRepoMock.update).toHaveBeenCalledWith(
        { id: 'plan-1', tenantId: 'tenant-1' },
        { totalSpend: 500 },
      );
      // No `version` in the WHERE criteria and no version bump in SET —
      // this is the grep-able bypass the T-034 acceptance criteria require.
      const [where, set] = planRepoMock.update.mock.calls[0];
      expect(where.version).toBeUndefined();
      expect(set.version).toBeUndefined();
    });

    it('updatePlanFuUnversioned / updatePlanSkuUnversioned same bypass shape', async () => {
      planFuRepoMock.update.mockResolvedValue({ affected: 1 });
      planFuRepoMock.findOne.mockResolvedValue({ id: 'fu-1' });
      await repo.updatePlanFuUnversioned('fu-1', 'tenant-1', {
        totalSpend: 10,
      });
      expect(planFuRepoMock.update.mock.calls[0][0].version).toBeUndefined();

      planSkuRepoMock.update.mockResolvedValue({ affected: 1 });
      planSkuRepoMock.findOne.mockResolvedValue({ id: 'sku-1' });
      await repo.updatePlanSkuUnversioned('sku-1', 'tenant-1', {
        plannedGp: 10,
      });
      expect(planSkuRepoMock.update.mock.calls[0][0].version).toBeUndefined();
    });
  });

  describe('T-034 §1.5 — tenantId predicate on the 6 previously-unscoped methods', () => {
    it('findPlanFu scopes by tenantId', async () => {
      planFuRepoMock.findOne.mockResolvedValue(null);
      await repo.findPlanFu('plan-1', 'fu-1', 'tenant-1');
      expect(planFuRepoMock.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { planId: 'plan-1', fuId: 'fu-1', tenantId: 'tenant-1' },
        }),
      );
    });

    it('findPlanSku scopes by tenantId', async () => {
      planSkuRepoMock.findOne.mockResolvedValue(null);
      await repo.findPlanSku('fu-1', 'sku-1', 'tenant-1');
      expect(planSkuRepoMock.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { planFuId: 'fu-1', skuId: 'sku-1', tenantId: 'tenant-1' },
        }),
      );
    });

    it('removeFu deletes scoped by tenantId', async () => {
      planFuRepoMock.delete.mockResolvedValue({ affected: 1 });
      await repo.removeFu('fu-1', 'tenant-1');
      expect(planFuRepoMock.delete).toHaveBeenCalledWith({
        id: 'fu-1',
        tenantId: 'tenant-1',
      });
    });

    it('removeSku deletes scoped by tenantId', async () => {
      await repo.removeSku('sku-1', 'tenant-1');
      expect(planSkuRepoMock.delete).toHaveBeenCalledWith({
        id: 'sku-1',
        tenantId: 'tenant-1',
      });
    });
  });

  /**
   * T-034 code-review follow-up (2026-07-29): `delete()` was found entirely
   * exempt from optimistic locking — the single most destructive mutation
   * path (a stale-view delete silently discards a concurrent editor's
   * FUs/SKUs). Mirrors the `updateVersioned` test shape exactly, including
   * the mutation-proof-bearing WHERE/SET assertion.
   */
  describe('softDeleteVersioned (destructive — CAS, code-review follow-up)', () => {
    it('sends `version: expectedVersion` in the WHERE and a version-bump fragment in the SET (mutation-proof-bearing)', async () => {
      planRepoMock.update.mockResolvedValue({ affected: 1 });

      await repo.softDeleteVersioned('plan-1', 'tenant-1', 5);

      expect(planRepoMock.update).toHaveBeenCalledTimes(1);
      const [where, set] = planRepoMock.update.mock.calls[0];
      expect(where).toEqual(
        expect.objectContaining({
          id: 'plan-1',
          tenantId: 'tenant-1',
          version: 5,
        }),
      );
      expect(typeof set.version).toBe('function');
      expect(set.version()).toBe('"version" + 1');
      expect(set.deletedAt).toBeInstanceOf(Date);
    });

    it('affected=1 -> resolves without throwing', async () => {
      planRepoMock.update.mockResolvedValue({ affected: 1 });
      await expect(
        repo.softDeleteVersioned('plan-1', 'tenant-1', 5),
      ).resolves.toBeUndefined();
    });

    it('affected=0 + row still exists -> ConflictException STALE_VERSION', async () => {
      planRepoMock.update.mockResolvedValue({ affected: 0 });
      planRepoMock.findOne.mockResolvedValue({ id: 'plan-1', version: 9 });

      await expect(
        repo.softDeleteVersioned('plan-1', 'tenant-1', 5),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 409,
          code: STALE_VERSION_CODE,
          entity: 'PLAN',
          expectedVersion: 5,
          currentVersion: 9,
        }),
      });
    });

    it('affected=0 + row no longer exists -> NotFoundException', async () => {
      planRepoMock.update.mockResolvedValue({ affected: 0 });
      planRepoMock.findOne.mockResolvedValue(null);

      await expect(
        repo.softDeleteVersioned('plan-1', 'tenant-1', 5),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * T-034b — state transitions (submit/approve/reject/returnToDraft) use
   * `FOR UPDATE` + status-CAS, not version-CAS (docs/analysis/0005 §4). See
   * plan.service.spec.ts for the higher-level proof that PlanService's
   * transactional methods actually call these with the transaction's
   * `manager`, not the injected repos.
   */
  describe('T-034b — findByIdForUpdate / updateStatusCas', () => {
    it('findByIdForUpdate locks via the given manager (pessimistic_write), no relations', async () => {
      const managerMock = {
        findOne: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      };

      const result = await repo.findByIdForUpdate(
        'plan-1',
        'tenant-1',
        managerMock as any,
      );

      expect(managerMock.findOne).toHaveBeenCalledWith(
        Plan,
        expect.objectContaining({
          where: { id: 'plan-1', tenantId: 'tenant-1' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(result).toEqual({ id: 'plan-1' });
    });

    it('updateStatusCas writes WHERE status = expectedStatus and returns affected count', async () => {
      const managerMock = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const affected = await repo.updateStatusCas(
        managerMock as any,
        'plan-1',
        'tenant-1',
        'DRAFT' as any,
        { status: 'PENDING_APPROVAL' } as any,
      );

      expect(affected).toBe(1);
      expect(managerMock.update).toHaveBeenCalledWith(
        Plan,
        { id: 'plan-1', tenantId: 'tenant-1', status: 'DRAFT' },
        { status: 'PENDING_APPROVAL' },
      );
    });

    it('updateStatusCas returns 0 when the row is not in the expected status (mutation-proof anchor)', async () => {
      const managerMock = {
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      const affected = await repo.updateStatusCas(
        managerMock as any,
        'plan-1',
        'tenant-1',
        'DRAFT' as any,
        { status: 'PENDING_APPROVAL' } as any,
      );

      expect(affected).toBe(0);
    });
  });

  /**
   * T-034c — recalc serialization (docs/analysis/0005 §3, task T-034c).
   * `acquireRecalcLock` is the ONLY caller of `pg_advisory_xact_lock` in
   * this codebase; this is the mutation-proof-bearing assertion — deleting
   * this call from `recalculatePlanWithKpiEngine` (or changing the SQL to
   * omit `hashtext($1)`/the namespace constant) must turn this red. See the
   * task report for the companion e2e proof (lock removed -> concurrent
   * recalc invariant test goes red).
   */
  describe('T-034c — acquireRecalcLock (pg_advisory_xact_lock, transaction-scoped)', () => {
    it('runs `pg_advisory_xact_lock(hashtext(namespace), hashtext(planId))` on the given manager', async () => {
      const managerMock = { query: jest.fn().mockResolvedValue(undefined) };

      await repo.acquireRecalcLock('plan-1', managerMock as any);

      expect(managerMock.query).toHaveBeenCalledTimes(1);
      const [sql, params] = managerMock.query.mock.calls[0];
      expect(sql).toContain('pg_advisory_xact_lock');
      expect(sql).toContain('hashtext($1)');
      expect(sql).toContain('hashtext($2)');
      // Two-int namespaced form (docs/analysis/0005 R4) — NOT a single
      // hashtextextended(planId) key. `params[0]` is the fixed private
      // namespace constant (never the planId itself); `params[1]` is the
      // planId. Swapping these, or collapsing to one param, would silently
      // widen this lock's collision surface to every future advisory-lock
      // user in the codebase — this assertion pins the exact shape.
      expect(params).toEqual([PLAN_RECALC_LOCK_NAMESPACE, 'plan-1']);
    });

    it('different planIds -> different `objid` params (no accidental sharing of one lock key)', async () => {
      const managerMock = { query: jest.fn().mockResolvedValue(undefined) };

      await repo.acquireRecalcLock('plan-1', managerMock as any);
      await repo.acquireRecalcLock('plan-2', managerMock as any);

      const [, paramsA] = managerMock.query.mock.calls[0];
      const [, paramsB] = managerMock.query.mock.calls[1];
      expect(paramsA[1]).not.toEqual(paramsB[1]);
      // Namespace stays constant across calls — same lock space.
      expect(paramsA[0]).toBe(paramsB[0]);
    });
  });
});
