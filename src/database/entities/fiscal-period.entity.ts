import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * FiscalPeriod — `donemler` (B dalgası / S11, `K-2.13.21`, `Ö4`).
 *
 * Sekiz mevcut dönem kolonunun (5× `fiscal_period`, 3× `period_month`, hepsi
 * `varchar(7)`) referans KATALOGUDUR — `K-2.3.10`: "her anahtar kayıtlı bir biçime
 * uyar, biçim TEK YERDE tanımlıdır"; biçim CHECK'i burada, `kod` üzerinde.
 *
 * ⛔ **FK YOK** (code-reviewer B1, 2026-08-13 — `EK_C § S11'in FK'leri GERİ ÇEKİLDİ`,
 * `F12` kararının sınırına dönüş). İlk uygulama sekiz kolona + `claims`'e composite FK
 * eklemişti; FK'ler canlıydı ama dönem YARATAN bir üretim yolu yoktu (controller 0,
 * servis 0, `TenantService.create` kurmuyor) — yeni bir tenant sıfır dönemle doğar ve
 * ilk yazma ham `23503`/`500` döner. FK, dönem yaratma bir ürün yeteneği olarak
 * (`K-2.13.21`) gelene kadar SONRAKİ dalganın işi. Bu tablo bugün yalnız bir KATALOG —
 * hiçbir tablo ona referans zorunluluğuyla bağlı değil.
 *
 * `K-2.13.21`: kapatılmış bir döneme yeni hareket yazılamaz; dönem yeniden açılabilir
 * (yetki + denetim kaydı gerektirir — denetim kaydı `denetim_kayitlari`/audit log'a
 * gider, bu tabloya değil). ⚠️ Faz 1'de yalnız ŞEMA — kapanış/yeniden-açma
 * doğrulaması (RESTRICT-benzeri "kapalı döneme yazma" kontrolü) servis tarafı işidir.
 */
export enum FiscalPeriodStatus {
  OPEN = 'OPEN', // AÇIK
  CLOSED = 'CLOSED', // KAPALI
}

@Entity({ name: 'fiscal_periods', schema: 'main' })
@Index('UQ_fiscal_periods_tenant_kod', ['tenantId', 'kod'], { unique: true })
export class FiscalPeriod extends BaseEntity {
  /** YYYY-MM. CHECK (migration): `kod ~ '^\d{4}-(0[1-9]|1[0-2])$'`. */
  @Column({ length: 7 })
  kod!: string;

  @Column({
    type: 'enum',
    enum: FiscalPeriodStatus,
    enumName: 'fiscal_period_status_enum',
    default: FiscalPeriodStatus.OPEN,
  })
  status!: FiscalPeriodStatus;

  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closedAt?: Date;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy?: string;

  @Column({ name: 'reopened_at', type: 'timestamp', nullable: true })
  reopenedAt?: Date;

  @Column({ name: 'reopened_by', type: 'uuid', nullable: true })
  reopenedBy?: string;
}
