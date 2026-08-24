import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Agreement,
  AgreementStatus,
} from '../../../../database/entities/agreement.entity';
import { UserRole } from '../../../../database/entities/user.entity';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import {
  SettlementSummaryQueryDto,
  SettlementSummaryResponseDto,
  SettlementLineDto,
} from './dto';

/**
 * Settlement Summary Service — read-only aggregation.
 *
 * KAPSAM DIŞI statüler (toplam claim'den hariç tutulur):
 *   CANCELLED | REJECTED | DRAFT | PENDING
 *
 * Sayaç tanımları:
 *   closedCount   = status === CLOSED
 *   settledCount  = status ACTIVE || CLOSED  (kısmen veya tam tamamlanmış; ON_INVOICE statüsü mevcut değil)
 *   pendingCount  = status APPROVED || ACTIVE (hâlâ açık)
 *
 * invoicedAmount = ledger DEBIT − CREDIT (direction-aware via LedgerRepository.sumByAgreementId)
 * remainingAmount = claimAmount − invoicedAmount
 *   → null if claimAmount === 0 (division-by-zero guard, BRD)
 *
 * Scope: AccessScopeService üzerinden çözülür (T-028d — tek scope çıkış
 *   noktası; rol semantiği yalnızca orada tanımlı). PLANNER yalnızca kendi
 *   pair-scoped CPL/kategori kombinasyonlarına ait agreements görür. Scope
 *   boşsa (fail-closed) → boş summary (zero counts, empty lines).
 * Admin/Finance/Readonly: tenant-wide (UNRESTRICTED — AccessScopeService),
 *   ve bu Z30 H8'den beri KOŞULLU: joker user_scopes satırına bağlı
 *   (K-2.6.4f). Satırsız bir ADMIN fail-closed düşer.
 *
 * Her sorgu tenant-scoped. <500ms (mevcut indexler yeterli).
 */

/** Bu statüler "aktif iş" değil; claim toplamına dahil edilmez. */
const EXCLUDED_STATUSES: AgreementStatus[] = [
  AgreementStatus.CANCELLED,
  AgreementStatus.REJECTED,
  AgreementStatus.DRAFT,
  AgreementStatus.PENDING,
];

@Injectable()
export class SettlementSummaryService {
  constructor(
    @InjectRepository(Agreement)
    private readonly agreementRepo: Repository<Agreement>,
    private readonly ledgerRepo: LedgerRepository,
    private readonly accessScopeService: AccessScopeService,
  ) {}

  async getSummary(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    query: SettlementSummaryQueryDto,
  ): Promise<SettlementSummaryResponseDto> {
    // 1. Scope çözümü — AccessScopeService tek çıkış noktası (T-028d).
    // Rol semantiği (kim UNRESTRICTED, pair vs. kategori-only) burada
    // TEKRARLANMAZ; yalnızca AccessScopeService'te tanımlı.
    const scope = await this.accessScopeService.resolveScope(
      tenantId,
      userId,
      userRole,
    );

    // 2. Agreement sorgusunu oluştur
    const qb = this.agreementRepo
      .createQueryBuilder('agreement')
      .where('agreement.tenantId = :tenantId', { tenantId })
      .andWhere('agreement.deletedAt IS NULL')
      .andWhere('agreement.status NOT IN (:...excluded)', {
        excluded: EXCLUDED_STATUSES,
      });

    // Scope kısıtı — UNRESTRICTED ise no-op; SCOPED ise pair-bazlı OR-grubu;
    // scope satırı yoksa fail-closed (1=0).
    this.accessScopeService.applyToQueryBuilder(qb, 'agreement', scope);

    // Query filtreleri
    if (query.cplId) {
      // Planner için kendi scope'u içinde daha da daralt (OR ile değil AND ile)
      qb.andWhere('agreement.cplId = :cplId', { cplId: query.cplId });
    }
    if (query.channelId) {
      qb.andWhere('agreement.channelId = :channelId', {
        channelId: query.channelId,
      });
    }
    if (query.spendType) {
      qb.andWhere('agreement.spendType = :spendType', {
        spendType: query.spendType,
      });
    }
    if (query.status) {
      qb.andWhere('agreement.status = :status', { status: query.status });
    }
    if (query.periodFrom) {
      qb.andWhere('agreement.startDate >= :periodFrom', {
        periodFrom: query.periodFrom,
      });
    }
    if (query.periodTo) {
      qb.andWhere('agreement.endDate <= :periodTo', {
        periodTo: query.periodTo,
      });
    }

    const agreements = await qb
      .select([
        'agreement.id',
        'agreement.agreementCode',
        'agreement.agreementName',
        'agreement.cplId',
        'agreement.status',
        'agreement.spendType',
        'agreement.capTotalAmount',
        'agreement.periodMonth',
        'agreement.closedAt',
        'agreement.closedBy',
      ])
      .getMany();

    if (agreements.length === 0) {
      return this.buildEmptySummary();
    }

    // 3. Her agreement için ledger net invoiced tutarını çek
    const lines: SettlementLineDto[] = await Promise.all(
      agreements.map(async (agr) => {
        const invoicedAmount = await this.ledgerRepo.sumByAgreementId(
          agr.id,
          tenantId,
        );

        const claimAmount = Number(agr.capTotalAmount) || 0;
        // BRD: division-by-zero → null
        const remainingAmount =
          claimAmount === 0 ? null : claimAmount - invoicedAmount;

        return {
          agreementId: agr.id,
          agreementCode: agr.agreementCode,
          agreementName: agr.agreementName,
          cplId: agr.cplId,
          status: agr.status,
          spendType: agr.spendType,
          claimAmount,
          invoicedAmount,
          remainingAmount,
          periodMonth: agr.periodMonth,
          closedAt: agr.closedAt,
          closedBy: agr.closedBy,
        } satisfies SettlementLineDto;
      }),
    );

    // 4. Aggregate counts ve totals
    let closedCount = 0;
    let settledCount = 0;
    let pendingCount = 0;
    let totalClaimAmount = 0;
    let totalInvoicedAmount = 0;

    for (const line of lines) {
      if (line.status === AgreementStatus.CLOSED) closedCount++;
      if (
        line.status === AgreementStatus.ACTIVE ||
        line.status === AgreementStatus.CLOSED
      )
        settledCount++;
      if (
        line.status === AgreementStatus.APPROVED ||
        line.status === AgreementStatus.ACTIVE
      )
        pendingCount++;

      totalClaimAmount += line.claimAmount;
      totalInvoicedAmount += line.invoicedAmount;
    }

    // BRD: division-by-zero guard
    const totalRemainingAmount =
      totalClaimAmount === 0 ? null : totalClaimAmount - totalInvoicedAmount;

    return {
      totalCount: lines.length,
      closedCount,
      settledCount,
      pendingCount,
      totalClaimAmount,
      totalInvoicedAmount,
      totalRemainingAmount,
      lines,
    };
  }

  private buildEmptySummary(): SettlementSummaryResponseDto {
    return {
      totalCount: 0,
      closedCount: 0,
      settledCount: 0,
      pendingCount: 0,
      totalClaimAmount: 0,
      totalInvoicedAmount: 0,
      totalRemainingAmount: null,
      lines: [],
    };
  }
}
