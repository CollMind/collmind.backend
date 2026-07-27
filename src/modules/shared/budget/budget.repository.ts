import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../../../database/entities/budget-envelope.entity';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
} from '../../../database/entities/budget-transaction.entity';
import { BudgetSummaryView } from '../../../database/entities/budget-summary.view-entity';

@Injectable()
export class BudgetRepository {
  constructor(
    @InjectRepository(BudgetEnvelope)
    private readonly envelopeRepository: Repository<BudgetEnvelope>,
    @InjectRepository(BudgetTransaction)
    private readonly transactionRepository: Repository<BudgetTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  // Budget Envelope methods
  async createEnvelope(
    envelope: Partial<BudgetEnvelope>,
  ): Promise<BudgetEnvelope> {
    const newEnvelope = this.envelopeRepository.create(envelope);
    return this.envelopeRepository.save(newEnvelope);
  }

  async findEnvelopeById(
    tenantId: string,
    id: string,
  ): Promise<BudgetEnvelope | null> {
    return this.envelopeRepository.findOne({
      where: { tenantId, id },
    });
  }

  async findEnvelopeByCode(
    tenantId: string,
    code: string,
  ): Promise<BudgetEnvelope | null> {
    return this.envelopeRepository.findOne({
      where: { tenantId, code },
    });
  }

  /**
   * Find budget envelope by dimensions (channel, category, period)
   * Used to determine which envelope an agreement should reserve from
   * Now uses dedicated columns with fallback to metadata for backward compatibility
   */
  async findEnvelopeByDimensions(
    tenantId: string,
    channel: string,
    periodMonth: string,
    category?: string,
  ): Promise<BudgetEnvelope | null> {
    const query = this.envelopeRepository
      .createQueryBuilder('envelope')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.deletedAt IS NULL')
      .andWhere('envelope.status = :status', {
        status: BudgetEnvelopeStatus.ACTIVE,
      });

    // Match by period - prefer exact match, fallback to year pattern
    query.andWhere(
      `(envelope.period = :periodMonth OR envelope.period LIKE :yearPattern)`,
      {
        periodMonth,
        yearPattern: `${periodMonth.substring(0, 4)}%`,
      },
    );

    // Match by channel - use dedicated column with fallback to metadata for backward compatibility
    query.andWhere(
      `(envelope.channel = :channel OR envelope.metadata->>'channel' = :channel)`,
      { channel },
    );

    // Match by category if provided
    if (category) {
      query.andWhere(
        `(envelope.category = :category OR envelope.metadata->>'category' = :category)`,
        { category },
      );
    }

    // Order by most specific match first
    // Prefer dedicated column matches over metadata matches
    query
      .orderBy(
        `CASE WHEN envelope.period = :periodMonth THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy(
        `CASE WHEN envelope.channel = :channel THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy('envelope.createdAt', 'DESC');

    return query.getOne();
  }

  async findAllEnvelopes(tenantId: string): Promise<BudgetEnvelope[]> {
    return this.envelopeRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateEnvelope(envelope: BudgetEnvelope): Promise<BudgetEnvelope> {
    return this.envelopeRepository.save(envelope);
  }

  // MC-001: Pessimistic locking for budget reservation
  async findEnvelopeWithLock(
    tenantId: string,
    id: string,
  ): Promise<BudgetEnvelope | null> {
    return this.envelopeRepository
      .createQueryBuilder('envelope')
      .setLock('pessimistic_write')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.id = :id', { id })
      .getOne();
  }

  // Budget Transaction methods (Event-Sourced Approach)
  // T-030: optional `manager` allows callers to run the write INSIDE an
  // already-open QueryRunner transaction (e.g. settlement-close's queryRunner)
  // so a RELEASE and its owning state transition commit/rollback atomically.
  // When omitted, falls back to the injected repository (pre-existing behaviour).
  async createTransaction(
    transaction: Partial<BudgetTransaction>,
    manager?: EntityManager,
  ): Promise<BudgetTransaction> {
    const repo = manager
      ? manager.getRepository(BudgetTransaction)
      : this.transactionRepository;
    const newTransaction = repo.create(transaction);
    return repo.save(newTransaction);
  }

  async findTransactionById(
    tenantId: string,
    id: string,
  ): Promise<BudgetTransaction | null> {
    return this.transactionRepository.findOne({
      where: { tenantId, id },
      relations: ['envelope'],
    });
  }

  async findTransactionByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    manager?: EntityManager,
  ): Promise<BudgetTransaction | null> {
    const repo = manager
      ? manager.getRepository(BudgetTransaction)
      : this.transactionRepository;
    return repo.findOne({
      where: { tenantId, idempotencyKey },
    });
  }

  async findTransactionsByEnvelope(
    tenantId: string,
    envelopeId: string,
    txType?: BudgetTransactionType,
  ): Promise<BudgetTransaction[]> {
    const where: any = { tenantId, envelopeId };
    if (txType) {
      where.txType = txType;
    }
    return this.transactionRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findTransactionsBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    manager?: EntityManager,
  ): Promise<BudgetTransaction[]> {
    const repo = manager
      ? manager.getRepository(BudgetTransaction)
      : this.transactionRepository;
    return repo.find({
      where: { tenantId, sourceType: sourceType as any, sourceId },
      order: { createdAt: 'DESC' },
    });
  }

  // Computed reserved amount (from RESERVE - RELEASE transactions)
  async getReservedAmount(
    tenantId: string,
    envelopeId: string,
  ): Promise<number> {
    // Sum RESERVE transactions
    const reserveResult = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'reserved')
      .where('tx.tenantId = :tenantId', { tenantId })
      .andWhere('tx.envelopeId = :envelopeId', { envelopeId })
      .andWhere('tx.txType = :txType', {
        txType: BudgetTransactionType.RESERVE,
      })
      .andWhere('tx.txStatus = :txStatus', {
        txStatus: BudgetTransactionStatus.POSTED,
      })
      .getRawOne();

    // Sum RELEASE transactions
    const releaseResult = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'released')
      .where('tx.tenantId = :tenantId', { tenantId })
      .andWhere('tx.envelopeId = :envelopeId', { envelopeId })
      .andWhere('tx.txType = :txType', {
        txType: BudgetTransactionType.RELEASE,
      })
      .andWhere('tx.txStatus = :txStatus', {
        txStatus: BudgetTransactionStatus.POSTED,
      })
      .getRawOne();

    const reserved = parseFloat(reserveResult?.reserved || '0');
    const released = parseFloat(releaseResult?.released || '0');

    return reserved - released; // Net reserved amount
  }

