import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BudgetRepository } from './budget.repository';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
  BudgetTransactionSourceType,
} from '../../../database/entities/budget-transaction.entity';

export type AgreementReservationReleaseReason =
  | 'CLOSE'
  | 'CANCEL'
  | 'REJECT'
  /**
   * T-032: agreement.service.ts#approve compensation path — mirrors Plan's
   * 'APPROVE_COMPENSATION' (see PlanReservationReleaseReason below). Used
   * when the immutable audit-log write after a successful RESERVE fails and
   * the approve() call must unwind back to PENDING. Idempotency key is
   * reason-agnostic (`RELEASE|AGREEMENT|<id>|<envelope>` — see
   * releaseNetReservation), so this is safe to call exactly once per
   * agreement+envelope, same as the other reasons.
   */
  | 'APPROVE_COMPENSATION';

/**
 * T-029 fix (code-review, 2026-07-27): plan-side release reasons. Mirrors
 * `AgreementReservationReleaseReason` — see `releasePlanReservation` below.
 */
export type PlanReservationReleaseReason =
  | 'REJECT'
  | 'DELETE'
  | 'REQUEST_CHANGES'
  | 'SUBMIT_COMPENSATION'
  | 'APPROVE_COMPENSATION';

/**
 * T-030 — Agreement bütçe rezerv release'i. T-029 fix turunda (code-review,
 * 2026-07-27) PLAN kaynağı da aynı net-tabanlı motora taşındı
 * (`releasePlanReservation`) — bkz. `releaseNetReservation` (private, ortak
 * çekirdek).
 *
 * Sızıntı (F1, docs/analysis/0003): approve → RESERVE yazıyordu ama hiçbir
 * terminal geçiş (CLOSE özellikle) rezervi RELEASE etmiyordu → CLOSED
 * agreement'lar zarfı sonsuza dek tutuyordu.
 *
 * Plan tarafında da benzer bir kusur bulundu (code-review, 2026-07-27):
 * eski `BudgetService#releaseForPlan` ham txType/txStatus filtresiyle
 * "outstanding RESERVE" arıyordu, ama `commitReservedForPlan` (approve akışı)
 * RESERVE'i zaten `RELEASE|PLAN|<id>|<env>|CONVERT` ile netleyip aynı
 * tutarda COMMIT yazıyordu — orijinal RESERVE POSTED kaldığı için
 * `releaseForPlan` onu FARKLI bir key'le (`...|RESERVE`) ikinci kez release
 * ediyor, üstelik COMMIT'i de ayrıca release ediyordu → net negatife düşüyor
 * (reserved_amount fazladan iade edilmiş gibi görünüyor). Aynı hatanın
 * ikinci örneği (F1 ile birebir aynı kök neden: net yerine ham tx toplama).
 *
 * BAĞLAYICI KURALLAR (mimari onay, 0003 §3-4 — hem agreement hem plan için
 * geçerli, kaynak-agnostik):
 *  1. TAM net rezerv release edilir — `reserve − consumed` DEĞİL. `reserved`
 *     ve `consumed` v_budget_summary'de zaten ayrı terimler (reserved:
 *     budget_transactions, consumed: ledger_entries) → "kullanılmayanı
 *     bırak" sezgisi çift-sayıma yol açar (bkz. sayısal kanıt, 0003 §3).
 *  2. Bu servis çağrıldığı transaction'ın (varsa) İÇİNDE yazar — `manager`
 *     parametresi verilirse tüm okuma/yazmalar o EntityManager üzerinden
 *     gider, böylece çağıran (örn. settlement-close) rollback ederse RELEASE
 *     de rollback olur.
 *  3. Idempotency key `RELEASE|<SOURCE_TYPE>|<sourceId>|<envelopeId>` — hem
 *     agreement hem plan tarafında bugünkü cancel/reject key'iyle BİREBİR
 *     AYNI, terminal sebepten (CLOSE/CANCEL/REJECT/DELETE/...) bağımsız: bir
 *     kaynak+zarf çiftine ömür boyu en fazla 1 RELEASE. Çakışmada
 *     ConflictException fırlatılmaz — no-op dönülür (409 vermemeli, zaten
 *     net'i 0'lamış olan bir işlemi tekrarlamak hata değildir). Plan
 *     tarafında bu key, eski suffixli key'lerden (`...|RESERVE`,
 *     `...|COMMIT`, `...|CONVERT`) kasıtlı olarak FARKLI — geçmiş (zaten
 *     yazılmış) transaction'larla çakışmaz, ama onları OKURKEN
 *     (`findTransactionsBySource`) hepsini görür ve net hesabına dahil eder.
 */
@Injectable()
export class BudgetReservationService {
  private readonly logger = new Logger(BudgetReservationService.name);

  constructor(private readonly budgetRepository: BudgetRepository) {}

  /**
   * Bir agreement'ın tüm zarflarındaki net rezervini (RESERVE+COMMIT−RELEASE)
   * sıfırlar. Bkz. `releaseNetReservation`.
   */
  async releaseAgreementReservation(
    agreementId: string,
    tenantId: string,
    userId: string | undefined,
    reason: AgreementReservationReleaseReason,
    manager?: EntityManager,
  ): Promise<BudgetTransaction[]> {
    return this.releaseNetReservation(
      BudgetTransactionSourceType.AGREEMENT,
      agreementId,
      'agreement',
      tenantId,
      userId,
      reason,
      manager,
    );
  }

