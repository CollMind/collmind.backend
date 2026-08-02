import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BudgetRepository } from './budget.repository';
import { BudgetThresholdService } from './budget-threshold.service';
import {
  BudgetReservationService,
  PlanReservationReleaseReason,
} from './budget-reservation.service';
import { UtilizationStatus } from '../finance-reporting/dto/budget-utilization.dto';
import { CreateBudgetEnvelopeDto } from './dto/create-budget-envelope.dto';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
  BudgetSpendType,
} from '../../../database/entities/budget-envelope.entity';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
  BudgetTransactionSourceType,
} from '../../../database/entities/budget-transaction.entity';

/**
 * T-019 Faz 1 / T-048: kova (bucket) discriminator used by the two
 * plan-side budget flows. `TOTAL` is NOT a BRD concept — it is the
 * backward-compatible bucket for `plan.service.ts#submit`, which still
 * reserves `plan.totalSpend` as a single undifferentiated amount (frontend
 * canonical path today, see docs/analysis/0008 §5.2/R6 + task T-019 note
 * "Geriye uyum"). It is written to the DB as `spend_type = NULL` (same as
 * pre-T-019 rows) and its idempotency key is BYTE-FOR-BYTE unchanged from
 * before this change, so existing RESERVE rows/keys remain valid.
 * `ON_INVOICE`/`OFF_INVOICE` are the real BRD-typed buckets used by
 * `approval-workflow.service.ts#submitForApproval`.
 */
export type PlanBudgetBucket = 'ON_INVOICE' | 'OFF_INVOICE' | 'TOTAL';

