import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PlanService } from './plan.service';
import { ApprovalWorkflowService } from './approval-workflow.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  AddFuDto,
  RemoveFuDto,
  DeletePlanDto,
  UpdateFuTacticDto,
  UpdateSkuVolumeDto,
  SubmitPlanDto,
  SubmitForApprovalDto,
  ReviewPlanDto,
  ApprovalFilters,
} from './dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { RecalcMetricsInterceptor } from '../../../../common/interceptors/recalc-metrics.interceptor';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';
import { PlanStatus } from '../../../../database/entities/plan.entity';

@ApiTags('Plans')
@ApiBearerAuth()
@Controller('plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlanController {
  constructor(
    private readonly planService: PlanService,
    private readonly approvalWorkflowService: ApprovalWorkflowService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new plan' })
  @ApiResponse({ status: 201, description: 'Plan created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid plan data' })
  create(
    @Body() dto: CreatePlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.create(dto, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get all plans' })
  @ApiResponse({ status: 200, description: 'List of plans' })
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Query('status') status?: PlanStatus,
    @Query('cplId') cplId?: string,
    @Query('channelId') channelId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.planService.findAll(
      tenantId,
      {
        status,
        cplId,
        channelId,
        categoryId,
      },
      { userId: user.id, role: user.role },
    );
  }

  @Get('pending-approvals')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.READONLY)
  @ApiOperation({ summary: 'Get plans pending approval' })
  @ApiResponse({ status: 200, description: 'List of plans pending approval' })
  findPendingApprovals(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.findPendingApprovals(tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  // T-028a FIX: 'approval-queue' tek segmentli bir literal route olduğu için
  // ':id' parametrik route'undan (aşağıda) ÖNCE tanımlanmalı — aksi halde
  // Nest/Express route matching sırası nedeniyle "approval-queue" string'i
  // ':id' parametresi olarak yakalanır (findById('approval-queue') → uuid
  // parse hatası, 500). 'pending-approvals' zaten bu kuralı doğru uyguluyordu;
  // 'approval-queue' önceden ':id'den SONRA tanımlıydı — CM Roles listesine
  // eklenene kadar hiçbir e2e testi bu path'i egzersiz etmediği için bug
  // gizli kalmıştı.
  @Get('approval-queue')
  @Roles(
    UserRole.ADMIN,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get approval queue for current user' })
  @ApiResponse({ status: 200, description: 'List of pending plans' })
  getApprovalQueue(
    @Query() filters: ApprovalFilters,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.approvalWorkflowService.getApprovalQueue(
      user.id,
      tenantId,
      filters,
      user.role,
    );
  }

  // Spesifik route'lar parametrik route'dan ÖNCE tanımlanmalı
  @Get(':id/budget-check')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Check budget availability for plan approval' })
  @ApiResponse({
    status: 200,
    description:
      'Budget check result. `bySpendType` is a per-type breakdown ' +
      '(onInvoice/offInvoice) that is ALWAYS present once an envelope of ' +
      'either type exists, but its two entries are the SAME UNSPLIT ' +
      'envelope reported twice unless `splitDimension: true` (T-057 S3) — ' +
      'callers must check `splitDimension` before treating `bySpendType` as ' +
      'evidence of two independent budget pools.',
  })
  budgetCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.checkBudget(id, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Get(':id/analysis')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get plan analysis data' })
  @ApiResponse({ status: 200, description: 'Plan analysis data' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  getAnalysis(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.getAnalysis(id, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get plan by ID' })
  @ApiResponse({ status: 200, description: 'Plan details' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.findById(id, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Update plan (DRAFT only)' })
  @ApiResponse({ status: 200, description: 'Plan updated successfully' })
  @ApiResponse({ status: 400, description: 'Only DRAFT plans can be edited' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.update(id, dto, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/fus')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @UseInterceptors(RecalcMetricsInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add FU to plan' })
  @ApiResponse({ status: 201, description: 'FU added successfully' })
  addFu(
    @Param('id', ParseUUIDPipe) planId: string,
    @Body() dto: AddFuDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.addFu(planId, dto, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }

  @Patch(':id/fus/:fuId/tactics')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @UseInterceptors(RecalcMetricsInterceptor)
  @ApiOperation({ summary: 'Update FU tactic values' })
  @ApiResponse({ status: 200, description: 'FU tactics updated successfully' })
  updateFuTactic(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('fuId', ParseUUIDPipe) fuId: string,
    @Body() dto: UpdateFuTacticDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.updateFuTactic(planId, fuId, dto, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Delete(':id/fus/:fuId')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @UseInterceptors(RecalcMetricsInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove FU from plan' })
  @ApiResponse({ status: 204, description: 'FU removed successfully' })
  @ApiResponse({
    status: 409,
    description: 'STALE_VERSION / MISSING_VERSION (optimistic locking, T-034)',
  })
  async removeFu(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('fuId', ParseUUIDPipe) fuId: string,
    @Body() dto: RemoveFuDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // T-041: 204 No Content carries no body — the post-CAS-bump plan
    // version goes out as a response header instead (see
    // PlanService#removeFu's doc comment; header exposed to browsers via
    // `exposedHeaders` in main.ts, same pattern as X-Recalc-Ms/T-046d).
    const { planVersion } = await this.planService.removeFu(
      planId,
      fuId,
      tenantId,
      dto,
      { userId: user.id, role: user.role },
    );
    res.setHeader('X-Plan-Version', String(planVersion));
  }

  @Patch(':id/fus/:fuId/skus/:skuId/volume')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @UseInterceptors(RecalcMetricsInterceptor)
  @ApiOperation({ summary: 'Update SKU volume' })
  @ApiResponse({ status: 200, description: 'SKU volume updated successfully' })
  updateSkuVolume(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('fuId', ParseUUIDPipe) fuId: string,
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: UpdateSkuVolumeDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.updateSkuVolume(
      planId,
      fuId,
      skuId,
      dto,
      tenantId,
      { userId: user.id, role: user.role },
    );
  }

  @Post(':id/submit')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit plan for approval (legacy)' })
  @ApiResponse({ status: 200, description: 'Plan submitted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only DRAFT plans can be submitted',
  })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.submit(
      id,
      tenantId,
      user.id,
      { userId: user.id, role: user.role },
      dto?.version,
    );
  }

  @Post(':id/submit-for-approval')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit plan for approval with pre-submission checks',
    deprecated: true,
    description:
      // T-056 adım 7 (ADR 0005 K1, deprecation faz 1): para yolu artık
      // POST /plans/:id/submit ile ortak (aynı reserveTypedForPlan motoru).
      // Bu uç yaşamaya devam eder (davranış/sözleşme değişmedi); kaldırma
      // faz 2'dir ([[T-058]]).
      'DEPRECATED — use POST /plans/:id/submit instead. This endpoint remains functional (behavior unchanged) but will be removed in a future release (T-056/ADR 0005, phase 2 tracked as T-058).',
  })
  @ApiResponse({ status: 200, description: 'Plan submitted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or insufficient budget',
  })
  submitForApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitForApprovalDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Res({ passthrough: true }) res: Response,
  ) {
    // T-056 adım 7: HTTP Deprecation sinyali (ADR 0005 K1). Endpoint hâlâ
    // yaşıyor — yalnız uyarı, davranış değişmiyor.
    res.setHeader('Deprecation', 'true');
    return this.approvalWorkflowService.submitForApproval(
      id,
      tenantId,
      user.id,
      dto,
      { userId: user.id, role: user.role },
    );
  }

  @Post(':id/review')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.FINANCE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Review plan (approve/reject/request changes/escalate)',
  })
  @ApiResponse({ status: 200, description: 'Review completed successfully' })
  @ApiResponse({
    status: 400,
    description: 'Invalid review decision or missing required fields',
  })
  reviewPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.approvalWorkflowService.reviewPlan(
      id,
      tenantId,
      user.id,
      dto,
      user.role,
    );
  }

  @Post(':id/escalate-to-finance')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Escalate plan to Finance Manager' })
  @ApiResponse({ status: 200, description: 'Plan escalated successfully' })
  escalateToFinance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string; comments?: string },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.approvalWorkflowService.escalateToFinance(
      id,
      tenantId,
      user.id,
      body.reason,
      body.comments,
      { userId: user.id, role: user.role },
    );
  }

  @Get(':id/approval-history')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get plan approval history' })
  @ApiResponse({ status: 200, description: 'Approval history entries' })
  getApprovalHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.approvalWorkflowService.getPlanApprovalHistory(id, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve plan' })
  @ApiResponse({ status: 200, description: 'Plan approved successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only PENDING_APPROVAL plans can be approved',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      comments?: string;
      autoCreateBudget?: boolean;
      budgetAmount?: number;
    },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.approve(
      id,
      tenantId,
      user.id,
      body.comments,
      body.autoCreateBudget,
      body.budgetAmount,
      { userId: user.id, role: user.role },
    );
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject plan' })
  @ApiResponse({ status: 200, description: 'Plan rejected successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only PENDING_APPROVAL plans can be rejected',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.reject(id, tenantId, user.id, body.reason, {
      userId: user.id,
      role: user.role,
    });
  }

  // T-033: BRD plan state machine — Rejected → Draft. CATEGORY_MANAGER is
  // intentionally excluded from @Roles (BRD "CM plan düzenleyemez") — the
  // guard alone yields 403 for CM, no service-level role check needed.
  // Ownership (PLANNER may only return their own plan) is enforced in
  // PlanService#returnToDraft.
  @Post(':id/return-to-draft')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return a REJECTED plan to DRAFT for revision' })
  @ApiResponse({ status: 200, description: 'Plan returned to draft' })
  @ApiResponse({
    status: 409,
    description: 'Only REJECTED plans can be returned to draft',
  })
  returnToDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.returnToDraft(id, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete plan (DRAFT only)' })
  @ApiResponse({ status: 204, description: 'Plan deleted successfully' })
  @ApiResponse({ status: 400, description: 'Only DRAFT plans can be deleted' })
  @ApiResponse({
    status: 409,
    description: 'STALE_VERSION / MISSING_VERSION (optimistic locking, T-034)',
  })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeletePlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.delete(id, tenantId, dto, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/calculate-kpis')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @UseInterceptors(RecalcMetricsInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate KPIs for a plan using KPI engine' })
  @ApiResponse({ status: 200, description: 'KPI calculation results' })
  calculateKpis(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.planService.calculateKpis(id, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/recalculate')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @UseInterceptors(RecalcMetricsInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger full recalculation for a plan' })
  @ApiResponse({ status: 200, description: 'Recalculation complete' })
  async recalculate(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const actor = { userId: user.id, role: user.role };
    await this.planService.recalculatePlanWithKpiEngine(id, tenantId, actor);
    return this.planService.findById(id, tenantId, actor);
  }
}
