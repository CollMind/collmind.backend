import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

export enum NotificationType {
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_REJECTED = 'APPROVAL_REJECTED',
  BUDGET_ALERT_80 = 'BUDGET_ALERT_80',
  BUDGET_ALERT_100 = 'BUDGET_ALERT_100',
  AGREEMENT_EXPIRING = 'AGREEMENT_EXPIRING',
  // `Z57` / `T-317` (1816000000000) — `K-2.2.7a` `FINANCE_REVIEW` kademesi
  // (%90). Olay ÜRETİMİ `T-318`'in işi (kapsam dışı burada).
  BUDGET_FINANCE_REVIEW = 'BUDGET_FINANCE_REVIEW',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  SMS = 'SMS',
}

export enum NotificationPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  READ = 'READ',
}

@Entity({ name: 'notifications', schema: 'main' })
@Index(['tenantId', 'recipientId'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'type'])
@Index(['tenantId', 'createdAt'])
export class Notification extends BaseEntity {
  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type!: NotificationType;

  @Column({ name: 'recipient_id', type: 'uuid' })
  recipientId!: string;

  @Column({ name: 'recipient_email', length: 200 })
  recipientEmail!: string;

  @Column({ name: 'recipient_name', length: 200, nullable: true })
  recipientName?: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    default: NotificationChannel.IN_APP,
  })
  channel!: NotificationChannel;

  @Column({
    type: 'enum',
    enum: NotificationPriority,
    default: NotificationPriority.MEDIUM,
  })
  priority!: NotificationPriority;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status!: NotificationStatus;

  @Column({ length: 500 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    agreementId?: string;
    agreementName?: string;
    budgetEnvelopeId?: string;
    budgetEnvelopeName?: string;
    approverId?: string;
    approverName?: string;
    requesterId?: string;
    requesterName?: string;
    amount?: number;
    [key: string]: any;
  };

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt?: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  // Relations
  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
