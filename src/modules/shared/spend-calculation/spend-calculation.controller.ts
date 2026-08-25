import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
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
import { SpendDistributionService } from './spend-distribution.service';
import { SpendValidationService } from './spend-validation.service';
import {
  DistributionResult,
  FUDistributionBreakdown,
  DistributionValidationResult,
} from './dto/distribution-result.dto';
import {
  InputValidationResult,
  CombinationValidationResult,
  BudgetValidationResult,
  PreSubmissionValidation,
} from './dto/validation-result.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';

// T-249 (devam turu) — bu 8 rotanın HİÇBİRİNDE `@Roles` yoktu →
// `RolesGuard` fail-open. Bu dosya `mechanic_spend_breakdown`/
// `plan_mechanic_values`'a AYNI turda `GRANT` aldı — yani rota tam şimdi
// erişilebilir hâle geliyor; `@Roles`'suz bırakmak `0074 §B1`'in
// ölçülmüş sınıfı ("yazma yapan rol-kısıtsız uçlar, ve içlerinde
// hesaplama tetikleyenler") tam vakası olurdu. Ürün sahibi kararı
// (2026-08-20): `@Roles` GRANT ile AYNI turda eklendi.
//
// Rol seti TEK LİSTE KOPYALANMADI — 8 rota AĞIRLIĞA göre 3 gruba ayrıldı,
// her biri ÖLÇÜLMÜŞ bir emsale bağlandı (ürün sahibinin talimatı: "ölç,
// genelleme"):
//
//   YAZMA (SPEND_WRITE_ROLES) — `distribute`/`recalculate-on-volume-change`
//     ikisi de Plan→FU→SKU mekanik spend'ini MUTASYONA uğratıyor
//     (`saveBreakdowns`: DELETE+INSERT `mechanic_spend_breakdown`,
//     `planMechanicValueRepository.save`). Emsal `finance-reporting`
//     DEĞİL — o modülün hiçbir yazma rotası yok, kıyaslanamaz. Emsal
//     AYNI domain'deki `plan.controller.ts`'in yazma rotaları
//     (`addFu`/`updateFuTactic`/`updateSkuVolume`/`recalculate`), HEPSİ
//     `ADMIN, PLANNER` — plan düzenleme FINANCE/CATEGORY_MANAGER/READONLY
//     işi değil.
//
//   OKUMA — FU/plan DETAY (SPEND_READ_ROLES) — `breakdown`/
//     `validate-distribution`/`validate-inputs`/`validate-combinations`/
//     `validate-before-submission`: hepsi TEK bir FU/plan'ın planlama-
//     zamanı görünümü/doğrulaması, `finance-reporting`'in PLANNER
//     İÇEREN TEK rotasıyla (`plan-performance`:
//     `ADMIN, FINANCE, CATEGORY_MANAGER, PLANNER, READONLY`) AYNI
//     granülerlik — plan'ı kuran PLANNER kendi girdisini görebilmeli,
//     onaylayanlar (CM/FINANCE) submit öncesi inceleyebilmeli.
//
//   OKUMA — plan BÜTÇE KONTROLÜ (SPEND_BUDGET_CHECK_ROLES) —
//     `validate-budget/:planId`: `finance-reporting`'in tenant-çapındaki
//     `budget-at-risk`i (`ADMIN, FINANCE, READONLY`) BURAYA UYMUYOR —
//     farklı granülerlik (tenant risk raporu, TEK plan değil). Daha
//     GÜÇLÜ ve DOĞRUDAN emsal: AYNI işi yapan `plan.controller.ts`'in
//     KENDİ `GET /plans/:id/budget-check` rotası
//     (`ADMIN, PLANNER, CATEGORY_MANAGER, READONLY` — FINANCE YOK,
//     ölçüldü `plan.controller.ts:150-156`). Bu grup diğer okuma
//     grubundan FINANCE'ı bilerek dışarıda bırakıyor.
const SPEND_WRITE_ROLES = [UserRole.ADMIN, UserRole.PLANNER] as const;
// `SPEND_READ_ROLES` `B3 W4a` göçüyle KALDIRILDI (2026-08-25) — beş rotanın
// hepsi `@RequireCapability(CAPABILITIES.SHARED_READ)`'e taşındı, sabiti
// kullanan hiçbir `@Roles(...)` kalmadı (`ROLE_CAPABILITIES.SHARED_READ`
// aynı beş rolü taşıyor, kaynak `capabilities.ts:593-602`).
const SPEND_BUDGET_CHECK_ROLES = [
  UserRole.ADMIN,
  UserRole.PLANNER,
  UserRole.CATEGORY_MANAGER,
  UserRole.READONLY,
] as const;

