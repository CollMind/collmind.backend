import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Agreement,
  AgreementStatus,
} from '../../../../database/entities/agreement.entity';
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
import { BudgetReservationService } from '../../../shared/budget/budget-reservation.service';
import { CloseSettlementDto } from './dto';

/**
 * Bir agreement'ı CLOSED state'ine geçiren servis.
 *
 * ÇIFT-SAYIM TUZAĞI (T-003 dersi) + T-030 REZERV RELEASE:
 * ─────────────────────────────────────────────────────────
 * Budget, agreement-transaction oluşturulurken ledger DEBIT kaydıyla tüketilir.
 * LedgerRepository.sumByAgreementId = DEBIT − CREDIT (direction-aware).
 *
 * CLOSE işleminde KESİNLİKLE:
 *   ✗ Yeni LEDGER entry yazılmaz (consumed_amount hiç değişmez)
 *   ✗ consumed_amount güncellenmez
 *
 * ANCAK (T-030, docs/analysis/0003-agreement-reservation-lifecycle.md):
 *   ✓ Terminal state'e girişte outstanding bütçe REZERVİ (RESERVE−RELEASE,
 *     agreement onaylanırken açılmış) TAM olarak RELEASE edilir — approve
 *     sırasında yazılan RESERVE hiçbir zaman kendiliğinden kapanmıyordu
 *     (F1 sızıntısı: CLOSED agreement'lar zarfı sonsuza dek tutuyordu).
 *   RELEASE, budget_transactions'a yazılır (bütçe kovası) — LEDGER'a
 *   DOKUNULMAZ (consumed ayrı kova, ledger_entries'ten). Bu nedenle "no
 *   ledger write" garantisi hâlâ geçerli; "no budget write" garantisi
 *   ARTIK GEÇERLİ DEĞİL (kasıtlı olarak kaldırıldı — bkz. spec).
 *
 * RELEASE, bu servisin QueryRunner transaction'ının İÇİNDE yazılır (aynı
 * commit/rollback sınırı) — aksi halde close rollback olsa bile rezerv
 * bırakılmış kalırdı.
 *
 * DÜZELTİLDİ (T-014, 2026-07-29): AUDIT LOG artık BU TRANSACTION'IN İÇİNDE.
 * `AdminAuditService.logAdminAction` çağrısına `{ manager: queryRunner.manager }`
 * options'ı verilir — audit satırı bu manager üzerinden yazılır, yani adım
 * 5'teki RELEASE ile AYNI commit/rollback sınırını paylaşır. Eskiden
 * (code-review, 2026-07-27, #3) `AdminAuditService` kendi default-connection
 * repository'sini kullanıyordu ve rollback senaryosunda "SUCCESS" audit
 * kaydı yanlışlıkla kalıcı oluyordu; bu sınırlama artık YOK — SQL kanıtı
 * için T-014 raporuna bkz. High-risk alarm da artık commit'ten SONRA
 * (`flushPendingAlert`) tetiklenir, aksi halde rollback olan bir close için
 * alarm gitmiş olurdu.
 *
 * flushPendingAlert çağrısı KENDİ try/catch'i içindedir (ana try bloğunun
 * catch'iyle paylaşılmaz): alarm gönderimi gerçek bir DB yazması içerir
 * (triggerAlert → alertSent güncellemesi) ve başarısız olursa, zaten commit
 * edilmiş queryRunner'da rollbackTransaction() çağrılmamalı — aksi halde
 * asıl hata maskelenir ve commit olmuş bir close için kullanıcıya
 * yanlışlıkla 500 döner. Alarm hatası yutulur, yalnızca ERROR loglanır.
 */

/** Close yalnızca APPROVED veya ACTIVE anlaşmalar için geçerlidir. */
const SETTLEABLE_STATES: AgreementStatus[] = [
  AgreementStatus.APPROVED,
  AgreementStatus.ACTIVE,
];

@Injectable()
export class SettlementCloseService {
  private readonly logger = new Logger(SettlementCloseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly adminAuditService: AdminAuditService,
    private readonly budgetReservationService: BudgetReservationService,
  ) {}

