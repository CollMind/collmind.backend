import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
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
import { LTAAgreementService } from './lta-agreement.service';
import { LTACalculationService } from './lta-calculation.service';
import { CreateLTAAgreementDto } from './dto/create-lta-agreement.dto';
import { UpdateLTAAgreementDto } from './dto/update-lta-agreement.dto';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';
import { LTAContext } from './dto/lta-context.dto';
import { LTASpendBreakdown } from './dto/lta-context.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { LTAAgreement } from '../../../database/entities/lta-agreement.entity';

@ApiTags('LTA Agreements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('lta-agreements')
export class LTAAgreementController {
  constructor(
    private readonly ltaAgreementService: LTAAgreementService,
    private readonly ltaCalculationService: LTACalculationService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new LTA agreement' })
  @ApiResponse({
    status: 201,
    description: 'LTA agreement created successfully',
    type: LTAAgreement,
  })
  create(
    @TenantId() tenantId: string,
    @Body() createDto: CreateLTAAgreementDto,
  ) {
    return this.ltaAgreementService.createAgreement(tenantId, createDto);
  }

  // T-267 (B1 §"sayım hatası düzeltildi") — bu iki uç (list/:id) HİÇBİR
  // yere konmamıştı, ölçüldü: 0 frontend tüketicisi → tüketicisiz aileye
  // katıldı (S2+S3 ile aynı aile, "12 tüketicisiz uç"). T-257 dersi:
  // "silinecekse bile silinene kadar açık kalamaz" — kader [[T-265]]'e
  // bırakılır, B2 bekletilmez. Rol seti: KARDEŞ uç — mechanic.controller'ın
  // aynı şekilli okuma/hesaplama ucu (§1c) 5 rol taşıyor; LTA aynı
  // "planlama girdisi hesaplama" sınıfı (`0072`'nin işaretlediği
  // "hesaplama uçları").
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get()
  @ApiOperation({ summary: 'Get all LTA agreements' })
  @ApiResponse({
    status: 200,
    description: 'List of LTA agreements',
    type: [LTAAgreement],
  })
  async findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
  ) {
    // Add method to service for getting all agreements
    return this.ltaAgreementService.findAll(tenantId, status as any);
  }

  // T-267 — aynı gerekçe (yukarı bkz.)
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get LTA agreement by ID' })
  @ApiResponse({
    status: 200,
    description: 'LTA agreement details',
    type: LTAAgreement,
  })
  async findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ltaAgreementService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update LTA agreement' })
  @ApiResponse({
    status: 200,
    description: 'LTA agreement updated successfully',
    type: LTAAgreement,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateLTAAgreementDto,
  ) {
    return this.ltaAgreementService.updateAgreement(tenantId, id, updateDto);
  }

  @Post(':id/activate')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Activate LTA agreement' })
  @ApiResponse({
    status: 204,
    description: 'LTA agreement activated successfully',
  })
  activate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ltaAgreementService.activateAgreement(tenantId, id);
  }

  @Post(':id/terminate')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Terminate LTA agreement' })
  @ApiResponse({
    status: 204,
    description: 'LTA agreement terminated successfully',
  })
  terminate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
  ) {
    return this.ltaAgreementService.terminateAgreement(
      tenantId,
      id,
      body.reason,
    );
  }

  // T-267 (B1 §S1, Z19a — ürün sahibi 2026-08-21) — rol katmanı UYGULANIR,
  // kapsam AYRI ([[T-266]] kapsam ratchet'ine girer, bu turda EKLENMEZ).
  // customer.controller.ts'in S1 gerekçesiyle AYNI aile (kapsam sorusu
  // "CPL'e bağlı müşteri" ile birebir aynı yapı). Rol seti K-2.6.4'ten:
  //   YÖNETİCİ: tanım gereği
  //   PLANLAMACI: plan girdisi olarak LTA oranını görmesi gerekiyor
  //   KATEGORİ MÜDÜRÜ: kategori bazlı anlaşma onayı/izlemesi
  //   FİNANS: mutabakat — anlaşma bazlı harcamayı eşleştirmesi gerekiyor
  //   İZLEYİCİ: salt görüntüleme — K-2.6.4c izleme yetenekleri seti
  // `B3 W4a` göçü (2026-08-25): {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,
  // READONLY} (5/5) `ROLE_CAPABILITIES`'te `SHARED_READ`'in verdiği kümeyle
  // birebir aynı — davranış KORUNUYOR (pin: `test/shared-read-w4a-boundary.
  // e2e-spec.ts`, göç öncesi/sonrası birebir: BEŞ ROL de geçiyor).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Get('cpl/:cplId/active')
  @ApiOperation({ summary: 'Get active LTA agreement for CPL' })
  @ApiResponse({
    status: 200,
    description: 'Active LTA agreement',
    type: LTAAgreement,
  })
  getActiveForCPL(
    @TenantId() tenantId: string,
    @Param('cplId', ParseUUIDPipe) cplId: string,
    @Query('date') date?: string,
  ) {
    const targetDate = date ? new Date(date) : new Date();
    return this.ltaAgreementService.getActiveAgreementForCPL(
      tenantId,
      cplId,
      targetDate,
    );
  }

  // T-267 (B1 §S2, "Ölçüm 1": YAZMA:0 · "Ölçüm 3": 0 tüketici) —
  // hesaplama, yazma DEĞİL, TÜKETİCİSİZ. Aynı gerekçe (yukarı bkz.): BEŞ
  // ROL, mechanic.controller'ın kardeş hesaplama uçlarıyla (§1c ekinde)
  // aynı sınıf.
  // `B3 W4b` göçü (2026-08-26, `Z36` §5 hesap-okuma): `@Roles(...)` (5/5) →
  // `@RequireCapability(SHARED_READ)`. `ROLE_CAPABILITIES`'te `SHARED_READ`
  // aynı beş rolde — davranış BİREBİR korunuyor. `Z36 §5`: yazma yüzeyi `0`,
  // cascade yapısal olarak imkânsız; `POST` olması bir mutasyon işareti
  // DEĞİL. Bu üç rota `SHARED_READ`'in dört-istisna kümesinde DEĞİL.
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Post('context/rates')
  @ApiOperation({ summary: 'Get LTA rates for plan context' })
  @ApiResponse({
    status: 200,
    description: 'LTA context with rates',
    type: LTAContext,
  })
  getRatesForContext(
    @TenantId() tenantId: string,
    @Body() planContext: PlanContextDto,
  ) {
    return this.ltaAgreementService.getLTAForPlanContext(tenantId, planContext);
  }

  // T-267 (B1 §S2, "Ölçüm 1": YAZMA:0 · "Ölçüm 3": 0 tüketici) —
  // hesaplama, yazma DEĞİL, TÜKETİCİSİZ. Aynı gerekçe (yukarı bkz.): BEŞ
  // ROL, mechanic.controller'ın kardeş hesaplama uçlarıyla (§1c ekinde)
  // aynı sınıf.
  // `B3 W4b` göçü (2026-08-26, `Z36` §5 hesap-okuma) — aynı gerekçe
  // (yukarı, `context/rates` bkz.).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Post('calculate/base-spend')
  @ApiOperation({ summary: 'Calculate base LTA spend for plan SKU' })
  @ApiResponse({
    status: 200,
    description: 'Base LTA spend breakdown',
    type: LTASpendBreakdown,
  })
  calculateBaseSpend(
    @TenantId() tenantId: string,
    @Body()
    body: { planId: string; skuId: string; planContext: PlanContextDto },
  ) {
    return this.ltaCalculationService.calculateBaseLTASpend(
      tenantId,
      body.planId,
      body.skuId,
      body.planContext,
    );
  }

  // T-267 (B1 §S2, "Ölçüm 1": YAZMA:0 · "Ölçüm 3": 0 tüketici) —
  // hesaplama, yazma DEĞİL, TÜKETİCİSİZ. Aynı gerekçe (yukarı bkz.): BEŞ
  // ROL, mechanic.controller'ın kardeş hesaplama uçlarıyla (§1c ekinde)
  // aynı sınıf.
  // `B3 W4b` göçü (2026-08-26, `Z36` §5 hesap-okuma) — aynı gerekçe
  // (yukarı, `context/rates` bkz.).
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @Post('calculate/planned-spend')
  @ApiOperation({ summary: 'Calculate planned LTA spend for plan SKU' })
  @ApiResponse({
    status: 200,
    description: 'Planned LTA spend breakdown',
    type: LTASpendBreakdown,
  })
  calculatePlannedSpend(
    @TenantId() tenantId: string,
    @Body()
    body: { planId: string; skuId: string; planContext: PlanContextDto },
  ) {
    return this.ltaCalculationService.calculatePlannedLTASpend(
      tenantId,
      body.planId,
      body.skuId,
      body.planContext,
    );
  }
}
