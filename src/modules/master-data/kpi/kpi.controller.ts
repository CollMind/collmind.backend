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

  // T-267 (B1 §1b) — modül-READ, 5 rol. Aynı gerekçe 1a ile (K-2.6.4, her rol
  // için ayrı cümle) — bkz. brand.controller.ts.
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @Get()
  @ApiOperation({ summary: 'Get all KPI definitions' })
  @ApiResponse({ status: 200, description: 'List of KPIs', type: [Kpi] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.kpiService.findAll(tenantId, activeOnly === 'true');
  }

  // ⚠️ Z30 H7 (2026-08-24) — ÇÜRÜMÜŞ GEREKÇE DÜZELTİLDİ. Eski yorum "bu uç
  // master-data DEĞİL, PLAN verisi döndürüyor" diyordu; kpi.service.ts:94-95
  // ("it never returns plan content — grid KPI defs only") ile ÇELİŞİYORDU,
  // ve H6 ölçümü (2026-08-24) servisinkini destekledi: yanıt gövdesi
  // findGridKpis ile BİT-BİT AYNI Kpi[] (KPI TANIMLARI, hesaplanmış değer
  // değil). Doğru gerekçe: T-267 (B1 §1b) — findAll/findCalculableKpis ile
  // AYNI katalog sınıfı (K-2.6.4, her rol için ayrı cümle). `:planId`
  // yalnız planService.findById(actor) üzerinden bir 404-ORACLE KAPISI
  // (T-028c) — veri FİLTRESİ değil. Kova (scope-ratchet) bu yüzden B'den
  // C'ye taşındı (Z31 H4-5a): "veri sınıfı aynıysa kova aynı — KAPININ
  // VARLIĞI kova belirlemez."
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
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

  // T-267 (B1 §1b) — modül-READ, 5 rol, findAll/findCalculableKpis ile
  // AYNI katalog sınıfı (K-2.6.4, her rol için ayrı cümle). ⚠️ Z30 H7
  // (2026-08-24): önceki yorum bu ucu ":planId'li kardeşle aynı gerekçe"
  // diye PLAN verisine bağlıyordu — kardeşin KENDİ gerekçesi çürüdü
  // (yukarı bkz.), bu satır ETKİLENMEDİ: bu uç zaten hiç plan-gate
  // taşımıyor (kova hep C'ydi), kaynağı tek katalog tablosu (main.kpis).
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @Get('grid')
  @ApiOperation({ summary: 'Get KPIs visible in planning grid' })
  @ApiResponse({ status: 200, description: 'Grid KPIs', type: [Kpi] })
  findGridKpis(@TenantId() tenantId: string) {
    return this.kpiService.findGridKpis(tenantId);
  }

  // T-267 (B1 §1b) — aynı gerekçe (yukarı bkz.)
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
  @Get('calculable')
  @ApiOperation({ summary: 'Get all calculable KPIs in order' })
  @ApiResponse({ status: 200, description: 'Calculable KPIs', type: [Kpi] })
  findCalculableKpis(@TenantId() tenantId: string) {
    return this.kpiService.findCalculableKpis(tenantId);
  }

  // T-267 (B1 §1b) — aynı gerekçe (yukarı bkz.)
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
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