@ApiTags('Spend Calculation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('spend-calculation')
export class SpendCalculationController {
  constructor(
    private readonly distributionService: SpendDistributionService,
    private readonly validationService: SpendValidationService,
  ) {}

  @Post('distribute/:planFuId/:mechanicId')
  @Roles(...SPEND_WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Distribute mechanic spend from FU to SKUs' })
  @ApiResponse({
    status: 200,
    description: 'Distribution result',
    type: DistributionResult,
  })
  distributeMechanicSpend(
    @TenantId() tenantId: string,
    @Param('planFuId', ParseUUIDPipe) planFuId: string,
    @Param('mechanicId', ParseUUIDPipe) mechanicId: string,
  ) {
    return this.distributionService.distributeMechanicSpend(
      tenantId,
      planFuId,
      mechanicId,
    );
  }

  @Post('recalculate-on-volume-change/:skuId')
  @Roles(...SPEND_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Recalculate distribution when SKU volume changes' })
  @ApiResponse({ status: 204, description: 'Distribution recalculated' })
  recalculateOnVolumeChange(
    @TenantId() tenantId: string,
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() body: { newVolume: number },
  ) {
    return this.distributionService.recalculateDistributionOnVolumeChange(
      tenantId,
      skuId,
      body.newVolume,
    );
  }

  @Get('breakdown/:planFuId')
  // `B3 W4a` göçü (2026-08-25): `SPEND_READ_ROLES` = {ADMIN,CATEGORY_MANAGER,
  // FINANCE,PLANNER,READONLY} (5/5), `ROLE_CAPABILITIES`'te `SHARED_READ`'in
  // verdiği kümeyle birebir aynı — davranış KORUNUYOR (pin:
  // `test/shared-read-w4a-boundary.e2e-spec.ts`, göç öncesi/sonrası birebir:
  // BEŞ ROL de geçiyor). `SPEND_BUDGET_CHECK_ROLES` (validate-budget, 4/5,
  // FINANCE eksik) BİLİNÇLİ OLARAK GÖÇMEDİ — istisna, dört-istisna listesinde.
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @ApiOperation({ summary: 'Get distribution breakdown for a FU' })
  @ApiResponse({
    status: 200,
    description: 'Distribution breakdown',
    type: FUDistributionBreakdown,
  })
  getDistributionBreakdown(
    @TenantId() tenantId: string,
    @Param('planFuId', ParseUUIDPipe) planFuId: string,
  ) {
    return this.distributionService.getDistributionBreakdown(
      tenantId,
      planFuId,
    );
  }

  @Get('validate-distribution/:planFuId')
  // `B3 W4a` göçü (2026-08-25): `SPEND_READ_ROLES` = {ADMIN,CATEGORY_MANAGER,
  // FINANCE,PLANNER,READONLY} (5/5), `ROLE_CAPABILITIES`'te `SHARED_READ`'in
  // verdiği kümeyle birebir aynı — davranış KORUNUYOR (pin:
  // `test/shared-read-w4a-boundary.e2e-spec.ts`, göç öncesi/sonrası birebir:
  // BEŞ ROL de geçiyor). `SPEND_BUDGET_CHECK_ROLES` (validate-budget, 4/5,
  // FINANCE eksik) BİLİNÇLİ OLARAK GÖÇMEDİ — istisna, dört-istisna listesinde.
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @ApiOperation({ summary: 'Validate distribution for a FU' })
  @ApiResponse({
    status: 200,
    description: 'Distribution validation result',
    type: DistributionValidationResult,
  })
  validateDistribution(
    @TenantId() tenantId: string,
    @Param('planFuId', ParseUUIDPipe) planFuId: string,
  ) {
    return this.distributionService.validateDistribution(tenantId, planFuId);
  }

  @Get('validate-inputs/:planFuId')
  // `B3 W4a` göçü (2026-08-25): `SPEND_READ_ROLES` = {ADMIN,CATEGORY_MANAGER,
  // FINANCE,PLANNER,READONLY} (5/5), `ROLE_CAPABILITIES`'te `SHARED_READ`'in
  // verdiği kümeyle birebir aynı — davranış KORUNUYOR (pin:
  // `test/shared-read-w4a-boundary.e2e-spec.ts`, göç öncesi/sonrası birebir:
  // BEŞ ROL de geçiyor). `SPEND_BUDGET_CHECK_ROLES` (validate-budget, 4/5,
  // FINANCE eksik) BİLİNÇLİ OLARAK GÖÇMEDİ — istisna, dört-istisna listesinde.
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @ApiOperation({ summary: 'Validate inputs for a FU' })
  @ApiResponse({
    status: 200,
    description: 'Input validation result',
    type: InputValidationResult,
  })
  validateInputs(
    @TenantId() tenantId: string,
    @Param('planFuId', ParseUUIDPipe) planFuId: string,
  ) {
    return this.validationService.validateInputs(tenantId, planFuId);
  }

  @Get('validate-combinations/:planFuId')
  // `B3 W4a` göçü (2026-08-25): `SPEND_READ_ROLES` = {ADMIN,CATEGORY_MANAGER,
  // FINANCE,PLANNER,READONLY} (5/5), `ROLE_CAPABILITIES`'te `SHARED_READ`'in
  // verdiği kümeyle birebir aynı — davranış KORUNUYOR (pin:
  // `test/shared-read-w4a-boundary.e2e-spec.ts`, göç öncesi/sonrası birebir:
  // BEŞ ROL de geçiyor). `SPEND_BUDGET_CHECK_ROLES` (validate-budget, 4/5,
  // FINANCE eksik) BİLİNÇLİ OLARAK GÖÇMEDİ — istisna, dört-istisna listesinde.
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @ApiOperation({ summary: 'Validate mechanic combinations for a FU' })
  @ApiResponse({
    status: 200,
    description: 'Combination validation result',
    type: CombinationValidationResult,
  })
  validateCombinations(
    @TenantId() tenantId: string,
    @Param('planFuId', ParseUUIDPipe) planFuId: string,
  ) {
    return this.validationService.validateCombinations(tenantId, planFuId);
  }

  @Get('validate-budget/:planId')
  @Roles(...SPEND_BUDGET_CHECK_ROLES)
  @ApiOperation({ summary: 'Validate budget impact for a plan' })
  @ApiResponse({
    status: 200,
    description: 'Budget validation result',
    type: BudgetValidationResult,
  })
  validateBudget(
    @TenantId() tenantId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.validationService.validateBudgetImpact(tenantId, planId);
  }

  @Get('validate-before-submission/:planId')
  // `B3 W4a` göçü (2026-08-25): `SPEND_READ_ROLES` = {ADMIN,CATEGORY_MANAGER,
  // FINANCE,PLANNER,READONLY} (5/5), `ROLE_CAPABILITIES`'te `SHARED_READ`'in
  // verdiği kümeyle birebir aynı — davranış KORUNUYOR (pin:
  // `test/shared-read-w4a-boundary.e2e-spec.ts`, göç öncesi/sonrası birebir:
  // BEŞ ROL de geçiyor). `SPEND_BUDGET_CHECK_ROLES` (validate-budget, 4/5,
  // FINANCE eksik) BİLİNÇLİ OLARAK GÖÇMEDİ — istisna, dört-istisna listesinde.
  @RequireCapability(CAPABILITIES.SHARED_READ)
  @ApiOperation({
    summary: 'Validate plan before submission (all validations)',
  })
  @ApiResponse({
    status: 200,
    description: 'Pre-submission validation result',
    type: PreSubmissionValidation,
  })
  validateBeforeSubmission(
    @TenantId() tenantId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.validationService.validateBeforeSubmission(tenantId, planId);
  }
}
