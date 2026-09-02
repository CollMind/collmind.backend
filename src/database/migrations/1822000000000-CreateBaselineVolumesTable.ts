import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `T-357` / `Z84` — **`BL-1` ŞEMA**: baseline hacim tablosu (`D3`).
 *
 * Kaynak: `.claude/backlog/tasks/T-357.md` · `docs/process/BL_BASELINE_HATTI_BRIEF.md` ·
 * `docs/process/BL2_GIRIS_BRIEF.md`. Excel'in *"Base Volume · Master Data · piece"*
 * satırının CTPM karşılığı — `Faz-2`'nin **ilk gerçek-veri tablosu**.
 *
 * ── GRAIN (Z84, KİLİTLİ) ──────────────────────────────────────────────────
 * `tenant × sku × cpl × period`, UNIQUE. Dört anahtar da NOT NULL ⇒ kısmi-tuple
 * yok ⇒ `NULLS NOT DISTINCT` GEREKMİYOR (`K-2.2.8c`'nin tersi vaka: `1821`'de
 * kısmi tuple vardı, burada yok).
 *
 * ── `period` TİPİ — ÖLÇÜLDÜ, TERCİH DEĞİL ────────────────────────────────
 * `main` şemasında dönem etiketi taşıyan mevcut TÜM tablolar (`plans.period_month` ·
 * `agreements.period_month` · `ledger_entries.period_month` · `claims.period_month` ·
 * `on_invoice_entries.fiscal_period` · `agreement_transactions.fiscal_period` ·
 * `sales_actuals.fiscal_period` · `sales_actual_batches.fiscal_period` ·
 * `budget_envelopes.period` · `fiscal_periods.kod`) `character varying(7)`,
 * `'YYYY-MM'`. `fiscal_periods.kod` bu biçimin KANONİK doğrulamasını taşıyor
 * (`K-2.3.10`, `CHK_fiscal_periods_kod_format`) — burada AYNI regex REPLİKE
 * edilir (kanonik tablo `fiscal_periods`'a bilinçli olarak FK YOK — bkz. aşağı).
 * ⇒ Sapma yok, konvansiyon birebir izlendi.
 *
 * ⛔ `fiscal_periods`'a FK EKLENMEDİ — bilinçli, code-reviewer B1/2026-08-13
 * emsaliyle (`fiscal-period.entity.ts` JSDoc): `fiscal_periods` bugün yalnız bir
 * KATALOG, onu dolduran bir üretim yolu yok, hiçbir mevcut tablo ona FK ile
 * bağlı değil. Bu tabloyu istisna yapıp bağlamak `F8` ailesi (aynı kavramın iki
 * temsili: sekiz tablo serbest varchar, dokuzuncusu FK'li) yaratırdı.
 *
 * ── ACCEPTANCE_STATUS — AD-BORCU ÖNLEMİ (Z84 madde 2) ────────────────────
 * Kolon adı `acceptance_status`, değerler `ACCEPTED`/`REJECTED` — `BL-3`'ün
 * `≥%95` kapsam kapısı (`D4`, `Z79 §4`) BUNDAN okuyacak: coverage paydası
 * TOPLAM EVREN (bu tablodaki tüm satırlar), REDDEDİLEN SATIR "EKSİK"tir.
 * `BL-3` şu sorguyla payda/pay kurar:
 *   pay   = count(*) FILTER (WHERE acceptance_status = 'ACCEPTED')
 *   payda = count(*)                                   -- ikisi de aynı scope
 * (scope: `WHERE tenant_id = $1 AND period = $2` gibi `BL-3`'ün seçtiği evren).
 *
 * ⚠️ Bu tablo yalnız SKU/CPL/period/tenant ANAHTARLARI ÇÖZÜLMÜŞ satırları
 * taşıyabilir (dört anahtar NOT NULL). "SKU eşleşmedi" türü red — anahtar hiç
 * kurulamadığı için — bu tabloya bir SATIR OLARAK giremez; o red `BL-2`'nin
 * import raporunda (bu migration'ın kapsamı DEĞİL) kalır. Buradaki
 * `REJECTED`, anahtarlar çözüldükten SONRA başka bir sebeple (biçim hatası,
 * negatif/okunamaz hacim, iş kuralı) reddedilen satırı ifade eder — grain
 * slotunu (aynı tenant/sku/cpl/period) işgal eder, `base_volume` NULL
 * olabilir, `reason` ZORUNLUDUR (CHECK). `BL-3`'ün coverage paydası bu
 * yüzden bu tablodan okununca bile TAM evreni temsil ETMEYEBİLİR
 * (anahtar-çözülemeyen satırlar burada hiç yok) — bu, Z84'ün "dört anahtar
 * NOT NULL" kilidinin doğrudan sonucu, `BL-3`'ün ayrıca ele alması gereken
 * bir sınır (bu migration'da DÜZELTİLMEDİ, yalnız burada ADIYLA kayıtlı).
 *
 * `reason` ŞEKLİ: serbest metin DEĞİL — kısa, makine-okunur KOD (ör.
 * `'INVALID_VOLUME_FORMAT'`, `'NEGATIVE_VOLUME'`, `'DUPLICATE_GRAIN'`).
 * Postgres ENUM olarak KİLİTLENMEDİ (kategori kümesi `BL-2`/`BL-3` tasarımı
 * netleşmeden sabitlenirse `ALTER TYPE ... ADD VALUE`'nun transaction
 * kısıtına çarpar — `1816` dersi); `text` olarak açık bırakıldı, ama
 * REJECTED için NOT NULL zorunluluğu CHECK ile bağlandı (§2.5: reddedilen
 * bir satırın sebepsiz kalması sessiz bir bilgi kaybıdır).
 *
 * ── source_type / import_batch_id / imported_at — PROVENANCE ÜÇLÜSÜ ─────
 * `source_type = 'IMPORT'`  ⇒ `import_batch_id` VE `imported_at` NOT NULL
 * `source_type = 'COMPUTED'` ⇒ `import_batch_id` VE `imported_at` NULL
 * CHECK ile bağlı (`CHK_baseline_volumes_source_provenance`) — biri unutulup
 * diğeri dolarsa (sessiz yarım-provenance) migration'ın kendisi değil, DB
 * seviyesinde her INSERT/UPDATE reddeder. `imported_at` bu tablodaki TEK
 * gerçek zaman-noktası kolonu (`timestamptz`) — `period` bir dizge anahtarı,
 * `Date` DEĞİL, `T-333`'ün TZ-round-trip riskini (main.plans/agreements.
 * start_date `date` kolonundan UTC-getter'larla okumanın +03'te yanlış ay
 * ürettiği bulgusu) bu yüzden TAŞIMIYOR.
 *
 * ── `import_batch_id` FK HEDEFİ — YENİ, MİNİMAL BİR TABLO (bkz. aşağı) ───
 * `BL-2` (import/parse) henüz tasarlanmadı (`docs/process/BL2_GIRIS_BRIEF.md`
 * §0: "BU ADIM BL-1'i BEKLER") — yani import_batch_id'nin FK hedefi olacak
 * bir "batch" tablosu bugün YOK. Z84'ün META bloğu `import_batch_id (FK)`
 * yazıyor; FK olmadan bu satır karşılıksız kalırdı. Emsal BU REPODA
 * TUTARLI: her import-domain'in KENDİ batch tablosu var
 * (`sales_actuals`↔`sales_actual_batches`, `on_invoice_entries`↔
 * `on_invoice_batches`) — paylaşılan/genel bir "import_batches" kavramı YOK.
 * ⇒ Bu migration `main.baseline_volume_import_batches`'ı da yaratır, ama
 * BİLEREK MİNİMAL: yalnız `BaseEntity` alanları (id/tenant_id/timestamps/
 * created_by/updated_by). Dosya adı, hash, satır sayıları gibi batch-özel
 * alanlar `BL-2`'nin kendi migration'ında eklenir — o tasarım (hangi parser,
 * kısmi-kabul şekli, Q20 üçlüsünün import'a uygulanışı) HENÜZ HÜKME
 * BAĞLANMADI (`W3_BASELINE_PLANLAMA_MASASI.md §1e`), bugün spekülatif alan
 * açmak `İlke 1` ihlali olurdu. Bu, Team Lead'e AÇIKÇA bildirilen bir
 * varsayımdır — batch tablosunun VARLIĞI ve minimalliği, şekli değil.
 *
 * ── `base_volume` — birim PIECE, UOM dönüşümü BU TABLODA YAŞAMAZ ─────────
 * `numeric(18,3)`, `sales_actuals.volume` ile aynı hassasiyet (emsal, aynı
 * "hacim" sınıfı). NULLABLE: `ACCEPTED` satır için NOT NULL zorlanır (CHECK),
 * `REJECTED` satır (ör. biçim hatası) için NULL olabilir. Negatif değer
 * `sales_actuals.volume` emsaliyle aynı şekilde reddedilir (`CHECK (base_volume
 * IS NULL OR base_volume >= 0)`).
 *
 * ── KAPSAM DIŞI (Z84) ──────────────────────────────────────────────────
 * `kanal` (CPL'den türer) · `kategori` (SKU'dan türer) — KOLON OLARAK
 * TUTULMUYOR (`INV-B-009` kopya-kolon sınıfı).
 *
 * ── FK'lar — RESTRICT (ADR 0012 ruhu) ────────────────────────────────────
 * `tenant_id` → `tenants` · `sku_id` → `skus` · `cpl_id` → `cpls` ·
 * `import_batch_id` → `baseline_volume_import_batches` — hepsi RESTRICT
 * (denetim/iz ailesi: kaynak veri arkasında iz bırakmadan silinemez).
 *
 * ── RLS — `new-table-rls` guard'ının evrenine giriyor (Z85, ÜÇÜNCÜ ŞEKİL) ─
 * ⛔ **Z85 (2026-09-02) bu bloğu YENİDEN YAZAR** — önceki sürüm (`ENABLE +
 * FORCE` + yer-tutucu `USING (true)` politika) ürün sahibi tarafından
 * REDDEDİLDİ: fail-open bir politika `relrowsecurity=t` görüp tabloyu
 * "izole" sanan bir okuyucuyu yanıltır — sahte bir güvenlik sinyali.
 *
 * Üçüncü şekil, Z85'in KADEME ayrımını birebir uygular:
 *   KADEME 1 (bugün aktif)  — GERÇEK, FAIL-CLOSED bir RLS politikası
 *     YAZILIR (Z50 taşıyıcı mimarisinin şekli: `SET LOCAL app.tenant_id`).
 *     Politika RLS KAPALIYKEN de var olabilir — İNERTTİR, zararsız.
 *   KADEME 2 (BLOCKED → RLS-aktivasyon dalgası, Z54 §3) — `ENABLE` + `FORCE`
 *     ÇİFTİ bu migration'da YAZILMAZ. Onları bugün açmak — Z50'nin `SET
 *     LOCAL` istek-kapsamlı taşıyıcısı henüz YOK olduğu için — table owner
 *     (`app_migrate`) DAHİL herkesi dışlar (Postgres varsayılanı: politika
 *     var ama bağlam session'da boşsa satır GÖRÜNMEZ/YAZILMAZ) ve `BL-2`'nin
 *     ilk INSERT'ini canlı bir kilide çevirir.
 *
 * Politika ifadesi (`USING` = `WITH CHECK`), Z46 §2'nin FAIL-CLOSED şekli:
 *   tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
 * `current_setting(..., true)` bağlam yoksa NULL döner (hata değil);
 * `NULLIF(..., '')` boş string'i de NULL'a indirger (session-set ama boş
 * bırakılmış olabilir); `tenant_id = NULL` her zaman NULL (⇒ UNKNOWN ⇒ satır
 * eşleşmez). **Bağlamsız sorgu = BOŞ KÜME, "hepsi" DEĞİL** — sarmalayıcıyı
 * unutan bir yol sızdırmaz, görünür biçimde boş döner.
 *
 * ⇒ Bugün: sahte-yeşil YOK (yer-tutucu politika kalmadı) · gerçek politika
 * şekli HAZIR (Z50 taşıyıcısıyla birebir uyumlu) · baseline hilesi YOK (bu
 * tablo `new-table-rls-baseline.txt`'e HİÇ girmiyor — KADEME 1 zaten
 * sağlanmış durumda doğuyor) · aktivasyon günü bu tablo SIFIR DEĞİŞİKLİKLE
 * açılır (yalnız `ENABLE`+`FORCE`, aktivasyon dalgasının SET LOCAL
 * taşıyıcısıyla BİRLİKTE, tek anahtarla).
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU) ──────────────────────────────────
 *   hiçbiri yok (enum×2 + tablo×2 + imza CHECK) → CREATE (beklenen)
 *   hepsi var VE imza CHECK mevcut             → NO-OP (tekrar koşum)
 *   kısmi durum (bir kısmı var bir kısmı yok)   → İPTAL (throw) — şema
 *                                                  sürüklenmiş, sessizce
 *                                                  üstüne YAZILMAZ
 *
 * `down()`: her iki tabloda da satır varsa İPTAL (veri kaybı önlemi, §2.5);
 * yoksa DROP TABLE (policy'ler tabloyla birlikte otomatik düşer) + DROP TYPE.
 */
export class CreateBaselineVolumesTable1822000000000 implements MigrationInterface {
  name = 'CreateBaselineVolumesTable1822000000000';

  private static readonly SOURCE_ENUM = 'baseline_volume_source_type_enum';
  private static readonly ACCEPTANCE_ENUM =
    'baseline_volume_acceptance_status_enum';
  private static readonly BATCH_TABLE = 'baseline_volume_import_batches';
  private static readonly MAIN_TABLE = 'baseline_volumes';
  private static readonly SIGNATURE_CHECK =
    'CHK_baseline_volumes_source_provenance';
  private static readonly BATCH_POLICY =
    'POL_baseline_volume_import_batches_tenant_isolation';
  private static readonly MAIN_POLICY = 'POL_baseline_volumes_tenant_isolation';

  private async describeState(queryRunner: QueryRunner): Promise<{
    sourceEnum: boolean;
    acceptanceEnum: boolean;
    batchTable: boolean;
    mainTable: boolean;
    signatureCheck: boolean;
    batchPolicy: boolean;
    mainPolicy: boolean;
  }> {
    const [row]: Array<{
      source_enum: boolean;
      acceptance_enum: boolean;
      batch_table: boolean;
      main_table: boolean;
      signature_check: boolean;
      batch_policy: boolean;
      main_policy: boolean;
    }> = await queryRunner.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'main' AND t.typname = $1
         ) AS source_enum,
         EXISTS (
           SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'main' AND t.typname = $2
         ) AS acceptance_enum,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'main' AND table_name = $3
         ) AS batch_table,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'main' AND table_name = $4
         ) AS main_table,
         EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
           WHERE n.nspname = 'main' AND c.conname = $5
         ) AS signature_check,
         EXISTS (
           SELECT 1 FROM pg_policies p
           WHERE p.schemaname = 'main' AND p.tablename = $3 AND p.policyname = $6
         ) AS batch_policy,
         EXISTS (
           SELECT 1 FROM pg_policies p
           WHERE p.schemaname = 'main' AND p.tablename = $4 AND p.policyname = $7
         ) AS main_policy`,
      [
        CreateBaselineVolumesTable1822000000000.SOURCE_ENUM,
        CreateBaselineVolumesTable1822000000000.ACCEPTANCE_ENUM,
        CreateBaselineVolumesTable1822000000000.BATCH_TABLE,
        CreateBaselineVolumesTable1822000000000.MAIN_TABLE,
        CreateBaselineVolumesTable1822000000000.SIGNATURE_CHECK,
        CreateBaselineVolumesTable1822000000000.BATCH_POLICY,
        CreateBaselineVolumesTable1822000000000.MAIN_POLICY,
      ],
    );
    return {
      sourceEnum: row.source_enum,
      acceptanceEnum: row.acceptance_enum,
      batchTable: row.batch_table,
      mainTable: row.main_table,
      signatureCheck: row.signature_check,
      batchPolicy: row.batch_policy,
      mainPolicy: row.main_policy,
    };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const state = await this.describeState(queryRunner);
    const allPresent =
      state.sourceEnum &&
      state.acceptanceEnum &&
      state.batchTable &&
      state.mainTable &&
      state.signatureCheck &&
      state.batchPolicy &&
      state.mainPolicy;
    const nonePresent =
      !state.sourceEnum &&
      !state.acceptanceEnum &&
      !state.batchTable &&
      !state.mainTable;

    if (allPresent) {
      // Zaten uygulanmış (tekrar koşum) — NO-OP.
      return;
    }

    if (!nonePresent) {
      throw new Error(
        `1822 CreateBaselineVolumesTable ASSERT başarısız: beklenmeyen KISMİ ` +
          `durum — source_enum=${state.sourceEnum} acceptance_enum=${state.acceptanceEnum} ` +
          `batch_table=${state.batchTable} main_table=${state.mainTable} ` +
          `signature_check=${state.signatureCheck} batch_policy=${state.batchPolicy} ` +
          `main_policy=${state.mainPolicy}. Şema sürüklenmiş olabilir — ` +
          `sessizce üstüne YAZILMADI (CLAUDE.md §2.5). Migration İPTAL edildi.`,
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // 1) ENUM TİPLERİ
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TYPE "main"."${CreateBaselineVolumesTable1822000000000.SOURCE_ENUM}"
        AS ENUM ('IMPORT', 'COMPUTED');
    `);
    await queryRunner.query(`
      CREATE TYPE "main"."${CreateBaselineVolumesTable1822000000000.ACCEPTANCE_ENUM}"
        AS ENUM ('ACCEPTED', 'REJECTED');
    `);

    // ════════════════════════════════════════════════════════════════════
    // 2) `baseline_volume_import_batches` — MİNİMAL, BaseEntity alanları
    //    (bkz. dosya-üstü JSDoc: BL-2 kendi alanlarını KENDİ migration'ında
    //    ekler; bu tablo yalnız FK hedefi olarak var).
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE "main"."baseline_volume_import_batches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        CONSTRAINT "PK_baseline_volume_import_batches" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volume_import_batches"
      ADD CONSTRAINT "FK_baseline_volume_import_batches_tenant"
        FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volume_import_batches_tenant"
        ON "main"."baseline_volume_import_batches" ("tenant_id");
    `);

    // ════════════════════════════════════════════════════════════════════
    // 3) `baseline_volumes` — ana tablo
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TABLE "main"."baseline_volumes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "created_by" uuid,
        "updated_by" uuid,
        "sku_id" uuid NOT NULL,
        "cpl_id" uuid NOT NULL,
        "period" character varying(7) NOT NULL,
        "base_volume" numeric(18,3),
        "source_type" "main"."${CreateBaselineVolumesTable1822000000000.SOURCE_ENUM}" NOT NULL,
        "import_batch_id" uuid,
        "acceptance_status" "main"."${CreateBaselineVolumesTable1822000000000.ACCEPTANCE_ENUM}" NOT NULL,
        "reason" text,
        "imported_at" timestamptz,
        CONSTRAINT "PK_baseline_volumes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_baseline_volumes_tenant_sku_cpl_period"
          UNIQUE ("tenant_id", "sku_id", "cpl_id", "period"),
        -- Aynı regex, aynı gerekçe: fiscal_periods.kod (K-2.3.10, CHK_fiscal_periods_kod_format).
        CONSTRAINT "CHK_baseline_volumes_period_format"
          CHECK ("period" ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
        CONSTRAINT "CHK_baseline_volumes_base_volume_non_negative"
          CHECK ("base_volume" IS NULL OR "base_volume" >= 0),
        CONSTRAINT "${CreateBaselineVolumesTable1822000000000.SIGNATURE_CHECK}"
          CHECK (
            ("source_type" = 'IMPORT' AND "import_batch_id" IS NOT NULL AND "imported_at" IS NOT NULL)
            OR
            ("source_type" = 'COMPUTED' AND "import_batch_id" IS NULL AND "imported_at" IS NULL)
          ),
        CONSTRAINT "CHK_baseline_volumes_acceptance_shape"
          CHECK (
            ("acceptance_status" = 'REJECTED' AND "reason" IS NOT NULL)
            OR
            ("acceptance_status" = 'ACCEPTED' AND "reason" IS NULL AND "base_volume" IS NOT NULL)
          )
      );
    `);

    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volumes"
      ADD CONSTRAINT "FK_baseline_volumes_tenant"
        FOREIGN KEY ("tenant_id") REFERENCES "main"."tenants"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volumes"
      ADD CONSTRAINT "FK_baseline_volumes_sku"
        FOREIGN KEY ("sku_id") REFERENCES "main"."skus"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volumes"
      ADD CONSTRAINT "FK_baseline_volumes_cpl"
        FOREIGN KEY ("cpl_id") REFERENCES "main"."cpls"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."baseline_volumes"
      ADD CONSTRAINT "FK_baseline_volumes_import_batch"
        FOREIGN KEY ("import_batch_id") REFERENCES "main"."baseline_volume_import_batches"("id") ON DELETE RESTRICT;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volumes_sku" ON "main"."baseline_volumes" ("sku_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volumes_cpl" ON "main"."baseline_volumes" ("cpl_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volumes_import_batch" ON "main"."baseline_volumes" ("import_batch_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_baseline_volumes_tenant_period_acceptance"
        ON "main"."baseline_volumes" ("tenant_id", "period", "acceptance_status");
    `);

    // ════════════════════════════════════════════════════════════════════
    // 4) RLS — Z85 ÜÇÜNCÜ ŞEKİL: GERÇEK, FAIL-CLOSED politika YAZILIR;
    //    `ENABLE`/`FORCE ROW LEVEL SECURITY` YAZILMAZ (bkz. dosya-üstü
    //    JSDoc — KADEME 2, RLS-aktivasyon dalgasının işi, Z54 §3).
    //    Politika RLS kapalıyken İNERTTİR: bugün hiçbir sorguyu etkilemez,
    //    yalnız KADEME 1'i (new-table-rls guard) BUGÜNDEN sağlar.
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE POLICY "${CreateBaselineVolumesTable1822000000000.BATCH_POLICY}"
        ON "main"."baseline_volume_import_batches"
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
    `);

    await queryRunner.query(`
      CREATE POLICY "${CreateBaselineVolumesTable1822000000000.MAIN_POLICY}"
        ON "main"."baseline_volumes"
        FOR ALL
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const state = await this.describeState(queryRunner);

    if (!state.mainTable && !state.batchTable) {
      // Hiç uygulanmamış ya da zaten geri alınmış — NO-OP.
      return;
    }

    if (state.mainTable) {
      const [{ cnt: mainCnt }]: [{ cnt: number }] = await queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM "main"."baseline_volumes"`,
      );
      if (mainCnt > 0) {
        throw new Error(
          `1822 down(): main.baseline_volumes ${mainCnt} satır taşıyor. ` +
            `Bir DROP sessizce veri silmez (CLAUDE.md §2.5) — geri alma İPTAL edildi.`,
        );
      }
    }

    if (state.batchTable) {
      const [{ cnt: batchCnt }]: [{ cnt: number }] = await queryRunner.query(
        `SELECT COUNT(*)::int AS cnt FROM "main"."baseline_volume_import_batches"`,
      );
      if (batchCnt > 0) {
        throw new Error(
          `1822 down(): main.baseline_volume_import_batches ${batchCnt} satır ` +
            `taşıyor. Bir DROP sessizce veri silmez (CLAUDE.md §2.5) — geri alma İPTAL edildi.`,
        );
      }
    }

    if (state.mainTable) {
      // DROP TABLE, tabloya bağlı politikaları (POL_baseline_volumes_tenant_isolation)
      // otomatik düşürür.
      await queryRunner.query(`DROP TABLE "main"."baseline_volumes";`);
    }
    if (state.batchTable) {
      await queryRunner.query(
        `DROP TABLE "main"."baseline_volume_import_batches";`,
      );
    }
    if (state.acceptanceEnum) {
      await queryRunner.query(
        `DROP TYPE "main"."${CreateBaselineVolumesTable1822000000000.ACCEPTANCE_ENUM}";`,
      );
    }
    if (state.sourceEnum) {
      await queryRunner.query(
        `DROP TYPE "main"."${CreateBaselineVolumesTable1822000000000.SOURCE_ENUM}";`,
      );
    }
  }
}
