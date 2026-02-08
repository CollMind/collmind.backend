import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tactic } from './tactic.entity';

export enum MechanicType {
  PERCENT = 'PERCENT',
  AMOUNT = 'AMOUNT',
  AMOUNT_PER_UNIT = 'AMOUNT_PER_UNIT',
}

@Entity({ name: 'mechanics', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['tacticId'])
export class Mechanic extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'tactic_id', type: 'uuid' })
  tacticId!: string;

  @Column({
    name: 'mechanic_type',
    type: 'enum',
    enum: MechanicType,
  })
  mechanicType!: MechanicType;

  @Column({ name: 'calculation_rules', type: 'jsonb', nullable: true })
  calculationRules?: Record<string, any>; // Formula definition

  @Column({ name: 'min_value', type: 'decimal', precision: 18, scale: 4, nullable: true })
  minValue?: number;

  @Column({ name: 'max_value', type: 'decimal', precision: 18, scale: 4, nullable: true })
  maxValue?: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Tactic, (tactic) => tactic.mechanics)
  @JoinColumn({ name: 'tactic_id' })
  tactic!: Tactic;
}
