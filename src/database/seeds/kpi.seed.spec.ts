import { KPI_DEFAULTS } from './kpi.seed';

/**
 * T-163 / ADR 0011 (+ `T-334` / `Z66 §1` — payda BÖLÜNDÜ) —
 * `GP_ROI_PCT.formulaText` seed sözleşmesi.
 *
 * Neden bu test var: `seedKpis()` idempotent bir upsert'tir ve `UPSERT_FIELDS`
 * (`formulaText`, `dependsOnKpis` dahil) her koşuda var olan satırın üzerine
 * YAZAR — bkz. `kpi.seed.ts`, `UPSERT_FIELDS`. Yani migration
 * `1801000000000-FixGpRoiPctDenominator` veritabanını düzeltse bile, bu dosya
 * eski paydaya (`INCR_SPEND`) geri dönerse bir sonraki `npm run seed` düzeltmeyi
 * SESSİZCE geri alır. Bu test o geri dönüşü kırmızıya çevirir.
 *
 * ⚠️ **GÜNCELLENDİ [[T-334]] (2026-08-30)** — `ADR 0011` GERİ ALINMADI,
 * **kapsamı daraldı** (`0011` `F12` notu · `Z66 §1`): `TOTAL_PLANNED_SPEND`
 * **bütçenin** kalemi olarak kaldı; ROI **`INCR_PROMO_SPEND`** okuyor
 * (*yalnız promo · LTA hariç · incremental*). Bu testin AYIRT ETME GÜCÜ
 * korunuyor: hem eski-eski payda (`INCR_SPEND`, migration `1780`) hem
 * bütçe kalemi (`TOTAL_PLANNED_SPEND`) AÇIKÇA reddediliyor.
 *
 * Karar: `docs/decisions/0011-gp-roi-paydasi-total-planned-spend.md` (+`F12`).
 * Migration: `1801000000000-FixGpRoiPctDenominator` → `1818000000000-FormulaCanonTurnoverNivSplit`.
 */
describe('kpi.seed — GP_ROI_PCT sözleşmesi (ADR 0011 + Z66 §1)', () => {
  const gpRoiPct = KPI_DEFAULTS.find((k) => k.kpiCode === 'GP_ROI_PCT');

  it('GP_ROI_PCT seed satırı bulunur', () => {
    expect(gpRoiPct).toBeDefined();
  });

  it("formulaText paydası INCR_PROMO_SPEND'tir — ne INCR_SPEND ne TOTAL_PLANNED_SPEND", () => {
    expect(gpRoiPct?.formulaText).toBe('INCR_GP / INCR_PROMO_SPEND * 100');
    // Negatif taraf — ÜÇ payda adayının İKİSİNİ de açıkça reddet:
    //   `INCR_SPEND`          migration 1780 (LTA dahil, incremental)
    //   `TOTAL_PLANNED_SPEND` ADR 0011 / BÜTÇENİN kalemi (LTA dahil, total)
    // ⚠️ `INCR_PROMO_SPEND` dizgesi `INCR_SPEND` İÇERMEZ (alt-dizge tuzağı
    // yok: `INCR_PROMO_SPEND`.includes('INCR_SPEND') === false).
    expect(gpRoiPct?.formulaText).not.toContain('INCR_SPEND');
    expect(gpRoiPct?.formulaText).not.toContain('TOTAL_PLANNED_SPEND');
  });

  it('dependsOnKpis INCR_PROMO_SPEND içerir, diğer iki paydayı içermez', () => {
    expect(gpRoiPct?.dependsOnKpis).toEqual(['INCR_GP', 'INCR_PROMO_SPEND']);
    expect(gpRoiPct?.dependsOnKpis).not.toContain('INCR_SPEND');
    expect(gpRoiPct?.dependsOnKpis).not.toContain('TOTAL_PLANNED_SPEND');
  });

  it('⛔ BÜTÇE KALEMİ DOKUNULMADI — TOTAL_PLANNED_SPEND seed satırı yerinde', () => {
    // `Z66 §1`: "finansal yayılım SIFIR". Payda bölünmesi bütçenin okuduğu
    // kalemi ORTADAN KALDIRMAZ; onu yalnız ROI'nin adresinden çıkarır.
    const total = KPI_DEFAULTS.find((k) => k.kpiCode === 'TOTAL_PLANNED_SPEND');
    expect(total).toBeDefined();
    expect(total?.formulaText).toBe('TOTAL_PLANNED_SPEND');
    expect(total?.calculationOrder).toBe(9);
  });
});
