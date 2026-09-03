import { EnteredColumn, hasEnteredValue } from '../numeric/mechanic-input';
import {
  RagExclusionReason,
  parseRagExclusionReason,
} from '../kpi/rag-quadrant';
import {
  belowTargetRoiMessage,
  evaluateTargetRoi,
  isBelowTargetRoi,
  toFiniteDecimal,
} from '../kpi/target-roi';
import {
  countPlannedSkus,
  SpendInputResolution,
} from '../../modules/shared/spend-calculation/sku-spend-inputs';

/**
 * SUBMIT ÖN-DOĞRULAMA + UYARI KATMANI — **TEK NOKTA** (`Z73 §1`, `T-344`).
 *
 * ── NEDEN AYRI BİR MODÜL ────────────────────────────────────────────────
 * Bu mantık `2026-08-02`'den `2026-08-31`'e kadar **ölü bir rotanın
 * içinde** yaşadı: `ApprovalWorkflowService#submitForApproval`
 * (`POST /plans/:id/submit-for-approval`), frontend'in **hiç çağırmadığı**
 * uç (`ADR 0005` ölçümü, `Z73 §1a`). `T-344` o rotayı öldürdü ve davranışı
 * canlı `POST /plans/:id/submit`'e taşıdı.
 *
 * ── NEDEN `src/common/` ALTINDA, `modes/` ALTINDA DEĞİL ────────────────
 * `mode-split` guard'ı (`E1` · `A1` md.2) `src/modules/modes/` bölmesini
 * **dondurdu**: bölme ölü ilan edildi ve birleştirme bekliyor, o yüzden
 * oraya **yeni dosya eklenmez**. İlk yazımda buraya değil oraya konmuştu
 * ve guard **iki bulgu** verdi.
 *
 * ⛔ Baseline'a iki satır ekleyip "ödemek" mümkündü (`T-218` emsali) — ama
 * o emsal, **mevcut** bir dosyanın kaçınılmaz büyümesi içindi. Yeni bir
 * dosyanın **evi seçilebilir**, ve bu modülün `modes/`'a hiçbir bağı yok:
 * saf, I/O'suz, yalnız `common/numeric` + `common/kpi` okuyor. Dondurulmuş
 * bir bölmeyi büyütmek yerine dışına konuldu.
 *
 * ⚠️ **Ve taşıma bir KAPSAM KAYBI üretmemeli:** `modes/planning-first/plan`
 * `money-float` guard'ının **Alan A** listesindeydi; `resolvePlanSpendBreakdown`
 * para üretir ve bir eşikle karşılaştırır ⇒ Alan A üyeliği taşınmalı.
 * `scripts/guards/money-float-domain-a.txt`'e bu dizin **eklendi** —
 * yoksa guard bir para kararını izlemeyi sessizce bırakırdı.
 *
 * ⛔ **Taşıma bir KOPYA olarak yapılmadı, bilerek.** `CLAUDE.md §7`
 * ("yeni kod yazmadan önce ara") bu kod tabanında **iki submit yolu**
 * yüzünden yazıldı; aynı taşımayı bir `copy-paste` ile yapmak, kapatılan
 * sınıfın **yeni bir vakasını** üretirdi. Mantık buraya **saf fonksiyonlar**
 * olarak indi: tek türetim noktası, I/O yok, doğrudan pinlenebilir.
 *
 * ── İKİ KATMAN, VE KARIŞTIRILMAZLAR ─────────────────────────────────────
 * ```
 * validationErrors   BLOKLAR      submit yapılmaz (success:false)
 * warnings           BLOKLAMAZ    submit yapılır, karar desteği konuşur
 * ```
 * `ADR 0005 K2`'nin ikinci gerekçesi (*"kullanıcının bugün submit
 * edebildiği plan yarın da edebilmeli"*) **korunur ve taşınır**: `Q13`
 * katmanının tamamı (`RED` · `AMBER` · `LTA_ONLY` · hedef-altı) `warnings`
 * tarafındadır — `K-2.2.7c` ailesi (`Z70 §1`, `Z73 §2`).
 */

