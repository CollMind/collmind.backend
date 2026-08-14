import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Claim } from './claim.entity';
import { User } from './user.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

/**
 * ClaimMatch — `eslestirmeler` (B dalgası / S8, `K-2.13.5f`).
 *
 * ⚠️ Ayrı bir BAĞ VARLIĞIDIR, talebin bir alanı değil, ve `n:m`'dir — bir dış
 * kesinti birden çok iç talebe, ya da hiçbirine denk düşebilir. `1:1` varsayımı
 * REDDEDİLDİ. Eşleşmeyen bir talep (0 eşleştirme satırı) kuyrukta kalır
 * (`K-2.13.13`) — bu tablo yalnız GERÇEKLEŞEN eşleştirmeleri tutar.
 */
export enum ClaimMatchVarianceClass {
  TIMING = 'TIMING', // ZAMANLAMA
  AMOUNT = 'AMOUNT', // TUTAR
  SCOPE = 'SCOPE', // KAPSAM
}

@Entity({ name: 'claim_matches', schema: 'main' })
@Index('IDX_claim_matches_tenant_internal', ['tenantId', 'internalClaimId'])
@Index('IDX_claim_matches_tenant_external', ['tenantId', 'externalClaimId'])
export class ClaimMatch extends BaseEntity {
  @Column({ name: 'internal_claim_id', type: 'uuid' })
  internalClaimId!: string;

  @Column({ name: 'external_claim_id', type: 'uuid' })
  externalClaimId!: string;

  @Column({
    name: 'variance_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: MoneyTransformer,
  })
  varianceAmount!: number;

  @Column({
    name: 'variance_class',
    type: 'enum',
    enum: ClaimMatchVarianceClass,
    enumName: 'claim_match_variance_class_enum',
  })
  varianceClass!: ClaimMatchVarianceClass;

  @Column({ type: 'text', nullable: true })
  decision?: string;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy?: string;

  @Column({ name: 'decided_at', type: 'timestamp', nullable: true })
  decidedAt?: Date;

  @ManyToOne(() => Claim, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'internal_claim_id' })
  internalClaim!: Claim;

  @ManyToOne(() => Claim, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'external_claim_id' })
  externalClaim!: Claim;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'decided_by' })
  decidedByUser?: User;
}
