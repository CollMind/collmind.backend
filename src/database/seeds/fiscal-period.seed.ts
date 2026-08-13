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

  // ⚠️ review S7 (2026-08-13, İKİ tur ölçüldü): birinci tur `missing.length`'i (ön-
  // hesaplanan tahmin) "N inserted" olarak logluyordu — `repo.find()` varsayılan
  // `deleted_at IS NULL` filtreler, soft-delete edilmiş bir satır "missing"e YANLIŞLIKLA
  // girerdi ve `.orIgnore()` sessizce atlardı. Düzeltme `result.identifiers.length`'e
  // geçti — ve BU DA YANLIŞ ÇIKTI: ampirik olarak ölçüldü (probe script, aynı kodu iki
  // kez INSERT etti), `.orIgnore()` ile TypeORM `identifiers`'ı GİRDİ satırlarından
  // dolduruyor, gerçek `RETURNING`'den DEĞİL — ikinci koşuda `identifiers.length` hâlâ
  // 3 derken `raw.length` (ve DB'deki gerçek satır sayısı) 0 idi. Doğru sayaç `raw`
  // (driver'ın gerçek `RETURNING` sonucu, ON CONFLICT'te atlanan satırları İÇERMEZ).
  const rows = codes.map((kod) =>
    repo.create({ tenantId, kod, createdBy: createdByUserId }),
  );
  const result = await repo
    .createQueryBuilder()
    .insert()
    .into(FiscalPeriod)
    .values(rows)
    .orIgnore()
    .execute();
  const actuallyInserted = result.raw.length;

  console.log(
    `   FiscalPeriods: ${actuallyInserted} inserted (${codes.length} total window: 2025-01..2027-12, ${codes.length - actuallyInserted} already present)`,
  );
}
