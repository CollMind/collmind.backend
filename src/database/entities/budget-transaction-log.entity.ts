import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { BudgetAllocation } from './budget-allocation.entity';
import { User } from './user.entity';

export enum BudgetTransactionType {
  ALLOCATION = 'allocation',
  UTILIZATION = 'utilization',
  RELEASE = 'release',
  ADJUSTMENT = 'adjustment',
  TRANSFER = 'transfer',
  RESERVATION = 'reservation',
  COMMIT = 'commit',
}

@Entity({ name: 'budget_transaction_logs', schema: 'main' })
@Index(['budgetAllocationId', 'createdAt'])
@Index(['planId'])
@Index(['transactionType'])
@Index(['createdAt'])
export class BudgetTransactionLog extends BaseEntity {
  @Column({ name: 'budget_allocation_id', type: 'uuid' })
  budgetAllocationId!: string;

  @Column({
    name: 'transaction_type',
    type: 'enum',
    enum: BudgetTransactionType,
  })
  transactionType!: BudgetTransactionType;

  // On-invoice and off-invoice amounts (separate)
  @Column({
    name: 'on_invoice_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  onInvoiceAmount!: number;

  @Column({
    name: 'off_invoice_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
  })
  offInvoiceAmount!: number;

  // Related plan (if applicable)
  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId?: string;

  // Description and audit
  @Column({ type: 'text', nullable: true })
  description?: string;

  // T-096: `createdById` REMOVED. It mapped `created_by`, and `BaseEntity`
  // (which this entity extends) already maps the same column as `createdBy`.
  // Two @Column decorators on one column made TypeORM emit `created_by` twice
  // in every INSERT:
  //
  //   ERROR: column "created_by" specified more than once (42701)
  //
  // So this table could never be written at all. `reserveBudget`,
  // `commitBudget`, `releaseBudget` and `createAllocation` all return 500 — four live
  // budget routes, silently broken.
  //
  // It also produced a measurement trap: T-095 read "0 rows" and concluded a
  // NOT NULL constraint would be free. The count was right; the reason was not
  // checked. The table was empty because nothing could ever write to it.
  // (CLAUDE.md §7.1 — a zero always has at least two explanations.)
  //
  // Use `createdBy` from BaseEntity. The `createdByUser` relation below keeps
  // its @JoinColumn on the same column, which is the ordinary relation +
  // relation-id pattern and does not collide.
  //
  // The only sibling this sweep flagged, `admin-audit-log.entity.ts` re-mapping
  // `tenant_id`, does NOT extend BaseEntity — so it has a single mapping and is
  // fine. Checked, not assumed.

  // Idempotency key to prevent duplicate transactions
  @Column({ name: 'idempotency_key', length: 200, nullable: true })
  idempotencyKey?: string;

  // Relations
  @ManyToOne(() => BudgetAllocation, (allocation) => allocation.transactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'budget_allocation_id' })
  budgetAllocation!: BudgetAllocation;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: User;
}
