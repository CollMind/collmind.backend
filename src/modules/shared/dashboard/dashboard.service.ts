import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, In, Repository } from 'typeorm';
import {
  Agreement,
  AgreementStatus,
  AgreementType,
  SpendType,
} from '../../../database/entities/agreement.entity';
import { UserScope } from '../../../database/entities/user-scope.entity';
import { Cpl } from '../../../database/entities/cpl.entity';
import {
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestType,
} from '../../../database/entities/approval-request.entity';
import { UserRole } from '../../../database/entities/user.entity';
import { FinanceReportingService } from '../finance-reporting/finance-reporting.service';
import { ReportFilters } from '../finance-reporting/dto/report-filters.dto';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary.dto';
import {
  PendingTasksResponseDto,
  PendingApprovalItemDto,
  PendingManualClaimItemDto,
  SubmittedClaimItemDto,
  AwaitingInvoiceClaimItemDto,
} from './dto/pending-tasks.dto';
import { CplStatusResponseDto, CplStatusItemDto } from './dto/cpl-status.dto';
import {
  DashboardSummaryQueryDto,
  PendingTasksQueryDto,
} from './dto/dashboard-query.dto';

/**
 * DashboardService — pure orchestrator.
 *
 * BRD RULE: This service contains ZERO formula / KPI / ROI / RAG / threshold computations.
 * - Count aggregation on Agreement/ApprovalRequest rows is allowed (simple count/sum-of-counts).
 * - Budget utilization, RAG status, spend figures → delegated 100% to FinanceReportingService.
 * - All queries are tenant-scoped. Planner role resolves CPL scope from UserScope first.
 * - Sub-service calls are parallelised via Promise.all for <500ms target.
 *
 * No raw SQL. Repository / service pattern only.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(Agreement)
    private readonly agreementRepo: Repository<Agreement>,

    @InjectRepository(UserScope)
    private readonly userScopeRepo: Repository<UserScope>,

    @InjectRepository(Cpl)
    private readonly cplRepo: Repository<Cpl>,

    @InjectRepository(ApprovalRequest)
    private readonly approvalRequestRepo: Repository<ApprovalRequest>,

    private readonly financeReportingService: FinanceReportingService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /dashboard/summary
  // ---------------------------------------------------------------------------

  async getSummary(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    query: DashboardSummaryQueryDto,
  ): Promise<DashboardSummaryResponseDto> {
    const periodCode = this.resolveEffectivePeriod(query.period);
    const cplIds = await this.resolveCplScope(tenantId, userId, userRole);

    // Derive date range for budget utilization from period code
    const { startDate, endDate } = this.periodToDateRange(periodCode);

    // Build base agreement WHERE conditions (tenant-scoped, period-scoped)
    const agreementWhere = this.buildAgreementWhere(
      tenantId,
      cplIds,
      periodCode,
    );

    // Run all count queries in parallel — no formulas here, only counts
    const [activeAgreements, pendingApprovalRequests, activeWithConsumedSpend] =
      await Promise.all([
        // 1. Active agreements count (ACTIVE + APPROVED).
        // buildAgreementWhere already returns one condition per status
        // (ACTIVE | APPROVED) — no further filtering needed here.
        this.agreementRepo.count({
          where: agreementWhere,
        }),

        // 2. Pending approval requests count — scoped via cplIds if Planner
        this.countPendingApprovals(tenantId, cplIds),

        // 3. Awaiting invoice: ACTIVE/APPROVED agreements with consumed > 0 (off-invoice)
        this.countAwaitingInvoice(tenantId, cplIds, periodCode),
      ]);

    // 4. Budget utilization — fully delegated to FinanceReportingService
    const budgetFilters: ReportFilters = {
      startDate,
      endDate,
      ...(cplIds !== null ? { cplIds } : {}),
    };

    let budgetUtilization: DashboardSummaryResponseDto['budgetUtilization'] =
      null;
    try {
      const raw = await this.financeReportingService.getBudgetUtilization(
        tenantId,
        budgetFilters,
      );
      budgetUtilization = {
        onInvoice: raw.onInvoice,
        offInvoice: raw.offInvoice,
        total: raw.total,
        periodStart: raw.periodStart,
        periodEnd: raw.periodEnd,
      };
    } catch (err) {
      this.logger.warn('getBudgetUtilization failed — returning null', err);
    }

    const openTaskCount = activeWithConsumedSpend;

    return {
      periodCode,
      activeAgreementCount: activeAgreements,
      pendingApprovalCount: pendingApprovalRequests,
      openTaskCount,
      budgetUtilization,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /dashboard/pending-tasks
  // ---------------------------------------------------------------------------

  async getPendingTasks(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    query: PendingTasksQueryDto,
  ): Promise<PendingTasksResponseDto> {
    const periodCode = this.resolveEffectivePeriod(query.period);
    const includePast = query.includePast ?? false;
    const cplIds = await this.resolveCplScope(tenantId, userId, userRole);

    // Fetch in parallel
    const [
      pendingApprovals,
      pendingManualClaims,
      submittedClaims,
      awaitingInvoiceClaims,
    ] = await Promise.all([
      this.fetchPendingApprovals(tenantId, cplIds, periodCode),
      this.fetchPendingManualClaims(tenantId, cplIds, periodCode, includePast),
      this.fetchSubmittedClaims(tenantId, cplIds, periodCode, includePast),
      this.fetchAwaitingInvoiceClaims(
        tenantId,
        cplIds,
        periodCode,
        includePast,
      ),
    ]);

    return {
      pendingApprovals,
      pendingManualClaims,
      submittedClaims,
      awaitingInvoiceClaims,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /dashboard/cpl-status
  // ---------------------------------------------------------------------------

  async getCplStatus(
    tenantId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<CplStatusResponseDto> {
    const cplIds = await this.resolveCplScope(tenantId, userId, userRole);

    // Fetch CPL records
    const cpls = await this.fetchCpls(tenantId, cplIds);
    if (cpls.length === 0) {
      return { items: [] };
    }

    const allCplIds = cpls.map((c) => c.id);

    // Fetch agreements for all CPLs in scope (excluding non-relevant statuses)
    const agreements = await this.agreementRepo.find({
      where: {
        tenantId,
        cplId: In(allCplIds),
      },
      relations: ['cpl', 'channel'],
      select: {
        id: true,
        cplId: true,
        agreementType: true,
        status: true,
        periodMonth: true,
        consumedAmount: true,
        spendType: true,
      } satisfies FindOptionsSelect<Agreement>,
    });

    // Build per-CPL status items
    const items: CplStatusItemDto[] = cpls.map((cpl) => {
      const cplAgreements = agreements.filter((a) => a.cplId === cpl.id);

      const staCount = cplAgreements.filter(
        (a) =>
          a.agreementType === AgreementType.STA &&
          (a.status === AgreementStatus.ACTIVE ||
            a.status === AgreementStatus.APPROVED),
      ).length;

      const ltaCount = cplAgreements.filter(
        (a) =>
          a.agreementType === AgreementType.LTA &&
          (a.status === AgreementStatus.ACTIVE ||
            a.status === AgreementStatus.APPROVED),
      ).length;

      const pendingApproval = cplAgreements.filter(
        (a) => a.status === AgreementStatus.PENDING,
      ).length;

      // Manual pending: ACTIVE agreements with off-invoice or BOTH spend type & no consumed yet
      // (simplified: consumedAmount === 0 means no claim posted)
      const pendingManual = cplAgreements.filter(
        (a) =>
          a.status === AgreementStatus.ACTIVE &&
          (a.spendType === SpendType.OFF_INVOICE ||
            a.spendType === SpendType.BOTH) &&
          Number(a.consumedAmount) === 0,
      ).length;

      // Awaiting invoice: APPROVED/ACTIVE with off-invoice spend and consumed > 0
      const awaitingInvoice = cplAgreements.filter(
        (a) =>
          (a.status === AgreementStatus.ACTIVE ||
            a.status === AgreementStatus.APPROVED) &&
          (a.spendType === SpendType.OFF_INVOICE ||
            a.spendType === SpendType.BOTH) &&
          Number(a.consumedAmount) > 0,
      ).length;

      const isUpToDate =
        pendingApproval === 0 && pendingManual === 0 && awaitingInvoice === 0;

      return {
        cplId: cpl.id,
        cplName: cpl.name,
        channelCode: (cpl as any).channel?.code ?? 'N/A',
        staCount,
        ltaCount,
        pendingApproval,
        pendingManual,
        awaitingInvoice,
        isUpToDate,
      };
    });

    return { items };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the CPL IDs the user is allowed to see.
   * - PLANNER: only their UserScope CPL assignments.
   * - All other roles (ADMIN, MANAGER, FINANCE, CATEGORY_MANAGER, READONLY): null = tenant-wide.
   * Returns null for unrestricted access, or string[] (may be empty for Planner with no scope).
   */
  private async resolveCplScope(
    tenantId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<string[] | null> {
    if (userRole !== UserRole.PLANNER) {
      return null; // tenant-wide access
    }

    // tenantId WHERE zorunlu — cross-tenant CPL yalıtımı için kritik, KALDIRMAYIN.
    const scopes = await this.userScopeRepo.find({
      where: { userId, tenantId, isActive: true },
      select: ['cplId'] as any,
    });

    return scopes.map((s) => s.cplId).filter((id): id is string => !!id);
  }

  /**
   * Resolve effective period string. Defaults to current YYYY-MM.
   */
  private resolveEffectivePeriod(period?: string): string {
    if (period && period.trim()) {
      return period.trim();
    }
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }

  /**
   * Convert period code to a {startDate, endDate} string pair suitable for ReportFilters.
   * Supports YYYY-MM (month), YYYY-QN (quarter), "ALL" (full year so far).
   */
  private periodToDateRange(period: string): {
    startDate: string;
    endDate: string;
  } {
    if (period === 'ALL') {
      const year = new Date().getFullYear();
      return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
    }

    const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(period);
    if (quarterMatch) {
      const year = parseInt(quarterMatch[1]!, 10);
      const quarter = parseInt(quarterMatch[2]!, 10);
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${this.lastDayOfMonth(year, endMonth)}`;
      return { startDate, endDate };
    }

    // Default: YYYY-MM
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(period);
    if (monthMatch) {
      const year = parseInt(monthMatch[1]!, 10);
      const month = parseInt(monthMatch[2]!, 10);
      const startDate = `${period}-01`;
      const endDate = `${period}-${this.lastDayOfMonth(year, month)}`;
      return { startDate, endDate };
    }

    // Fallback: treat as current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const mm = String(month).padStart(2, '0');
    return {
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-${this.lastDayOfMonth(year, month)}`,
    };
  }

  private lastDayOfMonth(year: number, month: number): string {
    return String(new Date(year, month, 0).getDate()).padStart(2, '0');
  }

  /**
   * Build a list of TypeORM `where` objects covering the relevant agreement statuses.
   * Each object in the array is OR'd by TypeORM's find options syntax.
   */
  private buildAgreementWhere(
    tenantId: string,
    cplIds: string[] | null,
    period: string,
  ): Array<Record<string, any>> {
    const base: Record<string, any> = { tenantId };

    if (cplIds !== null) {
      base.cplId = In(cplIds);
    }

    if (period !== 'ALL') {
      base.periodMonth = period;
    }

    // Return separate conditions per status (TypeORM OR semantics)
    return [
      { ...base, status: AgreementStatus.ACTIVE },
      { ...base, status: AgreementStatus.APPROVED },
    ];
  }

  /**
   * Count pending ApprovalRequests for agreements in scope.
   * Planner: only requests for agreements in their CPL scope.
   * Admin/others: all tenant pending requests.
   *
   * IMPORTANT: requestType filter (AGREEMENT) is mandatory here.
   * ApprovalRequest is polymorphic — rows of type PLAN, BUDGET_TRANSFER,
   * IMPORT_BATCH, etc. share the same table. Without this filter the count
   * would include non-agreement approvals and produce an incorrect summary card.
   */
  private async countPendingApprovals(
    tenantId: string,
    cplIds: string[] | null,
  ): Promise<number> {
    const qb = this.approvalRequestRepo
      .createQueryBuilder('ar')
      .where('ar.tenantId = :tenantId', { tenantId })
      .andWhere('ar.status = :status', {
        status: ApprovalRequestStatus.PENDING,
      })
      // Polymorphic filter — only agreement-approval rows belong on the dashboard.
      .andWhere('ar.requestType = :requestType', {
        requestType: ApprovalRequestType.AGREEMENT,
      })
      .andWhere('ar.deletedAt IS NULL');

    if (cplIds !== null) {
      if (cplIds.length === 0) return 0;
      // Scope via agreement's cplId — join agreement to filter
      qb.innerJoin(
        Agreement,
        'ag',
        'ag.id = ar.entityId AND ag.tenantId = :tenantId AND ag.cplId IN (:...cplIds)',
        { cplIds },
      );
    }

    return qb.getCount();
  }

  /**
   * Count awaiting invoice: ACTIVE/APPROVED off-invoice agreements with consumedAmount > 0.
   * This represents "open tasks" for the summary card — no claim amount formula, just count.
   */
  private async countAwaitingInvoice(
    tenantId: string,
    cplIds: string[] | null,
    period: string,
  ): Promise<number> {
    if (cplIds !== null && cplIds.length === 0) return 0;

    const qb = this.agreementRepo
      .createQueryBuilder('ag')
      .where('ag.tenantId = :tenantId', { tenantId })
      .andWhere('ag.status IN (:...statuses)', {
        statuses: [AgreementStatus.ACTIVE, AgreementStatus.APPROVED],
      })
      .andWhere('ag.spendType IN (:...spendTypes)', {
        spendTypes: [SpendType.OFF_INVOICE, SpendType.BOTH],
      })
      .andWhere('ag.consumedAmount > 0')
      .andWhere('ag.deletedAt IS NULL');

    if (period !== 'ALL') {
      qb.andWhere('ag.periodMonth = :period', { period });
    }

    if (cplIds !== null) {
      qb.andWhere('ag.cplId IN (:...cplIds)', { cplIds });
    }

    return qb.getCount();
  }

  // ---------------------------------------------------------------------------
  // Pending tasks fetch helpers
  // ---------------------------------------------------------------------------

  private async fetchPendingApprovals(
    tenantId: string,
    cplIds: string[] | null,
    period: string,
  ): Promise<PendingApprovalItemDto[]> {
    if (cplIds !== null && cplIds.length === 0) return [];

    const qb = this.agreementRepo
      .createQueryBuilder('ag')
      .leftJoinAndSelect('ag.cpl', 'cpl')
      .leftJoinAndSelect('ag.channel', 'channel')
      .where('ag.tenantId = :tenantId', { tenantId })
      .andWhere('ag.status = :status', { status: AgreementStatus.PENDING })
      .andWhere('ag.deletedAt IS NULL');

    if (period !== 'ALL') {
      qb.andWhere('ag.periodMonth = :period', { period });
    }
    if (cplIds !== null) {
      qb.andWhere('ag.cplId IN (:...cplIds)', { cplIds });
    }

    qb.orderBy('ag.periodMonth', 'ASC').addOrderBy('ag.agreementCode', 'ASC');

    const agreements = await qb.getMany();

    return agreements.map((ag) => ({
      agreementId: ag.id,
      agreementName: ag.agreementName ?? ag.agreementCode,
      agreementType: ag.agreementType,
      cplName: (ag as any).cpl?.name ?? ag.cplId,
      channelCode: (ag as any).channel?.code ?? 'N/A',
      period: ag.periodMonth,
      status: ag.status,
    }));
  }

  private async fetchPendingManualClaims(
    tenantId: string,
    cplIds: string[] | null,
    period: string,
    includePast: boolean,
  ): Promise<PendingManualClaimItemDto[]> {
    if (cplIds !== null && cplIds.length === 0) return [];

    const qb = this.agreementRepo
      .createQueryBuilder('ag')
      .leftJoinAndSelect('ag.cpl', 'cpl')
      .leftJoinAndSelect('ag.channel', 'channel')
      .where('ag.tenantId = :tenantId', { tenantId })
      .andWhere('ag.status = :status', { status: AgreementStatus.ACTIVE })
      // Off-invoice / BOTH agreements without any consumed amount are "unclaimed manual"
      .andWhere('ag.spendType IN (:...spendTypes)', {
        spendTypes: [SpendType.OFF_INVOICE, SpendType.BOTH],
      })
      .andWhere('ag.consumedAmount = 0')
      .andWhere('ag.deletedAt IS NULL');

    const currentPeriod = this.resolveEffectivePeriod(undefined);
    if (!includePast) {
      qb.andWhere('ag.periodMonth >= :currentPeriod', { currentPeriod });
    }
    if (period !== 'ALL') {
      qb.andWhere('ag.periodMonth = :period', { period });
    }
    if (cplIds !== null) {
      qb.andWhere('ag.cplId IN (:...cplIds)', { cplIds });
    }

    qb.orderBy('ag.periodMonth', 'ASC').addOrderBy('ag.agreementCode', 'ASC');

    const agreements = await qb.getMany();

    return agreements.map((ag) => ({
      agreementId: ag.id,
      agreementName: ag.agreementName ?? ag.agreementCode,
      agreementType: ag.agreementType,
      cplName: (ag as any).cpl?.name ?? ag.cplId,
      channelCode: (ag as any).channel?.code ?? 'N/A',
      period: ag.periodMonth,
      capTotalAmount: Number(ag.capTotalAmount),
      isPastPeriod: ag.periodMonth < currentPeriod,
    }));
  }

  private async fetchSubmittedClaims(
    tenantId: string,
    cplIds: string[] | null,
    period: string,
    includePast: boolean,
  ): Promise<SubmittedClaimItemDto[]> {
    if (cplIds !== null && cplIds.length === 0) return [];

    // CTPM doesn't have a separate Claim entity yet.
    // "Submitted" = PENDING agreements (submitted for approval but not yet approved).
    // This mirrors TTM's submitted_claims concept in CTPM's domain.
    const qb = this.agreementRepo
      .createQueryBuilder('ag')
      .leftJoinAndSelect('ag.cpl', 'cpl')
      .leftJoinAndSelect('ag.channel', 'channel')
      .where('ag.tenantId = :tenantId', { tenantId })
      .andWhere('ag.status = :status', { status: AgreementStatus.PENDING })
      .andWhere('ag.deletedAt IS NULL');

    const currentPeriod = this.resolveEffectivePeriod(undefined);
    if (!includePast) {
      qb.andWhere('ag.periodMonth >= :currentPeriod', { currentPeriod });
    }
    if (period !== 'ALL') {
      qb.andWhere('ag.periodMonth = :period', { period });
    }
    if (cplIds !== null) {
      qb.andWhere('ag.cplId IN (:...cplIds)', { cplIds });
    }

    qb.orderBy('ag.updatedAt', 'ASC');

    const agreements = await qb.getMany();

    return agreements.map((ag) => ({
      agreementId: ag.id,
      agreementName: ag.agreementName ?? ag.agreementCode,
      agreementType: ag.agreementType,
      cplName: (ag as any).cpl?.name ?? ag.cplId,
      channelCode: (ag as any).channel?.code ?? 'N/A',
      period: ag.periodMonth,
      consumedAmount: Number(ag.consumedAmount),
    }));
  }

  private async fetchAwaitingInvoiceClaims(
    tenantId: string,
    cplIds: string[] | null,
    period: string,
    includePast: boolean,
  ): Promise<AwaitingInvoiceClaimItemDto[]> {
    if (cplIds !== null && cplIds.length === 0) return [];

    const qb = this.agreementRepo
      .createQueryBuilder('ag')
      .leftJoinAndSelect('ag.cpl', 'cpl')
      .leftJoinAndSelect('ag.channel', 'channel')
      .where('ag.tenantId = :tenantId', { tenantId })
      .andWhere('ag.status IN (:...statuses)', {
        statuses: [AgreementStatus.ACTIVE, AgreementStatus.APPROVED],
      })
      .andWhere('ag.spendType IN (:...spendTypes)', {
        spendTypes: [SpendType.OFF_INVOICE, SpendType.BOTH],
      })
      .andWhere('ag.consumedAmount > 0')
      .andWhere('ag.deletedAt IS NULL');

    const currentPeriod = this.resolveEffectivePeriod(undefined);
    if (!includePast) {
      qb.andWhere('ag.periodMonth >= :currentPeriod', { currentPeriod });
    }
    if (period !== 'ALL') {
      qb.andWhere('ag.periodMonth = :period', { period });
    }
    if (cplIds !== null) {
      qb.andWhere('ag.cplId IN (:...cplIds)', { cplIds });
    }

    qb.orderBy('ag.updatedAt', 'ASC');

    const agreements = await qb.getMany();
    const now = Date.now();

    return agreements.map((ag) => {
      const daysWaiting = ag.updatedAt
        ? Math.floor(
            (now - new Date(ag.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : undefined;

      return {
        agreementId: ag.id,
        agreementName: ag.agreementName ?? ag.agreementCode,
        agreementType: ag.agreementType,
        cplName: (ag as any).cpl?.name ?? ag.cplId,
        channelCode: (ag as any).channel?.code ?? 'N/A',
        period: ag.periodMonth,
        consumedAmount: Number(ag.consumedAmount),
        isPastPeriod: ag.periodMonth < currentPeriod,
        daysWaiting,
      };
    });
  }

  private async fetchCpls(
    tenantId: string,
    cplIds: string[] | null,
  ): Promise<Cpl[]> {
    if (cplIds !== null && cplIds.length === 0) return [];

    const where: Record<string, any> = { tenantId };
    if (cplIds !== null) {
      where.id = In(cplIds);
    }

    return this.cplRepo.find({
      where,
      relations: ['channel'],
      order: { name: 'ASC' },
    });
  }
}
