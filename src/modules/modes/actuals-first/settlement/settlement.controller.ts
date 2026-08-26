import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { SettlementSummaryService } from './settlement-summary.service';
import { SettlementCloseService } from './settlement-close.service';
import { SettlementGuard } from './settlement.guard';
import {
  SettlementSummaryQueryDto,
  SettlementSummaryResponseDto,
  CloseSettlementDto,
} from './dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../../common/guards/capability.guard';
import { RequireCapability } from '../../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../../common/authorization/capabilities';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';

// T-267: RolesGuard sınıf seviyesine EKLENDİ — `@Roles` metadata'sı
// RolesGuard olmadan İNERT'tir (roles.guard.ts:16-18: metadata okunamazsa
// canActivate `true` döner, ama guard zincirinde HİÇ yoksa @Roles hiç
// OKUNMAZ). `close/:agreementId` etkilenmiyor: o rota @Roles TAŞIMIYOR,
// RolesGuard onun için `requiredRoles` bulamaz → true (fail-open, mevcut
// davranış korunur); erişimi hâlâ tek başına SettlementGuard denetliyor.
// ⛔ `Z43 §4` (`B3` istisna-dalgası `Faz-B`, 2026-08-27) — `CapabilityGuard`
// sınıf seviyesine EKLENDİ (`summary`'nin `SUMMARY_READ`'e göçü için şart).
// Guard `@RequireCapability` metadata'sı yoksa `true` döner (fail-open) —
// `close/:agreementId` (metadata yok) ETKİLENMİYOR, `SettlementGuard`
// erişimi denetlemeye devam ediyor.
@ApiTags('Settlements (Actuals-First)')
@ApiBearerAuth()
@Controller('actuals-first/settlements')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class SettlementController {
  constructor(
    private readonly summaryService: SettlementSummaryService,
    private readonly closeService: SettlementCloseService,
  ) {}

  /**
   * GET /actuals-first/settlements/summary
   *
   * Settlement özet raporu — read-only.
   * Admin/Manager/Finance/Readonly: tenant-wide.
   */
  // T-267 (B1 §1f) — ÖZET hücresi, 5 rol (ölçülmüş DAVRANIŞ, "ÖLÇÜM 1"):
  // servis içeride resolveScope çağırıyordu (planner → yalnız kendi CPL
  // scope'u, diğerleri tenant-wide).
  // ⛔ `Z43 §4` (`B3` istisna-dalgası `Faz-B`, 2026-08-27) — `SUMMARY_READ`'e
  // göçürüldü ({A,CM,F,RO}) — `−PLANNER` DAVRANIŞ DARALTMASI. Dayanak
  // `Z42 §3` (kayıtsız doğum `d40ca16` + `K-2.6.4`'ün planner cümlesi özet
  // içermiyor); `Faz-A §3` ölçümünde bu daraltma AYAKTA bulundu. PLANNER
  // artık bu uca hiç ULAŞMIYOR — servisin `resolveScope` planner dalı bu
  // rotadan ölü kod (diğer çağıranları varsa etkilenmez).
  @RequireCapability(CAPABILITIES.SUMMARY_READ)
  @Get('summary')
  @ApiOperation({
    summary: 'Get settlement summary report',
    description:
      'Returns aggregated settlement data per agreement. ' +
      'Planners see only agreements within their CPL scope. ' +
      'invoicedAmount = ledger DEBIT − CREDIT (direction-aware; reversals netted). ' +
      'remainingAmount is null when claimAmount is 0 (division-by-zero guard per BRD).',
  })
  @ApiResponse({ status: 200, type: SettlementSummaryResponseDto })
  async getSummary(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string; role: UserRole },
    @Query() query: SettlementSummaryQueryDto,
  ): Promise<SettlementSummaryResponseDto> {
    return this.summaryService.getSummary(tenantId, user.id, user.role, query);
  }

  /**
   * POST /actuals-first/settlements/close/:agreementId
   *
   * Bir agreement'ı CLOSED state'ine geçirir.
   * Yalnızca ADMIN veya CATEGORY_MANAGER rolü.
   *
   * ÖNEMLI: Bu endpoint budget veya ledger'a YAZMAZ.
   * Budget zaten agreement-transaction kaydedilirken ledger DEBIT ile düşülmüştür.
   * Close, yalnızca state machine geçişidir (APPROVED/ACTIVE → CLOSED).
   */
  @Post('close/:agreementId')
  @UseGuards(SettlementGuard)
  @ApiOperation({
    summary: 'Close (settle) an agreement',
    description:
      'Transitions an agreement from APPROVED or ACTIVE to CLOSED state. ' +
      'This is a pure state transition — no budget or ledger entries are written ' +
      '(budget was already consumed via ledger DEBIT at transaction creation). ' +
      'Requires ADMIN or CATEGORY_MANAGER role. ' +
      'Logs the action to the immutable audit trail.',
  })
  @ApiParam({ name: 'agreementId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Agreement successfully closed',
    schema: {
      type: 'object',
      properties: {
        agreementId: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'CLOSED' },
        closedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN_MANAGER_OR_ADMIN_ONLY' })
  @ApiResponse({ status: 404, description: 'Agreement not found' })
  @ApiResponse({
    status: 409,
    description: 'ALREADY_SETTLED | NOT_SETTLEABLE_STATE',
  })
  async closeAgreement(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string },
    @Body() dto: CloseSettlementDto,
  ): Promise<{ agreementId: string; status: 'CLOSED'; closedAt: Date }> {
    return this.closeService.closeAgreement(
      agreementId,
      tenantId,
      user.id,
      user.email,
      dto,
    );
  }
}
