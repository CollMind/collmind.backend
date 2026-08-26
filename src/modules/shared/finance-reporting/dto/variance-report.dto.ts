import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
} from 'class-validator';
import { ReportFilters } from './report-filters.dto';
import { ComparisonType as SharedComparisonType } from './report-filters.dto';

export enum ComparisonType {
  BUDGET_VS_ACTUAL = 'budget_vs_actual',
  FORECAST_VS_ACTUAL = 'forecast_vs_actual',
  PREVIOUS_PERIOD = 'previous_period',
}

/**
 * [[T-296]] — `variance-analysis`'e özel. Önceden controller
 * `comparisonType`'ı `@Query('comparisonType')` olarak, `ReportFilters`'tan
 * AYRI bildiriyordu. `whitelist:true, forbidNonWhitelisted:true` altında
 * `?comparisonType=...` gönderen her istek `400 "property comparisonType
 * should not exist"` alıyordu. Not: bu dosyanın kendi `ComparisonType`'ı
 * (response tipi için) `report-filters.dto.ts`'teki `ComparisonType`'tan
 * AYRI bir enum — controller ikincisini kullanıyor (bkz.
 * `finance-reporting.controller.ts` import'u); bu DTO da ONU referans alır,
 * ikisini karıştırmamak için `SharedComparisonType` diye içe aktarıldı.
 */
export class VarianceAnalysisQueryDto extends ReportFilters {
  @ApiPropertyOptional({
    description: 'Comparison type',
    enum: SharedComparisonType,
    default: SharedComparisonType.BUDGET_VS_ACTUAL,
  })
  @IsEnum(SharedComparisonType)
  @IsOptional()
  comparisonType?: SharedComparisonType = SharedComparisonType.BUDGET_VS_ACTUAL;
}

export class VarianceItem {
  @ApiProperty({ description: 'Category (On-Invoice, Off-Invoice, Total)' })
  @IsString()
  category!: string;

  @ApiProperty({ description: 'Budget/Forecast/Previous value' })
  @IsNumber()
  planned!: number;

  @ApiProperty({ description: 'Actual value' })
  @IsNumber()
  actual!: number;

  @ApiProperty({ description: 'Variance amount' })
  @IsNumber()
  variance!: number;

  @ApiProperty({ description: 'Variance percentage' })
  @IsNumber()
  variancePercent!: number;

  @ApiPropertyOptional({ description: 'Explanation' })
  @IsString()
  @IsOptional()
  explanation?: string;
}

export class VarianceReport {
  @ApiProperty({ description: 'Comparison type', enum: ComparisonType })
  @IsEnum(ComparisonType)
  comparisonType!: ComparisonType;

  @ApiProperty({ description: 'Period start' })
  @IsString()
  periodStart!: string;

  @ApiProperty({ description: 'Period end' })
  @IsString()
  periodEnd!: string;

  @ApiProperty({ description: 'Variance items', type: [VarianceItem] })
  @IsArray()
  variances!: VarianceItem[];

  @ApiProperty({ description: 'Total variance' })
  @IsNumber()
  totalVariance!: number;

  @ApiProperty({ description: 'Total variance percentage' })
  @IsNumber()
  totalVariancePercent!: number;
}
