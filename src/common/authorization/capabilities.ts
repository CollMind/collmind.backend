import { UserRole } from '../../database/entities/user.entity';

/**
 * ADIM 3 Faz A — `CAPABILITIES` sabiti + `ROLE_CAPABILITIES` haritası.
 *
 * Kaynak zinciri (bağlayıcı sıraya göre):
 *   `0056-K3` (2026-08-16, ürün sahibi) → seçenek (b): yetenek SABİT tanımlanır,
 *     TABLO YOK. `capabilities.ts`'te `const CAPABILITIES` + `ROLE_CAPABILITIES`
 *     haritası — bu dosya.
 *   `04_KARAR_KAYDI.md` `Z4` → `capabilities`/`role_capabilities` TABLOLARI ölü
 *     yapı (ayrı bir kaldırma kararı, [[T-233]] — bu dosyayla İLGİSİZ; oradaki
 *     `Capability`/`RoleCapability` TypeORM entity'leri `role.entity.ts` içinde
 *     tanımlı VERİ TABLOSU sınıflarıdır, burası KOD sabitidir).
 *   `docs/analysis/0072-adim3-route-yetki-olcumu.md` → taksonomi TABANI: 237
 *     route'un modül × işlem-sınıfı dağılımı, `24` dolu hücre.
 *   `docs/process/FAZ1_PLAN.md §5 Faz A` → bu turun kapsamı (sabit + harita +
 *     ad düzeltmeleri; `@RequireCapability` TÜKETİCİSİ YOK — Faz B, ayrı tur).
 *
 * ⚠️ **YETENEK ADI = MODÜL × İŞLEM SINIFI, rol kümesi değil.** `0072 §2`
 * ölçtü: 160 `@Roles`'lu route arasında **15 farklı rol kümesi** var, dağılım
 * çarpık (`ADMIN` tek başına 56 uç, kuyrukta 8 küme ≤3 uç). Küme başına
 * yetenek adlandırılsaydı 15 isim doğardı ve yarısı birer uca hizmet ederdi
 * (`İlke 1` ihlali). Bu yüzden yetenek MODÜL × İŞLEM SINIFI bazlı — 9 modül ×
 * 4 sınıf (okuma/yazma/onay-iş-akışı/yönetim) üst sınırı 36, **fiilen dolu
 * hücre 24**.
 *
 * ### Taksonomi `0072 §3`'ün sezgiselinden türedi, ve BU TURDA madde madde
 * doğrulandı (10 düzeltme — 0072'nin kendi uyarısı: "bir sonraki tur
 * adlandırma yaparken madde madde doğrulanmalı"):
 *
 * ```
 * reviewPlan (plan.controller.ts)        yazma → onay      "approve/reject/
 *                                                            request changes/
 *                                                            escalate" özeti;
 *                                                            fiil deseni
 *                                                            (approve|reject|
 *                                                            …) metot ADINDA
 *                                                            yok ama BODY'de
 *                                                            bir onay kararı.
 * suspend (tenant.controller.ts)         yazma → yönetim   activate/deactivate
 *                                                            ile aynı yaşam
 *                                                            döngüsü ailesi.
 * terminate (lta-agreement.controller)   yazma → yönetim   activate'in
 *                                                            simetriği (aynı
 *                                                            entity, aynı
 *                                                            sınıf).
 * getApplicableMechanics (mechanic)      yazma → okuma     POST ama BODY'de
 * checkCombination (mechanic)            yazma → okuma     filtre/sorgu var,
 * getForecastReport (budget-allocation)  yazma → okuma     hiçbir mutasyon
 * checkAvailability (budget-allocation)  yazma → okuma     YOK — POST yalnız
 * getRatesForContext (lta-agreement)     yazma → okuma     karmaşık body
 *                                                            taşımak için.
 * validateFormula (kpi + mechanic, x2)   yazma → yönetim   ADMIN-only, kalıcı
 *                                                            yazma yok, KPI/
 *                                                            mekanik TANIM
 *                                                            aracı — seed/
 *                                                            clone ailesiyle
 *                                                            aynı sınıf.
 *
 * ── 11. düzeltme (2026-08-17, ürün sahibi) ────────────────────────────────
 * PATCH /approval-policies/:id           yazma → YÖNETİM   onay POLİTİKASI
 *   (approval-policy.controller.ts:33)                       konfigürasyonu;
 *                                                            `@Roles(ADMIN)`
 *                                                            BİLİNÇLİ (T-214'ün
 *                                                            yazma yolunun
 *                                                            sahibi). `K-2.5.13c`
 *                                                            "tenant şablon
 *                                                            seçer" der — KİMİN
 *                                                            seçtiği ayrı soru,
 *                                                            ve bugünkü cevap
 *                                                            ADMIN. Bir
 *                                                            konfigürasyon ucu
 *                                                            yazma sınıfına
 *                                                            düşmemeli.
 * ```
 *
 * İlk 10 düzeltme **hiçbiri yeni hücre açmadı** — hepsi zaten dolu olan bir
 * (modül, sınıf) hücresine taşındı, yani `24` dolu hücre sayısı DEĞİŞMEDİ.
 * 11. düzeltme de aynı: `SHARED_WRITE` → `SHARED_MANAGE`, ikisi de zaten dolu.
 *
 * ⚠️ **Ve 11. düzeltme `SHARED_WRITE`'ın UNION'INI DEĞİŞTİRMEDİ** — ölçüldü:
 * `{ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER}` aynı kaldı, çünkü kalan `9`
 * route zaten dört rolün hepsini katkılıyor. Yani bu düzeltmenin etkisi
 * union'ın **kümesinde** değil, `approval-policies`'in hangi ada **eşleneceğinde**:
 * artık `SHARED_MANAGE` (= yalnız `ADMIN`), `SHARED_WRITE` (= 4 rol) değil.
 * Fark `Faz B`'de ortaya çıkar — ve tam olarak orada önemliydi.
 *
 * ### `§7.2` (BRD Section_07, `docs/brd/01_Main_BRD/Section_07_Security_Roles.md`)
 * ↔ bu taksonomi — `0056`'nın kendi karşılaştırması (B.4), burada yan yana:
 *
 * `§7.2` **20** ince-taneli, İŞ-KAVRAMI bazlı yetenek tanımlıyor
 * (`plan.create` · `plan.approve_L1` · `plan.approve_L2` · `budget.override` ·
 * `policy.configure` · `audit.view` … — 8 iş kavramı: plan/agreement/budget/
 * master_data/kpi/policy/import/audit). Bu dosyanın **24**'ü KOD-MODÜLÜ bazlı
 * (9 modül: admin/customer/master-data/modes/notification/other/shared/
 * tenant/user) × 4 işlem sınıfı. **İkisi aynı eksen değil** — karşılaştırma
 * birebir eşlenemez:
 *   - `§7.2`'de YOK: `customer.*` · `tenant.*` · `user.*` · `notification.*` ·
 *     health-check — bu dosyada 4 modülün 10 hücresi bu kod-yüzeyini kapsıyor,
 *     BRD'nin 20 listesi bunlara hiç değinmiyor.
 *   - Bu dosyada YOK: `plan.approve_L1` ↔ `plan.approve_L2` ayrımı (iki-seviyeli
 *     onay) — `MODES_APPROVE` (bloklu, aşağı bkz.) tek bir kaba sınıf; L1/L2
 *     ayrımı burada YOK, onay şablonu/politika motoruna bırakılmış olabilir
 *     (`K-2.5.13a`) — bu dosyanın kapsamı dışında, doğrulanmadı.
 * `0056-K3` seçeneği (a)'yı (BRD'nin 20'si, tam CBAC) **reddetti**: seed
 * gerektirir, tenant-başına özelleştirme bugün istenmiyor. Bu fark o kararın
 * ölçülmüş sonucu — yeni bir sapma değil.
 *
 * ### `9/24` hücre — `ADIM 3 Faz A` (2026-08-17): `4` ÇÖZÜLDÜ, `5` DUR
 *
 * Ürün sahibi kararı (2026-08-17): **(a) UNION, ŞARTLI.** Her bloke hücre
 * route-route ölçüldü (dekoratör taraması, `find-entity` dersine göre —
 * dosya adı değil `@(Get|Post|Put|Patch|Delete)` + `@Roles` bloğu) ve ÜÇ
 * DALDAN birine yerleştirildi:
 *
 * ```
 * 1  hücre içi tüm kümeler AYNI      →  union = DEĞİŞİKLİK YOK, mekanik
 * 2  hücrede FİLTRESİZ route var     →  o route union'a GİRMEZ (K-2.6.6'nın
 *                                        konusu; report-only fazına kalır)
 * 3  kümeler FARKLI                  →  GENİŞLEME listesi, tek tek yazılı
 * ```
 *
 * Ve iki ek `DUR` koşulu (görev tanımından, mekanik uygulanmadı):
 *   - genişleme bir rolü ONAY/İŞ-AKIŞI yeteneğine sokuyorsa (`K-2.5.12`)
 *   - union hücreyi TÜM 5 role açıyorsa (**çöküş**, genişleme değil)
 *
 * ### `*_APPROVE` — `K-2.5.12`'ye devredildi, ve BİR SINIRLA (2026-08-17)
 *
 * Ürün sahibi kararı: *"Onay yetkisi bir rol kümesi değil, şablonun
 * tanımladığı bir kademe — `K-2.5.12` onu `approval_policies`'e bağladı.
 * Bu iki hücre `Faz B`'de `@RequireCapability` ALMAZ; onay akışı kendi
 * mekanizmasını kullanır."*
 *
 * ⚠️ **Ama bir sınır — ve bugün taksonomi bunu AYIRMIYOR:**
 * ```
 * "onaylayabilir mi"          → şablon/kademe kararı   → K-2.5.12, YETENEK DEĞİL
 * "onay EKRANINI görebilir mi" → bir YETENEK
 * ```
 * `MODES_APPROVE`/`SHARED_APPROVE` bugün ikisini de tek adın altında
 * topluyor (ör. `GET /approvals/:id` ve `GET /plans/:id/approval-history`
 * `*_READ` hücresine düşmüş — yani okuma tarafı zaten AYRI bir hücrede,
 * ama `pending` listeleri gibi ara vakalar ölçülmedi). `Faz B` bu iki
 * hücreyi atlarken, **görme** tarafının bir yetenek olarak nereye düştüğü
 * ayrıca ölçülmeli — atlanırsa onay ekranı `K-2.6.6`'nın filtresiz
 * kümesine düşer.
 *
 * ```
 * ÇÖZÜLDÜ (4) — ROLE_CAPABILITIES'e bu turda YAZILDI
 *   MODES_WRITE    {ADMIN,FINANCE,PLANNER}                     dal 3
 *   SHARED_WRITE   {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER}    dal 3
 *   TENANT_READ    {ADMIN}                                     dal 1+2 (tek küme + 2 filtresiz hariç)
 *   USER_WRITE     {ADMIN}                                     dal 1+2 (tek küme + 5 filtresiz hariç)
 *
 * DUR (5) — HİÇBİR role atanmadı, ürün sahibine gider
 *   MODES_READ     union = {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY} → ÇÖKÜŞ (tüm roller)
 *   MODES_APPROVE  dal 3 genişleme, ONAY yeteneği               → K-2.5.12
 *   SHARED_READ    union = {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY} → ÇÖKÜŞ (tüm roller)
 *   SHARED_APPROVE dal 3 genişleme, ONAY yeteneği               → K-2.5.12
 *   USER_READ      union = {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY} → ÇÖKÜŞ (tüm roller)
 * ```
 *
 * ⚠️ **Davranışsal etki bu turda SIFIR** — `@RequireCapability` hiçbir
 * route'a uygulanmadı (Faz B, ayrı tur), yani `ÇÖZÜLDÜ` dörtlünün
 * `ROLE_CAPABILITIES`'e yazılması da bugün hiçbir guard'ı değiştirmiyor.
 * `report-only` fazı bu genişlemelerin doğrulama katmanıdır: beklenmedik bir
 * rol orada görünürse düzeltilir.
 *
 * ---
 *
 * #### ÇÖZÜLDÜ — hücre hücre, route × eklenen rol
 *
 * **`MODES_WRITE`** (18 route, filtresiz YOK):
 * ```
 * {ADMIN,FINANCE,PLANNER}  n=1   POST /agreement-transactions                    (create)               — değişiklik yok, zaten union
 * {ADMIN,FINANCE}          n=5   POST /agreement-transactions/upload             (uploadFile)            +PLANNER
 *                                 POST /on-invoice/upload                        (uploadFile)            +PLANNER
 *                                 POST /on-invoice/:batchId/validate             (validateBatch)         +PLANNER
 *                                 POST /on-invoice/:batchId/process              (processBatch)          +PLANNER
 *                                 POST /actuals-first/sales-actuals/upload       (upload, WRITE_ROLES)   +PLANNER
 * {ADMIN,PLANNER}          n=12  POST/PATCH/DELETE /agreements[/:id]             (create/update/delete)  +FINANCE
 *                                 POST/PATCH/DELETE /plans[/:id[/fus/...]]       (create/update/addFu/
 *                                                                                  updateFuTactic/removeFu/
 *                                                                                  updateSkuVolume/delete/
 *                                                                                  calculateKpis/recalculate) +FINANCE
 * ```
 * Gerekçe (neden kabul edildi): `(a) UNION` kararının doğrudan uygulanışı —
 * hiçbir mevcut erişim kapanmadı, en dar iki küme birbirinin eksik rolüyle
 * tamamlandı. **Dikkat:** bu, FINANCE'e 12 Plan-CRUD ucuna (silme dahil) ve
 * PLANNER'a 5 actuals-upload/validate/process ucuna yazma erişimi açıyor —
 * bugün fonksiyonel olarak ayrı iki alan. `report-only` bunu göstermeli.
 *
 * **`SHARED_WRITE`** (14 route; `4` filtresiz HARİÇ + `1` `SHARED_MANAGE`'e
 * taşındı → union `9` route'tan hesaplandı):
 * ```
 * {ADMIN,CATEGORY_MANAGER}  n=1  POST /budget-allocations/reserve                (reserveBudget)         +FINANCE,+PLANNER
 * {ADMIN,FINANCE}           n=5  POST/PATCH /budget-allocations[/:id]            (create/update)         +CATEGORY_MANAGER,+PLANNER
 *                                 POST /budget-allocations/adjust                (adjustUtilization)     +CATEGORY_MANAGER,+PLANNER
 *                                 POST /budget/envelopes[/:id/split]             (createEnvelope/
 *                                                                                  splitEnvelope)         +CATEGORY_MANAGER,+PLANNER
 * {ADMIN,PLANNER}           n=1  POST /budget/reserve                           (reserveBudget)         +CATEGORY_MANAGER,+FINANCE
 * {ADMIN}                   n=2  POST/PATCH /lta-agreements[/:id]               (create/update)         +CATEGORY_MANAGER,+FINANCE,+PLANNER
 * ```
 * Union: `{ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER}` (READONLY dışarıda —
 * çöküş değil).
 *
 * ✅ **`PATCH /approval-policies/:id` UNION'DAN ÇIKARILDI** (2026-08-17,
 * ürün sahibi): *"Bir konfigürasyon ucu yazma sınıfına düşmemeli."*
 * `SHARED_WRITE` → `SHARED_MANAGE` (11. taksonomi düzeltmesi, yukarı bkz.),
 * yani `ADMIN` kalıyor ve union onu 3 role AÇMIYOR. İlk turda `{ADMIN} n=3`
 * içindeydi ve ⚠️ ile işaretlenmişti — işaret bir düzeltmeye dönüştü.
 *
 * Filtresiz `4` (union'a GİRMEDİ, K-2.6.6 kapsamı):
 * `POST /lta-agreements/calculate/base-spend` · `.../planned-spend` ·
 * `POST /spend-calculation/distribute/:planFuId/:mechanicId` ·
 * `.../recalculate-on-volume-change/:skuId` — 0072'nin "hesaplama
 * tetikleyen, korumasız" tespitiyle aynı 4 uç.
 *
 * **`TENANT_READ`** (3 route): `{ADMIN}` — `GET /tenants` tek `@Roles`'lu
 * route, tek küme (dal 1, mekanik). `GET /tenants/:id` ve `.../:id/stats`
 * filtresiz (dal 2, K-2.6.6'ya kalır). Genişleme YOK.
 *
 * **`USER_WRITE`** (9 route): `{ADMIN}` — `POST /users`, `PATCH /users/:id`,
 * `PATCH /users/:id/password`, `DELETE /users/:id` tek küme (dal 1,
 * mekanik). Filtresiz `5` (dal 2, K-2.6.6'ya kalır, ama `3`'ü BİLİNÇLİ
 * açık): `POST /auth/login` · `/auth/refresh` (ikisi `@Public()`, bu turdan
 * önce eklendi) · `POST /auth/logout` (yalnız `JwtAuthGuard`, self-servis)
 * · `PATCH /users/me` · `/users/me/password` (kimlik bazlı self-servis,
 * rol değil). Bunlar kavramsal olarak `USER_WRITE`'ın ADMIN-yönetim
 * anlamıyla AYNI kovada değil — genişleme YOK, ayrı kaldılar.
 *
 * ---
 *
 * #### DUR — hücre hücre, ürün sahibine gider (bu turda ATANMADI)
 *
 * **`MODES_READ`** (37 route, `1` filtresiz — `GET /actuals-first/settlements/summary`,
 * `SettlementController` yalnız `JwtAuthGuard`, JSDoc: *"tüm authenticated
 * kullanıcılar erişebilir, scope serviste filtrelenir"* — bilinçli, self-servis
 * gibi ama işaretsiz). `7` farklı `@Roles` kümesi, union =
 * `{ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY}` — **5 rolün 5'i de.**
 * Bu bir genişleme değil, **çöküş**: bugün `{ADMIN,FINANCE}` olan 7 route
 * (ör. `ledger/envelope/:id`, agreement-transaction template indirmeleri)
 * READONLY/PLANNER/CATEGORY_MANAGER'a da açılırdı.
 *
 * **`MODES_APPROVE`** (13 route, `2` filtresiz — `POST
 * /actuals-first/reversals/agreement-transaction/:transactionId`
 * (`ReversalGuard`) ve `POST /actuals-first/settlements/close/:agreementId`
 * (`SettlementGuard`); ikisi de ALAN guard'lı, korumasız DEĞİL — `0072 §4b`).
 * `3` farklı `@Roles` kümesi: `{ADMIN,PLANNER}` (submit/cancel, n=5) ·
 * `{ADMIN,CATEGORY_MANAGER}` (escalate/approve/reject plan, n=3) ·
 * `{ADMIN,CATEGORY_MANAGER,FINANCE}` (approve/reject agreement + reviewPlan,
 * n=3). Union = `{ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER}` — PLANNER kendi
 * submit'inin dışında bir approve/reject/escalate yetkisi kazanır, FINANCE
 * plan approve/reject/escalate kazanır. **ONAY yeteneği → `K-2.5.12`, DUR.**
 *
 * **`SHARED_READ`** (36 route, `20` filtresiz — `budget-allocations`,
 * `budget` envelope okumaları, `lta-agreements` okumaları,
 * `spend-calculation` validate/breakdown uçlarının TAMAMI; `0072`'nin
 * "shared modülünde en yoğun filtresiz küme" tespitiyle örtüşüyor). `3`
 * farklı `@Roles` kümesi, en genişi `{ADMIN,CATEGORY_MANAGER,FINANCE,
 * PLANNER,READONLY}` (dashboard/approval `my-requests`, n=6) zaten **5
 * rolün 5'i** — union bu yüzden otomatik olarak **çöküş**. Bugün
 * `{ADMIN,FINANCE,READONLY}` olan `finance-reporting`'in risk/varyans/
 * cash-flow uçları (n=3) CATEGORY_MANAGER/PLANNER'a da açılırdı.
 *
 * **`SHARED_APPROVE`** (5 route, filtresiz YOK). `4` farklı `@Roles` kümesi
 * — her route neredeyse kendi kümesinde: `{CATEGORY_MANAGER}` (approval
 * approve/reject, n=2) · `{ADMIN,PLANNER}` (approval cancel, n=1) ·
 * `{ADMIN,FINANCE}` (budget-allocation commit, n=1) ·
 * `{ADMIN,CATEGORY_MANAGER}` (budget-allocation release, n=1). Union =
 * `{ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER}` — CATEGORY_MANAGER'ın bugün
 * yalnız kendisinin sahip olduğu approval approve/reject'i ADMIN/FINANCE/
 * PLANNER'a da açardı. **ONAY yeteneği → `K-2.5.12`, DUR.**
 *
 * **`USER_READ`** (4 route, `2` filtresiz — `GET /users/me`,
 * `GET /users/:id`, kimlik/self-servis + admin lookup karışımı, K-2.6.6
 * kapsamı). `2` farklı `@Roles` kümesi: `{ADMIN,FINANCE}` (`GET /users`,
 * n=1, tüm kullanıcı listesi) ve `{ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
 * READONLY}` (`dashboard-summary`, n=1) — ikincisi zaten **5 rolün 5'i**,
 * union otomatik **çöküş**: `GET /users` (tüm tenant kullanıcı listesi,
 * bugün ADMIN+FINANCE) CATEGORY_MANAGER/PLANNER/READONLY'a da açılırdı.
 *
 * ---
 *
 * #### `5/5` ROL TAŞIYAN ROUTE'LAR — ölçüldü, ve HİPOTEZ ÇÜRÜDÜ
 *
 * Üç `READ` hücresinin çöküşünün kaynağı **`18` route** (ilk sayım `14`
 * demişti — parser iç içe sabiti (`READ_ROLES = [...WRITE_ROLES, …]`) tek
 * geçişte çözemiyordu; **fixpoint** ile düzeltildi, çözülemeyen sabit `0`).
 *
 * Ürün sahibinin hipotezi: *"üçü de kullanıcının kendi verisine ya da özet
 * görünüme bakıyor — `plan.read` ile aynı yetenek değil."* **Ölçüm şartı
 * kondu ve şart TUTMADI** — üçü aynı sınıfta değil:
 *
 * ```
 * SINIF A · aktör scope'u SERVİSTE (@CurrentUser → resolveScopeForFilter)
 *   approval /my-requests    findMyRequests(userId)      — saf kendi verisi
 *   approval /:id            findOne
 *   plan     findAll · findOne · :id/analysis · :id/approval-history
 *                            plan.service.ts:385 `resolveScopeForFilter(actor)`
 *   agreement findAll · findOne · tactics/available
 *   dashboard summary · pending-tasks · cpl-status
 *
 * SINIF B · ÖLÜ İKİZ
 *   user /dashboard-summary  @deprecated — GET /dashboard/summary'nin ikizi
 *                            (user.controller.ts:116). Bir yetenek sorusu
 *                            DEĞİL, bir `İlke 4` kalıntısı.
 *
 * SINIF C · scope YOK, özet DEĞİL  ⛔ HİPOTEZİ ÇÜRÜTEN
 *   sales-actuals /batches · /batches/:batchId · /batches/:batchId/rows
 *                            SATIR DÜZEYİNDE gerçekleşen satış verisi.
 *                            @CurrentUser YOK (dosyada tek kullanımı
 *                            :65, upload rotasında) — yalnız tenantId.
 *   sales-actuals /summary   tek gerçek özet — ama aynı READ_ROLES sabitini
 *                            paylaştığı için diğer üçüyle ayrılamıyor.
 *   finance-reporting /plan-performance   scope YOK.
 * ```
 *
 * ⚠️ **Sorulan soruya doğrudan cevap:** `READ_ROLES` bir ÖZET DEĞİL.
 * Dördünün yalnız biri (`/summary`) özet; `batches/:batchId/rows` satır
 * seviyesinde veri döndürüyor ve **hiçbir kapsam filtresi yok**.
 *
 * 📌 **Ve ölçümün ürettiği sınıf, aranandan farklı ve daha keskin:**
 * *"kendi verisi / özet"* değil — **"aktör kapsamı SERVİS katmanında"**.
 * `SINIF A`'nın 11 route'u `@Roles`'u kaba bir kapı olarak kullanıp asıl
 * daraltmayı satır seviyesinde yapıyor; `SINIF C` ise **hiç daraltmıyor**.
 * İkisi `@Roles` yüzeyinden AYNI görünüyor (`5/5`) — ayrım yalnız servise
 * bakınca çıkıyor. Bu, `POST = yazma` varsayımının kardeşi: **dekoratör bir
 * yüzey, DAVRANIŞ başka.**
 *
 * ⛔ Bu yüzden üç `READ` hücresi **hâlâ DUR** — reklasifikasyon yapılmadı.
 * Ölçüm şartı sağlanmadan bir yetenek adı yazmak `§2.4` ihlali olurdu.
 */

