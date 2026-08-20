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
 *
 * ⚡ M-3(m-3) DÜZELTMESİ (2026-08-16, code-reviewer kapanış review'u):
 * CREATE TABLE ve ALTER TABLE testleri önceden GERÇEK isimler/tablolar
 * hedefliyordu (`main.__ac3_should_never_exist` hiçbir yerde DROP
 * edilmiyordu; `main.plans`'e — canlı, paylaşılan bir üretim tablosuna —
 * kolon ekleniyor ve o da hiç DROP edilmiyordu). İkisi de ifadenin
 * REDDEDİLECEĞİ varsayımına dayanıyordu — ama tam da bu testlerin
 * korumaya çalıştığı kapı gerilerse (regresyon), test hem KIRMIZIYA
 * dönerdi HEM DE dev DB'de bir öksüz tablo + `main.plans`'te bir öksüz
 * kolon bırakırdı (testin KENDİ yan etkisi, `db-role-rls-sonda.
 * e2e-spec.ts`nin AC#2 notundaki sınıfın aynısı).
 *
 * Düzeltme AC#2'nin İZOLASYON desenini uygular: CREATE/ALTER hedefleri artık
 * kendi TEK KULLANIMLIK scratch tabloları (`__ac3_*`), `afterAll`'da
 * KOŞULSUZ (`IF EXISTS`, test başarılı/başarısız fark etmez) DROP edilir VE
 * `pg_tables`/`information_schema` ile silindiği AYRICA doğrulanır — hâlâ
 * varsa `throw`. `main.plans`'e artık hiçbir yerde dokunulmuyor.
 *
 * ALTER TABLE hedefinin `main.plans`'ten scratch tabloya taşınmasının
 * iddiayı ZAYIFLATMADIĞI ÖLÇÜLDÜ (2026-08-16, docker exec, task raporu):
 * app_migrate sahipliğindeki bir scratch tabloda da app_runtime'ın ALTER
 * denemesi AYNI hata mesajıyla ("must be owner of table ...") reddediliyor
 * — iddia "tablo main.plans'tır" değil "tablo sahibi app_migrate'tir",
 * scratch tablo bu koşulu birebir taşıyor.
 */

import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import {
  runtimeDbCredentials,
  migrateDbCredentials,
} from '../src/config/db-role-env';

config();

const SCHEMA = process.env.DB_SCHEMA || 'main';

const CREATE_PROBE_TABLE_NAME = '__ac3_should_never_exist';
const CREATE_PROBE_TABLE = `${SCHEMA}.${CREATE_PROBE_TABLE_NAME}`;
const ALTER_PROBE_TABLE_NAME = '__ac3_alter_scratch';
const ALTER_PROBE_TABLE = `${SCHEMA}.${ALTER_PROBE_TABLE_NAME}`;
const POSITIVE_CONTROL_TABLE_NAME = '__ac3_positive_control';
const POSITIVE_CONTROL_TABLE = `${SCHEMA}.${POSITIVE_CONTROL_TABLE_NAME}`;

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
  let adminDs: DataSource; // app_migrate — yalnız scratch tablo kurulumu/temizliği için

  beforeAll(async () => {
    runtimeDs = buildDataSource(runtimeDbCredentials());
    adminDs = buildDataSource(migrateDbCredentials());
    await runtimeDs.initialize();
    await adminDs.initialize();

    // ALTER TABLE testi için: app_migrate SAHİBİ, app_runtime DEĞİL —
    // `main.plans`'in taşıdığı koşulun AYNISI, üretim şemasına dokunmadan
    // (ölçüldü: docker exec ile, dosya başlığındaki not).
    await adminDs.query(`DROP TABLE IF EXISTS ${ALTER_PROBE_TABLE}`);
    await adminDs.query(
      `CREATE TABLE ${ALTER_PROBE_TABLE} (id serial primary key)`,
    );
  });

  /** AC#2 deseni: bir scratch tablonun GERÇEKTEN silindiğini doğrula. */
  async function assertTableAbsent(tableName: string): Promise<void> {
    const rows: Array<{ still_exists: boolean }> = await adminDs.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2
       ) AS still_exists`,
      [SCHEMA, tableName],
    );
    if (rows[0].still_exists) {
      throw new Error(
        `K-2.6.13 AC#3 teardown başarısız: ${SCHEMA}.${tableName} DROP ` +
          `edildikten sonra hâlâ pg_tables'ta görünüyor — kirli durum ` +
          `sonraki suite koşumlarına sızabilir.`,
      );
    }
  }

  afterAll(async () => {
    // KOŞULSUZ temizlik: her üç scratch/probe tablosu da `IF EXISTS` ile
    // tekrar denenir — bir `it()` içindeki assertion ortada patlarsa o
    // `it()`'in KENDİ temizlik satırı hiç çalışmaz (ör. eski POZİTİF
    // KONTROL testindeki `expect(...)` → `DROP TABLE` sırası); bu blok
    // test başarılı/başarısız FARK ETMEDEN, idempotent olarak çalışır.
    // `__ac3_should_never_exist`: CREATE TABLE beklenen şekilde reddedilirse
    // app_runtime hiçbir zaman sahip olmaz ve `runtimeDs` DROP'u bir no-op'tur
    // (ÖLÇÜLDÜ: var olmayan bir tabloda `DROP TABLE IF EXISTS` Postgres'te
    // izin denetimi HİÇ ÇALIŞTIRMAZ — docker exec ile doğrulandı, task
    // raporu). Test KIRMIZIYA dönerse (guard gerilerse) beklenen sahip
    // app_runtime'dır (`runtimeDs`) — ama savunma-derinliği için `adminDs`
    // de ayrıca denenir (superuser DEĞİL ama tabloyu app_migrate
    // yaratmışsa/sahipse o da silebilir olmalı) — İKİSİ de best-effort,
    // ardından `assertTableAbsent` GERÇEĞİ doğrular.
    try {
      await runtimeDs.query(`DROP TABLE IF EXISTS ${CREATE_PROBE_TABLE}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        'AC#3 teardown (__ac3_should_never_exist, runtimeDs) best-effort:',
        e,
      );
    }
    try {
      await adminDs.query(`DROP TABLE IF EXISTS ${CREATE_PROBE_TABLE}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        'AC#3 teardown (__ac3_should_never_exist, adminDs) best-effort:',
        e,
      );
    }
    try {
      await adminDs.query(`DROP TABLE IF EXISTS ${ALTER_PROBE_TABLE}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('AC#3 teardown (__ac3_alter_scratch) best-effort:', e);
    }
    try {
      await adminDs.query(`DROP TABLE IF EXISTS ${POSITIVE_CONTROL_TABLE}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('AC#3 teardown (__ac3_positive_control) best-effort:', e);
    }

    await assertTableAbsent(CREATE_PROBE_TABLE_NAME);
    await assertTableAbsent(ALTER_PROBE_TABLE_NAME);
    await assertTableAbsent(POSITIVE_CONTROL_TABLE_NAME);

    if (runtimeDs?.isInitialized) await runtimeDs.destroy();
    if (adminDs?.isInitialized) await adminDs.destroy();
  });

  it('CREATE TABLE reddedilir — şema üstünde yalnız USAGE var, CREATE yok', async () => {
    await expect(
      runtimeDs.query(`CREATE TABLE ${CREATE_PROBE_TABLE} (id int)`),
    ).rejects.toThrow(/permission denied for schema/i);
  });

  it('ALTER TABLE reddedilir — tablo sahibi app_migrate, app_runtime değil', async () => {
    await expect(
      runtimeDs.query(
        `ALTER TABLE ${ALTER_PROBE_TABLE} ADD COLUMN __ac3_probe text`,
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

  it('envanter İÇİNDE bir tabloda, İZİNLİ OLMAYAN bir sütuna UPDATE reddedilir (user_scopes.user_id — M1, T-242a code-review)', async () => {
    // M1: `user_scopes` KOLON düzeyinde kısıtlı (created_by, updated_by,
    // is_active, updated_at) — `user_id`/`cpl_id`/`category_id` DIŞARIDA.
    // Bu tablo ÖZELLİKLE kritik: kimin NEYİ GÖRDÜĞÜNÜ tanımlıyor —
    // `app_runtime`'ın `user_id`'yi yazabilmesi bir kullanıcının kapsamını
    // BAŞKASINA taşıyabilmesi demek (`K-2.6.13f` asgari yetki).
    await expect(
      runtimeDs.query(
        `UPDATE ${SCHEMA}.user_scopes SET user_id = user_id WHERE false`,
      ),
    ).rejects.toThrow(/permission denied for table user_scopes/i);
  });

  it('POZİTİF KONTROL: aynı tabloda İZİNLİ sütuna (is_active) UPDATE reddedilmez (user_scopes)', async () => {
    const result = await runtimeDs.query(
      `UPDATE ${SCHEMA}.user_scopes SET is_active = is_active WHERE false`,
    );
    expect(result).toBeDefined();
  });

  it.each(['ledger_entries', 'admin_audit_logs', 'agreement_transactions'])(
    'K-2.6.13 KARAR 1: %s üzerinde DELETE reddedilir (defter/denetim kaydı — K-2.3.4/K-2.11.6/K-2.11.7/INV-L-003, DB seviyesinde korunur)',
    async (table) => {
      // WHERE false: yukarıdaki UPDATE testleriyle aynı desen — yalnızca
      // izin denetimini tetikler, satır değiştirmeyi amaçlamaz. Orphan
      // riski yok: 0 satır etkilenir, hiçbir nesne yaratılmaz.
      await expect(
        runtimeDs.query(`DELETE FROM ${SCHEMA}.${table} WHERE false`),
      ).rejects.toThrow(
        new RegExp(`permission denied for table ${table}`, 'i'),
      );
    },
  );

  it("POZİTİF KONTROL: DELETE hakkı BÜTÜN app_runtime'dan değil, YALNIZ bu üç tablodan kaldırıldı (agreements hâlâ DELETE edilebilir)", async () => {
    // Bir önceki testin iddiasının anlamlı olması için: DELETE verb'inin
    // app_runtime'dan TÜMÜYLE kaldırılmadığını, yalnız K-2.6.13 KARAR 1'in
    // hedeflediği üç defter/denetim tablosundan kaldırıldığını göstermek
    // gerekir — yoksa "app_runtime'ın DELETE'i genel olarak bozuk" olasılığı
    // elenmemiş olur (§2.7 — negatif sonuç, pozitif kontrolsüz raporlanamaz).
    const result = await runtimeDs.query(
      `DELETE FROM ${SCHEMA}.agreements WHERE false`,
    );
    expect(result).toBeDefined();
  });

  it('POZİTİF KONTROL: app_migrate AYNI CREATE TABLE işlemini başarıyla çalıştırabilir', async () => {
    // İzin farkının ROL'e özgü olduğunu (şemanın kendisi bozuk/erişilemez
    // olmadığını) doğrular — aynı ifade app_migrate ile başarır. Paylaşılan
    // `adminDs` kullanılır (describe-seviyesinde açık/kapalı) — temizlik
    // burada VE `afterAll`'ın koşulsuz süpürmesinde (assertion ortada
    // patlarsa diye) iki kez denenir, ikisi de idempotent.
    await adminDs.query(`CREATE TABLE ${POSITIVE_CONTROL_TABLE} (id int)`);
    const rows: Array<{ still_exists: boolean }> = await adminDs.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2
       ) AS still_exists`,
      [SCHEMA, POSITIVE_CONTROL_TABLE_NAME],
    );
    expect(rows[0].still_exists).toBe(true);
    await adminDs.query(`DROP TABLE ${POSITIVE_CONTROL_TABLE}`);
  });
});
