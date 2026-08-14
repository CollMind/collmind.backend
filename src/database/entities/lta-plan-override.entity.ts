import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Plan } from './plan.entity';
import { LTARate } from './lta-rate.entity';
import { User } from './user.entity';

@Entity({ name: 'lta_plan_overrides', schema: 'main' })
@Index(['planId', 'ltaRateId'], { unique: true })
@Index(['planId'])
@Index(['ltaRateId'])
export class LTAPlanOverride extends BaseEntity {
  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'lta_rate_id', type: 'uuid' })
  ltaRateId!: string;

  @Column({ name: 'lta_agreement_id', type: 'uuid' })
  ltaAgreementId!: string;

  // ⛔ Transformer YOK — bilerek, iki kolon. Alan B (oran/yüzde, ADR 0007
  // Karar 1). T-220'ye rapor edildi (T-197/T-221 ikinci yarı).
  @Column({
    name: 'override_on_invoice_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  overrideOnInvoicePct?: number; // null means use default

  @Column({
    name: 'override_off_invoice_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  overrideOffInvoicePct?: number; // null means use default

  @Column({ name: 'override_reason', type: 'text', nullable: true })
  overrideReason?: string;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedById?: string;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt?: Date;

  // Relations
  @ManyToOne(() => Plan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: Plan;

  @ManyToOne(() => LTARate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lta_rate_id' })
  ltaRate!: LTARate;

  @ManyToOne('LTAAgreement', (agreement: any) => agreement.planOverrides, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'lta_agreement_id' })
  ltaAgreement!: any;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy?: User;
}
