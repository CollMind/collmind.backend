import { SKUContext } from './dto/calculation-context.dto';
import { toFiniteDecimal } from '../../../common/kpi/target-roi';

/**
 * `SKUContext`'İN **TEK ÜRETECİ** — `T-337` / `Z77 §2`.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────
 * `T-027` (2026-07-27) eksik girdiyi KPI motoruna `null` olarak taşıdı ve
 * `ROI`/`GP`/`RAG`'ı sahte `%100`/`GREEN`'den kurtardı. Ama **SPEND** tarafı
 * o gün *"ekran toplamı"* sayıldığı için `?? 0` bırakıldı
 * (`plan.service.ts:2520-2527`'nin o dönemki yorumu). `T-056`/`T-057`/
 * `T-048` sonrasında o *"ekran toplamı"* **bütçe rezervasyonunun girdisi**
 * oldu:
 * ```
 * planVol ?? 0  →  plannedGsv = 0  →  her %-mekanik 0  →  plan.total_spend DÜŞÜK
 *               →  reserveTypedForPlan DÜŞÜK  →  %80/%95/%100 eşiği GEÇ ateşler
 * ```
 * ⇒ Sessiz-düşük rezervasyon **bütçe korumasının TERSİNE** çalışıyordu.
 * Ölçüm: `docs/research/K1_SESSIZ_SIFIR_OLCUM_TABLOSU.md` `§1b` / `§2b`.
 *
 * ── AYRIMI **ALAN** BELİRLER, ÇAĞIRAN DEĞİL (`Z77 §2`) ──────────────────
 * ```
 * girilen mekanik değeri  yok  ⇒ 0               ADR 0008 (null ≡ 0, ölçüldü)
 * ltaContext              yok  ⇒ 0               LTA yok ⇒ harcama GERÇEKTEN 0
 *                                                (`lta_rates` yüzdeleri NOT NULL)
 * PLAN_VOL / BPTT         yok  ⇒ NOT_EVALUABLE   plannedGsv TANIMSIZ
 * BASE_VOL                yok  ⇒ yalnız TABAN/incremental null
 * COGS                    yok  ⇒ spend için İLGİSİZ (KPI tarafı taşır)
 * ```
 * İlk ikisi `spend-calculation.service.ts` içinde, kendi yerlerinde
 * **çözülmüş değer** olarak duruyor (`K1 §1a`: `:202` · `:223`). Son üçü
 * burada, **alan başına sabit** — bir çağıranın seçebileceği bir şey değil.
 * Bu, `F8` ailesinin (*"aynı sayı dört yerde dört farklı"*) panzehiridir.
 *
 * ── NEDEN TİP ZORLUYOR ──────────────────────────────────────────────────
 * `SKUContext` bir **markalı** tiptir (`SKU_CONTEXT_BRAND`, `declare const`
 * ve **export edilmemiş**) ⇒ başka hiçbir dosya o özelliği adlandıramaz ⇒
 * nesne literaliyle inşa **derlenmez**. Tek `as SKUContext` dönüşümü
 * aşağıdadır ve bilerek tek noktadadır.
 * > **"Bir çağıran unutuldu ⇒ DERLEME HATASI olur, BÜTÇE SAPMASI değil."**
 *
 * `K1 §4d` bu kapının kovaladığı vakayı yazıyor: `plan.service` dönüşür,
 * `calculateAllSpendsForFU` dönüşmezse **aynı plan iki farklı toplam**
 * üretir (`T-049` postmortem'inin birebir tekrarı) — ve bu kez ayrışan şey
 * ekran değil **bütçe rezervasyonu** olurdu.
 *
 * ⛔ **VE MARKA BU AYRIŞMAYI YAKALAMIYOR — ÖLÇÜLDÜ (`Z78 §7`, review 🟡-1).**
 * Marka her iki çağıranı resolver'a **zorlar**, ama üç `kind`'ı **aynı** ele
 * almaya zorlamaz. Bugünkü ayrışma:
 * ```
 * plan.service (recalc)      kind !== 'UNTOUCHED' && ctx !== null ⇒ ÇAĞIRIR
 *                            ⇒ PLAN_VOL yok + BPTT var ⇒ TABAN ZİNCİRİ KOŞAR
 * calculateAllSpendsForFU    kind === 'NOT_EVALUABLE' ⇒ continue
 *                            ⇒ AYNI satırı TAMAMEN ATAR ⇒ FU tabanı AYRIŞIR
 * ```
 * ⇒ Aşağıdaki *"`PLAN_VOL` yok, `BPTT` var ⇒ ctx VAR — taban zinciri koşmaya
 * devam eder"* sözleşmesini `calculateAllSpendsForFU` **İHLAL EDİYOR.**
 *
 * **Neden bugün düzeltilmedi, ve bu bir erteleme DEĞİL bir RANDEVU:**
 * `calculateAllSpendsForFU`'nun **üretim çağıranı SIFIR** (ölçüldü: yalnız
 * `*.spec.ts`) ⇒ canlı para etkisi yok. Metot `Z77 §3c`'nin **dokuzuncu
 * adayı**: *"ya tüketici kazanır ya ölür, karar `W3` tasarımıyla."*
 * ⛔ **O KARAR VERİLDİĞİ GÜN BU AYRIŞMA DA KAPANIR** — metot yaşarsa
 * recalc'in şekline getirilir, ölürse soru düşer. Sözleşme **o güne kadar
 * yazılı bir sapmadır**, sessiz bir ihlal değil.
 * > `DISIPLIN`: *"bir yorum, kodunun tersini söylüyorsa yorum yanlıştır —*
 * > *ama sapmayı YAZMAK, onu doğru kılmaz; GÖRÜNÜR kılar."*
 *
 * ── NEDEN `Number()` YOK ────────────────────────────────────────────────
 * Bu dizin `money-float` **Alan A** listesinde
 * (`scripts/guards/money-float-domain-a.txt`) ⇒ yeni kod `born exact`
 * doğar (ADR 0007 Karar 8.2). `decimal` kolonlarının tek dürüst okuyucusu
 * `toFiniteDecimal` (`common/kpi/target-roi.ts`) — okunamayan girdi `0`
 * değil `null` döner. İkinci bir kopya yazmak `F8` ailesidir.
 */

