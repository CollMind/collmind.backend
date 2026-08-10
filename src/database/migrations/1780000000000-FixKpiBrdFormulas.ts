/**
 * T-008 — KPI/ROI BRD Parite Fix Migration
 *
 * Bu migration şunları yapar:
 * 1. GP_ROI_PCT formula_text'ini günceller:
 *    YANLIŞ (önceki): GP / TACTIC_SPEND * 100
 *    BU MIGRATION'IN UYGULADIĞI: INCR_GP / INCR_SPEND * 100
 *
 *    ⚠️ DÜZELTME (2026-08-10, ADR 0011): Yukarıdaki "DOĞRU (BRD)" iddiası YANLIŞTI.
 *    BRD `Section_05 §5.3`, Glossary `GP ROI`/`ROI` maddeleri, `04_Reviews` ve TTM'in
 *    seed + testi paydayı `TOTAL_PLANNED_SPEND` olarak tanımlıyor — `INCR_SPEND` değil.
 *    Doğru payda `migration 1801000000000-FixGpRoiPctDenominator` ile uygulandı.
 *    Bu dosyanın kod satırları GERİYE DÖNÜK DEĞİŞTİRİLMEDİ (uygulanmış bir migration'ın
 *    gövdesini düzenlemek çalışan veritabanına ulaşmaz) — yalnız bu yorum düzeltildi.
 *    Tam gerekçe: `docs/decisions/0011-gp-roi-paydasi-total-planned-spend.md`.
 *
 * 2. Eksik BRD KPI'larını ekler (yoksa):
 *    PLANNED_LTA_ON, PLANNED_LTA_OFF, BASE_LTA_ON, BASE_LTA_OFF,
 *    TOTAL_PLANNED_SPEND, BASE_TOTAL_SPEND, INCR_SPEND,
 *    BASE_GSV, PLANNED_GSV, BASE_TO, PLANNED_TO,
 *    BASE_COGS, PLANNED_COGS, BASE_GP, PLANNED_GP, INCR_GP, CPP_ON_SPEND
 *
 * 3. Var olan PLAN_TURNOVER → PLANNED_TO ile hizalar (KPI kodu değişmez,
 *    sadece formula_text güncellenir).
 *
 * transaction = false: idempotent IF NOT EXISTS guard'ları kullanıldığı için.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixKpiBrdFormulas1780000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. GP_ROI_PCT: BRD kanonik formül düzeltmesi ──────────────────────
    // Her tenant'taki yanlış formülü güncelle.
    // calculation_order=48: must satisfy CHK_KPIS_CALCULATION_ORDER (> 0 AND <= 50)
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET
        formula_text       = 'INCR_GP / INCR_SPEND * 100',
        formula_type       = 'expression',
        kpi_description    = 'Incremental GP ROI %: INCR_GP / INCR_SPEND * 100 (BRD canonical — BUG #1 FIX)',
        calculation_order  = 48,
        depends_on_kpis    = '["INCR_GP","INCR_SPEND"]'::jsonb,
        updated_at         = NOW()
      WHERE kpi_code = 'GP_ROI_PCT'
        AND (formula_text != 'INCR_GP / INCR_SPEND * 100'
             OR calculation_order != 48);
    `);

    // ── 2. PLAN_TURNOVER → align formula_text to BRD PLANNED_TO definition ─
    // The legacy KPI code PLAN_TURNOVER used PLAN_VOL * BPTT which is the
    // PLANNED_GSV definition. BRD defines PLANNED_TO as PLANNED_GSV - TOTAL_PLANNED_SPEND.
    // We keep the code but mark it inactive if PLANNED_TO exists, OR update its formula.
    // Strategy: keep existing PLAN_TURNOVER unchanged (it maps to PLANNED_GSV effectively)
    // and add PLANNED_TO as a new row — safer than renaming.

    // ── 3. Add missing BRD KPIs (idempotent: skip if kpi_code already exists) ──

    // Helper: INSERT if not exists for a given tenant
    // We use a DO block per KPI code to stay idempotent.
    const insertIfMissing = async (
      kpiCode: string,
      kpiName: string,
      kpiGroup: string,
      kpiDescription: string,
      formulaType: string,
      formulaText: string,
      dependsOnKpis: string[],
      calculationOrder: number,
      calculationLevel: string,
      displayFormat: string,
      decimalPlaces: number,
      showInGrid: boolean,
      columnOrder: number | null,
      aggregationMethodFu: string | null,
      ragGreenThreshold: number | null,
      ragAmberThreshold: number | null,
      isActive: boolean,
    ): Promise<void> => {
      const dependsJson = JSON.stringify(dependsOnKpis);
      const colOrderSql = columnOrder !== null ? String(columnOrder) : 'NULL';
      const aggMethodSql = aggregationMethodFu
        ? `'${aggregationMethodFu}'`
        : 'NULL';
      const ragGreenSql =
        ragGreenThreshold !== null ? String(ragGreenThreshold) : 'NULL';
      const ragAmberSql =
        ragAmberThreshold !== null ? String(ragAmberThreshold) : 'NULL';

      // Get all distinct tenant_ids from kpis table
      const tenants = (await queryRunner.query(
        `SELECT DISTINCT tenant_id FROM "main"."kpis"`,
      )) as Array<{ tenant_id: string }>;

      for (const { tenant_id } of tenants) {
        // Use explicit casts to avoid PostgreSQL "inconsistent types deduced for parameter"
        // error when the same positional parameter appears in both SELECT and WHERE NOT EXISTS.
        await queryRunner.query(
          `
          INSERT INTO "main"."kpis" (
            id, tenant_id, kpi_code, kpi_name, kpi_group, kpi_description,
            formula_type, formula_text, depends_on_kpis,
            calculation_order, calculation_level,
            display_format, decimal_places,
            show_in_grid, column_order,
            aggregation_method_fu,
            rag_green_threshold, rag_amber_threshold,
            is_active,
            created_at, updated_at
          )
          SELECT
            uuid_generate_v4(),
            $1::uuid, $2::varchar, $3, $4, $5,
            $6, $7, $8::jsonb,
            $9::integer, $10,
            $11, $12::integer,
            $13::boolean, ${colOrderSql},
            ${aggMethodSql},
            ${ragGreenSql}, ${ragAmberSql},
            $14::boolean,
            NOW(), NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM "main"."kpis"
            WHERE tenant_id = $1::uuid AND kpi_code = $2::varchar
          )
        `,
          [
            tenant_id,
            kpiCode,
            kpiName,
            kpiGroup,
            kpiDescription,
            formulaType,
            formulaText,
            dependsJson,
            calculationOrder,
            calculationLevel,
            displayFormat,
            decimalPlaces,
            showInGrid,
            isActive,
          ],
        );
      }
    };

    // External / context-injected KPIs
    await insertIfMissing(
      'PLANNED_LTA_ON',
      'Planned LTA On-Invoice',
      'Spend',
      'Planned LTA on-invoice deduction (context-injected from SpendCalc)',
      'external',
      'PLANNED_LTA_ON',
      [],
      5,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'PLANNED_LTA_OFF',
      'Planned LTA Off-Invoice',
      'Spend',
      'Planned LTA off-invoice deduction (context-injected from SpendCalc)',
      'external',
      'PLANNED_LTA_OFF',
      [],
      6,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'BASE_LTA_ON',
      'Base LTA On-Invoice',
      'Spend',
      'Base LTA on-invoice deduction (context-injected from SpendCalc)',
      'external',
      'BASE_LTA_ON',
      [],
      7,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'BASE_LTA_OFF',
      'Base LTA Off-Invoice',
      'Spend',
      'Base LTA off-invoice deduction (context-injected from SpendCalc)',
      'external',
      'BASE_LTA_OFF',
      [],
      8,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'TOTAL_PLANNED_SPEND',
      'Total Planned Spend',
      'Spend',
      'Sum of all planned spend (LTA + promo); context-injected from SpendCalc',
      'external',
      'TOTAL_PLANNED_SPEND',
      [],
      9,
      'sku',
      'currency',
      2,
      true,
      6,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'BASE_TOTAL_SPEND',
      'Base Total Spend',
      'Spend',
      'Base total spend (LTA only, no promo); context-injected from SpendCalc',
      'external',
      'BASE_TOTAL_SPEND',
      [],
      10,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'INCR_SPEND',
      'Incremental Spend',
      'Spend',
      'TOTAL_PLANNED_SPEND - BASE_TOTAL_SPEND; context-injected from SpendCalc',
      'external',
      'INCR_SPEND',
      [],
      11,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );

    // GSV KPIs
    await insertIfMissing(
      'BASE_GSV',
      'Base GSV',
      'Revenue',
      'Base Gross Sales Value: BASE_VOL * BPTT (BRD formula level 3)',
      'expression',
      'BASE_VOL * BPTT',
      ['BASE_VOL', 'BPTT'],
      15,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'PLANNED_GSV',
      'Planned GSV',
      'Revenue',
      'Planned Gross Sales Value: PLAN_VOL * BPTT (BRD formula level 3)',
      'expression',
      'PLAN_VOL * BPTT',
      ['PLAN_VOL', 'BPTT'],
      16,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );

    // Turnover KPIs
    await insertIfMissing(
      'BASE_TO',
      'Base Turnover',
      'Revenue',
      'Base net turnover: BASE_GSV - BASE_LTA_ON - BASE_LTA_OFF (BRD formula)',
      'expression',
      'BASE_GSV - BASE_LTA_ON - BASE_LTA_OFF',
      ['BASE_GSV', 'BASE_LTA_ON', 'BASE_LTA_OFF'],
      25,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'PLANNED_TO',
      'Planned Turnover',
      'Revenue',
      'Planned net turnover: PLANNED_GSV - TOTAL_PLANNED_SPEND (BRD formula)',
      'expression',
      'PLANNED_GSV - TOTAL_PLANNED_SPEND',
      ['PLANNED_GSV', 'TOTAL_PLANNED_SPEND'],
      26,
      'sku',
      'currency',
      2,
      true,
      5,
      'sum',
      null,
      null,
      true,
    );

    // COGS KPIs
    await insertIfMissing(
      'BASE_COGS',
      'Base COGS',
      'Cost',
      'Base cost of goods sold: BASE_VOL * COGS (BRD formula)',
      'expression',
      'BASE_VOL * COGS',
      ['BASE_VOL', 'COGS'],
      30,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'PLANNED_COGS',
      'Planned COGS',
      'Cost',
      'Planned cost of goods sold: PLAN_VOL * COGS (BRD formula)',
      'expression',
      'PLAN_VOL * COGS',
      ['PLAN_VOL', 'COGS'],
      31,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );

    // GP KPIs
    await insertIfMissing(
      'BASE_GP',
      'Base Gross Profit',
      'Profit',
      'Base gross profit: BASE_TO - BASE_COGS (BRD formula)',
      'expression',
      'BASE_TO - BASE_COGS',
      ['BASE_TO', 'BASE_COGS'],
      35,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
    await insertIfMissing(
      'PLANNED_GP',
      'Planned Gross Profit',
      'Profit',
      'Planned gross profit: PLANNED_TO - PLANNED_COGS (BRD formula)',
      'expression',
      'PLANNED_TO - PLANNED_COGS',
      ['PLANNED_TO', 'PLANNED_COGS'],
      36,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );

    // INCR_GP — MUST be before GP_ROI_PCT
    await insertIfMissing(
      'INCR_GP',
      'Incremental Gross Profit',
      'Profit',
      'Incremental gross profit: PLANNED_GP - BASE_GP (BRD formula) — MUST be before GP_ROI_PCT',
      'expression',
      'PLANNED_GP - BASE_GP',
      ['PLANNED_GP', 'BASE_GP'],
      46,
      'sku',
      'currency',
      2,
      true,
      7,
      'sum',
      null,
      null,
      true,
    );

    // CPP_ON_SPEND
    await insertIfMissing(
      'CPP_ON_SPEND',
      'CPP On-Invoice Spend',
      'Spend',
      'CPP on-invoice spend: (PLANNED_GSV - PLANNED_LTA_ON) * (CPP_ON_PCT / 100) (BRD formula)',
      'expression',
      '(PLANNED_GSV - PLANNED_LTA_ON) * CPP_ON_PCT / 100',
      ['PLANNED_GSV', 'PLANNED_LTA_ON', 'CPP_ON_PCT'],
      47,
      'sku',
      'currency',
      2,
      false,
      null,
      'sum',
      null,
      null,
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert GP_ROI_PCT formula to previous (wrong) value
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET
        formula_text      = 'GP / TACTIC_SPEND * 100',
        formula_type      = 'expression',
        kpi_description   = 'Gross Profit ROI as percentage',
        calculation_order = 8,
        depends_on_kpis   = NULL,
        updated_at        = NOW()
      WHERE kpi_code = 'GP_ROI_PCT';
    `);

    // Remove newly added KPIs (only those added by this migration)
    await queryRunner.query(`
      DELETE FROM "main"."kpis"
      WHERE kpi_code IN (
        'PLANNED_LTA_ON','PLANNED_LTA_OFF','BASE_LTA_ON','BASE_LTA_OFF',
        'TOTAL_PLANNED_SPEND','BASE_TOTAL_SPEND','INCR_SPEND',
        'BASE_GSV','PLANNED_GSV',
        'BASE_TO','PLANNED_TO',
        'BASE_COGS','PLANNED_COGS',
        'BASE_GP','PLANNED_GP',
        'INCR_GP','CPP_ON_SPEND'
      );
    `);
  }
}
