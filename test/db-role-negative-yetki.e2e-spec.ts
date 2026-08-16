/**
 * db-role-negative-yetki.e2e-spec.ts
 *
 * `_ISSUE_DB_ROLU.md` AC#3 — app_runtime negatif yetki testleri:
 *   - CREATE TABLE  → reddedilir (DDL yok, şema üstünde yalnız USAGE var)
 *   - ALTER TABLE   → reddedilir (tablo sahibi app_migrate, app_runtime değil)
 *   - envanter DIŞI bir tabloya yazma → reddedilir
 *   - envanter İÇİNDE ama SÜTUN düzeyinde kısıtlı bir tabloda, izinsiz bir
 *     sütuna UPDATE → reddedilir
 *
 * Hedef seçimi ÖLÇÜLDÜ, tahmin edilmedi:
 *   - `main.fiscal_periods`: `docs/verification/DB_ROL_IZIN_ENVANTERI.md`nin
 *     35 nesnelik listesinde YOK. Doğrulama (2026-08-16):
 *       SELECT count(*) FROM information_schema.role_table_grants
 *       WHERE grantee='app_runtime' AND table_schema='main'
 *         AND table_name='fiscal_periods';  -- => 0
 *   - `main.admin_audit_logs`: envanterde YALNIZ `alert_sent` sütunu UPDATE
 *     yetkili (K-2.6.13f envanteri, 02-runtime-grants.sql). `justification`
 *     sütunu UPDATE yetkisi taşımıyor — doğrulandı
 *     (`information_schema.role_column_grants`, aynı tarih).
 *
 * Her `rejects.toThrow` iddiası bu turda `docker exec ... psql -U app_runtime`
 * ile canlı ÖLÇÜLDÜ (task raporunda tam çıktı) — hata mesajı metinleri
 * buradan alındı, tahmin edilmedi.
 */

import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import {
  runtimeDbCredentials,
  migrateDbCredentials,
} from '../src/config/db-role-env';

config();

const SCHEMA = process.env.DB_SCHEMA || 'main';

function buildDataSource(creds: {
  username: string;
  password: string;
}): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: creds.username,
    password: creds.password,
    database: process.env.DB_DATABASE,
    schema: SCHEMA,
  });
}

describe('K-2.6.13 AC#3 — app_runtime negatif yetki testleri', () => {
  let runtimeDs: DataSource;

  beforeAll(async () => {
    runtimeDs = buildDataSource(runtimeDbCredentials());
    await runtimeDs.initialize();
  });

  afterAll(async () => {
    if (runtimeDs?.isInitialized) await runtimeDs.destroy();
  });

  it('CREATE TABLE reddedilir — şema üstünde yalnız USAGE var, CREATE yok', async () => {
    await expect(
      runtimeDs.query(
        `CREATE TABLE ${SCHEMA}.__ac3_should_never_exist (id int)`,
      ),
    ).rejects.toThrow(/permission denied for schema/i);
  });

  it('ALTER TABLE reddedilir — tablo sahibi app_migrate, app_runtime değil', async () => {
    await expect(
      runtimeDs.query(
        `ALTER TABLE ${SCHEMA}.plans ADD COLUMN __ac3_probe text`,
      ),
    ).rejects.toThrow(/must be owner of table/i);
  });

  it('envanter DIŞI bir tabloya (fiscal_periods) SELECT reddedilir', async () => {
    await expect(
      runtimeDs.query(`SELECT * FROM ${SCHEMA}.fiscal_periods LIMIT 1`),
    ).rejects.toThrow(/permission denied for table fiscal_periods/i);
  });

  it('envanter İÇİNDE bir tabloda, İZİNLİ OLMAYAN bir sütuna UPDATE reddedilir (admin_audit_logs.justification)', async () => {
    // WHERE false: bu test satır değiştirmeyi amaçlamıyor, yalnız izin
    // denetimini tetikliyor — PostgreSQL sütun izinlerini WHERE
    // değerlendirilmeden ÖNCE, planlama aşamasında kontrol eder.
    await expect(
      runtimeDs.query(
        `UPDATE ${SCHEMA}.admin_audit_logs SET justification = 'x' WHERE false`,
      ),
    ).rejects.toThrow(/permission denied for table admin_audit_logs/i);
  });

  it('POZİTİF KONTROL: aynı tabloda İZİNLİ sütuna (alert_sent) UPDATE reddedilmez', async () => {
    // Bir önceki testin "reddedilir" iddiasının anlamlı olması için: aynı
    // tabloda İZİNLİ bir sütunun reddedilMEdiğini de göstermek gerekir —
    // yoksa "admin_audit_logs tablosunun tamamı zaten erişilemez" olasılığı
    // elenmemiş olur (§2.7 — negatif sonuç, pozitif kontrolsüz raporlanamaz).
    const result = await runtimeDs.query(
      `UPDATE ${SCHEMA}.admin_audit_logs SET alert_sent = true WHERE false`,
    );
    expect(result).toBeDefined();
  });

  it('POZİTİF KONTROL: app_migrate AYNI CREATE TABLE işlemini başarıyla çalıştırabilir', async () => {
    // İzin farkının ROL'e özgü olduğunu (şemanın kendisi bozuk/erişilemez
    // olmadığını) doğrular — aynı ifade app_migrate ile başarır.
    const adminDs = buildDataSource(migrateDbCredentials());
    await adminDs.initialize();
    try {
      await adminDs.query(
        `CREATE TABLE ${SCHEMA}.__ac3_positive_control (id int)`,
      );
      const rows: Array<{ still_exists: boolean }> = await adminDs.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2
         ) AS still_exists`,
        [SCHEMA, '__ac3_positive_control'],
      );
      expect(rows[0].still_exists).toBe(true);
      await adminDs.query(`DROP TABLE ${SCHEMA}.__ac3_positive_control`);
    } finally {
      await adminDs.destroy();
    }
  });
});