/**
 * ⛔ `any` DEĞİL. Yeni kod `born exact` doğar (ADR 0007 Karar 8.2'nin lint
 * tarafındaki karşılığı): `hasEnteredValue`'nun okuduğu üç kolon.
 */
type PlanMechanicValueLike = Partial<
  Record<EnteredColumn, number | null | undefined>
>;

/**
 * Bloklayan ön-doğrulamalar — **YALNIZ BUGÜN DE BLOKLAYAN ŞEYLER.**
 *
 * ⛔ ÖLÇÜLMÜŞ SINIR (`T-344`, `ADR 0005 K2` gerekçe-2):
 * > *"kullanıcının bugün submit edebildiği plan yarın da edebilmeli"*
 *
 * `Z73 §2` bu gerekçeyi **açıkça KORUYOR**. Ölen rotanın bloklayan
 * kalemleri `/submit`'e taşınırken **ikiye ayrıldı**, çünkü ikisi aynı
 * sınıf değildi:
 * ```
 * "FU yok"                       /submit BUGÜN DE reddediyor (400)   → BLOKLAR
 * "yetersiz bütçe"               /submit BUGÜN DE reddediyor (400,
 *                                reserveTypedForPlan'ın kapısı)      → BLOKLAR
 * "FU'da mekanik/taktik yok"     /submit BUGÜN KABUL EDİYOR          → UYARI
 * ```
 * ⚠️ **Üçüncüsü ölçüldü, tahmin edilmedi:** taşıma bloklayan olarak
 * yapıldığında `plan-review-decision` ve `plan-escalate-to-finance`
 * e2e paketlerinin **sekiz testi** düştü — ikisi de "FU var, taktik yok"
 * şeklinde plan kuruyor ve o plan **bugün gönderilebiliyor**. Yani
 * etkilenen sınıf egzotik bir uç değil, **sıradan bir taslak plan**.
 *
 * ⛔ **BU BİR AJAN KARARI DEĞİL, BİR ÜRÜN SORUSUDUR** ve Team Lead'e
 * bildirildi (`T-344` kapanış raporu). Buradaki seçim **muhafazakâr**
 * olan: hiçbir plan YENİDEN bloklanmıyor. Ürün sahibi *"boş plan
 * gönderilemesin"* derse değişiklik **tek satır**: aşağıdaki
 * `warnings.push` → `validationErrors.push`.
 */
/**
 * ⛔ `🟡-1` — TEK METİN KAYNAĞI. Bu kural İKİ yerde koşar (kilitsiz
 * ön-kontrol + kilit altındaki **yarış koruması**) ve ikisi farklı HTTP
 * şekli kullanır — bu bilinçlidir. Ama kullanıcı aynı eksikliği **iki
 * farklı cümleyle** okumamalı; metin burada, tek yerde.
 */
export const PLAN_MUST_HAVE_FU_MESSAGE = 'Plan must have at least one FU';

export function collectPlanSubmissionValidationErrors(plan: {
  planFus?: Array<{
    fuId?: string;
    fu?: { code?: string } | null;
    tactics?: Record<string, unknown> | null;
    planMechanicValues?: PlanMechanicValueLike[] | null;
  }> | null;
}): string[] {
  const validationErrors: string[] = [];

  if (!plan.planFus || plan.planFus.length === 0) {
    validationErrors.push(PLAN_MUST_HAVE_FU_MESSAGE);
  }

  return validationErrors;
}

/**
 * FU-yapısı bulguları — **BLOKLAMAZ** (yukarıdaki sınır notu).
 *
 * T-052: `SpendCalculationService` İKİ kaynağı da okur (`planMechanicValues`
 * VE `plan_fus.tactics`, `buildMechanicValues` ile birleştirilir). Kontrol
 * tutarlı kalmak için aynı iki kaynağa bakar: ikisi de boşsa SpendCalc o FU
 * için **sıfır harcama** döner — yani plan onaya boş gidiyor ve kimse
 * söylemiyordu. Uyarı tam bunu görünür kılar.
 */
