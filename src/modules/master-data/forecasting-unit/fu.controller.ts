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
import { FuService } from './fu.service';
import { CreateFuDto } from './dto/create-fu.dto';
import { UpdateFuDto } from './dto/update-fu.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { ForecastingUnit } from '../../../database/entities/forecasting-unit.entity';

// `B3 W7` göçü (2026-08-26) — 5 rota `@Roles` → `@RequireCapability`.
// ⚠️ KÜME BURAYA YAZILMIYOR (code-reviewer Nit 1): dokuz controller'ın bu
// bloğu BYTE-BİREBİR aynı, ve elle yazılmış bir küme dokuz yerde AYNI ANDA
// bayatlar (`DISIPLIN`: "elle yazılmış üye-sayısı — ölçülmüş oran DOKUZDA
// DOKUZ"). Niteliksel ayırt edici: `MASTER_DATA_READ`, göç öncesi `@Roles`
// kümesiyle BİREBİR. Kanonik kaynak `ROLE_CAPABILITIES`; atama kapısı `G6`
// (45 rotanın HEPSİNDE ölçülüyor).
// göç öncesi/sonrası @Roles kümesiyle BİREBİR, davranış KORUNUYOR.
// `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİL — `W8`'in kapanışında ele alınır.
@ApiTags('Master Data - Forecasting Units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/forecasting-units')
export class FuController {
  constructor(private readonly fuService: FuService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new Forecasting Unit' })
  @ApiResponse({
    status: 201,
    description: 'Forecasting Unit created successfully',
    type: ForecastingUnit,
  })
  create(@TenantId() tenantId: string, @Body() createFuDto: CreateFuDto) {
    return this.fuService.create(tenantId, createFuDto);
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
  @ApiOperation({ summary: 'Get all Forecasting Units' })
  @ApiResponse({
    status: 200,
    description: 'List of Forecasting Units',
    type: [ForecastingUnit],
  })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('guId') guId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.fuService.findAll(
      tenantId,
      activeOnly === 'true',
      guId,
      categoryId,
    );
  }

  // T-267 (B1 §1a) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get Forecasting Unit by ID' })
  @ApiResponse({
    status: 200,
    description: 'Forecasting Unit details',
    type: ForecastingUnit,
  })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.fuService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update Forecasting Unit' })
  @ApiResponse({
    status: 200,
    description: 'Forecasting Unit updated successfully',
    type: ForecastingUnit,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFuDto: UpdateFuDto,
  ) {
    return this.fuService.update(tenantId, id, updateFuDto);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete Forecasting Unit' })
  @ApiResponse({
    status: 204,
    description: 'Forecasting Unit deleted successfully',
  })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.fuService.remove(tenantId, id);
  }
}