@Injectable()
export class BudgetService {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly budgetThresholdService: BudgetThresholdService,
    private readonly budgetReservationService: BudgetReservationService,
  ) {}

  /** T-019 Faz 1: does `tx` belong to the given plan-budget bucket? */
  private matchesBucket(
    tx: Pick<BudgetTransaction, 'spendType'>,
    bucket: PlanBudgetBucket,
  ): boolean {
    return bucket === 'TOTAL' ? !tx.spendType : tx.spendType === bucket;
  }

  async createEnvelope(
    tenantId: string,
    createDto: CreateBudgetEnvelopeDto,
    manager?: EntityManager,
  ): Promise<BudgetEnvelope> {
    // Auto-generate code and name if not provided
    const channel = createDto.channel || 'UNKNOWN';
    const category = createDto.category || 'GENERAL';
    const period =
      createDto.period || `${createDto.fiscalYear}-${createDto.month || '01'}`;

    const code = createDto.code || `${channel}/${category}/${period}`;
    const name =
      createDto.name ||
      `${channel} ${category.replace('_', ' ')} ${period} Budget`;

    // Check if code already exists
    const existing = await this.budgetRepository.findEnvelopeByCode(
      tenantId,
      code,
    );
    if (existing) {
      throw new ConflictException(
        'Budget envelope with this code already exists',
      );
    }

    const envelope = await this.budgetRepository.createEnvelope(
      {
        ...createDto,
        code,
        name,
        period,
        channel,
        category,
        tenantId,
        availableAmount: createDto.allocatedAmount,
        consumedAmount: 0,
        status: createDto.status || BudgetEnvelopeStatus.DRAFT,
      },
      manager,
    );

    return envelope;
  }

  async findAllEnvelopes(tenantId: string): Promise<BudgetEnvelope[]> {
    return this.budgetRepository.findAllEnvelopes(tenantId);
  }

  async findEnvelopeById(
    tenantId: string,
    id: string,
  ): Promise<BudgetEnvelope> {
    const envelope = await this.budgetRepository.findEnvelopeById(tenantId, id);
    if (!envelope) {
      throw new NotFoundException(`Budget envelope with ID ${id} not found`);
    }
    return envelope;
  }

  // Budget reservation (Event-Sourced: BudgetTransaction with RESERVE type)
  async reserveBudget(
    tenantId: string,
    userId: string,
    agreementId: string,
    envelopeId: string,
    amount: number,
    currency: string = 'TRY',
  ): Promise<BudgetTransaction> {
    // Get envelope with pessimistic lock (MC-001: Same envelope serialized)
    const envelope = await this.budgetRepository.findEnvelopeWithLock(
      tenantId,
      envelopeId,
    );

    if (!envelope) {
      throw new NotFoundException(
        `Budget envelope with ID ${envelopeId} not found`,
      );
    }

    if (envelope.status !== BudgetEnvelopeStatus.ACTIVE) {
      throw new BadRequestException('Budget envelope is not active');
    }

    // Check idempotency (prevent duplicate reservations)
    const idempotencyKey = `RESERVE|AGREEMENT|${agreementId}|${envelopeId}`;
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      throw new ConflictException(
        'Budget reservation already exists for this agreement',
      );
    }

    // Check available amount using v_budget_summary view (BRD-compliant)
    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelopeId,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget available. Available: ${available}, Requested: ${amount}`,
      );
    }

    // Create RESERVE transaction (event-sourced)
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId: envelope.id,
      txType: BudgetTransactionType.RESERVE,
      txStatus: BudgetTransactionStatus.POSTED, // Immediate posting
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementId,
      amount,
      currency,
      idempotencyKey,
      description: `Budget reservation for agreement ${agreementId}`,
      createdBy: userId,
    });

    return transaction;
  }

  // Release reserved budget (create RELEASE transaction)
  async releaseBudget(
    tenantId: string,
    userId: string,
    agreementId: string,
    envelopeId: string,
    amount: number,
    currency: string = 'TRY',
  ): Promise<BudgetTransaction> {
    // Check idempotency
    const idempotencyKey = `RELEASE|AGREEMENT|${agreementId}|${envelopeId}`;
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      throw new ConflictException(
        'Budget release already exists for this agreement',
      );
    }

    // Create RELEASE transaction
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId,
      txType: BudgetTransactionType.RELEASE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementId,
      amount,
      currency,
      idempotencyKey,
      description: `Budget release for agreement ${agreementId}`,
      createdBy: userId,
    });

    return transaction;
  }

  // Get reserved amount for envelope (computed from transactions)
  async getReservedAmount(
    tenantId: string,
    envelopeId: string,
  ): Promise<number> {
    return this.budgetRepository.getReservedAmount(tenantId, envelopeId);
  }

  // Get transactions by envelope
  async getTransactionsByEnvelope(
    tenantId: string,
    envelopeId: string,
    txType?: BudgetTransactionType,
  ): Promise<BudgetTransaction[]> {
    return this.budgetRepository.findTransactionsByEnvelope(
      tenantId,
      envelopeId,
      txType,
    );
  }

  // Get transactions by source (e.g., agreement)
  async getTransactionsBySource(
    tenantId: string,
    sourceType: BudgetTransactionSourceType,
    sourceId: string,
  ): Promise<BudgetTransaction[]> {
    return this.budgetRepository.findTransactionsBySource(
      tenantId,
      sourceType,
      sourceId,
    );
  }

  /**
   * Reserve budget for an approved agreement
   * Creates RESERVE transaction with idempotency
   * Automatically finds the matching envelope by dimensions
   *
   * T-019 Faz 1 / ADR 0004 Karar 1: `agreementSpendType` is REQUIRED (not
   * optional) — the column has existed unused (`agreements.spend_type`) and
   * this is where it starts being honoured. NULL/undefined → 400 (no silent
   * default; a wrong default silently mis-attributes the reservation, see
   * ADR 0004 gerekçe). `BOTH` is accepted and treated like the pre-T-019
   * behaviour (goes to the UNSPLIT envelope, written as `spend_type = NULL`
   * on the transaction) — BRD has no evidence for how a BOTH cap splits
   * across on/off zarfları (docs/analysis/0008 §5.7 Q2), so no split is
   * invented here.
   */
  async reserveForAgreement(
    agreementId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    agreementSpendType?: 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH' | null,
    manager?: EntityManager,
  ): Promise<BudgetTransaction> {
    if (!agreementSpendType) {
      throw new BadRequestException(
        'Agreement spend_type (ON_INVOICE/OFF_INVOICE/BOTH) is required for budget reservation',
      );
    }
    const spendTypeColumn: BudgetSpendType | null =
      agreementSpendType === 'BOTH'
        ? null
        : (agreementSpendType as BudgetSpendType);

    // Check for existing RESERVE transaction for this agreement (true idempotency)
    // Idempotency key should be based on agreementId only, not envelope ID
    // This ensures that retrying with different envelope lookups doesn't create duplicate transactions
    const existingReserveTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.AGREEMENT,
        agreementId,
        manager,
      );

    const existingReserve = existingReserveTransactions.find(
      (tx) =>
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    if (existingReserve) {
      // Return existing transaction - true idempotency regardless of envelope lookup result
      return existingReserve;
    }

    // Find matching envelope by dimensions. T-019 Faz 1: BOTH (null column)
    // omits the spendType filter, same as pre-T-019 (§5.7 interim rule) —
    // no typed envelopes exist yet in Faz 1, so this is a no-op today.
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      undefined,
      spendTypeColumn ?? undefined,
    );

    if (!envelope) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channel}, period: ${periodMonth}`,
      );
    }

    // Check availability using view
    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelope.id,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget. Available: ${available}, Requested: ${amount}`,
      );
    }

    // Create RESERVE transaction with idempotency key based on agreement only
    // Note: envelope ID is not included in idempotency key to ensure true idempotency
    // even if envelope lookup returns different results on retry
    // (T-019: key format UNCHANGED — a single agreement never reserves
    // twice with two different spend types, unlike the plan-side flow, so
    // no bucket suffix is needed here — see budget.repository/T-030 note.)
    const idempotencyKey = `RESERVE|AGREEMENT|${agreementId}`;

    // Double-check idempotency (defensive check)
    const existingByIdempotency =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
        manager,
      );
    if (existingByIdempotency) {
      return existingByIdempotency;
    }

    // Create RESERVE transaction
    const transaction = await this.budgetRepository.createTransaction(
      {
        tenantId,
        envelopeId: envelope.id,
        txType: BudgetTransactionType.RESERVE,
        txStatus: BudgetTransactionStatus.POSTED,
        sourceType: BudgetTransactionSourceType.AGREEMENT,
        sourceId: agreementId,
        amount,
        currency: currency || 'TRY', // Use agreement currency, default to TRY if not provided
        idempotencyKey,
        spendType: spendTypeColumn,
        description: `Budget reservation for agreement ${agreementId}`,
        createdBy: userId,
      },
      manager,
    );

    return transaction;
  }

  /**
   * T-029: Reserve budget for a plan submitted for approval.
   * Creates a RESERVE transaction (BRD state machine: Pending Approval → RESERVE).
   * Idempotent per plan (any existing POSTED RESERVE for this plan is returned as-is).
   *
   * NOTE (pre-T-029 bug, fixed here): this method used to create a COMMIT
   * transaction regardless of plan state, which meant GET /envelopes/:id/reserved
   * (RESERVE-only) always read 0 for plan-driven reservations, and approval never
   * actually converted anything (submit and approve both silently no-op'd into
   * the same COMMIT). See commitReservedForPlan() for the Approved→COMMIT step.
   */
  async reserveForPlan(
    planId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    bucket: PlanBudgetBucket,
    manager?: EntityManager,
  ): Promise<BudgetTransaction> {
    // Find matching envelope by dimensions. T-034b: NOT manager-scoped —
    // envelope existence/dimension lookup is a plain read; only the WRITES
    // below (transactions) must land on the caller's transaction for
    // atomicity with the plan status write (see plan.service.ts#submit).
    // T-019 Faz 1: TOTAL bucket omits the spendType filter (byte-for-byte
    // pre-T-019 behaviour); ON/OFF pass it through (no-op today — no typed
    // envelopes exist yet, see findEnvelopeByDimensions §5.1).
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      undefined,
      bucket === 'TOTAL' ? undefined : (bucket as unknown as BudgetSpendType),
    );

    if (!envelope) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channel}, period: ${periodMonth}`,
      );
    }

    const existingTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.PLAN,
        planId,
        manager,
      );
    // Scoped to THIS envelope AND this bucket — a plan can (in principle)
    // span more than one envelope over its lifetime (T-019 kısıtı, same
    // caveat as BudgetReservationService#releaseNetReservation), and
    // (T-048 fix) two DIFFERENT buckets (ON_INVOICE/OFF_INVOICE) can now
    // legitimately share the SAME UNSPLIT envelope in Faz 1 — without the
    // bucket filter, the second reserveForPlan() call for the same plan
    // would see the first bucket's still-outstanding RESERVE and treat
    // itself as an idempotent no-op, silently never writing its own RESERVE
    // (docs/analysis/0008 §2.4 — the T-048 live bug).
    const envelopeReserves = existingTransactions.filter(
      (tx) =>
        tx.envelopeId === envelope.id &&
        this.matchesBucket(tx, bucket) &&
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    // T-033: idempotency must be NET-based (RESERVE+COMMIT-RELEASE), not
    // "does any POSTED RESERVE row exist" — this is an append-only ledger,
    // so a RESERVE row's txStatus stays POSTED forever even after it has
    // been fully offset by a RELEASE (reject()/PlanService#reject already
    // nets it out via BudgetReservationService#releaseNetReservation). Before
    // T-033 (Rejected→Draft), no code path ever called reserveForPlan twice
    // for the same plan after a release, so this distinction was latent;
    // T-033's return-to-draft→resubmit loop makes it reachable — without
    // this fix, a resubmit after reject would silently find the OLD,
    // already-released RESERVE row and skip creating a real new one, leaving
    // the plan's eventual COMMIT converted from a stale reservation and the
    // envelope under-encumbered.
    const netOutstanding = existingTransactions
      .filter(
        (tx) => tx.envelopeId === envelope.id && this.matchesBucket(tx, bucket),
      )
      .reduce((net, tx) => {
        const amt = Number(tx.amount);
        if (
          tx.txType === BudgetTransactionType.RESERVE ||
          tx.txType === BudgetTransactionType.COMMIT
        ) {
          return net + amt;
        }
        if (tx.txType === BudgetTransactionType.RELEASE) {
          return net - amt;
        }
        return net;
      }, 0);

    if (netOutstanding > 0 && envelopeReserves.length > 0) {
      // Genuinely still outstanding (no intervening release) — idempotent
      // no-op, return the most recent RESERVE (findTransactionsBySource
      // orders by createdAt DESC).
      return envelopeReserves[0];
    }

    // Check availability using view (accounts for existing RESERVE+COMMIT-RELEASE)
    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelope.id,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget. Available: ${available}, Required: ${amount}`,
      );
    }

    // T-033: generation-aware idempotency key. idempotencyKey is immutable
    // once written (unique on tenantId+idempotencyKey), so a second
    // reservation cycle for the same plan+envelope (post return-to-draft)
    // must use a distinct key from the first cycle's, or this insert would
    // violate the unique index.
    // T-019/T-048: TOTAL bucket keeps the EXACT pre-existing key format
    // (no suffix) — plan.service.ts#submit's live rows/keys must stay valid.
    // ON/OFF buckets get a new `|<BUCKET>` suffix so they occupy a disjoint
    // key space from TOTAL and from each other.
    const bucketSuffix = bucket === 'TOTAL' ? '' : `|${bucket}`;
    const idempotencyKey =
      envelopeReserves.length === 0
        ? `RESERVE|PLAN|${planId}|${envelope.id}${bucketSuffix}`
        : `RESERVE|PLAN|${planId}|${envelope.id}${bucketSuffix}|GEN${envelopeReserves.length + 1}`;

    const transaction = await this.budgetRepository.createTransaction(
      {
        tenantId,
        envelopeId: envelope.id,
        txType: BudgetTransactionType.RESERVE,
        txStatus: BudgetTransactionStatus.POSTED,
        sourceType: BudgetTransactionSourceType.PLAN,
        sourceId: planId,
        amount,
        currency: currency || 'TRY',
        idempotencyKey,
        spendType:
          bucket === 'TOTAL' ? null : (bucket as unknown as BudgetSpendType),
        description: `Budget reservation for plan ${planId} (submitted for approval)`,
        createdBy: userId,
      },
      manager,
    );

    return transaction;
  }

  /**
   * T-029: Convert a plan's outstanding RESERVE into a COMMIT on approval
   * (BRD state machine: Approved → COMMIT, budget actually consumed/earmarked).
   *
   * If an outstanding POSTED RESERVE exists for the plan, this releases it
   * (idempotency key suffixed `|CONVERT`, distinct from the plain reject/cancel
   * release key so both can coexist in the audit trail without key collision)
   * and creates a COMMIT transaction of the same amount — net encumbrance on
   * the envelope is unchanged (see v_budget_summary: reserved_amount now sums
   * RESERVE+COMMIT-RELEASE, migration 1789000000000), it merely moves the plan
   * from the "reserved" bucket to the "committed" bucket.
   *
   * Idempotent: if a COMMIT already exists for this plan, it is returned as-is
   * (no double release/commit on repeated approve calls).
   *
   * Falls back to a fresh direct COMMIT (legacy behaviour, availability
   * re-checked) if no prior RESERVE exists — covers plans approved without
   * having gone through the reserving submit path.
   */
  async commitReservedForPlan(
    planId: string,
    amount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    bucket: PlanBudgetBucket,
    manager?: EntityManager,
  ): Promise<BudgetTransaction> {
    const existingTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.PLAN,
        planId,
        manager,
      );

    // T-048 (mirror fix): same kova-farkındalı gap as reserveForPlan — a
    // plan with two RESERVE buckets (ON_INVOICE/OFF_INVOICE, same UNSPLIT
    // envelope in Faz 1) must COMMIT each bucket independently. The old
    // "any POSTED COMMIT exists → return it" short-circuit meant the SECOND
    // commitReservedForPlan() call (e.g. OFF_INVOICE) found the FIRST
    // bucket's COMMIT (ON_INVOICE) and no-op'd — approve() would then leave
    // the off-invoice bucket stuck in RESERVE forever (never COMMIT'd, never
    // RELEASE'd).
    const existingCommit = existingTransactions.find(
      (tx) =>
        this.matchesBucket(tx, bucket) &&
        tx.txType === BudgetTransactionType.COMMIT &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );
    if (existingCommit) {
      return existingCommit;
    }

    const outstandingReserve = existingTransactions.find(
      (tx) =>
        this.matchesBucket(tx, bucket) &&
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    // T-019/T-048: TOTAL bucket keeps the pre-existing (unsuffixed) key
    // format; ON/OFF get a disjoint `|<BUCKET>` suffix — see reserveForPlan.
    const bucketSuffix = bucket === 'TOTAL' ? '' : `|${bucket}`;
    const spendTypeColumn =
      bucket === 'TOTAL' ? null : (bucket as unknown as BudgetSpendType);

    if (outstandingReserve) {
      const envelopeId = outstandingReserve.envelopeId;
      const commitAmount = Number(outstandingReserve.amount);

      // Release the RESERVE as part of the conversion (idempotent).
      const releaseKey = `RELEASE|PLAN|${planId}|${envelopeId}|CONVERT${bucketSuffix}`;
      const existingConvertRelease =
        await this.budgetRepository.findTransactionByIdempotencyKey(
          tenantId,
          releaseKey,
          manager,
        );
      if (!existingConvertRelease) {
        await this.budgetRepository.createTransaction(
          {
            tenantId,
            envelopeId,
            txType: BudgetTransactionType.RELEASE,
            txStatus: BudgetTransactionStatus.POSTED,
            sourceType: BudgetTransactionSourceType.PLAN,
            sourceId: planId,
            amount: commitAmount,
            currency: outstandingReserve.currency,
            idempotencyKey: releaseKey,
            spendType: spendTypeColumn,
            description: `Release RESERVE (converted to COMMIT on approval) for plan ${planId}`,
            createdBy: userId,
          },
          manager,
        );
      }

      const commitKey = `COMMIT|PLAN|${planId}|${envelopeId}${bucketSuffix}`;
      return this.budgetRepository.createTransaction(
        {
          tenantId,
          envelopeId,
          txType: BudgetTransactionType.COMMIT,
          txStatus: BudgetTransactionStatus.POSTED,
          sourceType: BudgetTransactionSourceType.PLAN,
          sourceId: planId,
          amount: commitAmount,
          currency: outstandingReserve.currency,
          idempotencyKey: commitKey,
          spendType: spendTypeColumn,
          description: `Budget commit for plan ${planId} (converted from RESERVE on approval)`,
          createdBy: userId,
        },
        manager,
      );
    }

    // Fallback: no prior RESERVE for this bucket — commit directly (legacy /
    // plan approved without submit-for-approval reservation). Availability
    // re-checked since this is a fresh encumbrance, not a bucket transfer.
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      undefined,
      bucket === 'TOTAL' ? undefined : (bucket as unknown as BudgetSpendType),
    );

    if (!envelope) {
      throw new BadRequestException(
        `No active budget envelope found for channel: ${channel}, period: ${periodMonth}`,
      );
    }

    const { available, sufficient } =
      await this.budgetRepository.checkBudgetAvailability(
        envelope.id,
        tenantId,
        amount,
      );

    if (!sufficient) {
      throw new BadRequestException(
        `Insufficient budget. Available: ${available}, Required: ${amount}`,
      );
    }

    const commitKey = `COMMIT|PLAN|${planId}|${envelope.id}${bucketSuffix}`;
    return this.budgetRepository.createTransaction(
      {
        tenantId,
        envelopeId: envelope.id,
        txType: BudgetTransactionType.COMMIT,
        txStatus: BudgetTransactionStatus.POSTED,
        sourceType: BudgetTransactionSourceType.PLAN,
        sourceId: planId,
        amount,
        currency: currency || 'TRY',
        idempotencyKey: commitKey,
        spendType: spendTypeColumn,
        description: `Budget commit for plan ${planId}`,
        createdBy: userId,
      },
      manager,
    );
  }

  /**
   * T-019 Faz 1 / T-048 (cross-path fix): approve a plan REGARDLESS of which
   * bucket(s) it was reserved under. There are two canonical submit routes
   * (`plan.service.ts#submit` → 'TOTAL' bucket; `approval-workflow.service.ts
   * #submitForApproval` → 'ON_INVOICE' + 'OFF_INVOICE' buckets) and — as of
   * this task — TWO canonical approve routes too (`plan.service.ts#approve`,
   * `approval-workflow.service.ts#approvePlan`/reviewPlan). Any plan may be
   * submitted via one route and approved via the OTHER (proven live by the
   * role-journey e2e's golden path: A8 submits via submit-for-approval,
   * A12 approves via the plain PlanController#approve). A single
   * bucket-blind `commitReservedForPlan(bucket)` call on the approve side
   * would either (a) miss buckets it doesn't know to ask for — leaving them
   * stuck in RESERVE forever — or worse (b) not find ITS bucket, fall
   * through to the "no prior RESERVE" fallback, and write a FRESH direct
   * COMMIT on top of the still-outstanding RESERVE(s) from the other route
   * — a double encumbrance of the exact "6 çift-sayım" class this session
   * has repeatedly hit. This method discovers every bucket that actually
   * has an outstanding POSTED RESERVE for the plan and commits each one
   * exactly once (delegating the per-bucket net/idempotency logic to
   * `commitReservedForPlan`, unchanged). If the plan has NEVER been through
   * a reserving submit (legacy direct-approve), falls back to a single
   * fresh 'TOTAL' COMMIT of `fallbackAmount` — the pre-T-019 behaviour.
   */
  async commitAllReservedForPlan(
    planId: string,
    fallbackAmount: number,
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<BudgetTransaction[]> {
    const existingTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.PLAN,
        planId,
        manager,
      );

    const bucketKeys = new Set<PlanBudgetBucket>();
    for (const tx of existingTransactions) {
      if (
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED
      ) {
        bucketKeys.add((tx.spendType ?? 'TOTAL') as PlanBudgetBucket);
      }
    }

    if (bucketKeys.size === 0) {
      // Legacy: no reserving submit ever happened for this plan.
      return [
        await this.commitReservedForPlan(
          planId,
          fallbackAmount,
          channel,
          periodMonth,
          currency,
          tenantId,
          userId,
          'TOTAL',
          manager,
        ),
      ];
    }

    const results: BudgetTransaction[] = [];
    for (const bucket of bucketKeys) {
      const bucketReserve = existingTransactions.find(
        (tx) =>
          this.matchesBucket(tx, bucket) &&
          tx.txType === BudgetTransactionType.RESERVE &&
          tx.txStatus === BudgetTransactionStatus.POSTED,
      );
      const bucketAmount = bucketReserve
        ? Number(bucketReserve.amount)
        : fallbackAmount;
      results.push(
        await this.commitReservedForPlan(
          planId,
          bucketAmount,
          channel,
          periodMonth,
          currency,
          tenantId,
          userId,
          bucket,
          manager,
        ),
      );
    }
    return results;
  }

  /**
   * Release budget spend for a reversed agreement transaction.
   *
   * Creates a RELEASE budget transaction scoped to the original agreementTransaction.
   * Idempotency key: 'REVERSAL|AGREEMENT|{transactionId}'
   *
   * Uses RELEASE type (no new enum value needed) to unwind spend from the envelope.
   * Callers must supply the envelopeId from the original ledger entry's budgetEnvelopeId.
   */
  async reverseForTransaction(
    agreementTransactionId: string,
    envelopeId: string,
    amount: number,
    currency: string,
    tenantId: string,
    userId: string,
  ): Promise<BudgetTransaction> {
    const idempotencyKey = `REVERSAL|AGREEMENT|${agreementTransactionId}`;

    // Idempotency check
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      return existing;
    }

    return this.budgetRepository.createTransaction({
      tenantId,
      envelopeId,
      txType: BudgetTransactionType.RELEASE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementTransactionId,
      amount: Math.abs(amount),
      currency: currency || 'TRY',
      idempotencyKey,
      description: `Budget release for reversed agreement transaction ${agreementTransactionId}`,
      createdBy: userId,
    });
  }

  /**
   * @deprecated T-030 — use BudgetReservationService.releaseAgreementReservation
   * instead. This method releases a caller-supplied `amount` against a
   * caller-supplied `envelopeId`, which is unsafe: callers historically
   * passed `agreement.capTotalAmount` (drifts from actual net reservation
   * if the cap was edited post-approval) and only the first RESERVE's
   * envelope (breaks for multi-envelope agreements, T-019). Kept only for
   * backward compatibility with any external callers; do not use in new code.
   */
  async releaseForAgreement(
    agreementId: string,
    envelopeId: string,
    amount: number,
    currency: string,
    tenantId: string,
    userId: string,
  ): Promise<BudgetTransaction> {
    const idempotencyKey = `RELEASE|AGREEMENT|${agreementId}|${envelopeId}`;

    // Check if already released (idempotency)
    const existing =
      await this.budgetRepository.findTransactionByIdempotencyKey(
        tenantId,
        idempotencyKey,
      );
    if (existing) {
      return existing;
    }

    // Create RELEASE transaction
    const transaction = await this.budgetRepository.createTransaction({
      tenantId,
      envelopeId,
      txType: BudgetTransactionType.RELEASE,
      txStatus: BudgetTransactionStatus.POSTED,
      sourceType: BudgetTransactionSourceType.AGREEMENT,
      sourceId: agreementId,
      amount,
      currency: currency || 'TRY', // Use agreement currency, default to TRY if not provided
      idempotencyKey,
      description: `Budget release for cancelled agreement ${agreementId}`,
      createdBy: userId,
    });

    return transaction;
  }

  /**
   * T-029 (fixed by code-review, 2026-07-27): Release ALL outstanding budget
   * encumbrances for a plan — both RESERVE (Pending Approval rejected/
   * cancelled before approval) and COMMIT (Approved plan reverted/deleted).
   *
   * BUG FIXED (was): this method used to scan for POSTED RESERVE/COMMIT rows
   * by raw txType/txStatus and release each one found, with a per-type
   * idempotency key (`...|RESERVE`, `...|COMMIT`). That double-counted: when
   * a plan goes RESERVE → (approve) COMMIT, `commitReservedForPlan` already
   * releases the RESERVE as part of the conversion (key `...|CONVERT`) and
   * writes a COMMIT of the same amount — the original RESERVE row stays
   * POSTED forever (event-sourced ledger, rows are never mutated). The old
   * scan found that still-POSTED RESERVE again (under a *different* key,
   * `...|RESERVE`, so idempotency did not catch it) AND the COMMIT, releasing
   * both — net went negative (budget "refunded" twice). Real trigger: approve
   * succeeds, then the post-approve audit write fails and the compensation
   * path in `PlanService#approve` calls this method.
   *
   * FIX: delegate to `BudgetReservationService#releasePlanReservation`, which
   * computes the TRUE net (ΣRESERVE + ΣCOMMIT − ΣRELEASE, all prior RELEASEs
   * including CONVERT ones) per envelope and writes at most one RELEASE for
   * the residual — same net-based pattern already proven correct for
   * agreements (T-030). See that method's JSDoc for the full rationale;
   * kept as a single shared engine so this double-count bug class (already
   * seen once for agreements, F1/0003, and now for plans) cannot resurface
   * for a third source type without also being fixed here.
   */
  async releaseForPlan(
    planId: string,
    tenantId: string,
    userId?: string,
    reason: PlanReservationReleaseReason = 'REJECT',
    manager?: EntityManager,
  ): Promise<void> {
    await this.budgetReservationService.releasePlanReservation(
      planId,
      tenantId,
      userId,
      reason,
      manager,
    );
  }

  /**
   * Find envelope by dimensions (exposed for use by other services)
   */
  async findEnvelopeByDimensions(
    tenantId: string,
    channel: string,
    periodMonth: string,
    category?: string,
  ): Promise<BudgetEnvelope | null> {
    return this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      category,
    );
  }

  /**
   * Get budget status for channel and category
   * Returns total allocation, available amount, and planned amount
   */
  async getBudgetStatus(
    tenantId: string,
    channel: string,
    categoryId?: string,
    periodMonth?: string,
  ): Promise<{
    totalAllocation: number;
    available: number;
    reserved: number;
    consumed: number;
    planned: number; // For current STA being created
    status: UtilizationStatus;
  }> {
    // Get current month if not provided
    if (!periodMonth) {
      const now = new Date();
      periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Fetch thresholds once (config-driven, tenant-scoped)
    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    // Find envelope by dimensions
    const envelope = await this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      categoryId,
    );

    if (!envelope) {
      return {
        totalAllocation: 0,
        available: 0,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: UtilizationStatus.GREEN,
      };
    }

    // Get budget summary
    const summary = await this.budgetRepository.getBudgetSummary(
      envelope.id,
      tenantId,
    );

    if (!summary) {
      return {
        totalAllocation: envelope.allocatedAmount,
        available: envelope.allocatedAmount,
        reserved: 0,
        consumed: 0,
        planned: 0,
        status: UtilizationStatus.GREEN,
      };
    }

    // Determine status based on usage (config-driven thresholds)
    const usagePercent =
      summary.allocatedAmount > 0
        ? ((summary.reservedAmount + summary.consumedAmount) /
            summary.allocatedAmount) *
          100
        : 0;

    return {
      totalAllocation: summary.allocatedAmount,
      available: summary.availableAmount,
      reserved: summary.reservedAmount,
      consumed: summary.consumedAmount,
      planned: 0, // Will be set by frontend for current STA
      status: this.budgetThresholdService.toStatus(usagePercent, thresholds),
    };
  }
}
