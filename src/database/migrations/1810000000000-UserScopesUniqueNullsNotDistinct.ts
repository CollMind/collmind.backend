import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [[T-245]] / `T-242a` `B1` — `UQ_user_scopes_user_cpl_category` NULL'ları AYIRT
 * EDİYORDU, ayırt ETMEMELİYDİ.
 *
 * Kaynak: `.claude/backlog/tasks/T-245.md` (varsa) · code-review bulgusu
 * (canlı katalogdan ölçüldü, `data-engineer` tarafından bağımsız
 * doğrulandı 2026-08-20).
 *
 * ── Kusur ────────────────────────────────────────────────────────────────
 * `1779000000000-CreateUserScopes.ts`'in kurduğu
 * `UNIQUE (user_id, cpl_id, category_id)` düz bir btree UNIQUE index —
 * PostgreSQL'de NULL'lar birbirinden AYRI sayılır, yani aynı `(user_id,
 * cpl_id, NULL)` çifti sınırsız kez tekrar yazılabilir ve index hiç
 * ateşlemez. Ölçüldü (transaction + ROLLBACK, gerçek satır bırakmadan):
 *
 *   (user, cpl, NULL) x2   → ihlal YOK (index NULL'ı `DISTINCT` sayıyor)
 *   (user, NULL, cat) x2   → ihlal YOK
 *   POZ.KONTROL (user, cpl, cat) x2 → 23505 duplicate key (desen ÇALIŞIYOR,
 *   yalnız NULL içeren çiftlerde ATEŞLEMİYOR)
 *
 * `R1`/`A5` (`user-scope.entity.ts` `WILDCARD_ON_CREATE_ROLES` /
 * `SCOPE_REQUIRED_ROLES`) gereği her `CATEGORY_MANAGER` çifti `cplId=null`,
 * her `PLANNER` çifti `categoryId=null` taşır — yani bu kuralın kapsaması
 * gereken çiftlerin EZİCİ ÇOĞUNLUĞUNDA index bugüne kadar hiç ateşlememiş.
 *
 * ── Karar (ürün sahibi, 2026-08-20) ─────────────────────────────────────
 * `NULLS NOT DISTINCT` (PG15+; bu instance 16.13, `SHOW server_version`
 * ile ölçüldü). Emsal: `budget_policies` (`1803000000000`,
 * `budget-policy.entity.ts` — `K-2.2.8b`) AYNI deseni kullanıyor: ham SQL
 * ile `CREATE UNIQUE INDEX ... NULLS NOT DISTINCT`, entity tarafında
 * `@Index` TANIMLANMIYOR (TypeORM dekoratörü `NULLS NOT DISTINCT`'i ifade
 * edemiyor — tanımlansaydı `migration:generate` standart bir UNIQUE INDEX
 * önerip bu klozu kaybederdi). `COALESCE(...)` ifade index'i alternatifti
 * ve reddedildi: sentinel UUID seçimi ek bir ürün kararı gerektirir,
 * `NULLS NOT DISTINCT` repoda zaten kanıtlanmış bir desendir (`İlke 4`:
 * aynı problem iki kez farklı çözülmesin).
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805`/`1808`/`1809` deseni) ────────
 *   index YOK                         → NO-OP (taze/prod DB ya da bu
 *                                        migration zaten başka biçimde
 *                                        uygulanmış — tekrar koşum)
 *   index VAR, zaten NULLS NOT
 *   DISTINCT                          → NO-OP (tekrar koşum, up() daha önce
 *                                        tamamlanmış)
 *   index VAR, DÜZ UNIQUE, YENİ
 *   semantikte (NULL'lar EŞİT) hiç
 *   yinelenen YOK                     → DROP + CREATE (NULLS NOT DISTINCT)
 *   index VAR, DÜZ UNIQUE, YENİ
 *   semantikte yinelenen VAR          → İPTAL (throw, transaction
 *                                        rollback) — temizlik AYRI bir
 *                                        karardır, sessizce silinmez
 *
 * Canlı DB'de bugün (2026-08-20) ölçüldü: eski semantikte (`GROUP BY
 * user_id, cpl_id, category_id HAVING count(*) > 1`) 0 grup; pozitif kontrol
 * (`HAVING count(*) > 0`) 37 grup — sorgu çalışıyor, filtre gerçekten
 * eleniyor. `GROUP BY` PostgreSQL'de NULL'ları eşit sayar (WHERE
 * eşitliğinden farklı olarak) — yani bu sorgu zaten YENİ semantiği ölçüyor,
 * ayrıca `COALESCE` sentinel'ine gerek yok.
 *
 * ── Entity tarafı ────────────────────────────────────────────────────────
 * `user-scope.entity.ts`'teki `@Index(['userId','cplId','categoryId'],
 * {unique:true})` KALDIRILDI — `budget-policy.entity.ts` ile aynı gerekçe:
 * TypeORM `NULLS NOT DISTINCT`'i temsil edemiyor, tanım kalsaydı
 * `migration:generate` bunu standart bir UNIQUE INDEX'e "düzeltmeyi"
 * önerirdi (`T-101` dersi).
 *
 * ── `updateScope`'un reaktivasyon gerekçesiyle kesişim (ÖLÇÜLDÜ) ─────────
 * `user.service.ts#updateScope` (satır ~453-461) reaktivasyon yapıyor
 * ÇÜNKÜ index PARTIAL DEĞİL (`is_active` koşulu yok) — yani bir satırı
 * `isActive=false` yapmak o anahtarı yeniden kullanılabilir kılmıyor, aynı
 * çifti tekrar hedef kümeye koymak bir INSERT ile çakışıyor. Bu migration
 * index'in PARTIAL'lığını DEĞİŞTİRMİYOR (hâlâ tüm satırları, aktif/pasif
 * fark etmeksizin kapsıyor) — yalnız NULL semantiğini değiştiriyor. Kod
 * zaten NULL'ları uygulama katmanında EŞİT sayıyordu (`targetKey`,
 * `cplId ?? 'NULL'` / `categoryId ?? 'NULL'` string birleştirmesi) — yani
 * DB kısıtı, uygulamanın zaten varsaydığı semantiğe UYUMLU hâle geliyor;
 * reaktivasyon akışı davranış değiştirmiyor.
 *
 * ── `T-234` (migration:generate drift) kesişimi ─────────────────────────
 * `migration:generate` çıktısı bu migration'dan SONRA bu index'e dair
 * hiçbir satır önermiyor (aşağıda ölçüldü ve raporlandı) — entity/katalog
 * tam eşit.
 */
