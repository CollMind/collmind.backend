import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { Cpl } from './cpl.entity';

export enum CustomerChannel {
  NKA = 'NKA',
  TRADITIONAL_TRADE = 'TRADITIONAL_TRADE',
  E_COMMERCE = 'E_COMMERCE',
  EXPORT = 'EXPORT',
  WHOLESALE = 'WHOLESALE',
  RETAIL = 'RETAIL',
  HORECA = 'HORECA',
}

export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  SUSPENDED = 'SUSPENDED',
}

export enum CustomerType {
  DIRECT = 'DIRECT',
  DISTRIBUTOR = 'DISTRIBUTOR',
  WHOLESALER = 'WHOLESALER',
  RETAILER = 'RETAILER',
  END_CUSTOMER = 'END_CUSTOMER',
}

@Entity({ name: 'customers', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['channel'])
@Index(['city'])
export class Customer extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({
    type: 'enum',
    enum: CustomerChannel,
  })
  channel!: CustomerChannel;

  @Column({
    type: 'enum',
    enum: CustomerType,
    default: CustomerType.DIRECT,
  })
  type!: CustomerType;

  @Column({
    type: 'enum',
    enum: CustomerStatus,
    default: CustomerStatus.ACTIVE,
  })
  status!: CustomerStatus;

  // Location Information
  @Column({ length: 100, nullable: true })
  city?: string;

  @Column({ length: 100, nullable: true })
  district?: string;

  @Column({ length: 100, nullable: true })
  region?: string;

  @Column({ length: 100, nullable: true })
  country?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ name: 'postal_code', length: 20, nullable: true })
  postalCode?: string;

  // Business Information
  @Column({ name: 'tax_number', length: 50, nullable: true })
  taxNumber?: string;

  @Column({ name: 'tax_office', length: 100, nullable: true })
  taxOffice?: string;

  @Column({ name: 'company_registration_number', length: 50, nullable: true })
  companyRegistrationNumber?: string;

  // Contact Information
  @Column({ name: 'contact_person', length: 200, nullable: true })
  contactPerson?: string;

  @Column({ name: 'contact_email', length: 255, nullable: true })
  contactEmail?: string;

  @Column({ name: 'contact_phone', length: 50, nullable: true })
  contactPhone?: string;

  @Column({ name: 'contact_mobile', length: 50, nullable: true })
  contactMobile?: string;

  // Business Details
  @Column({ name: 'payment_terms', length: 50, nullable: true })
  paymentTerms?: string; // NET30, NET60, etc.

  @Column({ name: 'credit_limit', type: 'decimal', precision: 15, scale: 2, nullable: true })
  creditLimit?: number;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  @Column({ name: 'sales_representative', length: 200, nullable: true })
  salesRepresentative?: string;

  @Column({ name: 'account_manager', length: 200, nullable: true })
  accountManager?: string;

  // Classification
  @Column({ name: 'customer_group', length: 100, nullable: true })
  customerGroup?: string;

  @Column({ name: 'customer_segment', length: 100, nullable: true })
  customerSegment?: string;

  @Column({ name: 'customer_tier', length: 50, nullable: true })
  customerTier?: string; // A, B, C

  @Column({ name: 'business_size', length: 50, nullable: true })
  businessSize?: string; // Small, Medium, Large

  // Financial
  @Column({ name: 'annual_revenue', type: 'decimal', precision: 15, scale: 2, nullable: true })
  annualRevenue?: number;

  @Column({ name: 'last_order_date', type: 'date', nullable: true })
  lastOrderDate?: Date;

  @Column({ name: 'first_order_date', type: 'date', nullable: true })
  firstOrderDate?: Date;

  @Column({ name: 'total_orders', type: 'int', default: 0 })
  totalOrders!: number;

  @Column({ name: 'number_of_branches', type: 'int', nullable: true })
  numberOfBranches?: number;

  // Additional
  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    storeSize?: number;
    numberOfEmployees?: number;
    numberOfLocations?: number;
    industry?: string;
    website?: string;
    socialMedia?: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
    };
  };

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ name: 'is_vip', type: 'boolean', default: false })
  @Index()
  isVip!: boolean;

  @Column({ name: 'contract_start_date', type: 'date', nullable: true })
  contractStartDate?: Date;

  @Column({ name: 'contract_end_date', type: 'date', nullable: true })
  contractEndDate?: Date;

  @Column({ name: 'cpl_id', type: 'uuid', nullable: true })
  cplId?: string;

  // Relations
  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne(() => Cpl, (cpl) => cpl.customers, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  cpl?: Cpl;
}

