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
import { ChannelService } from './channel.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Request } from '@nestjs/common';
import { Channel } from '../../../database/entities/channel.entity';

// `B3 W7` göçü (2026-08-26) — 5 rota `@Roles` → `@RequireCapability`.
// `ROLE_CAPABILITIES`'te `MASTER_DATA_READ` = 5/5 (ADMIN,PLANNER,
// CATEGORY_MANAGER,FINANCE,READONLY), `MASTER_DATA_WRITE` = {ADMIN} —
// göç öncesi/sonrası @Roles kümesiyle BİREBİR, davranış KORUNUYOR.
// `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİL — `W8`'in kapanışında ele alınır.
@ApiTags('Master Data - Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('master-data/channels')
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  @Post()
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Create a new channel' })
  @ApiResponse({
    status: 201,
    description: 'Channel created successfully',
    type: Channel,
  })
  create(
    @TenantId() tenantId: string,
    @Body() createChannelDto: CreateChannelDto,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.channelService.create(
      tenantId,
      createChannelDto,
      user?.id || user?.sub,
      user?.email,
      ipAddress,
    );
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
  @ApiOperation({ summary: 'Get all channels' })
  @ApiResponse({
    status: 200,
    description: 'List of channels',
    type: [Channel],
  })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.channelService.findAll(tenantId, activeOnly === 'true');
  }

  // T-267 (B1 §1a) — aynı gerekçe (yukarı bkz.)
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  @ApiResponse({ status: 200, description: 'Channel details', type: Channel })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channelService.findOne(tenantId, id);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @ApiOperation({ summary: 'Update channel' })
  @ApiResponse({
    status: 200,
    description: 'Channel updated successfully',
    type: Channel,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateChannelDto: UpdateChannelDto,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.channelService.update(
      tenantId,
      id,
      updateChannelDto,
      user?.id || user?.sub,
      user?.email,
      ipAddress,
    );
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.MASTER_DATA_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete channel' })
  @ApiResponse({ status: 204, description: 'Channel deleted successfully' })
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.channelService.remove(
      tenantId,
      id,
      user?.id || user?.sub,
      user?.email,
      ipAddress,
    );
  }
}
