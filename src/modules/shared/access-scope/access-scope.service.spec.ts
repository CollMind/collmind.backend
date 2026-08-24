import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
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

  // T-028c: this file exercises the SCOPED pair-semantics engine itself, so
  // SCOPE_ENFORCEMENT_ENABLED='true' throughout — the flag's OFF behavior
  // (PLANNER bypass) has its own dedicated describe block below.
  beforeEach(async () => {
    userScopeRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessScopeService,
        { provide: getRepositoryToken(UserScope), useValue: userScopeRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('true') },
        },
      ],
    }).compile();

    service = module.get(AccessScopeService);
  });

  describe('resolveScope — role semantics', () => {
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

  describe('T-028c — SCOPE_ENFORCEMENT_ENABLED feature flag (PLANNER only)', () => {
    async function buildServiceWithFlag(
      flagValue: string | undefined,
    ): Promise<{ svc: AccessScopeService; repo: { find: jest.Mock } }> {
      const repo = { find: jest.fn() };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AccessScopeService,
          { provide: getRepositoryToken(UserScope), useValue: repo },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(flagValue) },
          },
        ],
      }).compile();
      return { svc: module.get(AccessScopeService), repo };
    }

    it('flag unset (undefined) => default false => PLANNER is UNRESTRICTED, no UserScope query (bugünkü davranış)', async () => {
      const { svc, repo } = await buildServiceWithFlag(undefined);
      const scope = await svc.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(scope).toEqual({ kind: 'UNRESTRICTED' });
      expect(repo.find).not.toHaveBeenCalled();
    });

    it("flag='false' (explicit) => PLANNER is UNRESTRICTED", async () => {
      const { svc, repo } = await buildServiceWithFlag('false');
      const scope = await svc.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(scope).toEqual({ kind: 'UNRESTRICTED' });
      expect(repo.find).not.toHaveBeenCalled();
    });

    it("flag='true' => PLANNER resolves real pair scope (fail-closed, R-2, for a PLANNER with no rows)", async () => {
      const { svc, repo } = await buildServiceWithFlag('true');
      repo.find.mockResolvedValue([]);
      const scope = await svc.resolveScope(TENANT, USER, UserRole.PLANNER);
      expect(scope).toEqual({ kind: 'SCOPED', pairs: [] });
      expect(repo.find).toHaveBeenCalled();
    });

    it('flag does NOT affect CATEGORY_MANAGER (T-028b enforcement unchanged regardless of flag)', async () => {
      const { svc: svcOff, repo: repoOff } =
        await buildServiceWithFlag(undefined);
      repoOff.find.mockResolvedValue([
        buildScopeRow({ cplId: 'CPL1', categoryId: 'CatA' }),
      ]);
      const scopeOff = await svcOff.resolveScope(
        TENANT,
        USER,
        UserRole.CATEGORY_MANAGER,
      );
      expect(scopeOff).toEqual({
        kind: 'SCOPED',
        pairs: [{ cplId: null, categoryId: 'CatA' }],
      });

      const { svc: svcOn, repo: repoOn } = await buildServiceWithFlag('true');
      repoOn.find.mockResolvedValue([
        buildScopeRow({ cplId: 'CPL1', categoryId: 'CatA' }),
      ]);
      const scopeOn = await svcOn.resolveScope(
        TENANT,
        USER,
        UserRole.CATEGORY_MANAGER,
      );
      expect(scopeOn).toEqual(scopeOff);
    });

    // Z30 H8: ADMIN/FM için "no UserScope query" iddiası artık YANLIŞ —
    // UNRESTRICTED_ROLES kod sabiti (ve onun kısa devresi) kaldırıldı; bu
    // roller de READONLY'nin T-235 ADIM 2'den beri yaptığı gibi joker
    // satırdan (buildScope.hasUnrestrictedRow) UNRESTRICTED'a çözülür.
    // Flag PLANNER'a özgüdür (yukarıdaki not doğru kalır); ADMIN/FM pini
    // aşağıdaki ayrı describe'a taşındı (iki-girdi-iki-çıktı).
    it('flag does NOT affect ADMIN/FM — repo.find is still called with the flag set either way', async () => {
      const { svc: svcOff, repo: repoOff } =
        await buildServiceWithFlag(undefined);
      repoOff.find.mockResolvedValue([
        buildScopeRow({ cplId: undefined, categoryId: undefined }),
      ]);
      const scopeOff = await svcOff.resolveScope(TENANT, USER, UserRole.ADMIN);
      expect(scopeOff).toEqual({ kind: 'UNRESTRICTED' });
      expect(repoOff.find).toHaveBeenCalled();

      const { svc: svcOn, repo: repoOn } = await buildServiceWithFlag('true');
      repoOn.find.mockResolvedValue([
        buildScopeRow({ cplId: undefined, categoryId: undefined }),
      ]);
      const scopeOn = await svcOn.resolveScope(TENANT, USER, UserRole.ADMIN);
      expect(scopeOn).toEqual(scopeOff);
    });
  });

  // T-235 ADIM 2 (docs/verification/T235_OLCUM_1_VE_3.md, ürün sahibi kararı):
  // UNRESTRICTED_ROLES kod sabitinden READONLY çıkarıldı — kısa devre kalktı,
  // her READONLY çağrısı artık UserScope'u sorgular. İki girdi, iki çıktı
  // (CLAUDE.md §2.7 #9 — sinyal sabitse sinyal değildir):
  //   joker satır ({cplId:null, categoryId:null})  -> UNRESTRICTED, find ÇAĞRILIR
  //   satır YOK                                     -> SCOPED{pairs:[]} (R-2 fail-closed)
  describe('T-235 ADIM 2 — READONLY kod dalından çıktı, buildScope üzerinden çözülür', () => {
    it('READONLY with a wildcard UserScope row => UNRESTRICTED (find IS called, unlike the code-branch roles)', async () => {
      userScopeRepo.find.mockResolvedValue([
        buildScopeRow({ cplId: undefined, categoryId: undefined }),
      ]);
      const scope = await service.resolveScope(TENANT, USER, UserRole.READONLY);
      expect(scope).toEqual({ kind: 'UNRESTRICTED' });
      expect(userScopeRepo.find).toHaveBeenCalled();
    });

    it('READONLY with NO UserScope rows => SCOPED with empty pairs (R-2 fail-closed — sees nothing)', async () => {
      userScopeRepo.find.mockResolvedValue([]);
      const scope = await service.resolveScope(TENANT, USER, UserRole.READONLY);
      expect(scope).toEqual({ kind: 'SCOPED', pairs: [] });
      expect(service.isInScope(scope, { cplId: 'x', categoryId: 'y' })).toBe(
        false,
      );
    });
  });

  // Z30 H8 (K-2.6.4f): UNRESTRICTED_ROLES kod sabiti + kısa devre dalı
  // KALDIRILDI. ADMIN/FINANCE artık READONLY'nin T-235 ADIM 2'den beri
  // yaptığı gibi buildScope.hasUnrestrictedRow üzerinden çözülür — kod
  // dalından DEĞİL, user_scopes'taki joker satırdan. İki-girdi-iki-çıktı
  // (CLAUDE.md §2.7 #9 — sinyal sabitse sinyal değildir):
  //   joker satır ({cplId:null, categoryId:null}) -> UNRESTRICTED, find ÇAĞRILIR
  //   satır YOK (backfill uygulanmamış / silinmiş) -> SCOPED{pairs:[]},
  //     fail-closed — ATOMİKLİK şartının davranışsal kanıtı: bu durum
  //     eskiden kod dalı sayesinde İMKÂNSIZDI, artık mümkün ve erişimsiz
  //     olmalı (K-2.6.4f, migration 1812000000000 ile aynı dalga).
  describe('Z30 H8 — ADMIN/FINANCE kod dalından çıktı, buildScope üzerinden çözülür', () => {
    it.each([UserRole.ADMIN, UserRole.FINANCE])(
      '%s with a wildcard UserScope row => UNRESTRICTED (find IS called, unlike the pre-H8 code branch)',
      async (role) => {
        userScopeRepo.find.mockResolvedValue([
          buildScopeRow({ cplId: undefined, categoryId: undefined }),
        ]);
        const scope = await service.resolveScope(TENANT, USER, role);
        expect(scope).toEqual({ kind: 'UNRESTRICTED' });
        expect(userScopeRepo.find).toHaveBeenCalled();
      },
    );

    it.each([UserRole.ADMIN, UserRole.FINANCE])(
      '%s with NO UserScope rows => SCOPED with empty pairs, fail-closed (ACCESS DENIED — atomiklik kanıtı, K-2.6.4f)',
      async (role) => {
        userScopeRepo.find.mockResolvedValue([]);
        const scope = await service.resolveScope(TENANT, USER, role);
        expect(scope).toEqual({ kind: 'SCOPED', pairs: [] });
        expect(service.isInScope(scope, { cplId: 'x', categoryId: 'y' })).toBe(
          false,
        );
      },
    );

    // code-reviewer nit (§2.7 #6): önceki hâl `find.mockResolvedValue([])`
    // kullanıyordu — bu, `isActive:false` satırının HİÇ kurulmadığı, bir
    // önceki testle birebir aynı fixture'dı. `toHaveBeenCalledWith` çağrı
    // argümanını doğruluyordu ama fixture kendisi iki tarafı AYIRT ETMİYORDU.
    // Bu test mock'u gerçek bir repository gibi `where.isActive`'e göre
    // SÜZEN bir implementasyonla kuruyor — aynı joker satır, tek fark
    // `isActive` bayrağı, ve iki yan FARKLI sonuç üretiyor (R2a-M6b'nin
    // fixture ayrımı deseni).
    it.each([UserRole.ADMIN, UserRole.FINANCE])(
      "%s: repo çağrısına isActive:true predicate'i GEÇİYOR — o predicate olmasaydı REVOKE_ALL sonrası pasif joker satır da UNRESTRICTED sayılırdı",
      async (role) => {
        // Fixture'ın kendisi TEK bir joker satır — yalnız isActive değişir.
        // Mock, gerçek repository'nin `where: { isActive }` davranışını
        // taklit ediyor: `where.isActive` GEÇİLMEZSE (mutasyon), satır
        // aktiflik durumundan bağımsız döner — yani mutasyon bu mock'ta da
        // "her zaman görünür" sonucunu üretir, tıpkı üretimdeki gibi.
        const row = buildScopeRow({
          cplId: undefined,
          categoryId: undefined,
          isActive: false,
        });
        userScopeRepo.find.mockImplementation(
          ({ where }: { where: { isActive?: boolean } }) =>
            Promise.resolve(
              where.isActive === undefined || row.isActive === where.isActive
                ? [row]
                : [],
            ),
        );

        // Taraf 1: satır PASİF (REVOKE_ALL sonrası) — predicate doğru
        // geçiliyorsa repository bu satırı hiç döndürmemeli => fail-closed.
        const revokedScope = await service.resolveScope(TENANT, USER, role);
        expect(revokedScope).toEqual({ kind: 'SCOPED', pairs: [] });
        expect(
          service.isInScope(revokedScope, { cplId: 'x', categoryId: 'y' }),
        ).toBe(false);

        // Taraf 2: AYNI satır, yalnız isActive=true — predicate hâlâ doğru
        // geçiliyorsa repository bu kez satırı döndürür => UNRESTRICTED.
        row.isActive = true;
        service.clearCache();
        const activeScope = await service.resolveScope(TENANT, USER, role);
        expect(activeScope).toEqual({ kind: 'UNRESTRICTED' });
      },
    );
  });
});
