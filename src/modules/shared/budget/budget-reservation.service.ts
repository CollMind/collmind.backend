import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BudgetRepository } from './budget.repository';
import {
  BudgetTransaction,
  BudgetTransactionType,
  BudgetTransactionStatus,
  BudgetTransactionSourceType,
} from '../../../database/entities/budget-transaction.entity';
import { BudgetSpendType } from '../../../database/entities/budget-envelope.entity';

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
 *  3. Idempotency key — İKİ AYRI anahtar uzayı (T-053 fix,
 *     docs/analysis/0008 §5.4, bağlayıcı):
 *       UNTYPED kova (spend_type IS NULL) : `RELEASE|<SRC>|<sourceId>|<envelopeId>`
 *         ← T-019 ÖNCESİ formatla BİREBİR AYNI, DEĞİŞMEDİ (aksi halde zaten
 *         release edilmiş T-019-öncesi kaynaklar ikinci kez release edilir —
 *         çift iade, [[T-029]] fix'inin düzelttiği hatanın aynısı, R2).
 *       Tipli kova (spend_type = ON_INVOICE/OFF_INVOICE) : `RELEASE|<SRC>|<sourceId>|<envelopeId>|<SPEND_TYPE>`
 *         ← YENİ. İki uzay hiçbir zaman aynı parayı tarif etmez: bir
 *         (kaynak, zarf) çiftinde tipsiz satırlar yalnızca T-019 öncesinden,
 *         tipli satırlar yalnızca T-019 sonrasından gelebilir.
 *     Her iki uzayda da: bir (kaynak, zarf, kova) üçlüsüne ömür boyu en fazla
 *     1 RELEASE. Çakışmada ConflictException fırlatılmaz — no-op dönülür
 *     (409 vermemeli, zaten net'i 0'lamış olan bir işlemi tekrarlamak hata
 *     değildir). Plan tarafında bu key'ler, eski suffixli key'lerden
 *     (`...|RESERVE`, `...|COMMIT`, `...|CONVERT`) kasıtlı olarak FARKLI —
 *     geçmiş (zaten yazılmış) transaction'larla çakışmaz, ama onları
 *     OKURKEN (`findTransactionsBySource`) hepsini görür ve net hesabına
 *     dahil eder.
 *  4. [[T-053]] fix: gruplama anahtarı `envelopeId` DEĞİL,
 *     `${envelopeId}|${spendType ?? 'UNTYPED'}` — bir kaynağın RESERVE/COMMIT
 *     satırları AYNI (Faz 1 UNSPLIT) zarfta hem ON_INVOICE hem OFF_INVOICE
 *     spend_type taşıyabilir (plan-side: `reserveForPlan`'ın iki kanonik
 *     submit-path bucket'ı; agreement-side: T-019 backfill'i). Kova başına
 *     TEK RELEASE, tutar = o kovanın NET'i (ham satır tipiyle DEĞİL — kural
 *     #1 ile aynı gerekçe, kova bazında). Eskiden envelopeId-tek gruplama,
 *     iki tipin net'ini TEK bir tipsiz RELEASE'e karıştırıyordu — bu satır
 *     `budget.service.ts#reserveForPlan`'ın kova-farkındalı
 *     `netOutstanding`/`envelopeReserves` filtrelerine (`matchesBucket`)
 *     HİÇ görünmüyordu (spend_type=NULL ≠ 'ON_INVOICE'/'OFF_INVOICE'), bir
 *     reject→resubmit döngüsü sessizce YENİ RESERVE yazmadan eski
 *     (zaten net'i sıfırlanmış) satırı döndürüyordu — bkz. [[T-053]] task
 *     raporundaki ölçülmüş kanıt.
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
   * her POSTED transaction, kova (envelope × spendType) bazında RESERVE/COMMIT
   * ile toplanır, RELEASE ile (suffix'inden bağımsız — CONVERT dahil)
   * düşülür. Kova başına net>0 olan her kova için TEK bir RELEASE
   * transaction'ı yazılır — tutar o kovanın NET'i, RELEASE satırı kovanın
   * spendType'ını taşır (UNTYPED kova için NULL kalır). net<=0 olan kovalar
   * atlanır (zaten sıfırlanmış / hiç rezerv yok — no-op, hata değil).
   *
   * T-053 fix (docs/analysis/0008 §5.4): gruplama anahtarı `envelopeId` DEĞİL
   * `${envelopeId}|${spendType ?? 'UNTYPED'}` — bkz. sınıf JSDoc'u kural #4.
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

    interface Bucket {
      envelopeId: string;
      spendType: BudgetSpendType | null;
      net: number;
      currency: string;
    }

    // Group by (envelopeId, spendType) bucket — NOT envelopeId alone. A
    // source's RESERVE/COMMIT rows can legitimately carry DIFFERENT
    // spendTypes on the SAME (Faz 1 UNSPLIT) envelope: plan-side,
    // `reserveForPlan`'s two canonical-submit-path buckets
    // (ON_INVOICE/OFF_INVOICE, `budget.service.ts:reserveForPlan`);
    // agreement-side, T-019's classification backfill. Grouping by
    // envelopeId alone nets them together into a single UNTYPED RELEASE,
    // which `reserveForPlan`'s bucket-scoped `netOutstanding`/
    // `envelopeReserves` filters (`matchesBucket`) can never see for a
    // typed bucket (spend_type=NULL never matches 'ON_INVOICE'/
    // 'OFF_INVOICE') — a reject→resubmit cycle then silently reuses the
    // stale (already net-zero) RESERVE row and writes nothing new (T-053).
    const buckets = new Map<string, Bucket>();
    const bucketKey = (envelopeId: string, spendType: BudgetSpendType | null) =>
      `${envelopeId}|${spendType ?? 'UNTYPED'}`;

    for (const tx of posted) {
      const spendType = (tx.spendType ?? null) as BudgetSpendType | null;
      const key = bucketKey(tx.envelopeId, spendType);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          envelopeId: tx.envelopeId,
          spendType,
          net: 0,
          currency: tx.currency,
        };
        buckets.set(key, bucket);
      }
      const amount = Number(tx.amount);
      if (
        tx.txType === BudgetTransactionType.RESERVE ||
        tx.txType === BudgetTransactionType.COMMIT
      ) {
        bucket.net += amount;
      } else if (tx.txType === BudgetTransactionType.RELEASE) {
        bucket.net -= amount;
      }
    }

    const releases: BudgetTransaction[] = [];

    for (const bucket of buckets.values()) {
      if (bucket.net <= 0) {
        continue; // Nothing outstanding for this bucket — no-op.
      }

      // Two disjoint idempotency key spaces (bağlayıcı, R2 — see class
      // JSDoc kural #3). UNTYPED bucket keeps the EXACT pre-T-053 format
      // (no suffix) — a pre-T-019 source's already-released row must stay
      // matched by this key, or it gets released a second time (double
      // refund, the exact bug [[T-029]] fixed). Typed buckets get a new
      // disjoint `|<SPEND_TYPE>` suffix.
      const idempotencyKey = bucket.spendType
        ? `RELEASE|${sourceType}|${sourceId}|${bucket.envelopeId}|${bucket.spendType}`
        : `RELEASE|${sourceType}|${sourceId}|${bucket.envelopeId}`;

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
            envelopeId: bucket.envelopeId,
            txType: BudgetTransactionType.RELEASE,
            txStatus: BudgetTransactionStatus.POSTED,
            sourceType,
            sourceId,
            amount: bucket.net,
            currency: bucket.currency || 'TRY',
            idempotencyKey,
            spendType: bucket.spendType,
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
          `Concurrent RELEASE already posted for ${sourceLabel}=${sourceId} envelope=${bucket.envelopeId} spendType=${bucket.spendType ?? 'UNTYPED'} (reason=${reason}) — no-op`,
        );
      }
    }

    return releases;
  }
}
