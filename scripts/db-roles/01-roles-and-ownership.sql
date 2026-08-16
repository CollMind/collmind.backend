-- K-2.6.13a / K-2.6.13b / K-2.6.13c — idempotent rol + sahiplik kurulumu.
--
-- Bu bir MIGRATION DEĞİLDİR: roller küme-yönetimi nesnesidir, şema geçmişi
-- değil (K-2.6.13c). `../db-roles-setup.sh` tarafından bir SUPERUSER
-- bağlantısıyla çalıştırılır (docker exec ile yerel soket → `trust` auth,
-- ya da TCP modunda DB_ADMIN_PASSWORD ile). Tekrar çalıştırmak güvenlidir.
--
-- psql değişkenleri (çağıran script `-v` ile geçirir):
--   :'runtime_pw'   app_runtime parolası (SQL string literal olarak substitute edilir)
--   :'migrate_pw'   app_migrate parolası
--   :"schema"       hedef şema (identifier olarak substitute edilir, örn. main)

\set ON_ERROR_STOP on

-- ⚠️ psql `:'var'`/`:"var"` ikamesi $$...$$ (dollar-quoted) blokların İÇİNDE
-- ÇALIŞMAZ — psql bunu tek-tırnaklı bir string gibi ele alır ve ikame
-- yapmaz (ölçüldü: `DO $$ ... :'pw' ... $$;` "syntax error at or near :"
-- verdi). Bu yüzden aşağıda iki farklı teknik var: (a) rol create/alter
-- için üst seviyede `format()` + `\gexec` — DO bloğu YOK; (b) sahiplik
-- devri için DO bloğunun TAMAMI önce `format()` ile metin olarak kurulup
-- `\gexec` ile çalıştırılıyor, `:'schema'` ikamesi $$ açılmadan ÖNCE oluyor.

-- 1) app_runtime — DML, RLS'e TABİ, DDL yok, BYPASSRLS yok, hiçbir nesnenin
--    sahibi değil. Başlangıç GRANT'i burada YOK — izinler
--    02-runtime-grants.sql'den (ölçülmüş envanter) gelir.
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime')
    THEN format('ALTER ROLE app_runtime WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION', :'runtime_pw')
    ELSE format('CREATE ROLE app_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION', :'runtime_pw')
  END AS ddl
\gexec

-- 2) app_migrate — DDL yetkili VE tablo sahibi (K-2.6.13b). Ayrı bir
--    `app_owner` TANIMLANMAZ — bu bir tercih değil, kapalı bir karar
--    (`_ISSUE_DB_ROLU.md` düzeltme notu, 2026-08-15). Runtime bağlantı
--    dizgesinde ASLA kullanılmaz (K-2.6.13a) — bu, kod tarafında
--    (`src/config/db-role-env.ts`) ayrı env değişkenleriyle zorlanır, DB
--    burada iki rolü ayırt edemez.
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrate')
    THEN format('ALTER ROLE app_migrate WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION', :'migrate_pw')
    ELSE format('CREATE ROLE app_migrate LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION', :'migrate_pw')
  END AS ddl
\gexec

-- 3) Şema düzeyi haklar. app_migrate şemada nesne yaratabilir (CREATE);
--    app_runtime yalnız var olan nesnelere erişebilir (USAGE) — CREATE YOK.
--    Bunlar üst seviyede (DO/$$ içinde DEĞİL) — `:"schema"` burada çalışır.
GRANT USAGE, CREATE ON SCHEMA :"schema" TO app_migrate;
GRANT USAGE ON SCHEMA :"schema" TO app_runtime;

