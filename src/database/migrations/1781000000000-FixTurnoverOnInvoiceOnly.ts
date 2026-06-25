/**
 * T-008 — PLANNED_TO / BASE_TO NIV Semantics Fix
 *
 * KÖK NEDEN: PLANNED_TO formülü tüm spend'i (on+off-invoice) düşüyordu.
 * BRD NIV semantiği: Turnover yalnızca ON-INVOICE kesintilerle azalır;
 * off-invoice spend (lumpsum VIS_LS, price-support-off, LTA_OFF) turnover'ı
 * azaltmaz — GP hesabına incremental spend olarak girer.
 *
 * YANLIŞ (1780 sonrası):
 *   PLANNED_TO = PLANNED_GSV - TOTAL_PLANNED_SPEND   (tüm spend düşüyor)
 *   BASE_TO    = BASE_GSV - BASE_LTA_ON - BASE_LTA_OFF (off-invoice yanlışlıkla düşüyor)
 *
 * DOĞRU (bu migration sonrası):
 *   PLANNED_TO = PLANNED_GSV - PLANNED_ON_INVOICE_SPEND  (yalnızca on-invoice)
 *   BASE_TO    = BASE_GSV - BASE_LTA_ON                   (yalnızca on-invoice)
 *
 * Ayrıca PLANNED_ON_INVOICE_SPEND KPI'ını (EXTERNAL, order=12) ekler.
 * Bu değer plan.service.ts tarafından spendBreakdown.planned.totalOnInvoice
 * üzerinden context'e enjekte edilir.
 *
 * Elle doğrulanmış Set A ara değerleri:
 *   SKU-A: PLANNED_GSV=16800, CPP_ON=1680 → PLANNED_TO=15120, GP=7560; BASE_GP=7040
 *   SKU-B: PLANNED_GSV=12250, CPP_ON=1225 → PLANNED_TO=11025, GP=5775; BASE_GP=5600
 *   Toplam: INCR_GP=695, INCR_SPEND=6830 → GP_ROI_PCT=10.18, RAG=AMBER
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixTurnoverOnInvoiceOnly1781000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. PLANNED_TO: use only on-invoice deductions ─────────────────────
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET
        formula_text      = 'PLANNED_GSV - PLANNED_ON_INVOICE_SPEND',
        kpi_description   = 'Planned net turnover: PLANNED_GSV - PLANNED_ON_INVOICE_SPEND (BRD NIV semantics — only on-invoice deductions; T-008)',
        depends_on_kpis   = '["PLANNED_GSV","PLANNED_ON_INVOICE_SPEND"]'::jsonb,
        updated_at        = NOW()
      WHERE kpi_code = 'PLANNED_TO'
        AND formula_text != 'PLANNED_GSV - PLANNED_ON_INVOICE_SPEND';
    `);

    // ── 2. BASE_TO: remove BASE_LTA_OFF (only on-invoice reduces turnover) ─
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET
        formula_text      = 'BASE_GSV - BASE_LTA_ON',
        kpi_description   = 'Base net turnover: BASE_GSV - BASE_LTA_ON (BRD NIV semantics — only on-invoice; T-008)',
        depends_on_kpis   = '["BASE_GSV","BASE_LTA_ON"]'::jsonb,
        updated_at        = NOW()
      WHERE kpi_code = 'BASE_TO'
        AND formula_text != 'BASE_GSV - BASE_LTA_ON';
    `);

    // ── 3. PLANNED_ON_INVOICE_SPEND: insert if missing (per-tenant) ────────
    const tenants = (await queryRunner.query(
      `SELECT DISTINCT tenant_id FROM "main"."kpis"`,
    )) as Array<{ tenant_id: string }>;

    for (const { tenant_id } of tenants) {
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
          $1::uuid,
          'PLANNED_ON_INVOICE_SPEND',
          'Planned On-Invoice Spend',
          'Spend',
          'Total planned on-invoice deductions (LTA_ON + all on-invoice promo); context-injected from SpendCalc (T-008)',
          'external',
          'PLANNED_ON_INVOICE_SPEND',
          '[]'::jsonb,
          12::integer,
          'sku',
          'currency',
          2::integer,
          false::boolean,
          NULL,
          'sum',
          NULL, NULL,
          true::boolean,
          NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM "main"."kpis"
          WHERE tenant_id = $1::uuid AND kpi_code = 'PLANNED_ON_INVOICE_SPEND'
        )
        `,
        [tenant_id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Revert PLANNED_TO to previous (wrong) formula ─────────────────────
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET
        formula_text      = 'PLANNED_GSV - TOTAL_PLANNED_SPEND',
        kpi_description   = 'Planned net turnover: PLANNED_GSV - TOTAL_PLANNED_SPEND (BRD formula)',
        depends_on_kpis   = '["PLANNED_GSV","TOTAL_PLANNED_SPEND"]'::jsonb,
        updated_at        = NOW()
      WHERE kpi_code = 'PLANNED_TO';
    `);

    // ── Revert BASE_TO to previous (wrong) formula ────────────────────────
    await queryRunner.query(`
      UPDATE "main"."kpis"
      SET
        formula_text      = 'BASE_GSV - BASE_LTA_ON - BASE_LTA_OFF',
        kpi_description   = 'Base net turnover: BASE_GSV - BASE_LTA_ON - BASE_LTA_OFF (BRD formula)',
        depends_on_kpis   = '["BASE_GSV","BASE_LTA_ON","BASE_LTA_OFF"]'::jsonb,
        updated_at        = NOW()
      WHERE kpi_code = 'BASE_TO';
    `);

    // ── Remove PLANNED_ON_INVOICE_SPEND (added by this migration) ─────────
    await queryRunner.query(`
      DELETE FROM "main"."kpis"
      WHERE kpi_code = 'PLANNED_ON_INVOICE_SPEND';
    `);
  }
}
