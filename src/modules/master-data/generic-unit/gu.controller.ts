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
import { GuService } from './gu.service';
import { CreateGuDto } from './dto/create-gu.dto';
import { UpdateGuDto } from './dto/update-gu.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { GenericUnit } from '../../../database/entities/generic-unit.entity';

@ApiTags('Master Data - Generic Units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('master-data/generic-units')
export class GuController {
  constructor(private readonly guService: GuService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new Generic Unit' })
  @ApiResponse({
    status: 201,
    description: 'Generic Unit created successfully',
    type: GenericUnit,
  })
  create(@TenantId() tenantId: string, @Body() createGuDto: CreateGuDto) {
    return this.guService.create(tenantId, createGuDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all Generic Units' })
  @ApiResponse({
    status: 200,
    description: 'List of Generic Units',
    type: [GenericUnit],
  })
  findAll(
    @TenantId() tenantId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.guService.findAll(tenantId, activeOnly === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Generic Unit by ID' })
  @ApiResponse({
    status: 200,
    description: 'Generic Unit details',
    type: GenericUnit,
  })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.guService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update Generic Unit' })
  @ApiResponse({
    status: 200,
    description: 'Generic Unit updated successfully',
    type: GenericUnit,
  })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateGuDto: UpdateGuDto,
  ) {
    return this.guService.update(tenantId, id, updateGuDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete Generic Unit' })
  @ApiResponse({
    status: 204,
    description: 'Generic Unit deleted successfully',
  })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.guService.remove(tenantId, id);
  }
}
