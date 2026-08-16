/**
 * db-role-rls-sonda.e2e-spec.ts
 *
 * K-2.6.13e (`docs/brd-v2/03_IS_KURALLARI/L2_03_onay_yetki_uyum.md`) ·
 * `_ISSUE_DB_ROLU.md` AC#2 — RLS sonda testi, KALICI SUITE'TE.
 *
 * Bu, `K-2.6.13`'ün doğuş hatasının TERSİNİ sınar: `app_runtime` gerçekten
 * RLS'e tabi mi? Ayrıcalıklı bir rol (BYPASSRLS ya da sahiplik sızıntısı)
 * için bir RLS politikası yazılsa bile SESSİZCE delinir — testler yeşil
 * geçmeye devam eder. Bu dosya, kısıtlayıcı bir deneme politikasıyla o
 * sessiz-yeşil sınıfını ilk günden yakalar (kırmızı-sonra-yeşil döngüsü
 * testin kendisidir).
 *
 * İZOLASYON (CLAUDE.md — "yan etkisi olan bir aracı izole hedefte sına"):
 * mevcut hiçbir üretim tablosuna (plans/agreements/...) dokunulmaz. Bu dosya
 * kendi ÖZEL, TEK KULLANIMLIK scratch tablosunu (`__k26613_rls_probe`)
 * `beforeAll`'da app_migrate ile yaratır, `afterAll`'da DROP TABLE ile
 * tamamen siler VE silindiğini AYRICA sorguyla doğrular (kirli durum
 * sonraki testlere sızmasın — T-047 invaryantının ruhu, farklı bir tabloda).
 * Scratch tablo T-047/T-060'ın izlediği tablolardan (agreements/plans/
 * plan_fus/plan_skus/approval_requests/admin_audit_logs/users) biri
 * DEĞİLDİR — o invaryantı hiç etkilemez.
 *
 * ÖLÇÜLMÜŞ POSTGRES DAVRANIŞI (2026-08-16, docker exec ile canlı doğrulandı
 * — bkz. task raporu): bu üç davranış koddaki iddia DEĞİL, ölçüm:
 *   1. RLS ENABLE + yalnız `AS RESTRICTIVE ... USING (false)` (permissive
 *      taban politikası YOK) → SELECT sessizce 0 satır döner (hata YOK).
 *   2. Aynı durumda INSERT → HATA fırlatır: "new row violates row-level
 *      security policy for table ...".
 *   3. Yalnız `DROP POLICY` yeterli DEĞİLDİR: RLS hâlâ ENABLED iken 0
 *      politika kalırsa varsayılan yine DENY'dir (SELECT 0 satır). Erişimin
 *      gerçekten dönmesi için `DISABLE ROW LEVEL SECURITY` da gerekir.
 *
 * MUTASYON KANITI (bu turda, elle koşuldu — task raporuna bkz.): app_runtime
 * rolüne geçici `BYPASSRLS` verildiğinde "kısıtlayıcı politika altında ...
 * GÖREMEZ" testi KIRMIZI'ya döndü (satır görünür oldu / INSERT reddedilmedi);
 * `NOBYPASSRLS`'e geri alınca tekrar YEŞİL oldu. Bu testin ayırt ettiğinin
 * kanıtı budur.
 */

import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import {
  runtimeDbCredentials,
  migrateDbCredentials,
} from '../src/config/db-role-env';

config();

const SCHEMA = process.env.DB_SCHEMA || 'main';
const PROBE_TABLE_NAME = '__k26613_rls_probe';
const PROBE_TABLE = `${SCHEMA}.${PROBE_TABLE_NAME}`;

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

