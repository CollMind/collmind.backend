import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `main.budget_transaction_logs` + `main.budget_allocations` DÜŞÜRÜLÜR — `Z21`/`Z24`
 * kararıyla: bu iki tablo `K-2.2.3` ihlali olarak doğdu (`Z21` — "farklı bir yol farklı
 * bir boyut kümesiyle zarf ARAYAMAZ", ve `BudgetAllocationService.findMatchingAllocation`
 * tam bu ihlali taşıyordu). Kanonik model `budget_envelopes` + `budget_transactions`'dır
 * (bkz. `budget.service.ts`/`budget.repository.ts` — DOKUNULMADI).
 *
 * Tüketicisizlik ölçümü (bu migration'ın dayandığı, `T-265` + bu tur):
 *   `POST /budget-allocations` ve kardeş uçlar: controller DIŞINDA SIFIR çağıran
 *     (`T-265`, pozitif kontrollü — `grep -rn` `BudgetAllocationController` → yalnız
 *     kendi dosyası + `budget.module.ts` kaydı).
 *   `BudgetAllocationService`: SIFIR DIŞ çağıran (`A2` — `spend-validation.service.ts`
 *     `checkBudgetAvailability` artık zarf modeline taşındı; bu servisin kalan üç
 *     atfı (`finance-reporting.service.spec.ts`, `finance-reporting.budget-variance.
 *     service.spec.ts`, `finance-reporting.module.ts`) YALNIZ yorum/gereksiz test
 *     provider'ı — `FinanceReportingService`'in constructor'ı `BudgetAllocation`/
 *     `BudgetAllocationService` enjekte ETMİYOR, ölçüldü).
 *   `BudgetTransactionLog`: tek tüketicisi `BudgetAllocationService`'in kendisiydi.
 *   İki tablo da `0` satır (ölçüldü, şema-nitelendirilmiş: `SELECT count(*) FROM
 *   main.budget_allocations` / `main.budget_transaction_logs`).
 *
 * "Geçiş dönemi kimin için?" sorusunun cevabı hiç kimse — geçiş dönemi yok, doğrudan drop.
 *
 * ── FK YÖNÜ (ölçüldü, canlı katalog, `pg_dump --schema-only`) ─────────────────────────
 *   FK_d803327caaf6745f39ccc8729da  budget_transaction_logs.budget_allocation_id
 *                                   → budget_allocations.id  ON DELETE CASCADE
 *   Bu iki tabloya bağlı DIŞARIDAN FK: 0 (yalnız aralarındaki + cpls/plans/users'a giden).
 *   → DÜŞÜRME SIRASI: `budget_transaction_logs` ÖNCE (allocations'a FK ile bağlı),
 *     `budget_allocations` SONRA.
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805`/`1807`/`1808`/`1809`/`1810` deseni) ─────
 *   tablo YOK            → no-op (zaten uygulanmış / taze DB)
 *   tablo VAR, 0 satır   → DROP + assert (beklenen — ölçüldü: ikisi de 0 satır)
 *   tablo VAR, satır VAR → İPTAL (throw) — küme değişmiş, sessizce SİLİNMEZ
 *
 * `down()`, `1771169825000-UpdateBudgetAllocationStructure.ts` (yapı) +
 * `1786000000000-AddMetadataToBudgetAllocations.ts` (`metadata` kolonu) +
 * `1798000000000-AddPartialIdempotencyIndexToBudgetTransactionLogs.ts` (kısmi UNIQUE
 * idempotency index) 'in ilgili bölümlerini BİREBİR geri kurar — kaynak canlı katalogdan
 * alındı (`pg_dump --schema-only -n main -t main.budget_allocations -t
 * main.budget_transaction_logs`, ölçüldü), üç migration'ın metnini elle birleştirerek
 * DEĞİL.
 */
export class DropBudgetAllocationsAndTransactionLogs1811000000000 implements MigrationInterface {
  name = 'DropBudgetAllocationsAndTransactionLogs1811000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1) budget_transaction_logs ÖNCE (allocations'a FK ile bağlı) ────────────────
    const logsExists = await queryRunner.hasTable(
      'main.budget_transaction_logs',
    );
    if (logsExists) {
      const [{ cnt: logsRowCount }]: [{ cnt: number }] =
        await queryRunner.query(`
        SELECT COUNT(*)::int AS cnt FROM "main"."budget_transaction_logs";
      `);
      if (logsRowCount > 0) {
        throw new Error(
          `Z24 DropBudgetAllocationsAndTransactionLogs ASSERT başarısız: ` +
            `main.budget_transaction_logs ${logsRowCount} satır taşıyor (beklenen: 0, ` +
            `ölçüldü bu turda). Bu tablo "tüketicisiz/ölü model" kararının dayandığı ` +
            `ölçümle ÇELİŞİYOR — küme bu veritabanında değişmiş olabilir. Migration ` +
            `İPTAL edildi (transaction rollback). Team Lead'e bildir, elle silme YAPMA.`,
        );
      }
      await queryRunner.query(`DROP TABLE "main"."budget_transaction_logs";`);
      const stillExists = await queryRunner.hasTable(
        'main.budget_transaction_logs',
      );
      if (stillExists) {
        throw new Error(
          `Z24 DropBudgetAllocationsAndTransactionLogs ASSERT başarısız: DROP TABLE ` +
            `sonrası main.budget_transaction_logs hâlâ var görünüyor. Migration İPTAL ` +
            `edildi.`,
        );
      }
    }
    // logsExists === false → zaten uygulanmış / taze DB, no-op (bu tablo için).

    // ── 2) budget_allocations SONRA ──────────────────────────────────────────────────
    const allocationsExists = await queryRunner.hasTable(
      'main.budget_allocations',
    );
    if (allocationsExists) {
      const [{ cnt: allocationsRowCount }]: [{ cnt: number }] =
        await queryRunner.query(`
          SELECT COUNT(*)::int AS cnt FROM "main"."budget_allocations";
        `);
      if (allocationsRowCount > 0) {
        throw new Error(
          `Z24 DropBudgetAllocationsAndTransactionLogs ASSERT başarısız: ` +
            `main.budget_allocations ${allocationsRowCount} satır taşıyor (beklenen: 0, ` +
            `ölçüldü bu turda). Bu tablo "tüketicisiz/ölü model" kararının dayandığı ` +
            `ölçümle ÇELİŞİYOR — küme bu veritabanında değişmiş olabilir. Migration ` +
            `İPTAL edildi (transaction rollback). Team Lead'e bildir, elle silme YAPMA.`,
        );
      }
      await queryRunner.query(`DROP TABLE "main"."budget_allocations";`);
      const stillExists = await queryRunner.hasTable('main.budget_allocations');
      if (stillExists) {
        throw new Error(
          `Z24 DropBudgetAllocationsAndTransactionLogs ASSERT başarısız: DROP TABLE ` +
            `sonrası main.budget_allocations hâlâ var görünüyor. Migration İPTAL edildi.`,
        );
      }
    }
    // allocationsExists === false → zaten uygulanmış / taze DB, no-op (bu tablo için).

    // ── 3) Enum tipleri ──────────────────────────────────────────────────────────────
    // Yalnız bu iki tablo tarafından kullanılıyordu (`budget_alert_configurations`in
    // kendi enum'ları — `alert_level_enum`/`notification_channel_enum` — AYRI ve
    // DOKUNULMADI, o tablo kapsam dışı). `IF EXISTS` idempotent: no-op dalında bile
    // güvenli.
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_transaction_logs_transaction_type_enum";`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_allocations_period_type_enum";`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Enum tipleri ÖNCE (tablolar onlara referans verecek) ─────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_allocations_period_type_enum" AS ENUM('yearly', 'quarterly', 'monthly');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_transaction_logs_transaction_type_enum" AS ENUM('allocation', 'utilization', 'release', 'adjustment', 'transfer', 'reservation', 'commit');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // ── budget_allocations ÖNCE (transaction_logs ona FK ile bağlanacak) ─────────────
    const allocationsExists = await queryRunner.hasTable(
      'main.budget_allocations',
    );
    if (!allocationsExists) {
      await queryRunner.query(`
        CREATE TABLE "main"."budget_allocations" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "tenant_id" uuid NOT NULL,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "deleted_at" timestamp,
          "created_by" uuid,
          "updated_by" uuid,
          "period_type" "main"."budget_allocations_period_type_enum" NOT NULL,
          "period_start" date NOT NULL,
          "period_end" date NOT NULL,
          "fiscal_year" integer NOT NULL,
          "cpl_id" uuid,
          "channel" character varying(50),
          "category" character varying(100),
          "on_invoice_budget" numeric(15,2) NOT NULL DEFAULT 0,
          "off_invoice_budget" numeric(15,2) NOT NULL DEFAULT 0,
          "on_invoice_utilized" numeric(15,2) NOT NULL DEFAULT 0,
          "off_invoice_utilized" numeric(15,2) NOT NULL DEFAULT 0,
          "on_invoice_reserved" numeric(15,2) NOT NULL DEFAULT 0,
          "off_invoice_reserved" numeric(15,2) NOT NULL DEFAULT 0,
          "alert_threshold_80" boolean NOT NULL DEFAULT true,
          "alert_threshold_95" boolean NOT NULL DEFAULT true,
          "alert_threshold_100" boolean NOT NULL DEFAULT true,
          "alert_recipients" jsonb,
          "hard_limit_mode" boolean NOT NULL DEFAULT false,
          "allow_carry_forward" boolean NOT NULL DEFAULT false,
          "total_budget" numeric(15,2) GENERATED ALWAYS AS (on_invoice_budget + off_invoice_budget) STORED NOT NULL,
          "on_invoice_available" numeric(15,2) GENERATED ALWAYS AS ((on_invoice_budget - on_invoice_utilized) - on_invoice_reserved) STORED NOT NULL,
          "off_invoice_available" numeric(15,2) GENERATED ALWAYS AS ((off_invoice_budget - off_invoice_utilized) - off_invoice_reserved) STORED NOT NULL,
          "metadata" jsonb,
          CONSTRAINT "PK_933f4bf5c342928196cc20be363" PRIMARY KEY ("id")
        );
      `);
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_budget_allocations_tenant_period"
          ON "main"."budget_allocations" ("tenant_id", "period_type", "period_start", "period_end", "cpl_id", "channel", "category")
          WHERE "deleted_at" IS NULL;
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_budget_allocations_period_fiscal"
          ON "main"."budget_allocations" ("period_type", "fiscal_year");
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_budget_allocations_cpl"
          ON "main"."budget_allocations" ("cpl_id");
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_budget_allocations_period_dates"
          ON "main"."budget_allocations" ("period_start", "period_end");
      `);
      await queryRunner.query(`
        ALTER TABLE "main"."budget_allocations"
          ADD CONSTRAINT "FK_41b10db5a79496d615b6d2ae5d5"
          FOREIGN KEY ("cpl_id") REFERENCES "main"."cpls"("id") ON DELETE RESTRICT;
      `);
    }
    // allocationsExists === true → zaten geri kurulmuş (idempotent revert), no-op.

    // ── budget_transaction_logs SONRA ────────────────────────────────────────────────
    const logsExists = await queryRunner.hasTable(
      'main.budget_transaction_logs',
    );
    if (!logsExists) {
      await queryRunner.query(`
        CREATE TABLE "main"."budget_transaction_logs" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "tenant_id" uuid NOT NULL,
          "budget_allocation_id" uuid NOT NULL,
          "transaction_type" "main"."budget_transaction_logs_transaction_type_enum" NOT NULL,
          "on_invoice_amount" numeric(15,2) NOT NULL DEFAULT 0,
          "off_invoice_amount" numeric(15,2) NOT NULL DEFAULT 0,
          "plan_id" uuid,
          "description" text,
          "created_by" uuid,
          "idempotency_key" character varying(200),
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "deleted_at" timestamp,
          "updated_by" uuid,
          CONSTRAINT "PK_bc431af68c3b46ed037d6fea8f5" PRIMARY KEY ("id")
        );
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_budget_transaction_logs_allocation_created"
          ON "main"."budget_transaction_logs" ("budget_allocation_id", "created_at");
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_budget_transaction_logs_plan"
          ON "main"."budget_transaction_logs" ("plan_id");
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_budget_transaction_logs_type"
          ON "main"."budget_transaction_logs" ("transaction_type");
      `);
      // T-095 (`1798000000000`) — kısmi UNIQUE, `idempotency_key IS NOT NULL` olan
      // satırlar için. Bkz. o migration'ın "NOTE ON SHAPE" yorumu.
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_BUDGET_TRANSACTION_LOGS_TENANT_IDEMPOTENCY"
          ON "main"."budget_transaction_logs" ("tenant_id", "idempotency_key")
          WHERE "idempotency_key" IS NOT NULL;
      `);
      await queryRunner.query(`
        ALTER TABLE "main"."budget_transaction_logs"
          ADD CONSTRAINT "FK_d803327caaf6745f39ccc8729da"
          FOREIGN KEY ("budget_allocation_id") REFERENCES "main"."budget_allocations"("id") ON DELETE CASCADE;
      `);
      await queryRunner.query(`
        ALTER TABLE "main"."budget_transaction_logs"
          ADD CONSTRAINT "FK_b01aa597874f81d2e309dd02150"
          FOREIGN KEY ("plan_id") REFERENCES "main"."plans"("id") ON DELETE SET NULL;
      `);
      await queryRunner.query(`
        ALTER TABLE "main"."budget_transaction_logs"
          ADD CONSTRAINT "FK_dbf6259f6e8603a54a4dc29c76b"
          FOREIGN KEY ("created_by") REFERENCES "main"."users"("id") ON DELETE RESTRICT;
      `);
    }
    // logsExists === true → zaten geri kurulmuş (idempotent revert), no-op.
  }
}