export function collectPlanStructureWarnings(plan: {
  planFus?: Array<{
    fuId?: string;
    fu?: { code?: string } | null;
    tactics?: Record<string, unknown> | null;
    planMechanicValues?: PlanMechanicValueLike[] | null;
  }> | null;
}): string[] {
  const warnings: string[] = [];
  for (const planFu of plan.planFus ?? []) {
    const hasMechanicValues =
      !!planFu.planMechanicValues &&
      planFu.planMechanicValues.some((pmv) => hasEnteredValue(pmv));
    const hasTactics =
      !!planFu.tactics && Object.keys(planFu.tactics).length > 0;

    if (!hasMechanicValues && !hasTactics) {
      warnings.push(
        `FU ${planFu.fu?.code || planFu.fuId} has no mechanic values or tactics defined`,
      );
    }
  }
  return warnings;
}

/**
 * `Q20` (ürün sahibi, 2026-08-31) — **PLAN DÜZEYİ** *"boş plan"* uyarısı.
 * **BLOKLAMAZ** (`Q16` ailesiyle aynı sınıf: bloklayan olan yalnız FU
 * yokluğu ve yetersiz bütçe — bkz. dosya başı sınır notu).
 *
 * `collectPlanStructureWarnings`'in KARDEŞİ ama AYNI OLGU DEĞİL:
 * ```
 * collectPlanStructureWarnings   FU düzeyi   "mekanik/taktik yok"
 * collectPlanSpendRowWarnings    SKU-satırı  "hiçbir satıra hacim girilmedi"
 * ```
 * Bir FU'nun taktiği/mekaniği olabilir ama SKU satırlarının hiçbirine
 * hacim girilmemiş olabilir (ya da tersi) — ikisi bağımsız gözlemdir,
 * birleştirilmez.
 *
 * ⛔ Sayının TEK türetimi `countPlannedSkus` (`sku-spend-inputs.ts`) —
 * ikinci bir "dolu satır" tanımı burada YAZILMAZ (`§7`/`F8` ailesi).
 */
export function collectPlanSpendRowWarnings(
  spendInputResolutions: readonly SpendInputResolution[],
): string[] {
  if (countPlannedSkus(spendInputResolutions) > 0) return [];

  // `R1` (Team Lead, 2026-08-31) — ⛔ ERKEN DÖNÜŞ SİLİNDİ. Eski kod
  // `spendInputResolutions.length === 0` iken uyarı ÜRETMİYORDU. Bu bir
  // "resolutions henüz hesaplanmadı" durumu DEĞİL — `addFu`
  // `skuRepo.findBy({ fuId, tenantId, isActive: true })` ile SKU'ları
  // otomatik ekler; bir FU'nun AKTİF SKU'su YOKSA `planSkus = []` ⇒
  // `resolutions = []` ⇒ bu da *"dolu-satır-sayısı 0"*'ın bir hâlidir
  // (`Q20`'nin hükmü satır SAYISINA değil DOLULUĞUNA bakar — sıfır satır,
  // sıfır dolu satırdır). `skus.is_active` MUTABLE bir bayrak olduğu için
  // bu yol bugün seed'de tanıksız olsa da (ölçüldü: aktif-SKU'suz FU
  // sayısı `0`) YARIN açılabilir — `DISIPLIN`: "veriye dayalı erteleme,
  // verinin değiştiği gün yeniden ölçülür". Kapı bugün kapatılır.
  //
  // ⛔ AMA İKİ OLGU AYNI CÜMLE DEĞİL (`Z70`): `resolutions.length === 0`
  // *"planda hiç SKU satırı yok"* der (FU var, satır YOK — `addFu` FU'nun
  // aktif SKU'su bulamadı); `> 0` ise *"satır var, hiçbirine hacim
  // girilmedi"* der (satırlar var, hepsi `UNTOUCHED`). Kullanıcının
  // düzeltme eylemi FARKLI: birincisinde master-data'ya SKU eklemesi
  // gerekir, ikincisinde grid'i doldurması. FU'suz plan zaten
  // `PLAN_MUST_HAVE_FU_MESSAGE` ile bloklanır (bu fonksiyonun çağrıldığı
  // an itibarıyla en az bir FU vardır) — yani `length === 0` burada
  // "FU var, hiç SKU satırı yok" anlamına gelir, yanlış alarm değildir.
  if (spendInputResolutions.length === 0) {
    return [
      "Plan boş: planda hiç SKU satırı yok (FU'ların aktif SKU'su " +
        'bulunamadı). Plan gönderilebilir, ancak hiçbir satır bütçe ' +
        'rezervasyonuna katkı vermeyecek.',
    ];
  }
  return [
    'Plan boş: hiçbir SKU satırına hacim girilmedi (BASE_VOL/PLAN_VOL). ' +
      'Plan gönderilebilir, ancak hiçbir satır bütçe rezervasyonuna ' +
      'katkı vermeyecek.',
  ];
}

