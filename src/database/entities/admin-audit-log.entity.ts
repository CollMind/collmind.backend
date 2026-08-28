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

  // Z52 §2 — NULL burada BİLGİ-EKSİKLİĞİ DEĞİL, KATMAN-BİLGİSİDİR:
  // "platform-seviyesi eylem" (tenant'a bağlı olmayan operatör işi).
  // Tenant'sız satırda bile `admin_id`/`admin_email` (kim) hâlâ ZORUNLU —
  // bkz. migration 1815000000000. `comment` burada entity metadata'sının
  // migration'ın `COMMENT ON COLUMN`'ı ile eşleşmesi için var — yoksa
  // `migration:generate` DB'deki yorumu "entity'de yok" sayıp DROP önerir
  // (T-101 disiplini: entity↔katalog eşit olmalı, sessiz drift üretilmez).
  @Column({
    name: 'tenant_id',
    type: 'uuid',
    nullable: true,
    comment:
      'NULL = platform-seviyesi eylem (tenant bağımsız operatör işi) — bilgi eksikliği DEĞİL, katman bilgisi. Z52 §2.',
  })
  tenantId?: string;

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
  // Z52 §1 — RESTRICT: denetim izi iz sürdüğü nesnenin yaşam döngüsüne tabi
  // olamaz (ADR 0012'nin denetim-katmanı kardeşi). Tenant silme akışı,
  // arşivlenmemiş logu olan bir tenant'ı silemez.
  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;
}
