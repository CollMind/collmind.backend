import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { DecimalTransformer } from '../transformers/decimal.transformer';

export enum BudgetEnvelopeStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  ARCHIVED = 'ARCHIVED',
}

@Entity({ name: 'budget_envelopes', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['fiscalYear', 'period'])
export class BudgetEnvelope extends BaseEntity {
  @Column({ length: 100 })
  code!: string; // e.g., "NKA/Hair/Jan"

  @Column({ length: 200 })
  name!: string;

  @Column({ name: 'fiscal_year', length: 10 })
  fiscalYear!: string; // e.g., "2024"

  @Column({ length: 50 })
  period!: string; // e.g., "Jan", "Q1", "2024"

  @Column({
    name: 'allocated_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    transformer: DecimalTransformer,
  })
  allocatedAmount!: number;

  @Column({
    name: 'consumed_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
    transformer: DecimalTransformer,
  })
  consumedAmount!: number;

  @Column({
    name: 'available_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    transformer: DecimalTransformer,
  })
  availableAmount!: number;

  @Column({
    type: 'enum',
    enum: BudgetEnvelopeStatus,
    default: BudgetEnvelopeStatus.DRAFT,
  })
  status!: BudgetEnvelopeStatus;

  @Column({ name: 'budget_owner_id', type: 'uuid', nullable: true })
  budgetOwnerId?: string;

  @Column({ name: 'budget_owner_email', length: 200, nullable: true })
  budgetOwnerEmail?: string;

  @Column({ name: 'budget_owner_name', length: 200, nullable: true })
  budgetOwnerName?: string;

  // Dimension columns for envelope lookup
  @Column({ name: 'channel', length: 50, nullable: true })
  channel?: string; // NKA, ECOM, DT, TT, vb.

  @Column({ name: 'category', length: 100, nullable: true })
  category?: string; // HAIR_CARE, COLOR, SKIN_CARE, vb.

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string;

  @Column({ name: 'currency', length: 3, default: 'TRY' })
  currency!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
