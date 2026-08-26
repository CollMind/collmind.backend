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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { Category } from '../../../database/entities/category.entity';

// `B3 W7` göçü (2026-08-26) — 5 rota `@Roles` → `@RequireCapability`.
// ⚠️ KÜME BURAYA YAZILMIYOR (code-reviewer Nit 1): dokuz controller'ın bu
// bloğu BYTE-BİREBİR aynı, ve elle yazılmış bir küme dokuz yerde AYNI ANDA
// bayatlar (`DISIPLIN`: "elle yazılmış üye-sayısı — ölçülmüş oran DOKUZDA
// DOKUZ"). Niteliksel ayırt edici: `MASTER_DATA_READ`, göç öncesi `@Roles`
// kümesiyle BİREBİR. Kanonik kaynak `ROLE_CAPABILITIES`; atama kapısı `G6`
// (45 rotanın HEPSİNDE ölçülüyor).
// göç öncesi/sonrası @Roles kümesiyle BİREBİR, davranış KORUNUYOR.
// `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİL — B3 W8 kapanışında (Z39 dalga-sonu H3) DÜŞTÜ (sıfır-rota, bkz. capabilities.ts).
@ApiTags('Master Data - Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new category' })
  @ApiResponse({
    status: 201,
    description: 'Category created successfully',
    type: Category,
  })
  create(
    @TenantId() tenantId: string,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoryService.create(tenantId, createCategoryDto);
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
  @ApiOperation({ summary: 'Get all categories' })
  @ApiResponse({
    status: 200,
    description: 'List of categories',
    type: [Category],
  })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.categoryService.findAll(tenantId, activeOnly === 'true');
  }

  // T-267 (B1 §1a) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID' })
  @ApiResponse({ status: 200, description: 'Category details', type: Category })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categoryService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update category' })
  @ApiResponse({
    status: 200,
    description: 'Category updated successfully',
    type: Category,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoryService.update(tenantId, id, updateCategoryDto);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete category' })
  @ApiResponse({ status: 204, description: 'Category deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.remove(tenantId, id);
  }
}
