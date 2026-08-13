import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Channel } from './channel.entity';
import { Category } from './category.entity';

// ⚠️ `UNIQUE NULLS NOT DISTINCT (tenant_id, channel_id, category_id)` (PG15+, `K-2.2.8b`
// jokerin çakışmasını da yakalar) TypeORM `@Index` dekoratörüyle ifade edilemez — migration
// bunu ham SQL ile kurar. Entity bu index'i bilerek TANIMLAMAZ (aksi hâlde `migration:generate`
// standart bir UNIQUE INDEX önerirdi, NULLS NOT DISTINCT'i kaybederdi).

/**
 * BudgetPolicy — `butce_politikalari` (B dalgası / S4, `K-2.2.8a`–`8f`).
 *
 * ⚠️ `K-2.2.7`'nin İKİ ayrı merdiveninden yalnız DAVRANIŞ merdivenidir (%80/90/100 —
 * kontrol: ne olur). RENK (RAG, <80/80-95/>95 — iletişim: nasıl görünür) merdiveni
 * AYRI ve halihazırda var: `BudgetAlertConfiguration`. İkisi karıştırılmaz (K-2.5.2).
 *
 * `K-2.2.8b`: çakışma veritabanı seviyesinde imkânsız — `UNIQUE NULLS NOT DISTINCT
 * (tenant_id, channel_id, category_id)`, boş = joker. `K-2.2.8c`: öncelik kolonu
 * YOK — en-spesifik-kazanır tekillikle bedava gelir. `K-2.2.8d`: her tenant'ta bir
 * joker satır ZORUNLU (bu migration'ın seed'i, item 1).
 */
@Entity({ name: 'budget_policies', schema: 'main' })
export class BudgetPolicy extends BaseEntity {
  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string;

  @Column({
    name: 'warning_threshold_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 80,
  })
  warningThresholdPct!: number;

  @Column({
    name: 'finance_review_threshold_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 90,
  })
  financeReviewThresholdPct!: number;

  @Column({
    name: 'block_threshold_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 100,
  })
  blockThresholdPct!: number;

  /** K-2.2.7b: varsayılan NOTIFY (BİLDİRİM). APPROVE (ONAY) Faz 2 davranışı. */
  @Column({
    name: 'finance_review_mode',
    type: 'enum',
    enum: ['NOTIFY', 'APPROVE'],
    enumName: 'budget_policy_finance_review_mode_enum',
    default: 'NOTIFY',
  })
  financeReviewMode!: 'NOTIFY' | 'APPROVE';

  @ManyToOne(() => Channel, { nullable: true })
  @JoinColumn({ name: 'channel_id' })
  channel?: Channel;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category?: Category;
}
