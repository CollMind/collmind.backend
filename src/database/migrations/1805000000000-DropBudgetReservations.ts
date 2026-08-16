import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

/**
 * T-225 — `main.budget_reservations` ÖLÜ İSKELE'nin kaldırılması.
 *
 * Karar (architect ölçümü 2026-08-15, Team Lead bağımsız doğruladı):
 * `BudgetReservation` port edilmemiş bir yetenek değil — hiç canlanmamış bir
 * iskeledir. Kanıt (bkz. task T-225 gövdesi):
 *   - `git log -S "BudgetReservation,"` (üç ENTITIES listesi) → 0
 *   - entity SINIFINI import eden üretim kodu → 0
 *   - `INSERT INTO main.budget_reservations` → 0
 *   - `pg_stat_user_tables.n_tup_ins` → 0 (ömür boyu)
 *   - TTM'de karşılığı yok
 * Ve yaşayan yetenek zaten `budget_transactions` üzerinde append-only olarak
 * duruyor (`BudgetReservationService`, entity'yi HİÇ import etmiyor). Entity'nin
 * `PENDING` başlangıç durumu `L2 K-2.5.7`'yi ("bekleyen bir planın bütçe kaydı
 * yoktur") doğrudan ihlal eder — canlandırmak bir port değil bir kural ihlali
 * olurdu.
 *
 * `BudgetReservation` entity'si `ALL_ENTITIES`'te (src/database/entities/
 * all-entities.ts — liste 8f65826'da typeorm.config.ts'ten BURAYA taşındı)
 * KAYITLI DEĞİL — ölçüldü, grep 0 sonuç. Yani bu DROP bir `migration:generate`
 * diff'ini tetiklemez; entity dosyasına (src/database/entities/budget-reservation
 * .entity.ts) ayrıca (backend-engineer tarafından, aynı dalgada) dokunulmalı.
 *
 * ⚠️ AÇIK KALAN BAĞ (backend-engineer'a, aynı dalgada):
 * `src/database/seeds/cleanup-data.ts:63` `DELETE FROM main.budget_reservations`
 * çalıştırıyor — bu migration'dan sonra `relation does not exist` ile patlar.
 * Bu migration'ın kapsamı DEĞİL (brief: "cleanup-data.ts'e dokunma").
 *
 * ── ÜÇ DURUM AYRIMI (CLAUDE.md ZORUNLU) ───────────────────────────────────
 * Bu migration bir DROP taşıyor — tek seferlik bir şema/veri kararı. rowcount'u
 * ikiliye indirmek, migration'ı yalnız bugün ölçülen veritabanında çalışabilir
 * kılar (ADR 0012 / 1802000000000'ın dersi):
 *   tablo YOK           → no-op (zaten uygulanmış / taze DB)
 *   tablo VAR, 0 satır   → DROP + assert (beklenen — ölçüldü 2026-08-15: 0 satır,
 *                          `pg_stat_user_tables.n_tup_ins` ömür boyu 0)
 *   tablo VAR, satır VAR → İPTAL (throw) — küme değişmiş, sessizce SİLİNMEZ
 *
 * ── down() — 1704067560000 + 1802000000000'ın BİRLEŞİK sonucu ────────────
 * `down()` şemayı 1805'in up()'ından HEMEN ÖNCEKİ hâline döndürür. O hâl
 * 1704'ün literal çıktısı DEĞİL: 1802000000000 (ADR 0012 / T-188) FK'ları
 * CASCADE'den RESTRICT'e çevirdi (bkz. 1802000000000-...ts satır 1471-1483,
 * `RESTRICTED_FKS` — `budget_reservations (2)`: `FK_08b246a35bf7a2871fbedb08bbb`
 * (envelope_id) ve `FK_c4dc2a1e8e1cd03d0937b1be140` (tenant_id), ikisi de
 * `previousDeleteAction: 'CASCADE'` → RESTRICT). Ölçüldü (2026-08-15, canlı DB):
 *   `pg_constraint.confdeltype` her iki FK için de 'r' (RESTRICT) — 1704'ün
 *   CASCADE'i DEĞİL. Kolonlar/tipler/index'ler/enum 1704 ile birebir aynı
 *   (ölçüldü, `\d main.budget_reservations`); yalnız FK delete-action farklı.
 * `down()` bu yüzden RESTRICT ile kurar — 1704'ü literal kopyalamak, geri
 * alınmış şemayı 1802'nin uyguladığı ADR 0012 kararının GERİSİNE düşürürdü.
 * Index/FK adları DB'de ÖLÇÜLDÜĞÜ gibi (\d main.budget_reservations çıktısı)
 * açıkça verildi — TypeORM'un hash türetmesine bırakılmadı.
 */
export class DropBudgetReservations1805000000000 implements MigrationInterface {
  name = 'DropBudgetReservations1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SCHEMA-QUALIFIED — bu veritabanı hem `main` (CTPM) hem `public` (TTM)
    // barındırıyor (CLAUDE.md §2.6/§4.2 dersi).
    const tableExists = await queryRunner.hasTable('main.budget_reservations');

