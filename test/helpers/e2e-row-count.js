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
 * ⛔ `T-324` / `Z61` — ürün sahibi HÜKMÜ = **(a)**, 2026-08-28:
 *
 *   "Sayım bağlantısı bir ÖLÇÜM-HARNESS'IDIR, ürün-yolu değil. `K-2.6.13`'ün
 *   ayrımı ('app_runtime = uygulamanın kimliği') harness'ı BAĞLAMAZ, çünkü
 *   harness uygulama değil — uygulamayı ÖLÇEN şeydir. VE ÖLÇEN ŞEYİN
 *   EVRENİ, ÖLÇÜLEN ŞEYİN YETKİSİNDEN GENİŞ OLMAK ZORUNDADIR — yoksa kapı,
 *   uygulamanın göremediği yerde doğan artığı göremez."
 *
 * ⇒ Bu dosya artık `DB_MIGRATE_USERNAME`/`PASSWORD` (`app_migrate`) ile
 * bağlanır — `app_migrate` ile burada YALNIZ `count(*)` yapılır (yapı
 * gereği SELECT-only, üretim yazma yolu YOK). `(b)` (app_runtime'a eksik
 * GRANT'ler vermek) REDDEDİLDİ: "ölçüm kolaylığı için üretim yetkisi
 * genişletilmez" (`Z61`).
 *
 * ⛔⛔ ESKİ GEREKÇE (F12 deseni — silinmez, İZİYLE ölür): aşağıdaki
 * `requireEnv` bloğunun ESKİ hâli `app_runtime`'ı şöyle gerekçelendiriyordu:
 * ~~"ölçtüğü tablolar zaten uygulamanın kendisi tarafından sürekli
 * okunuyor"~~ — bu, evren ELLE SEÇİLMİŞ UYGULAMA TABLOLARI iken doğruydu;
 * evren TÜM ŞEMAYA türetildiği an (`T-319`) ÖNCÜLÜ KALKTI (`Z60 §1`: "bir
 * gerekçe, dayandığı ölçümün TARİHİYLE yaşar"). YENİ ÖNCÜL: evren tüm-şema;
 * harness `app_migrate` ile ölçer çünkü **ölçüm-evreni ⊇ uygulama-evreni**
 * olmalı — `Z60`/`T-324`.
 *
 * ⚠️ `information_schema.tables`/`information_schema.role_table_grants`
 * DEĞİL, `pg_catalog` (`pg_class`/`pg_namespace`/`has_table_privilege`)
 * kullanılıyor — ÖLÇÜLDÜ: `information_schema.role_table_grants`,
 * `app_operator` ile sorgulandığında bir rolün gerçek `arw`
 * (SELECT/INSERT/UPDATE) grant'ini GÖSTERMEYEBİLİR (yalnız grantor/
 * grantee/PUBLIC görünürlüğü — Postgres kısıtı), oysa `pg_class.relacl`
 * (`has_table_privilege` üzerinden) doğru sonucu verir.
 *
 * Ölçüldü (2026-08-28, `T-324`, `app_operator` bağlantısıyla): `main`
 * şemasında 48 `relkind='r'` tablo var; `app_migrate` bunların **48/48**'inde
 * `SELECT` hakkına sahip (`has_table_privilege('app_migrate', oid,
 * 'SELECT')` — sıfır istisna). Evren artık YETKİ FİLTRESİ TAŞIMIYOR:
 * `resolveCountableTables()` `has_table_privilege` sorgusunu YALNIZ bir
 * DEFANSİF DOĞRULAMA olarak çalıştırır (bir gün `app_migrate`'in erişimi
 * daralırsa harness SESSİZCE küçülmez, AÇIK hata fırlatır — tam da bu
 * dosyanın kapattığı sınıfın kendisi).
 *
 * Dokuz eski kör tablonun (`_t019_backfilled_tx`, `claim_matches`,
 * `claims`, `fiscal_periods`, `migrations`, `roles`, `tactic_realizations`,
 * `typeorm_metadata`, `user_role_assignments`) SINIFLANDIRMASI (repository/
 * entity var mı, canlı `app_runtime` çağrı yolu var mı) `T-324` görev
 * raporundadır — HİÇBİRİNDE bugün `app_runtime` üzerinden GERÇEK bir
 * çağrı yolu YOK (0 `InjectRepository`), yani `(b)`'nin reddi bu tabloları
 * bugün AÇIKTA bırakmıyor; `claims` ailesi açık port-adayı (`CLAUDE.md
 * §1`) — port geldiğinde `GRANT` o dalganın checklist'inde olmalı.
 *
 * Sayılabilir 48 tablonun 44'ü `tenant_id` kolonu taşır ve o kolonla
 * kiracıya daraltılır; `tenants`'ın kendisi (kiracı satırının bizzat
 * kendisi) `id = $1` ile sayılır. Kalan 3 tablo (`migrations`,
 * `typeorm_metadata`, `_t019_backfilled_tx`) ne `tenant_id` taşır ne
 * `tenants`'tır — HAM (tenant'sız, tüm satır) sayılır: bu sayım şeklinin
 * emsali `admin_audit_logs`'un T-060'taki RAW-count kararıdır (bkz. git
 * tarihi `8b8d984`: "admin_audit_logs as a RAW count is safe … deliberately
 * … not orphan counts"). Bu üç tablo şema-yönetim/backfill defterleridir
 * (kiracı verisi TAŞIMAZLAR — `migrations`/`typeorm_metadata` TypeORM'un
 * kendi defterleri, `_t019_backfilled_tx` `T-019` backfill'inin tekil izi),
 * dolayısıyla global sabitlikleri (suite boyunca DEĞİŞMEMELİ) doğrudan
 * ölçülebilir bir invaryanttır. Başka hiçbir tablo bu üç şekle (tenant_id ·
 * `tenants` · RAW-listesi) uymuyorsa (ölçüldü: uymuyor) — uysaydı bu
 * fonksiyon SESSİZCE atlamak yerine AÇIK hata fırlatır (§2.5).
 */

const { Client } = require('pg');
require('dotenv').config();

function envOr(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

// `T-324`/`Z61` HÜKMÜ (a): bu, `npm run test:e2e` suite'inin YALNIZ SELECT
// yapan bir ÖLÇÜM-HARNESS bağlantısıdır (satır sayısı invaryantı,
// T-047/T-060/T-319/T-324) — `app_migrate` KULLANIR, `app_runtime` DEĞİL.
// ⛔ ESKİ GEREKÇE (F12 — silinmez, iziyle ölür): ~~"app_runtime (K-2.6.13,
// AC#1: 'tam suite app_runtime altında yeşil') ile aynı rolü kullanır,
// çünkü ölçtüğü tablolar zaten uygulamanın kendisi tarafından sürekli
// okunuyor"~~ — evren ELLE SEÇİLMİŞ UYGULAMA TABLOLARIYKEN doğruydu; evren
// TÜM ŞEMAYA türetildiği an (`T-319`) öncülü kalktı (dosya başı yorumu).
// K-2.6.13 AC#1 ("tam suite app_runtime altında yeşil") UYGULAMANIN
// KENDİSİNİ bağlar — bu dosya uygulama değil, uygulamayı ÖLÇEN bir
// harness'tır; harness'ın SELECT-only ölçüm bağlantısı o AC'yi ZAYIFLATMAZ
// (`Z61`). Sessizce 'postgres'e düşmez — eksikse AÇIK hata.
//
// Bu dosya CommonJS'tir ve ts-jest'e bağımlı OLAMAZ (bkz. dosya başı yorumu)
// — bu yüzden `src/config/db-role-env.ts`'i import EDEMEZ ve aynı
// fail-fast mantığını burada AYRI bir kopya olarak taşır. İkisi aynı
// sözleşmeyi (DB_MIGRATE_USERNAME/PASSWORD zorunlu, sessiz varsayılan yok)
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
    user: requireEnv('DB_MIGRATE_USERNAME'),
    password: requireEnv('DB_MIGRATE_PASSWORD'),
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
 * `T-319`/`T-324` — EVREN `pg_catalog`'dan türetilir (bkz. dosya başı
 * yorumu), **yetki filtresi YOK** (`Z61 HÜKÜM (a)`: harness `app_migrate`
 * ile bağlanır ve `app_migrate` 48/48 tabloyu görür — ölçüldü). Döner:
 * `{ countable: [{ table, hasTenantId }] }` — **tüm** `main.*` `relkind='r'`
 * tablolar, istisnasız.
 *
 * `has_table_privilege` sorgusu burada bir FİLTRE değil, bir DEFANSİF
 * DOĞRULAMADIR: `app_migrate`'in erişimi bir gün (ör. bir GRANT geri
 * alınırsa) daralırsa bu fonksiyon evreni SESSİZCE küçültmez — tam bu
 * sınıfın (`T-319`/`T-324`: "evren elle/sessizce daraldı") bir daha
 * DOĞMAMASI için AÇIK hata fırlatır. `client` PARAMETRESİYLE bağlanan role
 * GÖRE (`current_user`) hesaplanır — sabit bir rol adı YAZILMAZ.
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

  const noSelect = res.rows.filter((row) => !row.can_select);
  if (noSelect.length > 0) {
    // `Z61 HÜKÜM (a)` gerekçesi: "ÖLÇEN ŞEYİN EVRENİ, ÖLÇÜLEN ŞEYİN
    // YETKİSİNDEN GENİŞ OLMAK ZORUNDADIR" — harness'ın kendi bağlantısı
    // (app_migrate) evreni göremiyorsa bu bir ölçüm-harness regresyonudur,
    // sessizce dar bir evrenle devam edilmez (§2.5).
    throw new Error(
      `e2e-row-count: ölçüm rolünün (current_user) SELECT hakkı OLMADIĞI ` +
        `${noSelect.length} tablo var: ${noSelect
          .map((r) => r.table_name)
          .join(', ')}. T-324/Z61 hükmü ölçüm bağlantısının (app_migrate) ` +
        `TÜM main.* tablolarını görebildiğini varsayar — bu ölçüldüğünde ` +
        `(2026-08-28) 48/48'di; bu hata o varsayımın artık geçerli ` +
        `olmadığını gösterir ve harness'ın SESSİZCE daralmasını engeller.`,
    );
  }

  const countable = res.rows.map((row) => ({
    table: row.table_name,
    hasTenantId: row.has_tenant_id,
  }));
  return { countable };
}

