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
import { TacticService } from './tactic.service';
import { CreateTacticDto } from './dto/create-tactic.dto';
import { UpdateTacticDto } from './dto/update-tactic.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { Tactic } from '../../../database/entities/tactic.entity';

// `B3 W7` göçü (2026-08-26) — 5 rota `@Roles` → `@RequireCapability`.
// ⚠️ KÜME BURAYA YAZILMIYOR (code-reviewer Nit 1): dokuz controller'ın bu
// bloğu BYTE-BİREBİR aynı, ve elle yazılmış bir küme dokuz yerde AYNI ANDA
// bayatlar (`DISIPLIN`: "elle yazılmış üye-sayısı — ölçülmüş oran DOKUZDA
// DOKUZ"). Niteliksel ayırt edici: `MASTER_DATA_READ`, göç öncesi `@Roles`
// kümesiyle BİREBİR. Kanonik kaynak `ROLE_CAPABILITIES`; atama kapısı `G6`
// (45 rotanın HEPSİNDE ölçülüyor).
// göç öncesi/sonrası @Roles kümesiyle BİREBİR, davranış KORUNUYOR.
// `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİL — `W8`'in kapanışında ele alınır.
@ApiTags('Master Data - Tactics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/tactics')
export class TacticController {
  constructor(private readonly tacticService: TacticService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new tactic' })
  @ApiResponse({
    status: 201,
    description: 'Tactic created successfully',
    type: Tactic,
  })
  create(
    @TenantId() tenantId: string,
    @Body() createTacticDto: CreateTacticDto,
  ) {
    return this.tacticService.create(tenantId, createTacticDto);
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
  @ApiOperation({ summary: 'Get all tactics' })
  @ApiResponse({ status: 200, description: 'List of tactics', type: [Tactic] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.tacticService.findAll(tenantId, activeOnly === 'true');
  }

  // T-267 (B1 §1a) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get tactic by ID' })
  @ApiResponse({ status: 200, description: 'Tactic details', type: Tactic })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tacticService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update tactic' })
  @ApiResponse({
    status: 200,
    description: 'Tactic updated successfully',
    type: Tactic,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTacticDto: UpdateTacticDto,
  ) {
    return this.tacticService.update(tenantId, id, updateTacticDto);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete tactic' })
  @ApiResponse({ status: 204, description: 'Tactic deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tacticService.remove(tenantId, id);
  }
}
