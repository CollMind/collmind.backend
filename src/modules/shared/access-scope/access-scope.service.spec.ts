import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';
import { AccessScopeService } from './access-scope.service';
import { UserScope } from '../../../database/entities/user-scope.entity';
import { UserRole } from '../../../database/entities/user.entity';

const TENANT = 'tenant-1';
const USER = 'user-1';

function buildScopeRow(partial: Partial<UserScope>): UserScope {
  return {
    id: 'scope-id',
    userId: USER,
    tenantId: TENANT,
    isActive: true,
    cplId: undefined,
    categoryId: undefined,
    channelId: undefined,
    ...partial,
  } as UserScope;
}

describe('AccessScopeService', () => {
  let service: AccessScopeService;
  let userScopeRepo: { find: jest.Mock };

  beforeEach(async () => {
    userScopeRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessScopeService,
        { provide: getRepositoryToken(UserScope), useValue: userScopeRepo },
      ],
    }).compile();

    service = module.get(AccessScopeService);
  });

  describe('resolveScope — role semantics', () => {
    it.each([UserRole.ADMIN, UserRole.FINANCE_MANAGER, UserRole.READONLY])(
      '%s is always UNRESTRICTED (no UserScope query)',
      async (role) => {
        const scope = await service.resolveScope(TENANT, USER, role);
        expect(scope).toEqual({ kind: 'UNRESTRICTED' });
        expect(userScopeRepo.find).not.toHaveBeenCalled();
      },
    );

    it('requires tenantId', async () => {
      await expect(
        service.resolveScope('', USER, UserRole.PLANNER),
      ).rejects.toThrow('tenantId is required');
    });

    it('requires userId', async () => {
      await expect(
        service.resolveScope(TENANT, '', UserRole.PLANNER),
      ).rejects.toThrow('userId is required');
    });
  });

  describe('R-2 — fail-closed (empty scope = nothing)', () => {
    it('PLANNER with no UserScope rows => SCOPED with empty pairs', async () => {
      userScopeRepo.find.mockResolvedValue([]);
      const scope = await service.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(scope).toEqual({ kind: 'SCOPED', pairs: [] });
    });

    it('isInScope is false for empty pairs regardless of entity', async () => {
      const scope = { kind: 'SCOPED' as const, pairs: [] };
      expect(service.isInScope(scope, { cplId: 'x', categoryId: 'y' })).toBe(
        false,
      );
      expect(service.isInScope(scope, {})).toBe(false);
    });

    it('applyToQueryBuilder emits 1=0 for empty pairs', () => {
      const scope = { kind: 'SCOPED' as const, pairs: [] };
      const andWhere = jest.fn();
      const qb = { andWhere } as unknown as SelectQueryBuilder<any>;
      service.applyToQueryBuilder(qb, 'plan', scope);
      expect(andWhere).toHaveBeenCalledWith('1=0');
    });
  });

  describe('NULL = "hepsi" (F6 fix)', () => {
    it('single {cplId:null, categoryId:null} row => UNRESTRICTED', async () => {
      userScopeRepo.find.mockResolvedValue([
        buildScopeRow({ cplId: undefined, categoryId: undefined }),
      ]);
      const scope = await service.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(scope).toEqual({ kind: 'UNRESTRICTED' });
    });
  });

  describe('R-1 — pair semantics, no cross-product flattening', () => {
    it('PLANNER: (CPL1,CatA) + (CPL2,CatB) must NOT authorize (CPL2,CatA)', async () => {
      userScopeRepo.find.mockResolvedValue([
        buildScopeRow({ cplId: 'CPL1', categoryId: 'CatA' }),
        buildScopeRow({ cplId: 'CPL2', categoryId: 'CatB' }),
      ]);
      const scope = await service.resolveScope(TENANT, USER, UserRole.PLANNER);

      // Authorized pairs
      expect(
        service.isInScope(scope, { cplId: 'CPL1', categoryId: 'CatA' }),
      ).toBe(true);
      expect(
        service.isInScope(scope, { cplId: 'CPL2', categoryId: 'CatB' }),
      ).toBe(true);

      // Cross-product combinations that a naive cplIds[] x categoryIds[]
      // flattening would incorrectly authorize — must be denied.
      expect(
        service.isInScope(scope, { cplId: 'CPL2', categoryId: 'CatA' }),
      ).toBe(false);
      expect(
        service.isInScope(scope, { cplId: 'CPL1', categoryId: 'CatB' }),
      ).toBe(false);
    });

    it('applyToQueryBuilder builds a per-row AND clause joined by OR (not a flattened IN x IN)', async () => {
      userScopeRepo.find.mockResolvedValue([
        buildScopeRow({ cplId: 'CPL1', categoryId: 'CatA' }),
        buildScopeRow({ cplId: 'CPL2', categoryId: 'CatB' }),
      ]);
      const scope = await service.resolveScope(TENANT, USER, UserRole.PLANNER);

      const whereCalls: Array<[string, any]> = [];
      const orWhereCalls: Array<[string, any]> = [];
      const brackets = {
        where: (clause: string, params: any) => {
          whereCalls.push([clause, params]);
          return brackets;
        },
        orWhere: (clause: string, params: any) => {
          orWhereCalls.push([clause, params]);
          return brackets;
        },
      };
      const andWhere = jest.fn((brArg: any) => {
        // Simulate TypeORM invoking the Brackets callback with a query
        // builder-like object exposing where/orWhere.
        const factory = (brArg as any).whereFactory ?? brArg;
        if (typeof factory === 'function') {
          factory(brackets);
        }
      });
      const qb = { andWhere } as unknown as SelectQueryBuilder<any>;

      service.applyToQueryBuilder(qb, 'plan', scope);
      expect(andWhere).toHaveBeenCalledTimes(1);
    });
  });

  describe('CATEGORY_MANAGER — cpl normalized to null', () => {
    it('CM UserScope rows with cplId set are normalized to cplId:null (category-only)', async () => {
      userScopeRepo.find.mockResolvedValue([
        buildScopeRow({ cplId: 'CPL1', categoryId: 'CatA' }),
      ]);
      const scope = await service.resolveScope(
        TENANT,
        USER,
        UserRole.CATEGORY_MANAGER,
      );
      expect(scope).toEqual({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'CatA' }],
      });

      // CM authorized for CatA regardless of cplId (channel-independent).
      expect(
        service.isInScope(scope as any, {
          cplId: 'ANY_CPL',
          categoryId: 'CatA',
        }),
      ).toBe(true);
      expect(
        service.isInScope(scope as any, {
          cplId: undefined,
          categoryId: 'CatA',
        }),
      ).toBe(true);
      // Different category => denied.
      expect(
        service.isInScope(scope as any, { cplId: 'CPL1', categoryId: 'CatB' }),
      ).toBe(false);
    });
  });

  describe('assertEntityInScope — 403', () => {
    it('throws ForbiddenException when out of scope', () => {
      const scope = {
        kind: 'SCOPED' as const,
        pairs: [{ cplId: null, categoryId: 'CatA' }],
      };
      expect(() =>
        service.assertEntityInScope(scope, { categoryId: 'CatB' }),
      ).toThrow(ForbiddenException);
    });

    it('does not throw when in scope', () => {
      const scope = {
        kind: 'SCOPED' as const,
        pairs: [{ cplId: null, categoryId: 'CatA' }],
      };
      expect(() =>
        service.assertEntityInScope(scope, { categoryId: 'CatA' }),
      ).not.toThrow();
    });
  });

  describe('tenant isolation', () => {
    it('always queries UserScope WHERE tenantId (never omitted)', async () => {
      userScopeRepo.find.mockResolvedValue([]);
      await service.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(userScopeRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, userId: USER }),
        }),
      );
    });

    it('different tenants for the same user do not share cached scope', async () => {
      userScopeRepo.find
        .mockResolvedValueOnce([
          buildScopeRow({ cplId: 'CPL1', categoryId: undefined }),
        ])
        .mockResolvedValueOnce([]);

      const scopeTenant1 = await service.resolveScope(
        'tenant-A',
        USER,
        UserRole.PLANNER,
      );
      const scopeTenant2 = await service.resolveScope(
        'tenant-B',
        USER,
        UserRole.PLANNER,
      );

      expect(scopeTenant1).toEqual({
        kind: 'SCOPED',
        pairs: [{ cplId: 'CPL1', categoryId: null }],
      });
      expect(scopeTenant2).toEqual({ kind: 'SCOPED', pairs: [] });
      expect(userScopeRepo.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('caching', () => {
    it('caches resolveScope result for the same tenant/user/role (single query)', async () => {
      userScopeRepo.find.mockResolvedValue([
        buildScopeRow({ cplId: 'CPL1', categoryId: undefined }),
      ]);
      await service.resolveScope(TENANT, USER, UserRole.PLANNER);
      await service.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(userScopeRepo.find).toHaveBeenCalledTimes(1);
    });

    it('clearCache forces a re-query', async () => {
      userScopeRepo.find.mockResolvedValue([]);
      await service.resolveScope(TENANT, USER, UserRole.PLANNER);
      service.clearCache();
      await service.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(userScopeRepo.find).toHaveBeenCalledTimes(2);
    });
  });
});
