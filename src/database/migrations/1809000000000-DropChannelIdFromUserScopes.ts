import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-238 — `main.user_scopes.channel_id` DÜŞÜRÜLÜR (FK eklenmez).
 *
 * Kaynak: `.claude/backlog/tasks/T-238.md` · `K-2.1.4` (`L2_01:79-82`).
 *
 * ── Karar (ürün sahibi, 2026-08-18): DROP, FK değil ──────────────────────────
 * `K-2.1.4`: "Bir müşteri tam olarak bir kanala bağlıdır" — `cpls.channel_id
 * NOT NULL`, tekil FK, DB seviyesinde zorunlu. Yani kanal `cpl_id`'den
 * GARANTİLİ türetiliyor. `user_scopes.channel_id` ikinci ve ZORLANMAYAN bir
 * kaynak (`İlke 4`: "aynı olgunun iki temsili zamanla ayrışır") — ve
 * "ikisi çelişirse hangisi kazanır" sorusunun cevabı yok. `İlke 1`:
 * ihtiyaçsızlık üç yüzeyde ÖLÇÜLDÜ (kod okuyan 0 · kod yazan 0 · DB'de dolu
 * satır 0/37 — data-engineer tarafından bağımsız yeniden ölçüldü,
 * 2026-08-19, Team Lead'in sayısıyla eşleşti).
 *
 * T-237'den (migration 1808) FARKI: orada kolon DOLU olabiliyordu ve FK
 * eksikti (BÜTÜNLÜK sorunu) → FK eklendi. Burada kolon hiç okunmuyor/
 * yazılmıyor ve DB'de tamamen boş (VARLIK sorunu) → kolonun kendisi kalkıyor.
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805`/`1808` deseni) ─────────────────
 * Kolonun varlığını ve doluluğunu bugünkü DB'ye (37 satır, 0 dolu) sabitlemek
 * migration'ı yalnız bugün ölçülen veritabanında çalışabilir kılar:
 *   kolon YOK                    → NO-OP, sessizce geç (taze/prod DB, ya da
 *                                   bu migration zaten uygulanmış — tekrar
 *                                   koşum)
 *   kolon VAR, tüm satırlar NULL → DROP COLUMN
 *   kolon VAR, DOLU satır VAR    → İPTAL (throw, transaction rollback) —
 *                                   varsayım (kolon hiç kullanılmıyor) çürümüş
 *                                   demektir, ürün sahibi kararı gerekir,
 *                                   sessizce silme/görmezden gelme YAPILMAZ
 *
 * ── down() — bilinçli SİMETRİ (1808'den farkı) ───────────────────────────────
 * `down()` kolonu geri kurar (`uuid`, `nullable`). `1808`'in `down()`'ı
 * ASİMETRİKTİ (silinen satırlar geri gelmiyordu) çünkü orada VERİ siliniyordu.
 * Burada silinen bir VERİ yok — kolon `37/37 NULL`, yani geri kurulan boş
 * kolon aynı bilgiyi (hiç) taşır. Her `DROP` aynı asimetriyi üretmez; bu
 * migration'ın down()'ı tam simetrik.
 *
 * ── Entity tarafı ──────────────────────────────────────────────────────────
 * `user-scope.entity.ts`'den `channelId` @Column'u kaldırılır — `T-101`'in
 * dersi: entity'de kalan bir tanım `migration:generate`'te gerekçesiz bir
 * migration olarak geri gelir. `@ManyToOne(() => Channel)` ilişkisi YOKTU
 * (ölçüldü: düz `@Column`, entity `Channel`'ı import bile etmiyordu) — yani
 * `T-237`'nin "entity ilişkiyi tanımlıyor, PostgreSQL zorlamıyor" ayrışması
 * burada hiç doğmadı.
 *
 * ── `UQ_user_scopes_user_cpl_category` ────────────────────────────────────
 * `channel_id` içermiyor (ölçüldü: `(user_id, cpl_id, category_id)`) —
 * tekillik bu migration'dan ETKİLENMEZ.
 *
 * ── Diğer dört FK ─────────────────────────────────────────────────────────
 * `cpl` · `tenant` · `user` (CASCADE) ve `category` (RESTRICT, 1808) —
 * dokunulmuyor.
 */
export class DropChannelIdFromUserScopes1809000000000 implements MigrationInterface {
  name = 'DropChannelIdFromUserScopes1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1) Kolon var mı? ────────────────────────────────────────────────────
    const columnRows: Array<{ column_name: string; is_nullable: string }> =
      await queryRunner.query(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'main'
            AND table_name = 'user_scopes'
            AND column_name = 'channel_id'`,
      );

    if (columnRows.length === 0) {
      // Taze/prod DB, ya da bu migration zaten uygulanmış (tekrar koşum).
      // NO-OP, sessizce geç.
      return;
    }

    // ── 2) Dolu satır var mı? — ÜÇ DURUM AYRIMININ can alıcı kontrolü ───────
    const [{ cnt: filledCount }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt
         FROM "main"."user_scopes"
        WHERE channel_id IS NOT NULL`,
    );

    if (filledCount > 0) {
      throw new Error(
        `T-238 DropChannelIdFromUserScopes ASSERT başarısız: ` +
          `main.user_scopes.channel_id içinde ${filledCount} dolu satır var ` +
          `(beklenen: 0). Bu, "kolon hiç kullanılmıyor" varsayımının ` +
          `çürüdüğünü gösterir — sessizce silme YAPILMADI. Migration İPTAL ` +
          `edildi (transaction rollback). Team Lead'e bildir, ürün sahibi ` +
          `kararı gerekir (FK'ye mi çevrilmeli, yoksa dolu satırlar ayrıca ` +
          `mı ele alınmalı).`,
      );
    }

    // ── 3) Kolonu düşür ──────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "main"."user_scopes" DROP COLUMN "channel_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Kolon zaten varsa (revert edilmemiş bir tekrar koşum) — NO-OP ────────
    const columnRows: Array<{ column_name: string }> = await queryRunner.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name = 'user_scopes'
          AND column_name = 'channel_id'`,
    );
    if (columnRows.length > 0) {
      return;
    }

    // Simetrik geri kurma: silinen veri yoktu (37/37 NULL), yani boş bir
    // nullable kolon geri kurmak veri kaybını GERİ ALIR — 1808'deki gibi bir
    // asimetri burada yok.
    await queryRunner.query(
      `ALTER TABLE "main"."user_scopes" ADD COLUMN "channel_id" uuid NULL`,
    );
  }
}