// `T-324`/`Z61`: `main.*`'de `tenant_id` taşımayan ve `tenants`'ın kendisi
// OLMAYAN üç tablo — HAM (tüm satır, tenant scope YOK) sayılır. Emsal:
// `admin_audit_logs`'un T-060'taki RAW-count kararı (git `8b8d984`:
// "admin_audit_logs as a RAW count is safe … deliberately … not orphan
// counts"). Bu üçü kiracı VERİSİ taşımaz — `migrations`/`typeorm_metadata`
// TypeORM'un kendi şema-yönetim defterleri, `_t019_backfilled_tx` `T-019`
// backfill'inin tekil izidir; global sabitlikleri (suite boyunca
// DEĞİŞMEMELİ) doğrudan ölçülebilir bir invaryanttır. Sabit bir liste
// olması BİLEREK: bu üçü `resolveCountableTables()`'ın döndürdüğü evrenin
// bir ALT KÜMESİDİR (evrenin kendisi hâlâ pg_catalog'dan türetilir) — yeni
// bir tenant'sız tablo doğarsa aşağıdaki `else` dalı SESSİZCE atlamaz,
// AÇIK hata fırlatır (§2.5) ve bu listeye eklenmesi gerektiğini söyler.
const RAW_COUNT_NO_TENANT_TABLES = new Set([
  'migrations',
  'typeorm_metadata',
  '_t019_backfilled_tx',
]);

