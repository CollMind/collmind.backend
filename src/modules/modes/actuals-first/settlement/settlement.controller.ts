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
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';

@ApiTags('Settlements (Actuals-First)')
@ApiBearerAuth()
@Controller('actuals-first/settlements')
@UseGuards(JwtAuthGuard)
export class SettlementController {
  constructor(
    private readonly summaryService: SettlementSummaryService,
    private readonly closeService: SettlementCloseService,
  ) {}

  /**
   * GET /actuals-first/settlements/summary
   *
   * Settlement özet raporu — read-only, tüm authenticated kullanıcılar erişebilir.
   * Planner: yalnızca kendi CPL scope'undaki agreements. Scope boşsa boş summary.
   * Admin/Manager/Finance: tenant-wide.
   */
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
