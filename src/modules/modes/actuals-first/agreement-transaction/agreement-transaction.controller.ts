import {
  Controller, Get, Post, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AgreementTransactionService } from './agreement-transaction.service';
import { CreateAgreementTransactionDto, BatchImportDto } from './dto';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';

@ApiTags('Agreement Transactions (Off-Invoice)')
@ApiBearerAuth()
@Controller('agreement-transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgreementTransactionController {
  constructor(private readonly txService: AgreementTransactionService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Create single off-invoice transaction' })
  create(
    @Body() dto: CreateAgreementTransactionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.txService.create(dto, tenantId, user.id);
  }

  @Post('batch')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Batch import off-invoice transactions' })
  batchImport(
    @Body() dto: BatchImportDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.txService.batchImport(dto, tenantId, user.id);
  }

  @Get('agreement/:agreementId')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get transactions by agreement ID' })
  findByAgreement(
    @Param('agreementId') agreementId: string,
    @TenantId() tenantId: string,
  ) {
    return this.txService.findByAgreementId(agreementId, tenantId);
  }

  @Get('agreement/:agreementId/total')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get total transaction amount for agreement' })
  async getTotalByAgreement(
    @Param('agreementId') agreementId: string,
    @TenantId() tenantId: string,
  ) {
    const total = await this.txService.getTotalByAgreement(agreementId, tenantId);
    return { agreementId, total };
  }

  @Get('batch/:batchId')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get transactions by batch ID' })
  findByBatch(
    @Param('batchId') batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.txService.findByBatchId(batchId, tenantId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get all agreement transactions' })
  findAll(
    @TenantId() tenantId: string,
    @Query('agreementId') agreementId?: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.txService.findAll(tenantId, { agreementId, batchId });
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get transaction by ID' })
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.txService.findById(id, tenantId);
  }
}

