import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

/**
 * `main.role_capabilities` + `main.capabilities` DÜŞÜRÜLÜR — `0056-K3(b)` kararıyla:
 * **yetenekler kod, veri değil** (`docs/analysis/0056-rbac-ve-rls-tasarim-notu.md` `K3`,
 * kayıt `Z4`, `docs/brd-v2/04_KARAR_KAYDI.md`). `K-2.6.3` bir yetenek MODELİ istiyor —
 * ama `0056-K3(b)` o modelin YERİNİ kodda tanımlı bir sabit listeye (`const CAPABILITIES`)
 * verdi, tabloya değil. Bu tablolar geri EKLENMEZ, çünkü yorumu okuyan biri "demek ki
 * yetenek tabloları gerekiyormuş" diye yeniden yaratabilir — kural onu burada durdurmalı.
 *
 * Kaynak: `.claude/backlog/tasks/T-233.md`, `.claude/backlog/MIGRATION_SEQUENCE.md` satır
 * `1807000000000`. Yaratan migration: `1803000000000-BDalgasiSemaKalemleri.ts`
 * (`createS6RoleFamily`, "B dalgası / S6" — `T-165` ile dolacağı varsayılmıştı,
 * `0056-K3(b)` o varsayımı geçersiz kıldı).
 *
 * `roles` (`K-2.6.4`'ün beş kanonik rolü, 5 satır) VE `user_role_assignments` bu
 * migration'ın KAPSAMI DIŞINDA — karar yalnız YETENEK katmanını (`capabilities` /
 * `role_capabilities`) etkiliyor, rol katalogunu DEĞİL.
 *
 * ⚠️ DÜZELTİLMİŞ ÖLÇÜM — T-233 gövdesi ve `EK_C_VERI_SOZLUGU.md` (§"Rol ailesinin
 * verisizliği") "`Capability` entity dosyası **0**" diyor. Bu YANLIŞ ölçülmüştü: entity
 * SINIFI var — `src/database/entities/role.entity.ts` (`Role` ile aynı dosyada)
 * `@Entity({ name: 'capabilities' })  export class Capability` ve
 * `@Entity({ name: 'role_capabilities' })  export class RoleCapability` tanımlıyor, ve
 * ikisi de `all-entities.ts`'in `ALL_ENTITIES` listesinde KAYITLI (data-engineer ölçtü,
 * 2026-08-16: `grep -n "Capability\b" src/database/entities/all-entities.ts` → 2 satır,
 * `grep -rln "Capability\b|RoleCapability\b" src --include=*.ts` → yalnız `role.entity.ts`
 * + `all-entities.ts`, üretim tüketicisi 0). Yani entity pini (`typeorm.config.spec.ts`
 * "PİN: diskteki @Entity ... == ALL_ENTITIES") bu iki sınıfı GÖRÜYOR — "@Entity sınıfı
 * yok, pin onları görmez" iddiası çürüdü. Sonuç aynı (ölü yapı, düşürülmeli), ama bu
 * DROP'un `migration:generate`'i boş bırakması için `Capability`/`RoleCapability` entity
 * sınıfları da (`role.entity.ts` + `all-entities.ts`, aynı PR) KALDIRILDI — `Role` ve
 * `UserRoleAssignment` DOKUNULMADI. Team Lead'e ayrıca bildirilecek: `T-233`/`EK_C`'nin
 * "entity dosyası 0" ölçümü düzeltilmeli (`EK_C` donmuş belge — karar defteri kaydı ile).
 *
 * ── FK YÖNÜ (ölçüldü, 2026-08-16, `pg_constraint`) ────────────────────────────────────
 *   FK_capabilities_tenant           capabilities      → tenants   RESTRICT ('r')
 *   FK_role_capabilities_role        role_capabilities → roles     CASCADE  ('c')
 *   FK_role_capabilities_capability  role_capabilities → capabilities CASCADE ('c')
 *   Bu iki tabloya bağlı DIŞARIDAN FK: 0 (yalnız aralarındaki + tenants/roles'a giden).
 *   → DÜŞÜRME SIRASI: `role_capabilities` ÖNCE (capabilities'e FK ile bağlı), `capabilities`
 *     SONRA.
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU, `1805000000000` deseni) — HER TABLO İÇİN ─────
 *   tablo YOK           → no-op (zaten uygulanmış / taze DB)
 *   tablo VAR, 0 satır  → DROP + assert (beklenen — ölçüldü 2026-08-16: ikisi de 0 satır)
 *   tablo VAR, satır VAR → İPTAL (throw) — küme değişmiş, sessizce SİLİNMEZ
 */
