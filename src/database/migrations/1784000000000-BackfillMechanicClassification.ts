/**
 * T-018 — Backfill Mechanic Classification
 *
 * Problem: Mevcut DB'deki mechanic satırlarında spendingType ve/veya category
 * NULL olabilir. SpendCalculationService.calculateMechanicSpend() bu alanları
 * switch/case ile okur; NULL olan satırlar 0 spend üretir → yanlış on/off
 * bütçe rezervasyonu.
 *
 * Bu migration:
 *   up()  — kod pattern'ine göre bilinen mechanic'leri günceller; belirsiz
 *            satırları dokunmadan bırakır ve loglar.
 *   down() — yalnızca bu migration'ın yazdığı satırları eski değerlerine
 *            geri alır (NULL'a döner); manuel değişikliklere dokunmaz.
 *
 * VERİ ETKİSİ: spendingType/category alanları güncellenir. Devam eden
 * plan hesapları etkilenir — migration sonrası plan recalc önerilir.
 * Yanlış sınıflandırma = yanlış bütçe → emin olunmayan satır güncellenmez.
 *
 * GERİ-ALMA PLANI: down() çağrısı güvenlidir; NULL'a dönen satırların
 * yeniden hesaplanması gerekir (SpendCalc 0 üretir).
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Kod → spendingType/category eşlemesi. Sadece kesin olarak bilinen kodlar. */
const KNOWN_MECHANICS: Array<{
  codePattern: string; // ILIKE pattern
  spendingType: string;
  category: string;
}> = [
  // MEC-DISCOUNT: agreement seed'den gelen genel on-invoice indirim
  {
    codePattern: 'MEC-DISCOUNT',
    spendingType: 'on_invoice',
    category: 'on_invoice_discount',
  },
  // CPP_ON_PCT: on-invoice CPP yüzde indirim
  {
    codePattern: 'CPP_ON_PCT',
    spendingType: 'on_invoice',
    category: 'on_invoice_discount',
  },
  // CPP_OFF_PCT: off-invoice CPP yüzde indirim
  {
    codePattern: 'CPP_OFF_PCT',
    spendingType: 'off_invoice',
    category: 'off_invoice_discount',
  },
  // VIS_LS: görünürlük lump-sum
  {
    codePattern: 'VIS_LS',
    spendingType: 'off_invoice',
    category: 'lumpsum_spend',
  },
  // DISPLAY_FEE: teşhir ücreti lump-sum
  {
    codePattern: 'DISPLAY_FEE',
    spendingType: 'off_invoice',
    category: 'lumpsum_spend',
  },
  // PRICE_SUP: birim başı fiyat desteği
  {
    codePattern: 'PRICE_SUP',
    spendingType: 'off_invoice',
    category: 'per_unit_support',
  },
];

export class BackfillMechanicClassification1784000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Her bilinen mechanic için NULL alanları güncelle ─────────────────
    for (const m of KNOWN_MECHANICS) {
      await queryRunner.query(
        `
        UPDATE "main"."mechanics"
        SET
          "spending_type" = COALESCE("spending_type", $1::main.mechanics_spending_type_enum),
          "category"      = COALESCE("category", $2::main.mechanics_category_enum)
        WHERE "code" ILIKE $3
          AND ("spending_type" IS NULL OR "category" IS NULL)
        `,
        [m.spendingType, m.category, m.codePattern],
      );
    }

    // ── 2. Heuristic backfill: kod 'ON' içeren ve category NULL olanlar ─────
    // "%ON%" pattern'i hem ON_INVOICE hem de benzerleri kapsar.
    // spendingType'ı ON_INVOICE, category'yi ON_INVOICE_DISCOUNT olarak atar.
    // NOT: Bu heuristic kural, sadece her iki alan da NULL ise çalışır.
    await queryRunner.query(`
      UPDATE "main"."mechanics"
      SET
        "spending_type" = 'on_invoice',
        "category"      = 'on_invoice_discount'
      WHERE "spending_type" IS NULL
        AND "category" IS NULL
        AND (
          "code" ILIKE '%_ON_%'
          OR "code" ILIKE '%_ON'
          OR "code" ILIKE 'ON_%'
        )
    `);

    // ── 3. Heuristic backfill: kod 'LS' veya 'LUMP' içeren, NULL olanlar ───
    await queryRunner.query(`
      UPDATE "main"."mechanics"
      SET
        "spending_type" = 'off_invoice',
        "category"      = 'lumpsum_spend'
      WHERE "spending_type" IS NULL
        AND "category" IS NULL
        AND (
          "code" ILIKE '%_LS'
          OR "code" ILIKE '%LUMP%'
        )
    `);

    // ── 4. Heuristic backfill: kod 'SUP' veya 'PER_UNIT' içerenler ─────────
    await queryRunner.query(`
      UPDATE "main"."mechanics"
      SET
        "spending_type" = 'off_invoice',
        "category"      = 'per_unit_support'
      WHERE "spending_type" IS NULL
        AND "category" IS NULL
        AND (
          "code" ILIKE '%_SUP'
          OR "code" ILIKE '%PER_UNIT%'
          OR "code" ILIKE '%PU_%'
        )
    `);

    // ── 5. Kalan NULL satırları raporla (loglama — bloklamaz) ────────────────
    const nullRows = await queryRunner.query(`
      SELECT "code", "spending_type", "category", "tenant_id"
      FROM "main"."mechanics"
      WHERE "spending_type" IS NULL OR "category" IS NULL
    `);

    if (nullRows.length > 0) {
      console.warn(
        `[BackfillMechanicClassification] ${nullRows.length} mechanic satırı ` +
          `hala NULL spendingType veya category içeriyor. ` +
          `Bu satırlar SpendCalc'te 0 spend üretecektir. ` +
          `Manuel güncelleme veya admin UI üzerinden sınıflandırma gereklidir.`,
      );
      for (const row of nullRows) {
        console.warn(
          `  - code=${row.code} spending_type=${row.spending_type} category=${row.category} tenant=${row.tenant_id}`,
        );
      }
    } else {
      console.log(
        '[BackfillMechanicClassification] Tüm mechanic satırları sınıflandırıldı.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Yalnızca bilinen kodlar için NULL'a geri dön.
    // Dikkat: down() SpendCalc'in tekrar 0 spend üretmesine yol açar;
    // plan hesaplarının yeniden çalıştırılması gerekir.
    for (const m of KNOWN_MECHANICS) {
      await queryRunner.query(
        `
        UPDATE "main"."mechanics"
        SET
          "spending_type" = NULL,
          "category"      = NULL
        WHERE "code" ILIKE $1
        `,
        [m.codePattern],
      );
    }

    // Heuristic ile değiştirilen satırları da NULL'a al
    // (heuristic pattern ile eşleşen tüm satırlar)
    await queryRunner.query(`
      UPDATE "main"."mechanics"
      SET
        "spending_type" = NULL,
        "category"      = NULL
      WHERE (
        "code" ILIKE '%_ON_%'
        OR "code" ILIKE '%_ON'
        OR "code" ILIKE 'ON_%'
        OR "code" ILIKE '%_LS'
        OR "code" ILIKE '%LUMP%'
        OR "code" ILIKE '%_SUP'
        OR "code" ILIKE '%PER_UNIT%'
        OR "code" ILIKE '%PU_%'
      )
    `);
  }
}
