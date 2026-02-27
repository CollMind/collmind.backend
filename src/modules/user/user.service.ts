import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRepository } from './user.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { User, UserStatus, UserRole } from '../../database/entities/user.entity';
import { Plan, PlanStatus } from '../../database/entities/plan.entity';
import { Agreement, AgreementStatus } from '../../database/entities/agreement.entity';
import { BudgetEnvelope, BudgetEnvelopeStatus } from '../../database/entities/budget-envelope.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(Agreement)
    private readonly agreementRepository: Repository<Agreement>,
    @InjectRepository(BudgetEnvelope)
    private readonly budgetEnvelopeRepository: Repository<BudgetEnvelope>,
  ) {}

  async create(tenantId: string, createUserDto: CreateUserDto): Promise<User> {
    const existing = await this.userRepository.findByEmail(tenantId, createUserDto.email);
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(createUserDto.password, 10);

    const user = this.userRepository.create({
      ...createUserDto,
      tenantId,
      passwordHash,
    });

    return this.userRepository.save(user);
  }

  async login(tenantId: string, loginDto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.userRepository.findByEmail(tenantId, loginDto.email);

    if (!user || !(await user.validatePassword(loginDto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.LOCKED) {
      throw new UnauthorizedException('Account is locked');
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Generate tokens
    const payload = { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    // Update user
    user.lastLoginAt = new Date();
    user.loginCount++;
    user.failedLoginAttempts = 0;
    user.refreshToken = refreshToken;
    await this.userRepository.save(user);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async findAll(tenantId: string): Promise<User[]> {
    return this.userRepository.findAllByTenant(tenantId);
  }

  async findOne(tenantId: string, id: string): Promise<User> {
    const user = await this.userRepository.findById(tenantId, id);

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(tenantId: string, email: string): Promise<User> {
    const user = await this.userRepository.findByEmail(tenantId, email);

    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }

    return user;
  }

  async findByEmailWithoutTenant(email: string): Promise<User | null> {
    return this.userRepository.findByEmailWithoutTenant(email);
  }

  async update(
    tenantId: string,
    id: string,
    updateUserDto: UpdateUserDto,
    currentUserId?: string,
    currentUserRole?: UserRole,
  ): Promise<User> {
    const user = await this.findOne(tenantId, id);

    // Security: Prevent role escalation - only admins can change roles, and only for other users
    if (updateUserDto.role && updateUserDto.role !== user.role) {
      // Non-admin users cannot change any role (including their own)
      if (currentUserRole !== UserRole.ADMIN) {
        throw new ForbiddenException('Only administrators can change user roles');
      }
      // Admins cannot modify their own role
      if (currentUserId === id) {
        throw new ForbiddenException('Admins cannot modify their own role permissions');
      }
      // Log high-risk action
      console.warn('EA-001: Admin attempting role change', {
        adminId: currentUserId,
        targetUserId: id,
        oldRole: user.role,
        newRole: updateUserDto.role,
      });
    }

    // Check email uniqueness if changing
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existing = await this.userRepository.findByEmail(tenantId, updateUserDto.email);
      if (existing) {
        throw new ConflictException('User with this email already exists');
      }
    }

    Object.assign(user, updateUserDto);
    return this.userRepository.save(user);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const user = await this.findOne(tenantId, id);
    await this.userRepository.softRemove(user);
  }

  async changePassword(
    tenantId: string,
    id: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.findOne(tenantId, id);

    const isValid = await user.validatePassword(changePasswordDto.currentPassword);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(changePasswordDto.newPassword, 10);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await this.userRepository.save(user);
  }

  async activate(tenantId: string, id: string): Promise<User> {
    const user = await this.findOne(tenantId, id);
    user.status = UserStatus.ACTIVE;
    return this.userRepository.save(user);
  }

  async deactivate(tenantId: string, id: string): Promise<User> {
    const user = await this.findOne(tenantId, id);
    user.status = UserStatus.INACTIVE;
    return this.userRepository.save(user);
  }

  async getProfile(tenantId: string, id: string): Promise<User> {
    return this.findOne(tenantId, id);
  }

  async refreshToken(refreshToken: string): Promise<LoginResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.userRepository.findOne({
        where: { id: payload.sub, refreshToken },
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      };

      const accessToken = this.jwtService.sign(newPayload);
      const newRefreshToken = this.jwtService.sign(newPayload, { expiresIn: '7d' });

      user.refreshToken = newRefreshToken;
      await this.userRepository.save(user);

      return {
        accessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          tenantId: user.tenantId,
        },
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(tenantId: string, id: string): Promise<void> {
    const user = await this.findOne(tenantId, id);
    user.refreshToken = undefined;
    await this.userRepository.save(user);
  }

  async getDashboardSummary(tenantId: string) {
    // Get all plans and agreements (excluding soft-deleted)
    const [plans, agreements, envelopes] = await Promise.all([
      this.planRepository.find({
        where: { tenantId },
        select: ['id', 'status'],
      }),
      this.agreementRepository.find({
        where: { tenantId },
        select: ['id', 'status'],
      }),
      this.budgetEnvelopeRepository.find({
        where: { tenantId },
        select: ['id', 'status', 'allocatedAmount', 'consumedAmount', 'period'],
      }),
    ]);

    // Calculate active operations (APPROVED plans + ACTIVE/APPROVED agreements)
    const activePlans = plans.filter((p) => p.status === PlanStatus.APPROVED);
    const activeAgreements = agreements.filter(
      (a) => a.status === AgreementStatus.ACTIVE || a.status === AgreementStatus.APPROVED,
    );
    const activeOperations = activePlans.length + activeAgreements.length;

    // Calculate drafts (DRAFT plans + DRAFT agreements)
    const draftPlans = plans.filter((p) => p.status === PlanStatus.DRAFT);
    const draftAgreements = agreements.filter((a) => a.status === AgreementStatus.DRAFT);
    const drafts = draftPlans.length + draftAgreements.length;

    // Calculate managed budget (total allocated amount from all active envelopes)
    const activeEnvelopes = envelopes.filter((e) => e.status === BudgetEnvelopeStatus.ACTIVE);
    const managedBudget = activeEnvelopes.reduce(
      (sum, e) => sum + Number(e.allocatedAmount || 0),
      0,
    );

    // Calculate Q1 budget status (usage percentage)
    // Get current quarter
    const now = new Date();
    const currentYear = now.getFullYear();
    const q1Envelopes = activeEnvelopes.filter(
      (e) => e.period === 'Q1' || e.period?.startsWith(`${currentYear}-Q1`),
    );

    let budgetUsage = 0;
    if (q1Envelopes.length > 0) {
      const totalAllocated = q1Envelopes.reduce(
        (sum, e) => sum + Number(e.allocatedAmount || 0),
        0,
      );
      const totalConsumed = q1Envelopes.reduce(
        (sum, e) => sum + Number(e.consumedAmount || 0),
        0,
      );
      if (totalAllocated > 0) {
        budgetUsage = (totalConsumed / totalAllocated) * 100;
      }
    }

    return {
      activeOperations,
      drafts,
      managedBudget,
      budgetUsage: Math.round(budgetUsage * 10) / 10, // Round to 1 decimal place
    };
  }
}

