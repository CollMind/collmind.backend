import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { LTAAgreement } from './lta-agreement.entity';
import { Channel } from './channel.entity';
import { Category } from './category.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

@Entity({ name: 'lta_rates', schema: 'main' })
@Index(['ltaAgreementId', 'channel', 'category'], { unique: true })
@Index(['ltaAgreementId'])
@Index(['channelId'])
@Index(['categoryId'])
export class LTARate extends BaseEntity {
  @Column({ name: 'lta_agreement_id', type: 'uuid' })
  ltaAgreementId!: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string; // Nullable for "ALL" channels

  @Column({ name: 'channel', length: 100 })
  channel!: string; // NKA, Traditional Trade, etc. or "ALL"

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string; // Nullable for "ALL" categories

  @Column({ name: 'category', length: 100 })
  category!: string; // Dairy, Beverages, etc. or "ALL"

  // ⛔ Transformer YOK — bilerek. Alan B (oran/yüzde 0-100, ADR 0007 Karar 1):
  // float tolere edilir. T-220'ye rapor edildi, bu turun kapsamı dışında.
  @Column({
    name: 'on_invoice_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  onInvoicePercentage!: number; // 0-100

  @Column({
    name: 'off_invoice_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  offInvoicePercentage!: number; // 0-100

  // ⛔ Transformer YOK — bilerek. Ne para ne birim fiyat: hacim (K-2.1.12a
  // "tek hacim birimi: adet"). İki transformer kararının (Money/UnitPrice)
  // kapsamı dışında — bu turda dokunulmadı, ayrı bulgu olarak raporlandı.
  @Column({
    name: 'minimum_volume_commitment',
    type: 'decimal',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  minimumVolumeCommitment?: number; // Optional minimum volume commitment

  @Column({
    name: 'maximum_discount_cap',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: MoneyTransformer,
  })
  maximumDiscountCap?: number; // Optional maximum discount cap

  @Column({ name: 'payment_terms', length: 50, nullable: true })
  paymentTerms?: string; // Net 30, Net 60, etc.

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  // Relations
  @ManyToOne(() => LTAAgreement, (agreement) => agreement.rates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'lta_agreement_id' })
  ltaAgreement!: LTAAgreement;

  @ManyToOne(() => Channel, { nullable: true })
  @JoinColumn({ name: 'channel_id' })
  channelEntity?: Channel;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  categoryEntity?: Category;
}
