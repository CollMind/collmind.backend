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
import { BrandService } from './brand.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { Brand } from '../../../database/entities/brand.entity';

// `B3 W7` göçü (2026-08-26) — 5 rota `@Roles` → `@RequireCapability`.
// `ROLE_CAPABILITIES`'te `MASTER_DATA_READ` = 5/5 (ADMIN,PLANNER,
// CATEGORY_MANAGER,FINANCE,READONLY), `MASTER_DATA_WRITE` = {ADMIN} —
// göç öncesi/sonrası @Roles kümesiyle BİREBİR, davranış KORUNUYOR.
// `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİL — `W8`'in kapanışında ele alınır.
@ApiTags('Master Data - Brands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new brand' })
  @ApiResponse({
    status: 201,
    description: 'Brand created successfully',
    type: Brand,
  })
  create(@TenantId() tenantId: string, @Body() createBrandDto: CreateBrandDto) {
    return this.brandService.create(tenantId, createBrandDto);
  }

  // T-267 (B1 §1a) — modül-READ, 5 rol. Kardeş POST/PATCH/DELETE ADMIN'dir;
  // bu iki GET okuma ucu K-2.6.4 rol TANIMINDAN ayrı ayrı gerekçeleniyor:
  //   YÖNETİCİ: "tanımlar" — bu veriyi O yazıyor
  //   PLANLAMACI: "plan · taktik · hacim girişi" — katalog OKUMADAN yapılamaz
  //   KATEGORİ MÜDÜRÜ: "kategori bütçe sahibi" — kataloğu okumak zorunda
  //   FİNANS: "mutabakat · içe aktarma" — kalem eşleştirmek için katalog gerekir
  //   İZLEYİCİ: "salt görüntüleme" — K-2.6.4c izleme yetenekleri seti
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get()
  @ApiOperation({ summary: 'Get all brands' })
  @ApiResponse({ status: 200, description: 'List of brands', type: [Brand] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.brandService.findAll(tenantId, activeOnly === 'true');
  }

  // T-267 (B1 §1a) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get brand by ID' })
  @ApiResponse({ status: 200, description: 'Brand details', type: Brand })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.brandService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update brand' })
  @ApiResponse({
    status: 200,
    description: 'Brand updated successfully',
    type: Brand,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateBrandDto: UpdateBrandDto,
  ) {
    return this.brandService.update(tenantId, id, updateBrandDto);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete brand' })
  @ApiResponse({ status: 204, description: 'Brand deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.brandService.remove(tenantId, id);
  }
}
