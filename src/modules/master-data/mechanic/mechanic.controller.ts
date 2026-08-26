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
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MechanicService } from './mechanic.service';
import { CreateMechanicDto } from './dto/create-mechanic.dto';
import { UpdateMechanicDto } from './dto/update-mechanic.dto';
import { PlanContextDto } from './dto/plan-context.dto';
import { ValidationResult } from './dto/validation-result.dto';
import { CombinationCheckResult } from './dto/combination-check-result.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { Mechanic } from '../../../database/entities/mechanic.entity';

// `B3 W8` göçü (2026-08-26) — dokuz rotanın yedisi `@Roles` → `@RequireCapability`.
//   POST/PATCH/DELETE/:id/clone       `@Roles(ADMIN)`                                        → `MASTER_DATA_WRITE` ({ADMIN})
//   GET (liste·:id)                   `@Roles(ADMIN,PLANNER,CATEGORY_MANAGER,FINANCE,READONLY)` → `MASTER_DATA_READ` (5/5)
// `ROLE_CAPABILITIES`'te ikisi de göç öncesi @Roles kümesiyle BİREBİR —
// davranış KORUNUYOR. Kanonik kaynak `ROLE_CAPABILITIES`; atama kapısı `G6`.
//
// ⚠️ `POST applicable` / `POST check-combination` — HÜCRE DEĞİŞİKLİĞİ, dekoratör
// göçü DEĞİL. `Z36 §5` (2026-08-26, ürün sahibi KABUL): yazma yüzeyi ÖLÇÜLDÜ 0
// (ikisi de salt sorgu/filtre, kalıcı mutasyon yok — `T-267` B1 §S2), küme
// göç öncesi @Roles ile BİREBİR (5/5) — bu yüzden `MASTER_DATA_READ`'e göçer,
// mekanik POST→WRITE kuralının TÜRETECEĞİ `MASTER_DATA_WRITE`'a DEĞİL. Bu bir
// OVERRIDE'dır: `route-cell-map.py`'de `MASTER_DATA_CALC_READ_ROUTES` tablosuna
// KAYITLI (G2b kapsamında).
//
// ⛔ `POST validate-formula` GÖÇE DAHİL DEĞİL — `Z36 §5` karar-bekler (aynı
// gerekçe: `K-2.6.6` bir üyelik gerekçesi değil). `@Roles(ADMIN)` AYNEN kalır.
@ApiTags('Master Data - Mechanics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/mechanics')
export class MechanicController {
  constructor(private readonly mechanicService: MechanicService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new mechanic' })
  @ApiResponse({
    status: 201,
    description: 'Mechanic created successfully',
    type: Mechanic,
  })
  create(
    @TenantId() tenantId: string,
    @Body() createMechanicDto: CreateMechanicDto,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.create(
      tenantId,
      createMechanicDto,
      user?.sub,
      user?.email,
      ipAddress,
    );
  }

  // T-267 (B1 §1c) — modül-READ, 5 rol. Aynı gerekçe 1a ile (K-2.6.4, her
  // rol için ayrı cümle) — bkz. brand.controller.ts.
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get()
  @ApiOperation({ summary: 'Get all mechanics' })
  @ApiResponse({
    status: 200,
    description: 'List of mechanics',
    type: [Mechanic],
  })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('tacticId') tacticId?: string,
  ) {
    return this.mechanicService.findAll(
      tenantId,
      activeOnly === 'true',
      tacticId,
    );
  }

  // T-267 (B1 §1c) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get mechanic by ID' })
  @ApiResponse({ status: 200, description: 'Mechanic details', type: Mechanic })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.mechanicService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update mechanic' })
  @ApiResponse({
    status: 200,
    description: 'Mechanic updated successfully',
    type: Mechanic,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateMechanicDto: UpdateMechanicDto,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.update(
      tenantId,
      id,
      updateMechanicDto,
      user?.sub,
      user?.email,
      ipAddress,
    );
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete mechanic' })
  @ApiResponse({ status: 204, description: 'Mechanic deleted successfully' })
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.remove(
      tenantId,
      id,
      user?.sub,
      user?.email,
      ipAddress,
    );
  }

  // ⛔ `Z36 §5` KARAR-BEKLER — bkz. dosya başı yorumu. `@Roles(ADMIN)` AYNEN
  // kalır.
  @Post('validate-formula')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Validate calculation formula' })
  @ApiResponse({
    status: 200,
    description: 'Formula validation result',
    type: ValidationResult,
  })
  validateFormula(
    @Body() body: { formula: string; testContext?: Record<string, any> },
  ): Promise<ValidationResult> {
    return this.mechanicService.validateFormula(
      body.formula,
      body.testContext || {},
    );
  }

  // T-267 (B1 §S2, "Ölçüm 3") — TÜKETİCİSİZ (mechanicEndpoints.getApplicable
  // çağıranı: 0). T-257 dersi: "silinecekse bile silinene kadar açık
  // kalamaz" — kader kararı [[T-265]]'e bırakılır, B2 bekletilmez. Rol
  // seti: KARDEŞ uç — aynı controller'ın okuma ucu (§1c, yukarı) 5 rol
  // taşıyor; bu uç ölçüldü YAZMA:0 (B1 "Ölçüm 1"), okuma niteliğinde.
  // ⚠️ `Z36 §5` (2026-08-26, ürün sahibi KABUL) — HÜCRE DEĞİŞİKLİĞİ: mekanik
  // POST→WRITE kuralı bunu `MASTER_DATA_WRITE`'a türetir; bu bir OVERRIDE'dır
  // (`route-cell-map.py` `MASTER_DATA_CALC_READ_ROUTES`, G2b kapsamında).
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Post('applicable')
  @ApiOperation({ summary: 'Get applicable mechanics for plan context' })
  @ApiResponse({
    status: 200,
    description: 'List of applicable mechanics',
    type: [Mechanic],
  })
  getApplicableMechanics(
    @TenantId() tenantId: string,
    @Body() planContext: PlanContextDto,
  ): Promise<Mechanic[]> {
    return this.mechanicService.getApplicableMechanics(tenantId, planContext);
  }

  // T-267 (B1 §S2) — TÜKETİCİSİZ (0 çağıran, ölçüldü). Aynı gerekçe
  // (yukarı bkz.): KARDEŞ uç §1c, YAZMA:0.
  // ⚠️ `Z36 §5` (2026-08-26, ürün sahibi KABUL) — HÜCRE DEĞİŞİKLİĞİ, aynı
  // gerekçe `applicable` ile (yukarı bkz.): OVERRIDE, `MASTER_DATA_CALC_
  // READ_ROUTES`.
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Post('check-combination')
  @ApiOperation({ summary: 'Check if mechanic combination is valid' })
  @ApiResponse({
    status: 200,
    description: 'Combination check result',
    type: CombinationCheckResult,
  })
  checkCombination(
    @TenantId() tenantId: string,
    @Body() body: { mechanicCodes: string[] },
  ): Promise<CombinationCheckResult> {
    return this.mechanicService.checkCombinationValidity(
      tenantId,
      body.mechanicCodes,
    );
  }

  @Post(':id/clone')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Clone a mechanic' })
  @ApiResponse({
    status: 201,
    description: 'Mechanic cloned successfully',
    type: Mechanic,
  })
  cloneMechanic(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() overrides: Partial<CreateMechanicDto>,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.cloneMechanic(
      tenantId,
      id,
      overrides,
      user?.sub,
      user?.email,
      ipAddress,
    );
  }
}