  /**
   * T-029 fix — bir plan'ın tüm zarflarındaki net rezervini
   * (RESERVE+COMMIT−RELEASE, tüm geçmiş RELEASE'ler dahil, CONVERT'inkiler
   * de dahil) sıfırlar. `BudgetService#releaseForPlan` bu metoda delege eder
   * (bkz. o dosyadaki JSDoc). Bkz. `releaseNetReservation`.
   */
  async releasePlanReservation(
    planId: string,
    tenantId: string,
    userId: string | undefined,
    reason: PlanReservationReleaseReason,
    manager?: EntityManager,
  ): Promise<BudgetTransaction[]> {
    return this.releaseNetReservation(
      BudgetTransactionSourceType.PLAN,
      planId,
      'plan',
      tenantId,
      userId,
      reason,
      manager,
    );
  }

  /**
   * Ortak çekirdek (T-029 fix, code-review 2026-07-27): agreement ve plan
   * release'lerinin ikisi de aynı net-tabanlı motoru paylaşır — kaynak
   * bazında ayrı tutmak aynı çift-sayım hatasının (bkz. sınıf JSDoc'u) bir
   * üçüncü kaynak türünde (ör. gelecekteki bir "Commitment" nesnesi) tekrar
   * çıkma riskini taşırdı.
   *
   * Net formülü v_budget_summary (migration 1789) ile birebir aynı tutulur:
   * her POSTED transaction, zarf bazında RESERVE/COMMIT ile toplanır, RELEASE
   * ile (suffix'inden bağımsız — CONVERT dahil) düşülür. Envelope başına
   * net>0 olan her zarf için TEK bir RELEASE transaction'ı yazılır. net<=0
   * olan zarflar atlanır (zaten sıfırlanmış / hiç rezerv yok — no-op, hata
   * değil).
   */
  private async releaseNetReservation(
    sourceType: BudgetTransactionSourceType,
    sourceId: string,
    sourceLabel: string,
    tenantId: string,
    userId: string | undefined,
    reason: string,
    manager?: EntityManager,
  ): Promise<BudgetTransaction[]> {
    const transactions = await this.budgetRepository.findTransactionsBySource(
      tenantId,
      sourceType,
      sourceId,
      manager,
    );

    const posted = transactions.filter(
      (tx) => tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    // Group by envelope — a source can (in principle) span more than one
    // envelope over its lifetime (T-019 kısıtı, 0003 §6).
    const netByEnvelope = new Map<string, number>();
    for (const tx of posted) {
      const current = netByEnvelope.get(tx.envelopeId) ?? 0;
      const amount = Number(tx.amount);
      if (
        tx.txType === BudgetTransactionType.RESERVE ||
        tx.txType === BudgetTransactionType.COMMIT
      ) {
        netByEnvelope.set(tx.envelopeId, current + amount);
      } else if (tx.txType === BudgetTransactionType.RELEASE) {
        netByEnvelope.set(tx.envelopeId, current - amount);
      }
    }

    const currencyByEnvelope = new Map<string, string>();
    for (const tx of posted) {
      if (!currencyByEnvelope.has(tx.envelopeId)) {
        currencyByEnvelope.set(tx.envelopeId, tx.currency);
      }
    }

    const releases: BudgetTransaction[] = [];

    for (const [envelopeId, net] of netByEnvelope.entries()) {
      if (net <= 0) {
        continue; // Nothing outstanding for this envelope — no-op.
      }

      const idempotencyKey = `RELEASE|${sourceType}|${sourceId}|${envelopeId}`;

      // Layer 1: net-residual check already ensures we only get here when
      // net > 0 as of the read above. Layer 2 (below) re-checks under the
      // same manager/transaction right before writing, to protect against
      // a concurrent RELEASE landing between the read and this write.
      const existing =
        await this.budgetRepository.findTransactionByIdempotencyKey(
          tenantId,
          idempotencyKey,
          manager,
        );
      if (existing) {
        // Already released (possibly concurrently) — no-op, not an error.
        continue;
      }

      try {
        const release = await this.budgetRepository.createTransaction(
          {
            tenantId,
            envelopeId,
            txType: BudgetTransactionType.RELEASE,
            txStatus: BudgetTransactionStatus.POSTED,
            sourceType,
            sourceId,
            amount: net,
            currency: currencyByEnvelope.get(envelopeId) || 'TRY',
            idempotencyKey,
            description: `Budget release (${reason}) — net reservation for ${sourceLabel} ${sourceId}`,
            createdBy: userId,
          },
          manager,
        );
        releases.push(release);
      } catch (err: any) {
        // Unique index on (tenantId, idempotencyKey) — a concurrent writer
        // won the race. Per design: no-op, do NOT surface as a 409.
        const isUniqueViolation =
          err?.code === '23505' ||
          err?.driverError?.code === '23505' ||
          (typeof err?.message === 'string' &&
            err.message.includes('duplicate key'));
        if (!isUniqueViolation) {
          throw err;
        }
        this.logger.warn(
          `Concurrent RELEASE already posted for ${sourceLabel}=${sourceId} envelope=${envelopeId} (reason=${reason}) — no-op`,
        );
      }
    }

    return releases;
  }
}
