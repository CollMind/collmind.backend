import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Cpl } from './cpl.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

export enum LTAAgreementStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
}

@Entity({ name: 'lta_agreements', schema: 'main' })
@Index(['tenantId', 'agreementCode'], { unique: true })
@Index(['cplId', 'status'])
@Index(['effectiveDate', 'expiryDate'])
@Index(['status'])
export class LTAAgreement extends BaseEntity {
  @Column({ name: 'cpl_id', type: 'uuid' })
  cplId!: string;

  @Column({ name: 'agreement_name', length: 200 })
  agreementName!: string; // e.g., "Carrefour 2025 Annual Agreement"

  @Column({ name: 'agreement_code', length: 100 })
  agreementCode!: string; // e.g., "CARREFOUR_2025_LTA"

  // Geçerlilik tarihleri
  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: Date;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate?: Date;

  @Column({
    type: 'enum',
    enum: LTAAgreementStatus,
    default: LTAAgreementStatus.DRAFT,
  })
  status!: LTAAgreementStatus;

  @Column({
    name: 'total_agreement_value',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: MoneyTransformer,
  })
  totalAgreementValue?: number; // Optional total agreement value

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // Relations
  @ManyToOne(() => Cpl)
  @JoinColumn({ name: 'cpl_id' })
  cpl!: Cpl;

  @OneToMany('LTARate', 'ltaAgreement', { cascade: true })
  rates!: any[];

  @OneToMany('LTAPlanOverride', 'ltaAgreement', { cascade: true })
  planOverrides!: any[];
}
