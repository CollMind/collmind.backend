import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from './user.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { User, UserStatus } from '../../database/entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
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

  async update(tenantId: string, id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(tenantId, id);

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
}

