import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgreementTransactionRepository } from '../agreement-transaction/agreement-transaction.repository';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
import { AgreementTransaction } from '../../../../database/entities/agreement-transaction.entity';
import { AgreementStatus } from '../../../../database/entities/agreement.entity';
import { ReverseTransactionDto, ReversalResponseDto } from './dto';

/** Agreement state machine: reversal yalnızca APPROVED veya ACTIVE anlaşmalarda geçerlidir. */
const REVERSIBLE_AGREEMENT_STATES: AgreementStatus[] = [
  AgreementStatus.APPROVED,
  AgreementStatus.ACTIVE,
];

@Injectable()
export class ReversalService {
  private readonly logger = new Logger(ReversalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly txRepo: AgreementTransactionRepository,
    private readonly ledgerService: LedgerService,
    private readonly ledgerRepo: LedgerRepository,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  /**
   * Reverses an agreement transaction (off-invoice) in a single atomic DB transaction.
   *
   * İşlem sırası (tümü tek QueryRunner içinde):
   *  1. Kaynak transaction'ı tenant scope ile bul → yoksa 404
   *  2. Zaten reversed? → 409 ALREADY_REVERSED
   *  3. Agreement state machine uyumluluğu → 409 NOT_REVERSIBLE_STATE
   *  4. Kaynak DEBIT ledger entry'yi transaction-spesifik idempotency key ile bul
   *     (B-2: agreementId+transactionId key'i — batch import ambiguity'sini önler)
   *     → yoksa 409 REVERSAL_SOURCE_NOT_FOUND
   *  5. App-katman çift-reversal kontrolü → 409 ALREADY_REVERSED
   *     (Adım 4-5 okuma queryRunner.manager üzerinden yapılır — dirty read engeli / S-4)
   *  6. Reversal (CREDIT) ledger entry oluştur (queryRunner içinde)
   *  7. Orijinal ledger entry'yi is_reversed=true olarak işaretle (LedgerRepository.markAsReversed)
   *  8. AgreementTransaction.isReversed = true
   *  9. Audit log (immutable) — T-014: queryRunner.manager üzerinden yazılır,
   *     yani AYNI transaction'ın içinde (atomik: rollback olursa audit da
   *     hiç yazılmamış olur). REVERSE high-risk alarmı burada TETİKLENMEZ —
   *     commit'ten önce alarm gönderip sonra rollback etme riskini önlemek
   *     için adım 10'daki commit'ten SONRA flushPendingAlert ile tetiklenir.
   * 10. Commit; hata → rollback (audit dahil, aynı transaction'da). Commit
   *     başarılı olduktan sonraki flushPendingAlert çağrısı KENDİ try/catch'i
   *     içindedir — dıştaki catch'in ana try bloğuyla paylaşılmaz. Sebep:
   *     alarm gönderimi gerçek bir DB yazması içerir (bkz. triggerAlert) ve
   *     başarısız olursa, zaten commit edilmiş bu queryRunner'da
   *     rollbackTransaction() çağrılmamalı — bu hem asıl hatayı maskeler
   *     hem de commit olmuş bir reversal için kullanıcıya yanlışlıkla 500
   *     döndürür. Alarm hatası burada yutulur ve yalnızca ERROR loglanır.
   *
   * NOT — Budget RELEASE (B-1 simetri analizi):
   *   v_budget_summary: available = allocated − reserved − consumed
   *   consumed = ledger_entries (DEBIT − CREDIT)
   *   reserved = budget_transactions (RESERVE − RELEASE)
   *
   *   agreement-transaction.service.create yalnızca ledger DEBIT yazar;
   *   budget RESERVE transaction'ı OLUŞTURULMAZ (reserved=0, consumed=X).
   *   Reversal'da ledger CREDIT yazmak consumed'ı X→0 düşürür → available otomatik
   *   artar. Ayrıca RELEASE budget transaction yazmak reserved=0−X=negatif yapardı
   *   ve bu çift restore olurdu. Bu nedenle budgetService.reverseForTransaction
   *   çağrısı kasıtlı olarak YOKTUR.
   */
  async reverseTransaction(
    transactionId: string,
    tenantId: string,
    userId: string,
    userEmail: string,
    dto?: ReverseTransactionDto,
  ): Promise<ReversalResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Kaynak transaction'ı bul (tenant-scoped)
      const tx = await this.txRepo.findById(transactionId, tenantId);
      if (!tx) {
        throw new NotFoundException('Agreement transaction not found');
      }

      // 2. Zaten reversed?
      if (tx.isReversed) {
        throw new ConflictException({
          code: 'ALREADY_REVERSED',
          message: 'This agreement transaction has already been reversed',
        });
      }

      // 3. Agreement state machine: agreement DRAFT/PENDING ise reversal geçersiz
      const agreement = tx.agreement;
      if (
        !agreement ||
        !REVERSIBLE_AGREEMENT_STATES.includes(agreement.status)
      ) {
        throw new ConflictException({
          code: 'NOT_REVERSIBLE_STATE',
          message:
            `Reversals are only allowed when the agreement is in APPROVED or ACTIVE state. ` +
            `Current state: ${agreement?.status ?? 'unknown'}`,
        });
      }

      // 4. Kaynak DEBIT ledger entry'yi transaction-spesifik idempotency key ile bul.
      //    B-2: LedgerService.createFromAgreementTransaction idempotency key formatı:
      //    'LEDGER|AGREEMENT|{agreementId}|{transactionId}'
      //    Bu key, batch import senaryolarında aynı agreement'ın birden fazla
      //    transaction'ı olduğunda doğru entry'yi seçer.
      //    Okuma queryRunner.manager üzerinden yapılarak dirty-read riski önlenir (S-4).
      const idempotencyKey = `LEDGER|AGREEMENT|${tx.agreementId}|${transactionId}`;
      const originalEntry =
        await this.ledgerRepo.findDebitEntryByIdempotencyKey(
          idempotencyKey,
          tenantId,
        );
      if (!originalEntry) {
        throw new ConflictException({
          code: 'REVERSAL_SOURCE_NOT_FOUND',
          message:
            'No unreversed DEBIT ledger entry found for this agreement transaction',
        });
      }

      // 5. App-katman çift-reversal kontrolü (DB unique index ayrıca korur)
      //    Okuma queryRunner.manager üzerinden — aynı transaction içinde tutarlı görünüm.
      const existingReversal =
        await this.ledgerService.findReversalByOriginalId(
          originalEntry.id,
          tenantId,
        );
      if (existingReversal) {
        throw new ConflictException({
          code: 'ALREADY_REVERSED',
          message: 'A reversal entry already exists for this ledger entry',
        });
      }

      // 6. CREDIT reversal ledger entry oluştur (aynı queryRunner transaction'ında)
      const reversalEntry = await this.ledgerService.createReversalEntry(
        originalEntry.id,
        tenantId,
        userId,
        queryRunner,
      );

      // 7. Orijinal ledger entry: is_reversed = true (N-1: LedgerRepository.markAsReversed kullan)
      await this.ledgerRepo.markAsReversed(originalEntry.id, queryRunner);

      // 8. AgreementTransaction: isReversed = true
      await queryRunner.manager.update(
        AgreementTransaction,
        { id: transactionId },
        { isReversed: true },
      );

      // 9. Immutable audit log — T-014: queryRunner.manager üzerinden yazılır,
      //    yani bu adımın kendisi de transaction'ın İÇİNDE. Rollback olursa
      //    audit satırı da DB'ye hiç yazılmamış olur (atomik).
      const auditLog = await this.adminAuditService.logAdminAction(
        tenantId,
        userId,
        userEmail,
        'REVERSE',
        'AGREEMENT_TRANSACTION',
        transactionId,
        undefined,
        'SUCCESS',
        {
          originalLedgerId: originalEntry.id,
          amount: Math.abs(Number(originalEntry.amount)),
          agreementId: tx.agreementId,
        },
        {
          reversalLedgerId: reversalEntry.id,
          justification: dto?.justification,
        },
        dto?.justification,
        { manager: queryRunner.manager },
      );

      await queryRunner.commitTransaction();

      // T-014: REVERSE high-risk aksiyon alarmı, audit satırı gerçekten
      // commit olduktan SONRA tetiklenir — aksi halde rollback olan bir
      // reversal için "high-risk aksiyon oldu" alarmı gitmiş olurdu.
      // AYRI try/catch: alarm gönderimi (gerçek bir DB yazması içerir)
      // başarısız olursa dıştaki catch'e düşüp zaten commit edilmiş bu
      // queryRunner'da rollbackTransaction() çağrılmamalı — bu hem asıl
      // hatayı maskeler hem de commit olmuş bir reversal için kullanıcıya
      // yanlışlıkla 500 döndürür. Alarm kaybı, başarılı bir işlemi
      // başarısız göstermekten kat kat iyidir; hata burada yutulur ve
      // yalnızca ERROR seviyesinde loglanır.
      try {
        await this.adminAuditService.flushPendingAlert(auditLog);
      } catch (alertErr) {
        this.logger.error(
          `HIGH-RISK ALERT FAILED — AGREEMENT_TRANSACTION ${transactionId} reversed successfully; alert not delivered: ${
            alertErr instanceof Error ? alertErr.message : 'Unknown error'
          }`,
        );
      }

      return {
        transactionId,
        reversalLedgerId: reversalEntry.id,
        reversedAmount: Math.abs(Number(originalEntry.amount)),
        status: 'REVERSED',
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