/**
 * `T-047`/`T-060`/`T-319`/`T-324` — suite-wide row-count invariant,
 * evren `pg_catalog`'dan TÜRETİLMİŞ (bkz. dosya başı yorumu — elle yazılmış
 * liste artık YOK), yetki filtresi YOK (`Z61`).
 *
 * Her sayılabilir tablo için: `tenant_id` kolonu varsa `WHERE tenant_id =
 * $1` (kiracıya daraltılmış); tablo `tenants`'ın KENDİSİYSE `WHERE id =
 * $1`; `RAW_COUNT_NO_TENANT_TABLES` içindeyse WHERE'SİZ (HAM, tüm satır);
 * bu üç şeklin HİÇBİRİNE uymuyorsa (bugün ölçülen evrende YOK, ama
 * gelecekte olabilir) — §2.5: sessizce atlanmaz, AÇIK hata.
 *
 * Döner: `{ tables: { <tableName>: count }, connectedAsRole: string }`.
 */
async function countRows(client, tenantId) {
  const s = schema();
  const { countable } = await resolveCountableTables(client);

  const roleRes = await client.query('SELECT current_user AS u');
  const connectedAsRole = roleRes.rows[0].u;

  const tables = {};
  for (const { table, hasTenantId } of countable) {
    let query;
    let params;
    if (hasTenantId) {
      query = `SELECT count(*)::int AS c FROM ${s}.${table} WHERE tenant_id = $1`;
      params = [tenantId];
    } else if (table === 'tenants') {
      query = `SELECT count(*)::int AS c FROM ${s}.${table} WHERE id = $1`;
      params = [tenantId];
    } else if (RAW_COUNT_NO_TENANT_TABLES.has(table)) {
      query = `SELECT count(*)::int AS c FROM ${s}.${table}`;
      params = [];
    } else {
      // §2.5 sessiz sıfır/atlama yasağı: bu tablo ne tenant_id taşıyor ne
      // `tenants`'ın kendisi ne de bilinen RAW-count listesinde — nasıl
      // sayılacağı BİLİNMİYOR. Sessizce global count almak (ya da atlamak)
      // başka kiracıların paralel test/veri yazımını bu invaryanta
      // karıştırabilir/gizleyebilir.
      throw new Error(
        `e2e-row-count: '${table}' ne tenant_id taşıyor ne 'tenants' ne de ` +
          `RAW_COUNT_NO_TENANT_TABLES listesinde — bu tabloyu nasıl ` +
          `sayacağı bilinmiyor. Sessizce atlanmadı: countRows() bu tablo ` +
          `için AÇIKÇA ele alınmalı (bkz. RAW_COUNT_NO_TENANT_TABLES).`,
      );
    }
    const res = await client.query(query, params);
    tables[table] = res.rows[0].c;
  }

  return { tables, connectedAsRole };
}

module.exports = { connect, resolveFixtureTenantId, countRows };
