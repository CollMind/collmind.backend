-- K-2.6.13f — app_runtime'ın ÖLÇÜLMÜŞ asgari GRANT seti.
--
-- Yöntem (issue S3): rol yaratılır → test ortamında bağlanılır → TAM test
-- suite koşulur → düşen HER izin kaydedilir → yalnız düşenler GRANT edilir
-- → suite yeşilenene kadar yinelenir. Toptan `GRANT ALL` YASAK.
--
-- Bu dosya `docs/verification/DB_ROL_IZIN_ENVANTERI.md` (meta repo) ile
-- BİREBİR eşleşir — envanterin yürütülebilir hâlidir. Yeni bir tablo/rota
-- app_runtime için yeni bir hak gerektirdiğinde, KANIT (hangi test/hata)
-- önce envanter dosyasına, GRANT satırı buraya eklenir — ikisi ayrı
-- kopyalar değil, aynı ölçümün iki temsilidir; senkron kalmalı.
--
-- `\gexec` kullanmıyoruz — grant listesi düz, deterministik SQL. Şema adı
-- `:"schema"` (identifier substitution) ile parametrik.

\set ON_ERROR_STOP on

-- ⚡ TEK İŞLEM (2026-08-16, code-reviewer B-1 · ölçüldü).
--    ON_ERROR_STOP altında her ifade AUTOCOMMIT'tir: aşağıdaki `REVOKE ALL`
--    commit olur, sonraki bir GRANT düşerse betik çıkar ve GERİ ALINAN HAKLAR
--    GERİ GELMEZ — `app_runtime` SIFIR hakla kalır, her rota
--    `permission denied` döner.
--
--    ⚠️ Ve bu, M1'in (yakınsaklık) kapattığı sınıfın YENİ bir vakasıydı, üstelik
--    YÖNÜ DAHA KÖTÜ: M1 öncesi betik yalnız EKLİYORDU → hata = no-op, önceki
--    durum sağlam. M1 sonrası hata = YIKICI ve KALICI.
--
--    Tetikleyici uydurma değil, BELGELİ: db-roles-grants.sh · README 5a ·
--    LOCAL_SETUP "Adım 2a" üçü de "göçlerden ÖNCE koşulursa
--    `relation ... does not exist` ile düşer" diyor.
--
--    PostgreSQL'de GRANT/REVOKE işlemseldir — ölçüldü (Team Lead, canlı DB,
--    ROLLBACK'li): işlem içinde hak 0'a düştü, ROLLBACK sonrası 1'e döndü.
BEGIN;

-- ── M1 (code-reviewer, 2026-08-16) — betik YAKINSAK değildi: yalnız
--    EKLİYORDU, hiçbir REVOKE yoktu. Elle verilmiş fazladan bir hak
--    (ör. yanlışlıkla `GRANT DELETE ON main.plans`) betiği tekrar
--    çalıştırarak asla geri alınmıyordu — dosya "tek doğruluk kaynağı"
--    olma iddiasını taşıyordu (bkz. başlık) ama bunu ZORLAMIYORDU.
--
--    Önce app_runtime'ın TÜM tablo/sequence/fonksiyon haklarını geri al,
--    sonra aşağıdaki ölçülmüş seti yeniden kur. Idempotent: hiç hakkı
--    yoksa REVOKE no-op'tur (hata vermez). Kolon-düzeyi GRANT'ler de
--    (`UPDATE (alert_sent)` gibi) tablo-düzeyi REVOKE ALL ile geri alınır
--    (Postgres kolon ayrıcalıklarını tablo ayrıcalığının bir alt kümesi
--    olarak tutar) — aşağıdaki ölçülmüş kolon-düzeyi GRANT'ler yeniden
--    uygulanınca aynı dar kapsamla geri gelir.
--
--    Bilinçli olarak DAHİL EDİLMEYEN: `REVOKE ... ON SCHEMA` ve
--    `REVOKE CREATE`/`USAGE ON SCHEMA` — bunlar `01-roles-and-ownership.sql`
--    tarafından yönetiliyor (şema düzeyi, bu dosyanın kapsamı DEĞİL,
--    K-2.6.13a). Bu dosya yalnız app_runtime'ın NESNE düzeyi (tablo/
--    sequence/fonksiyon) haklarını yakınsatır.
REVOKE ALL ON ALL TABLES IN SCHEMA :"schema" FROM app_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA :"schema" FROM app_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA :"schema" FROM app_runtime;

-- ── S3 tur 1 — globalSetup/globalTeardown (test/global-setup.js,
--    test/global-teardown.js → test/helpers/e2e-row-count.js) app_runtime
--    ile bağlanıp T-047/T-060 satır-sayısı invaryantını okuyor; bu sekiz
--    tablo olmadan `npm run test:e2e` globalSetup'ta "permission denied for
--    table tenants" ile hiç başlamadan çöküyordu (ölçüldü: docker container
--    log'u, `SELECT id FROM main.tenants ...` STATEMENT'i + ERROR eşleşmesi).
GRANT SELECT ON :"schema".tenants TO app_runtime;
GRANT SELECT ON :"schema".agreements TO app_runtime;
GRANT SELECT ON :"schema".plans TO app_runtime;
GRANT SELECT ON :"schema".plan_fus TO app_runtime;
GRANT SELECT ON :"schema".plan_skus TO app_runtime;
GRANT SELECT ON :"schema".approval_requests TO app_runtime;
GRANT SELECT ON :"schema".admin_audit_logs TO app_runtime;
GRANT SELECT ON :"schema".users TO app_runtime;

-- ── S3 tur 2 — POST /auth/login (her e2e spec dosyasının ilk adımı) VE
--    test/helpers/seed-e2e.ts (loadE2EFixture, app'in kendi DataSource'unu
--    kullanan raw `dataSource.query()` çağrıları) ile ölçüldü:
--    - `cpls`: seed-e2e.ts:63-64 fixture yükleme sorgusu (SELECT id FROM
--      main.cpls WHERE tenant_id = $1 LIMIT 1) — permission denied for
--      table cpls (16 istekte, docker log).
--    - `users` UPDATE: user.service.ts login() `last_login_at`/
--      `login_count`/`refresh_token` günceller — permission denied for
--      table users (7 istekte).
GRANT SELECT ON :"schema".cpls TO app_runtime;
GRANT UPDATE ON :"schema".users TO app_runtime;

