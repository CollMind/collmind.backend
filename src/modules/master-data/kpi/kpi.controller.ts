import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  Delete,
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
import { KpiService } from './kpi.service';
import { CreateKpiDto } from './dto/create-kpi.dto';
import { UpdateKpiDto } from './dto/update-kpi.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { Kpi } from '../../../database/entities/kpi.entity';

@ApiTags('Master Data - KPIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/kpis')
export class KpiController {
  constructor(private readonly kpiService: KpiService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new KPI definition' })
  @ApiResponse({
    status: 201,
    description: 'KPI created successfully',
    type: Kpi,
  })
  create(@TenantId() tenantId: string, @Body() createKpiDto: CreateKpiDto) {
    return this.kpiService.create(tenantId, createKpiDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all KPI definitions' })
  @ApiResponse({ status: 200, description: 'List of KPIs', type: [Kpi] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.kpiService.findAll(tenantId, activeOnly === 'true');
  }

  @Get('grid/:planId')
  @ApiOperation({
    summary: 'Get KPIs visible in planning grid for a specific plan',
  })
  @ApiResponse({ status: 200, description: 'Grid KPIs for plan', type: [Kpi] })
  getGridKpisForPlan(
    @TenantId() tenantId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.kpiService.getGridKpisForPlan(planId, tenantId, {
      userId: user.id,
      role: user.role,
    });
  }

  @Get('grid')
  @ApiOperation({ summary: 'Get KPIs visible in planning grid' })
  @ApiResponse({ status: 200, description: 'Grid KPIs', type: [Kpi] })
  findGridKpis(@TenantId() tenantId: string) {
    return this.kpiService.findGridKpis(tenantId);
  }

  @Get('calculable')
  @ApiOperation({ summary: 'Get all calculable KPIs in order' })
  @ApiResponse({ status: 200, description: 'Calculable KPIs', type: [Kpi] })
  findCalculableKpis(@TenantId() tenantId: string) {
    return this.kpiService.findCalculableKpis(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get KPI by ID' })
  @ApiResponse({ status: 200, description: 'KPI details', type: Kpi })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.kpiService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update KPI definition' })
  @ApiResponse({
    status: 200,
    description: 'KPI updated successfully',
    type: Kpi,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateKpiDto: UpdateKpiDto,
  ) {
    return this.kpiService.update(tenantId, id, updateKpiDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete KPI definition' })
  @ApiResponse({ status: 204, description: 'KPI deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.kpiService.remove(tenantId, id);
  }

  @Post('validate-formula')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Validate a KPI formula' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  validateFormula(@Body() body: { formula: string; formulaType: string }) {
    return this.kpiService.validateFormula(body.formula, body.formulaType);
  }

  @Post('seed-defaults')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Seed default KPI definitions' })
  @ApiResponse({ status: 201, description: 'Default KPIs created' })
  seedDefaults(@TenantId() tenantId: string) {
    return this.kpiService.seedDefaults(tenantId);
  }
}
