import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FinanceReportingService } from './finance-reporting.service';
import {
  ReportFilters,
  PaginationParams,
  ReportGranularity,
  ComparisonType,
} from './dto/report-filters.dto';
import { BudgetUtilizationReport } from './dto/budget-utilization.dto';
import { TrendReport, SpendTrendQueryDto } from './dto/trend-report.dto';
import { CompositionReport } from './dto/composition-report.dto';
import { PaginatedPlanReport } from './dto/plan-performance.dto';
import { RiskReport } from './dto/risk-report.dto';
import { MechanicReport } from './dto/mechanic-effectiveness.dto';
import {
  VarianceReport,
  VarianceAnalysisQueryDto,
} from './dto/variance-report.dto';
import {
  CashFlowReport,
  CashFlowProjectionQueryDto,
} from './dto/cash-flow-report.dto';
import {
  BudgetVarianceReport,
  BudgetVarianceQueryDto,
} from './dto/budget-variance-report.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../database/entities/user.entity';

@ApiTags('Finance Reporting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('finance-reporting')
export class FinanceReportingController {
  constructor(
    private readonly financeReportingService: FinanceReportingService,
  ) {}

  @Get('budget-utilization')
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get budget utilization report' })
  @ApiResponse({
    status: 200,
    description: 'Budget utilization report',
    type: BudgetUtilizationReport,
  })
  getBudgetUtilization(
    @TenantId() tenantId: string,
    @Query() filters: ReportFilters,
  ) {
    return this.financeReportingService.getBudgetUtilization(tenantId, filters);
  }

  @Get('spend-trend')
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get spend trend report' })
  @ApiResponse({
    status: 200,
    description: 'Spend trend report',
    type: TrendReport,
  })
  getSpendTrend(
    @TenantId() tenantId: string,
    @Query() query: SpendTrendQueryDto,
  ) {
    // [[T-296]] `granularity` artık tek yerde: `SpendTrendQueryDto.granularity`
    // (DTO-level default + `@IsEnum`). Çıplak `@Query('granularity')`
    // bildirimi kaldırıldı — bkz. dto/trend-report.dto.ts. `plainToInstance`
    // initializer'ı çalıştırdığı için `query.granularity` hiçbir zaman
    // `undefined` değil (`PaginationParams.page` ile aynı desen).
    return this.financeReportingService.getSpendTrend(
      tenantId,
      query,
      query.granularity as ReportGranularity,
    );
  }

  @Get('spend-composition')
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get spend composition report' })
  @ApiResponse({
    status: 200,
    description: 'Spend composition report',
    type: CompositionReport,
  })
  getSpendComposition(
    @TenantId() tenantId: string,
    @Query() filters: ReportFilters,
  ) {
    return this.financeReportingService.getSpendComposition(tenantId, filters);
  }

  @Get('plan-performance')
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.PLANNER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get plan performance report' })
  @ApiResponse({
    status: 200,
    description: 'Plan performance report',
    type: PaginatedPlanReport,
  })
  getPlanPerformance(
    @TenantId() tenantId: string,
    @Query() filters: ReportFilters,
    @Query() pagination: PaginationParams,
  ) {
    return this.financeReportingService.getPlanPerformance(
      tenantId,
      filters,
      pagination,
    );
  }

  @Get('budget-at-risk')
  @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.READONLY)
  @ApiOperation({ summary: 'Get budget at risk analysis' })
  @ApiResponse({
    status: 200,
    description: 'Budget at risk report',
    type: RiskReport,
  })
  getBudgetAtRisk(
    @TenantId() tenantId: string,
    @Query() filters: ReportFilters,
  ) {
    return this.financeReportingService.getBudgetAtRisk(tenantId, filters);
  }

  @Get('mechanic-effectiveness')
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({ summary: 'Get mechanic effectiveness report' })
  @ApiResponse({
    status: 200,
    description: 'Mechanic effectiveness report',
    type: MechanicReport,
  })
  getMechanicEffectiveness(
    @TenantId() tenantId: string,
    @Query() filters: ReportFilters,
  ) {
    return this.financeReportingService.getMechanicEffectiveness(
      tenantId,
      filters,
    );
  }

  @Get('variance-analysis')
  @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.READONLY)
  @ApiOperation({ summary: 'Get variance analysis report' })
  @ApiResponse({
    status: 200,
    description: 'Variance analysis report',
    type: VarianceReport,
  })
  getVarianceAnalysis(
    @TenantId() tenantId: string,
    @Query() query: VarianceAnalysisQueryDto,
  ) {
    // [[T-296]] `comparisonType` artık tek yerde:
    // `VarianceAnalysisQueryDto.comparisonType`. Çıplak
    // `@Query('comparisonType')` bildirimi kaldırıldı — bkz.
    // dto/variance-report.dto.ts.
    return this.financeReportingService.getVarianceAnalysis(
      tenantId,
      query,
      query.comparisonType as ComparisonType,
    );
  }

  @Get('budget-variance')
  @Roles(
    UserRole.ADMIN,
    UserRole.FINANCE,
    UserRole.CATEGORY_MANAGER,
    UserRole.READONLY,
  )
  @ApiOperation({
    summary:
      'Get budget variance report (allocated vs. consumed/GERÇEKLEŞEN, channel/category/period breakdown)',
  })
  @ApiResponse({
    status: 200,
    description: 'Budget variance report',
    type: BudgetVarianceReport,
  })
  getBudgetVariance(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Query() filters: BudgetVarianceQueryDto,
  ) {
    return this.financeReportingService.getBudgetVarianceReport(
      tenantId,
      user.id,
      user.role,
      filters,
    );
  }

  @Get('cash-flow-projection')
  @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.READONLY)
  @ApiOperation({ summary: 'Get cash flow projection' })
  @ApiResponse({
    status: 200,
    description: 'Cash flow projection report',
    type: CashFlowReport,
  })
  getCashFlowProjection(
    @TenantId() tenantId: string,
    @Query() filters: CashFlowProjectionQueryDto,
  ) {
    // [[T-294]]/[[T-296]] `months` artık tek yerde:
    // `CashFlowProjectionQueryDto.months` (DTO-level default +
    // @Type(()=>Number)/@IsInt/@Min/@Max). Çıplak `@Query('months')`
    // bildirimi kaldırıldı — bkz. dto/cash-flow-report.dto.ts. `months`
    // ayrıca `ReportFilters`'tan (paylaşılan, sekiz uçta kullanılan DTO)
    // buraya taşındı — bkz. T-296 S2.
    return this.financeReportingService.getCashFlowProjection(
      tenantId,
      filters,
      // ⛔ `?? 12` KALDIRILDI (code-reviewer S1, 2026-08-26): ÖLÜ KOD ve
      // İKİNCİ BİR VARSAYILAN. `plainToInstance` DTO'yu inşa ederken
      // initializer (`= 12`) çalışır, yani `filters.months` HİÇBİR ZAMAN
      // `undefined` değil. Mutasyonla ölçüldü: `?? 999` yapıldığında pin
      // YEŞİL kaldı — sağ taraf hiç değerlendirilmiyor.
      // Bırakılsaydı `İlke 4` (aynı olgunun iki temsili): DTO'daki varsayılan
      // değişirse buradaki SESSİZCE ayrı bir varsayılan olurdu — ve pin bunu
      // GÖRMÜYOR, yani ayrışma sessiz kalırdı.
      filters.months as number,
    );
  }
}
