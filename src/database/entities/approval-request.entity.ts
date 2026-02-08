import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';

export enum ApprovalRequestType {
  AGREEMENT = 'AGREEMENT',
  PLAN = 'PLAN',
  BUDGET_TRANSFER = 'BUDGET_TRANSFER',
  IMPORT_BATCH = 'IMPORT_BATCH',
  OTHER = 'OTHER',
}

export enum ApprovalRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'approval_requests', schema: 'main' })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'entityType', 'entityId'])
@Index(['tenantId', 'requestedById'])
export class ApprovalRequest extends BaseEntity {
  // Request identification
  @Column({
    name: 'request_type',
    type: 'enum',
    enum: ApprovalRequestType,
  })
  requestType!: ApprovalRequestType;

  // Entity reference
  @Column({ name: 'entity_type', length: 50 })
  entityType!: string; // 'AGREEMENT', 'BUDGET_TRANSFER', 'IMPORT_BATCH'

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string; // Reference to the entity being approved

  // Requester
  @Column({ name: 'requested_by_id', type: 'uuid' })
  requestedById!: string;

  @Column({ name: 'requested_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  requestedAt!: Date;

  // Policy & routing
  @Column({ name: 'approval_policy_id', type: 'uuid', nullable: true })
  approvalPolicyId?: string;

  @Column({ name: 'approval_levels', type: 'jsonb', nullable: true })
  approvalLevels?: Array<{
    order: number;
    role: string;
    userId?: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    approvedAt?: Date;
    approvedById?: string;
    rejectionReason?: string;
  }>;

  @Column({ name: 'current_level', type: 'int', default: 1 })
  currentLevel!: number;

  // Status
  @Column({
    type: 'enum',
    enum: ApprovalRequestStatus,
    default: ApprovalRequestStatus.PENDING,
  })
  status!: ApprovalRequestStatus;

  // Final decision
  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById?: string;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  rejectedAt?: Date;

  @Column({ name: 'rejected_by_id', type: 'uuid', nullable: true })
  rejectedById?: string;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt?: Date;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById?: string;

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'requested_by_id' })
  requestedBy!: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy?: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'rejected_by_id' })
  rejectedBy?: User;
}


