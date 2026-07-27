import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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
  UpdateFuTacticDto,
  UpdateSkuVolumeDto,
  SubmitForApprovalDto,
  ReviewPlanDto,
  ApprovalFilters,
} from './dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
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
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.create(dto, tenantId, user.id);
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get all plans' })
  @ApiResponse({ status: 200, description: 'List of plans' })
  findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: PlanStatus,
    @Query('cplId') cplId?: string,
    @Query('channelId') channelId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.planService.findAll(tenantId, {
      status,
      cplId,
      channelId,
      categoryId,
    });
  }

  @Get('pending-approvals')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.READONLY)
  @ApiOperation({ summary: 'Get plans pending approval' })
  @ApiResponse({ status: 200, description: 'List of plans pending approval' })
  findPendingApprovals(@TenantId() tenantId: string) {
    return this.planService.findPendingApprovals(tenantId);
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
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get approval queue for current user' })
  @ApiResponse({ status: 200, description: 'List of pending plans' })
  getApprovalQueue(
    @Query() filters: ApprovalFilters,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.approvalWorkflowService.getApprovalQueue(
      user.id,
      tenantId,
      filters,
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
  @ApiResponse({ status: 200, description: 'Budget check result' })
  budgetCheck(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.planService.checkBudget(id, tenantId);
  }

  @Get(':id/analysis')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get plan analysis data' })
  @ApiResponse({ status: 200, description: 'Plan analysis data' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  getAnalysis(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.planService.getAnalysis(id, tenantId);
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get plan by ID' })
  @ApiResponse({ status: 200, description: 'Plan details' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.planService.findById(id, tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Update plan (DRAFT only)' })
  @ApiResponse({ status: 200, description: 'Plan updated successfully' })
  @ApiResponse({ status: 400, description: 'Only DRAFT plans can be edited' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.update(id, dto, tenantId, user.id);
  }

  @Post(':id/fus')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add FU to plan' })
  @ApiResponse({ status: 201, description: 'FU added successfully' })
  addFu(
    @Param('id') planId: string,
    @Body() dto: AddFuDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.addFu(planId, dto, tenantId, user.id);
  }

  @Patch(':id/fus/:fuId/tactics')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Update FU tactic values' })
  @ApiResponse({ status: 200, description: 'FU tactics updated successfully' })
  updateFuTactic(
    @Param('id') planId: string,
    @Param('fuId') fuId: string,
    @Body() dto: UpdateFuTacticDto,
    @TenantId() tenantId: string,
  ) {
    return this.planService.updateFuTactic(planId, fuId, dto, tenantId);
  }

  @Delete(':id/fus/:fuId')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove FU from plan' })
  @ApiResponse({ status: 204, description: 'FU removed successfully' })
  removeFu(
    @Param('id') planId: string,
    @Param('fuId') fuId: string,
    @TenantId() tenantId: string,
  ) {
    return this.planService.removeFu(planId, fuId, tenantId);
  }

  @Patch(':id/fus/:fuId/skus/:skuId/volume')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Update SKU volume' })
  @ApiResponse({ status: 200, description: 'SKU volume updated successfully' })
  updateSkuVolume(
    @Param('id') planId: string,
    @Param('fuId') fuId: string,
    @Param('skuId') skuId: string,
    @Body() dto: UpdateSkuVolumeDto,
    @TenantId() tenantId: string,
  ) {
    return this.planService.updateSkuVolume(planId, fuId, skuId, dto, tenantId);
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
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.submit(id, tenantId, user.id);
  }

  @Post(':id/submit-for-approval')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit plan for approval with pre-submission checks',
  })
  @ApiResponse({ status: 200, description: 'Plan submitted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or insufficient budget',
  })
  submitForApproval(
    @Param('id') id: string,
    @Body() dto: SubmitForApprovalDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.approvalWorkflowService.submitForApproval(
      id,
      tenantId,
      user.id,
      dto,
    );
  }

  @Post(':id/review')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.FINANCE_MANAGER)
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
    @Param('id') id: string,
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
    @Param('id') id: string,
    @Body() body: { reason: string; comments?: string },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.approvalWorkflowService.escalateToFinance(
      id,
      tenantId,
      user.id,
      body.reason,
      body.comments,
    );
  }

  @Get(':id/approval-history')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get plan approval history' })
  @ApiResponse({ status: 200, description: 'Approval history entries' })
  getApprovalHistory(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.approvalWorkflowService.getPlanApprovalHistory(id, tenantId);
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
    @Param('id') id: string,
    @Body()
    body: {
      comments?: string;
      autoCreateBudget?: boolean;
      budgetAmount?: number;
    },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.approve(
      id,
      tenantId,
      user.id,
      body.comments,
      body.autoCreateBudget,
      body.budgetAmount,
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
    @Param('id') id: string,
    @Body() body: { reason: string },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.reject(id, tenantId, user.id, body.reason);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete plan (DRAFT only)' })
  @ApiResponse({ status: 204, description: 'Plan deleted successfully' })
  @ApiResponse({ status: 400, description: 'Only DRAFT plans can be deleted' })
  delete(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.planService.delete(id, tenantId);
  }

  @Post(':id/calculate-kpis')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate KPIs for a plan using KPI engine' })
  @ApiResponse({ status: 200, description: 'KPI calculation results' })
  calculateKpis(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.planService.calculateKpis(id, tenantId);
  }

  @Post(':id/recalculate')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger full recalculation for a plan' })
  @ApiResponse({ status: 200, description: 'Recalculation complete' })
  async recalculate(@Param('id') id: string, @TenantId() tenantId: string) {
    await this.planService.recalculatePlanWithKpiEngine(id, tenantId);
    return this.planService.findById(id, tenantId);
  }
}
