/**
 * ApprovalPolicy Seed — B dalgası / S5 seed item 2: "üç onay şablonu" (`K-2.5.13a`).
 *
 * ⛔ **İKİ şablon seed'lendi, ÜÇÜNCÜ (`THRESHOLD`/EŞİKLİ) DEĞİL — bilinçli, kaydedilen
 * bir eksiklik, sessiz atlama DEĞİL.**
 *
 * `K-2.5.13a`'nın kendi metni: "Eşikli: Tutar < X tek onay · ≥ X finans eklenir" — `X`
 * bir DEĞİŞKEN olarak yazılı, somut bir para birimi YOK. `EK_C`, `L2_03`, `02_YETENEK_
 * HARITASI.md`, `04_KARAR_KAYDI.md` tarandı — hiçbirinde bir "görüşlü varsayılan" tutar
 * yok (K-2.2.8a-d'nin 80/90/100'ünün aksine). `K-2.5.13c`: "tenant bir şablon SEÇER ve
 * eşik değerlerini AYARLAR" — yani `amount_threshold` ürün-çapında değil, TENANT
 * kararı, ve bugün onu ayarlayacak bir admin UI/API yolu da yok.
 *
 * `CHK_approval_policies_threshold_template` `template='THRESHOLD'` iken `amount_
 * threshold IS NOT NULL` zorunlu kılıyor — kaynaksız bir sayı uydurmak `§2.5` (sessiz
 * sıfır/varsayılan yasağı) ihlali olurdu. Seed bu yüzden yalnız eşik GEREKTİRMEYEN iki
 * şablonu (`STANDARD`, `TWO_TIER`) yazıyor. `THRESHOLD` şablonu — ve onun tutar eşiği —
 * ürün sahibi kararı bekliyor.
 *
 * `STANDARD` "varsayılan" (`K-2.5.13a`'nın kendi tablosu) — `approval_policy_id`'nin
 * "ilk şablona bağlanır" (`K-2.5.13f`) dediği şablon budur.
 *
 * İdempotent: `(tenant_id, template)` üzerinde uygulama-seviyesi upsert (DB'de bu
 * çift için ayrı bir UNIQUE yok — bir tenant'ın aynı şablonu birden çok kez
 * seçebileceği/kopyalayabileceği K-2.5.13b'nin "satır kümesi" modeliyle tutarlı;
 * seed yalnız kendi yazdığı satırları tekilleştirir).
 */
import { DataSource } from 'typeorm';
import {
  ApprovalPolicy,
  ApprovalPolicyTemplate,
} from '../entities/approval-policy.entity';

export async function seedApprovalPolicies(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<void> {
  const repo = dataSource.getRepository(ApprovalPolicy);

  const templatesToSeed = [
    ApprovalPolicyTemplate.STANDARD,
    ApprovalPolicyTemplate.TWO_TIER,
  ];

  let inserted = 0;
  for (const template of templatesToSeed) {
    const existing = await repo.findOne({ where: { tenantId, template } });
    if (existing) continue;
    await repo.save(
      repo.create({ tenantId, template, createdBy: createdByUserId }),
    );
    inserted++;
  }

  console.log(
    `   ApprovalPolicies: ${inserted} inserted (STANDARD, TWO_TIER — THRESHOLD ` +
      `ürün sahibi tutar eşiği kararını bekliyor, bkz. dosya üstü yorum)`,
  );
}
