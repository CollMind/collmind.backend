import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * `main.users.permissions` (ölü `jsonb` kolonu) DÜŞÜRÜLÜR — `0056-K3(b)` kararıyla:
 * **yetenekler kod, veri değil** (`docs/analysis/0056-rbac-ve-rls-tasarim-notu.md` `K3`,
 * kayıt `Z4`, `docs/brd-v2/04_KARAR_KAYDI.md`). `0056`'nın uyarısı: kolon ölü bırakılırsa
 * yetkinin **ÜÇÜNCÜ** olası yeri olarak kalır (birincisi `users.role` enum'u, ikincisi
 * `roles`/`user_role_assignments` — B dalgası S6). Bu migration onu kapatır; bir gün
 * biri bu kolonu görüp "demek ki ince taneli izin buradaydı" diye okumasın diye SİLİNİR,
 * geri EKLENMEZ.
 *
 * Kaynak görev: `.claude/backlog/tasks/T-233.md` bağlamı (`0056-K3` ikinci kararı),
 * `.claude/backlog/MIGRATION_SEQUENCE.md` satır `1806000000000`.
 *
 * Ölçüldü (Team Lead, 2026-08-16 — data-engineer bağımsız doğruladı, aynı gün):
 *   entity: `src/database/entities/user.entity.ts` `permissions?: string[]` (satır 182-183,
 *   `@Column({ type: 'jsonb', nullable: true })`) — DB ile birebir (`jsonb`, nullable,
 *   varsayılan yok, `\d main.users` ile ölçüldü).
 *   kodda OKUYAN: `grep -rn "\.permissions\b" src --include="*.ts"` → **0** sonuç
 *   (yalnız `preferences` alanı okunuyor, `permissions` hiçbir yerde tüketilmiyor).
 *   satır: `main.users` bugün **9** satır taşıyor, `permissions` sütunu **hepsinde NULL**
 *   (`SELECT count(*), count(permissions) FROM main.users` → `9, 0`).
 *
 * ⚠️ Entity'den de kaldırıldı (aynı PR, `user.entity.ts`) — yoksa bir sonraki
 * `migration:generate` bu kolonu gerekçesiz geri getirirdi (CLAUDE.md: "bir şema kararını
 * geri alırken entity metadata'sını da geri al").
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805000000000` deseni) ──────────────────────
 *   kolon YOK              → no-op (zaten uygulanmış / taze DB)
 *   kolon VAR, hepsi NULL  → DROP + assert (beklenen — ölçüldü 2026-08-16: 9 satır, 0 dolu)
 *   kolon VAR, dolu satır  → İPTAL (throw) — küme değişmiş, sessizce SİLİNMEZ. "Dolu satır"
 *                            burada tablo satırı değil, KOLONUN KENDİSİ — `users` tablosunda
 *                            zaten 9 satır var, ölçüt `permissions IS NOT NULL` sayısıdır.
 */
export class DropUsersPermissions1806000000000 implements MigrationInterface {
  name = 'DropUsersPermissions1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columnExists = await queryRunner.hasColumn(
      'main.users',
      'permissions',
    );

    if (!columnExists) {
      // Zaten uygulanmış (bu migration tekrar koşuyor) ya da taze bir DB
      // (kolon hiç oluşmadı). Silecek bir şey yok — no-op.
      return;
    }

    const [{ cnt: populatedCount }]: [{ cnt: number }] =
      await queryRunner.query(`
        SELECT COUNT(*)::int AS cnt FROM "main"."users" WHERE "permissions" IS NOT NULL;
      `);

    if (populatedCount > 0) {
      throw new Error(
        `T-233 bağlamı / DropUsersPermissions ASSERT başarısız: main.users.permissions ` +
          `${populatedCount} satırda DOLU (beklenen: 0, ölçüldü 2026-08-16: 9 satırın ` +
          `hiçbiri dolu değildi). Bu kolon "kodda okuyan 0" ölçümüne dayanarak DÜŞÜRÜLÜYOR ` +
          `— küme bu veritabanında değişmiş olabilir, ve dolu bir kolon veri kaybı riski ` +
          `taşır. Migration İPTAL edildi (transaction rollback). Team Lead'e bildir, elle ` +
          `silme YAPMA.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE "main"."users" DROP COLUMN "permissions";
    `);

    const stillExists = await queryRunner.hasColumn(
      'main.users',
      'permissions',
    );
    if (stillExists) {
      throw new Error(
        `T-233 bağlamı / DropUsersPermissions ASSERT başarısız: DROP COLUMN sonrası ` +
          `kolon hâlâ var görünüyor. Migration İPTAL edildi.`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columnExists = await queryRunner.hasColumn(
      'main.users',
      'permissions',
    );
    if (columnExists) {
      // Zaten geri kurulmuş (idempotent revert) — no-op.
      return;
    }

    // Kaynak: DB'den ölçülen orijinal tanım (`\d main.users`, 2026-08-16) —
    // `jsonb`, nullable, varsayılan yok. Index/FK yok (hiç olmadı).
    await queryRunner.addColumn(
      'main.users',
      new TableColumn({
        name: 'permissions',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }
}
