import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';

@ApiTags('Ledger')
@ApiBearerAuth()
@Controller('ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FINANCE_MANAGER, UserRole.PLANNER)
  @ApiOperation({ summary: 'Get all ledger entries' })
  findAll(
    @TenantId() tenantId: string,
    @Query('agreementId') agreementId?: string,
    @Query('budgetEnvelopeId') budgetEnvelopeId?: string,
    @Query('periodMonth') periodMonth?: string,
    @Query('spendType') spendType?: string,
  ) {
    return this.ledgerService.findAll(tenantId, {
      agreementId,
      budgetEnvelopeId,
      periodMonth,
      spendType,
    });
  }

  @Get('agreement/:agreementId')
  @Roles(UserRole.ADMIN, UserRole.FINANCE_MANAGER, UserRole.PLANNER)
  @ApiOperation({ summary: 'Get ledger entries by agreement ID' })
  findByAgreement(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @TenantId() tenantId: string,
  ) {
    return this.ledgerService.findByAgreementId(agreementId, tenantId);
  }

  @Get('agreement/:agreementId/consumed')
  @Roles(UserRole.ADMIN, UserRole.FINANCE_MANAGER, UserRole.PLANNER)
  @ApiOperation({ summary: 'Get total consumed amount for agreement' })
  async getConsumedByAgreement(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @TenantId() tenantId: string,
  ) {
    const consumed = await this.ledgerService.getConsumedByAgreement(
      agreementId,
      tenantId,
    );
    return { agreementId, consumed };
  }

  @Get('envelope/:envelopeId')
  @Roles(UserRole.ADMIN, UserRole.FINANCE_MANAGER)
  @ApiOperation({ summary: 'Get ledger entries by budget envelope ID' })
  findByEnvelope(
    @Param('envelopeId', ParseUUIDPipe) envelopeId: string,
    @TenantId() tenantId: string,
  ) {
    return this.ledgerService.findByEnvelopeId(envelopeId, tenantId);
  }

  @Get('envelope/:envelopeId/consumed')
  @Roles(UserRole.ADMIN, UserRole.FINANCE_MANAGER)
  @ApiOperation({ summary: 'Get total consumed amount for budget envelope' })
  async getConsumedByEnvelope(
    @Param('envelopeId', ParseUUIDPipe) envelopeId: string,
    @TenantId() tenantId: string,
  ) {
    const consumed = await this.ledgerService.getConsumedByEnvelope(
      envelopeId,
      tenantId,
    );
    return { envelopeId, consumed };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FINANCE_MANAGER, UserRole.PLANNER)
  @ApiOperation({ summary: 'Get ledger entry by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.ledgerService.findById(id, tenantId);
  }
}
