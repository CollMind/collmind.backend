/**
 * ROI PAYDASI — **TEK NOKTA** (`Z62 §6-3` / `W2 DALGA-B` `B4`).
 *
 * Ürün sahibi hükmü (2026-08-29, `docs/research/
 * DEMO_EXCEL_KPI_TACTIC_REFERANSI.md §6-3`):
 *
 * > *"ROI payda tanımı **motorda SABİTLENMEZ** — **tek noktadan okunan**,
 * > tenant-düzeyi konfigüre edilebilir bir politika kalemidir."*
 *
 * Bu dosya o *"tek nokta"*dır. `İlke 1` gereği **konfigürasyon yüzeyi bu
 * turda AÇILMAZ** (tetikleyici: ikinci tenant'ın farklı payda talebi);
 * açılacağı gün değişecek yer **tek** olsun diye kurulmuştur.
 *
 * ── ✅ KARAR İNDİ — `Z66 §1` (`Q6`), ürün sahibi 2026-08-30 ────────────
 *
 * Çelişki **iki ekseni tek kaleme sıkıştırmaktan** doğuyordu:
 * `(LTA dahil mi?)` × `(TOTAL mı INCREMENTAL mı?)`. Çözüm bir DEĞER
 * seçmek değil, **KALEMİ BÖLMEK** oldu:
 *
 * ```
 * BÜTÇE  TOTAL_PLANNED_SPEND   ← OLDUĞU GİBİ KALIR (LTA DAHİL)
 *                                zarf GERÇEK PARAYI rezerve eder ⇒ TOTAL doğru
 *                                `ADR 0011` geri alınmadı, KAPSAMI DARALDI (F12)
 * ROI    INCR_PROMO_SPEND      ← yalnız promo · LTA HARİÇ · incremental
 *                                (`Z62 §6-3`)
 * ```
 *
 * ⇒ **FİNANSAL YAYILIM SIFIR:** `plan.totalSpend` ve bütçe rezervasyonu
 * yoluna dokunulmadı; değişen tek şey ROI'nin **OKUMA ADRESİ**.
 *
 * 📌 Excel'in *"incremental-total-incl-LTA-delta"* tanımı `F12` farkı
 * olarak kayıtlıdır ve **tenant-konfigür ekseni** yazılıdır: konfigürasyon
 * yüzeyi açıldığı gün değişecek yer **yine yalnız bu dosyadır**
 * (`İlke 1`: tetikleyici = ikinci tenant'ın farklı payda talebi).
 *
 * ⚠️ `INCR_PROMO_SPEND` bir **`external`** KPI'dır: değeri
 * `SpendCalculationService` üretir (`incremental.promoTotal`) ve
 * `PlanService` context'e enjekte eder. Payda `0` olduğunda motor
 * `null` üretir (sıfıra bölme → `null`, `§2.3`) — **sessiz `0` yok.**
 */

/** Yürürlükteki ROI paydası (KPI kodu). ⚠️ LTA harcamasını İÇERMEZ (`Z66 §1`). */
export const ROI_DENOMINATOR_KPI_CODE = 'INCR_PROMO_SPEND' as const;

/** ROI payının (numerator) KPI kodu. */
export const ROI_NUMERATOR_KPI_CODE = 'INCR_GP' as const;

/**
 * `GP_ROI_PCT`'nin formül metni — **tek noktadan türetilir**, iki katalogda
 * (`src/database/seeds/kpi.seed.ts` ve
 * `src/modules/master-data/kpi/kpi.service.ts`) elle tekrarlanmaz.
 * ⚠️ İkisi `Z62 §6-3`'ten ÖNCE bu dizgeyi **ayrı ayrı** taşıyordu — `F8`
 * ailesi (*"aynı sayı dört yerde dört farklı"*) için hazır bir zemin.
 */
export const GP_ROI_PCT_FORMULA =
  `${ROI_NUMERATOR_KPI_CODE} / ${ROI_DENOMINATOR_KPI_CODE} * 100` as const;

/**
 * `GP_ROI_PCT`'nin AÇIKLAMA metni — **aynı tek noktadan türetilir**.
 *
 * ⛔ Neden bu da burada: ilk yazımda yalnız `formulaText` sabitten geliyordu,
 * `kpiDescription` aynı payda adını İKİ dosyada **elle** taşıyordu
 * (`kpi.seed.ts` · `kpi.service.ts`). Payda değiştiği gün `formula_text`
 * değişir, `kpi_description` **eski paydayı anlatmaya devam ederdi** —
 * `F8` ailesinin (*"aynı sayı dört yerde dört farklı"*) yeni bir vakası,
 * hem de onu kapatmak için açılan turda. Review yakaladı (`S6`).
 */
export const GP_ROI_PCT_DESCRIPTION =
  `Incremental GP ROI %: ${ROI_NUMERATOR_KPI_CODE} / ${ROI_DENOMINATOR_KPI_CODE} * 100 (Z66 §1 — payda BÖLÜNDÜ: bütçe TOTAL okur, ROI INCR-PROMO okur; ADR 0011 F12)` as const;

/** `GP_ROI_PCT`'nin bağımlılık listesi — aynı tek noktadan. */
export const GP_ROI_PCT_DEPENDS_ON: readonly string[] = [
  ROI_NUMERATOR_KPI_CODE,
  ROI_DENOMINATOR_KPI_CODE,
];
