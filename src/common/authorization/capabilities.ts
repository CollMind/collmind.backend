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
 * ⚠️ **BAYAT ADLAR — `F12` işareti (2026-08-26, `Z39`):** bu bölüm **2026-08-17
 * taksonomi turunun TARİHSEL anlatısıdır.** `CUSTOMER_MANAGE` · `TENANT_MANAGE` ·
 * `SHARED_MANAGE` · `SHARED_WRITE` **DÜŞTÜ** (sıfır rota, `H3` emsali) — aşağıdaki
 * metinlerde **canlı sabit gibi geçerler**. Dosyada bu adları arayan biri **önce
 * buraya çarpar**; kod tarafında karşılıkları **yoktur**.
 *
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
 *   MODES_WRITE    {ADMIN,FINANCE,PLANNER}                     dal 3   ⛔ BAYAT (Z35, 2026-08-24): hücre BÖLÜNDÜ → MODES_ACTUALS_WRITE / MODES_PLAN_WRITE
 *   SHARED_WRITE   {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER}    dal 3
 *   TENANT_READ    {ADMIN}                                     dal 1+2 (tek küme + 2 filtresiz hariç)
 *   USER_WRITE     {ADMIN}                                     dal 1+2 (tek küme + 5 filtresiz hariç)
 *
 * DUR (5) — HİÇBİR role atanmadı, ürün sahibine gider
 *   MODES_READ     union = {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY} → ÇÖKÜŞ (tüm roller)
 *   MODES_APPROVE  dal 3 genişleme, ONAY yeteneği               → K-2.5.12   ⚠️ Z30 H2: 5 route AYRILDI → MODES_SUBMIT, aşağı bkz.
 *   SHARED_READ    union = {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY} → ÇÖKÜŞ (tüm roller)  ⚠️ BAYAT — B3 W4a ADIM 0 (2026-08-25)
 *                                                                                                     bu hücreyi ÇÖZDÜ: 16 rota göçtü, ~~DÖRT İSTİSNA~~ ⚠️ bugün İKİ istisna (K4: approvals çifti GÖÇTÜ →
 *                                                     APPROVAL_QUEUE_READ; kalan: budget-variance DEVREDİLDİ ·
 *                                                     validate-budget DUR'da),
 *                                                                                                     DÖRT İSTİSNA karar-bekler. Aşağı bkz.
 *   SHARED_APPROVE dal 3 genişleme, ONAY yeteneği               → K-2.5.12   ⚠️ Z30 H3: 0 route — SİLİNDİ, aşağı bkz.
 *   USER_READ      union = {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY} → ÇÖKÜŞ (tüm roller)  ⚠️ BAYAT — Z20 (2026-08-23) bu hücreyi
 *                                                                                                     USER_MANAGE/SELF'e ikiye ayırdı VE
 *                                                                                                     Z30 H3 (2026-08-24) kalıntı sabiti SİLDİ.
 *                                                                                                     Bkz. aşağıdaki "✅ ÇÖZÜLDÜ — Z20" bloğu.
 * ```
 *
 * ---
 *
 * ## Z30 (2026-08-24) — `B3b-0` harita düzeltme dalgası
 *
 * `docs/brd-v2/04_KARAR_KAYDI.md` `Z30`/`Z31`/`Z32` (ürün sahibi) ·
 * `docs/process/B3A_ESLEME_TABLOSU.md` (ölçüm). Kod dokunuşu bu turda
 * **DAVRANIŞSIZ** — hiçbir route bu dosyayı import etmiyor (ölçüldü,
 * `grep -rn "authorization/capabilities" src/` → 0), yani aşağıdaki
 * değişikliklerin hiçbiri bugün hiçbir guard'ı etkilemiyor.
 *
 * **H1 · FIXPOINT — MODES_WRITE ⛔ DUR (bu turda ÇÖZÜLMEDİ, raporlandı)**
 *
 * > ✅ **KAPANDI (`Z35`, 2026-08-24 · koda indi: `B3b-1 ADIM 0`).** Aşağıdaki
 * > `DUR` metni `F12` gereği **silinmedi**; hüküm için bu dosyadaki
 * > `MODES_ACTUALS_WRITE` / `MODES_PLAN_WRITE` tanımlarına bakılır.
 *
 * `Faz A`'nın union kararı iki genişlemeyi KAYITLI KARARLARA çarpıyordu:
 *   - `FINANCE → Plan CRUD` (`DELETE /plans/:id` dahil) — `K-2.6.4`
 *     (`L2_03:408`) FİNANS listesinde plan YAZIMI yok.
 *   - `PLANNER → upload/validate/process` — `K-2.6.14` (`L2_03:511-518`)
 *     YÜRÜRLÜKTEKİ satırı "bugün yalnız finans + yönetici" diyor
 *     (hedef satır "eşleştirme geldiğinde + planlamacı" henüz gelmedi).
 *
 * Bu iki genişleme reddedilince `MODES_WRITE` hücresinde geriye üç ayrı
 * NATİF `@Roles` kümesi kalıyor (yukarıdaki "ÇÖZÜLDÜ — hücre hücre" bölümü,
 * `MODES_WRITE` alt-başlığı):
 * ```
 *   {ADMIN,FINANCE,PLANNER}  n=1   POST /agreement-transactions (create)  — dal 1, NATİF ⛔ BAYAT (Z35, 2026-08-24):
 *                                  bu cümle bir BEYANDI, ölçülmemişti. `service:264→:285` `batchImport` `create`'i
 *                                  ÇAĞIRIYOR — aynı yazma yolu, `K-2.6.14`'ün TAM KONUSU. `T-277`/`Z35` ile
 *                                  `@Roles` `{ADMIN,FINANCE}`'e düzeltildi (`agreement-transaction.controller.ts:52`).
 *                                  Bkz. `docs/brd-v2/04_KARAR_KAYDI.md` `Z35`.
 *   {ADMIN,FINANCE}          n=5   upload/validate/process                — dal 3, genişleme REDDEDİLDİ, ESKİ hâline döner
 *   {ADMIN,PLANNER}          n=12  Plan CRUD                              — dal 3, genişleme REDDEDİLDİ, ESKİ hâline döner
 * ```
 * Bu üç küme "İKİ MEŞRU KÜME → hücre ayrışır" kuralına UYMUYOR — üç küme
 * var, ve `n=1`'in kümesi diğer ikisinin union'u (`{A,P}∪{A,F}={A,F,P}`),
 * yani onu üçüncü bir bağımsız hücreye mi koymak, yoksa iki-hücreli
 * bölünmenin hangi tarafına mı iliştirmek gerektiği bir MODEL kararı
 * (yeni capability adı/sınırı) — brief'in kendi `DUR` şartına birebir
 * uyuyor: *"Fixpoint bir hücrede üçüncü bir meşru küme üretiyorsa → DUR ve
 * raporla."* **Bu turda `CAPABILITIES.MODES_WRITE` / `ROLE_CAPABILITIES`
 * DEĞİŞTİRİLMEDİ** — ürün sahibine gider.
 * > ⛔ **BAYAT (`Z35`, 2026-08-24):** ürün sahibi kararını verdi, bölünme
 * > `B3b-1 ADIM 0`'da koda indi. `MODES_WRITE` artık bir hücre DEĞİL.
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
 * > ⛔ **BU BÖLÜM BİR KAYITTIR — SAYILARI O GÜNÜNDÜR, BUGÜNÜN DEĞİL.**
 * > Aşağıdaki `(N route)` başlıkları `Z30 H1` turunda elle yazıldı. Ölçüldü
 * > (2026-08-24): **dokuz başlığın yedisi bugün bayat** (ör. `MODES_WRITE` 18↔20 ·
 * > `MODES_READ` 37↔34 · `SHARED_READ` 36↔20 · `MODES_APPROVE` 13↔6), ve ikisi
 * > artık **var olmayan** hücrelere atıf veriyor (`USER_READ` `Z20` ile silindi ·
 * > `SHARED_APPROVE` bugün hiçbir rota taşımıyor).
 * >
 * > Kayıt `F12` gereği **düzeltilmez** — o günün kararını o günün sayılarıyla
 * > taşır. **Bugünün üyeliği için tek kanonik kaynak üreticidir:**
 * > `python3 scripts/analysis/route-cell-map.py`  (hücre sütunu + MUTABAKAT).
 * >
 * > 📌 **Ve ders bu bölümün kendisi:** elle yazılmış her üye-sayısı, bir sonraki
 * > rota eklendiğinde yalan söyler. Yeni yorumlara sayı YAZILMAZ — üye listesine
 * > ya da üreticiye atıf verilir.
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
 * {ADMIN,PLANNER}           n=1  POST /budget/reserve  ⚰️ SİLİNDİ (K6c/d)        (reserveBudget)         +CATEGORY_MANAGER,+FINANCE
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
 * **`SHARED_READ`** (TARİHSEL ÖLÇÜM, 2026-08-17 — bugünkü hücre `20` rota:
 * 16 göçtü + 4 istisna; kanonik kaynak `B3A_EK3_ROTA_HUCRE_ESLEMESI.tsv`)
 * (36 route, `20` filtresiz — `budget-allocations`,
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
 * > ⚠️ **REVİZE — `T-253` (2026-08-22): bu hücrenin ÇÖKÜŞ ÖNCÜLÜ ORTADAN
 * > KALKTI.** `dashboard-summary` bir kapsam bypass'ıydı (`planner` 11 CPL
 * > ve `planner2` 17 CPL **birebir aynı** yanıtı alıyordu) ve tüketicisi
 * > `0` ölçüldüğü için **silindi**. `USER_READ`'de kalan uçlar:
 * > `GET /users` (`{ADMIN,FINANCE}`) · `GET /users/me` · `GET /users/:id`
 * > (`@Roles(ADMIN)`, `T-255`). **`5/5` taşıyan üye kalmadı → union artık
 * > çökmüyor.** Hücre `⛔ DUR`'da kalmaya devam ediyor, ama gerekçesi
 * > değişti: geriye `GET /users` (tenant kullanıcı listesi) ile `me`
 * > (self-servis kimlik) **aynı yetenekte mi** sorusu kaldı.
 * > Eski satır silinmedi (`Z1` append-only): çöküş bir kez ölçülmüştü ve
 * > onu ortadan kaldıran şey bir yeniden yorum değil, bir **silme**.
 *
 * > ✅ **ÇÖZÜLDÜ — `Z20` (2026-08-23).** Soru `K-2.6.6`'nın değil
 * > **`K-2.6.4`'ün** (rol kataloğu) konusuymuş. Hücre İKİYE ayrıldı:
 * >
 * > ```
 * > USER_MANAGE   GET /users · /users/:id · yazma uçları   @Roles(ADMIN)
 * > SELF          /users/me ailesi (3 uç)                  DÖRDÜNCÜ KOVA
 * > ```
 * >
 * > `GET /users` = `/users/:id`'nin **liste hâli** → aynı veri sınıfı,
 * > aynı rol. Emsalden türedi, union'dan değil (`Z18`).
 * > `SELF` rol değil **kimlik** gerektirir; ve `B4`'ün `FILTRESIZ = 0`
 * > ön koşulunu bu kova karşılıyor — `route-scope-baseline.txt`'teki üç
 * > `F` satırı **tam olarak** `me` ailesi (ölçüldü).
 * >
 * > ⚠️ **ÜÇÜNCÜ hücre AÇIK — `USER_LOOKUP` (`T-268`).** `T-255`
 * > `/users/:id`'yi `ADMIN`'e daralttı, ama frontend o ucu DÖRT yerden
 * > `plan.createdBy` UUID'sini **görünen ada** çevirmek için çağırıyor.
 * > Davranışsal (2026-08-23, poz.kontrol `/users/me` 4/4 `200`):
 * > `ADMIN 200 · CM 403 · FIN 403 · PLANNER 403 · READONLY 403`.
 * > Fallback sessiz — ekranda **ham UUID**. Yani bir yetenek ihtiyacı
 * > bir YÖNETİM ucundan karşılanıyormuş; `T-255` ödünç yolu kapattı.
 *
 * ---
 *
 * #### `5/5` ROL TAŞIYAN ROUTE'LAR — ölçüldü, ve HİPOTEZ ÇÜRÜDÜ
 *
 * Üç `READ` hücresinin çöküşünün kaynağı **`18` route** (`T-253`'ten
 * sonra **17** — `dashboard-summary` silindi; sayı burada güncellenmiyor,
 * çünkü aşağıdaki sınıflandırma o `18`'in üzerine yapıldı) (ilk sayım `14`
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
 * SINIF B · ÖLÜ İKİZ  →  ⚠️ `T-253` (2026-08-22) ile **KOVA BOŞALDI**
 *   user /dashboard-summary  @deprecated — GET /dashboard/summary'nin ikizi.
 *                            Bir yetenek sorusu DEĞİL, bir `İlke 4`
 *                            kalıntısı. **SİLİNDİ** — ve teşhis eksikti:
 *                            yalnız ölü bir ikiz değil, CANLI bir kapsam
 *                            bypass'ıydı (`getDashboardSummary(tenantId)`,
 *                            0 `AccessScopeService` atıf). Kardeşi
 *                            `dashboard.service.ts:82` `resolveScopedCplIds`
 *                            çağırıyor. `İlke 4`'ün maliyeti bu vakada bir
 *                            tekrar değil, bir GÜVENLİK açığıydı.
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
 *
 * ---
 *
 * **H2 · `MODES_SUBMIT` DOĞAR (`Z30`, 25. hücre) — `MODES_APPROVE`'dan AYRILDI**
 *
 * `MODES_APPROVE`'un `13` route'u tek sınıf değildi (yukarıda `0072`'nin
 * ölçtüğü ayrım): `5`'i **gönderim/geri-çekme** (`submit`/`cancel`/
 * `submit-for-approval`/`return-to-draft`), `8`'i **onay kararı**
 * (`approve`/`reject`/`escalate`/`reviewPlan`). Gönderim `5` route'un
 * `@Roles` kümesi TEKTİR (`{ADMIN,PLANNER}`, dal 1, genişleme yok) — bu bir
 * union değil, bir ROL TANIMI: `K-2.6.4` (`L2_03:406`) *"PLANLAMACI — …,
 * **GÖNDERİM** — günlük kullanıcı"* diyor. Yani `capabilities.ts:134`'ün
 * *"onaylayabilir mi ↔ onay ekranını görebilir mi"* iki-ayrımına ÜÇÜNCÜ bir
 * satır: `onaylar ≠ görür ≠ GÖNDERİR`.
 *
 * `MODES_APPROVE`'da geriye kalan `8` route (`escalate`/`approve`/`reject`
 * plan `n=3` · `approve`/`reject` agreement + `reviewPlan` `n=3` — yukarıki
 * "DUR" ölçümünde `n=3+3=6` olarak sayılmıştı, kalan ikisi `0072`'nin
 * `reviewPlan` sınıflandırma düzeltmesiyle ilgili çakışan sayım; kesin sayı
 * `ROLE_CAPABILITIES` bu route'lara `@RequireCapability` uygulanan `Faz B`
 * turunda route-route yeniden ölçülür) hâlâ **DUR** — `K-2.5.12`'ye
 * devredilmiş onay-kademesi sorusu, bu turun konusu değil.
 *
 * ---
 *
 * **H3 · BEŞ BOŞ HÜCRE SİLİNDİ — `SHARED_APPROVE` · `NOTIFICATION_READ` ·
 * `USER_READ` · `HEALTH_READ` · `MODES_MANAGE`**
 *
 * ```
 * SHARED_APPROVE     0 route, gerekçesiz (jenerik onay uçları silindi;
 *                    budget-allocation approve/reject Z24 ile öldü)
 * NOTIFICATION_READ  0 route — GET /notifications · /notifications/unread
 *                    `@SelfScoped()`'a geçti (kimlik yüklemi, rol değil)
 * USER_READ          0 route — Z20 (2026-08-23) USER_MANAGE/SELF'e ayırdı,
 *                    bu sabit KALINTIYDI
 * HEALTH_READ        1 route ama o route `@Public()` — hiçbir rol hiçbir
 *                    zaman bu yeteneğe İHTİYAÇ DUYMAZ (guard zaten bypass)
 * MODES_MANAGE       0 route — "yol olmadan verilmiş yetki" YAŞAYAMAZ
 * ```
 *
 * **Genel kural (`K-2.3.4`'ün yetenek hâli):** hücreler ROTA ENVANTERİNDEN
 * türer; arkasında rota olmayan (ya da rotası hiçbir zaman bu kapıdan
 * geçmeyecek) bir hücre haritada DURMAZ. İleride bir `MANAGE` route'u
 * doğarsa `MODES_MANAGE` **kararla** geri gelir — bu bir kalıcı yasak
 * değil, bugünkü ölçümün sonucu.
 *
 * ---
 *
 * **H4 + `Z31` + `Z32` · `SUMMARY_READ` DOĞAR — kapsam bir ŞART değil, bir
 * SÖZLEŞME**
 *
 * Tanım (`Z32`, düzeltilmiş):
 * ```
 * ÜYELİK ŞARTI (2)   nesne-bağsız ∧ çok-işlem-modüllü portföy özeti
 * SÖZLEŞME (1)       kapsam yükümlülüğü — üyeliğin SONUCU, FİLTRESİ DEĞİL
 * ```
 * Üç keskinleştirme: (1) kayıt parametresi (`:id`) taşıyan route
 * `SUMMARY_READ` OLAMAZ — `plans/:id/budget-check` bu yüzden modül-READ'de
 * kalır ("planı okuyabilen, bütçe kontrolünü de okuyabilir", `H4-1`). (2)
 * yüzey adresi (`/dashboard/...`) hücre belirlemez, VERİ SINIFI belirler —
 * `dashboard/pending-tasks` tek modül (`agreements`) okuduğu için modül-READ
 * (`H4-2`). (3) referans-veri join'i çapraz-modül SAYMAZ —
 * `dashboard/cpl-status` iki tablo okusa da agregasyonun kaynağı tek, modül-
 * READ (`H4-3`).
 *
 * **Üyelik türetiminin evreni `Z32`'nin şartı gereği kapsam kovasıyla
 * SINIRLANMADI** — 223 route'un TAMAMI (113 `GET` route dahil, `route-
 * scope.awk` çıktısından) tek tek tarandı, yalnız kapsamlı (`B`) `14`
 * aday değil. Tarama sonucu **`13` route** `SUMMARY_READ` tanımını
 * karşılıyor:
 *
 * ```
 * actuals-first/settlements/summary                    agreements + ledger_entries         (2 modül)
 * dashboard/summary                                     agreements + approval_requests +
 *                                                        budget_envelopes/v_budget_summary   (3 modül)
 * finance-reporting/budget-variance                     budget_envelopes + v_budget_summary  (2-3 modül)
 * finance-reporting/budget-utilization                  Z32 "10 rota GİRER" — scope-a1'den
 * finance-reporting/spend-trend                         (kapsam GEREKLİ ama UYGULANMIYOR;
 * finance-reporting/budget-at-risk                       A1 ratchet'te İZLENİYOR — SUMMARY_READ
 * finance-reporting/cash-flow-projection                 üyeliği bunu DEĞİŞTİRMEZ, `Z32`:
 * finance-reporting/mechanic-effectiveness                "kapsam YÜKÜMLÜLÜĞÜ, ÜYELİĞİN ŞARTI değil")
 * finance-reporting/plan-performance
 * finance-reporting/spend-composition
 * finance-reporting/variance-analysis
 * agreement-transactions/stats/summary
 * actuals-first/sales-actuals/summary
 * ```
 *
 * ⛔ **Kesin DIŞARIDA (ölçüldü, modül-READ'e kalır):** `plans/:id/budget-
 * check` · `dashboard/pending-tasks` · `dashboard/cpl-status` ·
 * `budget/status` (kanal+kategori BOYUTUNA göre tek-dimension sorgu, tek
 * modül — `plans/:id/budget-check` ile aynı sınıf, portföy özeti değil).
 *
 * ⚠️ **Bu turda `SUMMARY_READ` hiçbir role ATANMADI** — `MODES_READ`/
 * `SHARED_READ`/`USER_MANAGE` gibi diğer okuma hücreleri de bugün hangi
 * rollere verileceği konusunda `Faz B`'ye bırakılmış DUR hücreler; aynı
 * disiplin burada da geçerli. `A1 ∧ SUMMARY_READ` kesişimi (`Z32`) kapsam
 * hattının kendi çıkış ölçütüdür — `B3`'ün DEĞİL.
 */

export const CAPABILITIES = {
  ADMIN_READ: 'admin:read',

  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',
  // ⛔ `CUSTOMER_MANAGE` DÜŞTÜ (`Z39`, 2026-08-26 · `B3 W5` kapanışı, `H3`
  // emsali) — `route-cell-map.py:234` bu hücreyi TÜRETEMİYOR (üretici
  // `*_MANAGE`'i yalnız `USER`'a özel tutuyor, `Z20`'ye bağlı) ⇒ sıfır-rota
  // kanıtı: `@RequireCapability(CAPABILITIES.CUSTOMER_MANAGE)` deseni
  // `*.controller.ts` genelinde SIFIR eşleşme. Genel kural
  // ("arkasında rota olmayan bir hücre haritada DURMAZ", `H3`) burada İLK
  // KEZ tetikleyicisiyle uygulandı (`dalga-sonu H3`). İleride bir `MANAGE`
  // rotası doğarsa hücre KARARLA geri gelir.

  MASTER_DATA_READ: 'master-data:read',
  MASTER_DATA_WRITE: 'master-data:write',
  // ⛔ `MASTER_DATA_MANAGE` DÜŞTÜ (`Z39` `dalga-sonu H3`, 2026-08-26 · `B3 W8`
  // kapanışı) — sıfır-rota kanıtı: `@RequireCapability(CAPABILITIES.
  // MASTER_DATA_MANAGE)` deseni `*.controller.ts` genelinde SIFIR eşleşme
  // (dokuz katalog controller'ı + `kpi` + `mechanic`, 64 rotanın hiçbiri onu
  // türetmiyor — `W7`/`W8` iki hücreye BÖLÜNDÜ, `_READ`/`_WRITE`, `_MANAGE`
  // hiçbir rota almadı). `W7` kapanışında `BEKLEYEN` listesinde bekletildi
  // (tek taşıyıcı üye); `W8` kapanışında `G8` ile ölçüldü ve DÜŞTÜ. İleride
  // bir `MANAGE` rotası doğarsa hücre KARARLA geri gelir.

  // ⛔ BLOKE (2026-08-17 turundan sonra da) — MODES_READ.
  // Union çöküşe düşüyor, ürün sahibi kararı bekliyor.
  // Bkz. yukarıdaki "9/24 hücre — ADIM 3 Faz A" bölümü, "DUR" alt-başlığı.
  MODES_READ: 'modes:read',
  // ✅ Z35 BÖLÜNMESİ KODA İNDİ (2026-08-24, B3b-1 ADIM 0).
  // MODES_WRITE ikiye ayrıldı; tek hücre iki farklı işi taşıyordu ve union'ı
  // T-277'nin daraltmasını geri açıyordu.
  //
  // ÜYELİK DAVRANIŞTAN TANIMLANIR, @Roles'tan DEĞİL — aksi hâlde harita,
  // yönettiği şeyden türetilmiş olurdu (dairesel evren; bu oturumda bir
  // totoloji olarak ölçüldü, bkz. route-cell-map.py MUTABAKAT yorumu).
  // Ayırt edici ALT-MODÜL = işin cinsi:
  //   gerçekleşme/alım girişi  agreement-transaction · on-invoice · sales-actuals
  //   plan/anlaşma tanımı      agreement · plan
  // Z35'in ölçülebilir teyidi TEK YÖNLÜDÜR ve ÜÇTE İKİSİNİ kapsar:
  //   defter YAZAN (ledgerService çağıran) modes/ servisleri: agreement-transaction ·
  //   on-invoice — İKİSİ DE gerçekleşme tarafında. plan/anlaşma tarafında SIFIR.
  //   (reversal da çağırıyor ama rotaları ALAN_GUARD kovasında, bu hücrede değil.)
  // ⚠️ sales-actuals'ın defter çağrısı da SIFIR — üyeliği "defter etkisi"ne değil
  //   "fiili veri alımı" yargısına dayanıyor. Yani ayırt edici bir DİSJONKSİYON
  //   (defter-etkili VEYA fiili veri alımı), tek grep'lik bir test DEĞİL.
  //
  // ÜYE SAYISI BURAYA YAZILMAZ. Üyelik için:
  //   python3 scripts/analysis/route-cell-map.py
  MODES_ACTUALS_WRITE: 'modes:actuals-write',
  MODES_PLAN_WRITE: 'modes:plan-write',
  // ⛔ BLOKE — onay-AKIŞI durum geçişleri (K-2.5.12'ye devredildi).
  // Z30 H2: gönderim/geri-çekme route'ları AYRILDI → MODES_SUBMIT (aşağı bkz.).
  // ✅ 2026-08-24 (ürün sahibi kararı): POST /plans/:id/review ve
  // POST /plans/:id/escalate-to-finance BU HÜCREYE taşındı — daha önce mekanik
  // POST→WRITE kuralıyla MODES_WRITE görünüyorlardı. Sınıf yol deseninden değil
  // DAVRANIŞTAN tanımlanır: ikisi de plan İÇERİĞİ değil onay DURUMU yazar
  // (updateStatusCas → status/escalated*/pendingFinanceReview; plan-içerik
  // kolonu 0). Z30 H2 zaten ikisini onay ailesinde saymıştı (yukarı bkz.).
  // Muhasebe teyidi: MODES_APPROVE + MODES_SUBMIT = 11 = B3a'nın kaydı.
  // Üyelik: scripts/analysis/route-cell-map.py'nin APPROVE üye listesi.
  MODES_APPROVE: 'modes:approve',
  // ✅ Z30 H2 (2026-08-24) — {ADMIN,PLANNER}, dal 1 (tek küme, mekanik).
  // K-2.6.4 (L2_03:406): "PLANLAMACI — …, GÖNDERİM — günlük kullanıcı".
  // Bkz. yukarıdaki "Z30 (2026-08-24)" bölümü, "H2" alt-başlığı.
  MODES_SUBMIT: 'modes:submit',

  NOTIFICATION_WRITE: 'notification:write',

  // ✅ ÇÖZÜLDÜ (ürün sahibi, `Z37 §3`, 2026-08-26 · koda iniş: `B3` kaza-dalgası `K4` Parça 1).
  // `SHARED_READ`'in DÖRT İSTİSNASINDAN İKİSİ (`GET /approvals` ·
  // `GET /approvals/pending`) BURAYA göçer — SINIF-ADI, KÜME-ADI DEĞİL
  // (`shared-read`'in kendi üyelik ekseni bunlara uymuyor: ikisi de ONAY
  // KUYRUĞU görünürlüğü, `SHARED_READ`'in "tanım + kural yönetimi" tabanı
  // değil). Küme `{ADMIN,CATEGORY_MANAGER,FINANCE,READONLY}` göç öncesi
  // @Roles ile BİREBİR — davranış KORUNUYOR (pin:
  // `test/approval-queue-read-boundary.e2e-spec.ts`, PLANNER 403 alır,
  // diğer dördü 403 ALMAZ).
  //
  // `Z18` şartı — HER ROL için AYRI cümle (union'dan değil, üyelik
  // sözleşmesinden):
  //   ADMIN             sistem yöneticisi, her yüzeye görünürlük — `K-2.6.4`
  //                      YÖNETİCİ satırı, "tanımlar, kural yönetimi" TABANI
  //                      dahil her modülü kapsar.
  //   CATEGORY_MANAGER   onay kuyruğunun bir TARAFI — `plans/:id/approve` ·
  //                      `/reject` · `/escalate-to-finance`'te `@Roles`'ta
  //                      zaten var (`MODES_APPROVE`); kuyruğu GÖRMEDEN
  //                      onaylayamaz.
  //   FINANCE            `agreements/:id/approve` · `/reject`'te `@Roles`'ta
  //                      zaten var; eşik-üstü onaycı, kendi bekleyen
  //                      işlerini görebilmeli.
  //   READONLY           `K-2.6.4c` "İZLEYİCİ bir İZLEME YETENEKLERİ
  //                      SETİDİR" — onay kuyruğu bir izleme yüzeyi, işlem
  //                      yüzeyi değil (READONLY onay VEREMEZ, `MODES_APPROVE`/
  //                      `SHARED_APPROVE` hiçbir yerinde READONLY yok).
  //   PLANNER'ın YOKLUĞU  — cümlelenebiliyor, `K-2.6.4` (`L2_03:406`)
  //                      "PLANLAMACI — …, GÖNDERİM — günlük kullanıcı" der;
  //                      PLANNER kendi `MODES_SUBMIT` yüzeyinde gönderim
  //                      yapar ama hiçbir onay-kararı rotasında (`MODES_
  //                      APPROVE`/`SHARED_APPROVE`) `@Roles`'ta YOK. Onay
  //                      KUYRUĞU bir ONAYCI yüzeyidir — PLANNER gönderen
  //                      taraf, onaycı değil.
  //
  // Kaynak: `docs/brd-v2/04_KARAR_KAYDI.md` `Z37 §3` · `docs/process/
  // B3_KAZA_DALGASI_BRIEF.md §1.5`. `SHARED_READ`'in DÖRT İSTİSNA notu bu
  // ikisi için F12 izini burada bırakıyor — kalan iki istisna
  // (`finance-reporting/budget-variance` · `spend-calculation/
  // validate-budget/:planId`) hâlâ `SHARED_READ` yorumunda, GÖÇ-DIŞI.
  APPROVAL_QUEUE_READ: 'approval-queue:read',

  // ✅ ÇÖZÜLDÜ (ürün sahibi, 2026-08-25 · koda iniş: B3 W4a ADIM 0).
  // SHARED_READ = 5/5. ⚠️ İDDİA ZAYIFLATILDI (code-reviewer S2, 2026-08-25):
  // önce "küme mekanik bir birleşimden değil YAZILI BİR CÜMLEDEN türüyor"
  // yazıyordu — ÖLÇÜM bunu çürüttü. Doğrusu:
  //   KÜMEYİ SEÇEN     mevcut @Roles union'ı (:318'de kendi adıyla kayıtlı)
  //   CÜMLENİN İŞİ     o kümeyi ONAYLAMAK — K-2.6.5b "her rolün okuma tabanı
  //                    zaten var", ve Z18 gereği her eleman için AYRI cümle
  //                    yazılabiliyor (aşağıda beş satır)
  // Taban argümanı TEK BAŞINA rota kümesini SEÇMEZ: göç sonrası hâlâ 5/5
  // @Roles taşıyan 54 rota var ve aynı argüman onları da kutsardı. Ters
  // yönde de eleyemez — dört istisnayı eleyen şey 4/5 @Roles'ları.
  // ⚠️ Kararın KAPSAMI kısmi: 16 rota (5/5 taban) göçer; DÖRT İSTİSNA
  // (approvals · approvals/pending · finance-reporting/budget-variance ·
  // spend-calculation/validate-budget/:planId) GÖÇ-DIŞI ve karar-bekler —
  // her biri için tek soru: "eksik rolün YOKLUĞU cümlelenebiliyor mu?"
  // (F12 izi — eski kayıt: "⛔ BLOKE (2026-08-17 turundan sonra da)".)
  // ⛔ BAYAT (`Z37 §3`, 2026-08-26 · `B3` kaza-dalgası `K4` Parça 1) —
  // dördün İKİSİ (`approvals` · `approvals/pending`) `PLANNER`'sızlığı
  // cümlelendi ve `APPROVAL_QUEUE_READ`'e GÖÇTÜ (yukarı bkz., `NOTIFICATION_
  // WRITE`'dan sonra). Kalan İKİSİ (`finance-reporting/budget-variance` ·
  // `spend-calculation/validate-budget/:planId`) hâlâ burada, GÖÇ-DIŞI —
  // biri `SUMMARY_READ`'e devredildi (`Z37 §3`), diğeri `git log -L`
  // taramasıyla KAYITLI bir istisna olduğu ölçüldü (T-249, `kaza` DEĞİL) ve
  // ürün sahibine geri gönderildi. Bu satır `F12` gereği SİLİNMEDİ.
  //
  // ⛔ BAYAT (Z36 §5, 2026-08-26 · koda iniş: B3 W4b) — ÜÇ hesap-okuma
  // rotası da BURAYA göçtü: `POST lta-agreements/context/rates` ·
  // `.../calculate/base-spend` · `.../calculate/planned-spend`. Yazma
  // yüzeyleri `0` (W4b ölçümü) — `POST` ama davranış bir hesaplama, bir
  // mutasyon değil. Göç öncesi/sonrası @Roles kümesi zaten `5/5`
  // (`{ADMIN,FINANCE,CATEGORY_MANAGER,PLANNER,READONLY}`) — birebir.
  // `W4a`'nın yan-bulgusunun kaydettiği tutarsızlık (`SHARED_WRITE`
  // yorumundaki eski "Filtresiz 4" listesi bu üçünü YAZMA sayıyordu) bu
  // göçle KAPANIR — bkz. `docs/process/B3_KARAR_BEKLER_PAKETI.md`.
  // ⛔ Ayrı bir `CALC_READ` hücresi AÇILMADI (Z36 §5, bilinçli) — dört
  // `MASTER_DATA` hesap-okuma rotası (mechanics/applicable ·
  // check-combination · mechanics/validate-formula · kpis/validate-formula)
  // hâlâ WRITE'ta, karar-bekler; tek hücre iki ailenin eksenini
  // düzleştirirdi.
  SHARED_READ: 'shared:read',
  // ⛔ `SHARED_WRITE` DÜŞTÜ (`Z39`, 2026-08-26 · `B3 W5` kapanışı, `H3`
  // emsali) — sıfır-rota kanıtı: `@RequireCapability(CAPABILITIES.
  // SHARED_WRITE)` deseni `*.controller.ts` genelinde SIFIR eşleşme
  // (`Z36` sekiz rotayı `SHARED_POLICY_WRITE`/`SHARED_ENVELOPE_WRITE`/
  // `SHARED_SPEND_WRITE`'a böldüğünden beri). Union `{ADMIN,PLANNER,
  // CATEGORY_MANAGER,FINANCE}` koruduğu HİÇBİR rotanın kümesinden genişti —
  // KİLİT METNİ (o sessiz-genişleme uyarısının tam metni) SİLİNMEDİ,
  // `.claude/backlog/tasks/T-293.md`'ye TAŞINDI: LTA dörtlüsü `T-293`
  // çözülmeden zaten bu sabite göçmeyecekti; doğru hücre kararla ve
  // cümlesiyle o gün doğar.
  //
  // ⛔ `SHARED_MANAGE` DÜŞTÜ (`Z39`, aynı kapanış) — sıfır-rota kanıtı:
  // `ROLE_CAPABILITIES`'te hiçbir role verilmemişti (bugün başka atanmış
  // rota YOK notu doğruydu, `H3` genel kuralı burada tetikleyicisiyle
  // uygulandı). `PATCH /approval-policies/:id` zaten `SHARED_POLICY_WRITE`'a
  // göçmüştü (SINIF A, `{ADMIN}`) — bu sabit onun için de gerekmiyordu.
  // ⚠️ GERİ-DÖNÜŞ KAPISI (code-reviewer S4, `H3` deseni — dörtte üçünde vardı,
  // burada eksikti): ileride bir `shared` YÖNETİM rotası doğarsa hücre
  // **KARARLA GERİ GELİR** — ve `Z20` biçiminde: yazılı kural + üretici dalı
  // + ROTASI. Kendiliğinden, sıfır rotayla geri EKLENEMEZ (`G8` kapısı).

  // ✅ Z36 BÖLÜNMESİ KODA İNDİ (2026-08-26, B3 W4b ADIM 0).
  // `SHARED_WRITE`'ın SEKİZ rotası üçe ayrıldı — ayırt edici `Z35`'in
  // "defter etkisi"NDEN farklı: burada defter-etkili yazma (split/reserve)
  // grupların İÇİNDEN geçiyor. Gerçek eksen: YAZILAN NESNENİN SAHİPLİĞİ.
  //   SINIF A  yönetişim/kural yazımı     {ADMIN}         approval-policies
  //   SINIF B  zarf yapısı/bütçe sahipliği {ADMIN,FINANCE} budget/envelopes[,/split]
  //   SINIF C  plan tüketimi/ızgara yazımı {ADMIN,PLANNER} spend-calculation
  //            distribute · recalculate-on-volume-change
  // `K-2.6.4a/b` SINIF A'nın gerekçesi: "şablonun öznesi olan rol, şablonu
  // düzenleyemez" — FINANCE onay eşiğinin ÖZNESİDİR, yazabilseydi eşik bir
  // kısıt olmaktan çıkardı. Bu bir YETKİNLİK değil bir KONUM kuralı (bkz.
  // `docs/DISIPLIN.md`: "bir rolün tabi olduğu kuralı yazma yetkisi, o
  // rolün kümesine giremez").
  // Detay: `docs/brd-v2/04_KARAR_KAYDI.md` `Z36`.
  SHARED_POLICY_WRITE: 'shared:policy-write',
  SHARED_ENVELOPE_WRITE: 'shared:envelope-write',
  SHARED_SPEND_WRITE: 'shared:spend-write',

  // ✅ ÇÖZÜLDÜ (2026-08-17, dal 1 — tek rol kümesi, mekanik) — {ADMIN}.
  TENANT_READ: 'tenant:read',
  TENANT_WRITE: 'tenant:write',
  // ⛔ `TENANT_MANAGE` DÜŞTÜ (`Z39`, 2026-08-26 · `B3 W5` kapanışı, `H3`
  // emsali) — `W2` kapandığından beri sıfır rota; sıfır-rota kanıtı:
  // `@RequireCapability(CAPABILITIES.TENANT_MANAGE)` deseni `*.controller.ts`
  // genelinde SIFIR eşleşme. İleride bir `MANAGE` rotası doğarsa hücre
  // KARARLA geri gelir.

  // ✅ ÇÖZÜLDÜ (2026-08-17, dal 1 — tek rol kümesi, mekanik) — {ADMIN}.
  USER_WRITE: 'user:write',
  USER_MANAGE: 'user:manage',

  // ⛔ BLOKE — çapraz-modül portföy özeti (Z32 tanımı: nesne-bağsız ∧
  // çok-işlem-modüllü). Z30 H4/Z31/Z32 (2026-08-24): 13 route ölçüldü
  // (223 route evreninin TAMAMI tarandı, yalnız kapsamlı `B` kovası
  // değil). Bkz. yukarıdaki "Z30 (2026-08-24)" bölümü, "H4" alt-başlığı.
  // HİÇBİR role atanmadı — diğer DUR hücreleriyle aynı disiplin, Faz B'ye
  // bırakılır.
  SUMMARY_READ: 'summary:read',
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
 * `USER_WRITE` — bkz. `CAPABILITIES` yorumu).
 *
 * ⚠️ **`Z30` (2026-08-24) bu tabanı DEĞİŞTİRDİ** — sayı burada ELLE
 * güncellenmez (`CLAUDE.md`: *"sayı bayatlar"*), kanonik kaynak
 * `CAPABILITIES`/`ROLE_CAPABILITIES`'in kendisidir. Yönü:
 *   - `USER_READ` · `HEALTH_READ` · `NOTIFICATION_READ` · `MODES_MANAGE` ·
 *     `SHARED_APPROVE` **SİLİNDİ** (`H3` — arkalarında rota yok/rota
 *     `@Public()`/rota `@SelfScoped()`'a geçti).
 *   - `MODES_SUBMIT` **DOĞDU** ve **ÇÖZÜLDÜ** (`H2` — {ADMIN,PLANNER},
 *     dal 1).
 *   - `SUMMARY_READ` **DOĞDU**, henüz **BLOKE** (`H4`/`Z31`/`Z32`).
 *   - `MODES_WRITE` **BLOKE'A DÜŞTÜ** (`H1` — FIXPOINT üç native küme
 *     üretti, ürün sahibi kararı bekliyor; bu turda hiçbir role
 *     DOKUNULMADI, aşağıdaki liste eski `ÇÖZÜLDÜ` hâlini KORUYOR).
 *
 * Bunlar hiçbir rolün listesinde YOK, ürün sahibi kararına kadar. Bu, bir
 * eksiklik değil, `CLAUDE.md §2.4`'ün gereği: bir yetenek adının hangi
 * role verileceği belirsizken sessizce doldurulmaz.
 */
export const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
  [UserRole.ADMIN]: [
    // ↓ SHARED_READ (W4a, 2026-08-25) — tanımlar ve kural yönetimi — okuma tabanı dahil.
    CAPABILITIES.SHARED_READ,
    // ↓ APPROVAL_QUEUE_READ (Z37 §3, B3 K4 Parça 1, 2026-08-26) — sistem
    // yöneticisi her yüzeye görünür; K-2.6.4 YÖNETİCİ tabanı.
    CAPABILITIES.APPROVAL_QUEUE_READ,
    CAPABILITIES.ADMIN_READ,
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.CUSTOMER_WRITE,
    // ↓ CUSTOMER_MANAGE DÜŞTÜ (Z39, B3 W5 kapanışı) — sıfır-rota, bkz.
    // CAPABILITIES yorumu.
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.MASTER_DATA_WRITE,
    // ↓ MASTER_DATA_MANAGE DÜŞTÜ (Z39 dalga-sonu H3, B3 W8 kapanışı) —
    // sıfır-rota, bkz. CAPABILITIES yorumu.
    // ↓ Z35 bölünmesi (2026-08-24): ADMIN her iki natif kümede de zaten
    // vardı ({A,F} ve {A,P}) — bölünme ADMIN için sonuç DEĞİŞTİRMEZ.
    CAPABILITIES.MODES_ACTUALS_WRITE,
    CAPABILITIES.MODES_PLAN_WRITE,
    // ↓ Z30 H2 (2026-08-24) — dal 1, mekanik.
    CAPABILITIES.MODES_SUBMIT,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ SHARED_WRITE / SHARED_MANAGE DÜŞTÜ (Z39, B3 W5 kapanışı) —
    // sıfır-rota, bkz. CAPABILITIES yorumu. ADMIN'in yazma yeteneği bugün
    // SHARED_POLICY_WRITE/SHARED_ENVELOPE_WRITE/SHARED_SPEND_WRITE'ta
    // (aşağı) — Z36 bölünmesinden beri yürürlükte.
    // ↓ Z36 bölünmesi (2026-08-26, B3 W4b) — ADMIN üçünde de zaten vardı
    // (`{A}`, `{A,F}`, `{A,P}`) — bölünme ADMIN için sonuç DEĞİŞTİRMEZ.
    // SINIF A (`SHARED_POLICY_WRITE`): dayanak `K-2.6.4` rol kataloğunun
    // `YÖNETİCİ | Tanımlar, kural yönetimi` satırı (`L2_03:405`) — POZİTİF
    // ve birebir.
    // ⚠️ ÖNCEKİ GEREKÇE ÖLÇÜMLE YANLIŞTI (code-reviewer S3, 2026-08-26):
    // "ADMIN onay-eşiği şablonunun ÖZNESİ DEĞİL" yaziyordu. ADMIN, onay
    // rotalarinin BESINDE @Roles'ta (plans/:id/{approve,reject,
    // escalate-to-finance} · agreements/:id/{approve,reject}) — yani ADMIN
    // ONAY VEREN TARAFTIR = sablonun oznesidir, ve ayni anda sablonu yazar.
    // ✅ COZULDU (urun sahibi, 2026-08-26): bu bir IHLAL DEGIL — KATMAN
    // KARISIKLIGIYDI. SoD bu sistemde KISI+ISLEM katmaninda yasar
    // (`K-2.6.5c`); rol katmaninda ADMIN'in iki kumede olusu yonetisim
    // cumlesiyle mesru, cunku kisi-bazli SoD ROL UYELIGIYLE IHLAL EDILMEZ.
    // ⛔ Gercek soru KISI katmanindadir ve bugun KAYITSIZ: "bir kisi sablonu
    // degistirip sonra o sablon altinda onay verebilir mi?" — L2'nin uc SoD
    // kurali gonder/onayla eksenini kapsiyor, DEGISTIR/ONAYLA eksenini
    // KAPSAMIYOR. Faz 2 onay-motoru girdi listesine kayitli (`Z36 §3`).
    CAPABILITIES.SHARED_POLICY_WRITE,
    // SINIF B (`SHARED_ENVELOPE_WRITE`): sistem yöneticisi olarak zarf
    // yapısını (oluşturma/split) FINANCE'le PAYLAŞIR — `K-2.2.9c` "finans
    // zarfı büyütür" ADMIN'i dışlamaz, tersine hepsini kapsar.
    CAPABILITIES.SHARED_ENVELOPE_WRITE,
    // SINIF C (`SHARED_SPEND_WRITE`): plan-mekanik dağıtımını PLANNER'la
    // PAYLAŞIR — aynı gerekçe `MODES_PLAN_WRITE`'ta: ADMIN her plan-yazma
    // ucunda zaten var.
    CAPABILITIES.SHARED_SPEND_WRITE,
    // ↓ TENANT_READ: dal 1 (tek rol kümesi — `GET /tenants` zaten ADMIN-only).
    CAPABILITIES.TENANT_READ,
    CAPABILITIES.TENANT_WRITE,
    // ↓ TENANT_MANAGE DÜŞTÜ (Z39, B3 W5 kapanışı) — sıfır-rota, bkz.
    // CAPABILITIES yorumu.
    // ↓ USER_WRITE: dal 1 (tek rol kümesi — 4 ADMIN-only route zaten ADMIN'de).
    CAPABILITIES.USER_WRITE,
    CAPABILITIES.USER_MANAGE,
  ],
  [UserRole.PLANNER]: [
    // ↓ SHARED_READ (W4a, 2026-08-25) — plan/taktik/hacim girişi için bütçe-anlaşma görünürlüğü şart.
    CAPABILITIES.SHARED_READ,
    // ⛔ APPROVAL_QUEUE_READ VERİLMEDİ (Z37 §3, B3 K4 Parça 1, 2026-08-26) —
    // bilinçli, davranış-koruyucu. K-2.6.4 (L2_03:406) "PLANLAMACI — …,
    // GÖNDERİM — günlük kullanıcı" der; PLANNER MODES_SUBMIT'te gönderim
    // yapar ama hiçbir onay-kararı rotasında (MODES_APPROVE/SHARED_APPROVE)
    // @Roles'ta yok.
    // ⚠️ AYIRT EDİCİ DÜZELTİLDİ (code-reviewer S1, 2026-08-26): "onaycı
    // yüzeyi" cümlesi KARDEŞ ROTA tarafından çürütülüyor — AYNI controller'da
    // GET /approvals/:id SHARED_READ = 5/5, yani PLANNER HER ONAY KAYDINI id
    // ile OKUYABİLİYOR (canlı pin: shared-read-w4a-boundary, pinAllFive).
    // ⇒ Gerçek ayırt edici "onaycı yüzeyi" DEĞİL, ENUMERASYON:
    //     LİSTELEME (kuyruğu taramak) ↔ TEKİL OKUMA (bilinen kaydı açmak)
    //   PLANNER kendi gönderdiği kaydı açabilir; TENANT'IN KUYRUĞUNU tarayamaz.
    // ⛔ Eski cümle bırakılsaydı bir sonraki tur ya :id'yi "tutarsız" diye
    //   4/5'e daraltır, ya kuyruğu açardı — İKİSİ DE YANLIŞ ZEMİN.
    // Pin: test/approval-queue-read-boundary.e2e-spec.ts.
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.CUSTOMER_WRITE,
    // ↓ CUSTOMER_MANAGE DÜŞTÜ (Z39, B3 W5 kapanışı) — sıfır-rota, bkz.
    // CAPABILITIES yorumu.
    CAPABILITIES.MASTER_DATA_READ,
    // ↓ Z35 bölünmesi (2026-08-24): PLANNER yalnız PLAN/ANLAŞMA tarafında.
    // ⛔ GERÇEKLEŞME yazımı (agreement-transaction · on-invoice ·
    // sales-actuals) PLANNER'dan DÜŞTÜ — 2026-08-17 union'ı onu oraya
    // açmıştı ve bu K-2.6.14'ün YÜRÜRLÜKTEKİ fazına çarpıyordu
    // ("bugün yalnız finans + yönetici"). T-277 aynı daraltmayı @Roles
    // tarafında iki repoda indirmişti; bu satır haritayı ona eşitler.
    CAPABILITIES.MODES_PLAN_WRITE,
    // ↓ Z30 H2 (2026-08-24) — dal 1, mekanik. K-2.6.4 (L2_03:406):
    // "PLANLAMACI — …, GÖNDERİM — günlük kullanıcı".
    CAPABILITIES.MODES_SUBMIT,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ SHARED_WRITE DÜŞTÜ (Z39, B3 W5 kapanışı) — sıfır-rota; kilit metni
    // .claude/backlog/tasks/T-293.md'ye taşındı, bkz. CAPABILITIES yorumu.
    // Yürürlükteki PLANNER yazma yeteneği: SHARED_SPEND_WRITE (aşağı).
    // ↓ Z36 bölünmesi (2026-08-26, B3 W4b) — SINIF C (`SHARED_SPEND_WRITE`)
    // {ADMIN,PLANNER}: PLANNER, plan→FU→SKU mekanik dağıtımının ızgara-
    // yazımını yapan taraf (`distribute`/`recalculate-on-volume-change`,
    // `T-249`'un emsali `plan.controller.ts` yazma rotalarıyla AYNI kümede
    // — plan düzenleme FINANCE/CATEGORY_MANAGER/READONLY işi değil).
    // ⛔ SINIF A (`SHARED_POLICY_WRITE`) ve SINIF B (`SHARED_ENVELOPE_WRITE`)
    // PLANNER'a VERİLMEDİ — PLANNER onay-şablonunun öznesi değil (SoD dışı
    // sorun yok, ama yönetişim değil) ve zarf yapısı bir bütçe-sahipliği
    // kararı (`K-2.2.9c`), PLANNER'ın işi değil.
    CAPABILITIES.SHARED_SPEND_WRITE,
  ],
  [UserRole.CATEGORY_MANAGER]: [
    // ↓ SHARED_READ (W4a, 2026-08-25) — kategori bütçe sahibi: onay ve zarf yönetimi görünürlük ister.
    CAPABILITIES.SHARED_READ,
    // ↓ APPROVAL_QUEUE_READ (Z37 §3, B3 K4 Parça 1, 2026-08-26) — onay
    // kuyruğunun bir TARAFI: plans/:id/{approve,reject,escalate-to-finance}
    // rotalarında @Roles'ta zaten var (MODES_APPROVE); kuyruğu görmeden
    // onaylayamaz.
    CAPABILITIES.APPROVAL_QUEUE_READ,
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ SHARED_WRITE DÜŞTÜ (Z39, B3 W5 kapanışı) — sıfır-rota, bkz.
    // CAPABILITIES yorumu. CATEGORY_MANAGER'ın Z36 üçlüsünden aldığı YOK
    // (aşağıdaki not KORUNDU — bugün de doğru).
    // ⛔ Z36 bölünmesi (2026-08-26, B3 W4b) — CATEGORY_MANAGER SIFIR aldı.
    // Sekiz rotanın hiçbirinde CM `@Roles`'ta yoktu (approval-policies
    // {ADMIN} · budget/envelopes[,/split] {ADMIN,FINANCE} · spend-calc
    // distribute/recalculate {ADMIN,PLANNER}) — bu göç `@Roles`'u
    // `@RequireCapability`'e TAŞIYOR, davranışı GENİŞLETMİYOR. CM'nin zarf
    // ÜZERİNDEKİ konumu ONAY tarafında zaten karşılanmış (`Z36 §4`).
    // ⚠️ ATIF DÜZELTİLDİ (code-reviewer S1, 2026-08-26): önce
    // `MODES_APPROVE_CATEGORY` yeteneğine atıf veriyordu — o sabit KODDA
    // YOK (repo genelinde yalniz UC DOKUMAN satirinda geciyor). CM'nin onayi
    // bugun YETENEK uzerinden degil `@Roles` uzerinden yasiyor, ve OLCULDU:
    //   plans/:id/{approve,reject,escalate-to-finance}  ADMIN,CATEGORY_MANAGER
    //   agreements/:id/{approve,reject}                 ADMIN,CATEGORY_MANAGER,FINANCE
    // Dislamanin OZU dogru; dayanagi artik VAR OLAN bir yuzey.
  ],
  [UserRole.FINANCE]: [
    // ↓ SHARED_READ (W4a, 2026-08-25) — eşik üstü onay/transfer/mutabakat görünürlük ister.
    CAPABILITIES.SHARED_READ,
    // ↓ APPROVAL_QUEUE_READ (Z37 §3, B3 K4 Parça 1, 2026-08-26) —
    // agreements/:id/{approve,reject} rotalarında @Roles'ta zaten var;
    // eşik-üstü onaycı KUYRUĞU GÖRMEDEN onaylayamaz.
    // ⛔ "kendi bekleyen işlerini" ifadesi ÇÜRÜDÜ — kuyruk bugün
    // TENANT-GENELİ (T-276, P0 açık). Yukarıdaki uzun nota bkz.
    CAPABILITIES.APPROVAL_QUEUE_READ,
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    // ↓ Z35 bölünmesi (2026-08-24): FINANCE yalnız GERÇEKLEŞME tarafında.
    // ⛔ Plan CRUD (DELETE /plans/:id dahil) FINANCE'ten DÜŞTÜ —
    // 2026-08-17 union'ı onu oraya açmıştı ve bu K-2.6.4'ün FİNANS
    // listesine çarpıyordu (plan YAZIMI yok).
    CAPABILITIES.MODES_ACTUALS_WRITE,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ SHARED_WRITE DÜŞTÜ (Z39, B3 W5 kapanışı) — sıfır-rota, bkz.
    // CAPABILITIES yorumu. FINANCE'in yürürlükteki yazma yeteneği
    // SHARED_ENVELOPE_WRITE (aşağı, SINIF B).
    // ↓ Z36 bölünmesi (2026-08-26, B3 W4b) — SINIF B (`SHARED_ENVELOPE_WRITE`)
    // {ADMIN,FINANCE}. ⚠️ GEREKÇE DÜZELTİLDİ (code-reviewer S2, 2026-08-26)
    // — önce `K-2.2.9c`'ye ("finans zarfı büyütür") yaslanıyordu; ölçüm
    // zincirin İKİ HALKADA koptuğunu gösterdi:
    //   (1) K-2.2.9c ASIMIN cozumunu, yani zarfin BUYUTULMESINI tarif eder.
    //       Bu iki rota zarf BUYUTMUYOR: createEnvelope = olusturma;
    //       splitEnvelope = yeniden etiketleme ve kodun kendi kontrolu
    //       (`budget.service.ts`, splitEnvelope govdesi) toplamin
    //       DEGISMEDIGINI EPSILON ile ZORLUYOR.
    //   (2) "ONAYLAYAN CM, ayri kanal" diye bir kanal YOK — bu iki govdede
    //       onay adimi bulunmuyor.
    // ⇒ DOGRU IFADE: bugunku {A,F} `K-2.2.9c`'nin TUREVI DEGIL, `@Roles`'un
    //   KORUNMUS halidir (createEnvelope/splitEnvelope zaten
    //   `@Roles(ADMIN,FINANCE)` tasiyordu — goc davranisi KORUYOR).
    //   `K-2.6.4`'un "zarf yonetimi"ni KATEGORI MUDURU satirina yazmasiyla
    //   olan gerilim `Z36 §4`'un CIFT KOSULUYLA acik tutuluyor.
    // ⛔ SINIF A (`SHARED_POLICY_WRITE`) FINANCE'e VERİLMEDİ.
    // Davranışsal dayanak KESİN: `PATCH /approval-policies/:id` bugün de
    // `@Roles(ADMIN)` taşıyordu — göç davranışı KORUYOR, genişletmiyor.
    // ⚠️ GEREKÇE ATFI DÜZELTİLDİ (code-reviewer B1, 2026-08-26): önce
    // `K-2.6.4a/b`'ye "sablonun oznesi olan rol, sablonu duzenleyemez" diye
    // ALINTI veriyordu. O CUMLE O KURALDA YOK (olculdu: `duzenleyemez`
    // L2_03'te SIFIR eslesme; poz.kontrol: `onay` 109 kez eslesiyor).
    // K-2.6.4a = "rol ... adres defteridir", K-2.6.4b = "onaycı jenerik
    // degildir, butcenin sahibidir".
    // ✅ VE HUKUM GELDI (urun sahibi, 2026-08-26): SoD ROL KATMANINA
    // TASINMAZ — `K-2.6.5c` dogru ve dokunulmaz. FINANCE'in disarida kalisi
    // bir SoD sonucu DEGIL, bir YONETISIM sonucudur: `K-2.6.4` rol katalogu
    // kural yonetimini YONETICI satirina yaziyor, ve kume O CUMLEDEN turer.
    // ⚠️ SoD argumani HIC GEREKMIYORDU — kural, kendisi olmadan da dogru olan
    // bir sonucu gerekcelendirmek icin yazilmisti (`DISIPLIN`: "hicbir seyi
    // elemeyen bir vaka, kural gerekcesi olamaz"). ⛔ SINIF C
    // (`SHARED_SPEND_WRITE`) de VERİLMEDİ — plan-mekanik dağıtımı PLAN
    // düzenleme işi, FINANCE'in konusu değil (`T-249` emsali).
    CAPABILITIES.SHARED_ENVELOPE_WRITE,
  ],
  [UserRole.READONLY]: [
    // ↓ SHARED_READ (W4a, 2026-08-25) — İZLEYİCİ bir İZLEME YETENEKLERİ SETİDİR (K-2.6.4c).
    CAPABILITIES.SHARED_READ,
    // ↓ APPROVAL_QUEUE_READ (Z37 §3, B3 K4 Parça 1, 2026-08-26) — K-2.6.4c
    // "İZLEYİCİ bir İZLEME YETENEKLERİ SETİDİR": onay kuyruğu bir izleme
    // yüzeyi, işlem yüzeyi değil (READONLY onay VEREMEZ — MODES_APPROVE/
    // SHARED_APPROVE hiçbir yerinde READONLY yok).
    CAPABILITIES.APPROVAL_QUEUE_READ,
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    // ↓ ADIM 3 Faz A (2026-08-17): READONLY hiçbir ÇÖZÜLDÜ hücrenin union'ında
    // yok (MODES_WRITE/SHARED_WRITE/TENANT_READ/USER_WRITE'ın hiçbiri
    // READONLY içermiyor) — bilinçli, ekleme yok.
    // ⛔ BAYAT (W4a, 2026-08-25): SHARED_READ eklendi — ama bir UNION'DAN
    // DEĞİL, K-2.6.4c'nin AÇIK CÜMLESİNDEN ("İZLEYİCİ bir izleme yetenekleri
    // setidir"). Yukarıdaki cümle union'lar hakkındaydı ve o kısmı hâlâ doğru.
    // ⛔ Z36 bölünmesi (2026-08-26, B3 W4b): READONLY üç yeni yetenekten de
    // SIFIR aldı — sekiz rotanın hiçbirinde READONLY `@Roles`'ta değildi
    // (İZLEYİCİ bir İZLEME setidir, yazma değil). Davranış KORUNUYOR.
  ],
};
