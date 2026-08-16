import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * UserScope entity'sini karşılayan tablo.
 *
 * PLANNER rolü yalnızca atanmış CPL+Category'leri görür; bu tablo
 * DashboardService.resolveCplScope() ve SettlementSummaryService
 * tarafından kullanılır.
 *
 * Sütunlar:
 *   id (uuid PK), tenant_id, user_id, cpl_id (nullable), category_id (nullable),
 *   channel_id (nullable), is_active, created_at, updated_at, deleted_at,
 *   created_by, updated_by
 *
 * Unique index: (user_id, cpl_id, category_id) — aynı kullanıcıya aynı
 * CPL+Category kombinasyonu iki kez atanamaz.
 *
 * FK'lar:
 *   user_id → main.users(id)  ON DELETE CASCADE
 *   cpl_id  → main.cpls(id)   ON DELETE CASCADE (nullable)
 *   tenant_id → main.tenants(id) ON DELETE CASCADE
 *
 * transaction = false: reversal/settlement migration'larıyla tutarlılık.
 */
export class CreateUserScopes1779000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // K-2.6.13(c) — koşullu şema yaratma (tam gerekçe:
    // CreateTenants1704067200000, aynı görev). `CREATE SCHEMA IF NOT EXISTS`
    // PostgreSQL'de DATABASE-düzeyi CREATE iznini şemanın var olup
    // olmadığına BAKMADAN denetler; DDL-yetkili rol yalnız şema-içi CREATE alır
    // (KARAR 2, scripts/db-roles/01-roles-and-ownership.sql). Sonuç aynı
    // kalır — yalnız izin denetimi şema zaten varken yolun dışına çıkar.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT FROM pg_namespace WHERE nspname = 'main'
        ) THEN
          EXECUTE 'CREATE SCHEMA main';
        END IF;
      END $$;
    `);

    // Tablo oluşturma (IF NOT EXISTS ile idempotent)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "main"."user_scopes" (
        "id"          uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id"   uuid         NOT NULL,
        "user_id"     uuid         NOT NULL,
        "cpl_id"      uuid         NULL,
        "category_id" uuid         NULL,
        "channel_id"  uuid         NULL,
        "is_active"   boolean      NOT NULL DEFAULT true,
        "created_at"  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at"  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at"  timestamp    NULL,
        "created_by"  uuid         NULL,
        "updated_by"  uuid         NULL,
        CONSTRAINT "PK_user_scopes" PRIMARY KEY ("id")
      );
    `);

    // Unique index: (user_id, cpl_id, category_id)
    // Partial: NULL değerler PostgreSQL'de farklı satır sayılır — NULL'ları dahil et
    const uqRows = (await queryRunner.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'main'
        AND tablename  = 'user_scopes'
        AND indexname  = 'UQ_user_scopes_user_cpl_category'
      LIMIT 1
    `)) as Array<{ indexname: string }>;

    if (uqRows.length === 0) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "UQ_user_scopes_user_cpl_category"
          ON "main"."user_scopes" ("user_id", "cpl_id", "category_id");
      `);
    }

    // tenant_id index
    const tidxRows = (await queryRunner.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'main'
        AND tablename  = 'user_scopes'
        AND indexname  = 'IDX_user_scopes_tenant_id'
      LIMIT 1
    `)) as Array<{ indexname: string }>;

    if (tidxRows.length === 0) {
      await queryRunner.query(`
        CREATE INDEX "IDX_user_scopes_tenant_id"
          ON "main"."user_scopes" ("tenant_id");
      `);
    }

    // user_id index
    const uidxRows = (await queryRunner.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'main'
        AND tablename  = 'user_scopes'
        AND indexname  = 'IDX_user_scopes_user_id'
      LIMIT 1
    `)) as Array<{ indexname: string }>;

    if (uidxRows.length === 0) {
      await queryRunner.query(`
        CREATE INDEX "IDX_user_scopes_user_id"
          ON "main"."user_scopes" ("user_id");
      `);
    }

    // FK: tenant_id → main.tenants(id)
    const tenantFkRows = (await queryRunner.query(`
      SELECT c.conname FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conname = 'FK_user_scopes_tenant'
        AND n.nspname = 'main'
      LIMIT 1
    `)) as Array<{ conname: string }>;

    if (tenantFkRows.length === 0) {
      await queryRunner.query(`
        ALTER TABLE "main"."user_scopes"
          ADD CONSTRAINT "FK_user_scopes_tenant"
          FOREIGN KEY ("tenant_id")
          REFERENCES "main"."tenants"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      `);
    }

    // FK: user_id → main.users(id)
    const userFkRows = (await queryRunner.query(`
      SELECT c.conname FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conname = 'FK_user_scopes_user'
        AND n.nspname = 'main'
      LIMIT 1
    `)) as Array<{ conname: string }>;

    if (userFkRows.length === 0) {
      await queryRunner.query(`
        ALTER TABLE "main"."user_scopes"
          ADD CONSTRAINT "FK_user_scopes_user"
          FOREIGN KEY ("user_id")
          REFERENCES "main"."users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      `);
    }

    // FK: cpl_id → main.cpls(id) — nullable, CASCADE
    const cplFkRows = (await queryRunner.query(`
      SELECT c.conname FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conname = 'FK_user_scopes_cpl'
        AND n.nspname = 'main'
      LIMIT 1
    `)) as Array<{ conname: string }>;

    if (cplFkRows.length === 0) {
      await queryRunner.query(`
        ALTER TABLE "main"."user_scopes"
          ADD CONSTRAINT "FK_user_scopes_cpl"
          FOREIGN KEY ("cpl_id")
          REFERENCES "main"."cpls"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."user_scopes"
        DROP CONSTRAINT IF EXISTS "FK_user_scopes_cpl";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."user_scopes"
        DROP CONSTRAINT IF EXISTS "FK_user_scopes_user";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."user_scopes"
        DROP CONSTRAINT IF EXISTS "FK_user_scopes_tenant";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "main"."IDX_user_scopes_user_id";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "main"."IDX_user_scopes_tenant_id";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "main"."UQ_user_scopes_user_cpl_category";
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "main"."user_scopes";
    `);
  }
}
