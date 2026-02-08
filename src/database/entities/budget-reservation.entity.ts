import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BudgetEnvelope } from './budget-envelope.entity';
import { Tenant } from './tenant.entity';

export enum BudgetReservationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  COMMITTED = 'COMMITTED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'budget_reservations', schema: 'main' })
@Index(['tenantId', 'envelopeId'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'agreementId'])
export class BudgetReservation extends BaseEntity {
  @Column({ name: 'envelope_id', type: 'uuid' })
  envelopeId!: string;

  @Column({ name: 'agreement_id', type: 'uuid', nullable: true })
  agreementId?: string;

  @Column({ name: 'agreement_name', length: 200, nullable: true })
  agreementName?: string;

  @Column({ name: 'reserved_amount', type: 'decimal', precision: 15, scale: 2 })
  reservedAmount!: number;

  @Column({
    type: 'enum',
    enum: BudgetReservationStatus,
    default: BudgetReservationStatus.PENDING,
  })
  status!: BudgetReservationStatus;

  @Column({ name: 'requested_by_id', type: 'uuid' })
  requestedById!: string;

  @Column({ name: 'requested_by_email', length: 200 })
  requestedByEmail!: string;

  @Column({ name: 'requested_by_name', length: 200 })
  requestedByName!: string;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById?: string;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ name: 'rejected_reason', type: 'text', nullable: true })
  rejectedReason?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // Relations
  @ManyToOne(() => BudgetEnvelope)
  @JoinColumn({ name: 'envelope_id' })
  envelope!: BudgetEnvelope;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}

