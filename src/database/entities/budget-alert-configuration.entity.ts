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
// T-101 (migration 1799000000000): PARTIAL unique — only rows that
// `budget-threshold.service.ts` can actually read (`find({ isActive: true })`,
// which TypeORM implicitly narrows to `deleted_at IS NULL`) must be unique
// per (tenant_id, alert_level). Deactivated/soft-deleted history is exempt
// so a level can be reconfigured without deleting its audit trail. This
// REPLACES the full (non-partial) unique index migration 1771169825000 had
// created — see 1799000000000 for the measurement behind that change.
@Index(['tenantId', 'alertLevel'], {
  unique: true,
  where: '"deleted_at" IS NULL AND "is_active" = true',
})
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

  // DB-enforced range (migration 1799000000000, CHK_BUDGET_ALERT_CONFIG_
  // THRESHOLD_PERCENT_RANGE): 0 < threshold_percent <= 100. Not restated as
  // a TypeORM validator here — the CHECK is the single source of truth.
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