/**
 * `NOT_EVALUABLE`'ı üretebilen alanlar. ⛔ Kullanıcıya **bu adlarla**
 * gösterilir (`Z77 §1`: *"görünür uyarı, ALAN ADIYLA"*) — adlar BRD/KPI
 * sözlüğünün kodlarıdır (`BASE_VOL`/`PLAN_VOL`/`BPTT`/`COGS`,
 * `kpi-engine.service.ts#SkuCalculationContext`), yeni bir dil değil.
 */
export type SpendInputField = 'PLAN_VOL' | 'BPTT';

/** ⛔ SIRA SABİT — mesaj metni deterministik olmalı (pin edilebilirlik). */
export const SPEND_INPUT_FIELDS: readonly SpendInputField[] = [
  'PLAN_VOL',
  'BPTT',
];

export type SpendInputResolution =
  | {
      kind: 'EVALUABLE';
      skuId: string;
      ctx: SKUContext;
      /**
       * `BASE_VOL` ayrı düşer: planlanan harcama hesaplanabilirken taban
       * hesaplanamayabilir. `false` ⇒ `SpendBreakdown.base = null` ve
       * `incremental.{onInvoice,offInvoice,total}` `null`
       * (`promoTotal` **etkilenmez** — tabana bağlı değil, `ADR 0011 Q6`).
       */
      baseEvaluable: boolean;
    }
  | {
      kind: 'NOT_EVALUABLE';
      skuId: string;
      /** Boş OLAMAZ — bu dala yalnız en az bir alan eksikken girilir. */
      missing: readonly SpendInputField[];
      /**
       * ⛔ `NOT_EVALUABLE` **"hiçbir şey hesaplanamaz" DEMEK DEĞİLDİR** —
       * *"PLANLANAN harcama hesaplanamaz"* demektir, ve para yolunu
       * ilgilendiren tam olarak odur.
       * ```
       * PLAN_VOL yok, BPTT var   ⇒ ctx VAR   — taban zinciri koşmaya devam eder
       * BPTT yok                 ⇒ ctx null  — hiçbir kova hesaplanamaz
       * ```
       * ⚠️ İlk uygulamada bu alan yoktu ve `PLAN_VOL` yokluğu **taban
       * zincirini de** öldürüyordu; `lta-lifecycle-bond-and-base-chain`
       * e2e'si yakaladı (`BASE_LTA_ON` → `null`). `§7.1`: taban
       * alanlarının tüketicileri planlanan taraftan bağımsız SAYILMAMIŞTI.
       */
      ctx: SKUContext | null;
      baseEvaluable: boolean;
    }
  | {
      /**
       * `Q20` (ürün sahibi, 2026-08-31) — **ÜÇÜNCÜ SINIF**, `NOT_EVALUABLE`
       * DEĞİL. Bir satırın hiç DOKUNULMAMIŞ (doğum hâli: `baseVolume` VE
       * `plannedVolume` ikisi de `NULL`) olması bir *eksiklik* değil, bir
       * *"henüz planlanmadı"* olgusudur.
       *
       * ```
       * NOT_EVALUABLE  girilmiş-ama-eksik  → REZERVASYON REDDİ, alan adıyla (Z77 hâlâ yaşıyor)
       * UNTOUCHED      hiç girilmemiş      → spend-katkısı YOK, rezervasyonu BLOKLAMAZ
       * ```
       *
       * ⛔ `missing` YOK — bu bir eksiklik listesi değil (adlandırılacak
       * eksik bir alan yok). ⛔ `ctx` YOK, `Number()`/`?? 0` değil, **tip
       * seviyesinde yokluk**: bu satırdan hiçbir kova hesaplanamayacağı
       * için `ctx` alanının varlığı yanıltıcı olurdu — her tüketici bu
       * kolu AÇIKÇA ele almak zorunda kalsın diye (dosyanın kendi
       * felsefesi: *"bir çağıran unutuldu ⇒ DERLEME HATASI olur, BÜTÇE
       * SAPMASI değil"*).
       */
      kind: 'UNTOUCHED';
      skuId: string;
      baseEvaluable: false;
    };

