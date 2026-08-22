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
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { Tactic } from '../../../database/entities/tactic.entity';

@ApiTags('Master Data - Tactics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/tactics')
export class TacticController {
  constructor(private readonly tacticService: TacticService) {}

  @Post()
  @Roles(UserRole.ADMIN)
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
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
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
  @Roles(
    UserRole.ADMIN,
    UserRole.PLANNER,
    UserRole.CATEGORY_MANAGER,
    UserRole.FINANCE,
    UserRole.READONLY,
  )
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
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete tactic' })
  @ApiResponse({ status: 204, description: 'Tactic deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tacticService.remove(tenantId, id);
  }
}
