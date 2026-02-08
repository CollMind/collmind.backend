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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RegionService } from './region.service';
import { CreateRegionDto } from './dto/create-region.dto';
import { UpdateRegionDto } from './dto/update-region.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { Region } from '../../../database/entities/region.entity';

@ApiTags('Master Data - Regions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/regions')
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new region' })
  @ApiResponse({ status: 201, description: 'Region created successfully', type: Region })
  create(@TenantId() tenantId: string, @Body() createRegionDto: CreateRegionDto) {
    return this.regionService.create(tenantId, createRegionDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all regions' })
  @ApiResponse({ status: 200, description: 'List of regions', type: [Region] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.regionService.findAll(tenantId, activeOnly === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get region by ID' })
  @ApiResponse({ status: 200, description: 'Region details', type: Region })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.regionService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update region' })
  @ApiResponse({ status: 200, description: 'Region updated successfully', type: Region })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateRegionDto: UpdateRegionDto,
  ) {
    return this.regionService.update(tenantId, id, updateRegionDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete region' })
  @ApiResponse({ status: 204, description: 'Region deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.regionService.remove(tenantId, id);
  }
}
