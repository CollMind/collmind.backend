import { ViewEntity, ViewColumn } from 'typeorm';
import { DecimalTransformer } from '../transformers/decimal.transformer';

/**
 * Budget Summary View Entity
 *
 * Maps to v_budget_summary database view that computes:
 * - reserved_amount: from budget_transactions (RESERVE - RELEASE)
 * - consumed_amount: from ledger_entries (DEBIT - CREDIT)
 * - available_amount: allocated - reserved - consumed
 * - utilization_pct: (reserved + consumed) / allocated * 100
 *
 * This view provides BRD-compliant computed fields for budget envelopes.
 * The view is the source of truth; stored fields in budget_envelopes are legacy.
 */
@ViewEntity({
  name: 'v_budget_summary',
  schema: 'main',
  expression: `
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
    WHERE be.deleted_at IS NULL
  `,
})
export class BudgetSummaryView {
  @ViewColumn()
  envelopeId!: string;

  @ViewColumn()
  tenantId!: string;

  @ViewColumn()
  code!: string;

  @ViewColumn()
  name!: string;

  @ViewColumn()
  fiscalYear!: string;

  @ViewColumn()
  period!: string;

  @ViewColumn({ transformer: DecimalTransformer })
  allocatedAmount!: number;

  @ViewColumn()
  currency!: string;

  @ViewColumn()
  status!: string;

  @ViewColumn({ transformer: DecimalTransformer })
  reservedAmount!: number;

  @ViewColumn({ transformer: DecimalTransformer })
  consumedAmount!: number;

  @ViewColumn({ transformer: DecimalTransformer })
  availableAmount!: number;

  @ViewColumn({ transformer: DecimalTransformer })
  utilizationPct!: number;

  @ViewColumn()
  createdAt!: Date;

  @ViewColumn()
  updatedAt!: Date;
}
