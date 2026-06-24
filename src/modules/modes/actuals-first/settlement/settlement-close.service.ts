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
import { CloseSettlementDto } from './dto';

/**
 * Bir agreement'ı CLOSED state'ine geçiren servis.
 *
 * ÇIFT-SAYIM TUZAĞI (T-003 dersi):
 * ─────────────────────────────────
 * Budget, agreement-transaction oluşturulurken ledger DEBIT kaydıyla tüketilir.
 * LedgerRepository.sumByAgreementId = DEBIT − CREDIT (direction-aware).
 * Bu servis yalnızca agreement.status = CLOSED yapar.
 *
 * CLOSE işleminde KESİNLİKLE:
 *   ✗ Yeni ledger entry yazılmaz
 *   ✗ budget_transactions'a yazılmaz
 *   ✗ consumed_amount güncellenmez
 *
 * Bunların herhangi biri yapılsaydı consumed/budget çift sayılırdı.
 * Bu kural, settlement-close.service.spec.ts'teki
 * "budget/ledger write çağrılMADI" assertion'larıyla güvence altına alınmıştır.
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
  ) {}

  /**
   * Bir agreement'ı CLOSED state'ine geçirir.
   *
   * İşlem sırası (tümü tek QueryRunner içinde):
   *  1. Agreement'ı tenant-scoped FOR UPDATE ile çek → yoksa 404
   *  2. status === CLOSED → 409 ALREADY_SETTLED
   *  3. status APPROVED/ACTIVE değil → 409 NOT_SETTLEABLE_STATE
   *  4. status = CLOSED, closedAt, closedBy güncelle (optimistic lock: version bump)
   *  5. Audit log (immutable) — commit öncesi
   *  6. Commit; hata → rollback
   *
   * NOT: Budget/ledger'a YAZILMAZ (çift-sayım önlemi — yukarıdaki açıklamaya bkz.).
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

      // 5. Immutable audit log — commit öncesi, rollback scope içinde
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
