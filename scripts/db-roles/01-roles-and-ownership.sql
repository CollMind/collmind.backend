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