-- ⚠️ 3b — B1/B2/M1'İN DIŞINDA, bu turda TESADÜFEN ölçülmüş DÖRDÜNCÜ bir
--    bulgu (Team Lead'e raporlandı, henüz ONAYLI DEĞİL — bu yüzden burada
--    AKTİF bir GRANT YOK, yalnız ölçüm notu):
--
--    `CREATE SCHEMA IF NOT EXISTS "main"` (`CreateTenants1704067200000`,
--    göç zincirinin İLK adımı) — şema ZATEN VARKEN bile (docker/
--    init-schema.sql onu superuser'la önceden yaratmış olsa dahi) bu
--    ifade DATABASE düzeyinde CREATE ister; şema-düzeyi CREATE (#3
--    yukarısı) bunu KARŞILAMIYOR. Ölçüldü (izole, tek kullanımlık
--    container — gerçek dev DB'ye dokunulmadı):
--      app_migrate: CREATE SCHEMA IF NOT EXISTS "main" → permission denied
--                   for database ‹db›  (schema zaten vardı, no-op OLACAKTI)
--      app_migrate: CREATE TABLE main.x (...)          → başarılı (§3 yeterli)
--    Gerçek dev DB'de bu görünmüyor çünkü o migration zaten `app_migrate`
--    var olmadan önce (superuser'la) uygulanmıştı — ölçüldü:
--    `has_database_privilege('app_migrate','collmind_tpm','CREATE')` = f.
--    Yani TAMAMEN taze bir kurulumda (migrations tablosu boş) `app_migrate`
--    ile `migration:run` İLK ADIMDA düşer — B2'nin "taze şemada kurulum
--    çökmemeli" kabul ölçütü, B2'nin kendi düzeltmesinden SONRA bile bu
--    yüzden hâlâ karşılanmıyor.
--    Olası düzeltme (uygulanmadı, kapsam onayı bekliyor):
--      SELECT format('GRANT CREATE ON DATABASE %I TO app_migrate', current_database()) \gexec
--    ⚠️ Bu, app_migrate'e veritabanında YENİ ŞEMA yaratma hakkı verir —
--    yalnız `:"schema"` içinde nesne yaratmaktan (§3) daha GENİŞ bir
--    yetki; "ölçülmüş asgari GRANT" ilkesiyle (K-2.6.13f) gerilimli —
--    bilinçli bir onay ister, sessizce genişletilmedi.

-- 4) Var olan nesnelerin sahipliğini app_migrate'e taşı. Idempotent — zaten
--    sahipse no-op, hata vermez. Bugüne kadar `postgres` (superuser) ile
--    yaratılmış 52 tablo / 1 sequence / 1 view bu yüzden gerekli — BUNDAN
--    SONRA yaratılacak nesneler zaten app_migrate ile (migration'lar bu
--    rolle koşacağı için) doğrudan app_migrate sahipliğinde doğar.
--
--    `%1$L` ile `:'schema'` yalnız BİR kez ikame edilir (dış format());
--    `%%I` dış format() içinde literal `%I`'ya döner ve iç `EXECUTE
--    format(...)` tarafından kimlik (identifier) olarak güvenle işlenir.
SELECT format($outer$
DO $do$
DECLARE
  r RECORD;
  schema_name CONSTANT text := %1$L;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = schema_name LOOP
    EXECUTE format('ALTER TABLE %%I.%%I OWNER TO app_migrate', schema_name, r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = schema_name LOOP
    EXECUTE format('ALTER SEQUENCE %%I.%%I OWNER TO app_migrate', schema_name, r.sequencename);
  END LOOP;
  FOR r IN SELECT viewname FROM pg_views WHERE schemaname = schema_name LOOP
    EXECUTE format('ALTER VIEW %%I.%%I OWNER TO app_migrate', schema_name, r.viewname);
  END LOOP;
  FOR r IN SELECT matviewname FROM pg_matviews WHERE schemaname = schema_name LOOP
    EXECUTE format('ALTER MATERIALIZED VIEW %%I.%%I OWNER TO app_migrate', schema_name, r.matviewname);
  END LOOP;
END
$do$;
$outer$, :'schema')
\gexec

-- 5) `pg_tables`/`pg_sequences`/`pg_views`/`pg_matviews` yalnız RELASYON
--    türlerini kapsar — `pg_type` (enum/domain) AYRI bir katalogdur ve #4
--    ona hiç dokunmuyordu (ölçüldü, B1: main'de 64 enum hâlâ `postgres`
--    sahipliğinde). Sonuç: `ALTER TYPE ... ADD VALUE` sahiplik ister
--    (yalnız USAGE yetmez) — app_migrate ile koşan bir enum göçü
--    "must be owner of type" ile düşer. Enum + domain (typtype 'e'/'d')
--    aynı katalogda yaşadığı için tek döngüde taşınıyor.
--
--    Fonksiyon/prosedür sahipliği de (pg_proc → main şeması) aynı
--    döngüye eklendi — main'de bugün 0 (ölçüldü) ama devretmemek aynı
--    sınıftan bir sonraki-göç kusurunu şimdiden garantiler; devretmek
--    ucuz (birkaç satır, no-op) ve #4'ün izlediği deseni bozmuyor.
--    `ALTER ROUTINE` (PG11+) hem FUNCTION hem PROCEDURE'ü kapsar, `prokind`
--    ayrımı gerektirmez.
SELECT format($outer$
DO $do$
DECLARE
  r RECORD;
  schema_name CONSTANT text := %1$L;
BEGIN
  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = schema_name AND t.typtype IN ('e', 'd')
  LOOP
    EXECUTE format('ALTER TYPE %%I.%%I OWNER TO app_migrate', schema_name, r.typname);
  END LOOP;
  FOR r IN
    SELECT format('%%I.%%I(%%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = schema_name
  LOOP
    EXECUTE format('ALTER ROUTINE %%s OWNER TO app_migrate', r.sig);
  END LOOP;
END
$do$;
$outer$, :'schema')
\gexec