/**
 * Bloklamayan karar-desteği uyarıları — `Z70 §1` + `Z71 §1`.
 *
 * Kadran öncesi burada TEK uyarı vardı çünkü TEK kötü-durum vardı: `RED`.
 * Kadran (`Z66 §2`) iki farklı kötü-durum doğurdu ve **büyüklük eksenini**
 * `RED`'in içinden çıkardı; ölçülmüş geçiş matrisi (`Z71 §1a`, eşikler
 * `green=20 · amber=10`):
 *
 * ```
 *   iTO > 0 dilimi     ÖNCE     SONRA    bu blok olmasaydı
 *   iGP ≤ 0            RED   →  AMBER    uyarı KAYBOLURDU
 *   0 < ROI < 10       RED   →  GREEN    uyarı KAYBOLURDU
 *   10 ≤ ROI < 20      AMBER →  GREEN    (zaten uyarı yoktu, ama artık var)
 * ```
 *
 * ⛔ İkinci ve üçüncü satır en tehlikelisiydi: uyarının yerine SESSİZLİK
 * değil, **karşı yönde güvence** geçiyordu — ekranda "İYİ".
 *
 * @param targetRoiThreshold `kpis.target_roi_threshold` — `decimal`,
 *   **transformer YOK** ⇒ `pg`'den DİZGE gelir. Normalizasyon
 *   `evaluateTargetRoi` içinde, burada DEĞİL (`F8` ailesi).
 */
/**
 * `BASELINE_MISSING` uyarısının `N` sayısı — **KAÇ `plan_sku`'nun
 * `base_volume`'u `NULL`** (`BL-4b` turu, ürün sahibi hükmü 2026-09-03:
 * *"uyarı SKU-LİSTESİNDEN beslenir"*).
 *
 * ⛔ **`N` `plans`'a YAZILMAZ, HER ÇAĞRIDA TÜRETİLİR** (ürün sahibi `(a)`
 * şıkkını reddetti: bir toplayıcı kolon `INV-B-009` kopya-kolon sınıfı
 * olurdu). Kaynak `plan.planFus[].planSkus[].baseVolume` — `plan.service.ts`
 * bu ilişkiyi `findById` ile **zaten yüklüyor** (`plan.repository.ts`), yani
 * bu fonksiyon ek bir sorgu AÇMAZ; parametre olarak akan veriden sayar.
 *
 * ⚠️ **`sku-spend-inputs.ts#SpendInputResolution.baseEvaluable` KULLANILMADI
 * — bilerek.** O alan `baseVolume !== null && listPrice !== null` — İKİ
 * ayrı eksikliği (`BASE_VOL` VE `BPTT`) tek booleana ezer. `N` yalnız
 * `BASE_VOL`'u sayar; `baseEvaluable`'ı kullanmak `BPTT` eksik ama
 * `BASE_VOL` dolu SKU'ları da `N`'e katardı — `attributeBaselineMissing`'in
 * kendisinin ayırdığı sınırın (`BASE_VOL`'DAN BAĞIMSIZ bir eksiklik
 * `BASELINE_MISSING` üretmez, `kpi-engine.service.ts` PİN D) metin
 * tarafındaki bir ihlali olurdu.
 *
 * `Q20`'nin `UNTOUCHED` satırları da sayılır — `baseVolume === null`
 * `UNTOUCHED`'ta da doğrudur (satıra hiç dokunulmamış) ve kullanıcının
 * göreceği gerçek durum tam olarak budur: bu SKU için baseline yok.
 */
