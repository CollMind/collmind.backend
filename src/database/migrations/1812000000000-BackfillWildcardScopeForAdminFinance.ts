import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `Z30 H8` / `Z35 §3` — `UNRESTRICTED` terfisi şık (c): `ADMIN` ve `FINANCE`
 * rolündeki kullanıcılara joker `main.user_scopes` satırı (BACKFILL-EMNİYETİ).
 *
 * Kaynak: `.claude/backlog/MIGRATION_SEQUENCE.md` `1812000000000` satırı ·
 * `user-scope.entity.ts` `WILDCARD_ON_CREATE_ROLES` (`T-241`) ·
 * `access-scope.service.ts` `UNRESTRICTED_ROLES` (`T-235 ADIM 2`).
 *
 * ── BU BİR KURMA DEĞİL, BİR EMNİYET ────────────────────────────────────────
 * Yaratma katmanı (`user.service.ts#resolveScopeRowsToWrite`,
 * `WILDCARD_ON_CREATE_ROLES`) `ADMIN`/`FINANCE`/`READONLY` için joker satırı
 * ZATEN yazıyor — `T-241`'den beri. Bu migration'ın hedefi bugünkü DB değil,
 * `T-241` ÖNCESİ doğmuş (ya da başka bir yoldan, ör. elle SQL ile) yaratılmış
 * kullanıcılar. Ölçüldü (2026-08-24, main şemasına nitelendirilmiş):
 *
 *   role     | total_rows | wildcard_rows | active_wildcard_rows
 *   ADMIN    |     1      |      1        |         1     (1/1 kullanıcı)
 *   FINANCE  |     1      |      1        |         1     (2/2 kullanıcı)
 *
 * Bu DB'de boşluk **0** — `up()`'ın bu DB'de NO-OP dönmesi BEKLENEN
 * sonuçtur, başarısızlık değil.
 *
 * ── Kapsam: neden READONLY YOK ──────────────────────────────────────────────
 * `WILDCARD_ON_CREATE_ROLES` (yaratma sabiti) ÜÇ rolü kapsar; bu migration
 * yalnız İKİSİNİ hedefliyor. Sebep, `AccessScopeService`'te KALDIRILAN
 * `UNRESTRICTED_ROLES` sabitiydi (geçmiş zaman — `Z30 H8`, 2026-08-24 ile
 * silindi): o sabit `ADMIN`+`FINANCE` taşıyordu, `READONLY` ise `T-235 ADIM 2`
 * ile ondan çıkarılmış ve **zaten satırdan** okunuyordu.
 *
 * ⇒ Kısa devre kalkınca `buildScope`'un fail-closed dalı
 * (`rows.length === 0 → SCOPED{pairs:[]}`) bu İKİ rol için İLK KEZ erişilebilir
 * hâle geldi — `READONLY` için zaten erişilebilirdi ve davranışı değişmedi.
 * Bu migration tam olarak o iki rolün fail-closed düşmesini engelliyor.
 *
 * Kapsamı `READONLY`'ye genişletmek `İlke 1` ihlali olurdu (ihtiyaç ölçülmedi:
 * `READONLY` bugün de joker satırını yaratmada alıyor).
 *
 * ── DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805`/`1808`/`1809`/`1810`/`1811`
 *    deseni) — KULLANICI BAŞINA, BEŞ KOVA ─────────────────────────────────
 * `UQ_user_scopes_user_cpl_category` `NULLS NOT DISTINCT`dir (`1810`) ve
 * `is_active` ÜZERİNDE DE `deleted_at` ÜZERİNDE DE PARTIAL DEĞİLDİR — yani
 * `(user_id, NULL, NULL)` anahtarı aktif/pasif/soft-silinmiş fark etmeksizin
 * EN FAZLA BİR satır tarafından işgal edilebilir.
 *
 * ⚠️ İKİ FARKLI EVREN vardır ve İKİSİ AYRI TUTULUR — `alive_*` (yalnız
 * `deleted_at IS NULL`) `AccessScopeService.resolveScope`'un OKUDUĞU evrendir
 * (`userScopeRepo.find(...)`, TypeORM soft-silinmiş satırları otomatik
 * dışlar); `any_wildcard_rows` (deleted_at filtresi YOK) yalnız UQ'nun
 * KATALOG SEVİYESİNDEKİ çakışma riskini ölçmek için var (aşağıdaki 5. kova).
 * Bu ayrım S1'in code-review düzeltmesi (2026-08-25): önceki hâl `deleted_at`'i
 * hiç filtrelemiyordu, yani soft-silinmiş bir joker satır migration'a
 * "aktif joker VAR, NO-OP" dedirtebilirken çalışma zamanı `rows.length===0`
 * (fail-closed) görürdü — emniyet ağı tam koruması gereken durumda deliniyordu.
 *
 *   1) alive_wildcard=0, alive_total=0,
 *      any_wildcard=0                    → EKSİK: joker satır YAZ + assert
 *   2) alive_wildcard=1, alive_active=1,
 *      alive_total=alive_wildcard (=1)   → NO-OP (zaten doğru — taze/prod
 *                                           DB'de ya da bu migration'ın daha
 *                                           önce yazdığı satır, tekrar koşum)
 *   3) alive_wildcard=1, alive_active=0  → ⛔ İPTAL: PASİF joker satır, aktif
 *                                           yok. Bir admin'in `updateScope`
 *                                           `REVOKE_ALL`'u ile BİLİNÇLİ olarak
 *                                           erişimi kaldırmış olabileceği
 *                                           anlamına gelir (`ScopeAuditActionType.
 *                                           SCOPE_REVOKE_ALL`) — sessizce
 *                                           reaktive edilmez.
 *   4) alive_total > alive_wildcard      → ⛔ İPTAL: joker YANINDA ya da
 *                                           YERİNE dar (kısıtlı) bir alive
 *                                           satır var. S2'nin code-review
 *                                           düzeltmesi (2026-08-25): önceki
 *                                           hâl yalnız `wildcard=0 ∧ total>0`u
 *                                           yakalıyordu — `wildcard=1 ∧
 *                                           active=1 ∧ total>1` (joker VE dar
 *                                           satır BİR ARADA) hiçbir filtreye
 *                                           takılmadan sessiz NO-OP'a
 *                                           düşüyordu. `WILDCARD_ON_CREATE_ROLES`
 *                                           tasarımı gereği ADMIN/FINANCE
 *                                           HİÇBİR ZAMAN kısıtlı satır
 *                                           taşımamalı (`resolveScopeRowsToWrite`,
 *                                           gönderilen `scope` reddedilir/yok
 *                                           sayılır) — bu durum varsayımın
 *                                           ÇÜRÜDÜĞÜNÜ gösterir (ör. rol
 *                                           sonradan PLANNER→ADMIN değişmiş
 *                                           ve eski kısıtlı satırlar
 *                                           temizlenmemiş). Ürün sahibi
 *                                           kararı gerekir.
 *   5) alive_wildcard=0, alive_total=0,
 *      any_wildcard>0                    → ⛔ İPTAL: `(user_id, NULL, NULL)`
 *                                           anahtarı SOFT-SİLİNMİŞ bir joker
 *                                           satır tarafından zaten işgal
 *                                           edilmiş. `alive_*` görünürde
 *                                           "eksik" gösterir ama UQ PARTIAL
 *                                           olmadığı için sessiz bir INSERT
 *                                           ham bir `23505` üretirdi. Bu
 *                                           satırın kaderi (kalıcı silme mi,
 *                                           reaktivasyon mu) bir ürün sahibi
 *                                           kararı — migration'ın kapsamı
 *                                           DEĞİL (bu migration yalnız EKSİK
 *                                           satırı YAZAR, var olan bir
 *                                           anahtar çakışmasını ÇÖZMEZ).
 *
 * 3/4/5 kovalarının HERHANGİ biri dolu ise TEK bir throw ile tüm transaction
 * geri alınır (`1808`/`1809`/`1810`/`1811` deseni) — kısmi yazma YAPILMAZ.
 * (3 ve 4 aynı kullanıcıda birlikte de görünebilir — mesaj her iki kovayı da
 * ayrı ayrı raporlar.)
 *
 * Kapsam: `role IN ('ADMIN','FINANCE')` VE `u.deleted_at IS NULL` — soft-
 * silinmiş KULLANICILAR giriş yapamaz, backfill'in hedefi değil (İlke 1:
 * ihtiyaçsız satır yazma). Bu, yukarıdaki `us.deleted_at` (kapsam SATIRININ
 * kendisi) filtresinden AYRI bir kavram — biri kullanıcıyı, diğeri satırı
 * süzüyor.
 *
 * ── `down()` — YALNIZ BU MİGRASYONUN YAZDIĞI SATIRLARI SİLER ──────────────
 * Zaten var olan joker satırlara (normal `create()` akışıyla doğmuş, ADMIN
 * aktörün `createdBy`'sini taşıyan) dokunulursa, geri alma `READONLY`
 * deseniyle (ya da bu migration'dan ÖNCE meşru yollarla) doğmuş satırları
 * silerdi (`1808`'in yaşadığı asimetri riski). Ayrım BİR SENTİNEL'LE:
 * bu migration'ın yazdığı HER satırın `created_by` alanına sabit, insan
 * kullanıcısı olamayacak bir UUID yazılır (`MIGRATION_ACTOR_ID`, RFC 4122
 * biçiminde ama gerçek bir `users.id` DEĞİL — `created_by`'nin FK'si yok,
 * yalnız `uuid` kolonu, bkz. `base.entity.ts`). `down()` yalnız
 * `created_by = MIGRATION_ACTOR_ID` satırlarını siler — hiçbir gerçek admin
 * eyleminin `createdBy`'si bu sabitle ÇAKIŞAMAZ (gerçek `createdBy` her zaman
 * çağıran admin'in `users.id`'sidir, rastgele üretilir).
 *
 * Bu, `1808`'in kabul ettiği asimetriden FARKLI: orada silinen VERİ geri
 * gelmiyordu (bilinçli asimetri). Burada YAZILAN veri (ve YALNIZ o veri)
 * simetrik olarak geri alınır — pre-existing satırlara dokunulmaz.
 */
export class BackfillWildcardScopeForAdminFinance1812000000000 implements MigrationInterface {
  name = 'BackfillWildcardScopeForAdminFinance1812000000000';

  /**
   * Bu migration'ın yazdığı satırları işaretlemek için kullanılan sentinel.
   * Gerçek bir `users.id` DEĞİLDİR (rastgele üretilmiş bir UUID gibi
   * görünmesin diye bilerek okunabilir/aranabilir bir desen: migration
   * numarasını taşıyan sabit bir UUID). `created_by`'nin FK'si yok
   * (`base.entity.ts` — düz `uuid, nullable`), yani bu değer katalog
   * seviyesinde bir bütünlük ihlali üretmez.
   */
  private static readonly MIGRATION_ACTOR_ID =
    '00000000-0000-0000-0000-000000001812';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sentinel =
      BackfillWildcardScopeForAdminFinance1812000000000.MIGRATION_ACTOR_ID;

    // ── 1) Kullanıcı başına kapsam özeti ─────────────────────────────────────
    // COUNT(us.id) FILTER(...) — LEFT JOIN + IS NULL yokluk testi TUZAĞINA
    // düşmez (CLAUDE.md: "LEFT JOIN + IS NULL bir YOKLUK testi DEĞİLDİR"):
    // burada bir kolonun NULL'luğuna değil, JOIN edilen SATIRIN varlığına
    // (us.id) bakılıyor.
    //
    // ⚠️ S1 (code-review, 2026-08-25): `alive_*` sütunları YALNIZ
    // `us.deleted_at IS NULL` satırları sayar — `AccessScopeService.
    // resolveScope`'un okuduğu evrenle (`userScopeRepo.find(...)`, TypeORM
    // `@DeleteDateColumn` soft-silinmiş satırları OTOMATİK dışlar) BİREBİR
    // eşleşsin diye. Önceki hâl `deleted_at`'i hiç filtrelemiyordu — soft-
    // silinmiş bir joker satır migration'a "aktif joker VAR, NO-OP" dedirtip
    // çalışma zamanında `rows.length===0` (fail-closed) üretebilirdi; emniyet
    // ağı tam koruması gereken durumda deliniyordu.
    //
    // `any_wildcard_rows` AYRI ve KASITLI OLARAK `deleted_at`'i FİLTRELEMEZ:
    // `UQ_user_scopes_user_cpl_category` PARTIAL DEĞİL (`1810`) — soft-
    // silinmiş bir joker satır bile `(user_id, NULL, NULL)` anahtarını
    // KATALOG SEVİYESİNDE işgal eder. Bu sütun, "aktif joker yok" ile
    // "INSERT güvenle yapılabilir" arasındaki farkı ayırt etmek için var
    // (aşağıda `softDeletedWildcardBlocksInsert`).
    const summaryRows: Array<{
      user_id: string;
      tenant_id: string;
      alive_total_rows: string;
      alive_wildcard_rows: string;
      alive_active_wildcard_rows: string;
      any_wildcard_rows: string;
    }> = await queryRunner.query(
      `SELECT
          u.id AS user_id,
          u.tenant_id AS tenant_id,
          COUNT(us.id) FILTER (
            WHERE us.id IS NOT NULL AND us.deleted_at IS NULL
          ) AS alive_total_rows,
          COUNT(us.id) FILTER (
            WHERE us.cpl_id IS NULL AND us.category_id IS NULL
              AND us.deleted_at IS NULL
          ) AS alive_wildcard_rows,
          COUNT(us.id) FILTER (
            WHERE us.cpl_id IS NULL AND us.category_id IS NULL
              AND us.deleted_at IS NULL AND us.is_active = true
          ) AS alive_active_wildcard_rows,
          COUNT(us.id) FILTER (
            WHERE us.cpl_id IS NULL AND us.category_id IS NULL
          ) AS any_wildcard_rows
        FROM "main"."users" u
        LEFT JOIN "main"."user_scopes" us ON us.user_id = u.id
        WHERE u.role IN ('ADMIN', 'FINANCE')
          AND u.deleted_at IS NULL
        GROUP BY u.id, u.tenant_id`,
    );

    // ⚠️ `parseInt(x, 10)` bilerek — `Number()` `money-float` guard'ının
    // Domain A (`src/database`) taraması tarafından işaretlenir (ADR 0007
    // Karar 3b). Buradaki değerler PARA DEĞİL, `COUNT(...)::int` satır
    // sayılarıdır (driver bigint'i string döndürür) — ama guard statik bir
    // yol taraması, anlam ayrımı yapmaz. `parseInt` tam tamsayı ayrıştırması
    // için doğru araçtır ve guard'ın işaretlediği listede yoktur.
    //
    // ── S2 (code-review, 2026-08-25) — BEŞİNCİ, önceden sessiz kalan kova ──
    // Önceki hâl yalnız `wildcard_rows === 0 && total_rows > 0` diye kontrol
    // ediyordu — `wildcard=1 ∧ active=1 ∧ total>1` (joker satır VE ayrıca dar
    // satır bir arada) hiçbir filtreye takılmadan "zaten doğru" (no-op)
    // kovasına düşüyordu. `alive_total_rows > alive_wildcard_rows` yüklemi bu
    // ikisini TEK yüklemde birleştirir: joker olsun olmasın, joker
    // OLMAYAN herhangi bir alive satır varsa `WILDCARD_ON_CREATE_ROLES`
    // invaryantı ("ADMIN/FINANCE hiçbir zaman kısıtlı satır taşımaz")
    // ihlal edilmiş demektir.
    const missing = summaryRows.filter(
      (r) =>
        parseInt(r.alive_wildcard_rows, 10) === 0 &&
        parseInt(r.alive_total_rows, 10) === 0 &&
        parseInt(r.any_wildcard_rows, 10) === 0,
    );
    const inactiveWildcardOnly = summaryRows.filter(
      (r) =>
        parseInt(r.alive_wildcard_rows, 10) === 1 &&
        parseInt(r.alive_active_wildcard_rows, 10) === 0,
    );
    const narrowRowsAlongsideOrInsteadOfWildcard = summaryRows.filter(
      (r) =>
        parseInt(r.alive_total_rows, 10) > parseInt(r.alive_wildcard_rows, 10),
    );
    // ── S1'in UQ tarafı: soft-silinmiş bir joker satır INSERT'i BLOKE eder ──
    // `alive_*` sıfır (görünürde "eksik") AMA `any_wildcard_rows > 0` —
    // yani `(user_id, NULL, NULL)` anahtarı soft-silinmiş bir satır
    // tarafından ZATEN işgal edilmiş. `NULLS NOT DISTINCT` PARTIAL değil,
    // bu satır aktif/pasif/silinmiş fark etmeksizin anahtarı tutar. Buraya
    // sessizce INSERT denemek ham bir `23505` üretirdi — bunun yerine açık,
    // teşhis edilebilir bir İPTAL: bu durumun düzeltilmesi (satırı kalıcı
    // silmek mi, reaktive mi etmek) bir ürün sahibi kararı gerektirir,
    // migration'ın kapsamı DEĞİL (bu migration yalnız EKSİK satırı YAZAR).
    const softDeletedWildcardBlocksInsert = summaryRows.filter(
      (r) =>
        parseInt(r.alive_wildcard_rows, 10) === 0 &&
        parseInt(r.alive_total_rows, 10) === 0 &&
        parseInt(r.any_wildcard_rows, 10) > 0,
    );

    // ── 2) Beklenmeyen ara durum → İPTAL ──────────────────────────────────────
    if (
      inactiveWildcardOnly.length > 0 ||
      narrowRowsAlongsideOrInsteadOfWildcard.length > 0 ||
      softDeletedWildcardBlocksInsert.length > 0
    ) {
      const inactiveIds = inactiveWildcardOnly.map((r) => r.user_id).join(', ');
      const narrowIds = narrowRowsAlongsideOrInsteadOfWildcard
        .map((r) => r.user_id)
        .join(', ');
      const softDeletedIds = softDeletedWildcardBlocksInsert
        .map((r) => r.user_id)
        .join(', ');
      throw new Error(
        `Z30-H8 BackfillWildcardScopeForAdminFinance ASSERT başarısız: ` +
          `ADMIN/FINANCE kullanıcılarının joker kapsamı için "BEKLENMEYEN ARA ` +
          `DURUM" tespit edildi — sessizce tamamlanmadı, migration İPTAL edildi ` +
          `(transaction rollback). ` +
          `[PASİF joker, aktif YOK] user_id'ler (${inactiveWildcardOnly.length}): ` +
          `[${inactiveIds || '—'}] — bu, bir REVOKE_ALL ile bilinçli erişim ` +
          `kaldırmayı gösterebilir; sessizce reaktive edilmedi. ` +
          `[Joker YANINDA/YERİNE dar (kısıtlı) satır VAR] user_id'ler ` +
          `(${narrowRowsAlongsideOrInsteadOfWildcard.length}): [${narrowIds || '—'}] — ` +
          `WILDCARD_ON_CREATE_ROLES varsayımı (ADMIN/FINANCE hiçbir zaman kısıtlı ` +
          `satır taşımaz) çürümüş görünüyor. ` +
          `[Soft-silinmiş joker satır INSERT'i BLOKE ediyor] user_id'ler ` +
          `(${softDeletedWildcardBlocksInsert.length}): [${softDeletedIds || '—'}] — ` +
          `(user_id, NULL, NULL) anahtarı zaten dolu (UQ PARTIAL değil), yeni ` +
          `joker satır sessizce eklenemez. Ürün sahibi kararı gerekir.`,
      );
    }

    // ── 3) Eksik satır yoksa → NO-OP, sessizce geç ────────────────────────────
    if (missing.length === 0) {
      return;
    }

    // ── 4) Eksik satırları yaz + DELTAYI ölç (dönüş değerine güvenme) ────────
    const [{ cnt: beforeCount }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt
         FROM "main"."user_scopes"
        WHERE created_by = $1`,
      [sentinel],
    );

    for (const row of missing) {
      await queryRunner.query(
        `INSERT INTO "main"."user_scopes"
           (id, tenant_id, user_id, cpl_id, category_id, is_active,
            created_at, updated_at, created_by, updated_by)
         VALUES
           (gen_random_uuid(), $1, $2, NULL, NULL, true,
            now(), now(), $3, $3)`,
        [row.tenant_id, row.user_id, sentinel],
      );
    }

    const [{ cnt: afterCount }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt
         FROM "main"."user_scopes"
        WHERE created_by = $1`,
      [sentinel],
    );

    const delta = afterCount - beforeCount;
    if (delta !== missing.length) {
      throw new Error(
        `Z30-H8 BackfillWildcardScopeForAdminFinance ASSERT başarısız: ` +
          `${missing.length} eksik kullanıcı için satır yazılması bekleniyordu, ` +
          `DELTA (created_by=sentinel önce/sonra sayımı) ${delta} çıktı. ` +
          `Migration İPTAL edildi (transaction rollback).`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const sentinel =
      BackfillWildcardScopeForAdminFinance1812000000000.MIGRATION_ACTOR_ID;

    // Yalnız bu migration'ın yazdığı (created_by = sentinel) satırlar
    // silinir. Pre-existing joker satırlara (gerçek bir admin'in
    // created_by'sini taşıyan) dokunulmaz.
    await queryRunner.query(
      `DELETE FROM "main"."user_scopes" WHERE created_by = $1`,
      [sentinel],
    );
  }
}
