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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ADIM 5 GENİŞLETMESİ (2026-08-27, `Z46 §2` + `docs/process/
 * ADIM5_RLS_KARAR_PAKETI.md` Bölüm B/2) — İKİNCİ BİR DOSYA DEĞİL, bu
 * dosyanın genişletilmesi (paket: "sonda ZATEN VAR, boşluğu tek tablo/
 * USING(false)/TEK KİRACI — GENİŞLEME bunun üstüne gelmeli").
 *
 * Yukarıdaki üç test TEK KİRACILI (`USING (false)` — herkes için deny).
 * Bu, *"iki kiracı FARKLI sonuç alır"*ı KANITLAMIYOR — yalnız *"RLS hiç
 * atlanmıyor"*u kanıtlıyor. Aşağıdaki iki `describe` bloğu bunu GERÇEK
 * iki-kiracılı bir zeminde, `tenant_id`-eşleşmeli bir politikayla kapatır:
 *
 *   1. İKİ-KİRACILI FAIL-CLOSED POLİTİKA DESENİ — `main.tenants`'a GERÇEK
 *      iki satır (emsal: `test/tenant-cross-tenant-isolation.e2e-spec.ts`),
 *      `Z46 §2`'nin ÜÇ ÇIKTISI ayrı ayrı GÖRÜLÜR: bağlamsız → 0 satır,
 *      doğru bağlam → yalnız kendi kiracısı, yanlış bağlam → 0 satır.
 *   2. BAĞLANTI DESENİ — `SET LOCAL` (`set_config(..., true)`) bir
 *      transaction DIŞINDA çağrılırsa ne olur (E1/E2'nin devamı) + TypeORM
 *      `queryRunner` ile doğru kablolanışın bir İSKELETİ (`withTenantContext`
 *      — yalnız bu test dosyasında yaşar, `src/`'e İNMEZ).
 *
 * Üçüncü `describe` (`NFR-1.2 PROBE`) taşıyıcı-mimari `ADAY`'ının maliyetini
 * SAYIYLA ölçer — `Z46 §2` Katman 2: "temsili bir okuma ucunun tx'li/tx'siz
 * p95'i ölçülmeden bu satır KARARA DÖNMEZ."
 *
 * ⛔ Bu genişletme ÜRETİM KODUNA DOKUNMAZ — politika/taşıyıcı yalnızca test
 * dosyasının kendi scratch nesnelerinde yaşar, `beforeAll`'da kurulur,
 * `afterAll`'da GERÇEKTEN silindiği doğrulanarak temizlenir (T-047
 * invaryantının izlediği tablolara — agreements/plans/plan_fus/plan_skus/
 * approval_requests/admin_audit_logs/users — HİÇ dokunulmaz; yalnız
 * `main.tenants`'a iki geçici satır ve kendi scratch tablolarımıza).
 */

import { DataSource, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  runtimeDbCredentials,
  migrateDbCredentials,
} from '../src/config/db-role-env';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

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

// ═════════════════════════════════════════════════════════════════════════
// PAYLAŞILAN YARDIMCILAR — her iki genişleme describe'ı da kullanır
// ═════════════════════════════════════════════════════════════════════════

const TENANT_PROBE_TABLE_NAME = '__k26613_rls_probe_tenant';
const TENANT_PROBE_TABLE = `${SCHEMA}.${TENANT_PROBE_TABLE_NAME}`;

/**
 * Bağlamsız/boş/NULL `app.tenant_id` HİÇBİR SATIR eşleştirmez — `Z46 §2`:
 * "bağlamsız sorgu = BOŞ KÜME, 'hepsi' DEĞİL". `CASE` kullanılıyor (düz
 * `AND`/kısa-devre'ye GÜVENİLMEDİ) çünkü boş dizgeyi `::uuid`'e CAST etmek
 * (guard olmadan) bir HATA fırlatır, sessiz-boş DEĞİL — politika şekli bunu
 * açıkça engeller.
 */
const TENANT_SCOPE_POLICY_USING = `
    CASE
      WHEN current_setting('app.tenant_id', true) IS NULL
        OR current_setting('app.tenant_id', true) = ''
      THEN false
      ELSE tenant_id = current_setting('app.tenant_id', true)::uuid
    END
`;

/**
 * TAŞIYICI-MİMARİ İSKELETİ (`Z46 §2` Katman 2, `ADAY` — ÜRETİME İNMEZ).
 *
 * İstek-kapsamlı bir transaction sarmalayıcısının NASIL kablanması
 * gerektiğini gösterir: `SET LOCAL` (`set_config(..., true)`) HER ZAMAN
 * aynı `queryRunner`/fiziksel bağlantı üzerinde, AÇIK bir transaction
 * içinde çağrılmalı. `DataSource.query()` (bare) havuzdan HER ÇAĞRIDA
 * farklı bir fiziksel bağlantı seçebilir — `E1`'in (session-`SET` fail-open)
 * kök nedeni buydu. `queryRunner.connect()` tek bir bağlantıyı REZERVE eder,
 * `startTransaction()`/`commitTransaction()`/`rollbackTransaction()` o
 * AYNI bağlantı üzerinde çalışır — `SET LOCAL`'ın taşıyıcısı bu yüzden
 * `queryRunner`, `DataSource.query()` değil.
 */
async function withTenantContext<T>(
  dataSource: DataSource,
  tenantId: string,
  fn: (queryRunner: QueryRunner) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`SELECT set_config('app.tenant_id', $1, true)`, [
      tenantId,
    ]);
    const result = await fn(queryRunner);
    await queryRunner.commitTransaction();
    return result;
  } catch (err) {
    await queryRunner.rollbackTransaction();
    throw err;
  } finally {
    await queryRunner.release();
  }
}

/** p95 — basit, sıralı-dizi tabanlı (örneklem küçük, interpolasyon gerekmiyor). */
function p95(durationsMs: number[]): number {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

// ═════════════════════════════════════════════════════════════════════════
// `describe` 2 — İKİ-KİRACILI FAIL-CLOSED POLİTİKA DESENİ (`Z46 §2` pini)
// ═════════════════════════════════════════════════════════════════════════

describe('K-2.6.13e/ADIM-5 — iki-kiracılı FAIL-CLOSED politika deseni (Z46 §2)', () => {
  let adminDs: DataSource;
  let runtimeDs: DataSource;
  let tenantAId: string;
  let tenantBId: string;
  let tenantAName: string;
  let tenantBName: string;

  beforeAll(async () => {
    adminDs = buildDataSource(migrateDbCredentials());
    runtimeDs = buildDataSource(runtimeDbCredentials());
    await adminDs.initialize();
    await runtimeDs.initialize();

    // İKİ-KİRACILI FIXTURE ŞART (ADIM 5 brief `§1`) — `main.tenants`'a
    // GERÇEK iki satır, emsal: `test/tenant-cross-tenant-isolation.
    // e2e-spec.ts`. Bu dosya HTTP katmanına inmediği (raw DB sondası)
    // için `JwtService.sign` gerekmiyor — asıl şart olan "gerçek, ayırt
    // edici iki kiracı kimliği" burada da sağlanıyor.
    tenantAName = `E2E-RLS-SONDA-TENANT-A-${Date.now()}`;
    tenantBName = `E2E-RLS-SONDA-TENANT-B-${Date.now()}`;
    const tenantARows = await adminDs.query(
      `INSERT INTO main.tenants (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [tenantAName],
    );
    const tenantBRows = await adminDs.query(
      `INSERT INTO main.tenants (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [tenantBName],
    );
    tenantAId = tenantARows[0].id;
    tenantBId = tenantBRows[0].id;

    await adminDs.query(`DROP TABLE IF EXISTS ${TENANT_PROBE_TABLE}`);
    await adminDs.query(
      `CREATE TABLE ${TENANT_PROBE_TABLE} (
         id serial primary key,
         tenant_id uuid not null,
         marker text not null
       )`,
    );
    await adminDs.query(
      `INSERT INTO ${TENANT_PROBE_TABLE} (tenant_id, marker) VALUES
         ($1, 'tenant-a-row'), ($2, 'tenant-b-row')`,
      [tenantAId, tenantBId],
    );
    await adminDs.query(`GRANT SELECT ON ${TENANT_PROBE_TABLE} TO app_runtime`);
    await adminDs.query(
      `ALTER TABLE ${TENANT_PROBE_TABLE} ENABLE ROW LEVEL SECURITY`,
    );
    // PERMISSIVE (varsayılan) — RESTRICTIVE değil; `describe` 1'in
    // `USING(false)`'ından FARKLI şekil: burada politika `tenant_id`'ye
    // GERÇEKTEN bakıyor, salt-ret değil.
    await adminDs.query(
      `CREATE POLICY k26613_tenant_scope ON ${TENANT_PROBE_TABLE}
         USING (${TENANT_SCOPE_POLICY_USING})`,
    );
  });

  afterAll(async () => {
    try {
      if (adminDs?.isInitialized) {
        await adminDs.query(`DROP TABLE IF EXISTS ${TENANT_PROBE_TABLE}`);
        const stillExists: Array<{ still_exists: boolean }> =
          await adminDs.query(
            `SELECT EXISTS (
               SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2
             ) AS still_exists`,
            [SCHEMA, TENANT_PROBE_TABLE_NAME],
          );
        if (stillExists[0].still_exists) {
          throw new Error(
            `ADIM-5 iki-kiracılı sonda teardown başarısız: ${TENANT_PROBE_TABLE} ` +
              `DROP edildikten sonra hâlâ pg_tables'ta görünüyor.`,
          );
        }

        // T-047 invaryantının izlediği tablolara HİÇ dokunulmadı (yalnız
        // `main.tenants`'a iki geçici satır) — o iki satır burada silinir,
        // silindiği AYRICA doğrulanır (kirli durum sonraki suite'lere sızmaz).
        await adminDs.query(`DELETE FROM main.tenants WHERE id IN ($1, $2)`, [
          tenantAId,
          tenantBId,
        ]);
        const remaining: Array<{ count: string }> = await adminDs.query(
          `SELECT count(*)::text AS count FROM main.tenants WHERE id IN ($1, $2)`,
          [tenantAId, tenantBId],
        );
        if (remaining[0].count !== '0') {
          throw new Error(
            `ADIM-5 iki-kiracılı sonda teardown başarısız: geçici tenant satırları ` +
              `main.tenants'ta hâlâ mevcut.`,
          );
        }
      }
    } finally {
      if (adminDs?.isInitialized) await adminDs.destroy();
      if (runtimeDs?.isInitialized) await runtimeDs.destroy();
    }
  });

  // ── ÇIKTI 1/3 — bağlamsız sorgu = BOŞ KÜME, "hepsi" DEĞİL ───────────────
  it('[YAPISAL] ÇIKTI 1/3 — bağlam SET EDİLMEDEN sorgu → 0 satır (fail-closed, "hepsi" DEĞİL)', async () => {
    const rows = await runtimeDs.query(`SELECT * FROM ${TENANT_PROBE_TABLE}`);
    expect(rows).toHaveLength(0);
  });

  // ── ÇIKTI 2/3 — doğru bağlam → YALNIZ kendi kiracısı ─────────────────────
  it('[DAVRANIŞSAL] ÇIKTI 2/3 — doğru bağlam (SET LOCAL, tx içinde, queryRunner ile) → YALNIZ kendi kiracısı', async () => {
    const rowsA = await withTenantContext(runtimeDs, tenantAId, (qr) =>
      qr.query(`SELECT * FROM ${TENANT_PROBE_TABLE}`),
    );
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].marker).toBe('tenant-a-row');

    // SİMETRİ — ters yönde de aynı sınır.
    const rowsB = await withTenantContext(runtimeDs, tenantBId, (qr) =>
      qr.query(`SELECT * FROM ${TENANT_PROBE_TABLE}`),
    );
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].marker).toBe('tenant-b-row');
  });

  // ── ÇIKTI 3/3 — yanlış bağlam → 0 satır ──────────────────────────────────
  it('[DAVRANIŞSAL] ÇIKTI 3/3 — YANLIŞ bağlam (var olmayan üçüncü kiracı) → 0 satır', async () => {
    const strangerId = randomUUID();
    const rows = await withTenantContext(runtimeDs, strangerId, (qr) =>
      qr.query(`SELECT * FROM ${TENANT_PROBE_TABLE}`),
    );
    expect(rows).toHaveLength(0);
  });

  // ── BAĞLANTI DESENİ — SET LOCAL transaction DIŞINDA çağrılırsa ──────────
  it('[DAVRANIŞSAL] `SET LOCAL` (`set_config(..., true)`) transaction DIŞINDA çağrılırsa: SESSİZ NO-OP, bağlam hiç uygulanmaz', async () => {
    // `DataSource.query()` (bare, `queryRunner` YOK) her çağrıyı kendi
    // ÖRTÜK (implicit/autocommit) transaction'ında çalıştırır. `set_config`
    // `is_local=true` ile çağrılsa bile, o örtük transaction'ın SONUNDA
    // (yani AYNI statement'ın bitişinde) geri alınır — HATA YOK, UYARI YOK
    // (ölçüldü: `docker exec collmind-tpm-postgres psql`, iki ayrı komut
    // olarak gönderildiğinde `current_setting` boş döndü).
    await runtimeDs.query(`SELECT set_config('app.tenant_id', $1, true)`, [
      tenantAId,
    ]);

    // Sonraki, AYRI bir sorgu (yeni örtük tx, havuzdan farklı fiziksel
    // bağlantı seçmiş olabilir) — bağlam UYGULANMAMIŞ olmalı. Fail-closed
    // politika sayesinde sonuç sessiz bir sızıntı DEĞİL, GÖRÜNÜR 0 satır.
    const rows = await runtimeDs.query(`SELECT * FROM ${TENANT_PROBE_TABLE}`);
    expect(rows).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// `describe` 3 — NFR-1.2 PROBE: temsili okuma ucu, tx'li/tx'siz p95
// (`Z46 §2` Katman 2 — "sayı olmadan ADAY satırı KARARA DÖNMEZ")
// ═════════════════════════════════════════════════════════════════════════

describe('ADIM-5 — NFR-1.2 PROBE (GET /budget/envelopes, tx-sarmalama maliyeti)', () => {
  let app: INestApplication;
  let admin: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // ── HTTP seviyesi — bugünkü ÜRETİM ŞEKLİ (tx sarmalama YOK) ──────────────
  it('[ÖLÇÜM] GET /budget/envelopes — p95, N koşum (bugünkü üretim şekli, tx sarmalama YOK)', async () => {
    const ITER = 30;
    const durations: number[] = [];
    for (let i = 0; i < ITER; i++) {
      const t0 = process.hrtime.bigint();
      const res = await request(app.getHttpServer())
        .get('/budget/envelopes')
        .set(admin.authHeader());
      const t1 = process.hrtime.bigint();
      expect(res.status).toBe(200);
      durations.push(Number(t1 - t0) / 1e6);
    }
    const httpP95 = p95(durations);
    // eslint-disable-next-line no-console
    console.log(
      `[NFR-1.2 PROBE] GET /budget/envelopes — N=${ITER} · p95=${httpP95.toFixed(
        2,
      )}ms (tx sarmalama YOK, bugünkü üretim şekli)`,
    );
    expect(durations).toHaveLength(ITER);
    expect(Number.isFinite(httpP95)).toBe(true);
  });

  // ── DB seviyesi — temsili sorgu, BARE vs SET-LOCAL-TX-SARILI DELTA ──────
  it("[ÖLÇÜM] findAllEnvelopes SQL'i — BARE vs SET-LOCAL-TX-SARILI p95 DELTASI, N koşum", async () => {
    const ITER = 100;
    // budget.repository.ts#findAllEnvelopes ile BİREBİR aynı sorgu şekli
    // (`this.envelopeRepository.find({ where: { tenantId }, order: {
    // createdAt: 'DESC' } })`nin ürettiği SQL).
    const sql = `SELECT * FROM main.budget_envelopes WHERE tenant_id = $1 ORDER BY created_at DESC`;
    const runtimeDataSource = app.get<DataSource>(getDataSourceToken());

    const bareDurations: number[] = [];
    for (let i = 0; i < ITER; i++) {
      const t0 = process.hrtime.bigint();
      await runtimeDataSource.query(sql, [admin.tenantId]);
      const t1 = process.hrtime.bigint();
      bareDurations.push(Number(t1 - t0) / 1e6);
    }

    const txDurations: number[] = [];
    for (let i = 0; i < ITER; i++) {
      const t0 = process.hrtime.bigint();
      await withTenantContext(runtimeDataSource, admin.tenantId, (qr) =>
        qr.query(sql, [admin.tenantId]),
      );
      const t1 = process.hrtime.bigint();
      txDurations.push(Number(t1 - t0) / 1e6);
    }

    const bareP95 = p95(bareDurations);
    const txP95 = p95(txDurations);
    // eslint-disable-next-line no-console
    console.log(
      `[NFR-1.2 PROBE] findAllEnvelopes SQL'i — N=${ITER} · ` +
        `BARE p95=${bareP95.toFixed(2)}ms · ` +
        `SET-LOCAL-TX-SARILI p95=${txP95.toFixed(2)}ms · ` +
        `DELTA=${(txP95 - bareP95).toFixed(2)}ms`,
    );
    expect(bareDurations).toHaveLength(ITER);
    expect(txDurations).toHaveLength(ITER);
    expect(Number.isFinite(bareP95)).toBe(true);
    expect(Number.isFinite(txP95)).toBe(true);
  });
});