function countBaselineMissingSkus(plan: {
  planFus?: ReadonlyArray<{
    planSkus?: ReadonlyArray<{ baseVolume?: number | null }> | null;
  } | null> | null;
}): number {
  let count = 0;
  for (const planFu of plan.planFus ?? []) {
    for (const planSku of planFu?.planSkus ?? []) {
      if (planSku.baseVolume === null || planSku.baseVolume === undefined) {
        count += 1;
      }
    }
  }
  return count;
}

export function collectPlanSubmissionWarnings(
  plan: {
    ragStatus?: string | null;
    ragExclusionReason?: string | null;
    overallRoi?: number | string | null;
    planFus?: ReadonlyArray<{
      planSkus?: ReadonlyArray<{ baseVolume?: number | null }> | null;
    } | null> | null;
  },
  targetRoiThreshold: number | string | null | undefined,
): string[] {
  const warnings: string[] = [];

  if (plan.ragStatus === 'RED') {
    warnings.push(
      'Ciro kaybı: plan incremental ciro üretmiyor (RAG kırmızı). ' +
        'Göndermeden önce gözden geçirin.',
    );
  } else if (plan.ragStatus === 'AMBER') {
    warnings.push(
      'Kârsız büyüme: satış artıyor ama incremental kâr negatif ' +
        '(RAG sarı). Göndermeden önce gözden geçirin.',
    );
  } else if (plan.ragStatus === null || plan.ragStatus === undefined) {
    // `S1` / `Z68 §2` — renk yokluğu bir yargı DEĞİL, ve iki sebebi var.
    // ⛔ Meşru yokluk (`LTA_ONLY`) bir kusur gibi raporlanmaz; ama
    // "değerlendirilemedi" de sessiz geçilmez — ikisi AYRI cümle.
    const exclusion = parseRagExclusionReason(plan.ragExclusionReason);
    if (exclusion === RagExclusionReason.LTA_ONLY) {
      warnings.push(
        'Değerlendirme dışı — LTA: bu planda incremental promosyon ' +
          'harcaması yok, RAG bir promosyon değerlendirmesidir ve ' +
          'LTA-only planlar için tanımlı değildir.',
      );
    } else if (exclusion === RagExclusionReason.BASELINE_MISSING) {
      // `BL-4b` (`Z90 §2` · `Z91 §3`) — TANIMLI-YOKLUK, `LTA_ONLY` ile AYNI
      // ailenin ikinci üyesi: sebep GÖRÜNÜR, jenerik "kapsama tam değil"
      // cümlesine düşmez (brief `§4`/PİN 4).
      //
      // ⛔ `N` (kaç SKU) burada FABRİKE EDİLMEZ. `plan.planFus` bu
      // fonksiyona verilmemişse (ör. testler ya da eski bir çağıran yalnız
      // `{ ragStatus, ragExclusionReason }` geçiyorsa) sayı **bilinmez** —
      // ve bilinmeyen bir şeyi `0` yazmak `§2.5`'in yasakladığı sessiz
      // sıfırın ta kendisi olurdu. `n > 0` iken sayı görünür; değilse cümle
      // jenerik kalır (eski davranış, geriye dönük uyumlu).
      const n = countBaselineMissingSkus(plan);
      warnings.push(
        n > 0
          ? `RAG hesaplanamadı — baseline eksik: ${n} SKU için taban ` +
              'hacim (baseline) girilmemiş. Incremental hacim/ciro/kâr/ROI ' +
              'bu SKU(lar) için hesaplanamıyor; baseline girildiğinde plan ' +
              'yeniden hesaplanacaktır.'
          : 'RAG hesaplanamadı — baseline eksik: bir veya daha fazla SKU için ' +
              'taban hacim (baseline) girilmemiş. Incremental hacim/ciro/kâr/ROI ' +
              'bu SKU(lar) için hesaplanamıyor; baseline girildiğinde plan ' +
              'yeniden hesaplanacaktır.',
      );
    } else {
      warnings.push(
        'RAG hesaplanamadı: plan KPI kapsaması tam değil. Renk bir ' +
          'yargı taşımıyor — eksik veriyi tamamlayın.',
      );
    }
  }

  // `Z71 §1` — TARGET-ROI, AYRI EKSEN. `GREEN` bir planın hedefin altında
  // olması bir çelişki değil: kadran YÖN'ü, bu eksen BÜYÜKLÜĞÜ konuşur.
  // ⛔ Eşik konfigüre değilse uyarı ÜRETİLMEZ (`evaluateTargetRoi` →
  // `NOT_EVALUABLE`): uydurulmuş bir hedefe göre yargı vermeyiz (`§2.5`).
  const targetRoiEval = evaluateTargetRoi(
    plan.overallRoi ?? null,
    targetRoiThreshold ?? null,
  );
  if (
    targetRoiEval.kind === 'BELOW_TARGET' &&
    isBelowTargetRoi(plan.ragStatus, targetRoiEval)
  ) {
    warnings.push(
      belowTargetRoiMessage(targetRoiEval.roi, targetRoiEval.threshold),
    );
  }

  return warnings;
}

