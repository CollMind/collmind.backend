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
import { FuService } from './fu.service';
import { CreateFuDto } from './dto/create-fu.dto';
import { UpdateFuDto } from './dto/update-fu.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { ForecastingUnit } from '../../../database/entities/forecasting-unit.entity';

@ApiTags('Master Data - Forecasting Units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/forecasting-units')
export class FuController {
  constructor(private readonly fuService: FuService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new Forecasting Unit' })
  @ApiResponse({ status: 201, description: 'Forecasting Unit created successfully', type: ForecastingUnit })
  create(@TenantId() tenantId: string, @Body() createFuDto: CreateFuDto) {
    return this.fuService.create(tenantId, createFuDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all Forecasting Units' })
  @ApiResponse({ status: 200, description: 'List of Forecasting Units', type: [ForecastingUnit] })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('guId') guId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.fuService.findAll(tenantId, activeOnly === 'true', guId, categoryId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Forecasting Unit by ID' })
  @ApiResponse({ status: 200, description: 'Forecasting Unit details', type: ForecastingUnit })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fuService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update Forecasting Unit' })
  @ApiResponse({ status: 200, description: 'Forecasting Unit updated successfully', type: ForecastingUnit })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateFuDto: UpdateFuDto,
  ) {
    return this.fuService.update(tenantId, id, updateFuDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete Forecasting Unit' })
  @ApiResponse({ status: 204, description: 'Forecasting Unit deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fuService.remove(tenantId, id);
  }
}
