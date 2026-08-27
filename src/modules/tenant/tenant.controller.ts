import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantResponseDto } from './dto/tenant-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CapabilityGuard } from '../../common/guards/capability.guard';
import { RequireCapability } from '../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../common/authorization/capabilities';

// `B3 W2` göçü (2026-08-25): sekiz rota `@Roles(ADMIN)` →
// `@RequireCapability(TENANT_READ|TENANT_WRITE)`. `ROLE_CAPABILITIES`'te
// ikisi de yalnız `UserRole.ADMIN`'de (`capabilities.ts:667-669`, dal 1 —
// tek rol kümesi, mekanik) — davranış KORUNUYOR (pin:
// `test/tenant-capability-boundary.e2e-spec.ts`, göç öncesi/sonrası
// birebir: ADMIN geçer, ADMIN dışı HER rol 403).
//
// ⛔ `T-307-m2` / `Z46 §1` (2026-08-27) — YAŞAM-DÖNGÜSÜ OPERATÖR-YOLUNA:
// `POST /tenants` (create) · `DELETE /tenants/:id` (remove) · `GET /tenants`
// (findAll/liste) buradan KALICI OLARAK KALDIRILDI.
//
// Gerekçe (`Z46 §1` hükmü): `ADMIN` bu üründe KİRACI-İÇİ bir rol; kiracı
// YARATMAK/SİLMEK tanım gereği PLATFORM-SEVİYESİ bir iştir. Kiracı-içi bir
// yetkinin kiracı-üstü bir nesneye dokunması `T-307`'nin (canlı cross-tenant
// sızıntı bulgusu) ta kendisiydi — create/delete'i ADMIN'de tutmak aynı
// sınıfın "ama biz kullanıyoruz" muafiyetli hâli olurdu.
//
// Bugünkü (ve tek) meşru yol: SCRIPT + SEED (`src/database/seeds/
// tenant.seed.ts`), sahibi OPERATÖR — ürün-içi hiçbir `K`-kaydı self-service
// tenant onboarding TANIMLAMIYOR. Ürünleşirse `Faz-3` kararıyla (bir süzgeç
// olarak) gelir; bu üründe bugün YOK.
//
// GET/PATCH `:id` ve `:id/activate`|`:id/suspend`|`:id/stats` KALDI — bunlar
// yaşam-döngüsü değil, KENDİ KİRACISININ ayarı (kiracı-içi meşru yüzey,
// zaten `assertSelfTenant` ile kilitli, bkz. `tenant.service.ts`).
@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  // [[T-258]] ⛔ P0 (2026-08-21): @Roles YOK'tu → her rol (READONLY dahil)
  // erişiyordu, ve servis 9 kullanıcının HAM kaydını (passwordHash dahil)
  // `relations: ['users']` ile yüklüyordu. İkisi birlikte düzeltildi:
  // @Roles(ADMIN) burada (B3 W2'den beri @RequireCapability(TENANT_READ) —
  // AYNI KAPI, farklı mekanizma; küme birebir {ADMIN}), relations kaldırma
  // tenant.service.ts#findOne'da.
  @Get(':id')
  @RequireCapability(CAPABILITIES.TENANT_READ)
  @ApiOperation({ summary: 'Get tenant by ID' })
  @ApiResponse({
    status: 200,
    description: 'Tenant details',
    type: TenantResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('tenantId') callerTenantId: string,
  ) {
    return this.tenantService.findOne(id, callerTenantId);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.TENANT_WRITE)
  @ApiOperation({ summary: 'Update tenant' })
  @ApiResponse({
    status: 200,
    description: 'Tenant updated successfully',
    type: TenantResponseDto,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTenantDto: UpdateTenantDto,
    @CurrentUser('tenantId') callerTenantId: string,
  ) {
    return this.tenantService.update(id, updateTenantDto, callerTenantId);
  }

  @Post(':id/activate')
  @RequireCapability(CAPABILITIES.TENANT_WRITE)
  @ApiOperation({ summary: 'Activate tenant' })
  @ApiResponse({ status: 200, description: 'Tenant activated' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('tenantId') callerTenantId: string,
  ) {
    return this.tenantService.activate(id, callerTenantId);
  }

  @Post(':id/suspend')
  @RequireCapability(CAPABILITIES.TENANT_WRITE)
  @ApiOperation({ summary: 'Suspend tenant' })
  @ApiResponse({ status: 200, description: 'Tenant suspended' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('tenantId') callerTenantId: string,
  ) {
    return this.tenantService.suspend(id, callerTenantId);
  }

  // T-267 (B1 §1e) — KARDEŞ uç: tenant.controller'ın yedi kardeşinin
  // yedisi de @Roles(ADMIN); tek istisna buydu. `B3 W2` göçüyle bu fark
  // ortadan kalktı — sekizi de artık @RequireCapability taşıyor.
  @RequireCapability(CAPABILITIES.TENANT_READ)
  @Get(':id/stats')
  @ApiOperation({ summary: 'Get tenant statistics' })
  @ApiResponse({ status: 200, description: 'Tenant statistics' })
  getStats(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('tenantId') callerTenantId: string,
  ) {
    return this.tenantService.getStats(id, callerTenantId);
  }
}