-- ── S3 tur 3 — 16 e2e suite dosyasının (budget/master-data/customer/
--    sales-actuals/perf) ilk katmanı, docker log'undan ölçüldü (105 hata,
--    tekilleştirildi):
--    SELECT: master data + bütçe okuma yolu (budget-threshold, KPI/scope
--      lookup'ları, recalc perf testi `resolveIdByCode`).
--    INSERT/DELETE `tenants`: optimistic-locking / kpi-optimistic-locking
--      e2e'lerinin kendi geçici cross-tenant fixture'ı (bkz. test/
--      optimistic-locking.e2e-spec.ts:900,927 — `INSERT INTO main.tenants`
--      / `DELETE FROM main.tenants WHERE id = $1`).
--    ⚠️ BAYAT (Z24, [[T-273]] takibi, 2026-08-23): `INSERT budget_allocations`
--    KALDIRILDI — tablo düşürüldü (migration 1811000000000), tüketicisiz
--    ölü model. Bkz. dosyanın sonundaki Z24 notu.
--    DELETE `customers`: customer-import e2e'lerinin `cleanupTestCustomers`
--      yardımcı fonksiyonu (`DELETE FROM main.customers WHERE tenant_id =
--      $1 AND code LIKE $2`).
GRANT SELECT ON :"schema".budget_alert_configurations TO app_runtime;
-- T-316 (budget_policies canlanır, Z57 §1): `BudgetPolicyService`
-- `TypeOrmModule.forFeature([BudgetPolicy])` ile enjekte ediyor
-- (app-runtime-grants guard'ı bunu tespit etti — `budget_policies`
-- app_runtime için hiçbir haktan geçmiyordu). Yalnız SELECT: bu servis
-- yalnız okur, eşik yazma yolu (K-2.2.8e denetim olayı) ayrı bir task'ın
-- işi ve o geldiğinde kendi UPDATE hakkını ölçerek ekler.
GRANT SELECT ON :"schema".budget_policies TO app_runtime;
GRANT SELECT ON :"schema".budget_transactions TO app_runtime;
GRANT SELECT ON :"schema".categories TO app_runtime;
GRANT SELECT ON :"schema".channels TO app_runtime;
GRANT SELECT, DELETE ON :"schema".customers TO app_runtime;
GRANT SELECT ON :"schema".forecasting_units TO app_runtime;
GRANT SELECT ON :"schema".mechanics TO app_runtime;
-- `SELECT ... FOR UPDATE` (sales-actuals batch işleme kilidi) — aynı
-- gerekçeyle UPDATE eklendi (tur 4'te ölçüldü, sales-actual-batches.
-- FOR UPDATE, 8 istekte "permission denied").
GRANT SELECT, UPDATE ON :"schema".sales_actual_batches TO app_runtime;
GRANT SELECT ON :"schema".tactics TO app_runtime;
GRANT SELECT ON :"schema".user_scopes TO app_runtime;
GRANT INSERT, DELETE ON :"schema".tenants TO app_runtime;

-- ── S3 tur 4 — plan/agreement oluşturma akışı + kpi/generic-unit/region
--    lookup'ları + sales-actuals ingestion (110 hata, tekilleştirildi):
--    INSERT `plans` en büyük grup (49) — plan oluşturma/PATCH akışının
--    optimistic-locking + kpi-optimistic-locking + recalc-perf e2e'lerinde
--    tekrar tekrar tetiklenmesi.
--    ⚠️ BAYAT (Z24, [[T-273]] takibi, 2026-08-23): `DELETE budget_allocations`
--    KALDIRILDI — tablo düşürüldü, aynı gerekçe yukarısı (tur 3 notu).
--    INSERT `admin_audit_logs`: her onay/iş işlemi audit satırı yazıyor
--      (BRD "her işlem loglanır").
GRANT INSERT ON :"schema".admin_audit_logs TO app_runtime;
-- `SELECT ... FOR UPDATE` (bütçe zarfı rezervasyon kilidi,
-- budget-reservation.service.ts) SELECT'e ek olarak UPDATE ister — aynı
-- `agreements` gerekçesi, ölçüldü aynı turda.
GRANT SELECT, INSERT, UPDATE ON :"schema".budget_envelopes TO app_runtime;
-- ⚠️ BAYAT (Z24, 2026-08-23): `SELECT, INSERT budget_transaction_logs`
-- KALDIRILDI — tablo düşürüldü, aynı gerekçe yukarısı.
GRANT INSERT ON :"schema".customers TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON :"schema".mechanics TO app_runtime;
GRANT INSERT ON :"schema".plans TO app_runtime;
GRANT INSERT ON :"schema".users TO app_runtime;
-- `agreements` zaten SELECT'e sahipti (tur 1) ama hata sürdü — sebep
-- `SELECT ... FOR UPDATE` (optimistic-locking akışı, agreement.repository.ts):
-- Postgres, satır kilitleme (`FOR UPDATE`) için SELECT'in YANI SIRA UPDATE
-- yetkisi de ister (kilit `xmax` yazımı gerektirir) — ölçüldü, STATEMENT
-- gövdesinde `... LIMIT 1 FOR UPDATE` görüldü.
GRANT UPDATE ON :"schema".agreements TO app_runtime;
GRANT SELECT ON :"schema".generic_units TO app_runtime;
GRANT SELECT ON :"schema".kpis TO app_runtime;
GRANT SELECT ON :"schema".ledger_entries TO app_runtime;
GRANT SELECT ON :"schema".regions TO app_runtime;
GRANT SELECT ON :"schema".sales_actuals TO app_runtime;

-- ── S3 tur 5 — iki kaynaktan: (a) docker log ölçümü (83 hata, tekilleştirildi
--    — plan/agreement/sales-actuals oluşturma akışının ikinci katmanı,
--    `skus` lookup'ı — 51 istek), (b) `test/helpers/seed-e2e.ts`'in DÖRT
--    temizlik fonksiyonunun (cleanupTestTransactions, cleanupTestAgreements,
--    cleanupSalesActuals, cleanupTestPlans, cleanupTestUsers) kodu STATİK
--    olarak okunarak çıkarılan TAM DELETE listesi — bunların bir kısmı
--    round 5'in log'unda GÖRÜLMEDİ çünkü zincirdeki İLK DELETE (ör.
--    budget_transactions) başarısız olunca fonksiyon await'te throw edip
--    kalan DELETE'lere hiç ulaşmıyordu (aynı transaction DEĞİL — ayrı
--    `dataSource.query()` çağrıları, ama JS zinciri ilk hatada durur). Bu
--    yüzden statik okuma burada log'dan daha güvenilir: log yalnız "zincirin
--    o ana kadar ulaştığı" noktayı gösterir, fonksiyonun TAMAMININ ihtiyacını
--    değil.
--    - `agreements` DELETE: cleanupTestAgreements son adım.
--    - `approval_requests` DELETE: cleanupTestPlans + cleanupTestAgreements
--      (entity_type='PLAN'|'AGREEMENT', polimorfik — T-060).
--    - `ledger_entries`/`agreement_transactions`/`admin_audit_logs` DELETE:
--      bkz. K-2.6.13 KARAR 1 notu aşağıda — bu üç tablo için app_runtime'a
--      artık DELETE VERİLMİYOR, test temizliği app_migrate'e taşındı.
--    - `plan_fus`/`plan_skus`/`plan_mechanic_values`/`plan_approval_history`
--      DELETE: cleanupTestPlans (FK sırası).
--    - `plans` DELETE: cleanupTestPlans son adım.
--    - `sales_actuals`/`sales_actual_batches` DELETE: cleanupSalesActuals.
--    - `users` DELETE: cleanupTestUsers (T-060, hard-delete, DELETE
--      /users endpoint'i olmadığı için testin kendi ürettiği kullanıcıyı
--      DB'den siler).
GRANT DELETE ON :"schema".budget_transactions TO app_runtime;
GRANT DELETE ON :"schema".plan_approval_history TO app_runtime;
GRANT SELECT, INSERT ON :"schema".agreements TO app_runtime;
GRANT INSERT ON :"schema".budget_transactions TO app_runtime;
GRANT SELECT, INSERT ON :"schema".kpis TO app_runtime;
GRANT SELECT, INSERT ON :"schema".on_invoice_batches TO app_runtime;
GRANT INSERT ON :"schema".sales_actual_batches TO app_runtime;
GRANT SELECT ON :"schema".skus TO app_runtime;
GRANT DELETE ON :"schema".agreements TO app_runtime;
GRANT DELETE ON :"schema".approval_requests TO app_runtime;

-- ── K-2.6.13 KARAR 1 (ürün sahibi, 2026-08-16) — `app_runtime`'ın
--    `ledger_entries` / `admin_audit_logs` / `agreement_transactions`
--    üzerindeki DELETE hakkı BİLİNÇLİ OLARAK KALDIRILDI (yukarıda tur 5
--    bloğunda önceden veriliyordu — bkz. bu dosyanın git geçmişi).
--
--    Gerekçe (kural dayanağı, ürün sahibinin verdiği):
--      K-2.3.4   "Hiçbir defter kaydı silinemez — ne kalıcı ne mantıksal"
--      K-2.11.6  "Denetim kaydı değiştirilemez ve silinemez"
--      K-2.11.7  "Bu, uygulama katmanında DEĞİL veritabanı seviyesinde
--                 korunur"
--      INV-L-003 ledger_entries şemasında `deleted_at` HİÇ YOK (soft-delete
--                 mekanizması yok — silme, silmedir)
--    `app_runtime`'ın bu üç tabloda DELETE taşıması, K-2.11.7'nin
--    "veritabanı seviyesinde korunur" iddiasını yapı gereği ihlal
--    ediyordu: uygulama kodu hiçbir defter/denetim satırını silmese bile,
--    DB düzeyinde hak var olduğu sürece kural yalnızca UYGULAMA
--    DAVRANIŞINA (kod incelemesine) bağlıydı, DB'ye değil.
--
--    Ölçüm (2026-08-16, data-engineer, K-2.6.13 ADIM devam turu): bu üç
--    DELETE hakkının TEK tüketicisi test temizliğiydi — üretim çağrı
--    yolunda bu üç tabloya hard-DELETE eden HİÇBİR rota yok (ölçüldü:
--    `grep -rn '\.delete(\|\.remove(\|DELETE FROM' src/modules/ledger
--    src/modules/audit src/modules/agreement-transactions` → 0 üretim
--    yolu; tüm silme çağrıları `softRemove`/`deleted_at` üzerinden başka
--    tablolara gidiyor). GRANT kaldırıldığında `npm run test:e2e` kırıldı
--    (permission denied for table ledger_entries/admin_audit_logs/
--    agreement_transactions), ve kırılan HER nokta `test/helpers/
--    seed-e2e.ts`'in cleanup fonksiyonları + üç e2e spec dosyasının
--    (`on-invoice-split-envelope`, `mechanic-bound-guard`,
--    `plan-scale-validation`) kendi inline temizlik sorgularıydı — üçü de
--    `app.get<DataSource>(getDataSourceToken())` (yani app_runtime bağlantısı)
--    kullanıyordu. Düzeltme test tarafında yapıldı: bu üç tablo için
--    DELETE artık `test/helpers/admin-datasource.ts`'in sağladığı AYRI bir
--    `app_migrate` bağlantısıyla çalışıyor (bkz. o dosyanın başlığı) —
--    app_runtime'ın GRANT seti genişletilmedi, test ihtiyacı taşındı
--    (`§2.5`'in sınırı: "sessiz fallback" değil, açık ve gerekçeli bir
--    yeniden yönlendirme).
--
--    ⚠️ Bir sonraki S3/genişletme turu bu üç tabloda YENİDEN bir DELETE
--    ihtiyacı ÖLÇERSE (docker log'da "permission denied for DELETE"), bu
--    bir REGRESYON İHTİMALİDİR, otomatik bir GRANT değil — önce üretim
--    yolu mu test yolu mu olduğu ayırt edilmeli (yöntem: bu envanterin S3
--    döngüsü + `git blame`/stack trace). Üretim yoluysa bu bir K-2.11.7
--    İHLALİDİR ve Team Lead'e bildirilir, sessizce GRANT edilmez.
GRANT DELETE ON :"schema".plan_fus TO app_runtime;
GRANT DELETE ON :"schema".plan_skus TO app_runtime;
GRANT DELETE ON :"schema".plan_mechanic_values TO app_runtime;
GRANT DELETE ON :"schema".plans TO app_runtime;
GRANT DELETE ON :"schema".sales_actuals TO app_runtime;
GRANT DELETE ON :"schema".sales_actual_batches TO app_runtime;
GRANT DELETE ON :"schema".users TO app_runtime;

-- ── S3 tur 6 — docker log, 80 hata (tekilleştirildi):
--    `plan_mechanic_values` SELECT en büyük grup (49) — Plan → FU → SKU
--    mekanik değer okuma yolu (KPI/spend hesaplama, grid).
--    `agreement_transactions` SELECT: off-invoice transaction akışının
--      okuma tarafı (createOffInvoiceTransaction sonrası doğrulama +
--      reversal/settlement testleri).
--    DELETE `budget_envelopes`/`kpis`/`plan_approval_history` (ek):
--      belirli e2e spec dosyalarının kendi inline temizliği (seed-e2e.ts
--      dışı) — bkz. optimistic-locking / kpi-optimistic-locking suite'leri.
GRANT SELECT ON :"schema".plan_mechanic_values TO app_runtime;
GRANT SELECT ON :"schema".agreement_transactions TO app_runtime;
GRANT SELECT ON :"schema".on_invoice_entries TO app_runtime;
GRANT INSERT ON :"schema".approval_requests TO app_runtime;
GRANT INSERT ON :"schema".sales_actuals TO app_runtime;
GRANT SELECT, UPDATE ON :"schema".kpis TO app_runtime;
GRANT DELETE ON :"schema".budget_envelopes TO app_runtime;
GRANT DELETE ON :"schema".kpis TO app_runtime;

-- ── S3 tur 7 — KÖK NEDEN BULUNDU (ampirik izole test, docker exec +
--    `\set VERBOSITY verbose` → `LOCATION: aclcheck_error, aclchk.c:2812`,
--    `has_table_privilege(...,'DELETE')=t` İKEN yine "permission denied"):
--    Postgres, bir `WHERE`/`RETURNING` yan tümcesi bir SÜTUNA referans veren
--    her `UPDATE`/`DELETE` için, o sütun(lar) üzerinde SELECT'i de ister —
--    yalnız `DELETE`/`UPDATE` tablo-düzeyi bit'i YETMEZ. `plan_approval_
--    history` tur 5'te YALNIZ DELETE almıştı (`WHERE plan_id = ANY(...)`
--    sütuna referans veriyor) — bu yüzden tur 6/7'de HÂLÂ "permission
--    denied" veriyordu, DELETE granted olmasına rağmen. Doğrulandı: SELECT
--    eklenince aynı DELETE app_runtime ile başarılı oldu.
--    ⚠️ Bu, bu envanterin geri kalanı için bir GÖZDEN GEÇİRME gerektirir:
--    yalnız DELETE/UPDATE (SELECT'siz) verilmiş HİÇBİR satır yoktu (kontrol
--    edildi) — `plan_approval_history` TEK istisnaydı.
--    `plans` UPDATE: PATCH /plans/:id (plan düzenleme akışı, 43 istekte).
--    `on_invoice_batches` UPDATE: on-invoice batch durum güncellemesi.
GRANT SELECT ON :"schema".plan_approval_history TO app_runtime;
GRANT UPDATE ON :"schema".plans TO app_runtime;
GRANT UPDATE ON :"schema".on_invoice_batches TO app_runtime;

-- ── S3 tur 8 — docker log, 42 hata (tekilleştirildi):
--    `plan_fus` INSERT en büyük grup (41) — Plan → FU ekleme akışı
--    (POST /plans/:id/fus).
--    `on_invoice_entries` INSERT: on-invoice satır ekleme.
GRANT INSERT ON :"schema".plan_fus TO app_runtime;
GRANT INSERT ON :"schema".on_invoice_entries TO app_runtime;

-- ── S3 tur 9 — docker log, 44 hata (tekilleştirildi):
--    `plan_skus` INSERT en büyük grup (41) — Plan → FU → SKU ekleme akışı.
--    `ledger_entries` INSERT: agreement transaction sonrası ledger DEBIT
--      satırı (BRD "append-only ledger").
--    `on_invoice_entries` DELETE/UPDATE: on-invoice satır düzenleme/silme.
GRANT INSERT ON :"schema".plan_skus TO app_runtime;
GRANT INSERT ON :"schema".ledger_entries TO app_runtime;
GRANT UPDATE, DELETE ON :"schema".on_invoice_entries TO app_runtime;

-- ── S3 tur 10 — docker log, 42 hata (tekilleştirildi):
--    `lta_agreements` SELECT (41) — LTA (long-term-agreement) master data
--      okuma yolu.
--    `on_invoice_batches` DELETE: on-invoice batch temizliği.
GRANT SELECT ON :"schema".lta_agreements TO app_runtime;
GRANT DELETE ON :"schema".on_invoice_batches TO app_runtime;

-- ── S3 tur 11 — docker log, 41 hata: `lta_rates` SELECT — LTA oran
--    tablosunun okuma yolu (`lta_agreements`'in çocuk tablosu).
GRANT SELECT ON :"schema".lta_rates TO app_runtime;

-- ── S3 tur 12 — docker log, 41 hata: `plan_skus` UPDATE — SKU düzeyi
--    hacim/mekanik değer güncelleme akışı (grid PATCH).
GRANT UPDATE ON :"schema".plan_skus TO app_runtime;

-- ── S3 tur 13 — docker log, 41 hata: `plan_fus` UPDATE — FU düzeyi
--    hacim/mekanik değer güncelleme akışı (grid PATCH, plan_skus'ın FU
--    kardeşi).
GRANT UPDATE ON :"schema".plan_fus TO app_runtime;

-- ── S3 tur 14 — KAPSAM DÜZELTMESİ: bu envanterin hiçbir turu bir VIEW'ı
--    kapsamıyordu — ölçüm sorgum `information_schema.role_table_grants`
--    yalnız BASE TABLE'ları sayar, `pg_views`'ı değil (§ "arama terimi
--    aranan yerin diliyle seçilir" — burada kapsamın kendisi eksikti, terim
--    değil). `v_budget_summary` (bütçe zarfı özeti — budget-threshold,
--    reservation, settlement'ın HEMEN HEPSİ bunu okuyor) turlar boyunca
--    HİÇ granted olmamıştı ve `docker logs`'ta "permission denied for
--    VIEW v_budget_summary" olarak duruyordu — table-only regex'im bunu
--    14 tur boyunca KAÇIRDI (yalnızca `grep -o 'permission denied for
--    [a-z]+ [a-zA-Z_]+'` ile TÜM nesne türlerini taratınca görüldü).
--    Bir view'ın kendisi SELECT gerektirir — alttaki tabloların sahibi
--    (app_migrate) olduğu için view'ın SELECT'i alttaki GRANT'lerden
--    BAĞIMSIZDIR (Postgres view'ları varsayılan olarak SAHİBİN izniyle
--    tabloları okur, ama view'ın KENDİSİNE SELECT ayrıca gerekir).
GRANT SELECT ON :"schema".v_budget_summary TO app_runtime;

-- ── S3 tur 15 — docker log (marker-tabanlı, `\dp`/`information_schema`
--    DEĞİL — pozitif kontrolle doğrulandı, bkz. tur 14 notu):
--    `approval_requests` UPDATE — onay/red kararı yazma (approve/reject
--      route'ları `status`/`approval_levels`/`approved_by_id` günceller).
--    `plan_approval_history` INSERT — plan onay/red/submit AKSİYON İZİ
--      (audit-benzeri, ama silinebilir — cleanupTestPlans zaten DELETE
--      ediyordu, INSERT tarafı hiç granted değildi).
GRANT UPDATE ON :"schema".approval_requests TO app_runtime;
GRANT INSERT ON :"schema".plan_approval_history TO app_runtime;

-- ── S3 tur 16 — docker log, 40 hata (tekilleştirildi):
--    `agreement_transactions` INSERT — off-invoice transaction oluşturma
--      (POST /agreement-transactions, createOffInvoiceTransaction) —
--      SELECT/DELETE zaten vardı, INSERT hiç granted değildi.
--      ⚠️ BAYAT (2026-08-16, KARAR 1): o DELETE KALDIRILDI — bu tablo bir
--      defter kaydıdır (K-2.3.4 · INV-L-003). Bugün: SELECT + INSERT.
--    `admin_audit_logs` UPDATE — YALNIZ `alert_sent` SÜTUNU (BRD "audit
--      immutable" ilkesiyle çelişmez: bu satırın OLAY İÇERİĞİNİ (action,
--      entity, timestamp) değil, bir bildirim teslim bayrağını günceller —
--      `admin-audit.service.ts` `flushPendingAlert`/`triggerAlert`, yüksek
--      riskli aksiyon sonrası alert kanalına iletim sonucu). Bilinçli
--      olarak TABLO DÜZEYİNDE değil, SÜTUN DÜZEYİNDE verildi — audit
--      satırının kalan alanlarına app_runtime'ın UPDATE hakkı yok.
GRANT INSERT ON :"schema".agreement_transactions TO app_runtime;
GRANT UPDATE (alert_sent) ON :"schema".admin_audit_logs TO app_runtime;

-- ── S3 tur 17 — docker log: `ledger_entries` UPDATE — YALNIZ
--    `is_reversed`/`updated_at` (reversal.service.ts, orijinal DEBIT
--    satırını "tersine çevrildi" işaretler; append-only ilkesi korunur —
--    `amount`/`entry_type` gibi parasal alanlar bu UPDATE'te YOK, tersine
--    çevirme yeni bir CREDIT satırı olarak ayrıca INSERT edilir). Sütun
--    düzeyinde verildi, tüm tabloya değil.
GRANT UPDATE (is_reversed, updated_at) ON :"schema".ledger_entries TO app_runtime;

-- ── S3 tur 18 — docker log: `agreement_transactions` UPDATE — YALNIZ
--    `is_reversed`/`updated_at` (reversal.service.ts, orijinal off-invoice
--    transaction'ı "tersine çevrildi" işaretler — `amount`/`invoice_no`
--    gibi parasal/kimlik alanları bu UPDATE'te YOK). Aynı gerekçe,
--    `ledger_entries` tur 17 ile simetrik.
GRANT UPDATE (is_reversed, updated_at) ON :"schema".agreement_transactions TO app_runtime;

-- ── S3 tur 19 — DELETE eksikliği permission log'unda GÖRÜNMEDİ ama test
--    başarısızlığı olarak ortaya çıktı: `plan-scale-validation.e2e-spec.ts`
--    (T-083a) kendi `afterAll`'ında `DELETE FROM main.mechanics WHERE id =
--    ANY(...)` çalıştırıyor (hard delete, seed-e2e.ts'in cleanup deseniyle
--    aynı) — ama `mechanics` yalnız SELECT/INSERT/UPDATE almıştı (tur 4),
--    DELETE hiç. Sonuç: cleanup HER TURDA sessizce başarısız oluyordu
--    (afterAll'ın kendi hata yakalaması yok, ama jest başarısızlığı ayrı
--    bir sonraki `it()`'in DUPLICATE KEY (409) almasıydı — statik kod
--    ile yakalanmış OLMALIYDI, tur 3'te bu dosya henüz taranmamıştı).
--    Aynı sınıf: `admin_audit_logs` (entity_type='mechanic') DELETE'i
--    zaten vardı (tur 5, genel DELETE).
--    ⚠️ BAYAT (2026-08-16, KARAR 1): o DELETE de KALDIRILDI (K-2.11.6 ·
--    K-2.11.7 — denetim kaydı DB seviyesinde korunur). İlgili test temizliği
--    artık DDL-yetkili bağlantı üzerinden koşuyor.
GRANT DELETE ON :"schema".mechanics TO app_runtime;

-- ── S3 tur 20 (T-214, 2026-08-17) — `approval_policies` HİÇ granted
--    değildi: tablo 1803000000000 migration'ında yaratıldığında hiçbir
--    üretim tüketicisi yoktu (ölçüldü, `docs/verification/T214_HAZIRLIK_
--    OLCUMU.md`: "ApprovalPolicy'yi import eden ÜRETİM dosyası: 0"), bu
--    yüzden bu envanter o turda tabloyu hiç görmedi. T-214 ilk yazma yolunu
--    (`PATCH /approval-policies/:id`) ekleyince e2e manuel doğrulama
--    "permission denied for table approval_policies" ile düştü — ölçüldü,
--    izole e2e koşumu, `app_runtime` bağlantısı, `SELECT ... FROM main.
--    approval_policies` STATEMENT'i.
--    SELECT: `ApprovalPolicyRepository.findById` (var olduğunu + tenant
--      sahipliğini doğrulama, PATCH'in ilk adımı).
--    UPDATE: `ApprovalPolicyRepository.updatePolicySelection` — `template`/
--      `amount_threshold`/`updated_by`/`updated_at` günceller. Sütun
--      düzeyinde KISITLANMADI — bu bir defter/denetim tablosu değil
--      (K-2.11.6/K-2.11.7 buraya uygulanmıyor), ADMIN'in bilerek
--      güncellediği bir tenant POLİTİKA seçimi (K-2.5.13c).
GRANT SELECT, UPDATE ON :"schema".approval_policies TO app_runtime;

-- ── S3 tur 21 (T-241, 2026-08-19) — `user_scopes` yalnız SELECT taşıyordu
--    (tur 3, AccessScopeService'in OKUMA yolu — resolveScope). T-241 ile
--    `POST /users` artık PLANNER/CATEGORY_MANAGER yaratılırken kapsam
--    satır(lar)ını AYNI transaction'da YAZIYOR (user.service.ts#create,
--    `dataSource.transaction` içinde `manager.getRepository(UserScope).save`)
--    — ölçüldü, izole e2e koşumu (`test/user-scope-creation.e2e-spec.ts`),
--    `app_runtime` bağlantısı: "permission denied for table user_scopes"
--    (INSERT), STATEMENT `INSERT INTO "main"."user_scopes"(...)`. Transaction
--    bu hatayla ROLLBACK oldu — kullanıcı satırı da GERİ ALINDI (atomiklik
--    tam da tasarlandığı gibi çalıştı; eksik olan yalnızca DB-rol izniydi).
--    UPDATE/DELETE bilerek verilmedi: T-241'in kapsamı yalnız YARATMA
--    (`isActive: true` ile INSERT); kapsam GÜNCELLEME ayrı bir task
--    ([[T-242]]) — o task kendi GRANT ihtiyacını kendi S3 turunda ölçer.
GRANT INSERT ON :"schema".user_scopes TO app_runtime;

-- ── S3 tur 22 ([[T-242a]], 2026-08-20) — yukarıdaki notun öngördüğü tur.
--    `UserService#updateScope` (`PATCH /users/:id/scope`, Z15 KARAR 1 — TAM
--    DEĞİŞTİRME) `user_scopes`'un `(user_id, cpl_id, category_id)` üzerindeki
--    UNIQUE INDEX'i PARTIAL OLMADIĞI için (bkz. user-scope.entity.ts'in
--    JSDoc'u) var olan bir satırı deaktive edip aynı çifti yeniden INSERT
--    edemez — reaktivasyon (`isActive: false → true`) ve deaktivasyon
--    (`isActive: true → false`) UPDATE gerektirir. Ölçüldü: izole e2e koşumu
--    (`test/user-scope-update.e2e-spec.ts`), `app_runtime` bağlantısı:
--    "permission denied for table user_scopes" (UPDATE),
--    `UPDATE "main"."user_scopes" SET "is_active" = ...`. Transaction bu
--    hatayla ROLLBACK oldu (audit kaydı da geri alındı — atomiklik burada da
--    tasarlandığı gibi çalıştı). DELETE hâlâ bilerek verilmedi: replace
--    semantiği satırları SİLMEZ, `isActive` ile deaktive eder (T-244'ün
--    audit-before/after okuma yolu ve seed'in idempotent upsert deseniyle
--    tutarlı — aktif olmayan bir satır hâlâ okunabilir kalır, geri dönüşü
--    bir DELETE'in tersine çevrilmesinden daha ucuzdur).
--
--    ⚠️ M1 (code-review, ürün sahibi kararı 2026-08-20) — KOLON DÜZEYİNE
--    DARALTILDI. Dosyanın kendi kalıbı budur (`admin_audit_logs
--    (alert_sent)` :348, `ledger_entries (is_reversed, updated_at)` :356,
--    `agreement_transactions (...)` :363) ve bu tablo ÖZELLİKLE kritik:
--    kimin NEYİ GÖRDÜĞÜNÜ tanımlıyor — `app_runtime`'ın `user_id`/`cpl_id`/
--    `category_id`'yi yazabilmesi bir kullanıcının kapsamını BAŞKASINA
--    taşıyabilmesi demek (`K-2.6.13f` asgari yetki). Liste TAHMİNDEN değil
--    ÖLÇÜMDEN: `NODE_ENV=development` ile TypeORM SQL logu açılıp iki FARKLI
--    aktörle (deaktivasyon admin1, reaktivasyon admin2) bir deaktivasyon +
--    bir reaktivasyon koşturuldu (iki farklı aktör KASITLI — aynı aktör
--    kullanılsaydı `updated_by`/`created_by` DEĞİŞMEZ görünüp TypeORM'un
--    diff-tabanlı UPDATE'i o kolonu SET listesinden atlardı, liste eksik
--    ölçülürdü). Sonuç (TAM SQL, `user.service.ts#updateScope`):
--      UPDATE ... SET "updated_by"=$1, "is_active"=$2, "updated_at"=CURRENT_TIMESTAMP  (deaktivasyon)
--      UPDATE ... SET "created_by"=$1, "updated_by"=$2, "is_active"=$3, "updated_at"=CURRENT_TIMESTAMP  (reaktivasyon, M2)
--    `updated_at` `@UpdateDateColumn` ile OTOMATİK (parametre değil,
--    `CURRENT_TIMESTAMP` literali) — GRANT listesine yine de dahil, kolon
--    düzeyinde kısıtlanmış bir UPDATE `SET` listesindeki HER kolon için
--    yetki ister (otomatik dolduruluyor olması istisna yapmaz).
GRANT UPDATE (created_by, updated_by, is_active, updated_at)
  ON :"schema".user_scopes TO app_runtime;

-- ── S3 tur 23 ([[T-249]], 2026-08-20) — üç tablonun `app_runtime`'da
--    SIFIR ayrıcalığı vardı ve ÜÇÜNÜN de canlı (üretim) rotası vardı; e2e
--    kapsamı sıfır olduğu için bu S3 döngüsü hiç tetiklenmemişti
--    (`docs/verification/DB_ROL_IZIN_ENVANTERI.md`'nin kendi öngörüsü:
--    "yeni bir e2e/production yolu o tabloya dokunduğunda genişletilir" —
--    üretim yolu zaten vardı, dokunan e2e yoktu). Ölçüldü: `SET ROLE
--    app_runtime; SELECT count(*) FROM main.<tablo>` üçünde de
--    "permission denied", POZ. KONTROL `main.agreements` (SELECT çalışır).
--
--    Fiiller TAHMİN EDİLMEDİ — kod okuması + `test/
--    t249-app-runtime-live-route-grants.e2e-spec.ts`'in GRANT'siz koşumu
--    (kırmızı, task raporunda tam log) + GRANT'li koşumu (yeşil, aynı
--    dosya) ile ölçüldü.
--
--    `notifications` — SELECT (`findByRecipient`/`findUnreadByRecipient`),
--      UPDATE (`markAsRead` → `save()` var olan satırda), VE ARTIK INSERT.
--      ⚠️ `T-318`/`T-322` (`Z59`, 2026-08-28) — bu bloğun "İlke 1, bugün
--      ihtiyacı yok" gerekçesi ÇÜRÜDÜ: `BudgetTierNotificationService
--      #evaluateAndNotify` artık `NotificationService#createNotification`'ın
--      CANLI üreticisi (RESERVE/COMMIT/RELEASE'ten sonra WARNING/
--      FINANCE_REVIEW kademe geçişinde çağrılıyor). Ölçüldü: GRANT'siz
--      DB'de tam e2e koşumu `permission denied for table notifications`
--      ile `budget-envelope-split.e2e-spec.ts` (SP-E2E-06) ve
--      `role-journey.e2e-spec.ts` (C9c) suite'lerini 500'e düşürüyordu —
--      bu guard'ın kendi belgelediği İKİNCİ SINIR'ın ("okuyor ama
--      yazamıyor" ayrımını YAKALAMAZ) canlı bir örneği; `app-runtime-
--      grants.sh` bunu YAKALAMAZ (tablonun SELECT/UPDATE'i zaten vardı),
--      yalnız e2e ölçtü.
GRANT SELECT, INSERT, UPDATE ON :"schema".notifications TO app_runtime;
--    `brands` — SELECT (`findAll`/`findOne`/`findByCode`), INSERT
--      (`create` → `save()` yeni satır), UPDATE (`update`/`remove` →
--      `save()`/`softRemove()`, ikisi de var olan satırda). Hard DELETE
--      BİLEREK VERİLMEDİ: `remove()` → `softRemove()` (`deleted_at`
--      UPDATE'i, BaseEntity `@DeleteDateColumn`) — hiçbir yol `.delete()`
--      çağırmıyor.
GRANT SELECT, INSERT, UPDATE ON :"schema".brands TO app_runtime;
--    `mechanic_spend_breakdown` — ⚠️ görev dosyasının canlı rota atfı
--    (`/finance-reporting`) YANLIŞ ÖLÇÜLMÜŞTÜ ve düzeltildi (T-249 task
--    raporu): `finance-reporting.service.ts` VE `spend-calculation.
--    service.ts`'in `mechanicSpendBreakdownRepository` enjeksiyonu İKİSİ
--    DE ÖLÜ (constructor dışında hiç kullanılmıyor, ölçüldü: `grep -n
--    "mechanicSpendBreakdownRepository\."`). TEK canlı tüketici
--    `spend-distribution.service.ts` (`SpendDistributionService`),
--    controller'ı `/spend-calculation/*`. SELECT (`getDistributionBreakdown`
--    LEFT JOIN, `recalculateDistributionOnVolumeChange` `.find()`),
--    INSERT (`saveBreakdowns` → yeni entity `.save()`), DELETE
--    (`saveBreakdowns` → `.delete()`, HER ZAMAN var olan satırları silip
--    yeniden yaratır). UPDATE BİLEREK VERİLMEDİ: bu tablonun hiçbir yolu
--    var olan bir satırı `.save()` ile GÜNCELLEMİYOR.
GRANT SELECT, INSERT, DELETE ON :"schema".mechanic_spend_breakdown TO app_runtime;
--    `plan_mechanic_values` — AYRI BİR TABLO ama AYNI ölçüm turunda
--    ortaya çıktı: bu tablo tur 4/5'te YALNIZ SELECT + DELETE almıştı,
--    INSERT/UPDATE HİÇ GRANTED değildi — ve `SpendDistributionService`
--    (yukarıdaki `mechanic_spend_breakdown` tüketicisiyle AYNI dosya)
--    HEM yeni satır yaratıyor (`distributeMechanicSpend`, satır ~105,
--    `PlanMechanicValue` yoksa `.create()` + `.save()`) HEM var olanı
--    güncelliyor (satır ~173/269, hesaplanan spend'i yazan `.save()`).
--    Bu tablonun TÜM yazıcıları aynı serviste (`grep -n
--    "planMechanicValueRepository\.\(save\|create\)" src` → tek dosya) —
--    yani `/spend-calculation/*`'ın YAZMA tarafı GRANT'siz DELİĞİN
--    TAMAMIYDI, yalnız `mechanic_spend_breakdown` değil. Ölçüldü: bu
--    dosyanın e2e'si GRANT'siz `POST /spend-calculation/distribute` ile
--    "permission denied for table plan_mechanic_values" verdi (task
--    raporu, tam log).
GRANT INSERT, UPDATE ON :"schema".plan_mechanic_values TO app_runtime;

-- ── S3 tur 24 ([[T-269]], 2026-08-23) — `lta_plan_overrides` SIFIR
--    ayrıcalığı vardı, ve `lta-agreement.repository.ts:39` `findById`'nin
--    `relations` dizisi `'planOverrides'` taşıyordu — ölçüldü:
--      `has_table_privilege('app_runtime','main.lta_plan_overrides','SELECT')`
--      → f, POZ. KONTROL `main.lta_agreements` → t.
--    `findById`'yi BEŞ metot çağırıyor, DÖRDÜ canlı `@Roles(ADMIN)` ucu
--    (`createAgreement`/`updateAgreement`/`activateAgreement`/
--    `terminateAgreement`), biri `findOne` (`GET /lta-agreements/:id`,
--    T-265'in tüketicisiz ucu) — hepsi `permission denied for table
--    lta_plan_overrides` ile 500 dönüyordu.
--
--    SELECT: `LTAAgreementRepository.findById`/`findActiveForCPL`'in
--      `leftJoinAndSelect('lta.planOverrides', ...)` / relations okuması.
--    INSERT/UPDATE/DELETE BİLEREK VERİLMEDİ — ölçüldü (`grep -rn
--    "LTAPlanOverride\|ltaPlanOverride" src/modules` → yalnız
--    `lta.module.ts`'in T-250 tarihli "BİLEREK burada YOK" yorumu, sıfır
--    servis/repository/controller yazıcısı): bu tabloya yazan hiçbir
--    üretim yolu yok, yalnız migration (`1771202000000`) ve
--    `seeds/cleanup-data.ts` — ikisi de `app_migrate` ile çalışır
--    (K-2.6.13), `app_runtime` ile DEĞİL. İlke 1: bugün ihtiyacı olmayan
--    izin verilmez.
--
--    ⚠️ NOT (Team Lead'e rapor, bu turun kapsamı DIŞINDA): `lta_agreements`/
--    `lta_rates` üzerinde `app_runtime`'ın INSERT/UPDATE'i de HİÇ YOK
--    (yalnız SELECT — tur 10/11). Yani bu GRANT, DÖRT canlı ADMIN ucundan
--    yalnız `findOne`'ı (GET, okuma) açar; `createAgreement`/
--    `updateAgreement`/`activateAgreement`/`terminateAgreement` AYRI ve
--    DAHA BÜYÜK bir izin boşluğu yüzünden 500 vermeye DEVAM EDER —
--    T-269 task raporunda tam ölçüm (canlı `POST /lta-agreements` 500 +
--    `SET ROLE app_runtime; INSERT/UPDATE ... lta_agreements` → "permission
--    denied for table lta_agreements", satır YAZILMADI). Yeni bir task
--    gerektirir.
GRANT SELECT ON :"schema".lta_plan_overrides TO app_runtime;

-- ── S3 tur 25 ([[T-271]], 2026-08-23) — tur 24'ün "NOT (kapsam dışı)"
--    ile bıraktığı boşluk: `lta_agreements`/`lta_rates` üzerinde
--    `app_runtime`'ın SIFIR INSERT/UPDATE/DELETE'i vardı (yalnız SELECT —
--    tur 10/11). Dört canlı `@Roles(ADMIN)` ucunun (create/update/
--    activate/terminate) DÖRDÜ de bu yüzden `permission denied` ile 500
--    veriyordu — ölçüldü, `SET ROLE app_runtime; INSERT INTO
--    main.lta_agreements ...` → "permission denied for table
--    lta_agreements".
--
--    KAPSAM — her fiil bir üretim yazma yoluna atıflı
--    (`lta-agreement.service.ts`, `LTAAgreementRepository`/
--    `ltaRateRepository` DI çağrıları grep'lendi):
--
--    lta_agreements INSERT — `createAgreement` → `ltaRepository.create()`
--      + `.save()` (satır 81/93).
--    lta_agreements UPDATE — `updateAgreement`/`activateAgreement`/
--      `terminateAgreement`in HEPSİ `ltaRepository.save(agreement)` ile
--      var olan satırı günceller (satır 242/270/291). DELETE VERİLMEDİ:
--      `LTAAgreementRepository.softRemove` tanımlı ama sıfır çağıranı var
--      — ölçüldü (`grep -n "ltaRepository\." src/modules/shared/lta/
--      lta-agreement.service.ts` → `softRemove` hiç geçmiyor, controller'da
--      DELETE ucu yok). İlke 1: bugün ihtiyacı olmayan izin verilmez.
--
--    lta_rates INSERT — `createAgreement` VE `updateAgreement`'ın rate
--      güncellemesi, ikisi de `ltaRateRepository.create()` (yeni entity,
--      id yok) + `.save()` — TypeORM `save()` id'siz entity'de HER ZAMAN
--      INSERT üretir (satır 104/120, 224/239).
--    lta_rates DELETE — `updateAgreement`, `dto.rates` gönderildiğinde
--      var olan oranları `ltaRateRepository.delete({ ltaAgreementId: id
--      })` ile siliyor, yeniden yaratmadan ÖNCE (satır 214).
--
--    ⚠️ lta_rates UPDATE — İLK ölçümde (yalnız `grep -n
--    "ltaRateRepository\."` — DI-çağrı yüzeyi) "gerekmiyor" sanıldı: iki
--    yazma yolu da (create/update) `.create()`+`.save()`, fetch-then-mutate
--    yok. YANLIŞTI — canlı sorgu logu (`/private/tmp/backend-t269-2.log`)
--    çürüttü: `LTAAgreement.rates` `{ cascade: true }` (`lta-agreement.
--    entity.ts:67`), ve `findById` her zaman `rates` relation'ını yüklüyor
--    (satır 34-41). `updateAgreement`/`activateAgreement`/
--    `terminateAgreement` bu YÜKLÜ agreement'ı `.save()` ettiğinde, TypeORM
--    cascade'i agreement alanları DEĞİŞMESE BİLE `rates` koleksiyonunun
--    HER elemanını yeniden persist ediyor — ölçülmüş örnek (terminate):
--      UPDATE "main"."lta_rates" SET "channel_id" = $1, "category_id" = $2,
--        "updated_at" = CURRENT_TIMESTAMP WHERE "id" IN ($3)
--      -- PARAMETERS: [null,null,"<var olan rate id>"]
--    Bu, beşinci bir yüzey (`§ DÖRT YÜZEY`'in listelemediği): ORM
--    CASCADE — DI çağrısı değil, ham SQL değil, `relations:[]` string'i
--    değil, doğrudan repository erişimi de değil; bir `@OneToMany`
--    dekoratör seçeneğinin (`cascade: true`) `.save(parent)` üzerindeki
--    örtük yan etkisi. Grep bunu YAKALAMAZ — yalnız canlı sorgu logu
--    yakaladı. UPDATE grant'i olmadan `updateAgreement`/`activateAgreement`/
--    `terminateAgreement` ÜÇÜ de bu cascade UPDATE'te 500 veriyordu
--    (`updateAgreement`'ın `dto.rates` GÖNDERMEDİĞİ, hiçbir oranı
--    DEĞİŞTİRMEK NİYETİNDE OLMADIĞI çağrılarda bile).
--
--    ⚠️ REVİZE EDİLDİ (Z23, [[T-273]], 2026-08-23): bu UPDATE'in gerekçesi
--    (yukarısı) artık GEÇERLİ DEĞİL — cascade'in KENDİSİ kaldırıldı
--    (`lta-agreement.entity.ts`). Grant `GRANT INSERT, DELETE ON lta_rates`
--    satırına indirildi (aşağıda, dosyanın sonunda). Bu blok SİLİNMEDİ:
--    beşinci-yüzey dersinin (ORM cascade grep'e görünmez) kaydı hâlâ
--    doğru, yalnız SONUCU (UPDATE grant'i gerekli) artık geçerli değil.
--
--    ⚠️ RAPOR (Team Lead'e, bu turun kapsamı DIŞINDA — `touches:` yalnız
--    `lta-agreement.repository.ts`/bu dosya/test dosyasını kapsıyor,
--    `lta-agreement.service.ts`'e dokunulmadı): `LTAAgreement.planOverrides`
--    de AYNI `{ cascade: true }` taşıyor (satır 70) ve `findById` onu da
--    HER ZAMAN yüklüyor. Bugün boş dizi geldiği için (bu turda test edilen
--    agreement'ların hiçbirinde override YOK) cascade hiç ateşlemedi —
--    ama bir agreement'ın GERÇEK bir `lta_plan_overrides` satırı VARKEN
--    `PATCH`/`activate`/`terminate` çağrılırsa, AYNI cascade mekanizması
--    `lta_plan_overrides`'a da bir UPDATE/INSERT dener ve `permission
--    denied for table lta_plan_overrides` ile 500 verir — o tabloda
--    `app_runtime`'ın YALNIZ SELECT'i var (tur 24, BİLEREK: "bu tabloya
--    yazan hiçbir üretim yolu yok" — o ölçüm INSERT/UPDATE'i DI-çağrı
--    yüzeyinden aradı, cascade yüzeyini SAYMADI). Bu turda BOŞ dizi
--    yüzünden gizli kaldığı için "DUR: yeni bir kusur bulursan ölçümü
--    tamamla, raporla, kapsamı kendin genişletme" maddesi gereği
--    GENİŞLETİLMEDİ — yeni bir task gerektirir, ve muhtemel iki çözüm
--    var: (a) `lta_plan_overrides`'a da INSERT/UPDATE ver (yazma yolunun
--    KENDİSİ cascade'e dönüşür, "yalnız migration yazıyor" varsayımı artık
--    doğru değildir), (b) service'te `cascade:true`'yu kaldırıp
--    `rates`/`planOverrides`'ı `save()`'in dışında tut. Karar ürün
--    sahibine bırakılır — GRANT genişletmek K-2.6.13'ün "asgari ölçülmüş
--    hak" ilkesini zayıflatabilir, kod tarafı ise `touches:` dışı.
--
--    Per-uç maskeleme notu (tur 24'ün NOT'unun devamı, [[T-271]] görev
--    dosyası): `createAgreement`/`activateAgreement`
--    `validateNoOverlappingAgreements`'a (raw SQL, GRANT'ten BAĞIMSIZ bir
--    ayrı kusur — bkz. `lta-agreement.repository.ts` `findOverlappingAgreements`
--    yorumu) HER ZAMAN uğradığı için bu GRANT'ten ÖNCE test edilseydi
--    INSERT/UPDATE'e hiç ULAŞILMAYACAKTI; o kusur AYNI turda düzeltildi —
--    aksi hâlde bu GRANT sessizce ölçülemez kalırdı.
GRANT INSERT, UPDATE ON :"schema".lta_agreements TO app_runtime;

-- ── Z23 ([[T-273]], 2026-08-23) — `lta_rates UPDATE` (yukarısı, S3 tur 25)
--    YALNIZ `LTAAgreement.rates`'in `{ cascade: true }`'ının ürettiği
--    fantom `UPDATE lta_rates SET channel_id=…,category_id=…` içindi —
--    `updateAgreement`/`activateAgreement`/`terminateAgreement`'ın HİÇBİRİ
--    `lta_rates` satırını doğrudan UPDATE ETMİYOR (yalnız `.delete()` +
--    yeni satır `.create()+.save()` — bkz. `lta-agreement.service.ts`).
--    Z23 kararıyla cascade KALDIRILDI (`lta-agreement.entity.ts`) — ölçüldü
--    ([[T-273]] ŞART 2, canlı sorgu logu): cascade kaldırıldıktan SONRA
--    PATCH/activate/terminate'in ÜÇÜ de `lta_rates`'e SIFIR SQL üretiyor.
--    UPDATE artık hiçbir üretim yazma yoluna atıflı değil — İlke 1: bugün
--    ihtiyacı olmayan izin verilmez. `lta_plan_overrides`'a INSERT/UPDATE
--    hiç VERİLMEDİ (S3 tur 24 kararı korunuyor — cascade kaldırıldığı için
--    zaten hiçbir yazma yolu yok, ölçüldü: cascade'in kendisi de BUGÜNKÜ
--    `relations` kümesiyle o tabloya SIFIR SQL üretiyordu).
GRANT INSERT, DELETE ON :"schema".lta_rates TO app_runtime;

-- ── `BL-2` (data-engineer, 2026-09-02) — `app-runtime-grants` guard'ı
--    `baseline_volumes` / `baseline_volume_import_batches` için SIFIR
--    ayrıcalık gördü (T-249 sınıfı: `BaselineVolumeModule`
--    `TypeOrmModule.forFeature([BaselineVolumeImportBatch, BaselineVolume])`
--    ile enjekte ediyor, 02-runtime-grants.sql ikisine de hiç dokunmuyordu —
--    `POST /master-data/baseline-volumes/upload` canlıda `permission denied`
--    ile 500 verirdi).
--
--    Ölçülmüş minimal (repository/service kodu okunarak — ENJEKSİYON değil,
--    ÇAĞRI sayıldı, `baseline-volume.repository.ts`):
--
--    baseline_volume_import_batches:
--      SELECT — `findBatchById` (:80-86, `getBatch`/`getBatchRows`'un ilk adımı).
--      INSERT — `createBatch` (:21-27) → `repo.save(repo.create(data))`; data
--        hiçbir zaman bir `id` taşımıyor (çağıran, `service.ts:272`, yalnız
--        `tenantId`/`createdBy` veriyor) ⇒ TypeORM bunu HER ZAMAN INSERT'e
--        çevirir (id yoksa `save()` upsert'e düşmez). ⚠️ SAPMA: ürün sahibinin
--        ilk öngörüsü UPDATE'i de içeriyordu — ÖLÇÜM ONU DOĞRULAMADI: bu
--        tabloyu güncelleyen HİÇBİR çağrı yok (`grep -n
--        "batchRepo\.\(save\|update\)" baseline-volume.repository.ts` →
--        yalnız `createBatch`'in tek `save`'i, koşulsuz INSERT). İlke 1:
--        bugün ihtiyacı ölçülmeyen izin verilmez — bir güncelleme yolu (ör.
--        batch durumu) eklendiğinde o task kendi UPDATE GRANT'ini ölçer.
--
--    baseline_volumes:
--      SELECT — `findExistingGrainKeys` (:36-66, ADIM 3 ön-kontrolü),
--        `findRowsByBatchId` (:88-96), `countByAcceptance` (:98-114).
--      INSERT — `insertRowsChunked` (:68-77) → `repo.insert(chunk)`; `.insert()`
--        TypeORM'da HER ZAMAN saf SQL `INSERT`tir, `.save()`'in aksine bir
--        var-olan-satır UPDATE'ine asla düşmez (upsert yolu yok, ölçüldü —
--        kod bu metodun tek çağrı yeri, `service.ts:334`).
--      ⛔ UPDATE VERİLMEDİ — ölçüm UPDATE gerektiren hiçbir çağrı bulmadı.
--      ⛔ DELETE ASLA VERİLMEDİ — `ADR 0012` (düzeltme = yeni batch +
--        süpersede, silme değil; `INV-R-004`'ün sürümlü `REPLACED` modeliyle
--        aynı aile) ve ölçüm bunu doğruluyor: `grep -n
--        "rowRepo\.\(delete\|remove\|softDelete\)" baseline-volume.
--        repository.ts` → 0 satır.
GRANT SELECT, INSERT ON :"schema".baseline_volume_import_batches TO app_runtime;
GRANT SELECT, INSERT ON :"schema".baseline_volumes TO app_runtime;

-- ── `BL-3` ADIM 1 (data-engineer, `T-358`/`Z87`, 2026-09-02) —
--    `main.baseline_volume_import_batch_rows` ölçüm ÖNCESİ GRANT: bu
--    migration'la BİRLİKTE hiçbir uygulama kodu (service/controller/
--    repository) yazılmadı — `T-358`'in DUR listesi bunu açıkça yasakladı
--    (`BL-3` ADIM 2/3'ün işi). Yani `app-runtime-grants` guard'ının kaynak-A
--    ölçümü (ENJEKSİYON/ÇAĞRI taraması) bu tablo için BUGÜN sıfır sonuç
--    verir — GRANT bir ÖLÇÜME değil, `Z87`'nin ŞEKİL hükmüne dayanıyor:
--    `SELECT` + `INSERT`, ⛔ `UPDATE`/`DELETE` YOK (satır IMMUTABLE, düzeltme
--    = yeni batch, `ADR 0012` ruhu — kardeşi `baseline_volumes`/
--    `baseline_volume_import_batches` ile AYNI desen, yukarısı). ADIM 2/3
--    yazma yolunu ekleyince kendi ölçümünü yapar; bu GRANT set'i o turda
--    GENİŞLEMEZ, yalnız DOĞRULANIR (SELECT/INSERT'in üretim çağrı yoluyla
--    eşleştiği ayrıca ölçülür).
GRANT SELECT, INSERT ON :"schema".baseline_volume_import_batch_rows TO app_runtime;

-- ── Z24 (data-engineer, 2026-08-23) — `main.budget_allocations` +
--    `main.budget_transaction_logs` DÜŞÜRÜLDÜ (migration 1811000000000,
--    `Z21` şart 3+4 / `Z24`). Model `K-2.2.3` ihlali olarak doğdu ve
--    tüketicisi kalmadı (`T-265`: `POST /budget-allocations` + kardeş
--    uçların controller dışında SIFIR çağıranı; `BudgetAllocationService`nin
--    SIFIR dış çağıranı — `A2` zarf modeline taşıdı; `BudgetTransactionLog`
--    tek tüketicisi o servisti). İki tablo da `0` satır. Bu dosyanın
--    yukarısındaki ÜÇ GRANT satırı (tur 3: `SELECT, INSERT budget_
--    allocations`; tur 4: `DELETE budget_allocations`,
--    `SELECT, INSERT budget_transaction_logs`) KALDIRILDI — İlke 1: bugün
--    var olmayan bir tabloya izin verilmez. Bu bir GRANT genişletmesi
--    DEĞİL, daralmadır; gerekçe "kapsam uygulandı" değil "tablo SİLİNDİ"dir.
COMMIT;
