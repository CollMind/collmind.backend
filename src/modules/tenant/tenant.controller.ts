import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  Delete,
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
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
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
@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
  @RequireCapability(CAPABILITIES.TENANT_WRITE)
  @ApiOperation({ summary: 'Create a new tenant' })
  @ApiResponse({
    status: 201,
    description: 'Tenant created successfully',
    type: TenantResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Tenant already exists' })
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantService.create(createTenantDto);
  }

  @Get()
  @RequireCapability(CAPABILITIES.TENANT_READ)
  @ApiOperation({ summary: 'Get all tenants' })
  @ApiResponse({
    status: 200,
    description: 'List of tenants',
    type: [TenantResponseDto],
  })
  findAll() {
    return this.tenantService.findAll();
  }

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
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.findOne(id);
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
  ) {
    return this.tenantService.update(id, updateTenantDto);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.TENANT_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete tenant' })
  @ApiResponse({ status: 204, description: 'Tenant deleted successfully' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.remove(id);
  }

  @Post(':id/activate')
  @RequireCapability(CAPABILITIES.TENANT_WRITE)
  @ApiOperation({ summary: 'Activate tenant' })
  @ApiResponse({ status: 200, description: 'Tenant activated' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.activate(id);
  }

  @Post(':id/suspend')
  @RequireCapability(CAPABILITIES.TENANT_WRITE)
  @ApiOperation({ summary: 'Suspend tenant' })
  @ApiResponse({ status: 200, description: 'Tenant suspended' })
  suspend(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.suspend(id);
  }

  // T-267 (B1 §1e) — KARDEŞ uç: tenant.controller'ın yedi kardeşinin
  // yedisi de @Roles(ADMIN); tek istisna buydu. `B3 W2` göçüyle bu fark
  // ortadan kalktı — sekizi de artık @RequireCapability taşıyor.
  @RequireCapability(CAPABILITIES.TENANT_READ)
  @Get(':id/stats')
  @ApiOperation({ summary: 'Get tenant statistics' })
  @ApiResponse({ status: 200, description: 'Tenant statistics' })
  getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.getStats(id);
  }
}
