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
--    INSERT `budget_allocations`: bütçe tahsisi oluşturma akışı.
--    DELETE `customers`: customer-import e2e'lerinin `cleanupTestCustomers`
--      yardımcı fonksiyonu (`DELETE FROM main.customers WHERE tenant_id =
--      $1 AND code LIKE $2`).
GRANT SELECT ON :"schema".budget_alert_configurations TO app_runtime;
GRANT SELECT, INSERT ON :"schema".budget_allocations TO app_runtime;
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
--    DELETE `budget_allocations`: bütçe tahsisi temizleme (test cleanup).
--    INSERT `admin_audit_logs`: her onay/iş işlemi audit satırı yazıyor
--      (BRD "her işlem loglanır").
GRANT DELETE ON :"schema".budget_allocations TO app_runtime;
GRANT INSERT ON :"schema".admin_audit_logs TO app_runtime;
-- `SELECT ... FOR UPDATE` (bütçe zarfı rezervasyon kilidi,
-- budget-reservation.service.ts) SELECT'e ek olarak UPDATE ister — aynı
-- `agreements` gerekçesi, ölçüldü aynı turda.
GRANT SELECT, INSERT, UPDATE ON :"schema".budget_envelopes TO app_runtime;
GRANT SELECT, INSERT ON :"schema".budget_transaction_logs TO app_runtime;
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

COMMIT;
