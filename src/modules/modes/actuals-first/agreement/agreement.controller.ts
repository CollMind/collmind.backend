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
import {
  CreateAgreementDto,
  UpdateAgreementDto,
  DeleteAgreementDto,
} from './dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../../common/guards/capability.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { RequireCapability } from '../../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../../common/authorization/capabilities';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';
import { AgreementStatus } from '../../../../database/entities/agreement.entity';

// `B3 W6` göçü (2026-08-26, `Z35`) — PLAN/ANLAŞMA yazma (`MODES_PLAN_WRITE`,
// {ADMIN,PLANNER}: create/update/delete) ve gönderim/iptal
// (`MODES_SUBMIT`, {ADMIN,PLANNER}: submit/cancel) rotaları `@Roles` →
// `@RequireCapability` göçürüldü. `ROLE_CAPABILITIES`'te iki hücre de göç
// öncesi `@Roles(ADMIN,PLANNER)` kümesiyle BİREBİR — davranış KORUNUYOR.
// `Z42 §4/§5` (`B3b-1 W9`, 2026-08-26) — `GET /` (`findAll`)/`:id`/
// `tactics/available` `MODES_READ`'e (taban {A,CM,F,P,RO}, 5/5, birebir),
// `pending-approvals` YENİ hücre `APPROVAL_QUEUE_READ`'e ({A,CM,F,RO},
// birebir) göçürüldü.
// `MODES_APPROVE` (approve/reject dahil) bu göçe DAHİL DEĞİL (karar-bekler,
// `B3B1_DALGA_PLANI_ONERI.md §6`).
@ApiTags('Agreements')
@ApiBearerAuth()
@Controller('agreements')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class AgreementController {
  constructor(private readonly agreementService: AgreementService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MODES_PLAN_WRITE)
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
  @RequireCapability(CAPABILITIES.MODES_READ)
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
  @RequireCapability(CAPABILITIES.APPROVAL_QUEUE_READ)
  @ApiOperation({ summary: 'Get pending approval agreements' })
  @ApiResponse({
    status: 200,
    description: 'List of pending approval agreements',
  })
  findPendingApprovals(@TenantId() tenantId: string) {
    return this.agreementService.findPendingApprovals(tenantId);
  }

  @Get('tactics/available')
  @RequireCapability(CAPABILITIES.MODES_READ)
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
  @RequireCapability(CAPABILITIES.MODES_READ)
  @ApiOperation({ summary: 'Get agreement by ID' })
  @ApiResponse({ status: 200, description: 'Agreement details' })
  @ApiResponse({ status: 404, description: 'Agreement not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.findById(id, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MODES_PLAN_WRITE)
  @ApiOperation({ summary: 'Update agreement (DRAFT only)' })
  @ApiResponse({ status: 200, description: 'Agreement updated successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only DRAFT agreements can be edited',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgreementDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string; role: UserRole },
  ) {
    return this.agreementService.update(
      id,
      dto,
      tenantId,
      user.id,
      user.email,
      { userId: user.id, role: user.role },
    );
  }

  @Post(':id/submit')
  @RequireCapability(CAPABILITIES.MODES_SUBMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit agreement for approval' })
  @ApiResponse({ status: 200, description: 'Agreement submitted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only DRAFT agreements can be submitted',
  })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string; role: UserRole },
  ) {
    return this.agreementService.submit(id, tenantId, user.id, user.email, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.FINANCE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve agreement' })
  @ApiResponse({ status: 200, description: 'Agreement approved successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only PENDING agreements can be approved',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('comments') comments: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string; role: UserRole },
  ) {
    return this.agreementService.approve(
      id,
      tenantId,
      user.id,
      comments,
      user.email,
      { userId: user.id, role: user.role },
    );
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER, UserRole.FINANCE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject agreement' })
  @ApiResponse({ status: 200, description: 'Agreement rejected successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only PENDING agreements can be rejected',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string; role: UserRole },
  ) {
    return this.agreementService.reject(
      id,
      tenantId,
      user.id,
      reason,
      user.email,
      { userId: user.id, role: user.role },
    );
  }

  @Post(':id/cancel')
  @RequireCapability(CAPABILITIES.MODES_SUBMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel agreement (releases reserved budget)' })
  @ApiResponse({ status: 200, description: 'Agreement cancelled successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only APPROVED or ACTIVE agreements can be cancelled',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string; role: UserRole },
  ) {
    return this.agreementService.cancel(
      id,
      tenantId,
      user.id,
      reason,
      user.email,
      { userId: user.id, role: user.role },
    );
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MODES_PLAN_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete agreement (DRAFT only)' })
  @ApiResponse({ status: 204, description: 'Agreement deleted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Only DRAFT agreements can be deleted',
  })
  @ApiResponse({
    status: 409,
    description: 'STALE_VERSION / MISSING_VERSION (optimistic locking, T-034)',
  })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteAgreementDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.agreementService.delete(id, tenantId, user.id, dto.version, {
      userId: user.id,
      role: user.role,
    });
  }
}
