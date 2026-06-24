import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Customer } from './customer.entity';
import { Channel } from './channel.entity';

@Entity({ name: 'cpls', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['channelId'])
export class Cpl extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({ name: 'region_id', type: 'uuid', nullable: true })
  regionId?: string;

  @Column({ length: 100, nullable: true })
  city?: string;

  @Column({ length: 100, nullable: true })
  country?: string;

  @Column({ name: 'contact_person', length: 200, nullable: true })
  contactPerson?: string;

  @Column({ name: 'contact_email', length: 255, nullable: true })
  contactEmail?: string;

  @Column({ name: 'contact_phone', length: 50, nullable: true })
  contactPhone?: string;

  @Column({ name: 'customer_tier', length: 50, nullable: true })
  customerTier?: string; // 'A' | 'B' | 'C' | 'VIP'

  @Column({ name: 'is_vip', type: 'boolean', default: false })
  isVip!: boolean;

  @Column({
    name: 'annual_revenue',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  annualRevenue?: number;

  @Column({
    type: 'enum',
    enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED'],
    default: 'ACTIVE',
  })
  status!: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel!: Channel;

  @OneToMany(() => Customer, (customer) => customer.cpl, { nullable: true })
  customers?: Customer[];
}
