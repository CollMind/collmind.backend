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
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MechanicService } from './mechanic.service';
import { CreateMechanicDto } from './dto/create-mechanic.dto';
import { UpdateMechanicDto } from './dto/update-mechanic.dto';
import { PlanContextDto } from './dto/plan-context.dto';
import { ValidationResult } from './dto/validation-result.dto';
import { CombinationCheckResult } from './dto/combination-check-result.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
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
  create(
    @TenantId() tenantId: string,
    @Body() createMechanicDto: CreateMechanicDto,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.create(
      tenantId,
      createMechanicDto,
      user?.sub,
      user?.email,
      ipAddress,
    );
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
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.update(tenantId, id, updateMechanicDto, user?.sub, user?.email, ipAddress);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete mechanic' })
  @ApiResponse({ status: 204, description: 'Mechanic deleted successfully' })
  remove(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.remove(tenantId, id, user?.sub, user?.email, ipAddress);
  }

  @Post('validate-formula')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Validate calculation formula' })
  @ApiResponse({ status: 200, description: 'Formula validation result', type: ValidationResult })
  validateFormula(
    @Body() body: { formula: string; testContext?: Record<string, any> },
  ): Promise<ValidationResult> {
    return this.mechanicService.validateFormula(body.formula, body.testContext || {});
  }

  @Post('applicable')
  @ApiOperation({ summary: 'Get applicable mechanics for plan context' })
  @ApiResponse({ status: 200, description: 'List of applicable mechanics', type: [Mechanic] })
  getApplicableMechanics(
    @TenantId() tenantId: string,
    @Body() planContext: PlanContextDto,
  ): Promise<Mechanic[]> {
    return this.mechanicService.getApplicableMechanics(tenantId, planContext);
  }

  @Post('check-combination')
  @ApiOperation({ summary: 'Check if mechanic combination is valid' })
  @ApiResponse({ status: 200, description: 'Combination check result', type: CombinationCheckResult })
  checkCombination(
    @TenantId() tenantId: string,
    @Body() body: { mechanicCodes: string[] },
  ): Promise<CombinationCheckResult> {
    return this.mechanicService.checkCombinationValidity(tenantId, body.mechanicCodes);
  }

  @Post(':id/clone')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Clone a mechanic' })
  @ApiResponse({ status: 201, description: 'Mechanic cloned successfully', type: Mechanic })
  cloneMechanic(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() overrides: Partial<CreateMechanicDto>,
    @CurrentUser() user: any,
    @Request() req: any,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.mechanicService.cloneMechanic(tenantId, id, overrides, user?.sub, user?.email, ipAddress);
  }
}
