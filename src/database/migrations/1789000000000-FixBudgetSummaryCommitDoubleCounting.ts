import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-029 — v_budget_summary'de COMMIT transaction'ları görünmezdi.
 *
 * Bug: reserved_amount yalnızca RESERVE-RELEASE'i sayıyordu. Plan onayı
 * (budget.service.ts#commitReservedForPlan) COMMIT tipi transaction
 * üretiyor ama bu view'da HİÇBİR yerde toplanmıyordu → onaylanmış planların
 * bütçesi available_amount hesabına hiç yansımıyordu (sızıntı: aynı bütçeden
 * tekrar tekrar plan onaylanabilirdi).
 *
 * Fix: reserved_amount (→ "encumbered" havuzu) artık RESERVE + COMMIT
 * toplamından RELEASE'i düşüyor. RELEASE tipi jenerik kalır (hem RESERVE'i
 * hem COMMIT'i serbest bırakabilir — budget.service.ts#releaseForPlan artık
 * her ikisi için de ayrı idempotency key'li RELEASE üretir).
 *
 * consumed_amount (ledger DEBIT-CREDIT) DEĞİŞMEDİ — gerçek faturalı/ledger
 * tüketim hâlâ ayrı bir kova (BRD: bütçe "reserve/commit" edilmiş olmak ile
 * fiilen "consume" edilmiş (ledger'a düşmüş) olmak farklı aşamalar).
 *
 * GET /budget/envelopes/:id/reserved (budget.repository.ts#getReservedAmount)
 * BİLEREK değiştirilmedi — yalnızca RESERVE-RELEASE'i sayar; bu, "Pending
 * Approval'da rezerve edilmiş ama henüz onaylanmamış" tutarı ayrıştırmak
 * için kasıtlı bir farktır (approve sonrası RESERVE→RELEASE ile netlenir,
 * COMMIT ayrı bir kovaya geçer, /reserved 0'a döner — beklenen davranış).
 */
export class FixBudgetSummaryCommitDoubleCounting1789000000000 implements MigrationInterface {
  name = 'FixBudgetSummaryCommitDoubleCounting1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE VIEW main.v_budget_summary AS
      SELECT
        be.id AS envelope_id,
        be.tenant_id,
        be.code,
        be.name,
        be.fiscal_year,
        be.period,
        be.allocated_amount,
        be.currency,
        be.status,
        -- Reserved/encumbered: SUM of RESERVE + COMMIT - SUM of RELEASE
        -- (T-029: COMMIT now included — previously invisible here, causing
        -- approved plans to never reduce available_amount).
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN bt.tx_type IN ('RESERVE', 'COMMIT') THEN bt.amount ELSE 0 END) -
              SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
            FROM main.budget_transactions bt
            WHERE bt.envelope_id = be.id
              AND bt.tx_status = 'POSTED'
              AND bt.deleted_at IS NULL
          ),
          0
        ) AS reserved_amount,
        -- Consumed: SUM of ledger entries (DEBIT - CREDIT) — unchanged.
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
            FROM main.ledger_entries le
            WHERE le.budget_envelope_id = be.id
              AND le.deleted_at IS NULL
          ),
          0
        ) AS consumed_amount,
        -- Available: allocated - reserved(incl. COMMIT) - consumed
        be.allocated_amount -
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN bt.tx_type IN ('RESERVE', 'COMMIT') THEN bt.amount ELSE 0 END) -
              SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
            FROM main.budget_transactions bt
            WHERE bt.envelope_id = be.id
              AND bt.tx_status = 'POSTED'
              AND bt.deleted_at IS NULL
          ),
          0
        ) -
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
            FROM main.ledger_entries le
            WHERE le.budget_envelope_id = be.id
              AND le.deleted_at IS NULL
          ),
          0
        ) AS available_amount,
        -- Utilization percentage
        CASE
          WHEN be.allocated_amount > 0 THEN
            ROUND(
              (
                COALESCE(
                  (
                    SELECT
                      SUM(CASE WHEN bt.tx_type IN ('RESERVE', 'COMMIT') THEN bt.amount ELSE 0 END) -
                      SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
                FROM main.budget_transactions bt
                WHERE bt.envelope_id = be.id
                  AND bt.tx_status = 'POSTED'
                  AND bt.deleted_at IS NULL
              ),
              0
            ) +
            COALESCE(
              (
                SELECT
                  SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
                FROM main.ledger_entries le
                WHERE le.budget_envelope_id = be.id
                  AND le.deleted_at IS NULL
              ),
              0
            )
          ) / be.allocated_amount * 100,
          2
        )
        ELSE 0
      END AS utilization_pct,
        be.created_at,
        be.updated_at
      FROM main.budget_envelopes be
      WHERE be.deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE VIEW main.v_budget_summary AS
      SELECT
        be.id AS envelope_id,
        be.tenant_id,
        be.code,
        be.name,
        be.fiscal_year,
        be.period,
        be.allocated_amount,
        be.currency,
        be.status,
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN bt.tx_type = 'RESERVE' THEN bt.amount ELSE 0 END) -
              SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
            FROM main.budget_transactions bt
            WHERE bt.envelope_id = be.id
              AND bt.tx_status = 'POSTED'
              AND bt.deleted_at IS NULL
          ),
          0
        ) AS reserved_amount,
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
            FROM main.ledger_entries le
            WHERE le.budget_envelope_id = be.id
              AND le.deleted_at IS NULL
          ),
          0
        ) AS consumed_amount,
        be.allocated_amount -
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN bt.tx_type = 'RESERVE' THEN bt.amount ELSE 0 END) -
              SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
            FROM main.budget_transactions bt
            WHERE bt.envelope_id = be.id
              AND bt.tx_status = 'POSTED'
              AND bt.deleted_at IS NULL
          ),
          0
        ) -
        COALESCE(
          (
            SELECT
              SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
            FROM main.ledger_entries le
            WHERE le.budget_envelope_id = be.id
              AND le.deleted_at IS NULL
          ),
          0
        ) AS available_amount,
        CASE
          WHEN be.allocated_amount > 0 THEN
            ROUND(
              (
                COALESCE(
                  (
                    SELECT
                      SUM(CASE WHEN bt.tx_type = 'RESERVE' THEN bt.amount ELSE 0 END) -
                      SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END)
                FROM main.budget_transactions bt
                WHERE bt.envelope_id = be.id
                  AND bt.tx_status = 'POSTED'
                  AND bt.deleted_at IS NULL
              ),
              0
            ) +
            COALESCE(
              (
                SELECT
                  SUM(CASE WHEN le.entry_direction = 'DEBIT' THEN le.amount ELSE -le.amount END)
                FROM main.ledger_entries le
                WHERE le.budget_envelope_id = be.id
                  AND le.deleted_at IS NULL
              ),
              0
            )
          ) / be.allocated_amount * 100,
          2
        )
        ELSE 0
      END AS utilization_pct,
        be.created_at,
        be.updated_at
      FROM main.budget_envelopes be
      WHERE be.deleted_at IS NULL;
    `);
  }
}
