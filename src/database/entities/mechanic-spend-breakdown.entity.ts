import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PlanSku } from './plan.entity';
import { Mechanic } from './mechanic.entity';
import { PlanMechanicValue } from './plan-mechanic-value.entity';

export enum DistributionBasis {
  BASE_VOLUME_RATIO = 'base_volume_ratio',
  PLANNED_VOLUME_RATIO = 'planned_volume_ratio',
  EQUAL = 'equal',
}

@Entity({ name: 'mechanic_spend_breakdown', schema: 'main' })
@Index(['planSkuId', 'mechanicId'], { unique: true })
@Index(['planSkuId'])
@Index(['mechanicId'])
@Index(['planMechanicValueId'])
export class MechanicSpendBreakdown extends BaseEntity {
  @Column({ name: 'plan_sku_id', type: 'uuid' })
  planSkuId!: string;

  @Column({ name: 'mechanic_id', type: 'uuid' })
  mechanicId!: string;

  @Column({ name: 'plan_mechanic_value_id', type: 'uuid' })
  planMechanicValueId!: string;

  // SKU seviyesinde dağıtılmış spend
  @Column({
    name: 'calculated_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  calculatedAmount!: number;

  // Dağıtım temeli
  @Column({
    name: 'distribution_basis',
    type: 'enum',
    enum: DistributionBasis,
    nullable: true,
  })
  distributionBasis?: DistributionBasis;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => PlanSku, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_sku_id' })
  planSku!: PlanSku;

  @ManyToOne(() => Mechanic)
  @JoinColumn({ name: 'mechanic_id' })
  mechanic!: Mechanic;

  @ManyToOne(() => PlanMechanicValue, (pmv) => pmv.spendBreakdowns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_mechanic_value_id' })
  planMechanicValue!: PlanMechanicValue;
}
