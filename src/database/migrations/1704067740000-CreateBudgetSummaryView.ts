import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBudgetSummaryView1704067740000 implements MigrationInterface {
  name = 'CreateBudgetSummaryView1704067740000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the v_budget_summary view
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
        -- Reserved: SUM of RESERVE transactions - SUM of RELEASE transactions
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
        -- Consumed: SUM of ledger entries (DEBIT - CREDIT)
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
        -- Available: allocated - reserved - consumed
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
        -- Utilization percentage
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

    // Create index on budget_transactions for performance
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_transactions_envelope_status 
      ON main.budget_transactions(envelope_id, tx_status) 
      WHERE deleted_at IS NULL;
    `);

    // Create index on ledger_entries for performance
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_envelope 
      ON main.ledger_entries(budget_envelope_id) 
      WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS main.v_budget_summary;`);
    await queryRunner.query(`DROP INDEX IF EXISTS main.idx_budget_transactions_envelope_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS main.idx_ledger_entries_envelope;`);
  }
}

