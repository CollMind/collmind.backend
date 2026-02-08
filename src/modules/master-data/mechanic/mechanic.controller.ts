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
import { MechanicService } from './mechanic.service';
import { CreateMechanicDto } from './dto/create-mechanic.dto';
import { UpdateMechanicDto } from './dto/update-mechanic.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { Mechanic } from '../../../database/entities/mechanic.entity';

@ApiTags('Master Data - Mechanics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/mechanics')
export class MechanicController {
  constructor(private readonly mechanicService: MechanicService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new mechanic' })
  @ApiResponse({ status: 201, description: 'Mechanic created successfully', type: Mechanic })
  create(@TenantId() tenantId: string, @Body() createMechanicDto: CreateMechanicDto) {
    return this.mechanicService.create(tenantId, createMechanicDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all mechanics' })
  @ApiResponse({ status: 200, description: 'List of mechanics', type: [Mechanic] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('tacticId') tacticId?: string,
  ) {
    return this.mechanicService.findAll(tenantId, activeOnly === 'true', tacticId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get mechanic by ID' })
  @ApiResponse({ status: 200, description: 'Mechanic details', type: Mechanic })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.mechanicService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update mechanic' })
  @ApiResponse({ status: 200, description: 'Mechanic updated successfully', type: Mechanic })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateMechanicDto: UpdateMechanicDto,
  ) {
    return this.mechanicService.update(tenantId, id, updateMechanicDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete mechanic' })
  @ApiResponse({ status: 204, description: 'Mechanic deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.mechanicService.remove(tenantId, id);
  }
}