export class UserScopesUniqueNullsNotDistinct1810000000000 implements MigrationInterface {
  name = 'UserScopesUniqueNullsNotDistinct1810000000000';

  private static readonly INDEX_NAME = 'UQ_user_scopes_user_cpl_category';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1) Index bugün var mı, ve varsa NULLS NOT DISTINCT mi? ──────────────
    const idxRows: Array<{ indnullsnotdistinct: boolean }> =
      await queryRunner.query(
        `SELECT i.indnullsnotdistinct
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'main'
            AND c.relname = '${UserScopesUniqueNullsNotDistinct1810000000000.INDEX_NAME}'`,
      );

    if (idxRows.length === 0) {
      // Index yok — taze/prod DB, ya da bu migration zaten (farklı bir
      // yoldan) uygulanmış. NO-OP, sessizce geç.
      return;
    }

    if (idxRows[0].indnullsnotdistinct === true) {
      // Zaten doğru semantikte — tekrar koşum. NO-OP.
      return;
    }

    // ── 2) YENİ semantikte (NULL'lar EŞİT) yinelenen satır var mı? ──────────
    // GROUP BY PostgreSQL'de NULL'ları eşit sayar (WHERE eşitliğinden
    // farklı olarak) — bu sorgu zaten hedef semantiği ölçüyor.
    const [{ cnt: dupGroups }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt FROM (
         SELECT user_id, cpl_id, category_id
           FROM "main"."user_scopes"
          GROUP BY user_id, cpl_id, category_id
         HAVING COUNT(*) > 1
       ) t`,
    );

    if (dupGroups > 0) {
      throw new Error(
        `T-245 UserScopesUniqueNullsNotDistinct ASSERT başarısız: ` +
          `main.user_scopes'ta YENİ semantikte (NULL'lar eşit) ${dupGroups} ` +
          `yinelenen (user_id, cpl_id, category_id) grubu var (beklenen: 0). ` +
          `Bu, "bugün yineleme yok" varsayımının çürüdüğünü gösterir — ` +
          `sessizce silme YAPILMADI. Migration İPTAL edildi (transaction ` +
          `rollback). Team Lead'e bildir: yinelenenlerin temizliği AYRI bir ` +
          `karar gerektirir (hangi satır kalır, hangisi silinir — ürün ` +
          `sahibi kararı).`,
      );
    }

    // ── 3) Düz UNIQUE'i NULLS NOT DISTINCT ile değiştir ──────────────────────
    await queryRunner.query(
      `DROP INDEX "main"."${UserScopesUniqueNullsNotDistinct1810000000000.INDEX_NAME}"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${UserScopesUniqueNullsNotDistinct1810000000000.INDEX_NAME}"
         ON "main"."user_scopes" ("user_id", "cpl_id", "category_id")
         NULLS NOT DISTINCT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const idxRows: Array<{ indnullsnotdistinct: boolean }> =
      await queryRunner.query(
        `SELECT i.indnullsnotdistinct
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'main'
            AND c.relname = '${UserScopesUniqueNullsNotDistinct1810000000000.INDEX_NAME}'`,
      );

    if (idxRows.length === 0) {
      // Index yok (revert edilmemiş bir başka değişiklik ya da tekrar
      // koşum) — NO-OP.
      return;
    }

    if (idxRows[0].indnullsnotdistinct === false) {
      // Zaten düz UNIQUE — tekrar koşum. NO-OP.
      return;
    }

    // Simetrik geri kurma: NULLS NOT DISTINCT daha KATI bir kısıttır (daha
    // az satıra izin verir) — ona uyan her veri kümesi, daha gevşek olan
    // düz UNIQUE'e de otomatik uyar. Geri dönüş asla veri kaybı üretmez.
    await queryRunner.query(
      `DROP INDEX "main"."${UserScopesUniqueNullsNotDistinct1810000000000.INDEX_NAME}"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${UserScopesUniqueNullsNotDistinct1810000000000.INDEX_NAME}"
         ON "main"."user_scopes" ("user_id", "cpl_id", "category_id")`,
    );
  }
}
