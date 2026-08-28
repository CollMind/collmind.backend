/**
 * e2e-row-count.js (CommonJS — required directly by Jest's globalSetup /
 * globalTeardown, which run in a separate process/module realm from the
 * ts-jest-transformed spec files and must NOT depend on ts-jest).
 *
 * T-047: shared DB-count logic for the suite-wide row-count invariant.
 * T-060: scope widened (approval_requests / admin_audit_logs / users) —
 * see the comment above countRows() for how this scope was determined
 * (measured, not guessed) and global-setup.js for the invariant itself.
 *
 * `T-319` (`Z59` kapsam eki, 2026-08-28) — İKİNCİ KEZ kör nokta: `Z59`
 * dalgası `notifications`'a ilk üretim yazıcısını verdi ve tam bir
 * `npm run test:e2e` koşumu `main.notifications`'ta 16 satır artık bıraktı
 * — invariant bunu YAKALAMADI çünkü `countRows()` ELLE YAZILMIŞ 7 tablo
 * sayıyordu (`notifications` listede yoktu). Dosyanın kendi yorumu
 * (aşağıdaki eski `countRows` metni, `T-060`) BUNU zaten kaydediyordu:
 * "approval_requests 9.116, plans 0 — invaryantın bütün bir tabloya kör
 * olduğunun kanıtı." Elle yazılmış bir liste, dokuzda dokuz oranla, bir
 * SONRAKİ üretim yazıcısına yine kör kalır.
 *
 * ⇒ DOĞRU DÜZELTME "notifications ekle" DEĞİL: EVREN artık `pg_catalog`'DAN
 * TÜRETİLİR — `main` şemasındaki HER `relkind='r'` tablo, bu dosyanın
 * bağlandığı role (`DB_RUNTIME_USERNAME`, aşağıda `resolveCountableTables`)
 * gerçekten `SELECT` yapabiliyorsa sayılır.
 *
 * ⛔⛔ AMA BU YARIM BİR DÜZELTMEDİR — ve bu yorumun ilk hâli TAM TERSİNİ
 * İDDİA EDİYORDU ("böylece bu sınıf ÜÇÜNCÜ KEZ doğamaz"), oysa aynı yorum
 * BLOKU 12 satır aşağıda "o tablolara yeni bir yazıcı gelirse ... invaryant
 * YİNE kör kalır" diyordu. İKİ ÇELİŞKİLİ İDDİA, TEK BLOKTA — ve manşet
 * olan, teslim edilmeyendi. (`Z58 §3` sınıfı: kısmen doğru bir güvence,
 * TAMAMEN doğru okunur. Düzeltildi 2026-08-28, Team Lead review.)
 *
 * YÜRÜRLÜKTEKİ İDDİA — dar ve ölçülmüş: evren artık ELLE YAZILMIŞ DEĞİL,
 * `app_runtime`'ın SELECT edebildiği 39 tablo için TÜRETİLMİŞTİR. Kalan
 * 9 tabloda invaryant HÂLÂ KÖRDÜR (aşağıdaki liste).
 *
 * ⚠️ VE KÖRLÜĞÜN SEBEBİ BİR ZORUNLULUK DEĞİL, GEÇERLİLİĞİNİ YİTİRMİŞ BİR
 * GEREKÇEDİR. Aşağıdaki `requireEnv` bloğu `app_runtime`'ı şöyle
 * gerekçelendiriyor: "ölçtüğü tablolar zaten uygulamanın kendisi tarafından
 * sürekli okunuyor". Bu, evren ELLE SEÇİLMİŞ UYGULAMA TABLOLARI iken
 * doğruydu; evren TÜM ŞEMAYA türetildiği an ÖNCÜLÜ KALKTI.
 * ⇒ `Z60 §1`: "bir gerekçe, dayandığı ölçümün TARİHİYLE yaşar" — ve o
 *   ölçümü değiştiren tur (BU TUR) gerekçeyi okumak zorundaydı.
 * Ölçüldü: `app_migrate` ve `app_operator` 48/48 tabloyu görüyor;
 * `DB_MIGRATE_USERNAME`/`PASSWORD` .env'de MEVCUT. Yani düzeltme elde —
 * ama sayım rolünü değiştirmek `K-2.6.13a/d` gerekçesine dokunur ve
 * tenant-kapsamı olmayan tablolar (`migrations`, `typeorm_metadata`) için
 * yeni bir sayım şekli gerektirir ⇒ AYRI TASK, hüküm bekler (`T-324`).
 *
 * ⚠️ `information_schema.tables`/`information_schema.role_table_grants`
 * DEĞİL, `pg_catalog` (`pg_class`/`pg_namespace`/`has_table_privilege`)
 * kullanılıyor — ÖLÇÜLDÜ: `information_schema.role_table_grants`,
 * `app_operator` ile sorgulandığında `app_runtime`'ın `notifications`
 * üzerindeki GERÇEK `arw` (SELECT/INSERT/UPDATE) grant'ini GÖSTERMİYOR
 * (yalnız grantor/grantee/PUBLIC görünürlüğü — Postgres kısıtı), oysa
 * `pg_class.relacl` (`has_table_privilege` üzerinden) doğru sonucu verir.
 * Bu dosyanın KENDİSİ `DB_RUNTIME_USERNAME` (`app_runtime`) ile bağlanır —
 * evren de O ROLÜN görebildiği tablolarla sınırlı olmalı, başka bir rolün
 * (ör. `app_operator`) görebildikleriyle DEĞİL; aksi hâlde bu fonksiyon
 * kendi bağlantısıyla erişemeyeceği bir tabloyu saymaya çalışıp "permission
 * denied" ile suite'i (invaryantla ilgisiz bir sebeple) kırar.
 *
 * Ölçüldü (2026-08-28, `app_operator` bağlantısıyla): `main` şemasında 48
 * `relkind='r'` tablo var; `app_runtime` bunların 39'unda `SELECT`
 * hakkına sahip (`has_table_privilege('app_runtime', oid, 'SELECT')`).
 * Erişilemeyen 9 tablo (`_t019_backfilled_tx`, `claim_matches`, `claims`,
 * `fiscal_periods`, `migrations`, `roles`, `tactic_realizations`,
 * `typeorm_metadata`, `user_role_assignments`) BİLEREK DIŞARIDA — sessizce
 * DEĞİL: `globalSetup` bu listeyi konsola BASAR (§2.5: kapsam daralması
 * sessiz olamaz). `migrations`/`typeorm_metadata` zaten şema-yönetim
 * defterleridir (kiracı verisi değil); `claims`/`claim_matches`/
 * `fiscal_periods`/`roles`/`tactic_realizations`/`user_role_assignments`
 * için bu invaryantın SESSİZCE dışarıda bıraktığı bir kapsam — o tablolara
 * yeni bir yazıcı gelirse ve `app_runtime` hâlâ `SELECT` alamıyorsa bu
 * invaryant YİNE kör kalır; bu ayrı, raporlanan bir bulgudur (bkz. task
 * raporu), bu dosyanın kapsamı değildir.
 *
 * 39 sayılabilir tablonun 38'i `tenant_id` kolonu taşıyor ve o kolonla
 * kiracıya daraltılır; `tenants`'ın kendisi (kiracı satırının bizzat
 * kendisi) `id = $1` ile sayılır. Başka hiçbir tablo bu iki şekle
 * uymuyorsa (ölçüldü: uymuyor) — uysaydı bu fonksiyon SESSİZCE atlamak
 * yerine AÇIK hata fırlatır (§2.5).
 */

