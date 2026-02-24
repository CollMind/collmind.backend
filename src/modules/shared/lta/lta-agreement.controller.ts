import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LTAAgreementService } from './lta-agreement.service';
import { LTACalculationService } from './lta-calculation.service';
import { CreateLTAAgreementDto } from './dto/create-lta-agreement.dto';
import { UpdateLTAAgreementDto } from './dto/update-lta-agreement.dto';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';
import { LTAContext } from './dto/lta-context.dto';
import { LTASpendBreakdown } from './dto/lta-context.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { LTAAgreement } from '../../../database/entities/lta-agreement.entity';

@ApiTags('LTA Agreements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lta-agreements')
export class LTAAgreementController {
  constructor(
    private readonly ltaAgreementService: LTAAgreementService,
    private readonly ltaCalculationService: LTACalculationService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new LTA agreement' })
  @ApiResponse({ status: 201, description: 'LTA agreement created successfully', type: LTAAgreement })
  create(@TenantId() tenantId: string, @Body() createDto: CreateLTAAgreementDto) {
    return this.ltaAgreementService.createAgreement(tenantId, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all LTA agreements' })
  @ApiResponse({ status: 200, description: 'List of LTA agreements', type: [LTAAgreement] })
  async findAll(@TenantId() tenantId: string, @Query('status') status?: string) {
    // Add method to service for getting all agreements
    return this.ltaAgreementService.findAll(tenantId, status as any);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get LTA agreement by ID' })
  @ApiResponse({ status: 200, description: 'LTA agreement details', type: LTAAgreement })
  async findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ltaAgreementService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update LTA agreement' })
  @ApiResponse({ status: 200, description: 'LTA agreement updated successfully', type: LTAAgreement })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateDto: UpdateLTAAgreementDto,
  ) {
    return this.ltaAgreementService.updateAgreement(tenantId, id, updateDto);
  }

  @Post(':id/activate')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Activate LTA agreement' })
  @ApiResponse({ status: 204, description: 'LTA agreement activated successfully' })
  activate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ltaAgreementService.activateAgreement(tenantId, id);
  }

  @Post(':id/terminate')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Terminate LTA agreement' })
  @ApiResponse({ status: 204, description: 'LTA agreement terminated successfully' })
  terminate(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.ltaAgreementService.terminateAgreement(tenantId, id, body.reason);
  }

  @Get('cpl/:cplId/active')
  @ApiOperation({ summary: 'Get active LTA agreement for CPL' })
  @ApiResponse({ status: 200, description: 'Active LTA agreement', type: LTAAgreement })
  getActiveForCPL(
    @TenantId() tenantId: string,
    @Param('cplId') cplId: string,
    @Query('date') date?: string,
  ) {
    const targetDate = date ? new Date(date) : new Date();
    return this.ltaAgreementService.getActiveAgreementForCPL(tenantId, cplId, targetDate);
  }

  @Post('context/rates')
  @ApiOperation({ summary: 'Get LTA rates for plan context' })
  @ApiResponse({ status: 200, description: 'LTA context with rates', type: LTAContext })
  getRatesForContext(@TenantId() tenantId: string, @Body() planContext: PlanContextDto) {
    return this.ltaAgreementService.getLTAForPlanContext(tenantId, planContext);
  }

  @Post('calculate/base-spend')
  @ApiOperation({ summary: 'Calculate base LTA spend for plan SKU' })
  @ApiResponse({ status: 200, description: 'Base LTA spend breakdown', type: LTASpendBreakdown })
  calculateBaseSpend(
    @TenantId() tenantId: string,
    @Body() body: { planId: string; skuId: string; planContext: PlanContextDto },
  ) {
    return this.ltaCalculationService.calculateBaseLTASpend(
      tenantId,
      body.planId,
      body.skuId,
      body.planContext,
    );
  }

  @Post('calculate/planned-spend')
  @ApiOperation({ summary: 'Calculate planned LTA spend for plan SKU' })
  @ApiResponse({ status: 200, description: 'Planned LTA spend breakdown', type: LTASpendBreakdown })
  calculatePlannedSpend(
    @TenantId() tenantId: string,
    @Body() body: { planId: string; skuId: string; planContext: PlanContextDto },
  ) {
    return this.ltaCalculationService.calculatePlannedLTASpend(
      tenantId,
      body.planId,
      body.skuId,
      body.planContext,
    );
  }
}
