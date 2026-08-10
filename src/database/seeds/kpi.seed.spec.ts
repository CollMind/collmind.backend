import { KPI_DEFAULTS } from './kpi.seed';

/**
 * T-163 / ADR 0011 — `GP_ROI_PCT.formulaText` seed sözleşmesi.
 *
 * Neden bu test var: `seedKpis()` idempotent bir upsert'tir ve `UPSERT_FIELDS`
 * (`formulaText`, `dependsOnKpis` dahil) her koşuda var olan satırın üzerine
 * YAZAR — bkz. `kpi.seed.ts`, `UPSERT_FIELDS`. Yani migration
 * `1801000000000-FixGpRoiPctDenominator` veritabanını düzeltse bile, bu dosya
 * eski paydaya (`INCR_SPEND`) geri dönerse bir sonraki `npm run seed` düzeltmeyi
 * SESSİZCE geri alır. Bu test o geri dönüşü kırmızıya çevirir.
 *
 * Karar: `docs/decisions/0011-gp-roi-paydasi-total-planned-spend.md`.
 * Migration: `1801000000000-FixGpRoiPctDenominator`.
 */
describe('kpi.seed — GP_ROI_PCT sözleşmesi (ADR 0011)', () => {
  const gpRoiPct = KPI_DEFAULTS.find((k) => k.kpiCode === 'GP_ROI_PCT');

  it('GP_ROI_PCT seed satırı bulunur', () => {
    expect(gpRoiPct).toBeDefined();
  });

  it("formulaText paydası TOTAL_PLANNED_SPEND'tir — INCR_SPEND DEĞİL", () => {
    expect(gpRoiPct?.formulaText).toBe('INCR_GP / TOTAL_PLANNED_SPEND * 100');
    // Negatif taraf: eski (migration 1780) paydasını da açıkça reddet — bir
    // gün formulaText serbestçe yeniden yazılırsa (örn. boşluk/parantez
    // varyasyonu) bu satır "aynı payda, farklı yazım" ile "yanlış payda"yı
    // ayırt eder.
    expect(gpRoiPct?.formulaText).not.toContain('INCR_SPEND');
  });

  it('dependsOnKpis TOTAL_PLANNED_SPEND içerir, INCR_SPEND içermez', () => {
    expect(gpRoiPct?.dependsOnKpis).toEqual(['INCR_GP', 'TOTAL_PLANNED_SPEND']);
    expect(gpRoiPct?.dependsOnKpis).not.toContain('INCR_SPEND');
  });
});
