import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BudgetRepository } from './budget.repository';
import { BudgetSummaryView } from '../../../database/entities/budget-summary.view-entity';
// T-057: imported for use within this class AND re-exported so mode-service
// callers (`plan.service.ts`, `agreement-transaction.service.ts`) derive
// "is this dimension split?" from the SAME guard-error shape without
// reaching past `BudgetService` into `BudgetRepository` directly (module
// boundary discipline, §5.7).
import { isSplitDimensionGuardError } from './budget.repository';
export { isSplitDimensionGuardError } from './budget.repository';
import { BudgetThresholdService } from './budget-threshold.service';
import {
  BudgetReservationService,
  PlanReservationReleaseReason,
} from './budget-reservation.service';
import { BudgetTierNotificationService } from './budget-tier-notification.service';
import { toPeriodMonthUtc } from '../../../common/date/period-month';
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

/** T-019b (Faz 2, §4): one re-homed (source, envelope) bucket's outcome. */
export interface SplitEnvelopeRehomedBucket {
  sourceType: BudgetTransactionSourceType;
  sourceId: string;
  amount: number;
  txType: BudgetTransactionType.RESERVE | BudgetTransactionType.COMMIT;
}

export interface SplitEnvelopeResult {
  onEnvelope: BudgetEnvelope;
  offEnvelope: BudgetEnvelope;
  rehomed: SplitEnvelopeRehomedBucket[];
}

