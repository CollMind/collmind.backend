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
 * ⚠️ AŞAĞIDAKİ ÖLÇÜM 2026-08-16 TARİHLİDİR VE `amountThreshold` İÇİN ARTIK
 * BAYATTIR — T-214 (bu tarihten sonra) `approval-policy.service.ts` /
 * `approval-policy.repository.ts`'yi ekledi: `PATCH /approval-policies/:id`
 * artık `amountThreshold`'u hem YAZIYOR hem `findById` ile OKUYOR. Aşağıdaki
 * tablo yalnız `tierRoles`/`delegateAllowed` için hâlâ doğrudur — onlar
 * T-214'ün KAPSAMI DIŞINDA bırakıldı (bkz. `UpdateApprovalPolicyDto`, yalnız
 * `template`+`amountThreshold` taşır).
 *
 * Ölçüldü (2026-08-16, ürün sahibi kararıyla birlikte — T-214 ÖNCESİ):
 *
 *     tierRoles        yalnız bu dosyada     (grep src/ → entity + bu yorum)
 *     delegateAllowed  yalnız bu dosyada
 *     amountThreshold  yalnız bu dosyada     ⚠️ artık BAYAT — bkz. yukarısı
 *     ApprovalPolicy'yi import eden ÜRETİM dosyası: 0   ⚠️ artık BAYAT — T-214
 *                                                        `approval-policy.{service,repository}.ts`
 *                                                        ekledi (`grep -rl "from '.*approval-policy.entity'" src` ile doğrula)
 *     POZİTİF KONTROL: ApprovalRequest'i import eden 12
 *
 * `tierRoles`/`delegateAllowed` için sonuç değişmedi: satır `SELECT *` ile
 * dönerken bu alanlar da gelir (entity'nin bir parçası oldukları için), ama
 * hiçbir iş kuralı onları OKUMUYOR/kullanmıyor — yalnız taşınıyorlar.
 *
 * ⛔ Bunlar `T-233`'ün ("ölü yapı, düşürülsün") sınıfı DEĞİL. Fark yön:
 *   T-233     bir SONRAKİ karar (`0056-K3(b)`) yapıyı öksüz bıraktı
 *   burada    bir ÖNCEKİ karar (`K-2.5.13e`) onu bilerek koydu, ve GEÇERLİ
 *
 * Düşürmek `K-2.5.13e`'yi GERİ ALMAK olur ve karar defterine kayıt gerektirir
 * (`0006-R` deseni). Ürün sahibi 2026-08-16'da KALSIN dedi.
 *
 * 📌 `T-214`'ün cevabı bir MODEL değişikliği değil, bir YAZMA YOLUYDU:
 * katalog = enum (kod) · seçim + parametre = satır (veri). `CHECK`
 * `CHK_approval_policies_threshold_template` bunu zaten zorluyordu:
 * `THRESHOLD` ⇔ `amount_threshold IS NOT NULL`. Yazma yolu artık VAR —
 * `ApprovalPolicyService.update()` DB'ye gitmeden önce aynı kuralı `400` ile
 * doğrular (CHECK bir arka duvar olarak kalır, tek savunma değil). ⚠️
 * `THRESHOLD` HÂLÂ seed'lenMEDİ — `X`'i uydurmak olurdu (`CLAUDE.md`: ölçütü
 * korumak için veri uydurma); tutar tenant'ın bu uçla girdiği bir değerdir.
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
