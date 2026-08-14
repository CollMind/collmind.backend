import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';
import { MoneyTransformer } from '../transformers/decimal.transformer';

/**
 * ApprovalPolicy — `onay_politikalari` (B dalgası / S5, `K-2.5.13`–`13f`).
 *
 * `K-2.5.13`: onay politikaları bir TABLODA yaşar, kodda değil. `K-2.5.13a`: üç
 * görüşlü şablonla doğar — STANDARD, TWO_TIER, THRESHOLD. `K-2.5.13c`: tenant bir
 * şablon SEÇER ve eşik ayarlar; kural YAZAMAZ (serbest kural motoru yok).
 *
 * `K-2.5.13e`: tablo Faz 2 alanlarını ŞİMDİDEN taşır (`delegateAllowed`, `tierRoles`)
 * — davranış Faz 2'de gelse bile kolonlar bugün var olur (deploy öncesi ucuz).
 *
 * ⚠️ `K-2.2.7b`'nin `FINANCE_REVIEW` modu (`notify`/`approve`) bu tabloda DEĞİL —
 * `EK_C_VERI_SOZLUGU.md`'nin kanonik alan listesi onu `butce_politikalari`
 * (`BudgetPolicy.financeReviewMode`) altında tutuyor; iki politika ailesi (onay
 * motoru / bütçe politikası, `K-2.5.1`) ayrı kalır.
 */
export enum ApprovalPolicyTemplate {
  STANDARD = 'STANDARD', // STANDART
  TWO_TIER = 'TWO_TIER', // ÇİFT_KADEME
  THRESHOLD = 'THRESHOLD', // EŞİKLİ
}

@Entity({ name: 'approval_policies', schema: 'main' })
export class ApprovalPolicy extends BaseEntity {
  @Column({
    name: 'template',
    type: 'enum',
    enum: ApprovalPolicyTemplate,
    enumName: 'approval_policy_template_enum',
  })
  template!: ApprovalPolicyTemplate;

  /** Yalnız THRESHOLD şablonunda anlamlı — CHECK bunu zorunlu kılar (migration). */
  @Column({
    name: 'amount_threshold',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: MoneyTransformer,
  })
  amountThreshold?: number;

  /** K-2.5.13e / K-2.5.11c: Faz 2 alanı — kolon bugün, davranış sonra. */
  @Column({ name: 'delegate_allowed', type: 'boolean', default: false })
  delegateAllowed!: boolean;

  /** Kademe rolleri — şablona göre 1-2 kademelik rol referansları (rol kodu listesi). */
  @Column({ name: 'tier_roles', type: 'jsonb', nullable: true })
  tierRoles?: Array<{ tier: number; roleCode: string }>;
}
