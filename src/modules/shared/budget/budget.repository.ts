import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
  BudgetSpendType,
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
  // T-034b: optional trailing `manager` — mirrors #createTransaction below,
  // used by PlanService#approve's autoCreateBudget path when it runs inside
  // a QueryRunner transaction (envelope creation must commit/rollback with
  // the same-transaction approve status write, not land on the default
  // connection ahead of it).
  async createEnvelope(
    envelope: Partial<BudgetEnvelope>,
    manager?: EntityManager,
  ): Promise<BudgetEnvelope> {
    const repo = manager
      ? manager.getRepository(BudgetEnvelope)
      : this.envelopeRepository;
    const newEnvelope = repo.create(envelope);
    return repo.save(newEnvelope);
  }

  async findEnvelopeById(
    tenantId: string,
    id: string,
  ): Promise<BudgetEnvelope | null> {
    return this.envelopeRepository.findOne({
      where: { tenantId, id },
    });
  }

  // T-019b: optional `manager` — split()'s OFF-twin code-collision check
  // must read inside the same locked transaction (same rationale as
  // #createTransaction).
  async findEnvelopeByCode(
    tenantId: string,
    code: string,
    manager?: EntityManager,
  ): Promise<BudgetEnvelope | null> {
    const repo = manager
      ? manager.getRepository(BudgetEnvelope)
      : this.envelopeRepository;
    return repo.findOne({
      where: { tenantId, code },
    });
  }

  /**
   * Find budget envelope by dimensions (channel, category, period)
   * Used to determine which envelope an agreement should reserve from
   * Now uses dedicated columns with fallback to metadata for backward compatibility
   *
   * T-019 Faz 1 (docs/analysis/0008 §5.1): `spendType` is OPTIONAL — when
   * omitted, behaviour is byte-for-byte unchanged (pre-T-019 callers keep
   * working). When provided, matches a typed envelope OR a legacy UNSPLIT
   * one (`spend_type IS NULL`), preferring the typed match.
   *
   * T-019b (Faz 2 follow-up, ürün sahibi kararı 2026-08-02): once a
   * dimension has actually been split (via `splitEnvelope`), an UNQUALIFIED
   * lookup (`spendType` omitted) for that SAME dimension is no longer safe —
   * silently landing on whichever typed twin `ORDER BY createdAt DESC`
   * happens to prefer is exactly the "sessiz mis-attribution" class this
   * session has repeatedly hit (T-019/T-048/T-053). This is now a HARD
   * error (`SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION`) instead of a silent
   * pick.
   *
   * TEK TÜRETİM NOKTASI (bağlayıcı, T-049/T-052/T-053 dersi): "bu boyut
   * bölünmüş mü" sorusu AYRI bir sorguyla sorulmaz — WHERE yüklemleri
   * (period exact/LIKE fallback, channel column/metadata fallback, opsiyonel
   * category) burada TEK yerde tanımlı; split-detection bu sorgunun kendi
   * sonuç kümesinden türetilir (aşağıdaki `candidates` — spendType filtresi
   * OLMADAN eşleşen adaylar). İkinci, bağımsız evrilen bir sorgu asla
   * yazılmaz — aksi halde boyut yüklemleri iki yerde ayrışabilir ve başka
   * bir kanaldaki split bu kanalda yanlış-pozitif üretebilir.
   *
   * `spendType` VERİLDİĞİNDE bu guard hiç devreye girmez — çağıran zaten
   * hangi tipi istediğini söylemiştir, belirsizlik yoktur (davranış
   * BİREBİR aynı kalır).
   */
  async findEnvelopeByDimensions(
    tenantId: string,
    channel: string,
    periodMonth: string,
    category?: string,
    spendType?: BudgetSpendType,
  ): Promise<BudgetEnvelope | null> {
    const query = this.envelopeRepository
      .createQueryBuilder('envelope')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.deletedAt IS NULL')
      .andWhere('envelope.status = :status', {
        status: BudgetEnvelopeStatus.ACTIVE,
      });

    if (spendType) {
      query.andWhere(
        '(envelope.spendType = :spendType OR envelope.spendType IS NULL)',
        { spendType },
      );
    }

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
    // T-019 Faz 1 (§5.1): a typed envelope match beats the UNSPLIT (NULL)
    // fallback when spendType was requested — no-op ordering key today
    // (no typed envelopes exist yet), load-bearing once Faz 2 exists.
    query.orderBy(
      spendType
        ? `CASE WHEN envelope.spendType = :spendType THEN 1 ELSE 2 END`
        : `CASE WHEN envelope.period = :periodMonth THEN 1 ELSE 2 END`,
      'ASC',
    );
    if (spendType) {
      query.addOrderBy(
        `CASE WHEN envelope.period = :periodMonth THEN 1 ELSE 2 END`,
        'ASC',
      );
    }
    query
      .addOrderBy(
        `CASE WHEN envelope.channel = :channel THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy('envelope.createdAt', 'DESC');

    if (spendType) {
      // Typed lookup — UNCHANGED behaviour (prefers the typed match, falls
      // back to the UNSPLIT/NULL envelope). No ambiguity here: the caller
      // told us which type it wants.
      return query.getOne();
    }

    // spendType OMITTED — fetch every candidate matching the SAME
    // predicates (tek türetim noktası, see JSDoc above) and derive the
    // split/unsplit answer from THIS result set, not a second query.
    const candidates = await query.getMany();
    if (candidates.length === 0) {
      return null;
    }
    const winner = candidates[0];

    // Coordinator fix (2026-08-02, ölçülmüş yanlış-pozitif): the guard must
    // NOT look at the full `candidates` array — it is deliberately LOOSE
    // (period: exact-OR-year-LIKE-fallback; category: no filter at all when
    // omitted), on purpose, so a legacy caller with only a channel+rough-
    // period still resolves. That looseness means `candidates` can contain
    // ENTIRELY UNRELATED periods/categories of the SAME channel (e.g.
    // searching NKA/2026-01 also pulls in NKA/2026-02 via the year-pattern
    // fallback). If ANY of those unrelated siblings happens to be split,
    // the naive "any candidate typed?" check 400s a caller asking about a
    // dimension that was never split — measured live: splitting
    // ENV-2026-NKA-Q2 alone broke every unqualified ENV-2026-NKA-Q1 lookup.
    //
    // Fix: narrow the ambiguity check to candidates that share the WINNER's
    // own effective dimension (period/channel/category, exact) — the same
    // ordering that already picks the winner (period-exact match preferred)
    // means: if the REQUESTED dimension is truly split, the winner IS one
    // of the typed twins (they share the requested period, and a split
    // twin's `spend_type` column update happens in-place — see
    // `splitEnvelope` — so it keeps outranking any other-period fallback
    // match). If the requested dimension is UNSPLIT, this group contains
    // only that dimension's own (untyped) row(s), and another dimension's
    // split status never leaks in. Still ONE query, tek türetim noktası —
    // no second SELECT.
    const sameDimensionAsWinner = candidates.filter(
      (e) =>
        e.period === winner.period &&
        (e.channel ?? null) === (winner.channel ?? null) &&
        (e.category ?? null) === (winner.category ?? null),
    );
    const typedCandidate = sameDimensionAsWinner.find((e) => !!e.spendType);
    if (typedCandidate) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION',
        message:
          `Budget dimension (channel=${channel}, period=${periodMonth}` +
          `${category ? `, category=${category}` : ''}) has been split into ` +
          `ON_INVOICE/OFF_INVOICE envelopes; this lookup must specify an ` +
          `explicit spendType (ON_INVOICE or OFF_INVOICE) — an unqualified ` +
          `lookup can no longer determine which twin is intended.`,
      });
    }
    return winner;
  }

  async findAllEnvelopes(tenantId: string): Promise<BudgetEnvelope[]> {
    return this.envelopeRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  // T-019b: optional `manager` — split() must write the ON-side update
  // inside the SAME transaction as the OFF twin creation + re-home writes
  // (mirrors #createTransaction's manager pattern above).
  async updateEnvelope(
    envelope: BudgetEnvelope,
    manager?: EntityManager,
  ): Promise<BudgetEnvelope> {
    const repo = manager
      ? manager.getRepository(BudgetEnvelope)
      : this.envelopeRepository;
    return repo.save(envelope);
  }

  // MC-001: Pessimistic locking for budget reservation
  // T-019b: optional `manager` — split() locks+reads the envelope inside its
  // own QueryRunner transaction (same rationale as #createTransaction).
  async findEnvelopeWithLock(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<BudgetEnvelope | null> {
    const repo = manager
      ? manager.getRepository(BudgetEnvelope)
      : this.envelopeRepository;
    return repo
      .createQueryBuilder('envelope')
      .setLock('pessimistic_write')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.id = :id', { id })
      .getOne();
  }

  /**
   * T-019b (ADR 0004 Karar 3): STRICT typed lookup — unlike
   * `findEnvelopeByDimensions`, this does NOT fall back to the UNSPLIT
   * (`spend_type IS NULL`) envelope. Used to detect whether a dimension has
   * been split (a typed envelope exists for it) — `reserveForAgreement`'s
   * BOTH/NULL-agreement guard needs to know this, and the UNSPLIT-fallback
   * lookup can never distinguish "no envelope at all" from "split, but this
   * exact type not found" from "still UNSPLIT".
   */
  async findEnvelopeByDimensionsStrict(
    tenantId: string,
    channel: string,
    periodMonth: string,
    category: string | undefined,
    spendType: BudgetSpendType,
  ): Promise<BudgetEnvelope | null> {
    const query = this.envelopeRepository
      .createQueryBuilder('envelope')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.deletedAt IS NULL')
      .andWhere('envelope.status = :status', {
        status: BudgetEnvelopeStatus.ACTIVE,
      })
      .andWhere('envelope.spendType = :spendType', { spendType })
      .andWhere(
        `(envelope.period = :periodMonth OR envelope.period LIKE :yearPattern)`,
        {
          periodMonth,
          yearPattern: `${periodMonth.substring(0, 4)}%`,
        },
      )
      .andWhere(
        `(envelope.channel = :channel OR envelope.metadata->>'channel' = :channel)`,
        { channel },
      );

    if (category) {
      query.andWhere(
        `(envelope.category = :category OR envelope.metadata->>'category' = :category)`,
        { category },
      );
    }

    query.orderBy('envelope.createdAt', 'DESC');

    return query.getOne();
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

  // T-019b: optional `manager` — split()'s untyped-encumbrance guard + the
  // re-home scan must read inside the SAME locked transaction as the
  // envelope mutations (same rationale as #createTransaction).
  async findTransactionsByEnvelope(
    tenantId: string,
    envelopeId: string,
    txType?: BudgetTransactionType,
    manager?: EntityManager,
  ): Promise<BudgetTransaction[]> {
    const repo = manager
      ? manager.getRepository(BudgetTransaction)
      : this.transactionRepository;
    const where: any = { tenantId, envelopeId };
    if (txType) {
      where.txType = txType;
    }
    return repo.find({
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
