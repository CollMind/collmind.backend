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

  // Z23 (2026-08-23, [[T-273]]): `{ cascade: true }` KALDIRILDI — bilerek.
  // Bu, `.save(agreement)` çağrıldığında ebevevenin alanları
  // DEĞİŞMESE BİLE `rates` koleksiyonunun elemanlarını TypeORM'un
  // sessizce yeniden persist etmeye çalışmasına yol açıyordu (grep'lenemeyen
  // bir yazma yolu — DI çağrısı değil, ham SQL değil, `relations:[]`
  // değil; bir `@OneToMany` seçeneğinin `.save(parent)` üzerindeki örtük
  // yan etkisi, [[T-271]]'de canlı sorgu loguyla ölçüldü:
  // `UPDATE lta_rates SET channel_id = $1, category_id = $2 ...` — `rates`
  // hiç dokunulmamışken). `rates` yazımı `LTAAgreementService`'te AÇIKÇA
  // yapılır (`ltaRateRepository.create()` + `.save()`,
  // `createAgreement`/`updateAgreement`). Cascade kaldırıldıktan sonra bu
  // yazma yolları DEĞİŞMEDİ — ölçüldü ([[T-273]] ŞART 1): agreement hiçbir
  // zaman `.save()`'den ÖNCE `this.rates = [...]` ile doldurulmuyor,
  // dolayısıyla cascade'e yaslanan meşru bir yol yoktu.
  @OneToMany('LTARate', 'ltaAgreement')
  rates!: any[];

  // Z23 (2026-08-23, [[T-273]]): `{ cascade: true }` KALDIRILDI — bilerek,
  // yukarısıyla AYNI gerekçe VE ikinci bir vaka. `findById` bu ilişkiyi
  // HER ZAMAN yükler (`relations: [..., 'planOverrides']`); bir agreement'ın
  // GERÇEK bir `lta_plan_overrides` satırı varken `PATCH`/`activate`/
  // `terminate` cascade'in `lta_plan_overrides`'a UPDATE/INSERT denemesi
  // riskini taşıyordu — o tabloda `app_runtime`'ın YALNIZ `SELECT`'i var
  // (S3 tur 24, bilerek: bu tabloya yazan hiçbir üretim yolu yok).
  // ⚠️ Ölçüldü ([[T-273]] ŞART 2, canlı sorgu logu, gerçek bir override
  // satırıyla): BUGÜNKÜ `relations` kümesiyle (yalnız `'planOverrides'`,
  // iç içe `.ltaRate`/`.plan`/`.ltaAgreement` join'i YOK) cascade `lta_
  // plan_overrides`'a HİÇBİR SQL üretmiyordu — TypeORM'un diff motoru
  // yüklenmiş/değişmemiş nesnede boş fark buluyor (LTARate'in `channel_id`/
  // `category_id` çift-eşlemeli nullable ilişkisiyle AYNI mekanizma
  // değil: `LTAPlanOverride.plan`/`.ltaRate`/`.ltaAgreement` `findById`'de
  // HİÇ join edilmediği için `undefined` kalıyor, TypeORM bu alanı hiç
  // diff'lemiyor). Yani BUGÜN ateşleyen bir `500` YOKTU. Kaldırma yine de
  // uygulanır çünkü kusur bir SINIFTIR (§7.1: "kapsam, kusurun sınıfıyla
  // tanımlanır, bulunduğu ilk vakanın yazımıyla değil") — `rates`'te
  // ATEŞLEDİĞİ kanıtlı, ve `planOverrides`'a bir gün `.ltaRate`/`.plan`
  // join'i eklenirse (T-269'un `planOverrides` joinini eklediği gibi) AYNI
  // sınıf sessizce tekrarlanabilirdi.
  @OneToMany('LTAPlanOverride', 'ltaAgreement')
  planOverrides!: any[];
}
