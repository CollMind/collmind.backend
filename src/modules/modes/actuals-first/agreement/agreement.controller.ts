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
import { AgreementService } from './agreement.service';
import { CreateAgreementDto, UpdateAgreementDto } from './dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';
import { AgreementStatus } from '../../../../database/entities/agreement.entity';

@ApiTags('Agreements')
@ApiBearerAuth()
@Controller('agreements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgreementController {
  constructor(private readonly agreementService: AgreementService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new agreement' })
  @ApiResponse({ status: 201, description: 'Agreement created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid agreement data' })
  create(
    @Body() dto: CreateAgreementDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.create(dto, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get all agreements' })
  @ApiResponse({ status: 200, description: 'List of agreements' })
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Query('status') status?: AgreementStatus,
    @Query('cplId') cplId?: string,
    @Query('channel') channel?: string,
  ) {
    return this.agreementService.findAll(
      tenantId,
      { status, cplId, channel },
      { userId: user.id, role: user.role },
    );
  }

  // Spesifik route'lar parametrik route'lardan (:id) önce tanımlanmalı
  @Get('pending-approvals')
  @Roles(
    UserRole.ADMIN,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get pending approval agreements' })
  @ApiResponse({
    status: 200,
    description: 'List of pending approval agreements',
  })
  findPendingApprovals(@TenantId() tenantId: string) {
    return this.agreementService.findPendingApprovals(tenantId);
  }

  @Get('tactics/available')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get available tactics for channel and category' })
  @ApiResponse({
    status: 200,
    description: 'List of available tactics with their mechanics',
  })
  getAvailableTactics(
    @TenantId() tenantId: string,
    @Query('channelId') channelId?: string,
    @Query('channel') channel?: string, // Legacy support for channel code
    @Query('categoryId') categoryId?: string,
  ) {
    return this.agreementService.getAvailableTactics(
      tenantId,
      channelId || channel,
      categoryId,
    );
  }

  // Parametrik route en sonda olmalı
  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get agreement by ID' })
  @ApiResponse({ status: 200, description: 'Agreement details' })
  @ApiResponse({ status: 404, description: 'Agreement not found' })
  findOne(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.findById(id, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @ApiOperation({ summary: 'Update agreement (DRAFT only)' })
  @ApiResponse({ status: 200, description: 'Agreement updated successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only DRAFT agreements can be edited',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAgreementDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.update(id, dto, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/submit')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit agreement for approval' })
  @ApiResponse({ status: 200, description: 'Agreement submitted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only DRAFT agreements can be submitted',
  })
  submit(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.submit(id, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.FINANCE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve agreement' })
  @ApiResponse({ status: 200, description: 'Agreement approved successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only PENDING agreements can be approved',
  })
  approve(
    @Param('id') id: string,
    @Body('comments') comments: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.approve(id, tenantId, user.id, comments, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.FINANCE_MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject agreement' })
  @ApiResponse({ status: 200, description: 'Agreement rejected successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only PENDING agreements can be rejected',
  })
  reject(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.reject(id, tenantId, user.id, reason, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel agreement (releases reserved budget)' })
  @ApiResponse({ status: 200, description: 'Agreement cancelled successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only APPROVED or ACTIVE agreements can be cancelled',
  })
  cancel(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.cancel(id, tenantId, user.id, reason, {
      userId: user.id,
      role: user.role,
    });
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete agreement (DRAFT only)' })
  @ApiResponse({ status: 204, description: 'Agreement deleted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only DRAFT agreements can be deleted',
  })
  delete(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.delete(id, tenantId, user.id, {
      userId: user.id,
      role: user.role,
    });
  }
}
