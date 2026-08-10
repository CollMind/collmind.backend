import { FormulaParserService } from './formula-parser.service';
import { KPI_DEFAULTS } from '../../../database/seeds/kpi.seed';

/**
 * T-163 / ADR 0011 — `GP_ROI_PCT` paydası hesaplama testi.
 *
 * ⛔ Testin şekli — CLAUDE.md §2.7 #6 / T-101 dersi: `INCR_SPEND` fixture'da
 * `TOTAL_PLANNED_SPEND` ile AYNI değeri taşırsa, iki rakip formül
 * (`INCR_GP / TOTAL_PLANNED_SPEND * 100` vs eski `INCR_GP / INCR_SPEND * 100`)
 * aynı sonucu verir ve test hiçbir şeyi ayırt edemez. Bu yüzden
 * `BASE_TOTAL_SPEND` kasıtlı olarak sıfırdan farklı seçilir:
 *
 *   INCR_SPEND = TOTAL_PLANNED_SPEND - BASE_TOTAL_SPEND
 *
 * Beklenen değerler formülden TÜRETİLMEDİ, elle hesaplanıp yazıldı (§2.7 #8 —
 * aksi halde test kendi hedefini yeniden uygulardı).
 *
 * Formül metni gerçek seed kaynağından (`KPI_DEFAULTS`) okunuyor — testin
 * kendi kopyasını hardcode etmesi yerine üretimde kullanılan tanıma
 * bağlanıyor: seed'deki `formulaText` değişirse bu test de onu görür.
 */
describe('FormulaParserService — GP_ROI_PCT payda ayrımı (ADR 0011)', () => {
  const parser = new FormulaParserService();

  const gpRoiPctSeed = KPI_DEFAULTS.find((k) => k.kpiCode === 'GP_ROI_PCT');

  // Fixture — kasıtlı olarak ayrışan değerler:
  const BASE_TOTAL_SPEND = 1000;
  const TOTAL_PLANNED_SPEND = 5000;
  const INCR_SPEND = TOTAL_PLANNED_SPEND - BASE_TOTAL_SPEND; // 4000 — ≠ TOTAL_PLANNED_SPEND
  const INCR_GP = 800;

  // Elle hesaplanmış beklenen değerler (formülden türetilmedi):
  const EXPECTED_ADR_0011 = 16; // 800 / 5000 * 100
  const EXPECTED_OLD_MIGRATION_1780 = 20; // 800 / 4000 * 100 — yanlış payda

  it("seed formulaText'i tanımlıdır (ön koşul)", () => {
    expect(gpRoiPctSeed?.formulaText).toBeDefined();
  });

  it('bağımlılık çıkarımı TOTAL_PLANNED_SPEND alır, INCR_SPEND ALMAZ', () => {
    const dependencies = parser.extractDependencies(gpRoiPctSeed!.formulaText!);
    expect(dependencies.sort()).toEqual(['INCR_GP', 'TOTAL_PLANNED_SPEND']);
    expect(dependencies).not.toContain('INCR_SPEND');
  });

  it("sonucu TOTAL_PLANNED_SPEND paydasına göre üretir — INCR_SPEND context'te FARKLI bir değerle mevcut olsa bile", () => {
    const formula = parser.parseFormula(
      gpRoiPctSeed!.formulaText!,
      'expression',
    );

    const result = formula.execute({
      INCR_GP,
      TOTAL_PLANNED_SPEND,
      BASE_TOTAL_SPEND,
      // Kasıtlı tuzak: context'te INCR_SPEND de var, ve TOTAL_PLANNED_SPEND'ten
      // FARKLI bir değer taşıyor. Formül bunu kullanmamalı.
      INCR_SPEND,
    });

    expect(result).toBe(EXPECTED_ADR_0011);
    // Ayırt edicilik kanıtı: yanlış paydayla hesaplansaydı sonuç bu olurdu —
    // ve bu iki değer birbirinden farklı (fixture'ın ayırt etme gücünün kanıtı).
    expect(EXPECTED_ADR_0011).not.toBe(EXPECTED_OLD_MIGRATION_1780);
    expect(result).not.toBe(EXPECTED_OLD_MIGRATION_1780);
  });

  it("kontrol grubu: eski (migration 1780) formülü AYNI context'te gerçekten farklı bir sonuç verir", () => {
    // Bu test üretim formülünü değil, tarihsel/yanlış formülü çalıştırır —
    // yalnızca fixture'ın gerçekten ayırt ettiğini göstermek için (§2.7 #6).
    const oldFormula = parser.parseFormula(
      'INCR_GP / INCR_SPEND * 100',
      'expression',
    );
    const oldResult = oldFormula.execute({
      INCR_GP,
      TOTAL_PLANNED_SPEND,
      INCR_SPEND,
    });
    expect(oldResult).toBe(EXPECTED_OLD_MIGRATION_1780);
  });
});
