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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PlanService } from './plan.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  AddFuDto,
  UpdateFuTacticDto,
  UpdateSkuVolumeDto,
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
  constructor(private readonly planService: PlanService) {}

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
  @ApiOperation({ summary: 'Get all plans' })
  @ApiResponse({ status: 200, description: 'List of plans' })
  findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: PlanStatus,
    @Query('cplId') cplId?: string,
    @Query('channelId') channelId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.planService.findAll(tenantId, { status, cplId, channelId, categoryId });
  }

  @Get('pending-approvals')
  @Roles(UserRole.ADMIN, UserRole.APPROVER)
  @ApiOperation({ summary: 'Get plans pending approval' })
  @ApiResponse({ status: 200, description: 'List of plans pending approval' })
  findPendingApprovals(@TenantId() tenantId: string) {
    return this.planService.findPendingApprovals(tenantId);
  }

  @Get(':id')
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
  @ApiOperation({ summary: 'Submit plan for approval' })
  @ApiResponse({ status: 200, description: 'Plan submitted successfully' })
  @ApiResponse({ status: 400, description: 'Only DRAFT plans can be submitted' })
  submit(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.submit(id, tenantId, user.id);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.APPROVER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve plan' })
  @ApiResponse({ status: 200, description: 'Plan approved successfully' })
  @ApiResponse({ status: 400, description: 'Only PENDING_APPROVAL plans can be approved' })
  approve(
    @Param('id') id: string,
    @Body() body: { comments?: string },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.planService.approve(id, tenantId, user.id, body.comments);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.APPROVER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject plan' })
  @ApiResponse({ status: 200, description: 'Plan rejected successfully' })
  @ApiResponse({ status: 400, description: 'Only PENDING_APPROVAL plans can be rejected' })
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
  delete(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.planService.delete(id, tenantId);
  }

  @Get(':id/analysis')
  @ApiOperation({ summary: 'Get plan analysis data' })
  @ApiResponse({ status: 200, description: 'Plan analysis data' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  getAnalysis(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.planService.getAnalysis(id, tenantId);
  }
}
