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
import { CplService } from './cpl.service';
import { CreateCplDto } from './dto/create-cpl.dto';
import { UpdateCplDto } from './dto/update-cpl.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { Cpl } from '../../../database/entities/cpl.entity';

// `B3 W7` göçü (2026-08-26) — 5 rota `@Roles` → `@RequireCapability`.
// `ROLE_CAPABILITIES`'te `MASTER_DATA_READ` = 5/5 (ADMIN,PLANNER,
// CATEGORY_MANAGER,FINANCE,READONLY), `MASTER_DATA_WRITE` = {ADMIN} —
// göç öncesi/sonrası @Roles kümesiyle BİREBİR, davranış KORUNUYOR.
// `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİL — `W8`'in kapanışında ele alınır.
@ApiTags('Master Data - CPLs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/cpls')
export class CplController {
  constructor(private readonly cplService: CplService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new CPL' })
  @ApiResponse({
    status: 201,
    description: 'CPL created successfully',
    type: Cpl,
  })
  create(@TenantId() tenantId: string, @Body() createCplDto: CreateCplDto) {
    return this.cplService.create(tenantId, createCplDto);
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
  @ApiOperation({ summary: 'Get all CPLs' })
  @ApiResponse({ status: 200, description: 'List of CPLs', type: [Cpl] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.cplService.findAll(tenantId, activeOnly === 'true', channelId);
  }

  // T-267 (B1 §1a) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get CPL by ID' })
  @ApiResponse({ status: 200, description: 'CPL details', type: Cpl })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cplService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update CPL' })
  @ApiResponse({
    status: 200,
    description: 'CPL updated successfully',
    type: Cpl,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCplDto: UpdateCplDto,
  ) {
    return this.cplService.update(tenantId, id, updateCplDto);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete CPL' })
  @ApiResponse({ status: 204, description: 'CPL deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.cplService.remove(tenantId, id);
  }
}
