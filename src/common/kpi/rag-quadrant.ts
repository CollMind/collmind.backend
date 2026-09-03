/**
 * RAG — **İKİ EKSENLİ KADRAN** ve **TANIMLI-YOKLUK**: TEK NOKTA.
 *
 * Ürün sahibi hükmü (`Z66 §2` · `Z68 §1`, Excel kanonik —
 * `docs/research/DEMO_EXCEL_KPI_TACTIC_REFERANSI.md`):
 *
 * ```
 * Red     iTO <= 0
 * Amber   iTO >  0  AND  iGP <= 0        ← "satış var, kâr yok"
 * Green   ikisi de > 0
 * ```
 *
 * ⛔ Tek-eksen eşik (`kpis.rag_green_threshold` / `rag_amber_threshold`) bu
 * iki yarıyı **tek sayıya ezer** ve `AMBER`'ın anlamını siler. Kadran
 * `GP_ROI_PCT`'nin DEĞERİNE bakmaz — kendi iki eksenini okur.
 *
 * ── `S1` · TANIMLI-YOKLUK (`Z68 §2`) ─────────────────────────────────
 * LTA-only bir plan **bir promosyon değerlendirmesi değildir**: incremental
 * promo ekseni yoktur, plan baseline'ın **sözleşmeli hâlidir**.
 *
 * ⚠️ **Ve bu kural kadran indiği gün ZORUNLU HÂLE GELDİ** — ölçüldü
 * (`T-342`, dört-kadran fixture'ının `HÜCRE 4`'ü, `cppOn=0 · cppOff=0`):
 *
 * ```
 * ÖNCE (tek eksen)  INCR_PROMO_SPEND = 0 → GP_ROI_PCT = null → RAG = null
 *                   ⇒ renksizlik BEDAVA geliyordu (paydanın yan etkisi)
 * SONRA (kadran)    iTO = -11.700 · iGP = +300  → İKİ EKSEN DE DOLU
 *                   ⇒ kadran hiçbir kapı olmadan `RED` üretirdi
 * ```
 *
 * Yani kadran inişi, **hiç promosyon olmayan bir plana bir promosyon
 * yargısı** yapıştırırdı — `DISIPLIN`'in *"dürüst-`null`'un yerine
 * kısmi-doğru-sayı koymak"* sınıfının renk hâli. Kapı bu yüzden burada.
 *
 * ⛔ İki yasaklı şekil, ve neden üçüncü bir durum gerektiği:
 * ```
 * RAG'ı ZORLA üret  → ANLAMSIZ RENK    (yukarıdaki `RED`)
 * boş bırak         → SESSİZ BOŞLUK    ("Red değil" ile "değerlendirilmedi" ayrılmaz)
 * ⇒ ragStatus: null  +  ragExclusionReason: 'LTA_ONLY'
 * ```
 *
 * 📌 Alan adı **bilerek geniş** (`ragExclusionReason`, `RagExclusionReason`):
 * dışlama sebebi yarın başka olabilir; `DISIPLIN` — *"bir ad, koruduğu
 * SINIFTAN dar olabilir"*. Bugün **tek üye** doğar (`İlke 1`: ihtiyacı
 * olmayan üye açılmaz).
 */

import { ROI_DENOMINATOR_KPI_CODE } from './roi-denominator';

/** Kadranın ciro ekseni (`iTO`) — Excel `PlannedIncrTO`. */
export const RAG_QUADRANT_TURNOVER_AXIS_KPI_CODE = 'INCR_TO' as const;

/** Kadranın kâr ekseni (`iGP`) — Excel `PlannedIncrGP`. */
export const RAG_QUADRANT_PROFIT_AXIS_KPI_CODE = 'INCR_GP' as const;

/**
 * Dışlama yargısının okuduğu kalem: **incremental promo harcaması**.
 * ⛔ Elle tekrarlanmaz — ROI paydasının **tek noktasından** türetilir
 * (`roi-denominator.ts`, `Z66 §1`). İkisi aynı soruyu sorar: *"bu planda
 * promosyon var mı?"* Payda değişirse bu kapı da onunla birlikte değişir
 * (`F8` ailesi: aynı kavram iki dosyada iki farklı isimle yaşamasın).
 */
export const RAG_EXCLUSION_SCOPE_KPI_CODE = ROI_DENOMINATOR_KPI_CODE;