export class DropCapabilitiesAndRoleCapabilities1807000000000 implements MigrationInterface {
  name = 'DropCapabilitiesAndRoleCapabilities1807000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1) role_capabilities ÖNCE (capabilities'e FK ile bağlı) ─────────────────────
    const roleCapabilitiesExists = await queryRunner.hasTable(
      'main.role_capabilities',
    );
    if (roleCapabilitiesExists) {
      const [{ cnt: roleCapabilitiesRowCount }]: [{ cnt: number }] =
        await queryRunner.query(`
          SELECT COUNT(*)::int AS cnt FROM "main"."role_capabilities";
        `);
      if (roleCapabilitiesRowCount > 0) {
        throw new Error(
          `T-233 DropCapabilitiesAndRoleCapabilities ASSERT başarısız: ` +
            `main.role_capabilities ${roleCapabilitiesRowCount} satır taşıyor (beklenen: ` +
            `0, ölçüldü 2026-08-16). Bu tablo "ölü yapı" kararının dayandığı ölçümle ` +
            `ÇELİŞİYOR — küme bu veritabanında değişmiş olabilir. Migration İPTAL edildi ` +
            `(transaction rollback). Team Lead'e bildir, elle silme YAPMA.`,
        );
      }
      await queryRunner.query(`DROP TABLE "main"."role_capabilities";`);
      const stillExists = await queryRunner.hasTable('main.role_capabilities');
      if (stillExists) {
        throw new Error(
          `T-233 DropCapabilitiesAndRoleCapabilities ASSERT başarısız: DROP TABLE ` +
            `sonrası main.role_capabilities hâlâ var görünüyor. Migration İPTAL edildi.`,
        );
      }
    }
    // roleCapabilitiesExists === false → zaten uygulanmış / taze DB, no-op (bu tablo için).

    // ── 2) capabilities SONRA ────────────────────────────────────────────────────────
    const capabilitiesExists = await queryRunner.hasTable('main.capabilities');
    if (capabilitiesExists) {
      const [{ cnt: capabilitiesRowCount }]: [{ cnt: number }] =
        await queryRunner.query(`
          SELECT COUNT(*)::int AS cnt FROM "main"."capabilities";
        `);
      if (capabilitiesRowCount > 0) {
        throw new Error(
          `T-233 DropCapabilitiesAndRoleCapabilities ASSERT başarısız: ` +
            `main.capabilities ${capabilitiesRowCount} satır taşıyor (beklenen: 0, ` +
            `ölçüldü 2026-08-16). Bu tablo "ölü yapı" kararının dayandığı ölçümle ` +
            `ÇELİŞİYOR — küme bu veritabanında değişmiş olabilir. Migration İPTAL edildi ` +
            `(transaction rollback). Team Lead'e bildir, elle silme YAPMA.`,
        );
      }
      await queryRunner.query(`DROP TABLE "main"."capabilities";`);
      const stillExists = await queryRunner.hasTable('main.capabilities');
      if (stillExists) {
        throw new Error(
          `T-233 DropCapabilitiesAndRoleCapabilities ASSERT başarısız: DROP TABLE ` +
            `sonrası main.capabilities hâlâ var görünüyor. Migration İPTAL edildi.`,
        );
      }
    }
    // capabilitiesExists === false → zaten uygulanmış / taze DB, no-op (bu tablo için).
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `1803000000000-BDalgasiSemaKalemleri.ts` `createS6RoleFamily`'nin `capabilities` +
    // `role_capabilities` bölümünü BİREBİR geri kurar (kolonlar/tipler/index/FK adları
    // kaynak migration'dan — ölçüldü, canlı DB ile birebir aynı, 2026-08-16). `roles` bu
    // migration'ın kapsamında OLMADIĞI için burada dokunulmaz/yaratılmaz.

    // ── capabilities ÖNCE (role_capabilities ona FK ile bağlanacak) ─────────────────
    const capabilitiesExists = await queryRunner.hasTable('main.capabilities');
    if (!capabilitiesExists) {
      await queryRunner.createTable(
        new Table({
          name: 'capabilities',
          schema: 'main',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              primaryKeyConstraintName: 'PK_capabilities',
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            { name: 'tenant_id', type: 'uuid', isNullable: false },
            {
              name: 'created_at',
              type: 'timestamp',
              default: 'now()',
              isNullable: false,
            },
            {
              name: 'updated_at',
              type: 'timestamp',
              default: 'now()',
              isNullable: false,
            },
            { name: 'deleted_at', type: 'timestamp', isNullable: true },
            { name: 'created_by', type: 'uuid', isNullable: true },
            { name: 'updated_by', type: 'uuid', isNullable: true },
            { name: 'code', type: 'varchar', length: '100', isNullable: false },
            { name: 'name', type: 'varchar', length: '200', isNullable: false },
            { name: 'description', type: 'text', isNullable: true },
          ],
        }),
        true,
      );
      await queryRunner.query(`
        CREATE UNIQUE INDEX "UQ_capabilities_tenant_code" ON "main"."capabilities" ("tenant_id", "code");
      `);
      await queryRunner.createForeignKey(
        'main.capabilities',
        new TableForeignKey({
          name: 'FK_capabilities_tenant',
          columnNames: ['tenant_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'main.tenants',
          onDelete: 'RESTRICT',
        }),
      );
    }
    // capabilitiesExists === true → zaten geri kurulmuş (idempotent revert), no-op.

    // ── role_capabilities SONRA ──────────────────────────────────────────────────────
    const roleCapabilitiesExists = await queryRunner.hasTable(
      'main.role_capabilities',
    );
    if (!roleCapabilitiesExists) {
      await queryRunner.createTable(
        new Table({
          name: 'role_capabilities',
          schema: 'main',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              primaryKeyConstraintName: 'PK_role_capabilities',
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            { name: 'tenant_id', type: 'uuid', isNullable: false },
            {
              name: 'created_at',
              type: 'timestamp',
              default: 'now()',
              isNullable: false,
            },
            {
              name: 'updated_at',
              type: 'timestamp',
              default: 'now()',
              isNullable: false,
            },
            { name: 'deleted_at', type: 'timestamp', isNullable: true },
            { name: 'created_by', type: 'uuid', isNullable: true },
            { name: 'updated_by', type: 'uuid', isNullable: true },
            { name: 'role_id', type: 'uuid', isNullable: false },
            { name: 'capability_id', type: 'uuid', isNullable: false },
          ],
        }),
        true,
      );
      await queryRunner.query(`
        CREATE UNIQUE INDEX "UQ_role_capabilities_role_capability" ON "main"."role_capabilities" ("role_id", "capability_id");
      `);
      await queryRunner.createForeignKey(
        'main.role_capabilities',
        new TableForeignKey({
          name: 'FK_role_capabilities_role',
          columnNames: ['role_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'main.roles',
          onDelete: 'CASCADE',
        }),
      );
      await queryRunner.createForeignKey(
        'main.role_capabilities',
        new TableForeignKey({
          name: 'FK_role_capabilities_capability',
          columnNames: ['capability_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'main.capabilities',
          onDelete: 'CASCADE',
        }),
      );
    }
    // roleCapabilitiesExists === true → zaten geri kurulmuş (idempotent revert), no-op.
  }
}