/**
 * `ADR 0005 K3` — BAYAT/BOZUK SPEND KOLONLARININ **TEK** KARAR NOKTASI.
 *
 * Submit anında yeniden hesaplama YOKTUR (`0009 §4.2` karar B): rezerve
 * edilen tutar, recalc'in `plans.on_invoice_spend`/`off_invoice_spend`
 * kolonlarına yazdığı değerdir — kullanıcının ekranda gördüğü sayı.
 * Kolonlar yalnız recalc koştuğunda yazılır, yani hiç recalc edilmemiş bir
 * plan `0/0` taşır.
 *
 * ⛔ **`T-344` bu fonksiyonu ÇIKARDI, çünkü kararın İKİ çağıranı oldu:**
 * `submit()` artık kilitten ÖNCE bütçe yeterliliğini sorguluyor (ölen
 * rotadan taşınan `validationErrors` sözleşmesi) ve kilidin ALTINDA
 * rezervasyonu yazıyor. Aynı kararı iki yerde yazmak `§7`'nin kapattığı
 * sınıftır — ve burada özellikle tehlikeli olurdu: ön-kontrol `null`'ı
 * sessizce `0` sayarken kilit altındaki kapı `STALE` deseydi, kullanıcı
 * "bütçe yeterli" görüp `400` alırdı.
 */
export type PlanSpendBreakdown =
  | { kind: 'NO_SPEND' }
  | { kind: 'USABLE'; onInvoice: number; offInvoice: number }
  | { kind: 'TOTAL_UNREADABLE' }
  | { kind: 'STALE'; totalSpend: number }
  | {
      kind: 'INCONSISTENT';
      totalSpend: number;
      onInvoice: number;
      offInvoice: number;
    };

// ⛔ Kendi sayı okuyucusunu YAZMA. `toFiniteDecimal` bu kod tabanında
// `decimal` kolonlarının TEK dürüst okuyucusudur (`target-roi.ts`) —
// okunamayan girdi `0` değil `null` döner. İkinci bir kopya `F8` ailesidir.