/**
 * `BL-4b` (`Z90 §2` · `Z91 §3`) — `BASELINE_MISSING`'İ ATAYAN sinyalin
 * okunduğu KPI kodu: **taban hacim, kullanıcı girdisi** (`kpi.seed.ts`
 * `calculationOrder: 1`, `formulaText: 'BASE_VOL'`).
 *
 * ⛔ Elle tekrarlanmaz — `BASE_VOL` `main.kpis` sözlüğünün kodudur, burada
 * yalnız ADLANDIRILIR (`RAG_EXCLUSION_SCOPE_KPI_CODE` emsali).
 *
 * ⚠️ Bu kadranın kendi ÜÇ sayısal ekseninden (`incrTo`/`incrGp`/
 * `incrPromoSpend`) BİRİ DEĞİLDİR — `attributeBaselineMissing`'in okuduğu
 * AYRI bir sinyaldir (aşağıya bkz.).
 */
export const RAG_BASELINE_INPUT_KPI_CODE = 'BASE_VOL' as const;

/**
 * Kadran rengini **taşıyan** KPI kodu.
 *
 * Bu bir hesap değil, bir **yerleşim** kararıdır: `plan_skus.rag_status`,
 * `plan_fus.rag_status` ve `plans.rag_status` sütunlarının üçü de
 * `PlanService` içinde bu KPI'nın sonucundan yazılır. Kod eskiden orada
 * **elle** yazılıydı; tek noktaya alındı (`T-342`).
 *
 * ⚠️ Diğer KPI'ların eşik-tabanlı RAG'ı **değişmedi** — kadran yalnız
 * taşıyıcıya iner (`Z66 §2` RAG modelini konuşur, eşik mekanizmasının
 * tamamını değil).
 */
export const RAG_CARRIER_KPI_CODE = 'GP_ROI_PCT' as const;

/**
 * RAG'ın **hesaplanmadığı ama bunun MEŞRU olduğu** durumların sınıfı.
 * ⚠️ *"Hesaplanamadı"* (eksik veri) bu sınıfa GİRMEZ — onun taşıyıcısı
 * `ragStatus: null` + `coverageRatio`'dur (`K-2.4.22a/b/c`, `T-177`).
 */
export enum RagExclusionReason {
  /** Planda incremental promo harcaması yok ⇒ promosyon değerlendirmesi değil. */
  LTA_ONLY = 'LTA_ONLY',
  /**
   * `BL-4` (`docs/process/BL4_YUZEY_BRIEF.md §1b/§1c`) · `BL-4b` (`Z90 §2` ·
   * `Z91 §3`) — SKU'nun `BASE_VOL` (taban hacim) girdisi `NULL`: plan
   * seviyesinde `plan_skus.base_volume` girilmemiş. İncremental eksenler
   * (`iVol`/`iTO`/`iGP`/uplift/ROI) bu SKU için **hesaplanamaz** — bu ayrı
   * bir sınıftır, `LTA_ONLY`'nin yerine geçmez (o "promosyon yok", bu
   * "referans yok").
   *
   * ⛔ **`0` bu üyeyi TETİKLEMEZ** — `base_volume = 0` MEŞRU bir değerdir
   * (yeni ürün) ve uplift = planlanan hacmin tamamı olarak HESAPLANIR.
   * Yalnız `NULL` `BASELINE_MISSING` üretir (`§1c`, `Z77`'nin tersi — dal
   * seçimi `=== null` ile yapılır, truthiness ile DEĞİL, bkz.
   * `sku-spend-inputs.ts` emsali). Üretici: `attributeBaselineMissing`
   * (bu dosya) + `kpi-engine.service.ts#resolveCarrierRag`.
   *
   * ⚠️ **SINIR:** bu üye `plan_skus.base_volume`'un KENDİSİNİN `null`
   * olmasını okur — `BASE_VOL`'un ayrıca SKU×CPL×period grain'i için
   * `baseline_volumes` (master-data import) tablosundan OTOMATİK
   * doldurulup doldurulmadığı (`BL-4`'ün kapsadığı import/coverage tarafı)
   * BAŞKA bir sorudur ve BUGÜN bağlı DEĞİLDİR (`Z90 §1`: "servis
   * controller'a bağlı değil"). Yani bir plan_sku'nun baseline'ı elle de
   * girilmemişse (ya da hiçbir otomatik doldurma yolu yoksa) bu üye üretilir
   * — kaynağın import mı, elle giriş mi olacağı ayrı bir tur.
   */
  BASELINE_MISSING = 'BASELINE_MISSING',
}

export type RagColor = 'RED' | 'AMBER' | 'GREEN';

