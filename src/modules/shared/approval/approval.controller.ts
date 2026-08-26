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
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { SelfScoped } from '../../../common/decorators/self-scoped.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';

@ApiTags('Approvals')
@ApiBearerAuth()
@Controller('approvals')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  // `B3` kaza-dalgası `K4` Parça 1 göçü (`Z37 §3`, 2026-08-26): eski
  // `@Roles(ADMIN,CATEGORY_MANAGER,FINANCE,READONLY)` →
  // `@RequireCapability(APPROVAL_QUEUE_READ)`. `ROLE_CAPABILITIES`'te aynı
  // dört rol — davranış BİREBİR korunuyor (pin:
  // `test/shared-read-exceptions-boundary.e2e-spec.ts`).
  @Get()
  @RequireCapability(CAPABILITIES.APPROVAL_QUEUE_READ)
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

  // `B3` kaza-dalgası `K4` Parça 1 göçü (`Z37 §3`, 2026-08-26) — aynı
  // gerekçe (yukarı bkz.).
  @Get('pending')
  @RequireCapability(CAPABILITIES.APPROVAL_QUEUE_READ)
  @ApiOperation({ summary: 'Get pending approval requests for current user' })
  findPending(@TenantId() tenantId: string, @CurrentUser('id') userId: string) {
    return this.approvalService.findPendingForUser(userId, tenantId);
  }

  // `Z26` (SELF kovası, 2026-08-23) ile GÖÇ: yüklem `requestedById =
  // requesterId` (`SELF_OLCUM_RAPORU.md §1`) — kayıt "benim" olduğu için
  // görünür, rol yüzünden değil. Eski `@Roles` tüm beş rolü sayıyordu
  // (union, `Z18 §4` ihlali). `GET /approvals/pending` (Z27) BU SINIFA
  // GİRMEZ — "onaycı" yüklemi, "SELF" değil; dokunulmadı.
  @Get('my-requests')
  @SelfScoped()
  @ApiOperation({ summary: 'Get approval requests created by current user' })
  findMyRequests(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.approvalService.findMyRequests(userId, tenantId);
  }

  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  @Get(':id')
  @RequireCapability(CAPABILITIES.SHARED_READ)
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
