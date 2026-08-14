import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Agreement } from './agreement.entity';
import { Cpl } from './cpl.entity';
import { Category } from './category.entity';
import { Channel } from './channel.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

/**
 * Claim — `talepler` (B dalgası / S7, `K-2.13.3`–`K-2.13.9`, `K-2.13.5`–`5g`).
 *
 * `K-2.13.5`: iç talep (biz) ile dış talep (karşı taraf) TEK bir varlıktır; ayrım
 * bir alandır (`source`). `K-2.13.5b`: doğrulama kaynağa koşulludur — DIŞ ise
 * dayanak belge referansı zorunlu, İÇ ise hesap izi referansı zorunlu (CHECK,
 * migration). `K-2.13.5d`: durumlar tek enum, geçiş tablosu kaynağa duyarlı —
 * geçersiz kombinasyonlar (`İÇ`+`İTİRAZLI`) ŞEMADA değil, sözleşme+testle engellenir
 * (`K-2.13.5e`).
 *
 * `K-2.13.5g`: `agreement_transactions` iç talep ÜRETİMİNİN bugünkü hâli olarak
 * KALIR (finansal iz) — bu tablo mutabakat nesnesidir, ikisi karışmaz.
 */
export enum ClaimSource {
  INTERNAL = 'INTERNAL', // İÇ
  EXTERNAL = 'EXTERNAL', // DIŞ
}

/** K-2.13.5d: tek enum, sekiz değer — kaynağa göre yalnız bir alt küme geçerli. */
export enum ClaimStatus {
  // DIŞ: ALINDI → EŞLEŞTİRİLDİ → KABUL_EDİLDİ | REDDEDİLDİ | İTİRAZLI
  RECEIVED = 'RECEIVED', // ALINDI
  MATCHED = 'MATCHED', // EŞLEŞTİRİLDİ
  ACCEPTED = 'ACCEPTED', // KABUL_EDİLDİ
  REJECTED = 'REJECTED', // REDDEDİLDİ
  DISPUTED = 'DISPUTED', // İTİRAZLI
  // İÇ: ÜRETİLDİ → GÖNDERİLDİ → KARŞILANDI
  GENERATED = 'GENERATED', // ÜRETİLDİ
  SUBMITTED = 'SUBMITTED', // GÖNDERİLDİ
  FULFILLED = 'FULFILLED', // KARŞILANDI
}

@Entity({ name: 'claims', schema: 'main' })
@Index('IDX_claims_tenant_source_status', ['tenantId', 'source', 'status'])
@Index('IDX_claims_tenant_agreement', ['tenantId', 'agreementId'])
@Index('IDX_claims_tenant_grain', [
  'tenantId',
  'periodMonth',
  'cplId',
  'categoryId',
  'channelId',
])
export class Claim extends BaseEntity {
  @Column({
    type: 'enum',
    enum: ClaimSource,
    enumName: 'claim_source_enum',
  })
  source!: ClaimSource;

  @Column({ name: 'agreement_id', type: 'uuid' })
  agreementId!: string;

  /** Hakediş grain'i (K-2.13.12c): dönem + müşteri + kategori + kanal. */
  @Column({ name: 'period_month', length: 7 })
  periodMonth!: string;

  @Column({ name: 'cpl_id', type: 'uuid' })
  cplId!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: MoneyTransformer,
  })
  amount!: number;

  @Column({
    type: 'enum',
    enum: ClaimStatus,
    enumName: 'claim_status_enum',
  })
  status!: ClaimStatus;

  /** K-2.13.5b: `source = EXTERNAL` ise zorunlu (CHECK, migration). */
  @Column({ name: 'supporting_document_ref', type: 'text', nullable: true })
  supportingDocumentRef?: string;

  /** K-2.13.5b: `source = INTERNAL` ise zorunlu (CHECK, migration). */
  @Column({ name: 'audit_trail_ref', type: 'text', nullable: true })
  auditTrailRef?: string;

  @Column({ name: 'produced_or_received_at', type: 'timestamp' })
  producedOrReceivedAt!: Date;

  // Finansal-bitişik referans — RESTRICT (ADR 0012 deseniyle tutarlı).
  @ManyToOne(() => Agreement, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agreement_id' })
  agreement!: Agreement;

  @ManyToOne(() => Cpl)
  @JoinColumn({ name: 'cpl_id' })
  cpl!: Cpl;

  @ManyToOne(() => Category)
  @JoinColumn({ name: 'category_id' })
  category!: Category;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel!: Channel;
}
