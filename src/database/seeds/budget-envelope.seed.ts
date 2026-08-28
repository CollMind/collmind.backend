import { DataSource } from 'typeorm';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../entities/budget-envelope.entity';
import { User } from '../entities/user.entity';

export async function seedBudgetEnvelopes(
  dataSource: DataSource,
  tenantId: string,
): Promise<BudgetEnvelope[]> {
  const repo = dataSource.getRepository(BudgetEnvelope);

  const envelopes = [
    {
      tenantId,
      code: 'ENV-2026-NKA-Q1',
      name: 'NKA Channel Q1 2026 Budget',
      fiscalYear: '2026',
      period: '2026-01', // Matches agreement periodMonth
      allocatedAmount: 500000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'National Key Accounts Q1 2026 Trade Budget',
      metadata: { channel: 'NKA' }, // Add channel to metadata for lookup
    },
    {
      tenantId,
      code: 'ENV-2026-NKA-Q2',
      name: 'NKA Channel Q2 2026 Budget',
      fiscalYear: '2026',
      period: '2026-02', // Matches approved agreement periodMonth
      allocatedAmount: 600000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'National Key Accounts Q2 2026 Trade Budget',
      metadata: { channel: 'NKA' }, // Add channel to metadata for lookup
    },
    {
      tenantId,
      code: 'ENV-2026-TRAD-Q1',
      name: 'Traditional Trade Q1 2026 Budget',
      fiscalYear: '2026',
      period: '2026-01',
      allocatedAmount: 300000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'Traditional Trade Q1 2026 Budget',
      metadata: { channel: 'TRADITIONAL_TRADE' }, // Add channel to metadata for lookup
    },
    {
      tenantId,
      code: 'ENV-2026-ECOM-Q1',
      name: 'E-Commerce Q1 2026 Budget',
      fiscalYear: '2026',
      period: '2026-02',
      allocatedAmount: 200000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'E-Commerce Q1 2026 Budget',
      metadata: { channel: 'E_COMMERCE' }, // Add channel to metadata for lookup
    },
  ];

  const created: BudgetEnvelope[] = [];
  for (const envelope of envelopes) {
    const existing = await repo.findOne({
      where: { code: envelope.code, tenantId },
    });
    if (!existing) {
      const entity = repo.create(envelope);
      created.push(await repo.save(entity));
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} budget envelopes`);
  return created;
}

/**
 * `Z59 §3b` backfill — `budget_owner_id` canlıda 4/4 zarfta NULL, ve `T-318`
 * kanıtladı bu bir "hiç yazıcısı yok" boşluğu (henüz hiçbir form/akış bu
 * alanı doldurmuyor, `Z59 §1`). Zorunlu kılınmıyor (`Z59 §3`: yol açmadan
 * zorunluluk koymak yasak) — yalnız MEVCUT zarflara kanonik bir sahip
 * atanıyor, böylece `WARNING` (%80) alıcı çözümlemesi canlıda hard-throw'a
 * düşmüyor.
 *
 * Sahip: `category.manager@wella.com` (Team Lead kararı, `Z59 §3`) — zarf
 * kanal+kategori kapsamlı, harcamanın sahibi kategori yöneticisi; ve bilerek
 * `FINANCE` DEĞİL — `WARNING`'in owner-yolu ile `FINANCE`'e düşen fallback-yolu
 * (`Z59 §2`) AYNI alıcıya düşerse, bir pin ikisini ayırt edemez (`DISIPLIN`:
 * "fixture, ayırt etmek istediği iki tarafta FARKLI değer taşımalı").
 *
 * `T-316`'nın `budget-policy.seed.ts`'teki ÜÇ DURUM deseni izlenir:
 *   ölçülmüş boş (`budgetOwnerId` NULL)  → DOLDUR
 *   kanonik (zaten categoryManager'a eşit) → NO-OP
 *   BAŞKA bir değer (kullanıcı bilinçli seçim yapmış olabilir) → ⛔ DOKUNMA + görünür uyarı
 */
export async function backfillBudgetEnvelopeOwners(
  dataSource: DataSource,
  tenantId: string,
  categoryManagerUser: User,
): Promise<void> {
  const repo = dataSource.getRepository(BudgetEnvelope);
  const envelopes = await repo.find({ where: { tenantId } });

  let filled = 0;
  let skippedCanonical = 0;
  let skippedForeign = 0;

  for (const envelope of envelopes) {
    if (!envelope.budgetOwnerId) {
      await repo.update(
        { id: envelope.id },
        {
          budgetOwnerId: categoryManagerUser.id,
          budgetOwnerEmail: categoryManagerUser.email,
          budgetOwnerName: categoryManagerUser.fullName,
        },
      );
      filled += 1;
      continue;
    }
    if (envelope.budgetOwnerId === categoryManagerUser.id) {
      skippedCanonical += 1;
      continue;
    }
    // ⛔ DOKUNMA. Başka bir owner atanmış olabilir — bilinçli bir seçim
    // olabilir (§2.5: gizli tie-break yasak).
    console.warn(
      `   BudgetEnvelopeOwners: zarf ${envelope.code} (${envelope.id}) ` +
        `owner'ı ne boş ne kanonik (${envelope.budgetOwnerId}). ` +
        `DOKUNULMADI — kiracı konfigürasyonu olabilir (Z59 §3).`,
    );
    skippedForeign += 1;
  }

  console.log(
    `   BudgetEnvelopeOwners: ${filled} filled, ${skippedCanonical} already canonical, ${skippedForeign} foreign (untouched)`,
  );
}
