import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `T-358` / `Z87` — **`BL-3` ADIM 1**: red/kabul SATIR tablosu.
 *
 * Kaynak: `.claude/backlog/tasks/T-358.md` · `docs/process/BL3_DOGRULAMA_BRIEF.md §1` ·
 * `docs/brd-v2/04_KARAR_KAYDI.md` `Z87`. `BL-2`'nin import'u bugün red satırlarını
 * yalnız HTTP cevabında taşıyor — **kalıcı evi yok**. Bu tablo o evi kurar ve
 * `BL-3`'ün "%95'e neden ulaşamıyorum" teşhis raporunun KAYNAĞI olacak.
 *
 * ── AD KONVANSİYONU — ÖLÇÜLDÜ, TERCİH DEĞİL (F8) ─────────────────────────
 * Task/Z87 metni ürün dilinde `import_batch_rows` diyor. Bu repoda BUGÜN
 * paylaşılan/genel bir "import_batches" (ya da "import_batch_rows") kavramı
 * YOK — her import-domain'in KENDİ batch tablosu var (`sales_actual_batches`,
 * `on_invoice_batches`, `baseline_volume_import_batches` — bkz. `1822`'nin
 * JSDoc'u, "paylaşılan/genel bir import_batches kavramı YOK" kaydı). Jenerik
 * `import_batch_rows` adı tam da `1822`'nin reddettiği "paylaşılan genel
 * kavram" yanılsamasını GERİ getirirdi. ⇒ SAPMA: tablo `baseline_volume_
 * import_batch_rows` — kardeşiyle (`baseline_volume_import_batches`) BİREBİR
 * önek taşıyor.
 *
 * ── ŞEKİL (Z87, KİLİTLİ; `reason` `Z87 §F12` İLE REVİZE) ─────────────────
 * `batch_id` FK RESTRICT → `baseline_volume_import_batches` · `row_no`
 * integer (>0) · `raw jsonb` (hücre-ham, HER satırda NOT NULL) · `status
 * ENUM(ACCEPTED, REJECTED)` · `resolved_sku_id`/`resolved_cpl_id`
 * (NULLABLE, kabul edilende DOLU — `baseline_volumes`'a KÖPRÜ, `batch_id`
 * +`row_no` üzerinden).
 *
 * ── `reason` ENUM — `F12` REVİZYONU (2026-09-02) ─────────────────────────
 * ~~İlk `Z87` hükmü: `ENUM(SKU_NOT_FOUND, CPL_NOT_FOUND, INVALID_PERIOD,
 * INVALID_VALUE, DUPLICATE)` (5 değer) — BİREBİR uygulanmış, ama ölçülen
 * bir uyuşmazlıkla (bkz. bu dosyanın ilk sürümü / git geçmişi) Team Lead'e
 * bildirilmişti.~~ `F12` KAPATTI: enum artık `BL-2`'nin GERÇEK ürettiği
 * sözlük — **7 DEĞER**: `SKU_NOT_FOUND` · `CPL_NOT_FOUND` ·
 * `INVALID_PERIOD` · `INVALID_VOLUME_FORMAT` · `NEGATIVE_VOLUME` ·
 * `MISSING_REQUIRED_FIELD` · `DUPLICATE_GRAIN`. `INVALID_VALUE`/`DUPLICATE`
 * ÖLÜR (hiç üretilmiyordu, İlke 1). Taşıyıcı gerekçe: teşhis raporu
 * `NEGATIVE_VOLUME` (veri hatası) ile `INVALID_VOLUME_FORMAT`'ı (format
 * hatası) AYIRT ETMELİ. Tam gerekçe + parser/servis kanal ayrımı (`F8`)
 * entity JSDoc'unda (`baseline-volume-import-batch-row.entity.ts`).
 * Destekleyici: `1823` bu revizyon anında hiç PUSH edilmemişti, tablo
 * BOŞTU, `plans=0` penceresi AÇIKTI ⇒ maliyet sıfır (aynı dosya revize
 * edildi, yeni migration numarası AÇILMADI).
 *
 * ── `resolved_sku_id`/`resolved_cpl_id` — REASON'A BAĞLI ŞEKİL (KODDAN
 *    ÖLÇÜLDÜ — `baseline-volume.service.ts` `ingest()`, tahminden DEĞİL) ──
 * Tek `CHECK` (`CHK_..._acceptance_shape`) SEKİZ durumu ayırt eder:
 *   ACCEPTED                    ⇒ reason NULL, ikisi de NOT NULL
 *   REJECTED + SKU_NOT_FOUND    ⇒ resolved_sku_id VE resolved_cpl_id İKİSİ
 *                                  DE ZORUNLU NULL (`service.ts`:139-149 —
 *                                  SKU bulunamazsa CPL lookup'a hiç
 *                                  ulaşılmaz, ikisi de aranmamış sayılır)
 *   REJECTED + CPL_NOT_FOUND    ⇒ resolved_sku_id NOT NULL (SKU zaten
 *                                  bulundu) · resolved_cpl_id ZORUNLU NULL
 *                                  (`service.ts`:151-160 — CPL lookup
 *                                  yalnız SKU bulunduktan SONRA çalışır;
 *                                  SKU_NOT_FOUND'un simetriği DEĞİL)
 *   REJECTED + INVALID_PERIOD   ⇒ resolved_sku_id VE resolved_cpl_id İKİSİ
 *                                  DE ZORUNLU NULL (`service.ts`:110-137 —
 *                                  period denetimi SKU/CPL lookup'ının
 *                                  HER İKİSİNDEN de ÖNCE, aynı `missing`
 *                                  kapısında; period başarısız olunca satır
 *                                  `continue` ile döngüden çıkar)
 *   REJECTED + {INVALID_VOLUME_FORMAT, NEGATIVE_VOLUME, DUPLICATE_GRAIN}
 *                                ⇒ ikisi de NOT NULL (`service.ts`:201-265,
 *                                  286-309 — üçü de yalnız `acceptedOr
 *                                  Rejected` dizisi üzerinde üretiliyor,
 *                                  bu dizinin her üyesi SKU+CPL+period'u
 *                                  ÇÖZEREK ADIM 1'i geçmiştir)
 *   REJECTED + MISSING_REQUIRED_FIELD
 *                                ⇒ **UNCONSTRAINED** — bu kod İKİ farklı
 *                                  aşamada TERS anahtar-durumlarıyla
 *                                  üretiliyor (`service.ts`:128-137 sku/
 *                                  cpl hücresi boş ⇒ resolved_* NULL
 *                                  olmalı; `service.ts`:220-242
 *                                  `base_volume` boş ama SKU/CPL zaten
 *                                  çözülmüş ⇒ resolved_* NOT NULL olmalı).
 *                                  CHECK bu ikisini `reason` tek başına
 *                                  AYIRT EDEMEZ — uydurma bir kısıt yanlış
 *                                  invaryant olurdu (§2.5), bilinçli olarak
 *                                  GEVŞEK bırakıldı (tam gerekçe entity
 *                                  JSDoc'unda).
 * Dokuzuncu bir kombinasyon `CHECK` tarafından reddedilir — sessiz geçiş
 * yok (§2.5).
 *
 * ── ⛔ İKİ ŞART (Z87 §2/§3) ────────────────────────────────────────────────
 * 1) `ACCEPTED` satırlar DA bu tabloda yaşar — yalnız red kaydedilirse
 *    `sourceMatchRatio`'nun (eşleşen satır / dosya satırı) PAYDASI kaybolur.
 * 2) ÖZET KOLON YOK (`INV-B-009`) — `coverageRatio`/`sourceMatchRatio`
 *    İKİSİ DE sorguyla türer (bu tablo + `baseline_volumes` üzerinde);
 *    `accepted_count`/`rejected_count`/`match_ratio` gibi senkronsuz bir
 *    kopya kolon YOK.
 *
 * ── UNIQUE(batch_id, row_no) ──────────────────────────────────────────────
 * Z87'nin ŞEKİL bloğunda elle yazılı değil, ama fiziksel kimlik gereği —
 * bir batch içinde bir dosya satır numarası yalnız BİR KEZ var olabilir.
 * `BL-3`'ün köprü sorgusu (`baseline_volumes` → `batch_id`+`row_no`) bu
 * tekilliğe ZATEN dayanıyor (Z87 §1: "Köprü: baseline_volumes ↔ batch_id +
 * row_no") — kısıt olmadan köprü tekil değildir.
 *
 * ── GRANT — SELECT + INSERT, UPDATE/DELETE YOK (satır IMMUTABLE) ─────────
 * `scripts/db-roles/02-runtime-grants.sql`'e eklendi. Düzeltme = yeni batch
 * (`ADR 0012` ruhu) — bu tablo hiçbir zaman UPDATE/DELETE almaz.
 *
 * ── RLS — `Z85 §2` ÜÇÜNCÜ ŞEKİL, `1822` İLE AYNI DESEN ────────────────────
 * KADEME 1 (bugün aktif): gerçek, fail-closed `CREATE POLICY` YAZILIR.
 * KADEME 2 (`ENABLE`+`FORCE`): RLS-aktivasyon dalgasının işi, YAZILMAZ.
 * Politika ifadesi `1822` ile BİREBİR (Z50 taşıyıcısıyla uyumlu):
 *   tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU) ──────────────────────────────────
 *   hiçbiri yok (enum×2 + tablo + CHECK + politika) → CREATE (beklenen)
 *   hepsi var                                       → NO-OP (tekrar koşum)
 *   kısmi durum                                      → İPTAL (throw)
 *
 * `down()`: satır varsa İPTAL (§2.5); yoksa DROP TABLE (politika tabloyla
 * birlikte otomatik düşer) + DROP TYPE ×2.
 */
export class CreateBaselineVolumeImportBatchRowsTable1823000000000 implements MigrationInterface {
  name = 'CreateBaselineVolumeImportBatchRowsTable1823000000000';

  private static readonly STATUS_ENUM =
    'baseline_volume_import_batch_row_status_enum';
  private static readonly REASON_ENUM =
    'baseline_volume_import_batch_row_reason_enum';
  private static readonly TABLE = 'baseline_volume_import_batch_rows';
  private static readonly ACCEPTANCE_CHECK =
    'CHK_baseline_volume_import_batch_rows_acceptance_shape';
  private static readonly POLICY =
    'POL_baseline_volume_import_batch_rows_tenant_isolation';

  private async describeState(queryRunner: QueryRunner): Promise<{
    statusEnum: boolean;
    reasonEnum: boolean;
    table: boolean;
    acceptanceCheck: boolean;
    policy: boolean;
  }> {
    const [row]: Array<{
      status_enum: boolean;
      reason_enum: boolean;
      tbl: boolean;
      acceptance_check: boolean;
      policy: boolean;
    }> = await queryRunner.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'main' AND t.typname = $1
         ) AS status_enum,
         EXISTS (
           SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'main' AND t.typname = $2
         ) AS reason_enum,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'main' AND table_name = $3
         ) AS tbl,
         EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
           WHERE n.nspname = 'main' AND c.conname = $4
         ) AS acceptance_check,
         EXISTS (
           SELECT 1 FROM pg_policies p
           WHERE p.schemaname = 'main' AND p.tablename = $3 AND p.policyname = $5
         ) AS policy`,
      [
        CreateBaselineVolumeImportBatchRowsTable1823000000000.STATUS_ENUM,
        CreateBaselineVolumeImportBatchRowsTable1823000000000.REASON_ENUM,
        CreateBaselineVolumeImportBatchRowsTable1823000000000.TABLE,
        CreateBaselineVolumeImportBatchRowsTable1823000000000.ACCEPTANCE_CHECK,
        CreateBaselineVolumeImportBatchRowsTable1823000000000.POLICY,
      ],
    );
    return {
      statusEnum: row.status_enum,
      reasonEnum: row.reason_enum,
      table: row.tbl,
      acceptanceCheck: row.acceptance_check,
      policy: row.policy,
    };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const state = await this.describeState(queryRunner);
    const allPresent =
      state.statusEnum &&
      state.reasonEnum &&
      state.table &&
      state.acceptanceCheck &&
      state.policy;
    const nonePresent = !state.statusEnum && !state.reasonEnum && !state.table;

    if (allPresent) {
      // Zaten uygulanmış (tekrar koşum) — NO-OP.
      return;
    }

    if (!nonePresent) {
      throw new Error(
        `1823 CreateBaselineVolumeImportBatchRowsTable ASSERT başarısız: ` +
          `beklenmeyen KISMİ durum — status_enum=${state.statusEnum} ` +
          `reason_enum=${state.reasonEnum} table=${state.table} ` +
          `acceptance_check=${state.acceptanceCheck} policy=${state.policy}. ` +
          `Şema sürüklenmiş olabilir — sessizce üstüne YAZILMADI ` +
          `(CLAUDE.md §2.5). Migration İPTAL edildi.`,
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // 1) ENUM TİPLERİ
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TYPE "main"."${CreateBaselineVolumeImportBatchRowsTable1823000000000.STATUS_ENUM}"
        AS ENUM ('ACCEPTED', 'REJECTED');
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."${CreateBaselineVolumeImportBatchRowsTable1823000000000.REASON_ENUM}"
        AS ENUM (
          'SKU_NOT_FOUND', 'CPL_NOT_FOUND', 'INVALID_PERIOD',
          'INVALID_VOLUME_FORMAT', 'NEGATIVE_VOLUME',
          'MISSING_REQUIRED_FIELD', 'DUPLICATE_GRAIN'
        );
    `);

    // ════════════════════════════════════════════════════════════════════
    // 2) `baseline_volume_import_batch_rows`
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE "main"."baseline_volume_import_batch_rows" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "batch_id" uuid NOT NULL,
        "row_no" integer NOT NULL,
        "raw" jsonb NOT NULL,
        "status" "main"."${CreateBaselineVolumeImportBatchRowsTable1823000000000.STATUS_ENUM}" NOT NULL,
        "reason" "main"."${CreateBaselineVolumeImportBatchRowsTable1823000000000.REASON_ENUM}",
        "resolved_sku_id" uuid,
        "resolved_cpl_id" uuid,
        CONSTRAINT "PK_baseline_volume_import_batch_rows" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_baseline_volume_import_batch_rows_batch_row_no"
          UNIQUE ("batch_id", "row_no"),
        CONSTRAINT "CHK_baseline_volume_import_batch_rows_row_no_positive"
          CHECK ("row_no" > 0),
        CONSTRAINT "${CreateBaselineVolumeImportBatchRowsTable1823000000000.ACCEPTANCE_CHECK}"
          -- ⛔ NULL-guVENLI (measured, T-358/F12 revizyonu): OR'lu esitlik
          -- zincirleri, "reason IS NULL" durumunda TUM dallarin NULL'a
          -- collapse olmasina ve Postgres'in "CHECK NULL = gecer" kuralinin
          -- yanlislikla ACCEPTED etmesine yol acar (olculdu, negatif kontrol
          -- REJECTED+reason=NULL kabul edildi -- HATA). Simple CASE'in
          -- eslesmeyen/NULL girdi icin ELSE'e dusme garantisi bu sinifi
          -- KOKTEN kapatir (searched-CASE'e esdeger, "x = v" NULL ise hicbir
          -- WHEN eslesmez, ELSE FALSE doner -- kesin, NULL degil).
          CHECK (
            CASE "status"
              WHEN 'ACCEPTED' THEN
                "reason" IS NULL
                AND "resolved_sku_id" IS NOT NULL
                AND "resolved_cpl_id" IS NOT NULL
              WHEN 'REJECTED' THEN
                CASE "reason"
                  -- SKU lookup basarisiz -> CPL lookup'a hic ulasilmaz (service.ts:139-149)
                  WHEN 'SKU_NOT_FOUND' THEN
                    "resolved_sku_id" IS NULL AND "resolved_cpl_id" IS NULL
                  -- CPL lookup yalniz SKU bulunduktan SONRA calisir (service.ts:151-160)
                  WHEN 'CPL_NOT_FOUND' THEN
                    "resolved_sku_id" IS NOT NULL AND "resolved_cpl_id" IS NULL
                  -- period denetimi SKU/CPL lookup'inin HER IKISINDEN de ONCE calisir (service.ts:110-137)
                  WHEN 'INVALID_PERIOD' THEN
                    "resolved_sku_id" IS NULL AND "resolved_cpl_id" IS NULL
                  -- ucu de yalniz SKU+CPL+period cozuldukten SONRA uretiliyor (service.ts:201-265,286-309)
                  WHEN 'INVALID_VOLUME_FORMAT' THEN
                    "resolved_sku_id" IS NOT NULL AND "resolved_cpl_id" IS NOT NULL
                  WHEN 'NEGATIVE_VOLUME' THEN
                    "resolved_sku_id" IS NOT NULL AND "resolved_cpl_id" IS NOT NULL
                  WHEN 'DUPLICATE_GRAIN' THEN
                    "resolved_sku_id" IS NOT NULL AND "resolved_cpl_id" IS NOT NULL
                  -- IKI farkli asamada TERS anahtar-durumlariyla uretiliyor
                  -- (service.ts:128-137 vs 220-242) -- resolved_* UNCONSTRAINED
                  -- birakildi, CHECK bu ikisini reason tek basina ayirt edemez (S2.5)
                  WHEN 'MISSING_REQUIRED_FIELD' THEN TRUE
                  -- reason NULL (REJECTED+reason-yok) DAHIL: hicbir WHEN eslesmez,
                  -- searched-CASE'in ELSE'i -- kesin FALSE, NULL DEGIL.
                  ELSE FALSE
                END
              ELSE FALSE
            END
          )
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volume_import_batch_rows"
      ADD CONSTRAINT "FK_baseline_volume_import_batch_rows_tenant"
        FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volume_import_batch_rows"
      ADD CONSTRAINT "FK_baseline_volume_import_batch_rows_batch"
        FOREIGN KEY ("batch_id") REFERENCES "main"."baseline_volume_import_batches"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volume_import_batch_rows"
      ADD CONSTRAINT "FK_baseline_volume_import_batch_rows_resolved_sku"
        FOREIGN KEY ("resolved_sku_id") REFERENCES "main"."skus"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volume_import_batch_rows"
      ADD CONSTRAINT "FK_baseline_volume_import_batch_rows_resolved_cpl"
        FOREIGN KEY ("resolved_cpl_id") REFERENCES "main"."cpls"("id") ON DELETE RESTRICT;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volume_import_batch_rows_tenant"
        ON "main"."baseline_volume_import_batch_rows" ("tenant_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volume_import_batch_rows_batch"
        ON "main"."baseline_volume_import_batch_rows" ("batch_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volume_import_batch_rows_batch_status_reason"
        ON "main"."baseline_volume_import_batch_rows" ("batch_id", "status", "reason");
    `);

    // ════════════════════════════════════════════════════════════════════
    // 3) RLS — Z85 ÜÇÜNCÜ ŞEKİL, `1822` ile BİREBİR: GERÇEK, FAIL-CLOSED
    //    politika YAZILIR; `ENABLE`/`FORCE ROW LEVEL SECURITY` YAZILMAZ.
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE POLICY "${CreateBaselineVolumeImportBatchRowsTable1823000000000.POLICY}"
        ON "main"."baseline_volume_import_batch_rows"
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const state = await this.describeState(queryRunner);

    if (!state.table) {
      // Hiç uygulanmamış ya da zaten geri alınmış — NO-OP.
      return;
    }

    const [{ cnt }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt FROM "main"."baseline_volume_import_batch_rows"`,
    );
    if (cnt > 0) {
      throw new Error(
        `1823 down(): main.baseline_volume_import_batch_rows ${cnt} satır ` +
          `taşıyor. Bir DROP sessizce veri silmez (CLAUDE.md §2.5) — geri ` +
          `alma İPTAL edildi.`,
      );
    }

    // DROP TABLE, tabloya bağlı politikayı (POL_..._tenant_isolation)
    // otomatik düşürür.
    await queryRunner.query(
      `DROP TABLE "main"."baseline_volume_import_batch_rows";`,
    );
    if (state.reasonEnum) {
      await queryRunner.query(
        `DROP TYPE "main"."${CreateBaselineVolumeImportBatchRowsTable1823000000000.REASON_ENUM}";`,
      );
    }
    if (state.statusEnum) {
      await queryRunner.query(
        `DROP TYPE "main"."${CreateBaselineVolumeImportBatchRowsTable1823000000000.STATUS_ENUM}";`,
      );
    }
  }
}
