import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-019 Faz 1 (docs/analysis/0008-on-off-invoice-envelope-design.md §4,
 * ADR 0004): BRD §8 "Ayrı ayrı: On-Invoice / Off-Invoice" bütçe boyutu.
 *
 * ⚠️ Bu migration HİÇ PARA TAŞIMAZ. Yalnızca:
 *  1. `budget_spend_type_enum` tipini yaratır.
 *  2. `budget_envelopes.spend_type` ve `budget_transactions.spend_type`
 *     kolonlarını NULLABLE olarak ekler (NULL = UNSPLIT/legacy — mevcut 4
 *     zarf hem on hem off kabul etmeye devam eder).
 *  3. Yalnızca AGREEMENT kaynaklı, tek-tipli (`agreements.spend_type` ON/OFF)
 *     mevcut RESERVE/COMMIT/RELEASE satırlarını SINIFLANDIRIR — `amount`,
 *     `envelope_id`, `idempotency_key` DEĞİŞMEZ. Bu yüzden `v_budget_summary`
 *     her zarf için up() öncesi/sonrası birebir aynı kalır (bkz. QA T1).
 *  4. Boyut aramasını hızlandıran, `spend_type`'ı da kapsayan yeni indeksler
 *     ekler (eskileri düşürmez — findEnvelopeByDimensions geriye uyumlu
 *     kalmalı).
 *
 * down(): yalnızca BU migration'ın backfill ettiği satırları (geçici
 * `main._t019_backfilled_tx` tablosundan) NULL'a döndürür — başka satıra
 * dokunmaz (T-030 "kendi yazdığından fazlasını silme" ilkesi). Faz 2 (split)
 * çalışmışsa (aynı boyutlarda spend_type dışında ayırt edilemeyen birden
 * fazla zarf varsa) güvenlik amacıyla exception fırlatır.
 */
export class AddSpendTypeToBudgetDimensions1795000000000 implements MigrationInterface {
  name = 'AddSpendTypeToBudgetDimensions1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'budget_spend_type_enum' AND n.nspname = 'main'
        ) THEN
          CREATE TYPE main.budget_spend_type_enum AS ENUM ('ON_INVOICE', 'OFF_INVOICE');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE main.budget_envelopes
      ADD COLUMN IF NOT EXISTS spend_type main.budget_spend_type_enum NULL
    `);

    await queryRunner.query(`
      ALTER TABLE main.budget_transactions
      ADD COLUMN IF NOT EXISTS spend_type main.budget_spend_type_enum NULL
    `);

    // Ayırt edicilik: bu migration'ın sınıflandırdığı satır id'lerini takip et
    // (down()'un "kendi yazdığından fazlasını silme" ilkesi, T-030 deseni).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS main._t019_backfilled_tx (
        tx_id uuid PRIMARY KEY
      )
    `);

    await queryRunner.query(`
      INSERT INTO main._t019_backfilled_tx (tx_id)
      SELECT bt.id
        FROM main.budget_transactions bt
        JOIN main.agreements a ON a.id = bt.source_id
       WHERE bt.source_type = 'AGREEMENT'
         AND a.spend_type IN ('ON_INVOICE', 'OFF_INVOICE')
         AND bt.tx_type IN ('RESERVE', 'COMMIT', 'RELEASE')
         AND bt.spend_type IS NULL
      ON CONFLICT (tx_id) DO NOTHING
    `);

    // Sınıflandırma backfill'i — para hareketi DEĞİL. `amount`/`envelope_id`/
    // `idempotency_key` dokunulmaz.
    await queryRunner.query(`
      UPDATE main.budget_transactions bt
         SET spend_type = a.spend_type::text::main.budget_spend_type_enum
        FROM main.agreements a
       WHERE bt.id IN (SELECT tx_id FROM main._t019_backfilled_tx)
         AND bt.source_type = 'AGREEMENT'
         AND bt.source_id = a.id
    `);

    // Boyut aramasını hızlandıran yeni indeksler (eskiler DÜŞÜRÜLMEZ —
    // findEnvelopeByDimensions'ın spendType'sız çağrıları geriye uyumlu
    // kalmalı, bkz. §5.1).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_envelopes_channel_period_spend
      ON main.budget_envelopes(tenant_id, channel, period, spend_type)
      WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_envelopes_channel_category_period_spend
      ON main.budget_envelopes(tenant_id, channel, category, period, spend_type)
      WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Guard: Faz 1'in up() bu kolonu YALNIZCA transaction'larda sınıflandırır
    // — hiçbir envelope satırına spend_type YAZMAZ (§4 "hiç para taşınmaz").
    // Dolayısıyla `budget_envelopes.spend_type IS NOT NULL` görmek, Faz 2'nin
    // split operasyonunun (POST /budget/envelopes/:id/split) çalıştığının
    // doğrudan kanıtıdır. Kolonu o durumda düşürmek zarfları ayırt edilemez
    // hale getirir (findEnvelopeByDimensions rastgele birini seçer → sessiz
    // mis-attribution). Dur.
    //
    // NOT: dimension-based grouping (tenant/channel/category/period) YANLIŞ
    // bir guard olurdu — bugünkü 4 zarfın `channel`/`category` kolonları NULL
    // (eşleşme metadata fallback'iyle yapılıyor, §2.1), bu da farklı gerçek
    // kanalların aynı (tenant, NULL, NULL, period) grubuna düşüp YANLIŞ
    // POZİTİF vermesine yol açar (bu migration'ın ilk taslağında yakalandı —
    // QA doğrulaması sırasında canlı DB'ye karşı görüldü).
    const splitEnvelopes = await queryRunner.query(`
      SELECT id FROM main.budget_envelopes WHERE spend_type IS NOT NULL LIMIT 1
    `);
    if (splitEnvelopes.length > 0) {
      throw new Error(
        'T-019 down(): split envelopes exist (budget_envelopes.spend_type populated); run the Faz 2 split-reversal migration first',
      );
    }

    await queryRunner.query(`
      UPDATE main.budget_transactions
         SET spend_type = NULL
       WHERE id IN (SELECT tx_id FROM main._t019_backfilled_tx)
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS main.idx_budget_envelopes_channel_period_spend
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS main.idx_budget_envelopes_channel_category_period_spend
    `);

    await queryRunner.query(`
      ALTER TABLE main.budget_envelopes DROP COLUMN IF EXISTS spend_type
    `);
    await queryRunner.query(`
      ALTER TABLE main.budget_transactions DROP COLUMN IF EXISTS spend_type
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS main._t019_backfilled_tx
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'main' AND table_name = 'budget_envelopes' AND column_name = 'spend_type'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'main' AND table_name = 'budget_transactions' AND column_name = 'spend_type'
        ) THEN
          DROP TYPE IF EXISTS main.budget_spend_type_enum;
        END IF;
      END $$;
    `);
  }
}
