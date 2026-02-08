import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalService } from './approval.service';
import { ApproveRequestDto, RejectRequestDto } from './dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';

@ApiTags('Approvals')
@ApiBearerAuth()
@Controller('approvals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.APPROVER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get all approval requests' })
  findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('requestType') requestType?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.approvalService.findAll(tenantId, { status, requestType, entityType });
  }

  @Get('pending')
  @Roles(UserRole.ADMIN, UserRole.APPROVER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get pending approval requests for current user' })
  findPending(@TenantId() tenantId: string, @CurrentUser('id') userId: string) {
    return this.approvalService.findPendingForUser(userId, tenantId);
  }

  @Get('my-requests')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.APPROVER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get approval requests created by current user' })
  findMyRequests(@TenantId() tenantId: string, @CurrentUser('id') userId: string) {
    return this.approvalService.findMyRequests(userId, tenantId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.APPROVER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get approval request by ID' })
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.approvalService.findById(id, tenantId);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.APPROVER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Approve a request' })
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.approvalService.approve(id, tenantId, userId, dto);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.APPROVER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Reject a request' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.approvalService.reject(id, tenantId, userId, dto);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Cancel own pending request' })
  cancel(@Param('id') id: string, @TenantId() tenantId: string, @CurrentUser('id') userId: string) {
    return this.approvalService.cancel(id, tenantId, userId);
  }
}

