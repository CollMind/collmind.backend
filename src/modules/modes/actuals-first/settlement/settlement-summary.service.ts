import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Agreement,
  AgreementStatus,
} from '../../../../database/entities/agreement.entity';
import { UserScope } from '../../../../database/entities/user-scope.entity';
import { UserRole } from '../../../../database/entities/user.entity';
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
 * Planner scope: yalnızca kendi CPL'lerine atanmış agreements görür.
 *   Scope boşsa → boş summary (zero counts, empty lines).
 * Admin/Manager: tenant-wide.
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
    @InjectRepository(UserScope)
    private readonly userScopeRepo: Repository<UserScope>,
    private readonly ledgerRepo: LedgerRepository,
  ) {}

  async getSummary(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    query: SettlementSummaryQueryDto,
  ): Promise<SettlementSummaryResponseDto> {
    // 1. Planner scope kısıtlaması
    let allowedCplIds: string[] | null = null; // null = tenant-wide (no restriction)

    if (userRole === UserRole.PLANNER) {
      const scopes = await this.userScopeRepo.find({
        where: { userId, tenantId, isActive: true },
        select: ['cplId'],
      });
      allowedCplIds = scopes
        .map((s) => s.cplId)
        .filter((id): id is string => !!id);

      // Scope boşsa boş summary dön
      if (allowedCplIds.length === 0) {
        return this.buildEmptySummary();
      }
    }

    // 2. Agreement sorgusunu oluştur
    const qb = this.agreementRepo
      .createQueryBuilder('agreement')
      .where('agreement.tenantId = :tenantId', { tenantId })
      .andWhere('agreement.deletedAt IS NULL')
      .andWhere('agreement.status NOT IN (:...excluded)', {
        excluded: EXCLUDED_STATUSES,
      });

    // Planner: yalnızca yetkili CPL'ler
    if (allowedCplIds !== null) {
      qb.andWhere('agreement.cplId IN (:...allowedCplIds)', { allowedCplIds });
    }

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
