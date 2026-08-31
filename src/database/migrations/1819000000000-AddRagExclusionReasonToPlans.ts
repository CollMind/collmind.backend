import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `T-342` / `Z68 §2` + `Z71 §2` — `main.plans.rag_exclusion_reason`.
 *
 * ── NEDEN BİR KOLON, VE NEDEN BU DALGADA ─────────────────────────────────
 * `Z68 §2` üç yüzeyin de *"değerlendirme DIŞI"* ile *"değerlendirilemedi"*yi
 * ayırt etmesini şart koştu. `T-342`'nin ilk turu sebebi yalnız
 * `plan_fus`/`plan_skus`'ın `calculated_kpis` JSONB'sine yazdı — grid rozeti
 * canlandı, **plan listesi ve finans raporları `GRİ` kaldı.**
 *
 * ⛔ O yarım hâli *"Faz-1: yalnız grid"* diye NOT DÜŞMEK tam `T-084`
 * problemidir: **bir kusuru belgelemek onu koruma altına alır.** (`Z71 §2`)
 *
 * ⚠️ Ve çıkarım yolu ÖLÇÜLDÜ ve KAPALI çıktı: `ragStatus === null &&
 * coverageRatio === 1` bileşimi *"eksenlerden biri kısmi kapsamalı"*
 * durumuyla da eşleşiyor ⇒ kolonsuz ayrım **sessiz bir tahmin** olurdu.
 *
 * ── MALİYET: BUGÜN SIFIR ─────────────────────────────────────────────────
 * Ölçüldü 2026-08-31 (canlı DB, `main` şeması): `main.plans` **0 satır**.
 * `plans=0` penceresi her e2e sonrası açılıyor ⇒ backfill sorusu yok.
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU) ──────────────────────────────────
 *   kolon YOK                    → ADD          (beklenen — ölçüldü)
 *   kolon VAR, tipi AYNI         → no-op        (migration tekrar koşuyor)
 *   kolon VAR, tipi FARKLI       → İPTAL (throw) — şema sürüklenmiş, sessizce
 *                                  ÜSTÜNE YAZILMAZ
 *
 * `down()` simetrik üç durumu taşır: kolon yoksa no-op, doluysa (yani gerçek
 * bir dışlama sebebi kalıcılaşmışsa) **İPTAL** — bir DROP sessizce veri
 * silmez.
 *
 * ── ⛔ ÜÇ DALIN ÜÇÜ DE AMPİRİK KOŞULDU (`T-343` review `S7`) ─────────────
 * *"Assert taşıyan bir migration üç durumu **ayırt etmeli**"* — ve ayırt
 * ettiği **ölçülerek** gösterilir, yazılarak değil (emsal `1818:110`).
 * ```
 * ADD     migration:run                         → varchar(32) oluştu
 * NO-OP   up() ikinci kez doğrudan çağrıldı      → patlamadı
 * İPTAL   kolon `integer` olarak elle kuruldu    → exit 1, BULUNAN+BEKLENEN
 *                                                  tip mesajda ADLANDIRILDI
 * down()  migration:revert                       → kolon düştü (0 dolu satır)
 * ```
 *
 * ⚠️ Değer sınıfı `src/common/kpi/rag-quadrant.ts#RagExclusionReason`'da
 * yaşar (bugün tek üye: `LTA_ONLY`). Kolona bir CHECK constraint
 * KONULMADI ve bu bilinçli: sınıfın tek kanonik yeri TypeScript tarafıdır
 * (`parseRagExclusionReason` tanınmayan değeri `null`'a düşürür), iki yerde
 * iki liste `F8` ailesi olurdu.
 */
export class AddRagExclusionReasonToPlans1819000000000 implements MigrationInterface {
  name = 'AddRagExclusionReasonToPlans1819000000000';

  private static readonly TABLE = 'main.plans';
  private static readonly COLUMN = 'rag_exclusion_reason';
  /** `rag_status` ile aynı sınıf: kısa, sabit sözlüklü bir etiket. */
  private static readonly EXPECTED_TYPE = 'character varying';
  private static readonly EXPECTED_LENGTH = '32';

  private async describeColumn(
    queryRunner: QueryRunner,
  ): Promise<{ data_type: string; character_maximum_length: number } | null> {
    const rows: Array<{
      data_type: string;
      character_maximum_length: number;
    }> = await queryRunner.query(
      `SELECT data_type, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name  = 'plans'
          AND column_name = $1`,
      [AddRagExclusionReasonToPlans1819000000000.COLUMN],
    );
    return rows.length === 0 ? null : rows[0];
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await this.describeColumn(queryRunner);

    if (existing !== null) {
      // ⚠️ `Number()` KULLANILMIYOR ve bu bilinçli: `src/database` Alan A'dır
      // (`money-float-domain-a.txt`) ve `ADR 0007 Karar 8.2` yeni kodun
      // **tam doğmasını** ister. Uzunluk bir tamsayı, yani IEEE-754 riski
      // yok — ama kapı sınıfa bakar, vakaya değil; dizge karşılaştırması
      // hem tam hem kapıyı gereksiz allowlist'le kirletmiyor.
      const typeMatches =
        existing.data_type ===
          AddRagExclusionReasonToPlans1819000000000.EXPECTED_TYPE &&
        String(existing.character_maximum_length) ===
          AddRagExclusionReasonToPlans1819000000000.EXPECTED_LENGTH;

      if (typeMatches) {
        // Zaten uygulanmış — no-op.
        return;
      }

      throw new Error(
        `1819: main.plans.rag_exclusion_reason ZATEN VAR ama tipi beklenenden ` +
          `FARKLI (bulunan: ${existing.data_type}` +
          `(${existing.character_maximum_length}), beklenen: ` +
          `${AddRagExclusionReasonToPlans1819000000000.EXPECTED_TYPE}` +
          `(${AddRagExclusionReasonToPlans1819000000000.EXPECTED_LENGTH})). ` +
          `Şema sürüklenmiş — sessizce üstüne YAZILMIYOR (CLAUDE.md §2.5).`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "main"."plans" ADD COLUMN "rag_exclusion_reason" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const existing = await this.describeColumn(queryRunner);

    if (existing === null) {
      // Hiç eklenmemiş ya da zaten geri alınmış — no-op.
      return;
    }

    const [{ cnt }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt
         FROM "main"."plans"
        WHERE "rag_exclusion_reason" IS NOT NULL`,
    );

    if (cnt > 0) {
      throw new Error(
        `1819 down(): main.plans.rag_exclusion_reason ${cnt} satırda DOLU. ` +
          `Bir DROP sessizce veri silmez — önce bu satırların ne anlama ` +
          `geldiğine karar verin (CLAUDE.md §2.5).`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "main"."plans" DROP COLUMN "rag_exclusion_reason"`,
    );
  }
}
