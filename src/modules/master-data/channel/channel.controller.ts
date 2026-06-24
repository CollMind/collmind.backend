import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
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
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Request } from '@nestjs/common';
import { UserRole } from '../../../database/entities/user.entity';
import { Channel } from '../../../database/entities/channel.entity';

@ApiTags('Master Data - Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/channels')
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  @Post()
  @Roles(UserRole.ADMIN)
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

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  @ApiResponse({ status: 200, description: 'Channel details', type: Channel })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.channelService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update channel' })
  @ApiResponse({
    status: 200,
    description: 'Channel updated successfully',
    type: Channel,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
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
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete channel' })
  @ApiResponse({ status: 204, description: 'Channel deleted successfully' })
  remove(
    @TenantId() tenantId: string,
    @Param('id') id: string,
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
