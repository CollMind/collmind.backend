import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsObject, IsOptional } from 'class-validator';
import { BudgetSummary } from '../../finance-reporting/dto/budget-utilization.dto';

/**
 * DashboardSummaryResponseDto
 *
 * GET /dashboard/summary
 * Count-only metrics; no formulas here — budget utilization comes from FinanceReportingService.
 */
export class DashboardSummaryResponseDto {
  /**
   * The period for which this summary was computed (e.g. "2026-Q2" or "2026-06").
   * Derived from the `period` query param or defaults to current month (YYYY-MM).
   */
  @ApiProperty({
    description: 'Effective period code used for this summary',
    example: '2026-06',
  })
  @IsString()
  periodCode!: string;

  /**
   * Number of agreements with status ACTIVE or APPROVED within the period.
   */
  @ApiProperty({
    description: 'Count of active agreements in scope',
    example: 12,
  })
  @IsNumber()
  activeAgreementCount!: number;

  /**
   * Number of ApprovalRequests with status PENDING for the tenant (or Planner's CPL scope).
   */
  @ApiProperty({
    description: 'Count of pending approval requests in scope',
    example: 3,
  })
  @IsNumber()
  pendingApprovalCount!: number;

  /**
   * Sum of pendingManualClaimCount + awaitingInvoiceCount (i.e. tasks needing action).
   */
  @ApiProperty({
    description: 'Total open task count (manual claims + awaiting invoice)',
    example: 7,
  })
  @IsNumber()
  openTaskCount!: number;

  /**
   * Budget utilization snapshot delegated entirely from FinanceReportingService.
   * Contains onInvoice, offInvoice and total BudgetSummary objects with utilizationPercent and RAG status.
   * null ONLY when it could not be computed — see budgetUtilizationStatus.
   * (It is not null for an empty period; the summary reports zeros instead.)
   */
  @ApiPropertyOptional({
    description:
      'Budget utilization snapshot (delegated from FinanceReportingService). ' +
      'null only when unavailable — read budgetUtilizationStatus to tell why.',
    type: () => Object,
  })
  @IsObject()
  @IsOptional()
  budgetUtilization?: {
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
    total: BudgetSummary;
    periodStart: string;
    periodEnd: string;
  } | null;

  /**
   * T-098: why `budgetUtilization` is null, when it is null.
   *
   * Measured, and it is worse than the docs above admitted: `getBudgetUtilization`
   * returns a summary object even when the period has no allocations (it loops
   * over an empty list and reports zeros), so `budgetUtilization` was NEVER null
   * for lack of data. The only producer of `null` was the swallowed error. The
   * field's own description said "null if no data", which taught every reader to
   * interpret a failure as an empty period — the documentation was the disguise.
   *
   * Hence two states, not three: there is no `empty`, because no code path
   * produces it. Inventing one would add a branch nothing can reach.
   *
   * This is a SEPARATE field rather than a discriminated union on
   * `budgetUtilization`, and that is a measurement, not a style choice: the
   * frontend renders `budgetUtilization.total` as soon as the object is truthy
   * (`DashboardPage.tsx` → `BudgetUtilizationPanel.tsx`), so an `{ status:
   * 'unavailable' }` variant would reach a component that immediately reads
   * `.total` off it. A sibling field cannot break a reader that does not know it
   * exists.
   *
   * `unavailable` is not a transient-retry hint. It means the figures could not be
   * produced, and the UI must say "hesaplanamadı" rather than draw a zero.
   */
  @ApiProperty({
    description:
      'Why budgetUtilization is null: ok = present, unavailable = could not be ' +
      'computed. NEVER render unavailable as zero — it is not a figure.',
    enum: ['ok', 'unavailable'],
  })
  budgetUtilizationStatus!: 'ok' | 'unavailable';
}
