import { DataSource } from 'typeorm';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../entities/budget-envelope.entity';

export async function seedBudgetEnvelopes(
  dataSource: DataSource,
  tenantId: string,
): Promise<BudgetEnvelope[]> {
  const repo = dataSource.getRepository(BudgetEnvelope);

  const envelopes = [
    {
      tenantId,
      code: 'ENV-2026-NKA-Q1',
      name: 'NKA Channel Q1 2026 Budget',
      fiscalYear: '2026',
      period: '2026-01', // Matches agreement periodMonth
      allocatedAmount: 500000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'National Key Accounts Q1 2026 Trade Budget',
      metadata: { channel: 'NKA' }, // Add channel to metadata for lookup
    },
    {
      tenantId,
      code: 'ENV-2026-NKA-Q2',
      name: 'NKA Channel Q2 2026 Budget',
      fiscalYear: '2026',
      period: '2026-02', // Matches approved agreement periodMonth
      allocatedAmount: 600000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'National Key Accounts Q2 2026 Trade Budget',
      metadata: { channel: 'NKA' }, // Add channel to metadata for lookup
    },
    {
      tenantId,
      code: 'ENV-2026-TRAD-Q1',
      name: 'Traditional Trade Q1 2026 Budget',
      fiscalYear: '2026',
      period: '2026-01',
      allocatedAmount: 300000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'Traditional Trade Q1 2026 Budget',
      metadata: { channel: 'TRADITIONAL_TRADE' }, // Add channel to metadata for lookup
    },
    {
      tenantId,
      code: 'ENV-2026-ECOM-Q1',
      name: 'E-Commerce Q1 2026 Budget',
      fiscalYear: '2026',
      period: '2026-02',
      allocatedAmount: 200000,
      consumedAmount: 0,
      status: BudgetEnvelopeStatus.ACTIVE,
      currency: 'TRY',
      description: 'E-Commerce Q1 2026 Budget',
      metadata: { channel: 'E_COMMERCE' }, // Add channel to metadata for lookup
    },
  ];

  const created: BudgetEnvelope[] = [];
  for (const envelope of envelopes) {
    const existing = await repo.findOne({
      where: { code: envelope.code, tenantId },
    });
    if (!existing) {
      const entity = repo.create(envelope);
      created.push(await repo.save(entity));
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} budget envelopes`);
  return created;
}