export function resolvePlanSpendBreakdown(
  totalSpend: number | string | null | undefined,
  onInvoiceSpend: number | string | null | undefined,
  offInvoiceSpend: number | string | null | undefined,
): PlanSpendBreakdown {
  const total = toFiniteDecimal(totalSpend);
  // ⚠️ `Number(x) > 0` eskiden `NaN > 0 === false` üzerinden okunamayan bir
  // toplamı SESSİZCE "harcama yok" sayıyordu (`§2.5`). Artık ayrı bir dal.
  if (total === null) return { kind: 'TOTAL_UNREADABLE' };
  if (total <= 0) return { kind: 'NO_SPEND' };

  // `null` burada `0`'a düşer ve bu bir sessiz varsayılan DEĞİLDİR: tam
  // olarak bu durum aşağıdaki `STALE` dalını tetikler, yani gürültülü
  // reddedilir.
  const on = toFiniteDecimal(onInvoiceSpend) ?? 0;
  const off = toFiniteDecimal(offInvoiceSpend) ?? 0;

  if (on === 0 && off === 0) return { kind: 'STALE', totalSpend: total };

  // Özdeşlik kapısı: `on + off === totalSpend` recalc'in inşaat gereği
  // garanti ettiği bir değişmezdir (0009 §4.2/§2.5, tek türetim noktası —
  // `buildMechanicValues`). Tutmuyorsa kolonlar bayat/bozuk demektir.
  if (Math.abs(on + off - total) > 0.01) {
    return {
      kind: 'INCONSISTENT',
      totalSpend: total,
      onInvoice: on,
      offInvoice: off,
    };
  }

  return { kind: 'USABLE', onInvoice: on, offInvoice: off };
}

