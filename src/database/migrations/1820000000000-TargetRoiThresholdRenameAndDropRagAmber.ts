import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `T-343` / `Z70 §2` + `Z71 §3` — TEK-EKSEN EŞİK ALANLARININ KADERİ.
 *
 * ```
 * rag_amber_threshold   →  ÖLÜR
 * rag_green_threshold   →  target_roi_threshold  (YENİDEN ADLANDIRILIR)
 * ```
 *
 * ── `1` · NEDEN `rag_amber_threshold` ÖLÜYOR ─────────────────────────────
 * `Q7` kadranı (`Z66 §2`) indikten sonra RAG'ın tanımı **eşik değil İŞARET**
 * tabanlı: `iTO`/`iGP`'nin **sıfır çizgileri**. `İlke 3` sorusu soruldu
 * (*"kullanıcı bunu düzenlemek ister mi?"*) ve cevap **HAYIR**:
 * ### `"sıfırdan büyük"` konfigüre edilecek bir DEĞER değil, KAVRAMIN KENDİSİDİR.
 *
 * ⛔ Ve geri dönüş kapısı adlandırıldı: `AMBER`'ı bir eşikle oynatmak
 * (*"`iGP < −5000` olursa Amber sayalım"*) kadranı **geri-eşiğe** çevirir.
 *
 * ⚠️ **Bu kolon CANLIYKEN ölüyor** (emsal `E2`/`tier_roles` ÖLÜ DOĞMUŞTU) —
 * ölçüldü 2026-08-31: `main.kpis` 32 satır, `rag_amber_threshold` **1**
 * satırda dolu (`GP_ROI_PCT = 10.0000`). Bu yüzden `down()` yolu gerçek
 * olmak zorunda ve `up()` **beklenen kümeyi ASSERT ediyor** (aşağı bkz.).
 *
 * ── `2` · NEDEN `rag_green_threshold` YAŞIYOR ama YENİDEN ADLANDIRILIYOR ──
 * Tüketicisi **RAG DEĞİL**: `PlanService`'in Target-ROI ekseni
 * (`ABOVE_/ON_/BELOW_TARGET`) — ölçüldü `T-342 A0b`. `Z71 §1` o ekseni
 * *"below-target uyarısı + Finance kovası"* ile büyüttü ⇒ **bu dalganın
 * parçası**, artık bir ad-borcu değil.
 * ⛔ `rag` önekiyle yaşaması, `ragAmber`'ın öldüğü bir dünyada yarın birini
 * *"RAG konfigüre edilebilir"* yanılgısına götürürdü.
 *
 * ⚠️ **RENAME, DROP+ADD DEĞİL** — veri TAŞINIR. `DROP` edip yeniden
 * yaratmak `GP_ROI_PCT = 20.0000`'i sessizce `NULL`'a çevirirdi ve
 * Target-ROI ekseni `plan.service`'in `20.0` fallback'ine düşerdi:
 * konfigüre edilmiş bir değerin yerine bir sabitin geçmesi — `§2.5`.
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU) — HER İKİ KALEM İÇİN AYRI ────────
 *
 * `A` · RENAME (`rag_green_threshold` → `target_roi_threshold`)
 *   eski VAR, yeni YOK    → RENAME        (beklenen — ölçüldü)
 *   eski YOK, yeni VAR    → no-op         (zaten uygulanmış)
 *   ikisi de VAR / ikisi de YOK → İPTAL (throw) — şema belirsiz
 *
 * `B` · DROP (`rag_amber_threshold`)
 *   kolon YOK                            → no-op
 *   kolon VAR, dolu küme BEKLENEN hâlde  → DROP  (beklenen — ölçüldü)
 *   kolon VAR, küme FARKLI               → İPTAL (throw)
 *
 * ⛔ `B`'nin *"beklenen hâl"*i **dar tutuldu ve bu bilinçli**: tüketicisizlik
 * ölçümü yalnız `GP_ROI_PCT` için yapıldı. Başka bir KPI'ya eşik verilmişse
 * o satır **ölçülmemiş bir tüketici** olabilir ⇒ sessizce silinmez.
 * Dar assert aynı zamanda `down()`'ı **birebir geri döndürülebilir** kılar:
 * yalnız tek bir bilinen değer restore edilecek.
 *
 * ── `down()` ÖLÇÜLDÜ — ve TEK FARKI BURAYA YAZILIYOR (emsal `1814`) ──────
 * `up()` → `down()` turu koşuldu ve şema `pg_dump --schema-only -n main` ile
 * karşılaştırıldı (2026-08-31). Fark **iki kalem**, ikisi de anlamsal değil:
 * ```
 * 1  pg_dump'ın \restrict nonce'u        — oturum başına rastgele, şema değil
 * 2  rag_amber_threshold'un ORDINAL YERİ  — PostgreSQL yeniden eklenen bir
 *    kolonu HER ZAMAN SONA koyar (attnum); eski yerine koyamaz
 * ```
 * ⛔ İkincisi **her `DROP COLUMN` geri alışının kaçınılmaz sonucudur**
 * (`1814`'te de aynen kayıtlı) ve gizlenmedi. Kolon **tipi, nullability'si ve
 * DEĞERİ** birebir geri geldi — ölçüldü: `GP_ROI_PCT` `rag_green=20.0000`,
 * `rag_amber=10.0000`. `SELECT *` sütun sırasına bağlı bir tüketici olsaydı
 * bu bir kusur olurdu; ölçüldü, yok.
 */
export class TargetRoiThresholdRenameAndDropRagAmber1820000000000 implements MigrationInterface {
  name = 'TargetRoiThresholdRenameAndDropRagAmber1820000000000';

  /**
   * `up()` anında ölçülmüş ve `down()`'ın geri yazacağı DEĞER.
   * ⚠️ Bir varsayılan değil, bir **ÖLÇÜM**: 2026-08-31, canlı `main.kpis`,
   * `rag_amber_threshold IS NOT NULL` olan tek satır `GP_ROI_PCT = 10.0000`.
   * `up()` bundan sapan her kümede İPTAL eder ⇒ sabit ile gerçeklik
   * **inşa gereği** eşleşir (`§2.7`: kanıtın kendisi şüpheliyse sonuç da).
   */
  private static readonly MEASURED_AMBER = {
    kpiCode: 'GP_ROI_PCT',
    /** ⚠️ DİZGE: SQL'de `::numeric`'e cast edilerek karşılaştırılır. */
    value: '10',
  };

  private async columnExists(
    queryRunner: QueryRunner,
    column: string,
  ): Promise<boolean> {
    const rows: Array<{ one: number }> = await queryRunner.query(
      `SELECT 1 AS one
         FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name  = 'kpis'
          AND column_name = $1`,
      [column],
    );
    return rows.length > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── A · RENAME ────────────────────────────────────────────────────────
    const hasOldGreen = await this.columnExists(
      queryRunner,
      'rag_green_threshold',
    );
    const hasNewTarget = await this.columnExists(
      queryRunner,
      'target_roi_threshold',
    );

    if (hasOldGreen && !hasNewTarget) {
      await queryRunner.query(
        `ALTER TABLE "main"."kpis" RENAME COLUMN "rag_green_threshold" TO "target_roi_threshold"`,
      );
    } else if (!hasOldGreen && hasNewTarget) {
      // Zaten uygulanmış — no-op.
    } else {
      throw new Error(
        `1820: main.kpis rename ADIMI BELİRSİZ — ` +
          `rag_green_threshold=${hasOldGreen}, target_roi_threshold=${hasNewTarget}. ` +
          `İkisi birden var/yok ise şema beklenen hiçbir durumda değil; ` +
          `sessizce ilerlemiyor (CLAUDE.md §2.5).`,
      );
    }

    // ── B · DROP ──────────────────────────────────────────────────────────
    const hasAmber = await this.columnExists(
      queryRunner,
      'rag_amber_threshold',
    );
    if (!hasAmber) {
      // Zaten uygulanmış / hiç olmamış — no-op.
      return;
    }

    const expected =
      TargetRoiThresholdRenameAndDropRagAmber1820000000000.MEASURED_AMBER;

    // ⚠️ Karşılaştırma POSTGRES'te yapılıyor, TypeScript'te DEĞİL.
    // İki sebep: (1) `numeric` eşitliği orada **tam**dır, JS `Number()`
    // üzerinden geçmez; (2) `src/database` Alan A'dır ve `ADR 0007
    // Karar 8.2` yeni kodun IEEE-754 giriş noktası taşımadan doğmasını
    // ister (`money-float`). Beklenen değer `::numeric`'e cast edildiği
    // için dizge biçimi (`10` ↔ `10.0000`) fark yaratmaz.
    const unexpected: Array<{ kpi_code: string; val: string }> =
      await queryRunner.query(
        `SELECT kpi_code, rag_amber_threshold::text AS val
           FROM "main"."kpis"
          WHERE rag_amber_threshold IS NOT NULL
            AND NOT (kpi_code = $1 AND rag_amber_threshold = $2::numeric)`,
        [expected.kpiCode, expected.value],
      );

    if (unexpected.length > 0) {
      throw new Error(
        `1820: main.kpis.rag_amber_threshold ÖLÇÜLMEMİŞ satırlar taşıyor ` +
          `(${unexpected
            .map((r) => `${r.kpi_code}=${r.val}`)
            .join(', ')}). Tüketicisizlik ölçümü yalnız ` +
          `${expected.kpiCode}=${expected.value} için yapıldı; başka bir ` +
          `KPI'ya verilmiş eşik ÖLÇÜLMEMİŞ BİR TÜKETİCİ olabilir. ` +
          `Sessizce silinmiyor (CLAUDE.md §2.5) — ve down() onu geri ` +
          `getiremezdi.`,
      );
    }

    // ⛔ `T-343` review `S1` — VARLIK ASSERT'İ. Yukarıdaki sorgu yalnız
    // *"BEKLENMEYEN satır yok"* der; **beklenen satırın VAR OLDUĞUNU
    // doğrulamaz.** Kolonu tamamen `NULL` olan bir ortamda `up()` sessizce
    // geçer ve `down()` `GP_ROI_PCT = 10`'u **UYDURURDU** — yani dosyanın
    // *"bir varsayılan değil, bir ÖLÇÜM"* iddiası o dalda YANLIŞ olurdu.
    // Bu, düzeltilen sınıfın (`§2.5`) migration tarafındaki yeni bir vakası.
    const [{ cnt: expectedRowCount }]: [{ cnt: number }] =
      await queryRunner.query(
        `SELECT COUNT(*)::int AS cnt
           FROM "main"."kpis"
          WHERE kpi_code = $1 AND rag_amber_threshold = $2::numeric`,
        [expected.kpiCode, expected.value],
      );

    if (expectedRowCount === 0) {
      throw new Error(
        `1820: main.kpis'te ${expected.kpiCode} = ${expected.value} taşıyan ` +
          `HİÇBİR satır yok. down() bu değeri geri yazacak şekilde yazıldı; ` +
          `var olmayan bir değeri geri yazmak bir ÖLÇÜM değil bir UYDURMA ` +
          `olurdu (CLAUDE.md §2.5). Şema/veri beklenen durumda değil.`,
      );
    }
    // ⇒ Bu noktadan sonra `down()`'ın geri yazacağı değer **ölçülmüştür**:
    // beklenmeyen satır yok VE beklenen satır var. Çift taraflı assert.

    await queryRunner.query(
      `ALTER TABLE "main"."kpis" DROP COLUMN "rag_amber_threshold"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── B⁻¹ · kolonu GERİ GETİR ve ÖLÇÜLEN DEĞERİ geri yaz ────────────────
    // Kolon tipi canlı katalogdan alındı (`information_schema`, 2026-08-31):
    // numeric(18,4), nullable — elle eski migration metni birleştirilmedi.
    if (!(await this.columnExists(queryRunner, 'rag_amber_threshold'))) {
      await queryRunner.query(
        `ALTER TABLE "main"."kpis" ADD COLUMN "rag_amber_threshold" numeric(18,4)`,
      );
      const expected =
        TargetRoiThresholdRenameAndDropRagAmber1820000000000.MEASURED_AMBER;
      // ⚠️ `up()` kümeyi **ÇİFT TARAFLI** assert ettiği için bu geri yazma
      // bir tahmin değil: (a) beklenmeyen satır YOKTU, (b) beklenen satır
      // VARDI (`S1` düzeltmesi). İkisi birden olmadan bu `UPDATE` bir
      // uydurma olurdu.
      await queryRunner.query(
        `UPDATE "main"."kpis" SET "rag_amber_threshold" = $1 WHERE kpi_code = $2`,
        [expected.value, expected.kpiCode],
      );
    }

    // ── A⁻¹ · RENAME geri ─────────────────────────────────────────────────
    const hasOldGreen = await this.columnExists(
      queryRunner,
      'rag_green_threshold',
    );
    const hasNewTarget = await this.columnExists(
      queryRunner,
      'target_roi_threshold',
    );

    if (hasNewTarget && !hasOldGreen) {
      await queryRunner.query(
        `ALTER TABLE "main"."kpis" RENAME COLUMN "target_roi_threshold" TO "rag_green_threshold"`,
      );
      return;
    }
    if (!hasNewTarget && hasOldGreen) {
      // Zaten geri alınmış — no-op.
      return;
    }
    throw new Error(
      `1820 down(): main.kpis rename geri alma ADIMI BELİRSİZ — ` +
        `target_roi_threshold=${hasNewTarget}, rag_green_threshold=${hasOldGreen}.`,
    );
  }
}
