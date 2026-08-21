import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalService } from './approval.service';
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
  @Roles(
    UserRole.ADMIN,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get all approval requests' })
  findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('requestType') requestType?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.approvalService.findAll(tenantId, {
      status,
      requestType,
      entityType,
    });
  }

  @Get('pending')
  @Roles(
    UserRole.ADMIN,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get pending approval requests for current user' })
  findPending(@TenantId() tenantId: string, @CurrentUser('id') userId: string) {
    return this.approvalService.findPendingForUser(userId, tenantId);
  }

  @Get('my-requests')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get approval requests created by current user' })
  findMyRequests(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.approvalService.findMyRequests(userId, tenantId);
  }

  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get approval request by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.approvalService.findById(id, tenantId);
  }

  // T-257: `POST :id/approve` · `POST :id/reject` · `POST :id/cancel` KALDIRILDI.
  // Gerekçe (İlke 1 — ölçülmüş, T-257): bugün 0 tüketici (frontend: 0 çağrı,
  // poz. kontrol /plans deseni → 11; backend: HTTP ucunun tek çağıranı KENDİ
  // controller'ıydı) VE genel `approve`/`reject` `K-2.5.6`'nın atomikliğini
  // ihlal ediyordu (approval_requests=APPROVED yazılırken plan/agreement
  // durum makinesi ve bütçe taahhüdü hiç yazılmıyordu — sahte onay).
  // `cancel` de aynı ölçümle (0 tüketici) aynı turda kaldırıldı.
  //
  // Servis metotları (`ApprovalService.approve/reject/cancel`) KALDI —
  // domain akışları (`plan.service.ts:1602/1695` ·
  // `agreement.service.ts:757/878` · `approval-workflow.service.ts:546/626`)
  // onları KENDİ transaction'ları içinde çağırmaya devam ediyor. Yalnız
  // genel HTTP giriş noktası gitti.
  //
  // K-2.5.11 (self-approval reddi) pini: plan tarafı zaten domain akışında
  // bağımsız sınanıyordu (plan.service.ts:1401, approval-workflow.service.ts:369
  // — kendi guard'ları var). Agreement tarafının KENDİ guard'ı YOKTU — koruma
  // tamamen `ApprovalService.approve/reject`'in paylaşılan kontrolüne
  // dayanıyor; o pin `test/role-journey.e2e-spec.ts` C7 (approve) ve C9b
  // (reject) testlerine TAŞINDI. Bkz. `.claude/backlog/tasks/T-257.md`.
}