  /**
   * Bir agreement'ı CLOSED state'ine geçirir.
   *
   * İşlem sırası (tümü tek QueryRunner içinde):
   *  1. Agreement'ı tenant-scoped FOR UPDATE ile çek → yoksa 404
   *  2. status === CLOSED → 409 ALREADY_SETTLED
   *  3. status APPROVED/ACTIVE değil → 409 NOT_SETTLEABLE_STATE
   *  4. status = CLOSED, closedAt, closedBy güncelle (optimistic lock: version bump)
   *  5. T-030: outstanding bütçe rezervini (net RESERVE−RELEASE) TAM release et
   *     (queryRunner.manager ile — aynı transaction sınırı)
   *  6. Audit log (immutable) — T-014: `queryRunner.manager` üzerinden
   *     yazılır, yani adım 5'teki RELEASE ile AYNI transaction'ın içinde.
   *     High-risk alarm burada TETİKLENMEZ (bkz. dosya başı notu).
   *  7. Commit; hata → rollback (adım 5'teki RELEASE ve adım 6'daki audit
   *     log BİRLİKTE geri alınır — atomik). Commit başarılı olursa, adım
   *     6'da dönen log ile `flushPendingAlert` çağrılır (high-risk alarm
   *     yalnızca gerçekten commit olmuş bir close için tetiklenir) — bu
   *     çağrı KENDİ try/catch'i içindedir (bkz. dosya başı notu): alarm
   *     hatası, zaten commit olmuş bir close'u ASLA 500'e çevirmemeli.
   *
   * NOT: LEDGER'a YAZILMAZ (çift-sayım önlemi — yukarıdaki açıklamaya bkz.).
   * Budget (RELEASE) yazılır — bu artık kasıtlı ve gerekli (F1 sızıntı fix'i).
   */
  async closeAgreement(
    agreementId: string,
    tenantId: string,
    userId: string,
    userEmail: string,
    dto?: CloseSettlementDto,
  ): Promise<{ agreementId: string; status: 'CLOSED'; closedAt: Date }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Agreement'ı tenant-scoped FOR UPDATE ile çek (optimistic lock için version)
      const agreement = await queryRunner.manager.findOne(Agreement, {
        where: { id: agreementId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!agreement) {
        throw new NotFoundException('Agreement not found');
      }

      // 2. Zaten CLOSED?
      if (agreement.status === AgreementStatus.CLOSED) {
        throw new ConflictException({
          code: 'ALREADY_SETTLED',
          message: 'This agreement has already been closed/settled',
        });
      }

      // 3. State machine kontrolü: yalnızca APPROVED veya ACTIVE kapatılabilir
      if (!SETTLEABLE_STATES.includes(agreement.status)) {
        throw new ConflictException({
          code: 'NOT_SETTLEABLE_STATE',
          message:
            `Closing is only allowed when the agreement is in APPROVED or ACTIVE state. ` +
            `Current state: ${agreement.status}`,
        });
      }

      // 4. State geçişi: CLOSED + closedAt + closedBy
      //    NOT: Budget/ledger'a YAZILMIYOR — bu bir pure state transition.
      //    Bakiye zaten agreement-transaction kaydedilirken (ledger DEBIT) düşülmüştü.
      //    Buraya ledger/budget yazmak consumed'ı çift sayardı.
      const closedAt = new Date();
      await queryRunner.manager.update(
        Agreement,
        { id: agreementId, tenantId },
        {
          status: AgreementStatus.CLOSED,
          closedAt,
          closedBy: userId,
          updatedBy: userId,
        },
      );

      // 5. T-030: outstanding bütçe rezervini tam release et (aynı queryRunner
      //    transaction'ı içinde — rollback olursa RELEASE de geri alınır).
      const budgetReleases =
        await this.budgetReservationService.releaseAgreementReservation(
          agreementId,
          tenantId,
          userId,
          'CLOSE',
          queryRunner.manager,
        );

      // 6. Immutable audit log — T-014: queryRunner.manager üzerinden yazılır,
      //    aynı transaction'ın içinde (rollback scope). Commit başarısız
      //    olursa bu satır da hiç yazılmamış olur (atomik).
      const auditLog = await this.adminAuditService.logAdminAction(
        tenantId,
        userId,
        userEmail,
        'CLOSE',
        'AGREEMENT',
        agreementId,
        undefined,
        'SUCCESS',
        { previousStatus: agreement.status },
        {
          newStatus: AgreementStatus.CLOSED,
          closedAt: closedAt.toISOString(),
          justification: dto?.justification,
          budgetReleases: budgetReleases.map((tx) => ({
            envelopeId: tx.envelopeId,
            amount: Number(tx.amount),
          })),
        },
        dto?.justification,
        { manager: queryRunner.manager },
      );

      await queryRunner.commitTransaction();

      // T-014: CLOSE high-risk aksiyon alarmı, audit satırı gerçekten commit
      // olduktan SONRA tetiklenir (rollback olan bir close için alarm
      // gitmesini önlemek amacıyla). AYRI try/catch: alarm gönderimi
      // (gerçek bir DB yazması içerir) başarısız olursa dıştaki catch'e
      // düşüp zaten commit edilmiş bu queryRunner'da rollbackTransaction()
      // çağrılmamalı — bu hem asıl sonucu maskeler hem de commit olmuş bir
      // close için kullanıcıya yanlışlıkla 500 döndürür. Alarm kaybı,
      // başarılı bir işlemi başarısız göstermekten kat kat iyidir.
      try {
        await this.adminAuditService.flushPendingAlert(auditLog);
      } catch (alertErr) {
        this.logger.error(
          `HIGH-RISK ALERT FAILED — AGREEMENT ${agreementId} closed successfully; alert not delivered: ${
            alertErr instanceof Error ? alertErr.message : 'Unknown error'
          }`,
        );
      }

      return {
        agreementId,
        status: 'CLOSED',
        closedAt,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
