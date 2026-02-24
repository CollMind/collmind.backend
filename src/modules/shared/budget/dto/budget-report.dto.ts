import { IsEnum, IsDateString, IsUUID, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PeriodType } from '../../../../database/entities/budget-allocation.entity';

export class BudgetReportFilters {
  @ApiPropertyOptional({ description: 'Period type', enum: PeriodType })
  @IsEnum(PeriodType)
  @IsOptional()
  periodType?: PeriodType;

  @ApiPropertyOptional({ description: 'Fiscal year' })
  @IsOptional()
  fiscalYear?: number;

  @ApiPropertyOptional({ description: 'CPL ID' })
  @IsUUID()
  @IsOptional()
  cplId?: string;

  @ApiPropertyOptional({ description: 'Channel code' })
  @IsString()
  @IsOptional()
  channel?: string;

  @ApiPropertyOptional({ description: 'Category code' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Period start date' })
  @IsDateString()
  @IsOptional()
  periodStart?: string;

  @ApiPropertyOptional({ description: 'Period end date' })
  @IsDateString()
  @IsOptional()
  periodEnd?: string;
}

export class BudgetBreakdown {
  onInvoice!: {
    budget: number;
    utilized: number;
    reserved: number;
    available: number;
    utilizationPercent: number;
  };
  offInvoice!: {
    budget: number;
    utilized: number;
    reserved: number;
    available: number;
    utilizationPercent: number;
  };
  total!: {
    budget: number;
    utilized: number;
    reserved: number;
    available: number;
    utilizationPercent: number;
  };
}

export class BudgetReport {
  @ApiProperty({ description: 'Report period' })
  period!: {
    type: PeriodType;
    start: Date;
    end: Date;
    fiscalYear: number;
  };

  @ApiProperty({ description: 'Budget breakdown', type: BudgetBreakdown })
  breakdown!: BudgetBreakdown;

  @ApiProperty({ description: 'Trend comparison (previous period)' })
  trendComparison?: {
    previousPeriod: BudgetBreakdown;
    change: {
      budget: number;
      utilized: number;
      utilizationPercent: number;
    };
  };

  @ApiProperty({ description: 'Top consuming plans', type: [Object] })
  topConsumingPlans!: Array<{
    planId: string;
    planName: string;
    onInvoiceSpend: number;
    offInvoiceSpend: number;
    totalSpend: number;
  }>;
}

export class ForecastContext {
  @ApiProperty({ description: 'CPL ID' })
  @IsUUID()
  cplId!: string;

  @ApiProperty({ description: 'Channel code' })
  @IsString()
  channel!: string;

  @ApiProperty({ description: 'Category code' })
  @IsString()
  category!: string;

  @ApiProperty({ description: 'Period start date' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ description: 'Period end date' })
  @IsDateString()
  periodEnd!: string;
}

export class BudgetForecast {
  @ApiProperty({ description: 'Current budget status' })
  current!: BudgetBreakdown;

  @ApiProperty({ description: 'Planned spend from pending plans' })
  plannedSpend!: {
    onInvoice: number;
    offInvoice: number;
    total: number;
  };

  @ApiProperty({ description: 'Forecasted remaining budget' })
  forecastedRemaining!: {
    onInvoice: number;
    offInvoice: number;
    total: number;
  };

  @ApiProperty({ description: 'Estimated additional plans possible' })
  estimatedAdditionalPlans!: {
    onInvoice: number;
    offInvoice: number;
    conservative: number; // Min of on/off
  };

  @ApiProperty({ description: 'Budget at risk (RED status plans)' })
  budgetAtRisk!: {
    onInvoice: number;
    offInvoice: number;
    total: number;
    plans: Array<{
      planId: string;
      planName: string;
      riskAmount: number;
    }>;
  };
}
