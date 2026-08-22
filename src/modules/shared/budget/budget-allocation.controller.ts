import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
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
import { BudgetAllocationService } from './budget-allocation.service';
import { CreateBudgetAllocationDto } from './dto/create-budget-allocation.dto';
import {
  BudgetCheckContext,
  AvailabilityResult,
} from './dto/budget-check-context.dto';
import {
  BudgetReportFilters,
  BudgetReport,
  ForecastContext,
  BudgetForecast,
} from './dto/budget-report.dto';
import { SpendBreakdown } from '../spend-calculation/dto/spend-breakdown.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../database/entities/user.entity';
import { BudgetAllocation } from '../../../database/entities/budget-allocation.entity';

@ApiTags('Budget Allocations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('budget-allocations')
export class BudgetAllocationController {
  constructor(
    private readonly budgetAllocationService: BudgetAllocationService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Create a new budget allocation' })
  @ApiResponse({
    status: 201,
    description: 'Budget allocation created successfully',
    type: BudgetAllocation,
  })
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() createDto: CreateBudgetAllocationDto,
  ) {
    return this.budgetAllocationService.createAllocation(
      tenantId,
      user.id,
      createDto,
    );
  }

  // T-267 (B1 §S2+S3, "12 tüketicisiz uç, tek aile") — bu HTTP controller
  // TÜKETİCİSİZ (frontend '/budget-allocations' → 0 eşleşme, ölçüldü);
  // BudgetAllocationService'in kendisi CANLI (spend-validation,
  // finance-reporting üzerinden) ama BU rota YÜZEYİ değil. T-257 dersi:
  // "silinecekse bile silinene kadar açık kalamaz" — kader kararı
  // [[T-265]]'e bırakılır, B2 bekletilmez.
  // Rol seti: KARDEŞ uç — budget.controller.ts'in aynı domain'deki 5 okuma
  // ucu bu turda BEŞ ROL aldı (B1 §S3 final karar); bu controller onun ölü
  // ikizi (B1 S3: "iki paralel bütçe yüzeyi") — aynı rol seti uygulanır.
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.PLANNER,
    UserRole.READONLY,
  )
  @Get()
  @ApiOperation({ summary: 'Get all budget allocations' })
  @ApiResponse({
    status: 200,
    description: 'List of budget allocations',
    type: [BudgetAllocation],
  })
  findAll(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub, öncesinden TODO
    @TenantId() tenantId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub, öncesinden TODO
    @Query('fiscalYear') fiscalYear?: number,
  ) {
    // TODO: Implement findAll method in service
    return [];
  }

  // T-267 (B1 §S2/S3) — aynı gerekçe (yukarı bkz.): TÜKETİCİSİZ, BEŞ ROL
  // budget.controller kardeşinden.
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.PLANNER,
    UserRole.READONLY,
  )
  @Get(':id')
  @ApiOperation({ summary: 'Get budget allocation by ID' })
  @ApiResponse({
    status: 200,
    description: 'Budget allocation details',
    type: BudgetAllocation,
  })
  findOne(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub, öncesinden TODO
    @TenantId() tenantId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub, öncesinden TODO
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // TODO: Implement findOne method in service
    return null;
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Update budget allocation' })
  @ApiResponse({
    status: 200,
    description: 'Budget allocation updated successfully',
    type: BudgetAllocation,
  })
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: Partial<CreateBudgetAllocationDto>,
  ) {
    return this.budgetAllocationService.updateAllocation(
      tenantId,
      user.id,
      id,
      updateDto,
    );
  }

  // T-267 (B1 §S2, "Ölçüm 1": YAZMA:0) — hesaplama, yazma DEĞİL; TÜKETİCİSİZ
  // (aynı aile, yukarı bkz.). Rol seti aynı: BEŞ ROL.
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.PLANNER,
    UserRole.READONLY,
  )
  @Post('check-availability')
  @ApiOperation({ summary: 'Check budget availability for a plan' })
  @ApiResponse({
    status: 200,
    description: 'Budget availability result',
    type: AvailabilityResult,
  })
  checkAvailability(
    @TenantId() tenantId: string,
    @Body() context: BudgetCheckContext,
  ) {
    return this.budgetAllocationService.checkAvailability(tenantId, context);
  }

  @Post('reserve')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reserve budget for a plan (pending approval)' })
  @ApiResponse({ status: 204, description: 'Budget reserved successfully' })
  reserveBudget(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { planId: string; amounts: SpendBreakdown },
  ) {
    return this.budgetAllocationService.reserveBudget(
      tenantId,
      user.id,
      body.planId,
      body.amounts,
    );
  }

  @Post('commit')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Commit budget (plan approved)' })
  @ApiResponse({ status: 204, description: 'Budget committed successfully' })
  commitBudget(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { planId: string },
  ) {
    return this.budgetAllocationService.commitBudget(
      tenantId,
      user.id,
      body.planId,
    );
  }

  @Post('release')
  @Roles(UserRole.ADMIN, UserRole.CATEGORY_MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Release reserved budget (plan rejected/withdrawn)',
  })
  @ApiResponse({ status: 204, description: 'Budget released successfully' })
  releaseBudget(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { planId: string },
  ) {
    return this.budgetAllocationService.releaseBudget(
      tenantId,
      user.id,
      body.planId,
    );
  }

  @Post('adjust')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Adjust budget utilization (plan revised)' })
  @ApiResponse({ status: 204, description: 'Budget adjusted successfully' })
  adjustUtilization(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: { planId: string; newAmounts: SpendBreakdown; reason: string },
  ) {
    return this.budgetAllocationService.adjustUtilization(
      tenantId,
      user.id,
      body.planId,
      body.newAmounts,
      body.reason,
    );
  }

  // T-267 (B1 §S2/S3) — aynı gerekçe (yukarı bkz.): TÜKETİCİSİZ, BEŞ ROL
  // budget.controller kardeşinden.
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.PLANNER,
    UserRole.READONLY,
  )
  @Get('reports/utilization')
  @ApiOperation({ summary: 'Get budget utilization report' })
  @ApiResponse({
    status: 200,
    description: 'Budget utilization report',
    type: BudgetReport,
  })
  getUtilizationReport(
    @TenantId() tenantId: string,
    @Query() filters: BudgetReportFilters,
  ) {
    return this.budgetAllocationService.getBudgetUtilizationReport(
      tenantId,
      filters,
    );
  }

  // T-267 (B1 §S2, "Ölçüm 1": YAZMA:0) — hesaplama, yazma DEĞİL; TÜKETİCİSİZ
  // (aynı aile, yukarı bkz.). Rol seti aynı: BEŞ ROL.
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.PLANNER,
    UserRole.READONLY,
  )
  @Post('reports/forecast')
  @ApiOperation({ summary: 'Get budget forecast report' })
  @ApiResponse({
    status: 200,
    description: 'Budget forecast report',
    type: BudgetForecast,
  })
  getForecastReport(
    @TenantId() tenantId: string,
    @Body() context: ForecastContext,
  ) {
    return this.budgetAllocationService.getForecastReport(tenantId, context);
  }
}
