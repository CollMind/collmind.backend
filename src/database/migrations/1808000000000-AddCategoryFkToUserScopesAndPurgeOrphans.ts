import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-237 — `main.user_scopes.category_id` eksik FK + öksüz satır temizliği.
 *
 * Kaynak: `.claude/backlog/tasks/T-237.md` ·
 * `docs/verification/T235_OLCUM_1_VE_3.md §2` (ölçümü doğuran yan bulgu).
 *
 * ── Kök neden ────────────────────────────────────────────────────────────────
 * `main.user_scopes` üç FK taşıyor (`cpl_id`/`tenant_id`/`user_id`, hepsi
 * `ON DELETE CASCADE`, `1779000000000-CreateUserScopes.ts`) — dördüncü kolon
 * `category_id`'nin FK'si hiç yazılmamış. Entity (`user-scope.entity.ts:41-43`)
 * `@ManyToOne(() => Category)` + `@JoinColumn` tanımlıyor, yani TypeORM bir
 * ilişki olduğunu SANIYOR; PostgreSQL onu hiç zorlamıyor. Kategori silinip
 * yeniden yaratıldığında (yeni `id`), o kategoriye bağlı `user_scopes` satırı
 * FK'siz olduğu için sessizce öksüz kalıyor.
 *
 * ── Davranışsal etki — SESSİZ ve YÖNÜ erişim kaybı ────────────────────────────
 * `R-2` (kapsam çözümleyici) fail-closed: öksüz bir `category_id` hiçbir
 * kategoriyle eşleşmez, o pair etkisiz hâle gelir. Kullanıcı hata görmez,
 * yalnız o kategoriyi kaybeder (`K-2.6.8a`'nın uyardığı "neden hiçbir plan
 * göremiyorum" support talebi).
 *
 * ── KARARLAR (ürün sahibi, 2026-08-17 — T-237 gövdesi) ────────────────────────
 * 1) `ON DELETE RESTRICT`, `CASCADE` DEĞİL. `ADR 0012`'nin gerekçesi birebir:
 *    "RESTRICT sessiz destruction'ı tespit edilebilir bir hataya çevirir."
 *    Ve `K-2.6.8a`'nın kapsam tarafı varsayılanı KISITLI yapıyor (boş kapsam =
 *    erişim yok) — `K-2.2.8d`'nin (bütçe: varsayılan CÖMERT) BİLİNÇLİ tersi.
 *    Sessiz kayıp kapsam tarafında en kötü sonuç, `CASCADE` tam onu üretirdi.
 * 2) Öksüz satırlar SİLİNİR, `NULL`'lanmaz. `category_id = NULL` `PLANNER`
 *    deseni ("her kategori") — `NULL`'lamak erişimi GENİŞLETİR. Silmek
 *    daraltır ve zaten çalışmayan bir satırı (R-2 onu fail-closed okuyor)
 *    kaldırdığı için davranışı DEĞİŞTİRMEZ.
 * 3) SIRA: SİL → SONRA FK. Ters sırada `ADD CONSTRAINT` mevcut öksüz
 *    satırlarla çakışıp migration'ı düşürür (aynı ders: `1802000000000`'ın
 *    `agreement_id` FK'si de purge'DEN SONRA eklendi).
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805`/`1802` deseni) ─────────────────
 * Silinecek öksüz sayısını BUGÜNKÜ veriye (115) sabitlemek, migration'ı yalnız
 * bugün ölçülen veritabanında çalışabilir kılar:
 *   beklenen (115)  → sil + assert
 *   0               → NO-OP, sessizce geç (taze/prod DB — bu ortamda 0 doğru,
 *                     migration'ı KALICI olarak tıkamaz)
 *   ara/beklenmeyen → İPTAL (throw, transaction rollback) — küme değişmiş,
 *                     sessizce silme YAPILMAZ
 *
 * Silme sonrası assert: main.user_scopes'ta HİÇBİR kullanıcının kalan satır
 * sayısı (category_id NULL VEYA category_id geçerli) 0 OLAMAZ. Ölçüldü
 * (2026-08-17/18, canlı dev DB): 115'in tamamı 3 CATEGORY_MANAGER'a ait, ve
 * üçünün de geçerli satırı kalıyor (2/2/1) — ama migration bugünkü veriye
 * GÜVENMEZ, ÖLÇER. Sıfıra düşen bir kullanıcı R-2 fail-closed olduğu için
 * HİÇBİR ŞEY görmez; bu durumda migration İPTAL edilir (throw), ürün sahibi
 * kararı gerekir.
 *
 * ── Entity tarafı ──────────────────────────────────────────────────────────
 * `user-scope.entity.ts`'in `@ManyToOne(() => Category)` dekoratörüne
 * `onDelete: 'RESTRICT'` VE `foreignKeyConstraintName: 'FK_user_scopes_category'`
 * eklendi — bu tablonun diğer üç FK'si (`FK_user_scopes_cpl/tenant/user`)
 * zaten okunabilir isimlendirme kullanıyor (hash DEĞİL, `1779000000000`'ın
 * elle yazdığı isimler); aynı konvansiyon `category_id` için de korunuyor, ve
 * `foreignKeyConstraintName` ile TypeORM'un hash türetmesi baştan önlendiği
 * için `migration:generate` bu FK için ne "yeni ekleme" ne "yeniden adlandırma"
 * önerir — entity ↔ katalog TAM eşit (ölçüldü, aşağıda).
 *
 * ── `T-234` kesişimi — ÖLÇÜLDÜ (2026-08-18, bu migration'dan ÖNCE) ────────────
 * Bu migration'dan önce `npm run migration:generate` çalıştırıldı (geçici
 * dosya, commit edilmedi, silindi). Drift'in İÇİNDE bu FK VARDI:
 *   `ALTER TABLE "main"."user_scopes" ADD CONSTRAINT
 *    "FK_6a9b5ce3f8b3271c498e389856b" FOREIGN KEY ("category_id")
 *    REFERENCES "main"."categories"("id") ON DELETE NO ACTION`
 * — EŞLEŞEN BİR DROP YOK (T-234'ün "212 simetrik rename" sınıfının dışında,
 * gerçek bir eksik-FK önerisi). Bu migration bu satırı KAPATIR. `T-234`
 * koştuğunda bu satır artık drift içinde GÖRÜNMEMELİDİR — kesişim çözüldü,
 * iki task aynı satırı yazmıyor (bu migration önce geldi, T-234 baseline'ı
 * ondan SONRA ölçülmeli).
 *
 * ── down() SINIRI — bilinçli ASİMETRİ (T-225 deseniyle kayıtlı) ──────────────
 * `down()` yalnızca FK'yi düşürür — SİLİNEN satırları GERİ GETİRMEZ. Bu
 * bilinçli: o satırlar zaten çalışmıyordu (`R-2` onları fail-closed
 * okuyordu), silme davranışı DEĞİŞTİRMEDİ — geri almanın veri tarafında
 * "geri alacağı" bir davranış yok.
 */

/** Öksüz satırlar: `category_id` DOLU + `main.categories`'te karşılığı YOK.
 *  Ölçüldü (2026-08-17/18): 115. Sabit sayı değil — `up()` üç durumu ayırt
 *  eder — ama bu sabit KOZMETİK DEĞİL: `up()` içinde `orphanCount ===
 *  EXPECTED_ORPHAN_COUNT` dal koşuludur, yani purge'ün koşup koşmayacağına
 *  KARAR VERİR. Ara/beklenmeyen bir sayı bu sabitle karşılaştırılarak İPTAL
 *  dalına düşer. Güncellenmesi/silinmesi davranışı değiştirir. */
const EXPECTED_ORPHAN_COUNT = 115;

const FK_NAME = 'FK_user_scopes_category';

export class AddCategoryFkToUserScopesAndPurgeOrphans1808000000000 implements MigrationInterface {
  name = 'AddCategoryFkToUserScopesAndPurgeOrphans1808000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 0) FK zaten varsa (revert edilmemiş bir tekrar koşum) — NO-OP ────────
    const existingFk: Array<{ conname: string }> = await queryRunner.query(
      `SELECT con.conname
         FROM pg_constraint con
         JOIN pg_namespace ns ON ns.oid = con.connamespace
        WHERE ns.nspname = 'main'
          AND con.conname = $1
          AND con.contype = 'f'`,
      [FK_NAME],
    );
    if (existingFk.length > 0) {
      return;
    }

    // ── 1) Öksüz satırları ölç — ÜÇ DURUM AYRIMI ──────────────────────────────
    // Öksüz = category_id DOLU + main.categories'te karşılığı YOK.
    // ⚠️ `LEFT JOIN ... IS NULL` TEK BAŞINA bir yokluk testi DEĞİLDİR —
    // category_id NULL olan (PLANNER, "her kategori") satırlar da eşleşir.
    // Doğru filtre: category_id IS NOT NULL AND c.id IS NULL (T235 ölçümünde
    // bu tuzağa iki kez düşüldü, burada aynı hataya düşülmedi).
    const [{ cnt: orphanCount }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt
         FROM "main"."user_scopes" us
         LEFT JOIN "main"."categories" c ON c.id = us.category_id
        WHERE us.category_id IS NOT NULL AND c.id IS NULL`,
    );

    if (orphanCount === 0) {
      // Taze/prod DB, ya da bu migration'ın öksüz-temizleme adımı zaten
      // uygulanmış — silinecek bir şey yok. NO-OP, FK eklemeye devam.
    } else if (orphanCount === EXPECTED_ORPHAN_COUNT) {
      // ── Assert: silme sonrası HİÇBİR kullanıcı 0 satıra düşmemeli ─────────
      // Ölçüm bugünkü veriye GÜVENMEZ — silme sonrası kalan satır sayısını
      // (category_id NULL VEYA category_id geçerli) her etkilenen kullanıcı
      // için AYRICA hesaplar.
      //
      // ⚠️ Ve ÇÖZÜMLEYİCİNİN OKUDUĞU kümeyle birebir aynı olmalı, daha geniş
      // DEĞİL (code-review bulgusu, 2026-08-18): `AccessScopeService`
      // `userScopeRepo.find({ where: { tenantId, userId, isActive: true } })`
      // ile okuyor (`access-scope.service.ts:154`), ve TypeORM `find()`
      // soft-silinmişleri dışlar (`base.entity.ts:24` `@DeleteDateColumn`).
      // `is_active`/`deleted_at` filtresi olmadan bu assert, çözümleyicinin
      // HİÇ görmediği satırları sayar — yani kullanıcı tamamen körken de
      // GEÇEBİLİR, tam olarak engellemek için var olduğu durumda.
      // Pasif satır varsayımsal değil: `seeds/user-scope.seed.ts` pasif bir
      // satırı bulup yeniden aktifleştiriyor, yani ürünün tanıdığı bir hâl.
      const zeroRowUsers: Array<{ user_id: string; remaining: number }> =
        await queryRunner.query(
          `SELECT us.user_id,
                  COUNT(*) FILTER (
                    WHERE (us.category_id IS NULL OR c.id IS NOT NULL)
                      AND us.is_active = true
                      AND us.deleted_at IS NULL
                  )::int AS remaining
             FROM "main"."user_scopes" us
             LEFT JOIN "main"."categories" c ON c.id = us.category_id
            WHERE us.user_id IN (
                    SELECT DISTINCT us2.user_id
                      FROM "main"."user_scopes" us2
                      LEFT JOIN "main"."categories" c2 ON c2.id = us2.category_id
                     WHERE us2.category_id IS NOT NULL AND c2.id IS NULL
                  )
            GROUP BY us.user_id
           HAVING COUNT(*) FILTER (
                    WHERE (us.category_id IS NULL OR c.id IS NOT NULL)
                      AND us.is_active = true
                      AND us.deleted_at IS NULL
                  ) = 0`,
        );

      if (zeroRowUsers.length > 0) {
        throw new Error(
          `T-237 AddCategoryFkToUserScopes ASSERT başarısız: öksüz satırları ` +
            `silmek ${zeroRowUsers.length} kullanıcıyı 0 kapsam satırına ` +
            `düşürüyor (user_id: ${zeroRowUsers
              .map((r) => r.user_id)
              .join(', ')}). R-2 fail-closed olduğu için bu kullanıcılar ` +
            `hiçbir şey görmez hâle gelir. Migration İPTAL edildi (transaction ` +
            `rollback). Bu bir DUR koşuludur — ürün sahibi kararı gerekir, ` +
            `sessizce silme YAPILMADI.`,
        );
      }

      const [, deletedRows] = await queryRunner.query(
        `DELETE FROM "main"."user_scopes" us
          USING (
            SELECT us2.id
              FROM "main"."user_scopes" us2
              LEFT JOIN "main"."categories" c2 ON c2.id = us2.category_id
             WHERE us2.category_id IS NOT NULL AND c2.id IS NULL
          ) orphans
         WHERE us.id = orphans.id`,
      );

      // Delta AYRICA doğrulanır (CLAUDE.md: "bir yazma işleminin dönüş
      // değeri yazdığının kanıtı değildir") — ama dönüş değeri de ATILMAZ:
      // bu sürücüde DELETE'in ikinci elemanı DETERMİNİSTİK olarak `rowCount`
      // (ölçüldü 2026-08-18: `typeorm/driver/postgres/PostgresQueryRunner.js`
      // `case "DELETE": result.raw = [raw.rows, raw.rowCount]`). İkisi
      // birlikte iki FARKLI hatayı yakalar: `afterOrphanCount` EKSİK silmeyi,
      // `deletedRows` karşılaştırması BEKLENENDEN FARKLI sayıda silmeyi.
      const [{ cnt: afterOrphanCount }]: [{ cnt: number }] =
        await queryRunner.query(
          `SELECT COUNT(*)::int AS cnt
             FROM "main"."user_scopes" us
             LEFT JOIN "main"."categories" c ON c.id = us.category_id
            WHERE us.category_id IS NOT NULL AND c.id IS NULL`,
        );

      if (afterOrphanCount !== 0) {
        throw new Error(
          `T-237 AddCategoryFkToUserScopes ASSERT başarısız: silme sonrası ` +
            `hâlâ ${afterOrphanCount} öksüz satır var (beklenen: 0). Migration ` +
            `İPTAL edildi (transaction rollback).`,
        );
      }

      if (deletedRows !== orphanCount) {
        throw new Error(
          `T-237 AddCategoryFkToUserScopes ASSERT başarısız: DELETE ` +
            `${deletedRows} satır sildi, beklenen ${orphanCount}. Küme ` +
            `silme sırasında değişmiş olabilir. Migration İPTAL edildi ` +
            `(transaction rollback).`,
        );
      }
    } else {
      throw new Error(
        `T-237 AddCategoryFkToUserScopes ASSERT başarısız: öksüz satır sayısı ` +
          `${orphanCount} (beklenen: 0 ya da ${EXPECTED_ORPHAN_COUNT}, ölçüldü ` +
          `2026-08-17/18). Küme bu veritabanında değişmiş olabilir — ara bir ` +
          `sayı otomatik silinmez. Migration İPTAL edildi (transaction ` +
          `rollback). Team Lead'e bildir, elle silme YAPMA.`,
      );
    }

    // ── 2) FK ekle — SİLME'DEN SONRA (ters sırada ADD CONSTRAINT düşer) ──────
    await queryRunner.query(
      `ALTER TABLE "main"."user_scopes"
         ADD CONSTRAINT "${FK_NAME}"
         FOREIGN KEY ("category_id")
         REFERENCES "main"."categories"("id")
         ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ Yalnız FK düşürülür. Silinen öksüz satırlar GERİ GELMEZ — bilinçli
    // asimetri (bkz. dosya başı yorumu): o satırlar zaten çalışmıyordu, R-2
    // onları fail-closed okuyordu, silme davranışı değiştirmedi.
    await queryRunner.query(
      `ALTER TABLE "main"."user_scopes" DROP CONSTRAINT IF EXISTS "${FK_NAME}"`,
    );
  }
}
