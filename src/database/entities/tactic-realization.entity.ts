import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Claim } from './claim.entity';
import { Mechanic, EvidenceClass } from './mechanic.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

/**
 * TacticRealization — `taktik_gerceklesmeleri` (B dalgası / S8, `K-2.13.14e`–`14k`).
 *
 * `K-2.13.14e`: taktik gerçekleşmesi dış talepten TÜRETİLMEZ, kendi kanıtından
 * hesaplanır. `K-2.13.14h`: sistem her taktik için BAĞIMSIZ bir gerçekleşme üretir.
 * `K-2.13.27`: hakediş tutarı, dayandığı hesaplamayla BİRLİKTE saklanır — bu yüzden
 * `evidenceClass` mekanikten kopyalanır (sonradan mekanik değişirse tarihsel kayıt
 * bozulmaz).
 *
 * **Invariant** (`K-2.13.14j`, kod tarafı — DB CHECK değil, çapraz-satır agregat):
 * `Σ(taktik gerçekleşmeleri) + FARK = dış talep tutarı`.
 */
@Entity({ name: 'tactic_realizations', schema: 'main' })
@Index('IDX_tactic_realizations_tenant_claim', ['tenantId', 'claimId'])
@Index('IDX_tactic_realizations_tenant_mechanic', ['tenantId', 'mechanicId'])
export class TacticRealization extends BaseEntity {
  @Column({ name: 'claim_id', type: 'uuid' })
  claimId!: string;

  @Column({ name: 'mechanic_id', type: 'uuid' })
  mechanicId!: string;

  @Column({
    name: 'calculated_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: MoneyTransformer,
  })
  calculatedAmount!: number;

  @Column({
    name: 'evidence_class',
    type: 'enum',
    enum: EvidenceClass,
    enumName: 'evidence_class_enum',
  })
  evidenceClass!: EvidenceClass;

  @ManyToOne(() => Claim, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'claim_id' })
  claim!: Claim;

  @ManyToOne(() => Mechanic, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'mechanic_id' })
  mechanic!: Mechanic;
}
