import {
  Injectable,
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
 * DÜZELTME (code-review, 2026-07-27, #3): AUDIT LOG BU TRANSACTION'IN
 * İÇİNDE DEĞİL. `AdminAuditService` kendi `@InjectRepository(AdminAuditLog)`
 * repository'sini kullanır (default connection/manager) — `queryRunner.manager`
 * DEĞİL. Yani audit yazması anında commit olur; adım 5'teki RELEASE ile aynı
 * commit/rollback sınırını PAYLAŞMAZ. Bu servisin geri kalanı rollback olursa
 * (ör. adım 6'dan sonra commitTransaction() başarısız olursa) audit log
 * "SUCCESS + budgetReleases: [...]" olarak KALIR, ama RELEASE ve status=CLOSED
 * geri alınmış olur — audit gerçek durumu yanlış anlatır. Gerçek çözüm
 * (audit'i de aynı queryRunner.manager üzerinden yazan transactional bir audit
 * API'si) T-014 kapsamında; bu servis o güne kadar bu bilinen sınırlamayla
 * yaşar (pratikte commitTransaction() adım 6'dan hemen sonra geldiği için
 * pencere çok dar, ama sıfır değil).
 */

/** Close yalnızca APPROVED veya ACTIVE anlaşmalar için geçerlidir. */
const SETTLEABLE_STATES: AgreementStatus[] = [
  AgreementStatus.APPROVED,
  AgreementStatus.ACTIVE,
];

@Injectable()
export class SettlementCloseService {
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
   *  6. Audit log (immutable) — kod sırası olarak commit'ten ÖNCE çağrılır,
   *     ama #3 (code-review, 2026-07-27): bu, `queryRunner`'ın transaction'ı
   *     İÇİNDE DEĞİLDİR (AdminAuditService kendi default-connection repository'sini
   *     kullanır) — audit yazması anında commit olur, adım 7'deki commit/rollback'i
   *     BEKLEMEZ. Bkz. dosya başındaki DÜZELTME notu; gerçek çözüm T-014.
   *  7. Commit; hata → rollback (adım 5'teki RELEASE geri alınır, adım 6'daki
   *     audit log GERİ ALINMAZ — zaten ayrı connection'da commit olmuştu).
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

      // 6. Immutable audit log. NOT rollback scope içinde (#3, code-review
      //    2026-07-27): AdminAuditService kendi default-connection repository'sini
      //    kullanır, queryRunner.manager'ı DEĞİL — bu satır anında commit olur.
      //    Aşağıdaki commitTransaction() (adım 7) rollback olursa bu audit
      //    kaydı geri alınmaz. Gerçek çözüm (transactional audit) T-014.
      await this.adminAuditService.logAdminAction(
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
      );

      await queryRunner.commitTransaction();

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
