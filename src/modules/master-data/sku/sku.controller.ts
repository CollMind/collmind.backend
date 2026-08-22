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
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { Sku } from '../../../database/entities/sku.entity';

@ApiTags('Master Data - SKUs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/skus')
export class SkuController {
  constructor(private readonly skuService: SkuService) {}

  @Post()
  @Roles(UserRole.ADMIN)
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
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
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
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
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
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete SKU' })
  @ApiResponse({ status: 204, description: 'SKU deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.skuService.remove(tenantId, id);
  }
}
