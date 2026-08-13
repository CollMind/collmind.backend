/**
 * FiscalPeriod Seed — B dalgası / S11 (K-2.13.21) seed item 4: "aktif dönemler".
 *
 * `EK_C_VERI_SOZLUGU.md` § seed listesi bu kalemi migration'ın DIŞINDA, ayrı ve
 * atomik bir seed adımı olarak tanımlıyor. Migration yalnız MEVCUT verideki dönem
 * değerlerini `fiscal_periods`'a backfill eder (bkz. `1803000000000` §5) — YENİ bir
 * anlaşma/plan/hareket, o anda `fiscal_periods`'ta olmayan bir döneme yazılırsa
 * `FK_*_fiscal_period` reddeder. Bu seed, dev/seed akışının kullandığı dönem
 * penceresini önceden açar.
 *
 * İdempotent: `ON CONFLICT DO NOTHING` — `UQ_fiscal_periods_tenant_kod`.
 * Bu seed diğer seed'lerden (agreement, budget-transaction, sales-actual) ÖNCE
 * çağrılmalı — onlar `period_month`/`fiscal_period` yazıyor.
 */
import { DataSource } from 'typeorm';
import { FiscalPeriod } from '../entities/fiscal-period.entity';

/** 2025-01 .. 2027-12 — dev/seed/test verisinin kullandığı pencereyi kapsayacak
 * kadar geniş, üretim dönemi kapanış/erteleme kararlarını taklit etmeyecek kadar dar. */
function generatePeriodCodes(): string[] {
  const codes: string[] = [];
  for (let year = 2025; year <= 2027; year++) {
    for (let month = 1; month <= 12; month++) {
      codes.push(`${year}-${String(month).padStart(2, '0')}`);
    }
  }
  return codes;
}

export async function seedFiscalPeriods(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<void> {
  const repo = dataSource.getRepository(FiscalPeriod);
  const codes = generatePeriodCodes();

  const existing = await repo.find({ where: { tenantId } });
  const existingCodes = new Set(existing.map((p) => p.kod));
  const missing = codes.filter((c) => !existingCodes.has(c));

  if (missing.length === 0) {
    console.log(
      `   FiscalPeriods: 0 inserted (${codes.length} already present)`,
    );
    return;
  }

  const rows = missing.map((kod) =>
    repo.create({ tenantId, kod, createdBy: createdByUserId }),
  );
  await repo
    .createQueryBuilder()
    .insert()
    .into(FiscalPeriod)
    .values(rows)
    .orIgnore()
    .execute();

  console.log(
    `   FiscalPeriods: ${missing.length} inserted (${codes.length} total window: 2025-01..2027-12)`,
  );
}
