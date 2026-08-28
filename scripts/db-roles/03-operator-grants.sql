-- K1a (Z52 §3/§4) — `app_operator`'ün ölçülmüş GRANT seti.
--
-- `02-runtime-grants.sql`'in AKSİNE, `app_operator`'ün amacı DAR/asgari bir
-- uygulama-yolu DEĞİL — "insan-yolu": etkileşimli sorgu (`db-query.sh`,
-- data-analyst), bakım/tanı guard'ları (schema-isolation, view-security-
-- invoker, dropped-column-absence) ve e2e test-fixture temizliği
-- (`db-cleanup.ts`). `BYPASSRLS` zaten bu rolün RLS politikalarını görmeden
-- okuyabildiğini VARSAYIYOR — o varsayım yalnız TABLO GRANT'i de varsa
-- anlamlı olur, yoksa BYPASSRLS boş bir yetkidir (tablo-düzeyi GRANT olmadan
-- hiçbir satıra erişilemez). Bu yüzden SELECT BROAD (şema geneli), DELETE ise
-- yine K-2.6.13f'nin "asgari ölçülmüş hak" ilkesiyle DAR/ölçülü verilir.
--
-- Bu dosya `../db-roles-operator-grants.sh` tarafından, GÖÇLERDEN SONRA
-- çalıştırılır (`02-runtime-grants.sql` ile aynı sıra gerekçesi: GRANT
-- verdiği nesnelerin VAR OLMASI gerekir).
--
-- psql değişkenleri: yalnız `:"schema"` (identifier substitution).

\set ON_ERROR_STOP on

BEGIN;

-- Yakınsak (M1 deseni, 02-runtime-grants.sql): önce TÜM haklar geri alınır,
-- sonra ölçülmüş set yeniden kurulur — dosya TEK doğruluk kaynağıdır.
REVOKE ALL ON ALL TABLES IN SCHEMA :"schema" FROM app_operator;

-- ── SELECT — şema geneli (view'lar dahil; PostgreSQL `ALL TABLES IN SCHEMA`
--    view/foreign-table'ları da kapsar). `db-query.sh` (data-analyst
--    ad-hoc SELECT/EXPLAIN) ve üç guard (schema-isolation/view-security-
--    invoker/dropped-column-absence, katalog+veri sorgusu) bu geniş erişimi
--    gerektiriyor — app_runtime'ın aksine operatörün işi ÖNCEDEN
--    BİLİNEMEYEN sorgulardır (K-2.6.13f'nin "her yeni tablo/rota ölçülür"
--    modeli burada uygulanamaz: iş tanımı gereği kapsam açık).
GRANT SELECT ON ALL TABLES IN SCHEMA :"schema" TO app_operator;

-- Gelecekte app_migrate ile yaratılacak YENİ tablolar için de aynı SELECT
-- otomatik uygulansın — aksi hâlde her migration'dan sonra bu dosya elle
-- yeniden koşulmadıkça operatör yeni tabloyu göremez (sessiz eksik erişim).
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrate IN SCHEMA :"schema"
  GRANT SELECT ON TABLES TO app_operator;

-- ── DELETE — DAR/ÖLÇÜLÜ. Tek ölçülmüş tüketici:
--    `collmind.frontend/tests/e2e/support/db-cleanup.ts#hardDeletePlanFixture`
--    (Playwright fixture temizliği, FK sırası: budget_transactions →
--    plan_approval_history → plan_mechanic_values → plan_skus → plan_fus →
--    plans). Blanket DELETE VERİLMEDİ — K-2.11.6/K-2.11.7 (denetim/defter
--    kayıtları DB seviyesinde korunur) operatör için de geçerli; bu altı
-- ⛔ REVİZE (K1a review B2, 2026-08-28) — ~~bu altı tablonun hiçbiri
-- denetim/defter tablosu DEĞİL~~ ÖLÇÜMLE YANLIŞ:
--   budget_transactions     → INV-L-006 KAPSAMINDA (SYSTEM_INVARIANTS:316);
--                             entity yorumu "DEFTER KAYDININ ne yaptığı" diyor
--   plan_approval_history   → ADR 0012'nin DENETİM-AİLESİ sayımında listeli
-- Davranışsal kanıt (app_operator, ROLLBACK'li):
--   DELETE budget_transactions → DELETE 6      (GERÇEK defter satırı)
--   DELETE ledger_entries      → permission denied   (poz. kontrol)
--   DELETE admin_audit_logs    → permission denied   (poz. kontrol)
-- ⚠️ HAFİFLETİCİ: operatörün DELETE kümesi app_runtime'ın kümesinin TAM ALT
--   KÜMESİ (operatörde olup runtime'da olmayan DELETE = 0 tablo) ⇒ YENİ BİR
--   YETENEK DOĞMADI; bu iki GRANT mevcut hakkın KOPYASIDIR.
-- ⛔ VE L2_03:798 BU SENARYOYU ÖNCEDEN YAZMIŞTI: "bir sonraki S3 turu (RLS
--   rolü ya da başka bir ayrıcalıksız rol) AYNI FAZLALIĞI ÜRETECEKTİR."
-- ⇒ İkisi K1b/RLS turunda app_runtime ile BİRLİKTE daraltılır. Bugün burada
--   yanlış bir cümle bırakmak, §7.1'in "hatayı belgelemek onu koruma altına
--   alır" vakası olurdu.
GRANT DELETE ON :"schema".budget_transactions TO app_operator;
GRANT DELETE ON :"schema".plan_approval_history TO app_operator;
GRANT DELETE ON :"schema".plan_mechanic_values TO app_operator;
GRANT DELETE ON :"schema".plan_skus TO app_operator;
GRANT DELETE ON :"schema".plan_fus TO app_operator;
GRANT DELETE ON :"schema".plans TO app_operator;

COMMIT;
