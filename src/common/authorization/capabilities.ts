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
 * ```
 *
 * Bu 10 düzeltme **hiçbiri yeni hücre açmadı** — hepsi zaten dolu olan bir
 * (modül, sınıf) hücresine taşındı, yani `24` dolu hücre sayısı DEĞİŞMEDİ.
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
 * ### ⛔ 9/24 hücre BLOKE — ürün sahibi kararı bekliyor (bu turun DUR bulgusu)
 *
 * `0072`, rol kümesi sıklığını TÜM route'lar üzerinden ölçtü (`§2`), ama
 * HÜCRE-İÇİ tutarlılığı ölçmedi. Bu tur ölçtü: 24 hücrenin **9'unda**, o
 * hücreye düşen route'lar BUGÜN FARKLI rol kümeleri taşıyor (bazıları hiç
 * `@Roles` taşımıyor — filtresiz). Tek bir yetenek adı altında toplamak,
 * bu route'lardan bazılarının erişimini GENİŞLETİR ya da DARALTIR — bu bir
 * mekanik yeniden adlandırma değil, bir **RBAC politika kararı**.
 *
 * `§2.5`/`§2.4` (CLAUDE.md): sessiz varsayım YOK. Bu 9 yetenek `CAPABILITIES`
 * sabitinde TANIMLI (taksonomi 24'ü tam kapsasın diye — 0072'nin tabanı budur),
 * ama `ROLE_CAPABILITIES`'te HİÇBİR role atanmadı. `@RequireCapability` bugün
 * hiçbir route'a uygulanmadığı için (Faz B, ayrı tur) bunun bugün davranışsal
 * etkisi YOK — ama Faz B bu haritayı OLDUĞU GİBİ tüketecek, yani karar Faz
 * B'den ÖNCE verilmeli:
 *
 * ```
 * MODES_READ    (modes:okuma, 37 route)   7 farklı rol kümesi + 1 filtresiz
 * MODES_WRITE   (modes:yazma, 18 route)   3 farklı rol kümesi
 * MODES_APPROVE (modes:onay, 13 route)    3 farklı rol kümesi + 2 filtresiz
 *                                          (2'si ALAN guard'lı: Reversal/
 *                                          SettlementGuard — 0072 §4b)
 * SHARED_READ   (shared:okuma, 36 route)  3 farklı rol kümesi + 20 filtresiz
 * SHARED_WRITE  (shared:yazma, 14 route)  4 farklı rol kümesi + 4 filtresiz
 * SHARED_APPROVE(shared:onay, 5 route)    4 farklı rol kümesi (CATEGORY_MANAGER
 *                                          tek başına 2, geri kalan 3 route'un
 *                                          her biri FARKLI ikili)
 * TENANT_READ   (tenant:okuma, 3 route)   1 ADMIN + 2 filtresiz
 * USER_READ     (user:okuma, 4 route)     2 farklı rol kümesi + 2 filtresiz
 * USER_WRITE    (user:yazma, 9 route)     1 ADMIN kümesi + 5 filtresiz
 *                                          (bunların 3'ü `auth.controller.ts`
 *                                          login/refresh/logout — kasıtlı
 *                                          kimliksiz/self-servis, ADMIN'in
 *                                          diğer 4 rotasıyla AYNI kovaya
 *                                          konursa anlamsız bir karışım olur)
 * ```
 *
 * Seçenekler (Team Lead'e, ürün sahibine gider):
 *   (a) UNION — hücredeki her rol kümesinin BİLEŞİMİ yetenek sahibi olur.
 *       Hiçbir mevcut erişim KAPANMAZ, ama bazı route'lar bugünkünden DAHA
 *       GENİŞ role açılır (ör. `MODES_WRITE` bugün `{ADMIN,PLANNER}` VEYA
 *       `{ADMIN,FINANCE_MANAGER}` olan route'ları tek kümede
 *       `{ADMIN,PLANNER,FINANCE_MANAGER}` yapar — PLANNER'ın bugün
 *       giremediği bir FINANCE_MANAGER route'una erişimi açılır).
 *   (b) İŞLEM SINIFINI DAHA İNCE BÖL — `modes:onay` yerine
 *       `modes:onay:plan` / `modes:onay:agreement` / `modes:onay:budget` gibi
 *       alt-sınıflar. 24 hücre büyür (kaç olacağı ölçülmedi), ama route'ların
 *       gerçek rol kümesiyle BİREBİR eşleşme ihtimali artar.
 *   (c) Bu 9 kapsam DIŞI bırakılır — o route'lar `@Roles` ile kalmaya DEVAM
 *       eder (Faz B'nin göçü yalnız kalan 15 kapasiteyi taşır). `İlke 4`
 *       riski: iki mekanizma kalıcı olarak bir arada yaşar.
 *   (d) filtresiz olanlar ÖNCE `K-2.6.6` rotasıyla kapatılır (bkz. FAZ1_PLAN
 *       §5 Faz B, "72 uç kimlik doğrulanmış rol kısıtı yok"), SONRA bu 9
 *       hücre yeniden ölçülür — filtresiz route'lar temizlenince bazı
 *       hücreler UNIFORM'a düşebilir.
 *
 * `login`/`refresh`/`logout` üçlüsü (`USER_WRITE`'ın filtresiz beşlisinin
 * parçası) ayrıca not: `login`/`refresh` zaten `@Public()` (bu turda
 * eklendi, `public.decorator.ts`) — bunlar kavramsal olarak `USER_WRITE`
 * kapsamında OLMAMALI (kimliksiz erişim bir "yetenek" değil, kimlik
 * doğrulamanın ÖN KOŞULUDUR). Bu, seçenek (b)'nin bir alt-kanıtı: en azından
 * `login`/`refresh`/`logout` üçlüsünün `USER_WRITE`'tan AYRI tutulması
 * gerekiyor, aksi hâlde "yetenek" ile "genel kimlik doğrulama ucu" kavramsal
 * olarak karışıyor.
 */

export const CAPABILITIES = {
  ADMIN_READ: 'admin:read',

  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',
  CUSTOMER_MANAGE: 'customer:manage',

  MASTER_DATA_READ: 'master-data:read',
  MASTER_DATA_WRITE: 'master-data:write',
  MASTER_DATA_MANAGE: 'master-data:manage',

  // ⛔ BLOKE — yukarıdaki "9/24 hücre BLOKE" bölümüne bkz. Hiçbir role
  // atanmadı; Faz B bu üçünü TÜKETMEDEN önce ürün sahibi kararı gerekir.
  MODES_READ: 'modes:read',
  MODES_WRITE: 'modes:write',
  MODES_APPROVE: 'modes:approve',
  MODES_MANAGE: 'modes:manage',

  NOTIFICATION_READ: 'notification:read',
  NOTIFICATION_WRITE: 'notification:write',

  // ⛔ BLOKE — SHARED_READ / SHARED_WRITE / SHARED_APPROVE (bkz. üstteki not).
  SHARED_READ: 'shared:read',
  SHARED_WRITE: 'shared:write',
  SHARED_APPROVE: 'shared:approve',
  SHARED_MANAGE: 'shared:manage',

  // ⛔ BLOKE — TENANT_READ (bkz. üstteki not).
  TENANT_READ: 'tenant:read',
  TENANT_WRITE: 'tenant:write',
  TENANT_MANAGE: 'tenant:manage',

  // ⛔ BLOKE — USER_READ / USER_WRITE (bkz. üstteki not).
  USER_READ: 'user:read',
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
 * Yalnız 24 hücreden **UNAMBIGUOUS 15'i** dolduruldu (5 tamamen filtresiz —
 * "bugün herkese açık" → tüm rollere verildi, davranış korunuyor; 10 tek bir
 * rol kümesiyle uniform — o kümeye verildi). Kalan **9 BLOKE** hücre
 * (`CAPABILITIES` yorumuna bkz.) hiçbir rolün listesinde YOK — ürün sahibi
 * kararına kadar. Bu, bir eksiklik değil, `CLAUDE.md §2.4`'ün gereği: bir
 * yetenek adının hangi role verileceği belirsizken sessizce doldurulmaz.
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
    CAPABILITIES.MODES_MANAGE,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    CAPABILITIES.SHARED_MANAGE,
    CAPABILITIES.TENANT_WRITE,
    CAPABILITIES.TENANT_MANAGE,
    CAPABILITIES.USER_MANAGE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.PLANNER]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.CUSTOMER_WRITE,
    CAPABILITIES.CUSTOMER_MANAGE,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.CATEGORY_MANAGER]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.FINANCE]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.MODES_MANAGE,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    CAPABILITIES.HEALTH_READ,
  ],
  [UserRole.READONLY]: [
    CAPABILITIES.CUSTOMER_READ,
    CAPABILITIES.MASTER_DATA_READ,
    CAPABILITIES.NOTIFICATION_READ,
    CAPABILITIES.NOTIFICATION_WRITE,
    CAPABILITIES.HEALTH_READ,
  ],
};