export interface RawSkuSpendInputs {
  skuId: string;
  /** `plan_skus.base_volume` — **NULLABLE** (ölçüldü, `K1 §3`). */
  baseVolume: unknown;
  /** `plan_skus.planned_volume` — **NULLABLE**. */
  plannedVolume: unknown;
  /** `skus.unit_price` (BPTT) — **NULLABLE**. */
  listPrice: unknown;
  /** `skus.cogs` — **NULLABLE**; bugün `166/170` satırda `NULL`. */
  cogsPerUnit: unknown;
  channelCode?: string;
  categoryCode?: string;
  cplId?: string;
}

/**
 * Ham satır değerlerini ya bir `SKUContext`'e ya da adlandırılmış bir
 * eksiklik listesine çevirir. **Sessiz sıfır üretmez** (`CLAUDE.md §2.5`).
 */
export function resolveSkuSpendInputs(
  raw: RawSkuSpendInputs,
): SpendInputResolution {
  const baseVolume = toFiniteDecimal(raw.baseVolume);
  const plannedVolume = toFiniteDecimal(raw.plannedVolume);
  const listPrice = toFiniteDecimal(raw.listPrice);
  const cogsPerUnit = toFiniteDecimal(raw.cogsPerUnit);

  // ── `Q20` — DOKUNULMAMIŞ SATIR, `NOT_EVALUABLE`'DAN ÖNCE ÇÖZÜLÜR ────────
  // Evren `plan_skus`'un KENDİ alanlarıdır (`base_volume` + `planned_volume`
  // — `K1 §3` ölçümü); `listPrice`/`cogsPerUnit` SKU ana-verisidir, satırın
  // alanı DEĞİLDİR ve bu ayrımı etkilemez. `addSku` her satırı ikisi de
  // `NULL` olarak doğurur (`plan.repository.ts#addSku`) — bu, "girilmiş ama
  // eksik" değil "hiç girilmemiş" demektir.
  if (baseVolume === null && plannedVolume === null) {
    return { kind: 'UNTOUCHED', skuId: raw.skuId, baseEvaluable: false };
  }

  const missing: SpendInputField[] = [];
  // ⛔ SPEND_INPUT_FIELDS sırasıyla — mesaj deterministik.
  if (plannedVolume === null) missing.push('PLAN_VOL');
  if (listPrice === null) missing.push('BPTT');

  // ⛔ TEK `as SKUContext`. Marka alanı çalışma zamanında YOKTUR ve hiçbir
  // yerde okunmaz; yalnız derleyicinin literal inşayı reddetmesi için var.
  // `listPrice === null` ⇒ hiçbir kova hesaplanamaz ⇒ ctx de üretilmez.
  const ctx =
    listPrice === null
      ? null
      : ({
          skuId: raw.skuId,
          baseVolume,
          plannedVolume,
          listPrice,
          cogsPerUnit,
          channelCode: raw.channelCode,
          categoryCode: raw.categoryCode,
          cplId: raw.cplId,
        } as unknown as SKUContext);

  const baseEvaluable = baseVolume !== null && listPrice !== null;

  if (missing.length > 0 || ctx === null) {
    return {
      kind: 'NOT_EVALUABLE',
      skuId: raw.skuId,
      missing,
      ctx,
      baseEvaluable,
    };
  }

  return {
    kind: 'EVALUABLE',
    skuId: raw.skuId,
    ctx,
    baseEvaluable,
  };
}

