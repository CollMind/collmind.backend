import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { PlanFu } from './plan.entity';
import { Mechanic } from './mechanic.entity';

export enum DistributionMethod {
  PERCENTAGE = 'percentage',
  PER_UNIT = 'per_unit',
  LUMPSUM = 'lumpsum',
  PROPORTIONAL = 'proportional',
}

@Entity({ name: 'plan_mechanic_values', schema: 'main' })
@Index(['planFuId', 'mechanicId'], { unique: true })
@Index(['planFuId'])
@Index(['mechanicId'])
export class PlanMechanicValue extends BaseEntity {
  @Column({ name: 'plan_fu_id', type: 'uuid' })
  planFuId!: string;

  @Column({ name: 'mechanic_id', type: 'uuid' })
  mechanicId!: string;

  // Kullanıcı girişi - % veya $
  @Column({
    name: 'entered_value',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  enteredValue?: number;

  // Hesaplanan spend değeri
  @Column({
    name: 'calculated_spend',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  calculatedSpend!: number;

  // Spend type ayrımı
  @Column({
    name: 'on_invoice_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  onInvoiceAmount!: number;

  @Column({
    name: 'off_invoice_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  offInvoiceAmount!: number;

  // Dağıtım metodu
  @Column({
    name: 'distribution_method',
    type: 'enum',
    enum: DistributionMethod,
    nullable: true,
  })
  distributionMethod?: DistributionMethod;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => PlanFu, (planFu) => planFu.planMechanicValues, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_fu_id' })
  planFu!: PlanFu;

  @ManyToOne(() => Mechanic)
  @JoinColumn({ name: 'mechanic_id' })
  mechanic!: Mechanic;

  @OneToMany('MechanicSpendBreakdown', 'planMechanicValue', { cascade: true })
  spendBreakdowns?: any[];
}
