import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { User, UserStatus, UserRole } from '../../database/entities/user.entity';
import { Plan, PlanStatus } from '../../database/entities/plan.entity';
import { Agreement, AgreementStatus } from '../../database/entities/agreement.entity';
import { BudgetEnvelope, BudgetEnvelopeStatus } from '../../database/entities/budget-envelope.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
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
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(UserRepository) as jest.Mocked<UserRepository>;
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    planRepository = module.get(getRepositoryToken(Plan)) as jest.Mocked<Repository<Plan>>;
    agreementRepository = module.get(getRepositoryToken(Agreement)) as jest.Mocked<Repository<Agreement>>;
    budgetEnvelopeRepository = module.get(getRepositoryToken(BudgetEnvelope)) as jest.Mocked<Repository<BudgetEnvelope>>;

    // Mock bcrypt
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createUserDto: CreateUserDto = {
      email: 'newuser@example.com',
      password: 'password123',
      fullName: 'New User',
      role: UserRole.PLANNER,
    };

    it('should create a new user successfully', async () => {
      userRepository.findByEmail.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);

      const result = await service.create(mockTenantId, createUserDto);

      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        mockTenantId,
        createUserDto.email,
      );
      expect(bcrypt.hash).toHaveBeenCalledWith(createUserDto.password, 10);
      expect(userRepository.create).toHaveBeenCalled();
      expect(userRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('should throw ConflictException if user with email already exists', async () => {
      userRepository.findByEmail.mockResolvedValue(mockUser);

      await expect(service.create(mockTenantId, createUserDto)).rejects.toThrow(
        ConflictException,
      );
      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        mockTenantId,
        createUserDto.email,
      );
      expect(userRepository.create).not.toHaveBeenCalled();
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

      userRepository.findByEmail.mockResolvedValue(mockUserWithInvalidPassword as any);

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

      expect(userRepository.findById).toHaveBeenCalledWith(mockTenantId, mockUserId);
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
      userRepository.save.mockResolvedValue({ ...mockUser, ...updateUserDto } as any);

      const result = await service.update(
        mockTenantId,
        mockUserId,
        updateUserDto,
      );

      expect(userRepository.findById).toHaveBeenCalledWith(mockTenantId, mockUserId);
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
      const conflictingUser = { ...mockUser, id: 'other-id', email: 'newemail@example.com' };

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
      userRepository.save.mockResolvedValue({ ...targetUser, role: UserRole.ADMIN } as any);

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
        service.update(mockTenantId, mockUserId, updateDto, 'user-id', UserRole.PLANNER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when admin tries to change own role', async () => {
      const updateDto: UpdateUserDto = { role: UserRole.PLANNER };
      const adminUser = { ...mockUser, id: 'admin-id', role: UserRole.ADMIN };

      userRepository.findById.mockResolvedValue(adminUser as any);

      await expect(
        service.update(mockTenantId, 'admin-id', updateDto, 'admin-id', UserRole.ADMIN),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('should soft remove user', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.softRemove.mockResolvedValue(mockUser as any);

      await service.remove(mockTenantId, mockUserId);

      expect(userRepository.findById).toHaveBeenCalledWith(mockTenantId, mockUserId);
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
      expect(bcrypt.hash).toHaveBeenCalledWith(changePasswordDto.newPassword, 10);
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
      userRepository.save.mockResolvedValue({ ...inactiveUser, status: UserStatus.ACTIVE } as any);

      const result = await service.activate(mockTenantId, mockUserId);

      expect(result.status).toBe(UserStatus.ACTIVE);
    });
  });

  describe('deactivate', () => {
    it('should deactivate user', async () => {
      userRepository.findById.mockResolvedValue(mockUser as any);
      userRepository.save.mockResolvedValue({ ...mockUser, status: UserStatus.INACTIVE } as any);

      const result = await service.deactivate(mockTenantId, mockUserId);

      expect(result.status).toBe(UserStatus.INACTIVE);
    });
  });

  describe('refreshToken', () => {
    it('should refresh token successfully', async () => {
      const payload = { sub: mockUserId, email: mockUser.email, role: mockUser.role, tenantId: mockTenantId };
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
      userRepository.save.mockResolvedValue({ ...userWithToken, refreshToken: undefined } as any);

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