/**
 * `NOT_EVALUABLE` sonuçlarını **alan başına SKU sayısına** indirir.
 *
 * Tek şekil, iki tüketici: submit'in görünür uyarısı ve rezervasyonun
 * reddi (`Z77 §1`). İkisi aynı sayıyı iki kez türetmez — `§7` ailesi.
 *
 * ⛔ `Q20` — `UNTOUCHED` bu sayıma **GİRMEZ** (bugün de girmiyordu, `kind
 * !== 'NOT_EVALUABLE'` zaten atlıyordu; davranış korunuyor ve
 * `sku-spend-inputs.spec.ts` bunu PİNLER). Dokunulmamış bir satır bir
 * eksiklik değildir — adlandırılacak bir alanı yoktur.
 */
export function summarizeNotEvaluableSkus(
  resolutions: readonly SpendInputResolution[],
): Partial<Record<SpendInputField, number>> {
  const byField: Partial<Record<SpendInputField, number>> = {};
  for (const resolution of resolutions) {
    if (resolution.kind !== 'NOT_EVALUABLE') continue;
    for (const field of resolution.missing) {
      byField[field] = (byField[field] ?? 0) + 1;
    }
  }
  return byField;
}

/**
 * `Q20` — **DOLU** (dokunulmuş) satır sayısı: `EVALUABLE` + `NOT_EVALUABLE`,
 * `UNTOUCHED` HARİÇ. Plan-düzeyi *"boş plan"* uyarısının (`collectPlan
 * SpendRowWarnings`, `submission-checks.ts`) **TEK** girdisi — ikinci bir
 * türetim yazma (`§7`/`F8` ailesi): bir plan `dolu-satır === 0` ise hiçbir
 * SKU'ya dokunulmamıştır ve bu bilgi zaten burada, bir kez hesaplanmış
 * hâlde duruyor.
 */
export function countPlannedSkus(
  resolutions: readonly SpendInputResolution[],
): number {
  let count = 0;
  for (const resolution of resolutions) {
    if (resolution.kind !== 'UNTOUCHED') count += 1;
  }
  return count;
}
