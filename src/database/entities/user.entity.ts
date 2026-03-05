import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import * as bcrypt from 'bcrypt';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

export enum UserRole {
  ADMIN = 'ADMIN',
  PLANNER = 'PLANNER',
  MANAGER = 'MANAGER',       // Replaces APPROVER — approves plans and agreements
  FINANCE = 'FINANCE',
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  CATEGORY_MANAGER = 'CATEGORY_MANAGER',
  READONLY = 'READONLY',     // Read-only access — all GET endpoints, no write

  /** @deprecated Use MANAGER instead. Will be removed in a future migration. */
  APPROVER = 'APPROVER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  LOCKED = 'LOCKED',
}

@Entity({ name: 'users', schema: 'main' })
@Index(['tenantId', 'email'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['role'])
export class User extends BaseEntity {
  @Column({ length: 200 })
  email!: string;

  @Column({ name: 'password_hash', length: 255 })
  @Exclude()
  passwordHash!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.PLANNER,
  })
  role!: UserRole;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING,
  })
  status!: UserStatus;

  @Column({ name: 'full_name', length: 200 })
  fullName!: string;

  @Column({ name: 'first_name', length: 100, nullable: true })
  firstName?: string;

  @Column({ name: 'last_name', length: 100, nullable: true })
  lastName?: string;

  @Column({ name: 'phone_number', length: 50, nullable: true })
  phoneNumber?: string;

  @Column({ length: 100, nullable: true })
  department?: string;

  @Column({ name: 'job_title', length: 100, nullable: true })
  jobTitle?: string;

  // Avatar/Profile
  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl?: string;

  // Authentication
  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'login_count', type: 'int', default: 0 })
  loginCount!: number;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true })
  lockedUntil?: Date;

  @Column({ name: 'password_changed_at', type: 'timestamp', nullable: true })
  passwordChangedAt?: Date;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  // Refresh Token
  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  @Exclude()
  refreshToken?: string;

  // Email Verification
  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ name: 'email_verification_token', type: 'text', nullable: true })
  @Exclude()
  emailVerificationToken?: string;

  @Column({ name: 'email_verification_expires', type: 'timestamp', nullable: true })
  emailVerificationExpires?: Date;

  // Password Reset
  @Column({ name: 'password_reset_token', type: 'text', nullable: true })
  @Exclude()
  passwordResetToken?: string;

  @Column({ name: 'password_reset_expires', type: 'timestamp', nullable: true })
  passwordResetExpires?: Date;

  // Preferences
  @Column({ type: 'jsonb', nullable: true })
  preferences?: {
    language?: string;
    timezone?: string;
    dateFormat?: string;
    notifications?: {
      email?: boolean;
      inApp?: boolean;
      mobile?: boolean;
    };
    theme?: 'light' | 'dark' | 'auto';
  };

  // Permissions (for fine-grained access control)
  @Column({ type: 'jsonb', nullable: true })
  permissions?: string[];

  // Relations
  @ManyToOne(() => Tenant, (tenant) => tenant.users)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.passwordHash && !this.passwordHash.startsWith('$2b$')) {
      this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
    }
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  }
}