@Injectable()
export class BudgetService {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly budgetThresholdService: BudgetThresholdService,
    private readonly budgetReservationService: BudgetReservationService,
    // T-318 (Z57 §3): every budget_transaction write funnels through
    // `writeTransaction` below, which evaluates a WARNING/FINANCE_REVIEW
    // tier transition after each write (§7: `budgetRepository
    // .createTransaction` has exactly two callers in the whole codebase —
    // this file and `BudgetReservationService`; both are wired).
    private readonly budgetTierNotificationService: BudgetTierNotificationService,
    // T-019b: split() needs its own QueryRunner transaction (envelope
    // FOR UPDATE lock + OFF-twin creation + re-home writes must all
    // commit/rollback atomically) — same pattern as
    // ApprovalWorkflowService/PlanService (docs/analysis/0005 §4).
    private readonly dataSource: DataSource,
  ) {}

  /**
   * T-318 (Z57 §3): single funnel for every `budget_transactions` write in
   * this service (RESERVE/COMMIT/RELEASE) — replaces the bare
   * `budgetRepository.createTransaction` call everywhere in this file so a
   * tier-transition check (`K-2.2.7a` WARNING %80 / FINANCE_REVIEW %90) is
   * never missed on a sibling write path (`§7.1`: "kardeş yol etkilenmiyor
   * iddiası ölçülmeden yazılamaz" — the two other call-site families,
   * `BudgetReservationService#releaseNetReservation`, are wired the same
   * way, see that file).
   *
   * `K-2.2.7c`: thresholds apply only to the PLAN/COMMITMENT side — this is
   * exactly that side (`budget_transactions`, not `ledger_entries`), so
   * hooking here (and nowhere in the ledger-writing modules) is the correct
   * boundary, not an oversight.
   *
   * `T-321` (`Z62 §1` `2c`): `BLOCKED` (%100) is deliberately NOT gated
   * inside this funnel — `evaluateAndNotify` here always runs AFTER the
   * write (`createTransaction` above already executed), so it can only
   * NOTIFY a post-hoc BLOCKED crossing, never PREVENT it. The actual gate
   * (`BudgetTierNotificationService#assertNotBlocked`) is called BEFORE
   * `writeTransaction` at the three call sites that create genuinely NEW
   * encumbrance (`reserveForAgreement`, `reserveForPlan`,
   * `commitReservedForPlan`'s no-prior-RESERVE fallback) — NOT here,
   * because this funnel is also used by the RESERVE→COMMIT conversion
   * (net encumbrance unchanged) and by RELEASE (reduces exposure), neither
   * of which is a "new entry" `K-2.2.7a`'s BLOCKED kademesi is meant to
   * reject.
   */
  private async writeTransaction(
    data: Partial<BudgetTransaction>,
    manager?: EntityManager,
  ): Promise<BudgetTransaction> {
    const transaction = await this.budgetRepository.createTransaction(
      data,
      manager,
    );
    await this.budgetTierNotificationService.evaluateAndNotify(
      data.tenantId as string,
      data.envelopeId as string,
      manager,
    );
    return transaction;
  }

  /** T-019 Faz 1: does `tx` belong to the given plan-budget bucket? */
  private matchesBucket(
    tx: Pick<BudgetTransaction, 'spendType'>,
    bucket: PlanBudgetBucket,
  ): boolean {
    return bucket === 'TOTAL' ? !tx.spendType : tx.spendType === bucket;
  }

  /**
   * T-056 F1 (docs/analysis/0009 §2.3) + Team Lead review (single-derivation
   * follow-up): net (RESERVE+COMMIT-RELEASE) for a given bucket within an
   * already-fetched transaction list — the ONE place this formula is
   * implemented (`reserveForPlan`'s idempotency check (T-033),
   * `commitAllReservedForPlan`'s bucket discovery, and
   * `commitReservedForPlan`'s outstanding-reserve selection all delegate
   * here now; none re-implements the reduce).
   *
   * A RESERVE row's txStatus stays POSTED forever in this append-only
   * ledger even after being fully offset by a RELEASE, so "does a POSTED
   * RESERVE row exist for this bucket" is NOT the same question as "is
   * this bucket still outstanding" — every call site above asks the
   * latter and must use this, not raw row presence.
   *
   * `envelopeId` (optional) narrows the net to a single envelope — pass it
   * when the caller already has a specific envelope resolved and needs
   * "outstanding for THIS bucket in THIS envelope" (`reserveForPlan`: a
   * plan can in principle span more than one envelope over its lifetime,
   * T-019 kısıtı). Omit it for "outstanding for THIS bucket across
   * whichever envelope(s) the plan touched" (`commitAllReservedForPlan` /
   * `commitReservedForPlan`: bucket-wide by design — a plan's bucket is
   * expected to resolve to one envelope in practice, but these two callers
   * don't have (and don't need) a pre-resolved envelope to scope by).
   */
  private computeBucketNet(
    transactions: BudgetTransaction[],
    bucket: PlanBudgetBucket,
    envelopeId?: string,
  ): number {
    return transactions
      .filter(
        (tx) =>
          this.matchesBucket(tx, bucket) &&
          (envelopeId === undefined || tx.envelopeId === envelopeId),
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
  }

  async createEnvelope(
    tenantId: string,
    createDto: CreateBudgetEnvelopeDto,
    manager?: EntityManager,
  ): Promise<BudgetEnvelope | (BudgetEnvelope & { availableAmount: number })> {
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
        // `availableAmount` KALDIRILDI (`INV-B-009` / `Z47`) — kolon artık
        // yok, kanonik kaynak `v_budget_summary` (sorgu anında türetilir).
        consumedAmount: 0,
        status: createDto.status || BudgetEnvelopeStatus.DRAFT,
      },
      manager,
    );

    // ⛔ `Z47` review 🟡-2 — ÇIPLAK ENTITY DÖNÜŞÜNÜN ÜÇÜNCÜ KAPISI.
    // `available_amount` kolonu öldü (`Z47`), ama `POST /budget/envelopes`'in
    // yanıtı hâlâ ham entity'ydi ⇒ alan JSON'dan SESSİZCE kayboldu; frontend
    // `budget.types.ts` onu `availableAmount: number` diye VAAT EDİYOR.
    // Bugün çökmüyordu çünkü `useCreateBudgetEnvelope` yalnız
    // `invalidateQueries` yapıyor, gövdeyi RENDER ETMİYOR — yani kırığı
    // VERİNİN KULLANILMAMASI örtüyordu (`§2.7`).
    // ⇒ `findEnvelopeById`/`findAllEnvelopes` ile AYNI zenginleştirme.
    // ⚠️ `manager` verildiyse (dış transaction) view HENÜZ commit görmemiş
    // olabilir; o yolda türetim YAPILMAZ ve alan da UYDURULMAZ — çağıran
    // zaten transaction içinde, okumayı kendi yapar.
    if (manager) {
      return envelope;
    }
    const summary = await this.budgetRepository.getBudgetSummary(
      envelope.id,
      tenantId,
    );
    if (!summary) {
      throw new Error(
        `INV-B-009: v_budget_summary has no row for freshly created envelope ` +
          `${envelope.id} (${envelope.code}) — refusing to return a response ` +
          `without the canonical available amount.`,
      );
    }
    return { ...envelope, availableAmount: summary.availableAmount };
  }

  /**
   * INV-B-009 / Z47 — `GET /budget/envelopes` (`findAllEnvelopes`) served the
   * bare entity, which is where `available_amount` (the now-dropped stale
   * snapshot column) reached `collmind.frontend`'s envelope list/dashboard
   * components. Now that the column is gone, `availableAmount` is attached
   * here from `v_budget_summary` (canonical, ledger-derived) — the JSON
   * field name is preserved so no frontend change is required, but its
   * VALUE is now always live.
   *
   * Every envelope has exactly one `v_budget_summary` row (the view is
   * built directly `FROM main.budget_envelopes`, one row per envelope,
   * COALESCEd subquery sums — measured: `pg_get_viewdef`). A missing
   * summary row for an envelope that was just read is a data-integrity
   * contradiction, not an absent-value case — §2.5 forbids silently
   * defaulting it to 0, so it throws.
   */
  async findAllEnvelopes(
    tenantId: string,
  ): Promise<Array<BudgetEnvelope & { availableAmount: number }>> {
    const [envelopes, summaries] = await Promise.all([
      this.budgetRepository.findAllEnvelopes(tenantId),
      this.budgetRepository.getAllBudgetSummaries(tenantId),
    ]);
    const summaryByEnvelopeId = new Map<string, BudgetSummaryView>(
      summaries.map((s) => [s.envelopeId, s]),
    );
    return envelopes.map((envelope) => {
      const summary = summaryByEnvelopeId.get(envelope.id);
      if (!summary) {
        throw new Error(
          `INV-B-009: v_budget_summary has no row for envelope ${envelope.id} ` +
            `(${envelope.code}) — cannot compute available amount without the ` +
            `canonical view.`,
        );
      }
      return {
        ...envelope,
        availableAmount: summary.availableAmount,
      };
    });
  }

  async findEnvelopeById(
    tenantId: string,
    id: string,
  ): Promise<BudgetEnvelope & { availableAmount: number }> {
    const envelope = await this.budgetRepository.findEnvelopeById(tenantId, id);
    if (!envelope) {
      throw new NotFoundException(`Budget envelope with ID ${id} not found`);
    }
    const summary = await this.budgetRepository.getBudgetSummary(id, tenantId);
    if (!summary) {
      throw new Error(
        `INV-B-009: v_budget_summary has no row for envelope ${id} ` +
          `(${envelope.code}) — cannot compute available amount without the ` +
          `canonical view.`,
      );
    }
    return { ...envelope, availableAmount: summary.availableAmount };
  }

  // `reserveBudget` (event-sourced, manuel/serbest-metin `agreementId`)
  // KALDIRILDI (T-289, `Z38`, `B3` kaza-dalgası `K6(c)`, 2026-08-26).
  // Kanonik yol: `reserveForAgreement` (anlaşma onayı) ve
  // `reserveTypedForPlan` (plan onayı) — bkz. kaldırılan metodun üstündeki
  // `budget.controller.ts` notu.

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
    const transaction = await this.writeTransaction({
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

    // T-019b (ADR 0004 Karar 3, §5.7): a BOTH (or, pre-guard above, NULL)
    // agreement cannot reserve against a SPLIT dimension — the cap's on/off
    // split is unknown (BRD has no evidence for how BOTH divides), so
    // silently parking it in one arbitrary twin would be exactly the
    // mis-attribution class this session has repeatedly hit. UNSPLIT
    // dimensions are unaffected (pre-existing behaviour, §5.7 interim rule).
    if (spendTypeColumn === null) {
      const [onTyped, offTyped] = await Promise.all([
        this.budgetRepository.findEnvelopeByDimensionsStrict(
          tenantId,
          channel,
          periodMonth,
          undefined,
          BudgetSpendType.ON_INVOICE,
        ),
        this.budgetRepository.findEnvelopeByDimensionsStrict(
          tenantId,
          channel,
          periodMonth,
          undefined,
          BudgetSpendType.OFF_INVOICE,
        ),
      ]);
      if (onTyped || offTyped) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED',
          message:
            'This budget dimension has been split into ON_INVOICE/OFF_INVOICE envelopes; agreement.spend_type must be ON_INVOICE or OFF_INVOICE (BOTH/NULL is not allowed here).',
        });
      }
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

    // `T-321` (`Z62 §1` `2c`): `K-2.2.7a` `BLOCKED` — yeni RESERVE girişi,
    // policy.blockPct'ten okunan eşik aşılırsa yazımdan ÖNCE reddedilir.
    await this.budgetTierNotificationService.assertNotBlocked(
      tenantId,
      envelope.id,
      amount,
      manager,
    );

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
    const transaction = await this.writeTransaction(
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
    // Single-derivation follow-up (Team Lead review): was an inline
    // duplicate of computeBucketNet's reduce — now delegates, scoped to
    // THIS envelope via the optional third parameter (see that method's
    // doc comment for the envelope-scoped vs. bucket-wide distinction).
    const netOutstanding = this.computeBucketNet(
      existingTransactions,
      bucket,
      envelope.id,
    );

    if (netOutstanding > 0 && envelopeReserves.length > 0) {
      // Genuinely still outstanding (no intervening release) — idempotent
      // no-op, return the most recent RESERVE (findTransactionsBySource
      // orders by createdAt DESC).
      return envelopeReserves[0];
    }

    // `T-321` (`Z62 §1` `2c`): `K-2.2.7a` `BLOCKED` — yeni RESERVE girişi.
    await this.budgetTierNotificationService.assertNotBlocked(
      tenantId,
      envelope.id,
      amount,
      manager,
    );

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

    const transaction = await this.writeTransaction(
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

    // T-056 F1: a raw POSTED RESERVE row for this bucket is NOT sufficient —
    // it may already have been fully offset by a RELEASE (e.g. reject()),
    // and this ledger never flips a RESERVE row's txStatus off POSTED (see
    // computeBucketNet's doc comment). Only treat the bucket as genuinely
    // outstanding (and eligible for CONVERT-RELEASE + COMMIT) when its net
    // is still positive; the row picked below (most-recent POSTED RESERVE,
    // findTransactionsBySource orders createdAt DESC) is then guaranteed to
    // be the live/unreleased one in every reachable generation sequence
    // (T-033/T-053 GEN-suffix discipline), so its raw `.amount` still equals
    // the bucket's net.
    const bucketNet = this.computeBucketNet(existingTransactions, bucket);
    const outstandingReserve =
      bucketNet > 0
        ? existingTransactions.find(
            (tx) =>
              this.matchesBucket(tx, bucket) &&
              tx.txType === BudgetTransactionType.RESERVE &&
              tx.txStatus === BudgetTransactionStatus.POSTED,
          )
        : undefined;

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
        await this.writeTransaction(
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
      return this.writeTransaction(
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

    // `T-321` (`Z62 §1` `2c`): `K-2.2.7a` `BLOCKED` — legacy fallback dalı
    // önceki bir RESERVE olmadan doğrudan COMMIT yazar, yani bu GENUINELY
    // yeni bir encumbrance'dır (RESERVE→COMMIT dönüşümünden farklı olarak,
    // bkz. dosya başı doc). Gate burada da geçerli.
    await this.budgetTierNotificationService.assertNotBlocked(
      tenantId,
      envelope.id,
      amount,
      manager,
    );

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
    return this.writeTransaction(
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
   * ⚠️ **`F12` (`T-344`, `Z73 §1`): `#submitForApproval` ARTIK YOK** — tek
   * submit yolu `plan.service.ts#submit` ve o da tipli kovalara yazıyor.
   * Aşağıdaki gerekçe **yine de geçerli**, çünkü ESKİ planlar hâlâ `TOTAL`
   * kovada RESERVE satırları taşıyor (`ADR 0005` geriye-uyum kısıtı) ve
   * approve tarafı iki kanonik rotalı KALDI.
   *
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
   *
   * T-057 F4 (ADR 0004 Karar 5, docs/analysis/0008 §4 "Faz 2 tuzağı"): the
   * legacy "never reserved" fallback used to call the 'TOTAL' bucket
   * unconditionally, which resolves its envelope via an UNQUALIFIED
   * `findEnvelopeByDimensions` (see `commitReservedForPlan`'s own "no prior
   * RESERVE" branch) — one of the tipsiz call sites this task closes. Split
   * detection is derived from THAT SAME call's own guard error (no second/
   * independent query, T-056 adım 6 pattern); when it fires, this legacy
   * path commits ON_INVOICE/OFF_INVOICE INDEPENDENTLY using `spendBreakdown`
   * — REAL evidence from the caller's own plan (`plan.onInvoiceSpend`/
   * `offInvoiceSpend`, adım 4's recalc columns), never a fabricated ratio of
   * `fallbackAmount`. Both current callers (`plan.service.ts#approve`,
   * `approval-workflow.service.ts#approvePlan`) already hold the full
   * `Plan` entity at their call site, so this costs no extra query. If no
   * breakdown is supplied (or it is entirely zero) the split-dimension
   * legacy case is rejected rather than guessing.
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
    spendBreakdown?: { onInvoice: number; offInvoice: number },
  ): Promise<BudgetTransaction[]> {
    const existingTransactions =
      await this.budgetRepository.findTransactionsBySource(
        tenantId,
        BudgetTransactionSourceType.PLAN,
        planId,
        manager,
      );

    // T-056 F1 (docs/analysis/0009 §2.3): raw-row candidacy first (which
    // buckets EVER had a POSTED RESERVE for this plan), then narrowed to
    // buckets that are still genuinely outstanding (net > 0 —
    // computeBucketNet, same RESERVE+COMMIT-RELEASE formula as
    // reserveForPlan's T-033 idempotency check). Without the net filter, a
    // bucket that was fully released (e.g. TOTAL-bucket submit → reject →
    // return-to-draft → resubmit via the OTHER, typed ON/OFF route) is
    // rediscovered here purely because its RESERVE row's txStatus never
    // flips off POSTED in this append-only ledger — producing a phantom
    // CONVERT-RELEASE + COMMIT for a bucket that already nets to zero (a
    // plan carrying a stale generation's COMMIT it never actually owed).
    const candidateBucketKeys = new Set<PlanBudgetBucket>();
    for (const tx of existingTransactions) {
      if (
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED
      ) {
        candidateBucketKeys.add((tx.spendType ?? 'TOTAL') as PlanBudgetBucket);
      }
    }
    const bucketKeys = new Set<PlanBudgetBucket>();
    for (const bucket of candidateBucketKeys) {
      if (this.computeBucketNet(existingTransactions, bucket) > 0) {
        bucketKeys.add(bucket);
      }
    }

    if (candidateBucketKeys.size === 0) {
      // Legacy: no reserving submit ever happened for this plan. (T-056 F1:
      // this check stays on the RAW candidate set, not the net-filtered one
      // — "never reserved" and "reserved, but every bucket now nets to
      // zero" are different states; only the former is the pre-T-019
      // legacy-direct-approve case this fallback exists for. The latter
      // should be structurally unreachable for a plan actually reaching
      // approve() — see the loop below, which simply commits nothing for
      // it rather than fabricating a fresh TOTAL commit.)
      try {
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
      } catch (err) {
        if (!isSplitDimensionGuardError(err)) {
          throw err;
        }
        // T-057 F4: the dimension turned out to be split — a single
        // untyped 'TOTAL' commit is no longer resolvable. Fall back to
        // independent typed commits using the caller-supplied evidence
        // (never a fabricated split of `fallbackAmount`).
        if (
          !spendBreakdown ||
          (spendBreakdown.onInvoice <= 0 && spendBreakdown.offInvoice <= 0)
        ) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PLAN_SPEND_BREAKDOWN_REQUIRED_FOR_SPLIT_DIMENSION',
            message:
              `Plan ${planId} was never reserved (legacy direct-approve) ` +
              `and its budget dimension (channel=${channel}, ` +
              `period=${periodMonth}) has been split into ON_INVOICE/` +
              `OFF_INVOICE envelopes; an on/off spend breakdown is required ` +
              `to commit each type independently. Recalculate the plan ` +
              `(POST /plans/${planId}/recalculate) and resubmit.`,
          });
        }

        // T-057 B3 (code-reviewer, 2026-08-04): özdeşlik kapısı — aynı
        // `PLAN_SPEND_BREAKDOWN_INCONSISTENT` kodu ve kapı deseninin
        // `plan.service.ts` submit yolundaki (`Math.abs(onInvoice +
        // offInvoice - totalSpend) > 0.01`) birebir eşdeğeri, buraya da
        // uygulanır. Bu dal hem `fallbackAmount` (çağıranın `totalSpend`'i)
        // HEM DE ayrı bir `spendBreakdown` (çağıranın `onInvoiceSpend`/
        // `offInvoiceSpend`'i) alıyor — ikisi aynı `Plan` satırından, aynı
        // anda okunuyor olsa da İKİ AYRI kolon çiftidir; biri diğerini
        // güncellemeden yazılmışsa (bayat recalc) sessizce `fallbackAmount`
        // kadar rezerve/commit etmek yanlış tutarı bütçeye yazar. Reddet.
        const breakdownSum =
          Number(spendBreakdown.onInvoice) + Number(spendBreakdown.offInvoice);
        if (Math.abs(breakdownSum - fallbackAmount) > 0.01) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PLAN_SPEND_BREAKDOWN_INCONSISTENT',
            message:
              `Plan ${planId} on/off-invoice breakdown (${spendBreakdown.onInvoice} + ` +
              `${spendBreakdown.offInvoice} = ${breakdownSum}) does not match ` +
              `totalSpend (${fallbackAmount}). Recalculate the plan (POST ` +
              `/plans/${planId}/recalculate) before submitting.`,
          });
        }

        const results: BudgetTransaction[] = [];
        if (spendBreakdown.onInvoice > 0) {
          results.push(
            await this.commitReservedForPlan(
              planId,
              spendBreakdown.onInvoice,
              channel,
              periodMonth,
              currency,
              tenantId,
              userId,
              'ON_INVOICE',
              manager,
            ),
          );
        }
        if (spendBreakdown.offInvoice > 0) {
          results.push(
            await this.commitReservedForPlan(
              planId,
              spendBreakdown.offInvoice,
              channel,
              periodMonth,
              currency,
              tenantId,
              userId,
              'OFF_INVOICE',
              manager,
            ),
          );
        }
        return results;
      }
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

    return this.writeTransaction({
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
    const transaction = await this.writeTransaction({
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
   *
   * T-019b (§5.1): `spendType` is OPTIONAL and forwarded as-is to the
   * repository — when provided, a typed match wins over the UNSPLIT (NULL)
   * fallback; when omitted, behaviour is unchanged (pre-T-019b callers keep
   * working, `plan.service.ts#submit`'s TOTAL bucket among them).
   */
  async findEnvelopeByDimensions(
    tenantId: string,
    channel: string,
    periodMonth: string,
    category?: string,
    spendType?: BudgetSpendType,
  ): Promise<BudgetEnvelope | null> {
    return this.budgetRepository.findEnvelopeByDimensions(
      tenantId,
      channel,
      periodMonth,
      category,
      spendType,
    );
  }

  /**
   * T-019b (§5.5): availability check for a caller that has ALREADY resolved
   * a specific (typed or UNSPLIT) envelope — used by
   * `checkPlanBudgetAvailability` (below) so the on/off split decision stays
   * in ONE place (this class) instead of being re-derived by callers (§5.7
   * "shared/budget bu kararı yeniden uygulamaz").
   */
  async checkEnvelopeAvailability(
    tenantId: string,
    envelopeId: string,
    amount: number,
  ): Promise<{ available: number; sufficient: boolean }> {
    return this.budgetRepository.checkBudgetAvailability(
      envelopeId,
      tenantId,
      amount,
    );
  }

  /**
   * T-056 adım 2 (docs/analysis/0009 §3.2, §6 adım 2): saf taşıma —
   * `ApprovalWorkflowService#checkBudgetAvailability`'nin (T-019b, §5.5)
   * BİREBİR AYNI mantığı, `shared/budget`'a yükseltildi. Davranış
   * değişmedi; yalnız konum ve görünürlük (private → public, sınıf
   * `ApprovalWorkflowService` → `BudgetService`) değişti.
   *
   * Gerekçe (0009 §3.1): iki mode-servisi (plan.service.ts#submit,
   * approval-workflow.service.ts#submitForApproval) birbirinin private
   * metodunu paylaşamaz — adım 3'te ikisi de bu metodu çağıracak. Kopyalamak
   * ikinci bir türetim noktası açardı (bu oturumun tekrar eden hata sınıfı,
   * bkz. T-049/T-052/T-053 ve T-056 adım 1'deki `computeBucketNet`).
   *
   * Yön kuralı (bağlayıcı, 0009 §3.1): bu metot yalnız `BudgetService`'in
   * kendi genel metotlarını (`findEnvelopeByDimensions`,
   * `checkEnvelopeAvailability`) çağırır — `modes/*`'tan hiçbir importu
   * yoktur ve olmayacaktır.
   *
   * T-019b (§5.5): ON and OFF envelopes are resolved INDEPENDENTLY
   * (`findEnvelopeByDimensions` with an explicit `spendType` — typed match
   * preferred, UNSPLIT/NULL envelope as fallback, §5.1).
   *
   * Two regimes:
   *  - UNSPLIT (legacy): both lookups fall back to the SAME envelope
   *    (`onEnvelope.id === offEnvelope.id`) — the two requested amounts
   *    share ONE pool, so they must be measured TOGETHER
   *    (`on + off <= available`), not independently (§5.5 "birleşik kural",
   *    R3: two amounts that individually fit can together overshoot).
   *  - SPLIT: each type has its OWN envelope/available — measured
   *    independently.
   *
   * Product-owner scope (ADR 0004 Karar 2 eki, 2026-08-02): the threshold
   * check only considers types the plan ACTUALLY spends. A zero amount for
   * a type is trivially sufficient regardless of that type's envelope state
   * (a plan that spends 0 off-invoice is never blocked by a full/over-spent
   * off-invoice envelope). When the plan spends BOTH types, Karar 2's
   * atomicity is unchanged: if either exceeds, the ENTIRE request is
   * rejected — no partial reservation (enforced by the caller checking
   * `overallSufficient` BEFORE either reservation write).
   *
   * Mimari kural (§5.7, bağlayıcı): this method only READS/compares
   * envelope availability — the on/off split of the plan's OWN spend is
   * decided upstream by `SpendCalculationService`; this method does not
   * re-derive or override that decision.
   *
   * ⚠️ F2 (0009 §2.4, taşınmadan sonra da geçerli — bu adımda ÇÖZÜLMEDİ):
   * `checkEnvelopeAvailability` → `budgetRepository.checkBudgetAvailability`
   * → `getBudgetSummary` `manager` parametresi ALMAZ
   * (`budget.repository.ts:436-447`, `this.dataSource.getRepository(...)`).
   * Yani bu metodun availability okuması, çağıranın açık transaction'ı
   * içinde henüz commit edilmemiş yazımları GÖRMEZ. Ardışık iki çağrı aynı
   * (stale) değeri okuyabilir — ADR 0004 Karar 2'nin "yazımdan önce kontrol"
   * kapısı bu yüzden TEK koruma katmanıdır, sıralama otomatik doğruluk
   * sağlamaz. Çözüm ayrı bir karar/adım gerektirir, bu taşımanın kapsamında
   * DEĞİL.
   */
  async checkPlanBudgetAvailability(
    tenantId: string,
    channelCode: string,
    periodMonth: string,
    onInvoiceAmount: number,
    offInvoiceAmount: number,
  ): Promise<{
    onInvoice: { available: number; requested: number; sufficient: boolean };
    offInvoice: { available: number; requested: number; sufficient: boolean };
    overallSufficient: boolean;
  }> {
    const [onEnvelope, offEnvelope] = await Promise.all([
      this.findEnvelopeByDimensions(
        tenantId,
        channelCode,
        periodMonth,
        undefined,
        BudgetSpendType.ON_INVOICE,
      ),
      this.findEnvelopeByDimensions(
        tenantId,
        channelCode,
        periodMonth,
        undefined,
        BudgetSpendType.OFF_INVOICE,
      ),
    ]);

    const unsplitSharedEnvelope =
      !!onEnvelope && !!offEnvelope && onEnvelope.id === offEnvelope.id;

    let onAvailable = 0;
    let offAvailable = 0;
    let onSufficient = true;
    let offSufficient = true;
    let overallSufficient: boolean;

    if (unsplitSharedEnvelope) {
      // §5.5 birleşik kural — ONE pool, both amounts measured TOGETHER for
      // the GATE (`overallSufficient`). The per-leg `sufficient` flags below
      // stay INFORMATIONAL (does this amount alone fit the shared pool?) —
      // this is the pre-existing display contract (§7 T3: an on=60/off=60
      // request against a 100-available pool reports EACH leg sufficient
      // individually while the atomic combined gate still rejects the
      // request as a whole; a UI can show "on: OK, off: OK, but together:
      // insufficient").
      const combined = await this.checkEnvelopeAvailability(
        tenantId,
        onEnvelope!.id,
        onInvoiceAmount + offInvoiceAmount,
      );
      onAvailable = combined.available;
      offAvailable = combined.available;
      onSufficient =
        onInvoiceAmount > 0 ? combined.available >= onInvoiceAmount : true;
      offSufficient =
        offInvoiceAmount > 0 ? combined.available >= offInvoiceAmount : true;
      overallSufficient = combined.sufficient;
    } else {
      if (onInvoiceAmount > 0) {
        if (!onEnvelope) {
          onAvailable = 0;
          onSufficient = false;
        } else {
          const r = await this.checkEnvelopeAvailability(
            tenantId,
            onEnvelope.id,
            onInvoiceAmount,
          );
          onAvailable = r.available;
          onSufficient = r.sufficient;
        }
      } else if (onEnvelope) {
        onAvailable = (
          await this.checkEnvelopeAvailability(tenantId, onEnvelope.id, 0)
        ).available;
      }

      if (offInvoiceAmount > 0) {
        if (!offEnvelope) {
          offAvailable = 0;
          offSufficient = false;
        } else {
          const r = await this.checkEnvelopeAvailability(
            tenantId,
            offEnvelope.id,
            offInvoiceAmount,
          );
          offAvailable = r.available;
          offSufficient = r.sufficient;
        }
      } else if (offEnvelope) {
        offAvailable = (
          await this.checkEnvelopeAvailability(tenantId, offEnvelope.id, 0)
        ).available;
      }
      // SPLIT regime: each type has its own envelope — the atomic gate IS
      // the per-leg sufficiency (Karar 2: reject entirely if either
      // actually-spent type exceeds its OWN envelope).
      overallSufficient = onSufficient && offSufficient;
    }

    return {
      onInvoice: {
        available: onAvailable,
        requested: onInvoiceAmount,
        sufficient: onSufficient,
      },
      offInvoice: {
        available: offAvailable,
        requested: offInvoiceAmount,
        sufficient: offSufficient,
      },
      overallSufficient,
    };
  }

  /**
   * T-056 adım 3 (docs/analysis/0009 §3.2, §6 adım 3): TEK rezervasyon
   * motoru — bir planın on/off tutarlarını tek yerden, ADR 0004 Karar 2
   * (+ eki) atomikliğiyle rezerve eder. `ApprovalWorkflowService
   * #submitForApproval` bugünkü iki ayrı `reserveForPlan` çağrısını
   * bırakıp bunun yerine BUNU çağırır (adım 5'te `PlanService#submit` de
   * geçecek — bu adımda DOKUNULMADI).
   *
   * Davranış (bağlayıcı, 0009 §3.2, aynen uygulandı):
   * 1. **Kapı ÖNCE:** `checkPlanBudgetAvailability` (adım 2'de taşınan,
   *    UNSPLIT birleşik kural + SPLIT bağımsız zarf mantığı) çağrılır;
   *    `overallSufficient === false` ise `BadRequestException` fırlatılır
   *    ve HİÇBİR satır yazılmaz (Karar 2 — kısmi rezervasyon YOK). Bu
   *    kontrol yeniden yazılmadı — mevcut `checkPlanBudgetAvailability`
   *    delege edilerek kullanıldı (tek türetim noktası, T-053/T-056 adım
   *    1/2 dersi).
   * 2. **Yalnız fiilen harcanan tipler yazılır** (ADR 0004 Karar 2 eki):
   *    `amount > 0` olmayan tip için `reserveForPlan` hiç çağrılmaz.
   *    `onInvoice <= 0 && offInvoice <= 0` → kapı de atlanır, boş dizi
   *    döner (no-op; hiçbir tip harcanmıyorsa değerlendirilecek bir şey
   *    yoktur).
   * 3. **Deterministik yazma sırası:** her zaman ON_INVOICE önce,
   *    OFF_INVOICE sonra (0008 §6 R4 — deadlock disiplini).
   * 4. **Yazma** mevcut `reserveForPlan(..., bucket, manager)`'a delege
   *    edilir — o metot DEĞİŞMEDİ (T-048/T-053 kova-farkındalı
   *    net/idempotency mantığı, key formatları dokunulmadı).
   *
   * §5.7 uyumu (bağlayıcı): bu metot on/off SINIFLANDIRMASI yapmaz —
   * çağıranın (`SpendCalculationService` zincirinden gelen) hazır iki
   * skalerini (`amounts.onInvoice`/`offInvoice`) tüketir.
   *
   * Key uzayı: dokunulmadı — `reserveForPlan` `ON_INVOICE`/`OFF_INVOICE`
   * bucket'ları için bugün yazdığı `|ON_INVOICE`/`|OFF_INVOICE` (+ `|GEN<n>`)
   * sonekli key uzayını AYNEN üretmeye devam eder.
   */
  async reserveTypedForPlan(
    planId: string,
    amounts: { onInvoice: number; offInvoice: number },
    channel: string,
    periodMonth: string,
    currency: string,
    tenantId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<BudgetTransaction[]> {
    const { onInvoice, offInvoice } = amounts;

    // Karar 2 eki: hiçbir tip fiilen harcanmıyorsa değerlendirilecek/
    // yazılacak bir şey yok — kapı dahi atlanır.
    if (onInvoice <= 0 && offInvoice <= 0) {
      return [];
    }

    // 1) Kapı ÖNCE (Karar 2 — atomik, kısmi rezervasyon YOK). F2 (0009
    // §2.4) nedeniyle bu okuma çağıranın açık transaction'ını görmez —
    // bilinçli kabul edilmiş, TEK koruma katmanı (0009 §9 madde 3).
    const budgetCheck = await this.checkPlanBudgetAvailability(
      tenantId,
      channel,
      periodMonth,
      onInvoice,
      offInvoice,
    );

    if (!budgetCheck.overallSufficient) {
      throw new BadRequestException(
        `Insufficient budget. On-Invoice: ${budgetCheck.onInvoice.available} available, ${budgetCheck.onInvoice.requested} requested. ` +
          `Off-Invoice: ${budgetCheck.offInvoice.available} available, ${budgetCheck.offInvoice.requested} requested.`,
      );
    }

    // 2) + 3) Yalnız fiilen harcanan tipler, deterministik ON→OFF sırayla.
    const results: BudgetTransaction[] = [];
    if (onInvoice > 0) {
      results.push(
        await this.reserveForPlan(
          planId,
          onInvoice,
          channel,
          periodMonth,
          currency,
          tenantId,
          userId,
          'ON_INVOICE',
          manager,
        ),
      );
    }
    if (offInvoice > 0) {
      results.push(
        await this.reserveForPlan(
          planId,
          offInvoice,
          channel,
          periodMonth,
          currency,
          tenantId,
          userId,
          'OFF_INVOICE',
          manager,
        ),
      );
    }
    return results;
  }

  /**
   * INV-B-009 / Z45 §3 — canonical, ledger-derived budget summary for an
   * ALREADY-RESOLVED envelope id.
   *
   * Callers who already hold a `BudgetEnvelope` (from `findEnvelopeByDimensions`
   * or similar) must NOT trust `envelope.availableAmount` — that column is a
   * snapshot written only at envelope creation and split time; no reserve/
   * commit/release path updates it (measured, `INV-B-009`: two of four live
   * envelopes diverge from `v_budget_summary`, the other two match only
   * because nothing was ever reserved against them). `main.v_budget_summary`
   * is the canonical source (`allocated - reserved - consumed`, derived live
   * from `budget_transactions`/`ledger_entries` — `K-2.2` ailesinin ruhu).
   *
   * This is a THIN wrapper, not a second derivation point (T-049/T-052/T-053
   * dersi): it delegates to the same `budgetRepository.getBudgetSummary` the
   * rest of this service already uses (`getBudgetStatus` above).
   */
  async getEnvelopeBudgetSummary(
    envelopeId: string,
    tenantId: string,
  ): Promise<BudgetSummaryView | null> {
    return this.budgetRepository.getBudgetSummary(envelopeId, tenantId);
  }

  /**
   * Get budget status for channel and category
   * Returns total allocation, available amount, and planned amount
   *
   * T-019b (§5.6): `spendType` is OPTIONAL and additive — when provided, the
   * dimension lookup resolves the typed (or UNSPLIT-fallback) envelope for
   * THAT type specifically. When omitted, behaviour is BYTE-FOR-BYTE
   * unchanged (existing callers — `plan.service.ts#checkBudget`, dashboards —
   * keep reading the single dimension-matched envelope exactly as before).
   */
  async getBudgetStatus(
    tenantId: string,
    channel: string,
    categoryId?: string,
    periodMonth?: string,
    spendType?: BudgetSpendType,
  ): Promise<{
    totalAllocation: number;
    available: number;
    reserved: number;
    consumed: number;
    planned: number; // For current STA being created
    status: UtilizationStatus;
  }> {
    // Get current month if not provided
    // T-333 (Z81 §2): UTC bileşenlerinden — bkz. `common/date/period-month.ts`
    if (!periodMonth) {
      periodMonth = toPeriodMonthUtc(new Date());
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
      spendType,
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

  /**
   * T-019b (Faz 2, docs/analysis/0008 §4 "Faz 2", ADR 0004 Karar 4):
   * Finance-only operation that splits an UNSPLIT (legacy, `spend_type IS
   * NULL`) envelope into two typed envelopes:
   *  - the ORIGINAL row keeps its id (FK safety: `budget_transactions
   *    .envelope_id`, `ledger_entries.budget_envelope_id` never dangle —
   *    ölçüldü T-225, 2026-08-15: bu ikisi `envelope_id`/`budget_envelope_id`
   *    üzerinden hâlâ canlı FK taşıyor, `budget_reservations` migration
   *    1805000000000 ile düşürüldü ve bu listeden çıkarıldı) and becomes
   *    ON_INVOICE;
   *  - a NEW row (`code`+`-OFF`) is created as OFF_INVOICE;
   *  - any encumbrance already tagged `spend_type='OFF_INVOICE'` on the
   *    original row is RE-HOMED to the new row, APPEND-ONLY (RELEASE the
   *    old net + RESERVE/COMMIT the same net on the new envelope — no
   *    UPDATE/DELETE of any existing row, net total is conserved).
   *
   * Guard (§4 step 5): if any UNTYPED (`spend_type IS NULL`) encumbrance has
   * net > 0 on the envelope, the split is REJECTED (409
   * UNTYPED_ENCUMBRANCE_PRESENT) — there is no evidence which twin that
   * money belongs to (it could be a TOTAL-bucket plan reservation OR a
   * BOTH-agreement reservation, §5.7).
   *
   * All reads/writes happen inside ONE QueryRunner transaction, opened after
   * the envelope is locked `FOR UPDATE` — no other writer can observe or
   * race a partially-split envelope.
   */
  async splitEnvelope(
    tenantId: string,
    userId: string,
    envelopeId: string,
    onInvoiceAllocated: number,
    offInvoiceAllocated: number,
  ): Promise<SplitEnvelopeResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      // 1. Lock + validate.
      const envelope = await this.budgetRepository.findEnvelopeWithLock(
        tenantId,
        envelopeId,
        manager,
      );
      if (!envelope) {
        throw new NotFoundException(
          `Budget envelope with ID ${envelopeId} not found`,
        );
      }
      if (envelope.spendType) {
        throw new ConflictException({
          statusCode: 409,
          code: 'ENVELOPE_ALREADY_SPLIT',
          message: `Budget envelope ${envelopeId} is already split (spend_type=${envelope.spendType})`,
        });
      }

      // 2. Amounts must sum EXACTLY to the current allocated_amount —
      // Finance cannot grow/shrink the budget from this endpoint (that is a
      // separate operation); this endpoint only re-labels the existing pool.
      const currentAllocated = Number(envelope.allocatedAmount);
      const sum = Number(onInvoiceAllocated) + Number(offInvoiceAllocated);
      const EPSILON = 0.01;
      if (Math.abs(sum - currentAllocated) > EPSILON) {
        throw new BadRequestException(
          `onInvoiceAllocated + offInvoiceAllocated (${sum}) must equal the envelope's current allocated_amount (${currentAllocated})`,
        );
      }

      // 3. Read every POSTED transaction on this envelope (same manager —
      // consistent with the FOR UPDATE lock above) and bucket by spend_type.
      const allTx = await this.budgetRepository.findTransactionsByEnvelope(
        tenantId,
        envelopeId,
        undefined,
        manager,
      );
      const posted = allTx.filter(
        (tx) => tx.txStatus === BudgetTransactionStatus.POSTED,
      );

      const netOf = (rows: BudgetTransaction[]): number =>
        rows.reduce((net, tx) => {
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
          return net; // ALLOCATE/ADJUST/TRANSFER — not encumbrance.
        }, 0);

      // 4. Guard (§4 step 5): untyped net > 0 blocks the split entirely —
      // no writes below have happened yet, so this is a clean no-op reject.
      const untypedRows = posted.filter((tx) => !tx.spendType);
      const untypedNet = netOf(untypedRows);
      if (untypedNet > EPSILON) {
        throw new ConflictException({
          statusCode: 409,
          code: 'UNTYPED_ENCUMBRANCE_PRESENT',
          message: `Envelope ${envelopeId} has ${untypedNet} of untyped (spend_type IS NULL) outstanding encumbrance — cannot determine which twin it belongs to. Resolve (release/commit/reject) the untyped source(s) first.`,
        });
      }

      // 5. OFF-twin code collision guard (defensive — see createEnvelope's
      // identical check).
      const offCode = `${envelope.code}-OFF`;
      const codeCollision = await this.budgetRepository.findEnvelopeByCode(
        tenantId,
        offCode,
        manager,
      );
      if (codeCollision) {
        throw new ConflictException(
          `Budget envelope with code ${offCode} already exists`,
        );
      }

      // 6. Original row keeps its id, becomes ON_INVOICE (FK safety —
      // see class JSDoc). `availableAmount` KALDIRILDI (`INV-B-009` /
      // `Z47`) — kolon artık yok; `consumedAmount` bu convention'ı
      // koruyor (0'dan başlar) çünkü kendi başına bir tüketim kovası
      // (ledger-bağımsız), `available` gibi bir kopya değil.
      // `v_budget_summary` (allocated - reserved - consumed) hâlâ
      // real-time source of truth.
      envelope.spendType = BudgetSpendType.ON_INVOICE;
      envelope.allocatedAmount = onInvoiceAllocated;
      envelope.updatedBy = userId;
      const onEnvelope = await this.budgetRepository.updateEnvelope(
        envelope,
        manager,
      );

      // 7. OFF twin — new row, new id.
      const offEnvelope = await this.budgetRepository.createEnvelope(
        {
          code: offCode,
          name: `${envelope.name} (Off-Invoice)`,
          fiscalYear: envelope.fiscalYear,
          period: envelope.period,
          allocatedAmount: offInvoiceAllocated,
          consumedAmount: 0,
          status: envelope.status,
          budgetOwnerId: envelope.budgetOwnerId,
          budgetOwnerEmail: envelope.budgetOwnerEmail,
          budgetOwnerName: envelope.budgetOwnerName,
          channel: envelope.channel,
          category: envelope.category,
          channelId: envelope.channelId,
          categoryId: envelope.categoryId,
          currency: envelope.currency,
          spendType: BudgetSpendType.OFF_INVOICE,
          description: envelope.description,
          metadata: envelope.metadata ? { ...envelope.metadata } : undefined,
          tenantId,
          createdBy: userId,
        } as Partial<BudgetEnvelope>,
        manager,
      );

      // 8. Re-home (append-only): every OFF_INVOICE-tagged (sourceType,
      // sourceId) bucket with net > 0 moves — RELEASE(net) on the OLD
      // envelope (now the ON_INVOICE row, `|REHOME` key suffix — see class
      // JSDoc / §4 for why the suffix is non-negotiable), RESERVE(net) or
      // COMMIT(net) (whichever the bucket currently holds) on the NEW
      // (OFF_INVOICE) envelope. No existing row is ever UPDATEd/DELETEd.
      const offTagged = posted.filter(
        (tx) => tx.spendType === BudgetSpendType.OFF_INVOICE,
      );
      const groups = new Map<string, BudgetTransaction[]>();
      for (const tx of offTagged) {
        if (!tx.sourceType || !tx.sourceId) continue; // defensive — spend_type=OFF_INVOICE rows always carry a source in this codebase.
        const key = `${tx.sourceType}|${tx.sourceId}`;
        const arr = groups.get(key) ?? [];
        arr.push(tx);
        groups.set(key, arr);
      }

      const rehomed: SplitEnvelopeRehomedBucket[] = [];
      for (const [, rows] of groups) {
        const net = netOf(rows);
        if (net <= EPSILON) continue; // already net-zero — no-op, not an error.

        const { sourceType, sourceId, currency } = rows[0];
        const hasCommit = rows.some(
          (tx) => tx.txType === BudgetTransactionType.COMMIT,
        );
        const writeType = hasCommit
          ? BudgetTransactionType.COMMIT
          : BudgetTransactionType.RESERVE;

        const releaseKey = `RELEASE|${sourceType}|${sourceId}|${onEnvelope.id}|REHOME`;
        const existingRelease =
          await this.budgetRepository.findTransactionByIdempotencyKey(
            tenantId,
            releaseKey,
            manager,
          );
        if (!existingRelease) {
          await this.writeTransaction(
            {
              tenantId,
              envelopeId: onEnvelope.id,
              txType: BudgetTransactionType.RELEASE,
              txStatus: BudgetTransactionStatus.POSTED,
              sourceType,
              sourceId,
              amount: net,
              currency: currency || 'TRY',
              idempotencyKey: releaseKey,
              spendType: BudgetSpendType.OFF_INVOICE,
              description: `T-019b split re-home: OFF_INVOICE net released from envelope ${onEnvelope.code} (now ON_INVOICE) on split into ${offEnvelope.code}`,
              createdBy: userId,
            },
            manager,
          );
        }

        const newKey = `${writeType}|${sourceType}|${sourceId}|${offEnvelope.id}`;
        const existingNew =
          await this.budgetRepository.findTransactionByIdempotencyKey(
            tenantId,
            newKey,
            manager,
          );
        if (!existingNew) {
          await this.writeTransaction(
            {
              tenantId,
              envelopeId: offEnvelope.id,
              txType: writeType,
              txStatus: BudgetTransactionStatus.POSTED,
              sourceType,
              sourceId,
              amount: net,
              currency: currency || 'TRY',
              idempotencyKey: newKey,
              spendType: BudgetSpendType.OFF_INVOICE,
              description: `T-019b split re-home: OFF_INVOICE net moved to envelope ${offEnvelope.code} (split from ${onEnvelope.code})`,
              createdBy: userId,
            },
            manager,
          );
        }

        rehomed.push({
          sourceType: sourceType as BudgetTransactionSourceType,
          sourceId: sourceId as string,
          amount: net,
          txType: writeType,
        });
      }

      await queryRunner.commitTransaction();
      return { onEnvelope, offEnvelope, rehomed };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
