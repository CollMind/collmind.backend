import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `Z57` / `T-317` — bildirim dilimi, `P3` (tekrar-bastırma) şema kalemi.
 *
 * Kaynak: `docs/decisions/BILDIRIM_VE_AUTH_ADRESI.md` · `docs/process/
 * BILDIRIM_DILIMI_BRIEF.md` §1c, §3 `P3` · `docs/brd-v2/03_IS_KURALLARI/
 * L2_01_veri_butce_defter_hesaplama.md` `K-2.2.7a` (davranış merdiveni:
 * `WARNING` %80 · `FINANCE_REVIEW` %90 · `BLOCKED` %100).
 *
 * ── PARÇA A — `NotificationType` enum'una `BUDGET_FINANCE_REVIEW` ──────────
 * Ölçüldü (2026-08-28): `main.notifications_type_enum` bugün altı değer taşıyor
 * (`APPROVAL_REQUESTED|GRANTED|REJECTED`, `BUDGET_ALERT_80`, `BUDGET_ALERT_100`,
 * `AGREEMENT_EXPIRING`) — `%90` (`K-2.2.7a` `FINANCE_REVIEW` kademesi) karşılığı
 * YOK. `collmind.frontend/src/types/notification.types.ts` enum'u birebir aynı
 * dalgada hizalanır (bu migration'ın parçası değil, aynı task'ın parçası).
 *
 * `ALTER TYPE ... ADD VALUE` PG12+'de bir transaction bloğu İÇİNDE
 * çalıştırılabilir (server sürümü ölçüldü: 16.13) — kısıt yalnız YENİ değerin
 * AYNI transaction'da bir INSERT/UPDATE/karşılaştırmada KULLANILAMAMASIdır; bu
 * migration değeri eklemekten başka bir şey yapmıyor (olay ÜRETİMİ `T-318`'in
 * işi, kapsam dışı — `Z57 §2a`/DUR listesi). Bu yüzden `transaction=false`
 * GEREKMEZ; migration TypeORM'un varsayılan tek-transaction sarmalayıcısında
 * çalışır ve İPTAL dalı gerçek bir `ROLLBACK` ile sınanabilir (`1805`+ deseni).
 *
 * ── PARÇA B — zarf-başına "son bilinen kademe" — KOLON (TABLO DEĞİL) ───────
 * Ölçülerek karar verildi (`İlke 1`: bugün ihtiyaç olmayan şema esnekliği
 * açılmaz — emsal `T-218`, `calculated_kpis` JSONB bilerek açılmamıştı):
 *
 *   İhtiyaç: `P3`nin "geçiş" testi tek bir karşılaştırma gerektiriyor —
 *   "zarfın YENİ hesaplanan kademesi, EN SON BİLDİRİLEN kademeden yüksek mi?"
 *   `K-2.2.7a` TEK bir monoton merdivendir (`NONE < WARNING < FINANCE_REVIEW
 *   < BLOCKED`, `%80 < %90 < %100`) — zarf her an merdivenin TEK bir
 *   basamağındadır, birden çok bağımsız "kademe izi" YOKTUR. Bu, 1:1
 *   zarf↔durum ilişkisidir; `P3`'ün üç örneği de (`%89→91` · `%91→92` ·
 *   `%91→88→91`) tek bir "son bilinen kademe" skaleri ile ayırt edilir, EK
 *   BOYUT (kanal/kategori/tarih aralığı) gerektirmez — `budget_policies`
 *   zaten kanal/kategori boyutunu taşıyor (`K-2.2.8a`), ama OKUNAN eşiğin
 *   HANGİ POLİTİKADAN geldiği zarfın DURUMUNU değiştirmiyor, yalnız zarfın
 *   YÜZDESİNİ hangi sayıyla karşılaştıracağını belirliyor.
 *
 *   Tablo (zarf_id + kademe + created_at, çoklu satır / geçmiş) bir TARİHÇE
 *   ihtiyacı olsaydı gerekirdi — `P3`'ün gerekçesi ("olay bir GEÇİŞTİR")
 *   yalnız EN SON durumu bilmeyi gerektiriyor, geçmiş kademe listesini değil;
 *   `T-318`/`T-319` (olay üretimi, pinler) bir geçmiş sorgusu İSTEMİYOR.
 *   Tarihçe ihtiyacı doğarsa (ör. "zarf kaç kez %90'ı geçti" raporu) o gün
 *   ayrı bir migration'la eklenir — bugün açılmaz.
 *
 *   ⇒ **KOLON**: `main.budget_envelopes.last_notified_tier`,
 *   `budget_envelope_last_notified_tier_enum` (`NONE|WARNING|FINANCE_REVIEW|
 *   BLOCKED`), `NOT NULL DEFAULT 'NONE'`. `NOT NULL` bilinçli: `NULL` burada
 *   "bilinmiyor" değil "henüz bildirilmemiş" anlamına gelir ve bu durumun
 *   zaten adı var (`NONE`) — iki temsilli aynı durumu önler (`İlke 4`).
 *   `§2.5` bu migration'ı bağlamaz (bu bir sessiz-varsayılan DEĞİL, yeni bir
 *   zarfın "hiç bildirilmedi" başlangıç durumudur — mevcut zarflar için de
 *   aynı gerçek: bu sütun doğmadan önce hiçbiri bildirilmemişti); `T-318`'in
 *   OKUMA tarafı `§2.5`'e tabidir (kademe okunamıyorsa açık hata, varsayım
 *   atanmaz) — bu migration'ın kapsamı değil.
 *
 * ── ÜÇ DURUM AYRIMI (her iki parça için ayrı ayrı, `1805`+ deseni) ─────────
 *   PARÇA A: tip yok → İPTAL (beklenmeyen) · değer VAR → NO-OP · değer YOK
 *            → UYGULA (ADD VALUE + assert)
 *   PARÇA B: kolon YOK → UYGULA (tip oluştur + ADD COLUMN + assert) · kolon
 *            VAR beklenen şekilde → NO-OP · kolon VAR beklenmeyen şekilde
 *            → İPTAL
 *
 * ── `down()` ─────────────────────────────────────────────────────────────
 * PARÇA B tam simetrik (DROP COLUMN + DROP TYPE) — yeni tip, başka bağımlı
 * yok.
 *
 * PARÇA A — enum DEĞER SİLME PostgreSQL'de DOĞRUDAN DESTEKLENMEZ (`ALTER TYPE
 * ... DROP VALUE` yok). Bu migration'ın ürettiği tek DEĞER `T-318`'in (olay
 * ÜRETİMİ) işidir ve BU TASK'IN KAPSAMI DIŞINDA — yani bu migration'ın
 * kendi ömründe `notifications.type = 'BUDGET_FINANCE_REVIEW'` olan bir satır
 * ÜRETİLMEZ. Bu, tip-yeniden-oluşturma yoluyla TAM GERİ ALINABİLİRLİĞİ
 * mümkün kılıyor (aksi hâlde ADR 0007/repo emsali `1775`/`1776`'da olduğu
 * gibi `down()` no-op kalırdı — bkz. o dosyaların yorumları). `down()` ÖNCE
 * `BUDGET_FINANCE_REVIEW` değerini kullanan satır olup olmadığını ölçer:
 *   0 satır  → tipi yeniden oluştur (eski 6 değerle), kolonu yeni tipe cast
 *              et, eski tipi düşür, yeni tipi eski adına yeniden adlandır
 *              (canlı-katalogdan ölçülen sıralama korunur — `enumsortorder`
 *              ile doğrulandı)
 *   >0 satır → İPTAL (sessiz veri kaybı yasağı — geri alma satırları
 *              bozardı, `down()` da bir iddiadır)
 */
export class AddBudgetFinanceReviewNotificationTypeAndEnvelopeTier1816000000000 implements MigrationInterface {
  name = 'AddBudgetFinanceReviewNotificationTypeAndEnvelopeTier1816000000000';

  private readonly schema = 'main';

  // ── Parça A sabitleri ──
  private readonly notifTypeEnum = 'notifications_type_enum';
  private readonly notifTable = 'notifications';
  private readonly newNotifValue = 'BUDGET_FINANCE_REVIEW';
  private readonly originalNotifValues = [
    'APPROVAL_REQUESTED',
    'APPROVAL_GRANTED',
    'APPROVAL_REJECTED',
    'BUDGET_ALERT_80',
    'BUDGET_ALERT_100',
    'AGREEMENT_EXPIRING',
  ];

  // ── Parça B sabitleri ──
  private readonly envelopeTable = 'budget_envelopes';
  private readonly tierColumn = 'last_notified_tier';
  private readonly tierEnum = 'budget_envelope_last_notified_tier_enum';
  private readonly tierValues = [
    'NONE',
    'WARNING',
    'FINANCE_REVIEW',
    'BLOCKED',
  ];
  private readonly tierDefault = 'NONE';

  // ── Parça A yardımcıları ──

  private async notifTypeExists(queryRunner: QueryRunner): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      `SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typname = $2`,
      [this.schema, this.notifTypeEnum],
    );
    return rows.length > 0;
  }

  private async notifValueExists(queryRunner: QueryRunner): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      `SELECT 1 FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typname = $2 AND e.enumlabel = $3`,
      [this.schema, this.notifTypeEnum, this.newNotifValue],
    );
    return rows.length > 0;
  }

  /** Tipin CANLI etiket evreni — katalogdan, elle yazılmış listeden DEĞİL. */
  private async notifTypeLabels(queryRunner: QueryRunner): Promise<string[]> {
    const rows: Array<{ enumlabel: string }> = await queryRunner.query(
      `SELECT e.enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typname = $2
        ORDER BY e.enumsortorder`,
      [this.schema, this.notifTypeEnum],
    );
    return rows.map((r) => r.enumlabel);
  }

  private async notifValueRowCount(queryRunner: QueryRunner): Promise<number> {
    const rows: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM "${this.schema}"."${this.notifTable}" WHERE "type" = $1`,
      [this.newNotifValue],
    );
    const n = parseInt(rows[0]?.count ?? '0', 10);
    if (!Number.isFinite(n)) {
      throw new Error(
        `${this.name}: notifications.type='${this.newNotifValue}' satır sayısı ölçülemedi.`,
      );
    }
    return n;
  }

  // ── Parça B yardımcıları ──

  private async tierColumnState(queryRunner: QueryRunner): Promise<{
    exists: boolean;
    udtName: string | null;
    isNullable: string | null;
    columnDefault: string | null;
  }> {
    const rows: Array<{
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }> = await queryRunner.query(
      `SELECT udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [this.schema, this.envelopeTable, this.tierColumn],
    );
    if (rows.length === 0) {
      return {
        exists: false,
        udtName: null,
        isNullable: null,
        columnDefault: null,
      };
    }
    return {
      exists: true,
      udtName: rows[0].udt_name,
      isNullable: rows[0].is_nullable,
      columnDefault: rows[0].column_default,
    };
  }

  private async tierTypeExists(queryRunner: QueryRunner): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      `SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typname = $2`,
      [this.schema, this.tierEnum],
    );
    return rows.length > 0;
  }

  // ── up() ──

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PARÇA A
    const typeExists = await this.notifTypeExists(queryRunner);
    if (!typeExists) {
      throw new Error(
        `${this.name}: beklenmeyen durum — "${this.schema}"."${this.notifTypeEnum}" tipi ` +
          `bulunamadı. Küme değişmiş olabilir, sessizce geçilmiyor, İPTAL.`,
      );
    }
    const valueExists = await this.notifValueExists(queryRunner);
    if (!valueExists) {
      await queryRunner.query(
        `ALTER TYPE "${this.schema}"."${this.notifTypeEnum}" ADD VALUE '${this.newNotifValue}'`,
      );
      const after = await this.notifValueExists(queryRunner);
      if (!after) {
        throw new Error(
          `${this.name}: ADD VALUE sonrası '${this.newNotifValue}' hâlâ görünmüyor — assert başarısız.`,
        );
      }
    }
    // valueExists === true → NO-OP, zaten uygulanmış.

    // PARÇA B
    const colState = await this.tierColumnState(queryRunner);
    if (!colState.exists) {
      const typeAlreadyThere = await this.tierTypeExists(queryRunner);
      if (!typeAlreadyThere) {
        await queryRunner.query(`
          DO $$ BEGIN
            CREATE TYPE "${this.schema}"."${this.tierEnum}" AS ENUM(${this.tierValues
              .map((v) => `'${v}'`)
              .join(', ')});
          EXCEPTION
            WHEN duplicate_object THEN null;
          END $$;
        `);
      }
      await queryRunner.query(
        `ALTER TABLE "${this.schema}"."${this.envelopeTable}"
         ADD COLUMN "${this.tierColumn}" "${this.schema}"."${this.tierEnum}" NOT NULL DEFAULT '${this.tierDefault}'`,
      );

      const after = await this.tierColumnState(queryRunner);
      if (
        !after.exists ||
        after.udtName !== this.tierEnum ||
        after.isNullable !== 'NO' ||
        after.columnDefault !==
          `'${this.tierDefault}'::${this.schema}.${this.tierEnum}`
      ) {
        throw new Error(
          `${this.name}: ADD COLUMN sonrası beklenen şekil ölçülemedi ` +
            `(udt_name=${after.udtName}, is_nullable=${after.isNullable}, default=${after.columnDefault}) — assert başarısız.`,
        );
      }
      return;
    }

    const shapeOk =
      colState.udtName === this.tierEnum &&
      colState.isNullable === 'NO' &&
      colState.columnDefault ===
        `'${this.tierDefault}'::${this.schema}.${this.tierEnum}`;
    if (!shapeOk) {
      throw new Error(
        `${this.name}: "${this.envelopeTable}"."${this.tierColumn}" beklenmeyen şekilde ` +
          `(udt_name=${colState.udtName}, is_nullable=${colState.isNullable}, default=${colState.columnDefault}). ` +
          `Sessizce geçilmiyor, İPTAL.`,
      );
    }
    // NO-OP — zaten uygulanmış.
  }

  // ── down() ──

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PARÇA B — geri al (tam simetrik: kolon + tip)
    const colState = await this.tierColumnState(queryRunner);
    if (colState.exists) {
      const shapeOk =
        colState.udtName === this.tierEnum &&
        colState.isNullable === 'NO' &&
        colState.columnDefault ===
          `'${this.tierDefault}'::${this.schema}.${this.tierEnum}`;
      if (!shapeOk) {
        throw new Error(
          `${this.name} down(): "${this.envelopeTable}"."${this.tierColumn}" beklenmeyen ` +
            `şekilde (udt_name=${colState.udtName}, is_nullable=${colState.isNullable}, ` +
            `default=${colState.columnDefault}) — İPTAL.`,
        );
      }
      await queryRunner.query(
        `ALTER TABLE "${this.schema}"."${this.envelopeTable}" DROP COLUMN "${this.tierColumn}"`,
      );
      await queryRunner.query(`DROP TYPE "${this.schema}"."${this.tierEnum}"`);
    }
    // kolon yoksa → NO-OP (zaten geri alınmış).

    // PARÇA A — geri al (tip yeniden oluşturma; yalnız değer HİÇ kullanılmadıysa)
    const typeExists = await this.notifTypeExists(queryRunner);
    if (!typeExists) {
      throw new Error(
        `${this.name} down(): beklenmeyen durum — "${this.schema}"."${this.notifTypeEnum}" ` +
          `tipi bulunamadı — İPTAL.`,
      );
    }
    const valueExists = await this.notifValueExists(queryRunner);
    if (!valueExists) {
      // NO-OP — zaten geri alınmış (ya da hiç eklenmemiş).
      return;
    }

    // ⛔ `T-317` review (Team Lead, 2026-08-28) — EVREN DOĞRULAMASI.
    //
    // Aşağıdaki yeniden-oluşturma `originalNotifValues`'ı kullanır ve o liste
    // ELLE YAZILMIŞTIR. `DISIPLIN`: *"elle yazılmış üye-sayısı — ölçülmüş oran
    // DOKUZDA DOKUZ"*. Buradaki tehlike varsayımsal DEĞİL, ADI KONMUŞ ve
    // PLANLANMIŞTIR: `Z57 §2a` `7/14`-gün olayını ERTELEDİ ve sağlayıcısını
    // adlandırdı — o dalga bu enum'a YENİ BİR DEĞER ekleyecek.
    //
    // O gün bu `down()` koşarsa, tip YALNIZ altı elle yazılmış değerle yeniden
    // kurulur ⇒ yeni değer SESSİZCE KAYBOLUR (o değeri taşıyan satır yoksa
    // `USING ::text::` cast'i de hata VERMEZ — `§2.7`'nin *"verinin yokluğu
    // örter"* vakası).
    //
    // ⇒ Tipin GERÇEK etiket evreni ölçülür ve beklenenle karşılaştırılır.
    //   Sapma varsa → İPTAL (sessiz kayıp yasağı).
    const liveLabels = await this.notifTypeLabels(queryRunner);
    const expected = [...this.originalNotifValues, this.newNotifValue];
    const unexpected = liveLabels.filter((l) => !expected.includes(l));
    const missing = expected.filter((l) => !liveLabels.includes(l));
    if (unexpected.length > 0 || missing.length > 0) {
      throw new Error(
        `${this.name} down(): "${this.notifTypeEnum}" etiket evreni beklenenden ` +
          `farklı (fazladan: [${unexpected.join(', ')}], eksik: [${missing.join(', ')}]). ` +
          `Yeniden oluşturma elle yazılmış bir listeye dayanıyor; sapma varken ` +
          `koşarsa fazladan etiketler SESSİZCE KAYBOLUR — İPTAL.`,
      );
    }

    const usageCount = await this.notifValueRowCount(queryRunner);
    if (usageCount > 0) {
      throw new Error(
        `${this.name} down(): ${usageCount} satır "type"='${this.newNotifValue}' taşıyor — ` +
          `enum değeri kaldırılırsa bu satırlar geçersiz bir tipe düşer (sessiz veri kaybı ` +
          `yasağı). Sessizce geçilmiyor, İPTAL. Bu değeri üreten olay ÜRETİMİ bu task'ın ` +
          `kapsamı dışında (T-318) — kapsam ihlali varsa Team Lead'e bildir.`,
      );
    }

    const oldTypeTmp = `${this.notifTypeEnum}_pre_1816`;
    const valuesList = this.originalNotifValues.map((v) => `'${v}'`).join(', ');
    await queryRunner.query(
      `CREATE TYPE "${this.schema}"."${oldTypeTmp}" AS ENUM(${valuesList})`,
    );
    await queryRunner.query(
      `ALTER TABLE "${this.schema}"."${this.notifTable}"
       ALTER COLUMN "type" TYPE "${this.schema}"."${oldTypeTmp}"
       USING "type"::text::"${this.schema}"."${oldTypeTmp}"`,
    );
    await queryRunner.query(
      `DROP TYPE "${this.schema}"."${this.notifTypeEnum}"`,
    );
    await queryRunner.query(
      `ALTER TYPE "${this.schema}"."${oldTypeTmp}" RENAME TO "${this.notifTypeEnum}"`,
    );

    const after = await this.notifValueExists(queryRunner);
    if (after) {
      throw new Error(
        `${this.name} down(): tip yeniden oluşturulduktan sonra '${this.newNotifValue}' ` +
          `hâlâ görünüyor — assert başarısız.`,
      );
    }
  }
}