const { Client } = require('pg');
require('dotenv').config();

function envOr(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

// K-2.6.13a/d: bu, `npm run test:e2e` suite'inin YALNIZ SELECT yapan bir
// ölçüm bağlantısıdır (satır sayısı invaryantı, T-047/T-060) — app_runtime
// (K-2.6.13, AC#1: "tam suite app_runtime altında yeşil") ile aynı rolü
// kullanır, çünkü ölçtüğü tablolar zaten uygulamanın kendisi tarafından
// sürekli okunuyor (envanter S3'ün kapsadığı SELECT hakları burada da
// yeterli). Sessizce 'postgres'e düşmez — eksikse AÇIK hata.
//
// Bu dosya CommonJS'tir ve ts-jest'e bağımlı OLAMAZ (bkz. dosya başı yorumu)
// — bu yüzden `src/config/db-role-env.ts`'i import EDEMEZ ve aynı
// fail-fast mantığını burada AYRI bir kopya olarak taşır. İkisi aynı
// sözleşmeyi (DB_RUNTIME_USERNAME/PASSWORD zorunlu, sessiz varsayılan yok)
// uygular — biri değişirse diğeri de gözden geçirilmeli.
function requireEnv(key) {
  const v = process.env[key];
  if (v === undefined || v === '') {
    throw new Error(
      `${key} tanımlı değil. K-2.6.13d: veritabanı bağlantı kimliği eksikse ` +
        `sessizce bir varsayılana düşülmez.`,
    );
  }
  return v;
}

function schema() {
  return envOr('DB_SCHEMA', 'main');
}

async function connect() {
  const client = new Client({
    host: envOr('DB_HOST', 'localhost'),
    port: parseInt(envOr('DB_PORT', '5432'), 10),
    user: requireEnv('DB_RUNTIME_USERNAME'),
    password: requireEnv('DB_RUNTIME_PASSWORD'),
    database: envOr('DB_DATABASE', ''),
  });
  await client.connect();
  return client;
}

/** Resolves the e2e fixture tenant id — mirrors loadE2EFixture (seed-e2e.ts). */
async function resolveFixtureTenantId(client) {
  const s = schema();
  const res = await client.query(
    `SELECT id FROM ${s}.tenants WHERE name = 'Wella Turkey' LIMIT 1`,
  );
  if (res.rows.length === 0) {
    throw new Error(
      "T-047 invariant: 'Wella Turkey' tenant not found — run `npm run seed` " +
        'before `npm run test:e2e`.',
    );
  }
  return res.rows[0].id;
}

/**
 * `T-319` — EVREN `pg_catalog`'dan türetilir (bkz. dosya başı yorumu).
 * Döner: `{ countable: [{ table, hasTenantId }], excludedNoSelect: [string] }`.
 * `client` PARAMETRESİYLE bağlanan role GÖRE (`current_user`) hesaplanır —
 * sabit bir rol adı YAZILMAZ, sorgu `has_table_privilege(current_user, ...)`
 * kullanır (bu dosyanın DB_RUNTIME_USERNAME ile bağlandığı bilinse de, rol
 * adını iki yerde tekrarlamamak için tek kaynak `current_user`).
 */
async function resolveCountableTables(client) {
  const s = schema();
  const res = await client.query(
    `SELECT c.relname AS table_name,
            EXISTS (
              SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                 AND a.attnum > 0 AND NOT a.attisdropped
            ) AS has_tenant_id,
            has_table_privilege(current_user, c.oid, 'SELECT') AS can_select
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind = 'r'
      ORDER BY c.relname`,
    [s],
  );

  const countable = [];
  const excludedNoSelect = [];
  for (const row of res.rows) {
    if (!row.can_select) {
      excludedNoSelect.push(row.table_name);
      continue;
    }
    countable.push({ table: row.table_name, hasTenantId: row.has_tenant_id });
  }
  return { countable, excludedNoSelect };
}

/**
 * `T-047`/`T-060`/`T-319` — suite-wide row-count invariant, tenant-scoped,
 * evren `pg_catalog`'dan TÜRETİLMİŞ (bkz. dosya başı yorumu — elle yazılmış
 * liste artık YOK).
 *
 * Her sayılabilir tablo için: `tenant_id` kolonu varsa `WHERE tenant_id =
 * $1`; tablo `tenants`'ın KENDİSİYSE `WHERE id = $1`; ikisi de değilse
 * (bugün ölçülen evrende YOK, ama gelecekte olabilir) — §2.5: sessizce
 * atlanmaz, AÇIK hata.
 *
 * Döner: `{ tables: { <tableName>: count }, excludedNoSelect: string[],
 * connectedAsRole: string }`.
 */
async function countRows(client, tenantId) {
  const s = schema();
  const { countable, excludedNoSelect } = await resolveCountableTables(client);

  const roleRes = await client.query('SELECT current_user AS u');
  const connectedAsRole = roleRes.rows[0].u;

  const tables = {};
  for (const { table, hasTenantId } of countable) {
    let whereClause;
    if (hasTenantId) {
      whereClause = 'tenant_id = $1';
    } else if (table === 'tenants') {
      whereClause = 'id = $1';
    } else {
      // §2.5 sessiz sıfır/atlama yasağı: bu tablo ne tenant_id taşıyor ne
      // `tenants`'ın kendisi — nasıl kiracıya daraltılacağı BİLİNMİYOR.
      // Sessizce global count almak (ya da atlamak) başka kiracıların
      // paralel test/veri yazımını bu invaryanta karıştırabilir/gizleyebilir.
      throw new Error(
        `e2e-row-count: '${table}' ne tenant_id taşıyor ne 'tenants' — ` +
          `bu tabloyu nasıl kiracıya daraltacağı bilinmiyor. Sessizce ` +
          `atlanmadı: countRows() bu tablo için AÇIKÇA ele alınmalı.`,
      );
    }
    const res = await client.query(
      `SELECT count(*)::int AS c FROM ${s}.${table} WHERE ${whereClause}`,
      [tenantId],
    );
    tables[table] = res.rows[0].c;
  }

  return { tables, excludedNoSelect, connectedAsRole };
}

module.exports = { connect, resolveFixtureTenantId, countRows };
