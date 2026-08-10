/**
 * T-163 / ADR 0011 — GP_ROI_PCT paydası düzeltmesi
 *
 * `migration 1780000000000-FixKpiBrdFormulas` bu KPI'ı `INCR_GP / INCR_SPEND * 100`
 * olarak ayarlamış ve bunu başlık yorumunda "DOĞRU (BRD)" diye etiketlemişti. Bu iddia
 * yanlıştı: BRD `Section_05 §5.3`, Glossary `GP ROI`/`ROI` maddeleri, `04_Reviews` ve
 * TTM'in seed + testi (`plans.kpis.spec.ts:212,:487`) dördü de aynı paydayı taşıyor:
 * `TOTAL_PLANNED_SPEND`. Tam gerekçe ve ölçüm: `docs/decisions/0011-gp-roi-paydasi-total-planned-spend.md`.
 *
 * Karar tanık sayısına göre değil — dört onay/RAG eşiği (`ROI ≥%20` yeşil, Gate 3'ün
 * "%70 yeşil" kapısı, `auto_reject gp_roi_pct_lt: 5`, Finance `<%15`) bu payda
 * varsayılarak kalibre edilmiş. `INCR_SPEND` paydası ROI'yi sistematik olarak şişirip
 * bu eşikleri gevşetiyordu (bkz. ADR 0011 §Gerekçe).
 *
 * `1780`'in gövdesi GERİYE DÖNÜK DÜZENLENMEDİ — uygulanmış bir migration'ın kodunu
 * değiştirmek çalışan veritabanına ulaşmaz. Yalnızca `1780`'in başlık yorumundaki
 * yanlış "DOĞRU (BRD)" iddiası ayrıca düzeltildi (kod satırlarına dokunulmadı).
 *
 * Hesaplama sırası güvenli: TOTAL_PLANNED_SPEND (calculation_order=9, context-injected,
 * plan.service.ts'te INCR_SPEND ile yan yana enjekte ediliyor) zaten GP_ROI_PCT'ten
 * (order=48) önce hazır. calculation_order DEĞİŞTİRİLMEDİ.
 *
 * Tüm tenant'lar için çalışır (WHERE kpi_code = 'GP_ROI_PCT', tenant filtresi yok —
 * 1780 ile aynı desen). Idempotent: formula_text zaten hedef değerdeyse UPDATE hiçbir
 * satırı etkilemez (WHERE formula_text != ... OR calculation_order != ... guard'ı).
 *
 * transaction = false: 1780 ile aynı desen; idempotent guard'lı tek UPDATE, transaction
 * gerektirmiyor.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_FORMULA = 'INCR_GP / TOTAL_PLANNED_SPEND * 100';
const NEW_DEPENDS_ON = '["INCR_GP","TOTAL_PLANNED_SPEND"]';
const NEW_DESCRIPTION =
  'Incremental GP ROI %: INCR_GP / TOTAL_PLANNED_SPEND * 100 (BRD canonical — ADR 0011: bkz. docs/decisions/0011-gp-roi-paydasi-total-planned-spend.md)';
const NEW_CALCULATION_ORDER = 48;

const OLD_FORMULA = 'INCR_GP / INCR_SPEND * 100';
const OLD_DEPENDS_ON = '["INCR_GP","INCR_SPEND"]';
const OLD_DESCRIPTION =
  'Incremental GP ROI %: INCR_GP / INCR_SPEND * 100 (BRD canonical — BUG #1 FIX)';
const OLD_CALCULATION_ORDER = 48;

export class FixGpRoiPctDenominator1801000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // calculation_order=48: CHK_KPIS_CALCULATION_ORDER (> 0 AND <= 50) korunuyor —
    // sıra değişmiyor, yalnız payda değişiyor.
    await queryRunner.query(
      `
      UPDATE "main"."kpis"
      SET
        formula_text       = $1,
        formula_type       = 'expression',
        kpi_description    = $2,
        calculation_order  = $3,
        depends_on_kpis    = $4::jsonb,
        updated_at         = NOW()
      WHERE kpi_code = 'GP_ROI_PCT'
        AND (formula_text != $1
             OR calculation_order != $3
             OR depends_on_kpis IS DISTINCT FROM $4::jsonb);
      `,
      [NEW_FORMULA, NEW_DESCRIPTION, NEW_CALCULATION_ORDER, NEW_DEPENDS_ON],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1780'in uyguladığı hâle döner (bu migration'ın up()'ından önceki durum).
    await queryRunner.query(
      `
      UPDATE "main"."kpis"
      SET
        formula_text       = $1,
        formula_type       = 'expression',
        kpi_description    = $2,
        calculation_order  = $3,
        depends_on_kpis    = $4::jsonb,
        updated_at         = NOW()
      WHERE kpi_code = 'GP_ROI_PCT'
        AND (formula_text != $1
             OR calculation_order != $3
             OR depends_on_kpis IS DISTINCT FROM $4::jsonb);
      `,
      [OLD_FORMULA, OLD_DESCRIPTION, OLD_CALCULATION_ORDER, OLD_DEPENDS_ON],
    );
  }
}
