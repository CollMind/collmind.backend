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
   * null when no budget allocations exist for the period.
   */
  @ApiPropertyOptional({
    description:
      'Budget utilization snapshot (delegated from FinanceReportingService). null if no data.',
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
}
