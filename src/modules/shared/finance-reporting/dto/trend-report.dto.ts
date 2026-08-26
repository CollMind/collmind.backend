import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsArray,
  IsObject,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { ReportFilters, ReportGranularity } from './report-filters.dto';

/**
 * [[T-296]] — `spend-trend`'e özel. Önceden controller `granularity`'yi
 * `@Query('granularity') granularity: ReportGranularity = ReportGranularity.MONTHLY`
 * olarak, `ReportFilters`'tan (whitelist DTO) AYRI bildiriyordu. Global
 * `ValidationPipe`'ın `whitelist:true, forbidNonWhitelisted:true` ayarı
 * altında bu, `?granularity=...` gönderen her isteği `400 "property
 * granularity should not exist"` ile reddediyordu — desen `BudgetVarianceQueryDto`
 * ile aynı (uç-özel alan, DTO'ya taşınır).
 */
export class SpendTrendQueryDto extends ReportFilters {
  @ApiPropertyOptional({
    description: 'Trend granularity',
    enum: ReportGranularity,
    default: ReportGranularity.MONTHLY,
  })
  @IsEnum(ReportGranularity)
  @IsOptional()
  granularity?: ReportGranularity = ReportGranularity.MONTHLY;
}

export class TrendDataPoint {
  @ApiProperty({ description: 'Date (YYYY-MM-DD)' })
  @IsString()
  date!: string;

  @ApiProperty({ description: 'On-Invoice spend' })
  @IsNumber()
  onInvoice!: number;

  @ApiProperty({ description: 'Off-Invoice spend' })
  @IsNumber()
  offInvoice!: number;

  @ApiProperty({ description: 'Total spend' })
  @IsNumber()
  total!: number;

  @ApiPropertyOptional({ description: 'LTA On-Invoice spend' })
  @IsNumber()
  @IsOptional()
  ltaOnInvoice?: number;

  @ApiPropertyOptional({ description: 'LTA Off-Invoice spend' })
  @IsNumber()
  @IsOptional()
  ltaOffInvoice?: number;

  @ApiPropertyOptional({ description: 'Promo On-Invoice spend' })
  @IsNumber()
  @IsOptional()
  promoOnInvoice?: number;

  @ApiPropertyOptional({ description: 'Promo Off-Invoice spend' })
  @IsNumber()
  @IsOptional()
  promoOffInvoice?: number;

  @ApiPropertyOptional({ description: 'Budget target' })
  @IsNumber()
  @IsOptional()
  budgetTarget?: number;

  @ApiPropertyOptional({ description: 'Previous year value' })
  @IsNumber()
  @IsOptional()
  previousYear?: number;
}

export class TrendReport {
  @ApiProperty({
    description: 'Granularity',
    enum: ['daily', 'weekly', 'monthly'],
  })
  @IsString()
  granularity!: string;

  @ApiProperty({ description: 'Trend data points', type: [TrendDataPoint] })
  @IsArray()
  dataPoints!: TrendDataPoint[];

  @ApiProperty({ description: 'Total On-Invoice spend for period' })
  @IsNumber()
  totalOnInvoice!: number;

  @ApiProperty({ description: 'Total Off-Invoice spend for period' })
  @IsNumber()
  totalOffInvoice!: number;

  @ApiProperty({ description: 'Average daily On-Invoice spend' })
  @IsNumber()
  avgDailyOnInvoice!: number;

  @ApiProperty({ description: 'Average daily Off-Invoice spend' })
  @IsNumber()
  avgDailyOffInvoice!: number;

  @ApiPropertyOptional({ description: 'Growth rate vs previous period (%)' })
  @IsNumber()
  @IsOptional()
  growthRate?: number;
}
