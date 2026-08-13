import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * FiscalPeriod — `donemler` (B dalgası / S11, `K-2.13.21`, `Ö4`).
 *
 * Sekiz mevcut dönem kolonunun (5× `fiscal_period`, 3× `period_month`, hepsi
 * `varchar(7)`) referans katalogu. `K-2.3.10`: "her anahtar kayıtlı bir biçime
 * uyar, biçim TEK YERDE tanımlıdır" — biçim CHECK'i burada, `kod` üzerinde; sekiz
 * kolonun her biri FK ile buraya bağlanır (migration, ham SQL — composite
 * `(tenant_id, kod)` FK TypeORM ilişkisi olarak MODELLENMEZ, bkz. migration yorumu
 * ve `agreement-transaction.entity.ts`'deki emsal).
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
@Index(['tenantId', 'kod'], { unique: true })
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