export interface RagQuadrantOutcome {
  ragStatus: RagColor | null;
  /** Yalnız `ragStatus === null` iken dolu olabilir. */
  ragExclusionReason: RagExclusionReason | null;
}

/**
 * Kadranı uygular. **Girdi eksikse renk UYDURMAZ** (`§2.5`).
 *
 * ── ⛔ SINIRLAR NEDEN KODDA SABİT — VE BU `§2.3` İHLALİ DEĞİL ────────────
 * `§2.3` *"eşikleri hardcode etme, konfigürasyondan oku"* der. Buradaki
 * `0` çizgileri bir **eşik değildir**; `Z69 §4b`'nin adlandırdığı
 * **DAYANDIĞI-ALAN DEĞİŞİMİ** vakasıdır:
 * ```
 * KURAL yaşar                       "hardcoded yasak, konfigürasyondan"
 * NE'nin konfigüre edildiği DEĞİŞİR  eşik → (kadranda) hiçbiri
 * ```
 * `İlke 3` sorusu soruldu (*"kullanıcı bunu düzenlemek ister mi?"*) ve
 * cevap **HAYIR** (`Z70 §2`): kadranın tanımı **işaret** tabanlıdır —
 * ### `"sıfırdan büyük"` konfigüre edilecek bir DEĞER değil, KAVRAMIN KENDİSİDİR.
 *
 * ⛔ Ve geri dönüş kapısı adlandırıldı: `AMBER`'ı bir eşiğe bağlamak
 * (*"`iGP < −5000` olursa Amber"*) kadranı **geri-eşiğe** çevirir — dün
 * öldürülen tek-eksen dünyasının geri dönüş kapısı.
 *
 * ⚠️ Konfigüre edilebilirlik **ertelendi, reddedilmedi** (`Z69 §4b`):
 * tetikleyici bir tenant'ın *"kadran yetmez"* talebidir, olay-tetikli ve
 * süzgeçten geçer (`İlke 1`: bugün spekülatif konfigürasyon inşa edilmez).
 *
 * Sıra bilinçlidir:
 *  1. **Kapsam** yargısı (*"bu bir promosyon değerlendirmesi mi?"*) —
 *     `incrPromoSpend === 0` ⇒ `LTA_ONLY`. `0` **tam sayısal sıfırdır**;
 *     `null`/`undefined` sessizce `0` sayılmaz (o eksik VERİDİR, aşağı düşer).
 *  2. **Veri** yargısı — eksenlerden biri çözülemediyse renk YOK, ve bu bir
 *     dışlama DEĞİLDİR (sebep `null`): taşıyıcısı KPI'nın kendi `null`
 *     değeri ve `coverageRatio`'dur.
 *  3. Kadran.
 */
export function resolveRagQuadrant(
  incrTo: number | null | undefined,
  incrGp: number | null | undefined,
  incrPromoSpend: number | null | undefined,
): RagQuadrantOutcome {
  if (incrPromoSpend === 0) {
    return {
      ragStatus: null,
      ragExclusionReason: RagExclusionReason.LTA_ONLY,
    };
  }

  if (
    incrTo === null ||
    incrTo === undefined ||
    incrGp === null ||
    incrGp === undefined
  ) {
    return { ragStatus: null, ragExclusionReason: null };
  }

  if (incrTo <= 0) return { ragStatus: 'RED', ragExclusionReason: null };
  if (incrGp <= 0) return { ragStatus: 'AMBER', ragExclusionReason: null };
  return { ragStatus: 'GREEN', ragExclusionReason: null };
}

