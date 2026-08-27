import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `INV-B-009` / `Z47` — `main.budget_envelopes.available_amount` DÜŞÜRÜLÜR.
 *
 * Kaynak: `docs/brd-v2/04_KARAR_KAYDI.md` `Z47` (2026-08-27, ürün sahibi) ·
 * `Z45 §3` (teşhis girişi) · `docs/contracts/SYSTEM_INVARIANTS.md` `INV-B-009`.
 *
 * ── Neden (Z47 §1, üç gerekçe — özet, tam metin karar kaydında) ──────────────
 * 1. Bu bir "senkronu BOZULMUŞ kopya" değil — HİÇ SENKRON MEKANİZMASI OLMAMIŞ
 *    bir kopya. `available_amount` yalnız `createEnvelope`/`splitEnvelope`'ta
 *    yazılıyordu; `reserve`/`commit`/`release` (`budget_transactions` /
 *    `ledger_entries` yazan hiçbir yol) hiç dokunmuyordu — doğduğu gün
 *    doğruydu, ilk rezervde bayatladı.
 * 2. Ayrışma oranı canlı DB'de 4 zarfın 2'si (rezerv görmüş HER zarf ayrık) —
 *    "ara sıra kaçırılan bir yol" değil, TÜM yaşam döngüsünün eksik olduğunu
 *    gösteriyor.
 * 3. `K-2.2` ailesinin ruhu: defter (`budget_transactions` + `ledger_entries`)
 *    gerçeğin kaynağıdır; `available` bir TÜREVDİR ve sorgu anında türetilir
 *    (`main.v_budget_summary`, `allocated - reserved(incl. COMMIT) -
 *    consumed` — bkz. `1789000000000-FixBudgetSummaryCommitDoubleCounting`).
 *    Türev bir kolonda SAKLANMAZ.
 *
 * ── `ADR 0012` (finansal tabloda fiziksel silme yasağı) İHLAL EDİLMİYOR ──────
 * Ölen şey VERİ değil, BAYAT TÜREV: hiçbir `budget_envelopes` SATIRI silinmiyor,
 * yalnız kendi kendine senkron kalamayan, sorgu-anında zaten yeniden
 * hesaplanabilen bir KOLON düşüyor. `v_budget_summary` bu tablonun HİÇBİR
 * satırına dokunmadan `allocated_amount`'tan (yine bu tablo) ve
 * `budget_transactions`/`ledger_entries`'ten `available_amount`'ı
 * YENİDEN TÜRETİR — kanıt: view tanımı `be.available_amount`'a hiç referans
 * vermiyor, yalnız `be.allocated_amount`'a (ölçüldü, `pg_get_viewdef`).
 *
 * ── Kaynak taraması (Z47 §2a, dört-yüzey, pozitif kontrollü) ─────────────────
 * `src` ∧ `test` ∧ `collmind.frontend/src` ∧ `scripts` — `grep -rn
 * "availableAmount|available_amount"`. Bulunan TÜM canlı okuyucular bu
 * dalgada view'a/türetime döndürüldü (bkz. task raporu):
 *   - `on-invoice-validation.service.ts` — ayrışma-alarmı KALDIRILDI, tek
 *     kaynak `v_budget_summary` (Z47 §2c: "ara-adım görevini yaptı — teşhis
 *     verisini o üretti").
 *   - `agreement-transaction.controller.ts:214,216` — `envelope.
 *     availableAmount` → `budgetService.getEnvelopeBudgetSummary(...)`
 *     (view).
 *   - `budget.service.ts#findAllEnvelopes/#findEnvelopeById` —
 *     BEKLENMEYEN KEŞİF (brifingde adı geçmiyordu): bu iki metod entity'yi
 *     ÇIPLAK döndürüyordu ve `GET /budget/envelopes`/`GET /budget/envelopes/
 *     :id` üzerinden `collmind.frontend`'in envelope liste/dashboard
 *     bileşenlerine (`BudgetEnvelopeList.tsx`, `BudgetDashboard.tsx`,
 *     `BudgetSummaryCard.tsx`, `BudgetEnvelopeCard.tsx`) besleniyordu. Kolon
 *     düşünce bu alan JSON'dan SESSİZCE kaybolur ve frontend
 *     `envelope.availableAmount.toLocaleString(...)` üzerinde ÇÖKER — bu
 *     yalnız bir bayat-rakam riski değil, canlı bir UI kırılmasıdır. Bu
 *     yüzden her iki metot da view-türetilmiş `availableAmount` ile
 *     ZENGİNLEŞTİRİLDİ (bkz. `budget.service.ts`), JSON alan adı KORUNDU —
 *     frontend'de değişiklik gerekmiyor.
 *   - `createEnvelope`/`splitEnvelope` YAZMA yolları — kolona artık
 *     yazılmıyor (kolon yok).
 *   - `budget-envelope.seed.ts` — `availableAmount` alanı kaldırıldı.
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805`/`1808`/`1809`/`1810`/`1811`/
 *    `1812` deseni) ────────────────────────────────────────────────────────
 *   kolon YOK                        → NO-OP, sessizce geç (taze/prod DB, ya
 *                                       da migration zaten uygulanmış)
 *   kolon VAR, beklenen şekilde
 *     (numeric(15,2), NOT NULL)      → DROP COLUMN
 *   kolon VAR, BEKLENMEYEN şekilde
 *     (tip/nullable farklı)          → İPTAL (throw, rollback) — kolonun
 *                                       bugün ölçülen şekli (`numeric(15,2)
 *                                       NOT NULL`, DEFAULT yok) varsayımı
 *                                       çürümüş demektir, sessizce silme
 *                                       YAPILMAZ
 * ⚠️ Burada `1809`'un "dolu satır" assert'inin bir KARŞILIĞI YOK — kolonun
 * DEĞERİ ne olursa olsun (bayat da olsa) düşürülmesi güvenlidir, çünkü hiçbir
 * canlı okuyucu artık ondan okumuyor (yukarıdaki tarama) ve `v_budget_
 * summary` zaten ondan bağımsız türetiyor. Veri kaybı riski YOK — kolon
 * KENDİSİ zaten yanlış bir kopyaydı.
 *
 * ── `down()` — kolon geri kurulur, ama SIRALAMA UYARISI ──────────────────────
 * `ALTER TABLE ... ADD COLUMN` PostgreSQL'de her zaman tabloyu FİZİKSEL
 * OLARAK SONA ekler (attnum), silinen kolonun eski ordinal pozisyonuna değil.
 * Yani `down()` sonrası `pg_dump --schema-only` çıktısındaki `CREATE TABLE`
 * kolon SIRASI, bu migration'dan ÖNCEKİ dump ile BİREBİR AYNI OLMAYACAKTIR
 * (available_amount, status/budget_owner_ alanları SONRASINA düşer — PostgreSQL'in
 * yapısal bir kısıtı, bu migration'ın bir kusuru değil). Bu, `1811`'in
 * (`DROP TABLE` + canlı-katalog-DDL'den `down()`) "byte-birebir" iddiasıyla
 * AYNI SINIF DEĞİL: orada tüm tablo yeniden yaratılıyordu (sıra korunur),
 * burada TEK KOLON drop+add (sıra korunmaz). Ölçülüp raporlanır — bkz. task
 * raporu "migration'ın üç dalı" bölümü. Tip/precision/scale/nullable/DEFAULT
 * (yok) BİREBİRDİR; yalnız ordinal pozisyon farklıdır. Uygulama katmanı (TypeORM
 * entity, sorgular) kolon sırasına duyarlı DEĞİLDİR — davranışsal etki YOK.
 */
export class DropAvailableAmountFromBudgetEnvelopes1814000000000 implements MigrationInterface {
  name = 'DropAvailableAmountFromBudgetEnvelopes1814000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columnRows: Array<{
      column_name: string;
      data_type: string;
      numeric_precision: number | null;
      numeric_scale: number | null;
      is_nullable: string;
      column_default: string | null;
    }> = await queryRunner.query(
      `SELECT column_name, data_type, numeric_precision, numeric_scale,
              is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name = 'budget_envelopes'
          AND column_name = 'available_amount'`,
    );

    if (columnRows.length === 0) {
      // Taze/prod DB, ya da bu migration zaten uygulanmış (tekrar koşum).
      return;
    }

    const col = columnRows[0];
    const shapeOk =
      col.data_type === 'numeric' &&
      col.numeric_precision === 15 &&
      col.numeric_scale === 2 &&
      col.is_nullable === 'NO' &&
      col.column_default === null;

    if (!shapeOk) {
      throw new Error(
        `INV-B-009 DropAvailableAmountFromBudgetEnvelopes ASSERT başarısız: ` +
          `main.budget_envelopes.available_amount beklenen şekilde DEĞİL ` +
          `(ölçülen: data_type=${col.data_type}, precision=${col.numeric_precision}, ` +
          `scale=${col.numeric_scale}, nullable=${col.is_nullable}, ` +
          `default=${col.column_default ?? 'NULL'} — beklenen: numeric(15,2) ` +
          `NOT NULL, DEFAULT yok). Bu, kolonun bugün ölçülen şeklinin ` +
          `varsayımının çürüdüğünü gösterir — sessizce düşürme YAPILMADI. ` +
          `Migration İPTAL edildi (transaction rollback). Team Lead'e bildir.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "main"."budget_envelopes" DROP COLUMN "available_amount"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columnRows: Array<{ column_name: string }> = await queryRunner.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name = 'budget_envelopes'
          AND column_name = 'available_amount'`,
    );
    if (columnRows.length > 0) {
      // Kolon zaten var (revert edilmemiş bir tekrar koşum) — NO-OP.
      return;
    }

    // Canlı-katalogdan ölçülen şekil ile birebir: numeric(15,2) NOT NULL,
    // DEFAULT yok. Geri kurulan kolon `0` ile doldurulur (aşağıda) ve hemen
    // ardından DEFAULT kaldırılır — orijinal migration
    // (1704067500000-CreateBudgetEnvelopes.ts) da DEFAULT taşımıyordu.
    // ⚠️ Sıra notu için bkz. dosya başı yorumu — ordinal pozisyon KORUNMAZ.
    //
    // ⚠️ BİLİNÇLİ ASİMETRİ (`1808` deseni): geri kurulan değer `0`'dır,
    // `up()` sırasındaki GERÇEK değer DEĞİL — PostgreSQL `DROP COLUMN`
    // fiziksel veriyi kurtarılamaz şekilde siler, ve bu migration onu ayrıca
    // bir yere yedeklemiyor. Bu, `1809`'un (kolon `37/37 NULL`, simetrik
    // geri kurma tam bilgi taşıyordu) TERSİ bir durum — ama `1808` gibi
    // (silinen satırlar geri gelmiyordu) BİLEREK: bu migration'ın TÜM
    // gerekçesi (`Z47 §1`, "kolon zaten yanlış bir kopya, doğduğu gün
    // doğruydu, ilk rezervde bayatladı") kolonun DEĞERİNİN güvenilmez
    // olduğudur — `down()`'ın bu değeri "doğru" bir şekilde geri kurmaya
    // çalışması, KENDİSİ bir yalan üretir (`available_amount = 0` her zaman
    // yanlış olur ki `allocated_amount > 0` olan zarflarda öyle). `down()`
    // burada yalnız YAPIYI geri kurur (acil geri-alma / şema uyumluluğu
    // için) — DEĞERİ değil. Gerçek "kullanılabilir" hâlâ ve her zaman
    // `v_budget_summary`'dedir; bu migration revert edilse bile.
    await queryRunner.query(
      `ALTER TABLE "main"."budget_envelopes" ADD COLUMN "available_amount" numeric(15,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "main"."budget_envelopes" ALTER COLUMN "available_amount" DROP DEFAULT`,
    );
  }
}