export const CAPABILITIES = {
  ADMIN_READ: 'admin:read',

  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',
  CUSTOMER_MANAGE: 'customer:manage',

  MASTER_DATA_READ: 'master-data:read',
  MASTER_DATA_WRITE: 'master-data:write',
  MASTER_DATA_MANAGE: 'master-data:manage',

  // ⛔ BLOKE (2026-08-17 turundan sonra da) — MODES_READ · MODES_APPROVE.
  // Union çöküşe/onay-genişlemesine düşüyor, ürün sahibi kararı bekliyor.
  // Bkz. yukarıdaki "9/24 hücre — ADIM 3 Faz A" bölümü, "DUR" alt-başlığı.
  MODES_READ: 'modes:read',
  // ✅ ÇÖZÜLDÜ (2026-08-17, UNION) — {ADMIN,FINANCE,PLANNER}. Bkz. yukarı,
  // "ÇÖZÜLDÜ" alt-başlığı.
  MODES_WRITE: 'modes:write',
  MODES_APPROVE: 'modes:approve',
  MODES_MANAGE: 'modes:manage',

  NOTIFICATION_READ: 'notification:read',
  NOTIFICATION_WRITE: 'notification:write',

  // ⛔ BLOKE (2026-08-17 turundan sonra da) — SHARED_READ · SHARED_APPROVE.
  // Bkz. yukarıdaki "DUR" alt-başlığı.
  SHARED_READ: 'shared:read',
  // ✅ ÇÖZÜLDÜ (2026-08-17, UNION) — {ADMIN,CATEGORY_MANAGER,FINANCE,
  // PLANNER}. Bkz. yukarı, "ÇÖZÜLDÜ" alt-başlığı (`approval-policies` uyarısı dahil).
  SHARED_WRITE: 'shared:write',
  SHARED_APPROVE: 'shared:approve',
  // 11. taksonomi düzeltmesi (2026-08-17): `PATCH /approval-policies/:id`
  // SHARED_WRITE'tan BURAYA taşındı — konfigürasyon ucu, ADMIN kalıyor.
  SHARED_MANAGE: 'shared:manage',

  // ✅ ÇÖZÜLDÜ (2026-08-17, dal 1 — tek rol kümesi, mekanik) — {ADMIN}.
  TENANT_READ: 'tenant:read',
  TENANT_WRITE: 'tenant:write',
  TENANT_MANAGE: 'tenant:manage',

  // ⛔ BLOKE (2026-08-17 turundan sonra da) — USER_READ (union çöküşe
  // düşüyor). Bkz. yukarıdaki "DUR" alt-başlığı.
  USER_READ: 'user:read',
  // ✅ ÇÖZÜLDÜ (2026-08-17, dal 1 — tek rol kümesi, mekanik) — {ADMIN}.
  USER_WRITE: 'user:write',
  USER_MANAGE: 'user:manage',

  // `other` modülü (0072 taksonomisi) = `app.controller.ts` health check —
  // tek route, `@Public()` (bu turda eklendi). Yetenek listede duruyor çünkü
  // 0072'nin "24 dolu hücre" tabanının bir parçası; pratikte hiçbir guard
  // buna bakmayacak (route zaten public).
  HEALTH_READ: 'health:read',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/**
 * `ROLE_CAPABILITIES` — TEK harita, `Record<UserRole, Capability[]>`.
 *
 * 24 hücreden başlangıçta **15'i UNAMBIGUOUS** dolduruldu (5 tamamen
 * filtresiz — "bugün herkese açık" → tüm rollere verildi, davranış
 * korunuyor; 10 tek bir rol kümesiyle uniform — o kümeye verildi). Kalan
 * **9 BLOKE** hücreden `ADIM 3 Faz A` (2026-08-17, `(a) UNION ŞARTLI`)
 * **4'ünü** çözdü (`MODES_WRITE` · `SHARED_WRITE` · `TENANT_READ` ·
 * `USER_WRITE` — bkz. `CAPABILITIES` yorumu). **19/24 dolu, 5 hâlâ BLOKE**
 * (`MODES_READ` · `MODES_APPROVE` · `SHARED_READ` · `SHARED_APPROVE` ·
 * `USER_READ`) — bunlar hiçbir rolün listesinde YOK, ürün sahibi kararına
 * kadar. Bu, bir eksiklik değil, `CLAUDE.md §2.4`'ün gereği: bir yetenek
 * adının hangi role verileceği belirsizken sessizce doldurulmaz.
 */
export const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
  [UserRole.ADMIN]: [
    CAPABILITIES.ADMIN_READ,
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.CUSTOMER_WRITE,
    CAPABILITIES.CUSTOMER_MANAGE,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.MASTER_DATA_WRITE,
    CAPABILITIES.MASTER_DATA_MANAGE,
    // ↓ ADIM 3 Faz A (2026-08-17, UNION): ADMIN her iki genişleyen hücrede
    // de zaten mevcuttu — bkz. CAPABILITIES yorumu.
    CAPABILITIES.MODES_WRITE,
    CAPABILITIES.MODES_MANAGE,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    CAPABILITIES.SHARED_WRITE,
    CAPABILITIES.SHARED_MANAGE,
    // ↓ TENANT_READ: dal 1 (tek rol kümesi — `GET /tenants` zaten ADMIN-only).
    CAPABILITIES.TENANT_READ,
    CAPABILITIES.TENANT_WRITE,
    CAPABILITIES.TENANT_MANAGE,
    // ↓ USER_WRITE: dal 1 (tek rol kümesi — 4 ADMIN-only route zaten ADMIN'de).
    CAPABILITIES.USER_WRITE,
    CAPABILITIES.USER_MANAGE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.PLANNER]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.CUSTOMER_WRITE,
    CAPABILITIES.CUSTOMER_MANAGE,
    CAPABILITIES.MASTER_DATA_READ,
    // ↓ ADIM 3 Faz A (2026-08-17, UNION) — bkz. CAPABILITIES yorumu:
    // MODES_WRITE union'ı PLANNER'a agreement-transaction/on-invoice/
    // sales-actuals upload-validate-process uçlarını (5 route, önceden
    // {ADMIN,FINANCE}) açıyor.
    CAPABILITIES.MODES_WRITE,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ SHARED_WRITE union'ı PLANNER'a budget-allocation/budget/
    // lta-agreement yazma uçlarını açıyor (approval-policies dahil —
    // CAPABILITIES yorumundaki ⚠️ uyarıya bkz.).
    CAPABILITIES.SHARED_WRITE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.CATEGORY_MANAGER]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ ADIM 3 Faz A (2026-08-17, UNION) — bkz. CAPABILITIES yorumu.
    CAPABILITIES.SHARED_WRITE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.FINANCE]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    // ↓ ADIM 3 Faz A (2026-08-17, UNION) — bkz. CAPABILITIES yorumu:
    // MODES_WRITE union'ı FINANCE'e Plan CRUD (create/update/delete/addFu/
    // removeFu/updateSkuVolume/calculateKpis/recalculate — 12 route,
    // önceden {ADMIN,PLANNER}) açıyor.
    CAPABILITIES.MODES_WRITE,
    CAPABILITIES.MODES_MANAGE,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    CAPABILITIES.SHARED_WRITE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.READONLY]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ ADIM 3 Faz A (2026-08-17): READONLY hiçbir ÇÖZÜLDÜ hücrenin union'ında
    // yok (MODES_WRITE/SHARED_WRITE/TENANT_READ/USER_WRITE'ın hiçbiri
    // READONLY içermiyor) — bilinçli, ekleme yok.
    CAPABILITIES.HEALTH_READ,
  ],
};
