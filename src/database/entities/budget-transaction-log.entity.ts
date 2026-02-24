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
  @Column({ name: 'on_invoice_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  onInvoiceAmount!: number;

  @Column({ name: 'off_invoice_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  offInvoiceAmount!: number;

  // Related plan (if applicable)
  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId?: string;

  // Description and audit
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById?: string;

  // Idempotency key to prevent duplicate transactions
  @Column({ name: 'idempotency_key', length: 200, nullable: true })
  idempotencyKey?: string;

  // Relations
  @ManyToOne(() => BudgetAllocation, (allocation) => allocation.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'budget_allocation_id' })
  budgetAllocation!: BudgetAllocation;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: User;
}