  /**
   * Get budget summary (with computed reserved, consumed, available)
   * Uses v_budget_summary view for BRD-compliant calculations
   */
  async getBudgetSummary(
    envelopeId: string,
    tenantId: string,
  ): Promise<BudgetSummaryView | null> {
    const repository = this.dataSource.getRepository(BudgetSummaryView);
    return repository.findOne({
      where: {
        envelopeId,
        tenantId,
      },
    });
  }

  /**
   * Get all budget summaries for a tenant
   * Uses v_budget_summary view for BRD-compliant calculations
   */
  async getAllBudgetSummaries(tenantId: string): Promise<BudgetSummaryView[]> {
    const repository = this.dataSource.getRepository(BudgetSummaryView);
    return repository.find({
      where: {
        tenantId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Check budget availability for reservation
   * Uses v_budget_summary view for BRD-compliant calculations
   *
   * @param envelopeId - Budget envelope ID
   * @param tenantId - Tenant ID
   * @param requestedAmount - Amount to check availability for
   * @returns Object with available amount and sufficient flag
   * @throws Error if envelope not found
   */
  async checkBudgetAvailability(
    envelopeId: string,
    tenantId: string,
    requestedAmount: number,
  ): Promise<{ available: number; sufficient: boolean }> {
    const summary = await this.getBudgetSummary(envelopeId, tenantId);
    if (!summary) {
      throw new Error(`Budget envelope ${envelopeId} not found`);
    }
    return {
      available: summary.availableAmount,
      sufficient: summary.availableAmount >= requestedAmount,
    };
  }
}
