import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { Plan } from './plan.entity';

export enum ApprovalHistoryAction {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REQUEST_CHANGES = 'REQUEST_CHANGES',
  ESCALATED = 'ESCALATED',
  RETURNED_TO_DRAFT = 'RETURNED_TO_DRAFT',
  BUDGET_RESERVED = 'BUDGET_RESERVED',
  BUDGET_RELEASED = 'BUDGET_RELEASED',
  BUDGET_COMMITTED = 'BUDGET_COMMITTED',
}

@Entity({ name: 'plan_approval_history', schema: 'main' })
@Index(['planId', 'createdAt'])
@Index(['tenantId', 'action'])
export class PlanApprovalHistory extends BaseEntity {
  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({
    name: 'action',
    type: 'enum',
    enum: ApprovalHistoryAction,
  })
  action!: ApprovalHistoryAction;

  @Column({ name: 'actioned_by', type: 'uuid' })
  actionedById!: string;

  @Column({ type: 'text', nullable: true })
  comments?: string;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ name: 'escalation_reason', type: 'text', nullable: true })
  escalationReason?: string;

  @Column({ name: 'specific_changes', type: 'jsonb', nullable: true })
  specificChanges?: string[]; // Array of specific change requests

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>; // Additional context (budget amounts, etc.)

  // Relations
  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'plan_id' })
  plan!: Plan;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actioned_by' })
  actionedBy!: User;
}
