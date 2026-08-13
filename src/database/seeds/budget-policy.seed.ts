/**
 * BudgetPolicy Seed — B dalgası / S4 seed item 1: "joker bütçe politikası satırı"
 * (`K-2.2.8d` — ZORUNLU, `EK_C § butce_politikalari`).
 *
 * `K-2.2.8d`: her kiracıda bir joker satır (kanal VE kategori boş) zorunludur — bu,
 * en-spesifik-kazanır çözümlemesinin fallback'idir. Sıfır satır demek, bütçe politikası
 * çözümlemesinin FALLBACK'İ YOK demek (code-reviewer, T-101'in sınıfı).
 *
 * Değerler kaynaktan (`EK_C § butce_politikalari`, `K-2.2.8a`–`d`): uyarı eşiği 80,
 * finans inceleme eşiği 90, blok eşiği 100, finans inceleme modu BİLDİRİM/NOTIFY —
 * dördü de migration'ın kendi kolon `DEFAULT`'ları (bkz. `1803000000000`), burada
 * TEKRAR YAZILMIYOR (tek kaynak — `K-2.3.10` ilkesiyle aynı disiplin).
 *
 * İdempotent: `UQ_budget_policies_tenant_channel_category` (`NULLS NOT DISTINCT`) üzerinden
 * `ON CONFLICT DO NOTHING`.
 */
import { DataSource, IsNull } from 'typeorm';
import { BudgetPolicy } from '../entities/budget-policy.entity';

export async function seedBudgetPolicies(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<void> {
  const repo = dataSource.getRepository(BudgetPolicy);

  // ⚠️ `{ channelId: undefined }` TypeORM'da alanı WHERE'den ÇIKARIR, `IS NULL` üretmez
  // — `IsNull()` şart, yoksa "joker var mı" sorusu yanlış cevaplanır (herhangi bir satır
  // varlığını "joker var" sanar).
  const existingJoker = await repo.findOne({
    where: { tenantId, channelId: IsNull(), categoryId: IsNull() },
  });
  if (existingJoker) {
    console.log('   BudgetPolicies: 0 inserted (joker already present)');
    return;
  }

  const result = await dataSource
    .createQueryBuilder()
    .insert()
    .into(BudgetPolicy)
    .values({ tenantId, createdBy: createdByUserId })
    .orIgnore()
    .execute();

  // review S7 emsali: `.orIgnore()` ile `identifiers.length` girdi satırlarından
  // dolar, gerçek `RETURNING`'den değil (ampirik ölçüldü, fiscal-period.seed.ts'e
  // bkz.) — `raw.length` kullanılıyor. Buradaki pre-check (yukarı) normal koşuda
  // bu satıra hiç yanlış bir "1" düşürtmez, ama ölçüm disiplini aynı kalsın.
  console.log(`   BudgetPolicies: ${result.raw.length} inserted (joker satır)`);
}
