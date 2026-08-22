import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import {
  User,
  UserStatus,
  UserRole,
} from '../../database/entities/user.entity';
import { UserScope } from '../../database/entities/user-scope.entity';
import { Cpl } from '../../database/entities/cpl.entity';
import { Category } from '../../database/entities/category.entity';
import { AdminAuditService } from '../../common/services/admin-audit.service';
import { AccessScopeService } from '../shared/access-scope/access-scope.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateUserScopeDto,
  ScopeUpdateIntent,
} from './dto/update-user-scope.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('UserService', () => {
  let service: UserService;
  let userRepository: jest.Mocked<UserRepository>;
  let jwtService: jest.Mocked<JwtService>;
  let cplRepository: jest.Mocked<Repository<Cpl>>;
  let categoryRepository: jest.Mocked<Repository<Category>>;
  let adminAuditService: jest.Mocked<AdminAuditService>;
  let accessScopeService: jest.Mocked<Pick<AccessScopeService, 'clearCache'>>;
  // T-241: create() now writes User + UserScope inside ONE
  // `dataSource.transaction`. The mock runs the callback synchronously with a
  // manager whose `getRepository` hands back these SAME mocks, so the
  // transactional path is exercised (not stubbed away) — same pattern as
  // budget-allocation.service.spec.ts (T-096/2).
  // T-242a: updateScope() ayrıca `manager.getRepository(UserScope).find(...)`
  // çağırıyor (var olan satırları hedef kümeyle karşılaştırmak için) — `find`
  // create()'in mock'unda kullanılmıyordu, updateScope testleri için eklendi.
  type MockEntityRepo = {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let userEntityRepo: MockEntityRepo;
  let userScopeRepo: MockEntityRepo;
  // J3/J4 (T-244 code-review): exposed so ordering/identity tests can
  // (a) assert `options.manager` in the `logAdminAction` call is THIS EXACT
  // object (identity, not `expect.anything()`), and (b) override
  // `dataSourceMock.transaction`'s implementation per-test to record when
  // the transaction "commits" (the callback's promise resolving) relative
  // to `logAdminAction`/`flushPendingAlert`.
  type MockManager = {
    getRepository: (entity: typeof User | typeof UserScope) => MockEntityRepo;
  };
  let mockManager: MockManager;
  let dataSourceMock: { transaction: jest.Mock };

  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-123';
  // T-244 (A1): the ACTOR is deliberately a different id/email than
  // `mockUserId` — the whole point of the A1 pin is that `createdBy` must
  // equal THIS, never the newly created user's own id.
  const mockActorId = 'admin-actor-999';
  const mockActorEmail = 'admin-actor@example.com';
  const mockUser: User = {
    id: mockUserId,
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    fullName: 'Test User',
    role: UserRole.PLANNER,
    status: UserStatus.ACTIVE,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    validatePassword: jest.fn().mockResolvedValue(true),
    loginCount: 0,
    failedLoginAttempts: 0,
    mustChangePassword: false,
  } as any;

  beforeEach(async () => {
    userEntityRepo = { create: jest.fn(), save: jest.fn(), find: jest.fn() };
    userScopeRepo = { create: jest.fn(), save: jest.fn(), find: jest.fn() };
    mockManager = {
      getRepository: (
        entity: typeof User | typeof UserScope,
      ): MockEntityRepo => {
        if (entity === User) return userEntityRepo;
        if (entity === UserScope) return userScopeRepo;
        throw new Error(
          `unexpected entity passed to manager.getRepository in test: ${entity.name}`,
        );
      },
    };
    // Default behaviour matches the ORIGINAL inline mock exactly (invoke the
    // callback synchronously with `mockManager`, return its result) — tests
    // that need to observe commit-ordering (J3) override this per-test.
    dataSourceMock = {
      transaction: jest.fn((cb: (manager: MockManager) => Promise<unknown>) =>
        cb(mockManager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: UserRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findByEmail: jest.fn(),
            findById: jest.fn(),
            findAllByTenant: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Cpl),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Category),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: dataSourceMock,
        },
        // T-244: AdminAuditService is mocked at the DI boundary — it is
        // NOT re-exercised here (that would be §2.7 #8's "test re-runs the
        // control" trap); AdminAuditService has its own suite. This mock
        // only proves UserService CALLS it correctly (actor, action type,
        // manager option) and propagates the resulting log to
        // flushPendingAlert.
        {
          provide: AdminAuditService,
          useValue: {
            logAdminAction: jest.fn(),
            flushPendingAlert: jest.fn(),
          },
        },
        // m1 (T-242a code-review): updateScope() commit sonrası
        // AccessScopeService.clearCache()'i çağırıyor. AccessScopeService'in
        // KENDİ suite'i var (access-scope.service.spec.ts) — burada yalnız
        // UserService'in onu DOĞRU ÇAĞIRDIĞI kanıtlanır (§2.7 #8'in
        // "kontrolü yeniden uygulama" tuzağına düşmeden).
        {
          provide: AccessScopeService,
          useValue: {
            clearCache: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(UserRepository) as jest.Mocked<UserRepository>;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    cplRepository = module.get(getRepositoryToken(Cpl)) as jest.Mocked<
      Repository<Cpl>
    >;
    categoryRepository = module.get(
      getRepositoryToken(Category),
    ) as jest.Mocked<Repository<Category>>;
    adminAuditService = module.get(
      AdminAuditService,
    ) as jest.Mocked<AdminAuditService>;
    accessScopeService = module.get(AccessScopeService) as jest.Mocked<
      Pick<AccessScopeService, 'clearCache'>
    >;

    // Mock bcrypt
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    // T-241: PLANNER/CATEGORY_MANAGER are SCOPE_REQUIRED_ROLES — an explicit
    // `scope` (>=1 pair) is now mandatory. This fixture used to omit `scope`
    // entirely and still succeed; that is exactly the gap T-241 closes, so
    // the fixture is updated (not silenced) to carry a valid scope.
    const plannerScopeDto: CreateUserDto = {
      email: 'newuser@example.com',
      password: 'password123',
      fullName: 'New User',
      role: UserRole.PLANNER,
      scope: [{ cplId: 'cpl-1', categoryId: null }],
    };

    beforeEach(() => {
      userEntityRepo.create.mockImplementation((data: Partial<User>) => data);
      userEntityRepo.save.mockImplementation((entity: Partial<User>) =>
        Promise.resolve({ ...mockUser, ...entity }),
      );
      userScopeRepo.create.mockImplementation(
        (data: Partial<UserScope>) => data,
      );
      userScopeRepo.save.mockImplementation((rows: Partial<UserScope>[]) =>
        Promise.resolve(rows),
      );
      // T-244: a fake log row — only `id`/`isHighRisk`/`alertSent` matter to
      // callers here (flushPendingAlert reads them); the real shape is
      // AdminAuditService's own responsibility, not UserService's.
      (adminAuditService.logAdminAction as jest.Mock).mockResolvedValue({
        id: 'audit-log-1',
        isHighRisk: false,
        alertSent: false,
      });
    });

    it('should create a PLANNER with the given scope, atomically (user + scope in one transaction)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);

      const result = await service.create(
        mockTenantId,
        plannerScopeDto,
        mockActorId,
        mockActorEmail,
      );

      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        mockTenantId,
        plannerScopeDto.email,
      );
      expect(bcrypt.hash).toHaveBeenCalledWith(plannerScopeDto.password, 10);
      expect(userEntityRepo.create).toHaveBeenCalled();
      expect(userEntityRepo.save).toHaveBeenCalled();
      // `scope` must NOT leak onto the User entity payload (not a column).
      expect(userEntityRepo.create.mock.calls[0][0]).not.toHaveProperty(
        'scope',
      );
      expect(userScopeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockTenantId,
          userId: mockUserId,
          cplId: 'cpl-1',
          categoryId: undefined,
          isActive: true,
          createdBy: mockActorId,
        }),
      );
      expect(userScopeRepo.save).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: mockUserId }));
    });

    // ── T-244 (A1) — the bug this task exists to fix ─────────────────────
    //
    // Before the fix, `createdBy: savedUser.id` meant "this user granted
    // their own access" could never NOT be true — the pin below makes that
    // state unreachable rather than merely unobserved.
    it("A1: createdBy is the ACTOR (admin who called POST /users), never the new user's own id", async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);

      await service.create(
        mockTenantId,
        plannerScopeDto,
        mockActorId,
        mockActorEmail,
      );

      const writtenRow = (userScopeRepo.create as jest.Mock).mock
        .calls[0][0] as Partial<UserScope>;
      expect(writtenRow.createdBy).toBe(mockActorId);
      expect(writtenRow.createdBy).not.toBe(mockUserId);
    });

    // ── T-244 (A7) — kapsam verme artık denetim kaydına giriyor ───────────
    it('A7: writes a SCOPE_UPDATE audit row inside the SAME transaction (options.manager), eski küme ∅', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);

      await service.create(
        mockTenantId,
        plannerScopeDto,
        mockActorId,
        mockActorEmail,
        '10.0.0.1',
      );

      expect(adminAuditService.logAdminAction).toHaveBeenCalledTimes(1);
      const call = (adminAuditService.logAdminAction as jest.Mock).mock
        .calls[0];
      const [
        tenantId,
        adminId,
        adminEmail,
        actionType,
        entityType,
        entityId,
        ipAddress,
        result,
        beforeValues,
        afterValues,
        justification,
        options,
      ] = call;

      expect(tenantId).toBe(mockTenantId);
      // Sözlük "kim" = AKTÖR — A1'in kusurunun aynısını burada tekrarlamamak
      // için ayrıca pinleniyor: adminId asla savedUser.id OLAMAZ.
      expect(adminId).toBe(mockActorId);
      expect(adminId).not.toBe(mockUserId);
      expect(adminEmail).toBe(mockActorEmail);
      expect(actionType).toBe('SCOPE_UPDATE');
      // m1 (Z17, code-review düzeltmesi): 'user_scope' DEĞİL 'user' — hedef
      // kullanıcının kapsamıdır, bir kapsam satırı değil (bkz.
      // user-scope.entity.ts'teki SCOPE_AUDIT_ENTITY_TYPE JSDoc'u).
      expect(entityType).toBe('user');
      expect(entityId).toBe(mockUserId);
      expect(ipAddress).toBe('10.0.0.1');
      expect(result).toBe('SUCCESS');
      // Yaratma anı — eski küme HER ZAMAN ∅ (Z16).
      expect(beforeValues).toEqual({ scope: [] });
      expect(afterValues).toEqual({
        scope: [{ cplId: 'cpl-1', categoryId: null }],
      });
      expect(justification).toBeUndefined();
      // J4 (code-review): KİMLİK kontrolü, şekil değil — `expect.anything()`
      // yalnız null/undefined'ı eler, `{manager}` içine YABANCI bir nesne
      // konsa bile geçerdi (ölçüldü: mutasyon `M4` bununla kırmızıya
      // dönmüyordu). `options.manager` transaction callback'ine geçen
      // NESNENİN TA KENDİSİ olmalı — ayrı bir connection/commit değil.
      // ⚠️ `toBe` — `toEqual(objectContaining(...))` DEĞİL. Ölçüldü
      // (2026-08-20, Team Lead): `toEqual` özyinelemeli eşitliktir, yani
      // AYNI fonksiyon referanslarını paylaşan FARKLI bir nesne geçer
      // (probe: `{...manager}` klonu `toEqual` ✅ / `toBe` ❌). Bugün o
      // yolu `tsc` kapatıyor — `{ manager: { ...manager } }` mutasyonu
      // TS2740 veriyor, çünkü `EntityManager` 50+ üyeli bir SINIF. Ama
      // koruma tip kapısına DEVREDİLMEZ (CLAUDE.md: "bir sözleşmenin
      // geçerliliği çağıranın bugünkü şekline bağlı olamaz").
      expect(options.manager).toBe(mockManager);

      // T-014 kalıbı: commit'ten SONRA flush edilir.
      expect(adminAuditService.flushPendingAlert).toHaveBeenCalledTimes(1);
      expect(adminAuditService.flushPendingAlert).toHaveBeenCalledWith(
        await (adminAuditService.logAdminAction as jest.Mock).mock.results[0]
          .value,
      );
    });

    // ── J3 (code-review) — "commit'ten SONRA flush edilir" iddiası bir
    // ÇAĞRI SIRASI iddiasıdır ve yukarıdaki test onu ÖLÇMÜYORDU (yalnız
    // `toHaveBeenCalledWith` — HANGİ SIRADA çağrıldığını değil). Mutasyon
    // `M2` (flush'ı transaction callback'inin İÇİNE taşımak) o testi kırmadı
    // — bu test kırar: `dataSourceMock.transaction`'ın kendi implementasyonu
    // callback'in (yani "commit"in) TAMAMLANMA anını `callOrder`'a yazar,
    // settlement-close.service.spec.ts/reversal.service.spec.ts'nin aynı
    // deseni. ──
    it('J3: flushPendingAlert transaction COMMIT sonrası çağrılır (çağrı SIRASI pinlenir)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);

      const callOrder: string[] = [];
      (adminAuditService.logAdminAction as jest.Mock).mockImplementation(
        async () => {
          callOrder.push('logAdminAction');
          return { id: 'audit-log-1', isHighRisk: false, alertSent: false };
        },
      );
      // `dataSource.transaction()`'ın GERÇEK sözleşmesi: callback'in promise'i
      // resolve olduğunda transaction commit edilmiş sayılır (TypeORM bunu
      // `transaction()`'ın kendi içinde, callback'ten SONRA yapar) — mock bu
      // sözleşmeyi birebir taklit ediyor, 'transaction-commit'i callback
      // AWAIT edildikten SONRA yazarak.
      dataSourceMock.transaction.mockImplementation(
        async (cb: (manager: typeof mockManager) => Promise<unknown>) => {
          const result = await cb(mockManager);
          callOrder.push('transaction-commit');
          return result;
        },
      );
      (adminAuditService.flushPendingAlert as jest.Mock).mockImplementation(
        async () => {
          callOrder.push('flushPendingAlert');
        },
      );

      await service.create(
        mockTenantId,
        plannerScopeDto,
        mockActorId,
        mockActorEmail,
      );

      expect(callOrder).toEqual([
        'logAdminAction',
        'transaction-commit',
        'flushPendingAlert',
      ]);
    });

    it('should throw ConflictException if user with email already exists (no writes attempted)', async () => {
      userRepository.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.create(
          mockTenantId,
          plannerScopeDto,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(ConflictException);
      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        mockTenantId,
        plannerScopeDto.email,
      );
      expect(userEntityRepo.create).not.toHaveBeenCalled();
      expect(userScopeRepo.create).not.toHaveBeenCalled();
    });

    // ── Acceptance criteria: kabul davranışı — üç girdi, üç çıktı ──

    it('rejects a scopeless PLANNER with 400 — a scope-less PLANNER cannot be created (T-241)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const dtoWithoutScope: CreateUserDto = {
        ...plannerScopeDto,
        scope: undefined,
      };

      await expect(
        service.create(
          mockTenantId,
          dtoWithoutScope,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(userEntityRepo.create).not.toHaveBeenCalled();
      expect(userScopeRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a PLANNER with an empty scope array with 400 (defense in depth — DTO-level ArrayMinSize is the first line)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const dtoWithEmptyScope: CreateUserDto = {
        ...plannerScopeDto,
        scope: [],
      };

      await expect(
        service.create(
          mockTenantId,
          dtoWithEmptyScope,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates an ADMIN with an automatic wildcard scope row, even when the caller sends no scope', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const adminDto: CreateUserDto = {
        email: 'admin2@example.com',
        password: 'password123',
        fullName: 'New Admin',
        role: UserRole.ADMIN,
      };

      await service.create(mockTenantId, adminDto, mockActorId, mockActorEmail);

      expect(userScopeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockTenantId,
          userId: mockUserId,
          cplId: undefined,
          categoryId: undefined,
          isActive: true,
        }),
      );
      // CPL/Category tenant-ownership check must NOT run for wildcard roles
      // (there is nothing to validate — no pairs were provided/used).
      expect(cplRepository.find).not.toHaveBeenCalled();
      expect(categoryRepository.find).not.toHaveBeenCalled();
    });

    // A3 (ikinci tur review, 2026-08-20): bu test ESKİDEN "sessizce yok
    // sayılır"ı pinliyordu. Davranış BİLİNÇLİ olarak değişti — sessiz atlama
    // bir SÖZLEŞME YALANIYDI (§2.5): çağıran 201 alıp kısıtlı bir kullanıcı
    // yarattığını sanıyor, gerçekte joker yaratmış oluyordu.
    // ⚠️ Bu KIRMIZI beklenendi ve testin yeniden yazılmasıyla giderildi —
    // davranış geri alınarak DEĞİL.
    it('A3: rejects a caller-supplied scope for a wildcard role (ADMIN) with 400 (no silent drop)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const adminDtoWithScope = {
        email: 'admin3@example.com',
        password: 'password123',
        fullName: 'New Admin 3',
        role: UserRole.ADMIN,
        scope: [{ cplId: 'cpl-1', categoryId: null }],
      } as CreateUserDto;

      await expect(
        service.create(
          mockTenantId,
          adminDtoWithScope,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(userEntityRepo.create).not.toHaveBeenCalled();
    });

    it('writes exactly the wildcard row for a wildcard role when NO scope is supplied', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const adminDto = {
        email: 'admin4@example.com',
        password: 'password123',
        fullName: 'New Admin 4',
        role: UserRole.ADMIN,
      } as CreateUserDto;

      await service.create(mockTenantId, adminDto, mockActorId, mockActorEmail);

      // ⚠️ `undefined`, `null` DEĞİL — ve bu bilinçli: `user.service.ts:112`
      // `row.cplId ?? undefined` yazıyor, çünkü TypeORM `undefined`'ı
      // "kolonu INSERT'ten ÇIKAR" diye okur ve DB varsayılanı (NULL) yazılır.
      // Okuma tarafı ikisini de aynı sayıyor (`(r.cplId ?? null) === null`,
      // access-scope.service.ts:205) ve DB'de ölçüldü: joker satırlar
      // `cpl_id IS NULL`. Yani `undefined` ≡ `null` — ama TEST GERÇEĞİ
      // yazmalı, niyeti değil.
      expect(userScopeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ cplId: undefined, categoryId: undefined }),
      );
    });

    it('every successfully created user has >=1 scope row written (invariant, PLANNER + ADMIN)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);

      await service.create(
        mockTenantId,
        plannerScopeDto,
        mockActorId,
        mockActorEmail,
      );
      expect(
        (userScopeRepo.save as jest.Mock).mock.calls[0][0].length,
      ).toBeGreaterThanOrEqual(1);

      userScopeRepo.create.mockClear();
      userScopeRepo.save.mockClear();

      const adminDto: CreateUserDto = {
        email: 'admin4@example.com',
        password: 'password123',
        fullName: 'New Admin 4',
        role: UserRole.ADMIN,
      };
      await service.create(mockTenantId, adminDto, mockActorId, mockActorEmail);
      expect(
        (userScopeRepo.save as jest.Mock).mock.calls[0][0].length,
      ).toBeGreaterThanOrEqual(1);
    });

    // ── Multi-tenant izolasyon ──

    it('rejects a scope referencing a cplId from another tenant with 400 (cross-tenant leak guard)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([]); // not found for THIS tenant

      await expect(
        service.create(
          mockTenantId,
          plannerScopeDto,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(userEntityRepo.create).not.toHaveBeenCalled();
    });

    // ── A4 (ikinci tur review) — guard'ın AYIRT EDİCİ vakası pinlenir ────
    //
    // Yukarıdaki test `find` → `[]` mock'luyor, yani "başka tenant'ta VAR" ile
    // "hiç YOK" ayırt edilemiyor — ve e2e de var olmayan bir UUID kullanıyor,
    // yani FK de aynı sonucu verirdi. Sonuç: sorgudan `tenantId` SİLİNSE
    // hiçbir test kırmızıya dönmezdi (§2.7 #6 — doğru kapsam, yanlış şekil).
    //
    // Bu test sorgunun ŞEKLİNİ pinliyor: kiracı filtresi WHERE'de OLMALI.
    // FK bunu yakalayamaz — FK tenant'ı bilmez.
    it('A4: cplId/categoryId sorguları tenantId ile FİLTRELENİR (guard FK ile karıştırılamaz)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);
      categoryRepository.find.mockResolvedValue([]);

      // Yaratma BAŞARILI olmalı (cpl bulundu) — bu testin konusu reddedilme
      // değil, sorgunun ŞEKLİ.
      await service.create(
        mockTenantId,
        plannerScopeDto,
        mockActorId,
        mockActorEmail,
      );

      expect(cplRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: mockTenantId }),
        }),
      );
    });

    // ── K-2.6.10 — the write endpoint must not compute pair semantics ──

    it('writes each scope pair as-is (no cross-product flattening) for a CATEGORY_MANAGER with multiple pairs', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([]);
      categoryRepository.find.mockResolvedValue([
        { id: 'cat-1' } as Category,
        { id: 'cat-2' } as Category,
      ]);
      const cmDto: CreateUserDto = {
        email: 'cm@example.com',
        password: 'password123',
        fullName: 'New CM',
        role: UserRole.CATEGORY_MANAGER,
        scope: [
          { cplId: null, categoryId: 'cat-1' },
          { cplId: null, categoryId: 'cat-2' },
        ],
      };

      await service.create(mockTenantId, cmDto, mockActorId, mockActorEmail);

      expect(userScopeRepo.create).toHaveBeenCalledTimes(2);
      expect(userScopeRepo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ cplId: undefined, categoryId: 'cat-1' }),
      );
      expect(userScopeRepo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cplId: undefined, categoryId: 'cat-2' }),
      );
    });

    // ── T-096/2 style fault injection: prove the write is wrapped in ONE
    // transaction, not just "looks atomic" from a green test. A mocked
    // DataSource.transaction cannot demonstrate a real ROLLBACK, but it CAN
    // demonstrate that the scope-write failure is not swallowed and reaches
    // the caller — the precondition for a real transaction to roll back the
    // user insert that already ran inside the same callback. ──
    it('atomicity: scope write failing inside the transaction propagates the error (user save had already run and would be rolled back by a real DB transaction)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);
      const dbError = new Error(
        'simulated FK violation on user_scopes (42703)',
      );
      userScopeRepo.save.mockRejectedValue(dbError);

      await expect(
        service.create(
          mockTenantId,
          plannerScopeDto,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(dbError);

      // The user save WAS reached before the scope write failed — this is
      // the part a real transaction would roll back; the mock cannot show
      // the rollback itself, only that the sequence got there.
      expect(userEntityRepo.save).toHaveBeenCalled();
    });

    // ── §2.5 sessiz sıfır yasağı: a role in neither WILDCARD_SCOPE_ROLES
    // nor SCOPE_REQUIRED_ROLES must fail loudly, not silently default. ──
    it('throws (does not silently default) if role falls into neither WILDCARD_SCOPE_ROLES nor SCOPE_REQUIRED_ROLES', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      const dtoWithUnknownRole = {
        email: 'unknown-role@example.com',
        password: 'password123',
        fullName: 'Unknown Role User',
        role: 'SOME_FUTURE_ROLE' as UserRole,
      } as CreateUserDto;

      await expect(
        service.create(
          mockTenantId,
          dtoWithUnknownRole,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow();
      expect(userEntityRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should login successfully and return tokens', async () => {
      const mockUserWithValidate = {
        ...mockUser,
        validatePassword: jest.fn().mockResolvedValue(true),
        lastLoginAt: null,
        loginCount: 0,
        failedLoginAttempts: 0,
        refreshToken: null,
      };

      userRepository.findByEmail.mockResolvedValue(mockUserWithValidate as any);
      jwtService.sign.mockReturnValue('access-token');
      userRepository.save.mockResolvedValue(mockUserWithValidate as any);

      const result = await service.login(mockTenantId, loginDto);

      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        mockTenantId,
        loginDto.email,
      );
      expect(mockUserWithValidate.validatePassword).toHaveBeenCalledWith(
        loginDto.password,
      );
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      await expect(service.login(mockTenantId, loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const mockUserWithInvalidPassword = {
        ...mockUser,
        validatePassword: jest.fn().mockResolvedValue(false),
      };

      userRepository.findByEmail.mockResolvedValue(
        mockUserWithInvalidPassword as any,
      );

      await expect(service.login(mockTenantId, loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for locked account', async () => {
      const lockedUser = {
        ...mockUser,
        status: UserStatus.LOCKED,
        validatePassword: jest.fn().mockResolvedValue(true),
      };

      userRepository.findByEmail.mockResolvedValue(lockedUser as any);

      await expect(service.login(mockTenantId, loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for inactive account', async () => {
      const inactiveUser = {
        ...mockUser,
        status: UserStatus.INACTIVE,
        validatePassword: jest.fn().mockResolvedValue(true),
      };

      userRepository.findByEmail.mockResolvedValue(inactiveUser as any);

      await expect(service.login(mockTenantId, loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all users for tenant', async () => {
      const users = [mockUser];
      userRepository.findAllByTenant.mockResolvedValue(users as any);

      const result = await service.findAll(mockTenantId);

      expect(userRepository.findAllByTenant).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual(users);
    });
  });

  describe('findOne', () => {
    it('should return user by id', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);

      const result = await service.findOne(mockTenantId, mockUserId);

      expect(userRepository.findById).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
      );
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(service.findOne(mockTenantId, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByEmail', () => {
    it('should return user by email', async () => {
      userRepository.findByEmail.mockResolvedValue(mockUser as any);

      const result = await service.findByEmail(mockTenantId, mockUser.email);

      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        mockTenantId,
        mockUser.email,
      );
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      await expect(
        service.findByEmail(mockTenantId, 'notfound@example.com'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const updateUserDto: UpdateUserDto = {
      fullName: 'Updated Name',
    };

    it('should update user successfully', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        ...updateUserDto,
      } as any);

      const result = await service.update(
        mockTenantId,
        mockUserId,
        updateUserDto,
      );

      expect(userRepository.findById).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
      );
      expect(userRepository.save).toHaveBeenCalled();
      expect(result.fullName).toBe(updateUserDto.fullName);
    });

    it('should throw NotFoundException if user not found', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(
        service.update(mockTenantId, mockUserId, updateUserDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should check email uniqueness when updating email', async () => {
      const updateDto: UpdateUserDto = { email: 'newemail@example.com' };
      const existingUser = { ...mockUser, email: 'old@example.com' };
      const conflictingUser = {
        ...mockUser,
        id: 'other-id',
        email: 'newemail@example.com',
      };

      userRepository.findById.mockResolvedValue(existingUser as any);
      userRepository.findByEmail.mockResolvedValue(conflictingUser as any);

      await expect(
        service.update(mockTenantId, mockUserId, updateDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow admin to change other user roles', async () => {
      const updateDto: UpdateUserDto = { role: UserRole.ADMIN };
      const targetUser = { ...mockUser, role: UserRole.PLANNER };

      userRepository.findById.mockResolvedValue(targetUser as any);
      userRepository.save.mockResolvedValue({
        ...targetUser,
        role: UserRole.ADMIN,
      } as any);

      const result = await service.update(
        mockTenantId,
        mockUserId,
        updateDto,
        'admin-id',
        UserRole.ADMIN,
      );

      expect(result.role).toBe(UserRole.ADMIN);
    });

    it('should throw ForbiddenException when non-admin tries to change role', async () => {
      const updateDto: UpdateUserDto = { role: UserRole.ADMIN };
      const targetUser = { ...mockUser, role: UserRole.PLANNER };

      userRepository.findById.mockResolvedValue(targetUser as any);

      await expect(
        service.update(
          mockTenantId,
          mockUserId,
          updateDto,
          'user-id',
          UserRole.PLANNER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when admin tries to change own role', async () => {
      const updateDto: UpdateUserDto = { role: UserRole.PLANNER };
      const adminUser = { ...mockUser, id: 'admin-id', role: UserRole.ADMIN };

      userRepository.findById.mockResolvedValue(adminUser as any);

      await expect(
        service.update(
          mockTenantId,
          'admin-id',
          updateDto,
          'admin-id',
          UserRole.ADMIN,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── [[T-242a]] — kapsam GÜNCELLEME/BOŞALTMA (`PATCH /users/:id/scope`) ──
  //
  // B2 (code-review BLOCKER, 2026-08-20): create()'in A7/J3/J4 testleri
  // `logAdminAction`'ın 12 pozisyonel argümanını AYRI AYRI, `toBe` ile
  // pinliyordu; updateScope() aynı çağrıyı yapıyordu ama bunun hiçbir pini
  // yoktu (`grep -rn "SCOPE_UPDATE|SCOPE_REVOKE_ALL" test/` → 0, pozitif
  // kontrol: `admin_audit_logs` 10+ dosyada eşleşiyor — desen ÇALIŞIYOR,
  // yalnız bu yol hiç kapsanmamıştı). Aynı desen burada TEKRARLANIYOR,
  // yeniden icat edilmiyor.
  describe('updateScope', () => {
    const mockCplId = 'cpl-1';
    const mockCategoryId = 'cat-1';

    // `mockUser`'in KENDİSİ `as any` ile tanımlı (`hashPassword`/
    // `validatePassword` sınıf metodları fixture'da yok) — spread bu
    // metodları YENİDEN kaybeder (TS spread'i DEĞERİN gerçek şeklinden
    // türetir, `mockUser`'in bildirilen tipinden değil). `as unknown as
    // User`, `makeExistingActiveRow`'un zaten kullandığı teknikle AYNI:
    // `no-explicit-any` `any` anahtar kelimesini yakalar, `unknown`'ı
    // değil — davranışsal olarak eşdeğer, lint ratchet'i GEREKSİZ YERE
    // büyütmüyor.
    const plannerUser: User = {
      ...mockUser,
      id: mockUserId,
      role: UserRole.PLANNER,
      tenantId: mockTenantId,
    } as unknown as User;

    // "gerçek eski küme" — B2'nin kabul şartı: before_values.scope BOŞ bir
    // sabit DEĞİL, DB'den okunan (mock'lanan) aktif bir satırdan türüyor.
    //
    // ⚠️ FACTORY, sabit nesne DEĞİL: `updateScope()` `find()`'dan dönen
    // satırları YERİNDE mutasyona uğratıyor (`row.isActive = false`,
    // gerçek TypeORM entity semantiğiyle birebir — `find()` her çağrıda
    // TAZE nesneler döner). Paylaşılan tek bir sabit nesne kullanılsaydı
    // bir testin mutasyonu bir SONRAKİ testin "önceki" durumunu SESSİZCE
    // bozardı (ölçüldü: ilk yazımda TAM BU oldu — UPDATE testi satırı
    // deaktive etti, REVOKE_ALL testi onu zaten deaktive görüp
    // `before_values.scope`'u BOŞ okudu, §2.7 #4'ün "kanıt kurulumu ölçülen
    // durumu değiştiriyor" ailesi).
    const makeExistingActiveRow = (): UserScope =>
      ({
        id: 'scope-row-1',
        tenantId: mockTenantId,
        userId: mockUserId,
        cplId: mockCplId,
        categoryId: null,
        isActive: true,
        createdBy: 'someone-else-999',
        updatedBy: null,
      }) as unknown as UserScope;

    beforeEach(() => {
      userRepository.findById.mockResolvedValue(plannerUser);
      userScopeRepo.create.mockImplementation(
        (data: Partial<UserScope>) => data,
      );
      // updateScope() `save()`'i TEK bir entity ile çağırır (create()'in
      // aksine — orada bir DİZİ save edilir). Pass-through: gönderileni
      // resolve eder.
      userScopeRepo.save.mockImplementation((entity: Partial<UserScope>) =>
        Promise.resolve(entity),
      );
      (adminAuditService.logAdminAction as jest.Mock).mockResolvedValue({
        id: 'audit-log-scope-1',
        isHighRisk: false,
        alertSent: false,
      });
    });

    it('B2: intent=UPDATE — logAdminAction 12 argümanı da ADINA GÖRE pinlenir; before_values GERÇEK eski küme taşır', async () => {
      userScopeRepo.find.mockResolvedValue([makeExistingActiveRow()]);
      categoryRepository.find.mockResolvedValue([
        { id: mockCategoryId } as Category,
      ]);

      await service.updateScope(
        mockTenantId,
        mockUserId,
        {
          intent: ScopeUpdateIntent.UPDATE,
          scope: [{ cplId: null, categoryId: mockCategoryId }],
        } as UpdateUserScopeDto,
        mockActorId,
        mockActorEmail,
        '10.0.0.2',
      );

      expect(adminAuditService.logAdminAction).toHaveBeenCalledTimes(1);
      const call = (adminAuditService.logAdminAction as jest.Mock).mock
        .calls[0];
      const [
        tenantId,
        adminId,
        adminEmail,
        actionType,
        entityType,
        entityId,
        ipAddress,
        result,
        beforeValues,
        afterValues,
        justification,
        options,
      ] = call;

      expect(tenantId).toBe(mockTenantId);
      // Sözlük "kim" = AKTÖR — A1'in kusurunun aynısı burada da tekrarlanmaz.
      expect(adminId).toBe(mockActorId);
      expect(adminId).not.toBe(mockUserId);
      expect(adminEmail).toBe(mockActorEmail);
      expect(actionType).toBe('SCOPE_UPDATE');
      // Z17/m1: 'user' — hedef KULLANICI, kapsam satırı DEĞİL.
      expect(entityType).toBe('user');
      expect(entityId).toBe(mockUserId);
      expect(ipAddress).toBe('10.0.0.2');
      expect(result).toBe('SUCCESS');
      // GERÇEK eski küme — sabit `{scope: []}` DEĞİL (o yalnız create()'in
      // yaratma anı için doğrudur, Z16).
      expect(beforeValues).toEqual({
        scope: [{ cplId: mockCplId, categoryId: null }],
      });
      expect(afterValues).toEqual({
        scope: [{ cplId: null, categoryId: mockCategoryId }],
      });
      expect(justification).toBeUndefined();
      // J4 (aynı ders): KİMLİK, `expect.anything()` değil.
      expect(options.manager).toBe(mockManager);

      // T-014 kalıbı: commit'ten SONRA flush edilir.
      expect(adminAuditService.flushPendingAlert).toHaveBeenCalledTimes(1);
    });

    it('B2: intent=REVOKE_ALL — action_type SCOPE_REVOKE_ALL, after boş küme, justification DOLU', async () => {
      userScopeRepo.find.mockResolvedValue([makeExistingActiveRow()]);

      await service.updateScope(
        mockTenantId,
        mockUserId,
        {
          intent: ScopeUpdateIntent.REVOKE_ALL,
          scope: [],
          reason: 'kasıtlı boşaltma — B2 pin testi',
        } as UpdateUserScopeDto,
        mockActorId,
        mockActorEmail,
      );

      const call = (adminAuditService.logAdminAction as jest.Mock).mock
        .calls[0];
      const [
        ,
        ,
        ,
        actionType,
        ,
        ,
        ,
        ,
        beforeValues,
        afterValues,
        justification,
      ] = call;

      expect(actionType).toBe('SCOPE_REVOKE_ALL');
      expect(beforeValues).toEqual({
        scope: [{ cplId: mockCplId, categoryId: null }],
      });
      expect(afterValues).toEqual({ scope: [] });
      expect(justification).toBe('kasıtlı boşaltma — B2 pin testi');
    });

    // ── atomiklik pini — create()'in "atomicity: scope write failing..."
    // testiyle AYNI desen (satır 687 civarı): gerçek bir DB ROLLBACK'ini
    // HTTP/unit katmanından tetiklemek mümkün değil; burada kanıtlanan,
    // kapsam satırı yazımı BAŞARISIZ olursa denetim kaydının HİÇ
    // yazılmadığı (transaction'ın İÇİNDE, satır yazımından SONRA çağrılıyor
    // — bir rollback denetim kaydını da geri alırdı).
    it('atomiklik: kapsam satırı yazımı başarısız olursa logAdminAction HİÇ çağrılmaz, clearCache de çağrılmaz', async () => {
      userScopeRepo.find.mockResolvedValue([]);
      categoryRepository.find.mockResolvedValue([
        { id: mockCategoryId } as Category,
      ]);
      const dbError = new Error(
        'simulated constraint violation on user_scopes',
      );
      userScopeRepo.save.mockRejectedValue(dbError);

      await expect(
        service.updateScope(
          mockTenantId,
          mockUserId,
          {
            intent: ScopeUpdateIntent.UPDATE,
            scope: [{ cplId: null, categoryId: mockCategoryId }],
          } as UpdateUserScopeDto,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(dbError);

      expect(adminAuditService.logAdminAction).not.toHaveBeenCalled();
      // m1: cache invalidasyonu commit'ten SONRA çağrılır — bir transaction
      // hiç commit olmadıysa (burada: hiç bitmediyse) çağrılmamalıdır.
      expect(accessScopeService.clearCache).not.toHaveBeenCalled();
    });

    // ── m1 — cache invalidasyonu (code-review MINOR→düzelt) ──────────────
    it('m1: clearCache() başarılı bir updateScope sonrası (REVOKE_ALL dahil) çağrılır', async () => {
      userScopeRepo.find.mockResolvedValue([makeExistingActiveRow()]);

      await service.updateScope(
        mockTenantId,
        mockUserId,
        {
          intent: ScopeUpdateIntent.REVOKE_ALL,
          scope: [],
          reason: 'm1 pin testi',
        } as UpdateUserScopeDto,
        mockActorId,
        mockActorEmail,
      );

      expect(accessScopeService.clearCache).toHaveBeenCalledTimes(1);
    });

    it('m1: clearCache() intent=UPDATE sonrası da çağrılır', async () => {
      userScopeRepo.find.mockResolvedValue([makeExistingActiveRow()]);
      categoryRepository.find.mockResolvedValue([
        { id: mockCategoryId } as Category,
      ]);

      await service.updateScope(
        mockTenantId,
        mockUserId,
        {
          intent: ScopeUpdateIntent.UPDATE,
          scope: [{ cplId: null, categoryId: mockCategoryId }],
        } as UpdateUserScopeDto,
        mockActorId,
        mockActorEmail,
      );

      expect(accessScopeService.clearCache).toHaveBeenCalledTimes(1);
    });

    // ── M2 (code-review MAJOR→düzelt) — reaktivasyonda createdBy GÜNCELLENİR
    it('M2: reaktive edilen satırda createdBy GÜNCEL AKTÖRE yazılır (bayat eski vericide KALMAZ) — İKİ FARKLI aktör', async () => {
      // İki farklı aktör KASITLI (code-reviewer'ın kendi probunun
      // ayıramadığı vaka, §2.7 #6): admin1 önce boşaltır (satır isActive
      // false olur), admin2 AYNI çifti geri verir (reaktivasyon).
      const admin1 = 'admin-actor-A';
      const admin2 = 'admin-actor-B';
      const inactiveRow = { ...makeExistingActiveRow(), isActive: false };
      // `updateScope` bu nesneyi YERİNDE mutasyona uğratır (gerçek TypeORM
      // entity semantiği) — bayat değeri ÖNCEDEN, mutasyondan ÖNCE yakala.
      // Mutasyondan SONRA `inactiveRow.createdBy` zaten YENİ değeri taşır
      // (aynı referans `save()`'e geçiyor), o yüzden bu değişkene ihtiyaç var.
      const originalCreatedBy = inactiveRow.createdBy;
      userScopeRepo.find.mockResolvedValue([inactiveRow]);
      cplRepository.find.mockResolvedValue([{ id: mockCplId } as Cpl]);

      await service.updateScope(
        mockTenantId,
        mockUserId,
        {
          intent: ScopeUpdateIntent.UPDATE,
          scope: [{ cplId: mockCplId, categoryId: null }],
        } as UpdateUserScopeDto,
        admin2,
        'admin-b@example.com',
      );

      const savedRow = (userScopeRepo.save as jest.Mock).mock
        .calls[0][0] as Partial<UserScope>;
      expect(savedRow.createdBy).toBe(admin2);
      expect(savedRow.createdBy).not.toBe(admin1);
      expect(savedRow.createdBy).not.toBe(originalCreatedBy);
      expect(originalCreatedBy).toBe('someone-else-999');
      expect(savedRow.updatedBy).toBe(admin2);
    });

    it('WILDCARD_SCOPE_ROLES (ör. FINANCE) bu uçtan yönetilemez — 400, kapsam yazılmaz', async () => {
      userRepository.findById.mockResolvedValue({
        ...mockUser,
        role: UserRole.FINANCE,
      } as unknown as User);

      await expect(
        service.updateScope(
          mockTenantId,
          mockUserId,
          {
            intent: ScopeUpdateIntent.UPDATE,
            scope: [{ cplId: mockCplId, categoryId: null }],
          } as UpdateUserScopeDto,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(userScopeRepo.save).not.toHaveBeenCalled();
    });

    it('§2.5: intent=UPDATE + boş scope → RET (sessiz temizleme yok)', async () => {
      await expect(
        service.updateScope(
          mockTenantId,
          mockUserId,
          { intent: ScopeUpdateIntent.UPDATE, scope: [] } as UpdateUserScopeDto,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('§2.5: intent=REVOKE_ALL + gerekçesiz → RET', async () => {
      await expect(
        service.updateScope(
          mockTenantId,
          mockUserId,
          {
            intent: ScopeUpdateIntent.REVOKE_ALL,
            scope: [],
          } as UpdateUserScopeDto,
          mockActorId,
          mockActorEmail,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should soft remove user', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.softRemove.mockResolvedValue(mockUser as any);

      await service.remove(mockTenantId, mockUserId);

      expect(userRepository.findById).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
      );
      expect(userRepository.softRemove).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('changePassword', () => {
    const changePasswordDto: ChangePasswordDto = {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    };

    it('should change password successfully', async () => {
      const userWithValidate = {
        ...mockUser,
        validatePassword: jest.fn().mockResolvedValue(true),
        passwordChangedAt: null,
        mustChangePassword: false,
      };

      userRepository.findById.mockResolvedValue(userWithValidate as any);
      userRepository.save.mockResolvedValue(userWithValidate as any);

      await service.changePassword(mockTenantId, mockUserId, changePasswordDto);

      expect(userWithValidate.validatePassword).toHaveBeenCalledWith(
        changePasswordDto.currentPassword,
      );
      expect(bcrypt.hash).toHaveBeenCalledWith(
        changePasswordDto.newPassword,
        10,
      );
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for incorrect current password', async () => {
      const userWithInvalidPassword = {
        ...mockUser,
        validatePassword: jest.fn().mockResolvedValue(false),
      };

      userRepository.findById.mockResolvedValue(userWithInvalidPassword as any);

      await expect(
        service.changePassword(mockTenantId, mockUserId, changePasswordDto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('activate', () => {
    it('should activate user', async () => {
      const inactiveUser = { ...mockUser, status: UserStatus.INACTIVE };
      userRepository.findById.mockResolvedValue(inactiveUser as any);
      userRepository.save.mockResolvedValue({
        ...inactiveUser,
        status: UserStatus.ACTIVE,
      } as any);

      const result = await service.activate(mockTenantId, mockUserId);

      expect(result.status).toBe(UserStatus.ACTIVE);
    });
  });

  describe('deactivate', () => {
    it('should deactivate user', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        status: UserStatus.INACTIVE,
      } as any);

      const result = await service.deactivate(mockTenantId, mockUserId);

      expect(result.status).toBe(UserStatus.INACTIVE);
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const payload = {
        sub: mockUserId,
        email: mockUser.email,
        role: mockUser.role,
        tenantId: mockTenantId,
      };
      const refreshToken = 'refresh-token';
      const userWithRefreshToken = {
        ...mockUser,
        refreshToken,
        status: UserStatus.ACTIVE,
      };

      jwtService.verify.mockReturnValue(payload as any);
      userRepository.findOne.mockResolvedValue(userWithRefreshToken as any);
      jwtService.sign.mockReturnValue('new-access-token');
      userRepository.save.mockResolvedValue(userWithRefreshToken as any);

      const result = await service.refreshToken(refreshToken);

      expect(jwtService.verify).toHaveBeenCalledWith(refreshToken);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: payload.sub, refreshToken },
      });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const payload = { sub: mockUserId };
      jwtService.verify.mockReturnValue(payload as any);
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.refreshToken('refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should logout user by clearing refresh token', async () => {
      const userWithToken = { ...mockUser, refreshToken: 'refresh-token' };
      userRepository.findById.mockResolvedValue(userWithToken as any);
      userRepository.save.mockResolvedValue({
        ...userWithToken,
        refreshToken: undefined,
      } as any);

      await service.logout(mockTenantId, mockUserId);

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: undefined }),
      );
    });
  });

  // T-253: `getDashboardSummary` describe bloğu kaldırıldı — metot silindi.
  // Not: bu iki test yalnız `tenantId` geçiyordu, hiçbir zaman iki farklı
  // userId/role için farklı sonuç sınamıyordu — yani kusuru (kapsamsız
  // sorgu) PİNLİYORDU, ondan korumuyordu.
});
