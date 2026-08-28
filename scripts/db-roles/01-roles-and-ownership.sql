-- K-2.6.13a / K-2.6.13b / K-2.6.13c — idempotent rol + sahiplik kurulumu.
--
-- Bu bir MIGRATION DEĞİLDİR: roller küme-yönetimi nesnesidir, şema geçmişi
-- değil (K-2.6.13c). `../db-roles-setup.sh` tarafından bir SUPERUSER
-- bağlantısıyla çalıştırılır (docker exec ile yerel soket → `trust` auth,
-- ya da TCP modunda DB_ADMIN_PASSWORD ile). Tekrar çalıştırmak güvenlidir.
--
-- psql değişkenleri (çağıran script `-v` ile geçirir):
--   :'runtime_pw'    app_runtime parolası (SQL string literal olarak substitute edilir)
--   :'migrate_pw'    app_migrate parolası
--   :'operator_pw'   app_operator parolası (K1a, Z52 §3/§4)
--   :"schema"        hedef şema (identifier olarak substitute edilir, örn. main)

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

-- 1b) K1a / Z52 §5 — canlı sapma KAPATILIR: `app_runtime` elle
--    `ALTER ROLE ... SET log_statement='all'` almıştı (Z51 §2, kayıtsız —
--    repo genelinde SIFIR script/kod referansı). Sapmanın iki kusuru vardı
--    (üretilemezlik + yanlış-rol) ve ikisi tek hamlede kapanıyor: ayar
--    BURADA sıfırlanır (idempotent — hiç yoksa no-op), doğru yeri aşağıdaki
--    app_operator bloğudur (Z52 §5: "canlı sapma betiğe KOPYALANMAZ, DOĞRU
--    TASARIMA ÇEVRİLİR").
ALTER ROLE app_runtime RESET log_statement;

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

-- 2a) app_operator — K1a (Z52 §3/§4). "İNSAN-YOLU": etkileşimli sorgu,
--    bakım, veri-erişimi (`db-query.sh`, guard'lar, e2e cleanup). BOOTSTRAP
--    (rol/şema kurulumu, migration zinciri) BU ROLÜN İŞİ DEĞİL — o superuser
--    ile kalır (Z52 §4, `Z29` istisna disipliniyle `_lib.sh`'te adıyla
--    listeli).
--
--    NOSUPERUSER · NOCREATEDB · NOCREATEROLE · BYPASSRLS · NOREPLICATION.
--    BYPASSRLS bilinçli: operatör RLS politikalarını (K1 sonrası paket)
--    atlayarak okuyabilmeli — bu bir güvenlik açığı değil, tanımı gereği
--    operatör-yetkisi (superuser'ın bugünkü BYPASSRLS'inin insan-yolundaki
--    tek meşru mirasçısı).
--
--    ~~⛔ `K1a`'NIN DENETİM-İZİ İDDİASI YOKTUR (Z52 §3): aşağıdaki
--    `log_statement=all` rol seviyesinde yalnız `NE`'yi verir — `KİM`'i
--    (log_line_prefix'te %u yok) ve `KALICILIĞI` (logging_collector off)
--    VERMEZ. O ikisi `K1b`'nin işidir, ve `K1b` KAPANMADAN "operatör
--    denetim-olaylıdır" cümlesi HİÇBİR BELGEDE KURULAMAZ.~~
--
--    ✅ BORÇ KAPANDI — `K1b` PİNİ GEÇTİ (2026-08-28, `exit 0`).
--    Üç parçanın ÜÇÜ DE ölçüldü:
--      NE          `log_statement=all`        (rol seviyesi, bu dosya)
--      KİM         `log_line_prefix=%m [%p] %u@%d %a`   ⇒ pin ölçtü:
--                  `app_runtime@` 1 satır · `app_operator@` 4 satır,
--                  MARKER METNİ OLMADAN, yalnız `%u` alanıyla ayrışıyor
--      KALICILIK   `logging_collector=on` + `collmind-tpm-postgres-logs`
--                  volume'u ⇒ `docker rm` iz bırakır
--    ⇒ "operatör denetim-olaylıdır" cümlesi ARTIK KURULABİLİR.
--
--    ⚠️ Ve `F12` gereği eski metin SİLİNMEDİ, üstü çizildi: bu borcun
--    NEDEN vardığı ve NASIL kapandığı kayıtta kalır. Dersi de kalır:
--    "1/3 doğru bir iddia, tamamen yanlış olandan DAHA TEHLİKELİDİR."
--
--    ⛔ VE ÜÇ PARÇADAN İKİSİ ORTAM-SEVİYESİDİR (`docker-compose.yml`),
--    bu dosya DEĞİL — yani bir taze kurulumda bu dosya tek başına
--    denetim-izini SAĞLAMAZ. İlk-deploy ön koşulu `4`
--    (compose-tanımı ↔ canlı-container eşleşmesi) bunun kapısıdır.
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_operator')
    THEN format('ALTER ROLE app_operator WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOREPLICATION', :'operator_pw')
    ELSE format('CREATE ROLE app_operator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOREPLICATION', :'operator_pw')
  END AS ddl
\gexec

-- Z52 §5 — sapmanın DOĞRU YERİ: kurulum betiğinde doğar, canlıda elle DEĞİL.
-- İdempotent (her koşumda aynı değere set eder, no-op'a eşdeğer).
ALTER ROLE app_operator SET log_statement = 'all';

-- 2b) K-2.6.13 KARAR 2 (ürün sahibi, 2026-08-16) — ŞEMAYI BU BETİK YARATIR,
--    app_migrate'e VERİTABANI DÜZEYİ CREATE VERİLMEZ.
--
--    Bulgu (B2'nin kendi düzeltmesinden SONRA bile ölçülmüştü): göç
--    zincirinin İLK adımı (`CreateTenants1704067200000`,
--    `CREATE SCHEMA IF NOT EXISTS "main"`) DATABASE düzeyinde CREATE ister;
--    şema-düzeyi CREATE (aşağıdaki #3) bunu KARŞILAMAZ.
--
--    Ürün sahibinin kararı: (a) app_migrate'e `GRANT CREATE ON DATABASE`
--    verMEK yerine (b) şema yaratma ihtiyacını zaten AYRICALIKLI bağlantıyla
--    çalışan bu betiğe TAŞI (desen `K-2.6.13c`'nin aynısı — "roller bir
--    kurulum betiğinde tanımlanır, bir göçte değil"). Aşağıdaki satır bunu
--    yapıyor ve İZOLE, TEK KULLANIMLIK bir container'da doğrulandı (gerçek
--    dev DB'ye dokunulmadı): şema burada (superuser ile) başarıyla
--    yaratılıyor, `has_database_privilege('app_migrate', db, 'CREATE')`
--    sonrasında da hâlâ `f`.
--
--    ⚠️ AMA bu KARAR 2'nin TAMAMINI KAPATMIYOR — aynı izole container'da
--    RE-ÖLÇÜLDÜ (2026-08-16, devam turu) ve önceki "olası düzeltme" notunun
--    varsaydığının AKSİNE, şemanın ÖNCEDEN VAR OLMASI migration'ı KURTARMIYOR:
--      app_migrate: CREATE SCHEMA IF NOT EXISTS "main"  → HÂLÂ
--                   "permission denied for database" (şema zaten VARKEN de)
--    PostgreSQL `CREATE SCHEMA IF NOT EXISTS` için DATABASE-düzeyi CREATE
--    denetimini şemanın var olup olmadığına BAKMADAN yapıyor — "IF NOT
--    EXISTS" yalnız "already exists" hatasını bastırıyor, izin denetimini
--    DEĞİL. Sonuç, tam bir taze-DB koşumunda ölçüldü:
--      taze şema (init-schema.sql YOK) → bu betik (schema+roller) → EXIT 0
--      → `npm run migration:run` (app_migrate)                    → EXIT 1
--        (`CreateTenants1704067200000.up()`'ın İLK satırı, 42501)
--    Gerçek dev DB'de bu görünmüyor SADECE çünkü o migration zaten
--    `migrations` tablosuna KAYITLI (superuser'la, app_migrate var olmadan
--    önce uygulanmıştı — ölçüldü, `id=133`) ve TypeORM onu bir daha
--    ÇALIŞTIRMIYOR. Tamamen taze bir kurulumda (Cloud SQL / yeni ortam,
--    `migrations` tablosu boş) `migration:run` İLK ADIMDA hâlâ düşer.
--    Kalan iki yol da bu turun KAPSAMI DIŞI: (a) `GRANT CREATE ON DATABASE`
--    — ürün sahibi REDDETTİ, (b) migration dosyasının kendisini değiştirmek
--    — `src/database/migrations/`, bu task'ın "src/'ye DOKUNMA" sınırının
--    içinde (ayrı bir B4 turu gerektirir). **Team Lead'e bildirildi — DUR.**
--
-- ⚡ GÜNCELLEME (2026-08-16, commit 8f65826): şık (b) UYGULANDI ve bu blok
--    ARTIK BAYAT — yukarıdaki "EXIT 1" tarifi bugün geçerli DEĞİL.
--    21 göç dosyasının hepsinde koşulsuz `CREATE SCHEMA` bir koşullu bloğa
--    çevrildi; grep'lenebilir token: `pg_namespace WHERE nspname`.
--    Böylece şema VARKEN izin denetimi hiç tetiklenmiyor, ve `app_migrate`
--    veritabanı düzeyi CREATE hakkını ALMIYOR.
--
--    ⚠️ Blok silinmedi (F12/0006-R): "neden bu karar verilmişti" kayıtta
--    kalsın. Ama okuyan kişi DURMAMALI — iş yapıldı.
CREATE SCHEMA IF NOT EXISTS :"schema";

-- 3) Şema düzeyi haklar. app_migrate şemada nesne yaratabilir (CREATE);
--    app_runtime yalnız var olan nesnelere erişebilir (USAGE) — CREATE YOK.
--    Bunlar üst seviyede (DO/$$ içinde DEĞİL) — `:"schema"` burada çalışır.
GRANT USAGE, CREATE ON SCHEMA :"schema" TO app_migrate;
GRANT USAGE ON SCHEMA :"schema" TO app_runtime;
-- app_operator yalnız USAGE alır — app_migrate'in aksine CREATE YOK (DDL bu
-- rolün işi değil, K1a'nın "insan-yolu" tanımı gereği).
GRANT USAGE ON SCHEMA :"schema" TO app_operator;

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
--
--    M-3(m-5) DÜZELTMESİ (2026-08-16, code-reviewer kapanış review'u):
--    aşağıdaki rutin döngüsü ÖNCEDEN yalnız `n.nspname = schema_name`
--    filtreliyordu — `main`'de bugün 0 rutin olduğu için no-op, ama
--    `CREATE EXTENSION ... WITH SCHEMA main` çalıştırılırsa (main şemasına
--    kurulan bir extension fonksiyon/prosedür yaratabilir) bu döngü o
--    fonksiyonların sahipliğini SESSİZCE app_migrate'e taşırdı — extension'ın
--    KENDİ sahipliğinden (genelde superuser/extension sahibi) çalar ve
--    `DROP EXTENSION`/`ALTER EXTENSION` gibi sonraki işlemleri bozabilirdi.
--    `pg_depend.deptype = 'e'` (extension bağımlılığı) taşıyan nesneler artık
--    HARİÇ tutuluyor — betik hâlâ idempotent (iki koşum birebir aynı: filtre
--    yalnızca kümeyi DARALTIYOR, döngünün kendisini değiştirmiyor).
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
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER ROUTINE %%s OWNER TO app_migrate', r.sig);
  END LOOP;
END
$do$;
$outer$, :'schema')
\gexec