describe('K-2.6.13e — RLS sonda testi (app_runtime gerçekten RLS politikalarına tabi mi)', () => {
  let adminDs: DataSource; // app_migrate — tablo sahibi, DDL yetkili (scratch tablo kurulumu)
  let runtimeDs: DataSource; // app_runtime — sondanın konusu

  beforeAll(async () => {
    adminDs = buildDataSource(migrateDbCredentials());
    runtimeDs = buildDataSource(runtimeDbCredentials());
    await adminDs.initialize();
    await runtimeDs.initialize();

    await adminDs.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    await adminDs.query(
      `CREATE TABLE ${PROBE_TABLE} (id serial primary key, marker text not null)`,
    );
    await adminDs.query(
      `INSERT INTO ${PROBE_TABLE} (marker) VALUES ('probe-row')`,
    );
    // K-2.6.13f envanteri BURAYA genişletilmez — bu geçici bir scratch tablo,
    // uygulamanın kullandığı bir tablo değil. GRANT yalnız bu testin
    // ihtiyacı kadar (SELECT/INSERT + serial PK'nin sequence'i), envanter
    // dosyasına eklenmez.
    // ÖLÇÜLDÜ: sequence GRANT'i unutulunca INSERT "permission denied for
    // sequence" ile düşüyor — RLS politikasından ÖNCE, farklı bir hata
    // sınıfı. Bu satır olmadan aşağıdaki RESTRICTIVE testi yanlış nedenle
    // (izin hatası, RLS hatası değil) geçebilirdi.
    await adminDs.query(
      `GRANT SELECT, INSERT ON ${PROBE_TABLE} TO app_runtime`,
    );
    await adminDs.query(
      `GRANT USAGE ON SEQUENCE ${SCHEMA}.${PROBE_TABLE_NAME}_id_seq TO app_runtime`,
    );
  });

  afterAll(async () => {
    try {
      if (adminDs?.isInitialized) {
        await adminDs.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
        const rows: Array<{ still_exists: boolean }> = await adminDs.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2
           ) AS still_exists`,
          [SCHEMA, PROBE_TABLE_NAME],
        );
        if (rows[0].still_exists) {
          throw new Error(
            `K-2.6.13e teardown başarısız: ${PROBE_TABLE} DROP edildikten sonra hâlâ ` +
              `pg_tables'ta görünüyor — kirli durum sonraki suite koşumlarına sızabilir.`,
          );
        }
      }
    } finally {
      if (adminDs?.isInitialized) await adminDs.destroy();
      if (runtimeDs?.isInitialized) await runtimeDs.destroy();
    }
  });

  it('baseline: RLS öncesi app_runtime scratch tablodaki satırı görür', async () => {
    const rows = await runtimeDs.query(`SELECT * FROM ${PROBE_TABLE}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].marker).toBe('probe-row');
  });

  it('kısıtlayıcı (RESTRICTIVE) politika altında app_runtime satırı GÖREMEZ ve INSERT REDDEDİLİR', async () => {
    await adminDs.query(`ALTER TABLE ${PROBE_TABLE} ENABLE ROW LEVEL SECURITY`);
    await adminDs.query(
      `CREATE POLICY k26613_probe_deny ON ${PROBE_TABLE} AS RESTRICTIVE FOR ALL USING (false)`,
    );

    // SELECT: RLS satırı sessizce filtreler — hata değil, boş sonuç kümesi.
    const rows = await runtimeDs.query(`SELECT * FROM ${PROBE_TABLE}`);
    expect(rows).toHaveLength(0);

    // INSERT: WITH CHECK açıkça verilmediği için USING (false) ona da
    // uygulanır — yeni satır politika ihlali olarak REDDEDİLİR (hata).
    await expect(
      runtimeDs.query(
        `INSERT INTO ${PROBE_TABLE} (marker) VALUES ('should-be-rejected')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('yalnız DROP POLICY yetmez — DISABLE ROW LEVEL SECURITY sonrası erişim döner', async () => {
    await adminDs.query(`DROP POLICY k26613_probe_deny ON ${PROBE_TABLE}`);

    // ÖLÇÜLDÜ: RLS hâlâ ENABLED iken 0 politika kalırsa varsayılan yine
    // DENY'dir (non-owner için) — bu ADIM bunu AÇIKÇA doğrular, varsaymaz.
    const rowsAfterDropOnly = await runtimeDs.query(
      `SELECT * FROM ${PROBE_TABLE}`,
    );
    expect(rowsAfterDropOnly).toHaveLength(0);

    await adminDs.query(
      `ALTER TABLE ${PROBE_TABLE} DISABLE ROW LEVEL SECURITY`,
    );
    const rows = await runtimeDs.query(`SELECT * FROM ${PROBE_TABLE}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].marker).toBe('probe-row');
  });
});