/**
 * `BL-4b` (`Z90 §2` · `Z91 §3`) — `resolveRagQuadrant`'ın **VERİ** dalı
 * (`ragStatus: null, ragExclusionReason: null`) iki AYRI olguyu tek `null`'a
 * ezer: *"eksik veri, sebep belirsiz"* ile *"baseline hiç girilmemiş"*.
 * `resolveRagQuadrant` bunu kendi başına AYIRAMAZ — üç sayısal eksenden
 * (`incrTo`/`incrGp`/`incrPromoSpend`) hiçbiri *"baseline var mıydı"*
 * bilgisini TAŞIMIYOR (brief `§2` DUR şartı).
 *
 * ⛔ **İmza DEĞİŞMEDİ — 4. parametre EKLENMEDİ.** Tek çağıran
 * (`kpi-engine.service.ts` `resolveCarrierRag`, ölçüldü: `resolveRagQuadrant`
 * repo genelinde TEK yerden çağrılıyor) zaten `results['BASE_VOL']`'u — KPI
 * motorunun `BASE_VOL`'u `calculationOrder: 1`'de, taşıyıcıdan (`order: 48`)
 * ÖNCE hesapladığının garantisiyle — elinde tutuyor. Sinyali kadranın
 * SAYISAL sözleşmesine sokmak (4. parametre) `incrTo`/`incrGp`/
 * `incrPromoSpend`'in aksine bu bir EKSEN DEĞİL, bir NEDEN-ATIFI'dır; kadranı
 * genel-amaçlı ve payda-agnostik tutmak için post-processing adımı olarak
 * AYRI bırakıldı — çağıranda zaten mevcut bilgiyi taşımak için imza kırmaya
 * gerek yok.
 *
 * `Z90 §2` hükmü VERİ dalı içinde koşulsuzdur: baseline `NULL` ⇒ sebep
 * `BASELINE_MISSING`, başka bir alanın (ör. COGS) da eksik olup olmadığına
 * BAKILMAKSIZIN — yani bu fonksiyon yalnız `baseVolValue === null`'a bakar,
 * VERİ dalının hangi bağımlılıktan tetiklendiğini ayrıca izlemez.
 *
 * ⛔ **AMA `LTA_ONLY` ÖNCELİKLİDİR — VE BU BİR SIRALAMA KARARIDIR, ÖLÇÜLDÜ:**
 * ```
 * baseVol === null  +  incrPromoSpend === 0   ⇒  LTA_ONLY   (BASELINE_MISSING DEĞİL)
 * ```
 * `resolveRagQuadrant` KAPSAM yargısını (`incrPromoSpend === 0`) VERİ
 * yargısından ÖNCE verir; bu fonksiyon dolu bir sebebin üstüne yazmaz. Yani
 * *"bu bir promosyon değerlendirmesi değil"* yargısı, *"referansı yok"*
 * yargısını YUTAR — çünkü değerlendirilmeyecek bir planın referansının
 * eksikliği kullanıcıya bir eylem önermez.
 *
 * ⚠️ `§2.5` *gizli tie-break* yasağı gereği bu öncelik **yazılıdır ve
 * testle pinlenmiştir** — bir okuyucunun sırayı koddan çıkarması
 * beklenmez. (`code-reviewer` bulgusu, 2026-09-03: ilk yazımda
 * *"koşulsuzdur"* deniyordu ve okuyucuyu ters yöne çekiyordu.)
 *
 * `0` bu fonksiyonu TETİKLEMEZ (`Z77`'nin tersi, `=== null` ile dal seçimi):
 * `baseVolValue === 0` ⇒ `resolveRagQuadrant` zaten VERİ dalına hiç
 * düşmemiştir (`incrTo`/`incrGp` dolu), bu fonksiyon o dalı GÖRMEZ bile.
 */
export function attributeBaselineMissing(
  outcome: RagQuadrantOutcome,
  baseVolValue: number | null | undefined,
): RagQuadrantOutcome {
  if (outcome.ragStatus !== null || outcome.ragExclusionReason !== null) {
    // Renk üretilmiş (kadran) ya da başka bir sebep zaten atanmış
    // (`LTA_ONLY`) — bu ikisinin ÜSTÜNE yazılmaz.
    return outcome;
  }
  if (baseVolValue === null) {
    return {
      ragStatus: null,
      ragExclusionReason: RagExclusionReason.BASELINE_MISSING,
    };
  }
  return outcome;
}

/**
 * JSONB'den (ya da başka bir gevşek-tipli taşıyıcıdan) geri okunan bir
 * dışlama sebebini **sınıfa daraltır.**
 *
 * ⛔ Tanınmayan bir dize sessizce bir sebep sayılmaz — `null` döner, yani
 * sonuç *"değerlendirilemedi"* tarafına düşer. Uydurma bir sebep, uydurma
 * bir renk kadar zararlıdır: kullanıcıya *"bu meşru bir yokluk"* der.
 */
export function parseRagExclusionReason(
  raw: unknown,
): RagExclusionReason | null {
  if (raw === RagExclusionReason.LTA_ONLY) return RagExclusionReason.LTA_ONLY;
  if (raw === RagExclusionReason.BASELINE_MISSING) {
    return RagExclusionReason.BASELINE_MISSING;
  }
  return null;
}

/** Renk de sebep de yok — bir KPI'nın RAG taşımadığı hâl. */
export const RAG_NOT_APPLICABLE: RagQuadrantOutcome = Object.freeze({
  ragStatus: null,
  ragExclusionReason: null,
});
