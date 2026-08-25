import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import {
  DashboardSummaryQueryDto,
  PendingTasksQueryDto,
} from './dto/dashboard-query.dto';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary.dto';
import { PendingTasksResponseDto } from './dto/pending-tasks.dto';
import { CplStatusResponseDto } from './dto/cpl-status.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../database/entities/user.entity';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * GET /dashboard/summary
   *
   * Lightweight summary card data for the main dashboard.
   * - activeAgreementCount: agreements in ACTIVE/APPROVED state within period scope
   * - pendingApprovalCount: ApprovalRequests with status PENDING in user scope
   * - openTaskCount: awaiting-invoice off-invoice agreements count
   * - budgetUtilization: delegated entirely from FinanceReportingService (no formulas here)
   *
   * Planner: scoped to their assigned CPLs.
   * All other roles: tenant-wide.
   */
  @Get('summary')
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.PLANNER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get dashboard summary card metrics' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard summary — counts and budget utilization snapshot',
    type: DashboardSummaryResponseDto,
  })
  getSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Query() query: DashboardSummaryQueryDto,
  ): Promise<DashboardSummaryResponseDto> {
    return this.dashboardService.getSummary(
      tenantId,
      user.id,
      user.role,
      query,
    );
  }

  /**
   * GET /dashboard/pending-tasks
   *
   * Actionable task lists for the logged-in user:
   * - pendingApprovals: agreements in PENDING state needing approval action
   * - pendingManualClaims: ACTIVE off-invoice agreements with no claim yet
   * - submittedClaims: PENDING agreements awaiting finance review
   * - awaitingInvoiceClaims: ACTIVE/APPROVED off-invoice agreements with consumed spend
   *
   * Planner: scoped to their CPL assignments. All other roles: tenant-wide.
   */
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  @Get('pending-tasks')
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @ApiOperation({
    summary: 'Get actionable pending tasks for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Pending tasks broken down by category',
    type: PendingTasksResponseDto,
  })
  getPendingTasks(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Query() query: PendingTasksQueryDto,
  ): Promise<PendingTasksResponseDto> {
    return this.dashboardService.getPendingTasks(
      tenantId,
      user.id,
      user.role,
      query,
    );
  }

  /**
   * GET /dashboard/cpl-status
   *
   * Per-CPL action summary. Useful for the CPL overview table on the dashboard.
   * Returns counts of STA/LTA agreements, pending actions, and an isUpToDate flag.
   *
   * Planner: only CPLs in their UserScope. Others: all tenant CPLs.
   */
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  @Get('cpl-status')
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @ApiOperation({ summary: 'Get per-CPL action status summary' })
  @ApiResponse({
    status: 200,
    description: 'CPL status items with action counters',
    type: CplStatusResponseDto,
  })
  getCplStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ): Promise<CplStatusResponseDto> {
    return this.dashboardService.getCplStatus(tenantId, user.id, user.role);
  }
}
