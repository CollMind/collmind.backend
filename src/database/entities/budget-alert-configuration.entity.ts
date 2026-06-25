import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum AlertLevel {
  WARNING_80 = 'warning_80',
  CRITICAL_95 = 'critical_95',
  EXCEEDED_100 = 'exceeded_100',
}

export enum NotificationChannel {
  EMAIL = 'email',
  IN_APP = 'in_app',
  SMS = 'sms',
}

@Entity({ name: 'budget_alert_configurations', schema: 'main' })
@Index(['tenantId', 'alertLevel'], { unique: true })
export class BudgetAlertConfiguration extends BaseEntity {
  @Column({
    name: 'alert_level',
    type: 'enum',
    enum: AlertLevel,
  })
  alertLevel!: AlertLevel;

  @Column({
    name: 'notification_channels',
    type: 'jsonb',
    array: false,
  })
  notificationChannels!: NotificationChannel[];

  @Column({ name: 'escalation_rules', type: 'jsonb', nullable: true })
  escalationRules?: {
    recipients?: string[]; // Email listesi
    roles?: string[]; // Role listesi (Finance Manager, Category Manager, vb.)
    delayMinutes?: number; // Escalation delay
    repeatInterval?: number; // Repeat alert interval in minutes
  };

  @Column({
    name: 'threshold_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  thresholdPercent!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
