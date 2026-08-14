import {
  Entity,
  Column,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  TRIAL = 'TRIAL',
}

export enum TenantPlan {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

@Entity({ name: 'tenants', schema: 'main' })
@Index(['domain'], { unique: true, where: '"domain" IS NOT NULL' })
@Index(['status'])
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 200, unique: true })
  @Index()
  name!: string;

  @Column({ length: 100, unique: true, nullable: true })
  domain?: string;

  @Column({
    type: 'enum',
    enum: TenantStatus,
    default: TenantStatus.TRIAL,
  })
  status!: TenantStatus;

  @Column({
    type: 'enum',
    enum: TenantPlan,
    default: TenantPlan.FREE,
  })
  plan!: TenantPlan;

  // Contact Information
  @Column({ name: 'contact_email', length: 255, nullable: true })
  contactEmail?: string;

  @Column({ name: 'contact_phone', length: 50, nullable: true })
  contactPhone?: string;

  @Column({ name: 'contact_person', length: 200, nullable: true })
  contactPerson?: string;

  // Address Information
  @Column({ length: 255, nullable: true })
  address?: string;

  @Column({ length: 100, nullable: true })
  city?: string;

  @Column({ length: 100, nullable: true })
  country?: string;

  @Column({ name: 'postal_code', length: 20, nullable: true })
  postalCode?: string;

  // Business Information
  @Column({ name: 'tax_number', length: 50, nullable: true })
  taxNumber?: string;

  @Column({ name: 'company_registration_number', length: 50, nullable: true })
  companyRegistrationNumber?: string;

  @Column({ length: 100, nullable: true })
  industry?: string;

  // Settings
  @Column({ type: 'jsonb', nullable: true })
  settings?: {
    defaultCurrency?: string;
    fiscalYearStart?: string; // MM-DD format
    timezone?: string;
    dateFormat?: string;
    numberFormat?: string;
    features?: {
      advancedAnalytics?: boolean;
      apiAccess?: boolean;
      customReports?: boolean;
      bulkImport?: boolean;
    };
  };

  // Subscription & Limits
  @Column({ name: 'subscription_start_date', type: 'date', nullable: true })
  subscriptionStartDate?: Date;

  @Column({ name: 'subscription_end_date', type: 'date', nullable: true })
  subscriptionEndDate?: Date;

  @Column({ name: 'max_users', type: 'int', default: 5 })
  maxUsers!: number;

  @Column({ name: 'max_storage_gb', type: 'int', default: 10 })
  maxStorageGB!: number;

  // ⛔ Transformer YOK — bilerek. Para/oran/birim-fiyat DOMAIN'İNİN tamamen
  // dışında: altyapı kotası (GB). İki transformer kararının (Money/UnitPrice)
  // kapsamına hiç girmiyor (T-197/T-221 ikinci yarı).
  @Column({
    name: 'current_storage_gb',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  currentStorageGB!: number;

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // Timestamps
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;

  // Relations
  @OneToMany(() => User, (user) => user.tenant)
  users!: User[];
}
