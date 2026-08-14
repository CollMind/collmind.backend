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
// Full UNIQUE, matching `IDX_budget_alert_config_tenant_level` as migration
// 1771169825000 created it. T-101 briefly carried a PARTIAL variant here
// (`WHERE deleted_at IS NULL AND is_active = true`) so a deactivated row could
// coexist with a new active one. It was removed from the migration as
// out-of-scope — whether configuration history is kept belongs to the task that
// designs the configuration lifecycle (T-108) — but it survived HERE for one
// commit, which is worse than either choice: `migration:generate` diffs entity
// metadata against the database, so the next run would have emitted the swap as
// an unexplained migration. A decision deferred in one file and left standing in
// another is a decision that lands with no author.
//
// The NAME is explicit on purpose: without it TypeORM derives a hash
// (`IDX_8f28b6d0…`) and `migration:generate` proposes renaming the real index to
// it — churn that says nothing and would orphan the name every migration since
// 1771169825000 refers to.
@Index('IDX_budget_alert_config_tenant_level', ['tenantId', 'alertLevel'], {
  unique: true,
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
  //
  // ⛔ Transformer YOK — bilerek. Alan B (oran/yüzde, ADR 0007 Karar 1/2):
  // bloklamıyor, float tolere edilir. T-228'ye rapor edildi (T-197/T-221
  // ikinci yarı).
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
