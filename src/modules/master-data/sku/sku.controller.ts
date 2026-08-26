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
import { SkuService } from './sku.service';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { Sku } from '../../../database/entities/sku.entity';

// `B3 W7` göçü (2026-08-26) — 5 rota `@Roles` → `@RequireCapability`.
// `ROLE_CAPABILITIES`'te `MASTER_DATA_READ` = 5/5 (ADMIN,PLANNER,
// CATEGORY_MANAGER,FINANCE,READONLY), `MASTER_DATA_WRITE` = {ADMIN} —
// göç öncesi/sonrası @Roles kümesiyle BİREBİR, davranış KORUNUYOR.
// `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİL — `W8`'in kapanışında ele alınır.
@ApiTags('Master Data - SKUs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/skus')
export class SkuController {
  constructor(private readonly skuService: SkuService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new SKU' })
  @ApiResponse({
    status: 201,
    description: 'SKU created successfully',
    type: Sku,
  })
  create(@TenantId() tenantId: string, @Body() createSkuDto: CreateSkuDto) {
    return this.skuService.create(tenantId, createSkuDto);
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
  @ApiOperation({ summary: 'Get all SKUs' })
  @ApiResponse({ status: 200, description: 'List of SKUs', type: [Sku] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('fuId') fuId?: string,
    @Query('brandId') brandId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.skuService.findAll(
      tenantId,
      activeOnly === 'true',
      fuId,
      brandId,
      categoryId,
    );
  }

  // T-267 (B1 §1a) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get SKU by ID' })
  @ApiResponse({ status: 200, description: 'SKU details', type: Sku })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.skuService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update SKU' })
  @ApiResponse({
    status: 200,
    description: 'SKU updated successfully',
    type: Sku,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateSkuDto: UpdateSkuDto,
  ) {
    return this.skuService.update(tenantId, id, updateSkuDto);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SKU' })
  @ApiResponse({ status: 204, description: 'SKU deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.skuService.remove(tenantId, id);
  }
}
