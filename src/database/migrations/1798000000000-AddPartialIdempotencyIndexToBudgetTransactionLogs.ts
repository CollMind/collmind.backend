import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-095 — partial UNIQUE on `main.budget_transaction_logs(tenant_id, idempotency_key)`.
 *
 * SCOPE, NARROWED BY PRODUCT-OWNER DECISION (2026-08-06)
 * ---------------------------------------------------------------------------
 * The task's original acceptance criteria asked for `NOT NULL` + full `UNIQUE`,
 * matching the other four idempotency-key tables (`ledger_entries`,
 * `budget_transactions`, `agreement_transactions`, `on_invoice_entries` — all
 * verified NOT NULL + UNIQUE via `pg_indexes`/`information_schema.columns`
 * before writing this file). That shape was implemented once, reviewed, and
 * REVERTED: `NOT NULL` breaks 3 of `createTransaction`'s call sites (a fourth
 * legitimate ADJUSTMENT/ALLOCATION path also carries no key), because
 * `ADJUSTMENT`-family rows do not have — and are not supposed to have — a
 * natural idempotency key. Making one up would assert a uniqueness intent
 * nobody decided.
 *
 * A later draft narrowed the partial predicate to
 * `WHERE idempotency_key IS NOT NULL AND transaction_type <> 'adjustment'`.
 * That, too, is REJECTED here: uniqueness is a property of "this row carries
 * an idempotency key", not of "this row has a particular transaction_type".
 * Enumerating types would silently legislate a decision about the (today
 * unused) `transfer` type that nobody has made. Tying the predicate to type
 * instead of to key-presence also drifts the moment a new type is added that
 * either does or doesn't carry a key — the column already encodes that fact
 * correctly; the type column does not.
 *
 * FINAL, NARROW RULE (this migration implements only this):
 *
 *   UNIQUE (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
 *
 * This is the literal SQL shape of SYSTEM_INVARIANTS.md INV-L-006 as
 * generalized: "every row that carries an idempotency key is unique within
 * its tenant" — not "every row carries a key" (that's a separate, rejected
 * NOT NULL claim) and not "every row of certain types carries a key" (that's
 * the rejected type-list claim).
 *
 * NOTE ON SHAPE: a partial unique index is not the "UNIQUE on a nullable
 * column" anti-pattern. That anti-pattern is unconditional `UNIQUE` on a
 * nullable column, which is silently defeated by SQL's multi-NULL rule and
 * leaves it ambiguous what is actually being protected. A partial index says
 * explicitly, in its own predicate, which rows it governs
 * (`idempotency_key IS NOT NULL`) and is inert — not weakened — for the rows
 * outside that predicate. The two are different mechanisms with different
 * failure modes; this migration deliberately uses the second.
 *
 * DATA: `main.budget_transaction_logs` holds 0 rows at the time of writing
 * (verified via `SELECT COUNT(*)` against the running dev DB, not assumed —
 * a prior pass on this same table asserted "0 rows -> constraint is free"
 * without asking *why* it was 0; here it's 0 because every insert into this
 * table was throwing `42701` until T-096 fixed a duplicate `created_by`
 * column mapping, i.e. the table was never reachable, not merely unused).
 * There is nothing for a UNIQUE index build to conflict with.
 *
 * NAMING: mirrors the sibling pattern found in the catalogue —
 * `IDX_LEDGER_ENTRIES_TENANT_IDEMPOTENCY`,
 * `IDX_BUDGET_TRANSACTIONS_TENANT_IDEMPOTENCY`,
 * `IDX_AGREEMENT_TRANSACTIONS_TENANT_IDEMPOTENCY`,
 * `IDX_ON_INVOICE_ENTRIES_TENANT_IDEMPOTENCY` — none of those four are
 * partial, because their column is NOT NULL. This is the one partial member
 * of the family, and the name says so via this comment since the identifier
 * itself can't carry that distinction.
 */
export class AddPartialIdempotencyIndexToBudgetTransactionLogs1798000000000
  implements MigrationInterface
{
  name = 'AddPartialIdempotencyIndexToBudgetTransactionLogs1798000000000';

  private static readonly INDEX_NAME =
    'IDX_BUDGET_TRANSACTION_LOGS_TENANT_IDEMPOTENCY';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Schema-qualified probe. This database hosts both `main` (CTPM) and
    // `public` (TTM); an unqualified catalogue read can resolve against the
    // wrong product's history (CLAUDE.md §1, the UQ_ledger_entries defect).
    const tableExists = await queryRunner.query(`
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'main'
         AND table_name   = 'budget_transaction_logs'
    `);

    if (tableExists.length === 0) {
      throw new Error(
        'main.budget_transaction_logs does not exist — refusing to create ' +
          'an index on a table this migration did not create. Check ' +
          'migration order (expects 1771169825000 to have run first).',
      );
    }

    const indexExists = await queryRunner.query(
      `
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'main'
         AND tablename  = 'budget_transaction_logs'
         AND indexname  = $1
      `,
      [AddPartialIdempotencyIndexToBudgetTransactionLogs1798000000000.INDEX_NAME],
    );

    if (indexExists.length === 0) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "${AddPartialIdempotencyIndexToBudgetTransactionLogs1798000000000.INDEX_NAME}"
          ON main.budget_transaction_logs (tenant_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const indexExists = await queryRunner.query(
      `
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'main'
         AND tablename  = 'budget_transaction_logs'
         AND indexname  = $1
      `,
      [AddPartialIdempotencyIndexToBudgetTransactionLogs1798000000000.INDEX_NAME],
    );

    if (indexExists.length > 0) {
      await queryRunner.query(`
        DROP INDEX main."${AddPartialIdempotencyIndexToBudgetTransactionLogs1798000000000.INDEX_NAME}"
      `);
    }
  }
}
