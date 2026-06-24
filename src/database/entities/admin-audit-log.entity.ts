import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Tenant } from './tenant.entity';

export enum AuditLogResult {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

@Entity({ name: 'admin_audit_logs', schema: 'main' })
@Index(['tenantId', 'adminId'])
@Index(['tenantId', 'createdAt'])
@Index(['entityType', 'entityId'])
@Index(['isHighRisk', 'createdAt'])
export class AdminAuditLog {
  @Column({ type: 'uuid', primary: true, generated: 'uuid' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'admin_id', type: 'uuid' })
  adminId!: string;

  @Column({ name: 'admin_email', length: 200 })
  adminEmail!: string;

  @Column({ name: 'action_type', length: 50 })
  actionType!: string;

  @Column({ name: 'entity_type', length: 100 })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId?: string;

  @Column({ name: 'ip_address', length: 45, nullable: true })
  ipAddress?: string;

  @Column({
    type: 'enum',
    enum: AuditLogResult,
  })
  result!: AuditLogResult;

  @Column({ name: 'before_values', type: 'jsonb', nullable: true })
  beforeValues?: Record<string, any>;

  @Column({ name: 'after_values', type: 'jsonb', nullable: true })
  afterValues?: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  justification?: string;

  @Column({ name: 'is_high_risk', type: 'boolean', default: false })
  isHighRisk!: boolean;

  @Column({ name: 'alert_sent', type: 'boolean', default: false })
  alertSent!: boolean;

  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
