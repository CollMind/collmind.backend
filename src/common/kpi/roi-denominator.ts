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
 * ── ⛔ AÇIK KARAR — DEĞER BU TURDA DEĞİŞTİRİLMEDİ ────────────────────────
 *
 * Bugün yürürlükteki payda `TOTAL_PLANNED_SPEND`'dir ve **LTA harcamasını
 * İÇERİR** — ölçüldü (`spend-calculation.service.ts`, `SEVIYE 4`):
 *
 * ```
 * totalPlannedSpend = (plannedLtaOnInv + totalPromoOnInv)
 *                   + (plannedLtaOffInv + totalPromoOffInv)
 * ```
 *
 * `Z62 §6-3` hükmü ise **"yalnız promo-spend (LTA hariç)"** diyor. İkisi
 * **çelişiyor**, ve üçüncü bir kayıt daha var: **`ADR 0011`** paydayı
 * `INCR_SPEND` → `TOTAL_PLANNED_SPEND` olarak **bilinçle** değiştirmiştir
 * (`migration 1801000000000`).
 *
 * ⇒ **`CLAUDE.md §2.4` (belirsizlikte DUR):** üç kayıt arasındaki seçim bir
 * **ürün sahibi kararıdır, ajanın varsayımı değil** — ve `TOTAL_PLANNED_SPEND`
 * aynı zamanda `plan.totalSpend`/bütçe rezervasyonunu besliyor, yani değeri
 * değiştirmek ROI'nin ötesinde **finansal bir yayılım** yaratır. Bu turda
 * **hiçbir sayı değiştirilmedi**; yalnız tanımın **tek yeri** kuruldu.
 *
 * Karar verildiğinde değişecek yer: **yalnız bu dosya**.
 */

/** Bugün yürürlükteki ROI paydası (KPI kodu). ⚠️ LTA harcamasını İÇERİR. */
export const ROI_DENOMINATOR_KPI_CODE = 'TOTAL_PLANNED_SPEND' as const;

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
  `Incremental GP ROI %: ${ROI_NUMERATOR_KPI_CODE} / ${ROI_DENOMINATOR_KPI_CODE} * 100 (BRD canonical — ADR 0011)` as const;

/** `GP_ROI_PCT`'nin bağımlılık listesi — aynı tek noktadan. */
export const GP_ROI_PCT_DEPENDS_ON: readonly string[] = [
  ROI_NUMERATOR_KPI_CODE,
  ROI_DENOMINATOR_KPI_CODE,
];