/** Reddedilen üç dalın kullanıcıya dönen gövdesi — tek metin kaynağı. */
export function planSpendBreakdownError(
  planId: string,
  resolution: PlanSpendBreakdown,
): { statusCode: 400; code: string; message: string } | null {
  switch (resolution.kind) {
    case 'TOTAL_UNREADABLE':
      return {
        statusCode: 400,
        code: 'PLAN_TOTAL_SPEND_UNREADABLE',
        message:
          `Plan ${planId} has an unreadable totalSpend. Recalculate the ` +
          `plan (POST /plans/${planId}/recalculate) before submitting.`,
      };
    case 'STALE':
      return {
        statusCode: 400,
        code: 'PLAN_SPEND_BREAKDOWN_STALE',
        message:
          `Plan ${planId} has totalSpend=${resolution.totalSpend} but no on/off-invoice ` +
          `spend breakdown recorded (0/0). Recalculate the plan (POST ` +
          `/plans/${planId}/recalculate) before submitting.`,
      };
    case 'INCONSISTENT':
      return {
        statusCode: 400,
        code: 'PLAN_SPEND_BREAKDOWN_INCONSISTENT',
        message:
          `Plan ${planId} on/off-invoice breakdown (${resolution.onInvoice} + ` +
          `${resolution.offInvoice} = ${resolution.onInvoice + resolution.offInvoice}) does not match ` +
          `totalSpend (${resolution.totalSpend}). Recalculate the plan (POST ` +
          `/plans/${planId}/recalculate) before submitting.`,
      };
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// `T-337` / `Z77 §1` — GİRDİ-EKSİKLİĞİ: SUBMIT DURMAZ, REZERVASYON REDDEDER
// ─────────────────────────────────────────────────────────────────────────
//
// ```
// SUBMIT       DURMAZ  — NOT_EVALUABLE + GÖRÜNÜR UYARI, ALAN ADIYLA
// REZERVASYON  REDDEDER — RESERVATION_INPUT_INCOMPLETE
// ```
// > **`NOT_EVALUABLE` BİR ZARFA `0` YAZMAZ — YAZMAYI REDDEDER.**
//
// ⛔ **İKİ RED SINIFI AYRI ADLANIR** (`Z77 §1a`). Bu, `T-321`'in
// `%100`-BLOCKED **eşik** reddi (`BUDGET_BLOCK_THRESHOLD_EXCEEDED`,
// `409 Conflict`, *"zarf doldu"*) **DEĞİLDİR**; bu **girdi** reddidir
// (`400 Bad Request`, *"tutar hesaplanamıyor"*). İkisi aynı yüzeyden
// dönerse ilk okuyucu karıştırır — kod, HTTP durumu ve mesaj ayrı.
//
// ⚠️ NEDEN `warnings`, `validationErrors` DEĞİL: `ADR 0005 K2`'nin ikinci
// gerekçesi (*"kullanıcının bugün submit edebildiği plan yarın da
// edebilmeli"*) doğrulama katmanında **korunur**. Reddi para katmanı
// verir, ve orası zaten bugün de reddeden bir katmandır
// (`PLAN_SPEND_BREAKDOWN_STALE` emsali).
//
// ⛔ ALAN ADLARI KPI SÖZLÜĞÜNÜN KODLARIDIR (`BASE_VOL`/`PLAN_VOL`/`BPTT`/
// `COGS`, `kpi-engine.service.ts#SkuCalculationContext`) — yeni bir dil
// icat edilmedi.

/** Alan başına *"kaç SKU'da eksik"*. Üreteci `summarizeNotEvaluableSkus`. */
export type NotEvaluableSpendInputCounts = Readonly<Record<string, number>>;

/** ⛔ Alan adı → kullanıcıya görünen ad. TEK metin kaynağı. */
const SPEND_INPUT_LABELS: Readonly<Record<string, string>> = {
  PLAN_VOL: 'PLAN_VOL (planlanan hacim)',
  BPTT: 'BPTT (SKU birim fiyatı)',
};

function describeMissingSpendInputs(
  counts: NotEvaluableSpendInputCounts,
): string[] {
  // ⛔ `Object.keys` sırası girdiye bağlıdır ⇒ mesaj deterministik olsun
  // diye SIRALANIR (pin edilebilirlik, `T-332`).
  return Object.keys(counts)
    .sort()
    .map(
      (field) =>
        `${SPEND_INPUT_LABELS[field] ?? field} eksik: ` +
        `${counts[field]} SKU'da spend hesaplanamadı`,
    );
}

/**
 * BLOKLAMAYAN uyarı (`Z77 §1` üst satır). Boş sayaç ⇒ boş dizi.
 */
export function collectSpendInputWarnings(
  counts: NotEvaluableSpendInputCounts,
): string[] {
  const described = describeMissingSpendInputs(counts);
  if (described.length === 0) return [];
  return described.map(
    (line) =>
      `${line}. Plan gönderilebilir, ancak bütçe rezervasyonu bu eksiklik ` +
      `giderilmeden yapılamaz.`,
  );
}

/**
 * ⛔ REZERVASYONU REDDEDEN kapı (`Z77 §1` alt satır). `null` = engel yok.
 *
 * Çağıran `BadRequestException` ile fırlatır — `planSpendBreakdownError`
 * ile aynı şekil, bilerek: iki para kapısı aynı sözleşmeyi konuşur.
 */
export function reservationInputIncompleteError(
  planId: string,
  counts: NotEvaluableSpendInputCounts,
): { statusCode: 400; code: string; message: string } | null {
  const described = describeMissingSpendInputs(counts);
  if (described.length === 0) return null;
  return {
    statusCode: 400,
    code: 'RESERVATION_INPUT_INCOMPLETE',
    message:
      `Plan ${planId}: bütçe rezervasyonu yapılamaz — harcama tutarı ` +
      `hesaplanamıyor. ${described.join('; ')}. Eksik alanları ` +
      // ⛔ "doldurup" DEĞİL: pin `/doldu/` ile eşleşiyor ve kullanıcıyı
      // *"zarf doldu"* (T-321 eşik reddi) sanısına götürebilir. İki red
      // sınıfı METİN ekseninde de ayrışmalı (`Z77 §1a`).
      `tamamlayıp planı yeniden hesaplayın (POST /plans/${planId}/recalculate).`,
  };
}
