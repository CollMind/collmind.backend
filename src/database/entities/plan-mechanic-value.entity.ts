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

  // User input, split by semantics — ADR 0007 Karar 4 (errata E2), migration 1796.
  //
  // `entered_value` carried three different meanings depending on the mechanic
  // (rate / TRY-per-unit / TRY-total). One column could not say which, so every
  // reader had to re-derive it from the mechanic row. The DB now enforces that
  // exactly one of these is populated (chk_pmv_exactly_one_entered, `<= 1` so
  // that "row exists, nothing entered" stays expressible).
  //
  // These stay `number` here on purpose: this is an EXISTING Domain A entity and
  // converting its representation to MoneyMinor/RateMicro is ratchet work
  // (ADR 0007 K9), not F2. The number-slot rule applies to new modules only.

  /**
   * LEGACY — kept through the EXPAND phase of ADR 0007 F2 (migration 1796).
   *
   * Expand-contract: C1 adds the three semantic columns while this one stays,
   * so every existing reader still compiles and C1 is independently revertible.
   * C2 moves the readers onto the new columns and only then drops this one
   * (migration 1797). Do not add new readers of this column.
   */
  @Column({
    name: 'entered_value',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  enteredValue?: number;

  /** Rate in percent notation, 0-100. PERCENT mechanics. */
  @Column({
    name: 'entered_rate_pct',
    type: 'decimal',
    precision: 9,
    scale: 4,
    nullable: true,
  })
  enteredRatePct?: number;

  /** TRY per unit. AMOUNT_PER_UNIT mechanics (price scale, not money scale). */
  @Column({
    name: 'entered_unit_amount',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  enteredUnitAmount?: number;

  /** TRY total. AMOUNT mechanics (lumpsum). */
  @Column({
    name: 'entered_total_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  enteredTotalAmount?: number;

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
