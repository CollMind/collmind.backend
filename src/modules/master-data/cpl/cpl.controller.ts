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
import { CplService } from './cpl.service';
import { CreateCplDto } from './dto/create-cpl.dto';
import { UpdateCplDto } from './dto/update-cpl.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { Cpl } from '../../../database/entities/cpl.entity';

@ApiTags('Master Data - CPLs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/cpls')
export class CplController {
  constructor(private readonly cplService: CplService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new CPL' })
  @ApiResponse({
    status: 201,
    description: 'CPL created successfully',
    type: Cpl,
  })
  create(@TenantId() tenantId: string, @Body() createCplDto: CreateCplDto) {
    return this.cplService.create(tenantId, createCplDto);
  }

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

  @Get(':id')
  @ApiOperation({ summary: 'Get CPL by ID' })
  @ApiResponse({ status: 200, description: 'CPL details', type: Cpl })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cplService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update CPL' })
  @ApiResponse({
    status: 200,
    description: 'CPL updated successfully',
    type: Cpl,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateCplDto: UpdateCplDto,
  ) {
    return this.cplService.update(tenantId, id, updateCplDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete CPL' })
  @ApiResponse({ status: 204, description: 'CPL deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cplService.remove(tenantId, id);
  }
}
