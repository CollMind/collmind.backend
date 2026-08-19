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
import { Plan, PlanStatus } from '../../database/entities/plan.entity';
import {
  Agreement,
  AgreementStatus,
} from '../../database/entities/agreement.entity';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../../database/entities/budget-envelope.entity';
import { UserScope } from '../../database/entities/user-scope.entity';
import { Cpl } from '../../database/entities/cpl.entity';
import { Category } from '../../database/entities/category.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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
  let planRepository: jest.Mocked<Repository<Plan>>;
  let agreementRepository: jest.Mocked<Repository<Agreement>>;
  let budgetEnvelopeRepository: jest.Mocked<Repository<BudgetEnvelope>>;
  let cplRepository: jest.Mocked<Repository<Cpl>>;
  let categoryRepository: jest.Mocked<Repository<Category>>;
  // T-241: create() now writes User + UserScope inside ONE
  // `dataSource.transaction`. The mock runs the callback synchronously with a
  // manager whose `getRepository` hands back these SAME mocks, so the
  // transactional path is exercised (not stubbed away) — same pattern as
  // budget-allocation.service.spec.ts (T-096/2).
  type MockEntityRepo = { create: jest.Mock; save: jest.Mock };
  let userEntityRepo: MockEntityRepo;
  let userScopeRepo: MockEntityRepo;

  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-123';
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
    userEntityRepo = { create: jest.fn(), save: jest.fn() };
    userScopeRepo = { create: jest.fn(), save: jest.fn() };

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
          provide: getRepositoryToken(Plan),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Agreement),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(BudgetEnvelope),
          useValue: {
            find: jest.fn(),
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
          useValue: {
            transaction: (
              cb: (manager: {
                getRepository: (
                  entity: typeof User | typeof UserScope,
                ) => MockEntityRepo;
              }) => Promise<User>,
            ) =>
              cb({
                getRepository: (
                  entity: typeof User | typeof UserScope,
                ): MockEntityRepo => {
                  if (entity === User) return userEntityRepo;
                  if (entity === UserScope) return userScopeRepo;
                  throw new Error(
                    `unexpected entity passed to manager.getRepository in test: ${entity.name}`,
                  );
                },
              }),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(UserRepository) as jest.Mocked<UserRepository>;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    planRepository = module.get(getRepositoryToken(Plan)) as jest.Mocked<
      Repository<Plan>
    >;
    agreementRepository = module.get(
      getRepositoryToken(Agreement),
    ) as jest.Mocked<Repository<Agreement>>;
    budgetEnvelopeRepository = module.get(
      getRepositoryToken(BudgetEnvelope),
    ) as jest.Mocked<Repository<BudgetEnvelope>>;
    cplRepository = module.get(getRepositoryToken(Cpl)) as jest.Mocked<
      Repository<Cpl>
    >;
    categoryRepository = module.get(
      getRepositoryToken(Category),
    ) as jest.Mocked<Repository<Category>>;

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
    });

    it('should create a PLANNER with the given scope, atomically (user + scope in one transaction)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);

      const result = await service.create(mockTenantId, plannerScopeDto);

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
        }),
      );
      expect(userScopeRepo.save).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: mockUserId }));
    });

    it('should throw ConflictException if user with email already exists (no writes attempted)', async () => {
      userRepository.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.create(mockTenantId, plannerScopeDto),
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
        service.create(mockTenantId, dtoWithoutScope),
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
        service.create(mockTenantId, dtoWithEmptyScope),
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

      await service.create(mockTenantId, adminDto);

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

    it('ignores a caller-supplied scope for a wildcard role (ADMIN) and still writes only the wildcard row', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      // ADMIN is a wildcard role — CreateUserDto's `scope` field is ignored
      // for it by design (see create-user.dto.ts). This DTO shape is only
      // reachable by calling the service directly (ValidateIf wouldn't even
      // require it), so this proves the SERVICE, not just the DTO, enforces
      // "wildcard roles always get exactly the wildcard row".
      const adminDtoWithScope = {
        email: 'admin3@example.com',
        password: 'password123',
        fullName: 'New Admin 3',
        role: UserRole.ADMIN,
        scope: [{ cplId: 'cpl-1', categoryId: null }],
      } as CreateUserDto;

      await service.create(mockTenantId, adminDtoWithScope);

      expect(userScopeRepo.create).toHaveBeenCalledTimes(1);
      expect(userScopeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ cplId: undefined, categoryId: undefined }),
      );
    });

    it('every successfully created user has >=1 scope row written (invariant, PLANNER + ADMIN)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([{ id: 'cpl-1' } as Cpl]);

      await service.create(mockTenantId, plannerScopeDto);
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
      await service.create(mockTenantId, adminDto);
      expect(
        (userScopeRepo.save as jest.Mock).mock.calls[0][0].length,
      ).toBeGreaterThanOrEqual(1);
    });

    // ── Multi-tenant izolasyon ──

    it('rejects a scope referencing a cplId from another tenant with 400 (cross-tenant leak guard)', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      cplRepository.find.mockResolvedValue([]); // not found for THIS tenant

      await expect(
        service.create(mockTenantId, plannerScopeDto),
      ).rejects.toThrow(BadRequestException);
      expect(userEntityRepo.create).not.toHaveBeenCalled();
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

      await service.create(mockTenantId, cmDto);

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
        service.create(mockTenantId, plannerScopeDto),
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
        service.create(mockTenantId, dtoWithUnknownRole),
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

  describe('getDashboardSummary', () => {
    it('should return dashboard summary with correct calculations', async () => {
      const plans = [
        { id: '1', status: PlanStatus.APPROVED },
        { id: '2', status: PlanStatus.DRAFT },
      ] as Plan[];

      const agreements = [
        { id: '1', status: AgreementStatus.ACTIVE },
        { id: '2', status: AgreementStatus.DRAFT },
      ] as Agreement[];

      const envelopes = [
        {
          id: '1',
          status: BudgetEnvelopeStatus.ACTIVE,
          allocatedAmount: 1000,
          consumedAmount: 500,
          period: 'Q1',
        },
        {
          id: '2',
          status: BudgetEnvelopeStatus.ACTIVE,
          allocatedAmount: 2000,
          consumedAmount: 1000,
          period: 'Q1',
        },
      ] as any[];

      planRepository.find.mockResolvedValue(plans);
      agreementRepository.find.mockResolvedValue(agreements);
      budgetEnvelopeRepository.find.mockResolvedValue(envelopes);

      const result = await service.getDashboardSummary(mockTenantId);

      expect(result).toHaveProperty('activeOperations');
      expect(result).toHaveProperty('drafts');
      expect(result).toHaveProperty('managedBudget');
      expect(result).toHaveProperty('budgetUsage');
      expect(result.activeOperations).toBe(2); // 1 approved plan + 1 active agreement
      expect(result.drafts).toBe(2); // 1 draft plan + 1 draft agreement
      expect(result.managedBudget).toBe(3000); // 1000 + 2000
      expect(result.budgetUsage).toBe(50); // (500 + 1000) / (1000 + 2000) * 100
    });

    it('should handle empty data correctly', async () => {
      planRepository.find.mockResolvedValue([]);
      agreementRepository.find.mockResolvedValue([]);
      budgetEnvelopeRepository.find.mockResolvedValue([]);

      const result = await service.getDashboardSummary(mockTenantId);

      expect(result.activeOperations).toBe(0);
      expect(result.drafts).toBe(0);
      expect(result.managedBudget).toBe(0);
      expect(result.budgetUsage).toBe(0);
    });
  });
});
