import { DataSource } from 'typeorm';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
  BudgetTransactionSourceType,
} from '../entities/budget-transaction.entity';

export async function seedBudgetTransactions(
  dataSource: DataSource,
  tenantId: string,
  envelopeId: string,
  agreementId: string,
  userId: string,
): Promise<BudgetTransaction[]> {
  const repo = dataSource.getRepository(BudgetTransaction);

  // ALLOCATE transaction (initial budget)
  const allocateTransaction = {
    tenantId,
    envelopeId,
    txType: BudgetTransactionType.ALLOCATE,
    txStatus: BudgetTransactionStatus.POSTED,
    sourceType: BudgetTransactionSourceType.MANUAL,
    amount: 500000,
    currency: 'TRY',
    idempotencyKey: `ALLOCATE|ENVELOPE|${envelopeId}|INITIAL`,
    description: 'Initial Q1 2026 budget allocation',
    createdBy: userId,
  };

  // RESERVE transaction (for approved agreement)
  const reserveTransaction = {
    tenantId,
    envelopeId,
    txType: BudgetTransactionType.RESERVE,
    txStatus: BudgetTransactionStatus.POSTED,
    sourceType: BudgetTransactionSourceType.AGREEMENT,
    sourceId: agreementId,
    amount: 75000,
    currency: 'TRY',
    idempotencyKey: `RESERVE|AGREEMENT|${agreementId}|${envelopeId}`,
    description: 'Budget reservation for STA-2026-0002',
    createdBy: userId,
  };

  const transactions = [allocateTransaction, reserveTransaction];
  const created: BudgetTransaction[] = [];

  for (const tx of transactions) {
    const existing = await repo.findOne({
      where: { idempotencyKey: tx.idempotencyKey, tenantId },
    });
    if (!existing) {
      const entity = repo.create(tx);
      created.push(await repo.save(entity));
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} budget transactions`);
  return created;
}
