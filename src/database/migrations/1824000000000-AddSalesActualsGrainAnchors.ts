import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `M1` (halka-2) — **`sales_actuals` grain anahtarları**: `event_type` +
 * `invoice_no`. Kaynak: `docs/process/HALKA2_M1_MIGRATION_BRIEF.md` ·
 * `docs/brd-v2/04_KARAR_KAYDI.md Z96 §6 / Z98`.
 *
 * ── NEDEN BU SIRA (brief §0, ölçülmüş) ───────────────────────────────────
 * `fu_id` YAZARI YOK (`grep fuId src/modules/shared/sales-actuals/` → 0) ve
 * bugünkü `raw_row` anahtarları (`category · cpl_code · net_amount ·
 * channel_code · gross_amount · discount_amount`) FU/SKU bilgisi TAŞIMIYOR.
 * Bu bir kod boşluğu DEĞİL, bir IMPORT SÖZLEŞMESİ boşluğu — `fu_id`'yi bugün
 * `NOT NULL` yapmak yazarı olmayan bir kolona kısıt koymak, her ingest'i
 * kırmak olurdu. ⇒ `fu_id` bu turda NULLABLE KALIR, DOKUNULMADI.
 *
 * ── `event_type` — TEK ÜYELİ ENUM, BİLİNÇLİ (§1a) ────────────────────────
 * `RETURN` üyesi EKLENMEZ — üreticisi yok (`Z91`: "bir enum üyesi ekleyen
 * tur üreticisini AYNI TURDA bağlar ya da DUR"). İade hükmü geldiğinde
 * `RETURN` üyesiyle BİRLİKTE doğar (yeni bir migration'da, `ALTER TYPE ...
 * ADD VALUE` ile — Postgres transaction kısıtı, `1816` dersi).
 *
 * ⛔ **RANDEVU, "KAPANMIŞ DEĞİL, BEKLEYEN" damgasıyla** (`T-084` tuzağı):
 * tek üyelilik bir TASARIM KARARI DEĞİL, bir SIRA kararıdır. Bu satırı okuyan
 * bir sonraki ajan/insan bunu "tek üye yeterli, dokunma" diye OKUMAMALI —
 * iade hükmü netleştiği gün bu enum bir `ALTER TYPE ... ADD VALUE 'RETURN'`
 * migration'ı BEKLİYOR, kapanmış bir konu değil.
 *
 * Kolon NULLABLE doğar (ürün sahibi kararı) — iade hükmü geldiğinde ŞEMA
 * DEĞİŞMEZ, yalnız enum'a yeni üye eklenir ve ingest bu kolonu doldurmaya
 * başlar. Bugün writer'ı yok (fu_id ile aynı sınıf: kolon var, kısıt yok).
 *
 * ── `invoice_no` — NULLABLE varchar(100) ─────────────────────────────────
 * Uzunluk konvansiyonu `agreement_transactions.invoice_no` /
 * `on_invoice_entries.invoice_no` ile BİREBİR (`length: 100`) — aynı "fatura
 * numarası" sınıfı, farklı bir biçim icat edilmedi. O iki tabloda NOT NULL
 * (dedike fatura satırı); burada NULLABLE — bu tablo satış cirosu agregası,
 * her satırın bir faturaya bağlı olması GEREKMİYOR (bugünkü CSV formatı
 * invoice_no taşımıyor — `fu_id` ile aynı "import sözleşmesi henüz yok"
 * sınıfı). Halka-2'nin "on-invoice yolu + sales_actuals tüketicisi" eşleştirme
 * motoru bu kolonu okuyacak (`Z96 §6`); bugün yalnız KOLON açılıyor, eşleşme
 * mantığı bu migration'ın KAPSAMI DIŞINDA (brief §4).
 *
 * ── AD AYRIMI — `batch-scope` ≠ `match-grain` (Z96 §6, T-366 emsali) ─────
 * `batch-scope`  = bir YÜKLEME PARTİSİNİN kapsamı: `sales_actual_batches`
 *                  (fiscal_period, cpl_id, category_id, channel_id) — bu
 *                  migration'dan ÖNCE de vardı, DEĞİŞMEDİ.
 * `match-grain`  = bir EŞLEŞTİRMENİN taneliliği: FU × CPL × Ay (varsayılan,
 *                  tenant-konfigüre edilebilir resolver — henüz YOK).
 * ⇒ **YENİ KOLON EKLENMEDİ** — gerekmedi, çünkü match-grain'in bileşenleri
 * (FU → `fu_id`, CPL → `cpl_id`, Ay → `fiscal_period`'ın ilk 7 karakteri)
 * zaten mevcut kolonlarda YAŞIYOR; ayrı bir "grain" kolonu açmak `INV-B-009`
 * kopya-kolon sınıfını yeniden üretirdi. Eşleştirme motorunun KENDİSİ
 * (resolver, tenant-config okuma) sonraki halkanın işi (brief §4) — bu
 * migration yalnız motorun okuyacağı iki YENİ ANAHTARI (event_type,
 * invoice_no) açığa çıkarıyor. İki kavram burada yalnız YORUMLA ayrıştırıldı.
 *
 * ── `CHECK` — `Z87` NULL-COLLAPSE FARKINDALIĞIYLA TASARLANDI ─────────────
 * `event_type` için AYRI bir CHECK YOK — gerekmedi, çünkü tek üyeli enum
 * tipi (`'SALE'`) zaten Postgres seviyesinde biricik domain'i kilitliyor;
 * bir `CHECK (event_type IS NULL OR event_type = 'SALE')` yazmak enum'un
 * ZATEN sağladığı bir şeyi tekrar eder (ölü/redundant kısıt, İlke 1).
 *
 * `invoice_no` için TEK CHECK: `CHK_sales_actuals_invoice_no_not_blank` —
 * `invoice_no IS NULL OR btrim(invoice_no) <> ''`. NULL geçerli (satırın
 * invoice_no'su yok demektir, yazarı yok); boş string (`''`/yalnız boşluk)
 * REDDEDİLİR — sessiz "boş ama dolu görünen" bir anahtar üretilmez (§2.5).
 * ⛔ Negatif kontrol İKİ ayrı vaka İÇERİR (brief §1b / PİN 2):
 *   1) `invoice_no = ''`              → REJECT (CHECK ihlali)
 *   2) `invoice_no = NULL`            → ACCEPT (vacuous-true DEĞİL, kasıtlı
 *      geçiş — kolonun kendisi opsiyonel; bu satır Z87'nin "her CHECK'in
 *      negatif kontrolünde bir NULL girdi vakası ZORUNLU" pinini karşılar)
 * Burada `1823`'teki gibi çok-dallı bir `CASE` gerekmiyor: tek koşullu
 * `IS NULL OR ...` deseninde NULL-collapse riski YOK (OR'un solu NULL'u
 * doğrudan ayırt ediyor, çok değerli bir `status`/`reason` eşleşmesi yok).
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU) ──────────────────────────────────
 *   hiçbiri yok (enum + iki kolon + CHECK)  → CREATE (beklenen)
 *   hepsi var                                → NO-OP (tekrar koşum)
 *   kısmi durum                              → İPTAL (throw)
 *
 * `down()`: veri kaybı riski YOK — `event_type`/`invoice_no` bu migration'la
 * doğan, bugün hiçbir yazarı olmayan iki YENİ nullable kolon (mevcut 3 satır
 * `sales_actuals`'ta ikisi de NULL kalacak). Yine de §2.5 disiplini: kolon
 * DEĞER TAŞIYORSA (birileri INSERT/UPDATE ile doldurduysa) `down()` bunu
 * SESSİZCE silmez — assert eder, dolu satır varsa İPTAL eder.
 */
export class AddSalesActualsGrainAnchors1824000000000 implements MigrationInterface {
  name = 'AddSalesActualsGrainAnchors1824000000000';

  private static readonly EVENT_TYPE_ENUM = 'sales_actuals_event_type_enum';
  private static readonly TABLE = 'sales_actuals';
  private static readonly INVOICE_NO_CHECK =
    'CHK_sales_actuals_invoice_no_not_blank';

  private async describeState(queryRunner: QueryRunner): Promise<{
    eventTypeEnum: boolean;
    eventTypeColumn: boolean;
    invoiceNoColumn: boolean;
    invoiceNoCheck: boolean;
  }> {
    const [row]: Array<{
      event_type_enum: boolean;
      event_type_column: boolean;
      invoice_no_column: boolean;
      invoice_no_check: boolean;
    }> = await queryRunner.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'main' AND t.typname = $1
         ) AS event_type_enum,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'main' AND table_name = $2
             AND column_name = 'event_type'
         ) AS event_type_column,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'main' AND table_name = $2
             AND column_name = 'invoice_no'
         ) AS invoice_no_column,
         EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
           WHERE n.nspname = 'main' AND c.conname = $3
         ) AS invoice_no_check`,
      [
        AddSalesActualsGrainAnchors1824000000000.EVENT_TYPE_ENUM,
        AddSalesActualsGrainAnchors1824000000000.TABLE,
        AddSalesActualsGrainAnchors1824000000000.INVOICE_NO_CHECK,
      ],
    );
    return {
      eventTypeEnum: row.event_type_enum,
      eventTypeColumn: row.event_type_column,
      invoiceNoColumn: row.invoice_no_column,
      invoiceNoCheck: row.invoice_no_check,
    };
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const state = await this.describeState(queryRunner);
    const allPresent =
      state.eventTypeEnum &&
      state.eventTypeColumn &&
      state.invoiceNoColumn &&
      state.invoiceNoCheck;
    const nonePresent =
      !state.eventTypeEnum && !state.eventTypeColumn && !state.invoiceNoColumn;

    if (allPresent) {
      // Zaten uygulanmış (tekrar koşum) — NO-OP.
      return;
    }

    if (!nonePresent) {
      throw new Error(
        `1824 AddSalesActualsGrainAnchors ASSERT başarısız: beklenmeyen ` +
          `KISMİ durum — event_type_enum=${state.eventTypeEnum} ` +
          `event_type_column=${state.eventTypeColumn} ` +
          `invoice_no_column=${state.invoiceNoColumn} ` +
          `invoice_no_check=${state.invoiceNoCheck}. Şema sürüklenmiş ` +
          `olabilir — sessizce üstüne YAZILMADI (CLAUDE.md §2.5). ` +
          `Migration İPTAL edildi.`,
      );
    }

    // ════════════════════════════════════════════════════════════════════
    // 1) ENUM — tek üye 'SALE' (RETURN randevusu, JSDoc'a bkz.)
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      CREATE TYPE "main"."${AddSalesActualsGrainAnchors1824000000000.EVENT_TYPE_ENUM}"
        AS ENUM ('SALE');
    `);

    // ════════════════════════════════════════════════════════════════════
    // 2) KOLONLAR — ikisi de NULLABLE, DEFAULT YOK (writer'sız — fu_id ile
    //    aynı sınıf: kolon var, bugün doldurulmuyor)
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      ALTER TABLE "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
      ADD COLUMN "event_type" "main"."${AddSalesActualsGrainAnchors1824000000000.EVENT_TYPE_ENUM}";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
      ADD COLUMN "invoice_no" character varying(100);
    `);

    // ════════════════════════════════════════════════════════════════════
    // 3) CHECK — invoice_no boş-string olamaz, NULL olabilir (bkz. JSDoc)
    // ════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      ALTER TABLE "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
      ADD CONSTRAINT "${AddSalesActualsGrainAnchors1824000000000.INVOICE_NO_CHECK}"
        CHECK ("invoice_no" IS NULL OR btrim("invoice_no") <> '');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const state = await this.describeState(queryRunner);

    if (
      !state.eventTypeEnum &&
      !state.eventTypeColumn &&
      !state.invoiceNoColumn
    ) {
      // Hiç uygulanmamış ya da zaten geri alınmış — NO-OP.
      return;
    }

    if (state.eventTypeColumn) {
      const [{ cnt: eventTypeCnt }]: [{ cnt: number }] =
        await queryRunner.query(
          `SELECT COUNT(*)::int AS cnt
           FROM "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
           WHERE "event_type" IS NOT NULL`,
        );
      if (eventTypeCnt > 0) {
        throw new Error(
          `1824 down(): main.sales_actuals.event_type ${eventTypeCnt} ` +
            `dolu satır taşıyor. Bir DROP COLUMN sessizce veri silmez ` +
            `(CLAUDE.md §2.5) — geri alma İPTAL edildi.`,
        );
      }
    }

    if (state.invoiceNoColumn) {
      const [{ cnt: invoiceNoCnt }]: [{ cnt: number }] =
        await queryRunner.query(
          `SELECT COUNT(*)::int AS cnt
           FROM "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
           WHERE "invoice_no" IS NOT NULL`,
        );
      if (invoiceNoCnt > 0) {
        throw new Error(
          `1824 down(): main.sales_actuals.invoice_no ${invoiceNoCnt} ` +
            `dolu satır taşıyor. Bir DROP COLUMN sessizce veri silmez ` +
            `(CLAUDE.md §2.5) — geri alma İPTAL edildi.`,
        );
      }
    }

    if (state.invoiceNoCheck) {
      await queryRunner.query(`
        ALTER TABLE "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
        DROP CONSTRAINT "${AddSalesActualsGrainAnchors1824000000000.INVOICE_NO_CHECK}";
      `);
    }
    if (state.invoiceNoColumn) {
      await queryRunner.query(`
        ALTER TABLE "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
        DROP COLUMN "invoice_no";
      `);
    }
    if (state.eventTypeColumn) {
      await queryRunner.query(`
        ALTER TABLE "main"."${AddSalesActualsGrainAnchors1824000000000.TABLE}"
        DROP COLUMN "event_type";
      `);
    }
    if (state.eventTypeEnum) {
      await queryRunner.query(`
        DROP TYPE "main"."${AddSalesActualsGrainAnchors1824000000000.EVENT_TYPE_ENUM}";
      `);
    }
  }
}
