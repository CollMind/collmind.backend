import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Mechanic } from './mechanic.entity';

export enum TacticType {
  DISCOUNT = 'DISCOUNT',
  LUMP_SUM = 'LUMP_SUM',
  VOLUME_REBATE = 'VOLUME_REBATE',
  CO_OP = 'CO_OP',
  LISTING_FEE = 'LISTING_FEE',
  OTHER = 'OTHER',
}

@Entity({ name: 'tactics', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
export class Tactic extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    name: 'tactic_type',
    type: 'enum',
    enum: TacticType,
  })
  tacticType!: TacticType;

  @Column({
    name: 'spend_type',
    type: 'enum',
    enum: ['ON_INVOICE', 'OFF_INVOICE', 'BOTH'],
    nullable: true,
  })
  spendType?: 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH';

  // Applicability rules (JSONB for flexibility)
  @Column({ name: 'applicable_channels', type: 'jsonb', nullable: true })
  applicableChannels?: string[]; // Channel codes

  @Column({ name: 'applicable_categories', type: 'jsonb', nullable: true })
  applicableCategories?: string[]; // Category codes

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @OneToMany(() => Mechanic, (mechanic) => mechanic.tactic)
  mechanics!: Mechanic[];
}