    if (!tableExists) {
      // Zaten uygulanmış (bu migration tekrar koşuyor) ya da taze bir DB
      // (tablo hiç oluşmadı). Silecek bir şey yok — no-op.
      return;
    }

    const [{ cnt: rowCount }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt FROM "main"."budget_reservations"`,
    );

    if (rowCount > 0) {
      throw new Error(
        `T-225 DropBudgetReservations ASSERT başarısız: main.budget_reservations ` +
          `${rowCount} satır taşıyor (beklenen: 0, ölçüldü 2026-08-15). Bu tablo ` +
          `"ölü iskele" kararının dayandığı ölçümle ÇELİŞİYOR — küme bu ` +
          `veritabanında değişmiş olabilir. Migration İPTAL edildi (transaction ` +
          `rollback). Team Lead'e bildir, elle silme YAPMA.`,
      );
    }

    await queryRunner.query(`DROP TABLE "main"."budget_reservations"`);

    const [{ cnt: afterCount }]: [{ cnt: number }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS cnt FROM information_schema.tables
        WHERE table_schema = 'main' AND table_name = 'budget_reservations'`,
    );
    if (afterCount !== 0) {
      // ⚠️ Bu prose'da katalog tablosu adı (information_schema/pg_*) BİLEREK
      // geçmiyor — migration-schema guard'ı her backtick literal'i taşıdığı
      // metinden bağımsız CAT deseniyle tarar (SQL/prose ayrımı yapmaz), ve
      // bu satır bir sorgu değil bir hata mesajıdır. Katalog adı yazmak
      // guard'da gerçek bir sorgu gibi yanlış-pozitif üretir (ölçüldü,
      // T-225: `npm run guards` → migration-schema 1 bulgu, satır bu cümleydi).
      throw new Error(
        `T-225 DropBudgetReservations ASSERT başarısız: DROP TABLE sonrası tablo ` +
          `hâlâ var görünüyor. Migration İPTAL edildi.`,
      );
    }

    await queryRunner.query(
      `DROP TYPE IF EXISTS "main"."budget_reservations_status_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('main.budget_reservations');
    if (tableExists) {
      // Zaten geri kurulmuş (idempotent revert) — no-op.
      return;
    }

    // K-2.6.13(c) — koşullu şema yaratma (tam gerekçe:
    // CreateTenants1704067200000, aynı görev). `CREATE SCHEMA IF NOT EXISTS`
    // PostgreSQL'de DATABASE-düzeyi CREATE iznini şemanın var olup
    // olmadığına BAKMADAN denetler; app_migrate yalnız şema-içi CREATE alır
    // (KARAR 2, scripts/db-roles/01-roles-and-ownership.sql). Sonuç aynı
    // kalır — yalnız izin denetimi şema zaten varken yolun dışına çıkar.
    // Bu satır bir down() içinde: bu revert'in şema hiç yokken çalışması
    // beklenmez (up() zaten şemayı gerektirir), ama koşul aynı sınıftan.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT FROM pg_namespace WHERE nspname = 'main'
        ) THEN
          EXECUTE 'CREATE SCHEMA main';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "main"."budget_reservations_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMMITTED', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'budget_reservations',
        schema: 'main',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'tenant_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'envelope_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'agreement_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'agreement_name',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'reserved_amount',
            type: 'decimal',
            precision: 15,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMMITTED', 'CANCELLED'],
            default: "'PENDING'",
            isNullable: false,
            enumName: 'budget_reservations_status_enum',
          },
          {
            name: 'requested_by_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'requested_by_email',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'requested_by_name',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'approved_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'approved_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejected_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'updated_by',
            type: 'uuid',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Indexes — adlar canlı DB'den ölçüldü (\d main.budget_reservations,
    // 2026-08-15), 1704'ün açık isimlendirmesiyle birebir aynı.
    await queryRunner.createIndex(
      'main.budget_reservations',
      new TableIndex({
        name: 'IDX_BUDGET_RESERVATIONS_TENANT_ENVELOPE',
        columnNames: ['tenant_id', 'envelope_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.budget_reservations',
      new TableIndex({
        name: 'IDX_BUDGET_RESERVATIONS_TENANT_STATUS',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.budget_reservations',
      new TableIndex({
        name: 'IDX_BUDGET_RESERVATIONS_TENANT_AGREEMENT',
        columnNames: ['tenant_id', 'agreement_id'],
      }),
    );

    // Foreign keys — RESTRICT (1802000000000'ın uyguladığı ADR 0012 durumu),
    // CASCADE DEĞİL (1704'ün orijinali). Adlar canlı DB'den ölçülüp açıkça
    // verildi — bkz. dosya başı yorumu.
    await queryRunner.createForeignKey(
      'main.budget_reservations',
      new TableForeignKey({
        name: 'FK_c4dc2a1e8e1cd03d0937b1be140',
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.tenants',
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'main.budget_reservations',
      new TableForeignKey({
        name: 'FK_08b246a35bf7a2871fbedb08bbb',
        columnNames: ['envelope_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'main.budget_envelopes',
        onDelete: 'RESTRICT',
      }),
    );
  }
}
