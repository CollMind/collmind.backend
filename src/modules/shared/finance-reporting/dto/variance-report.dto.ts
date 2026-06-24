import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsEnum,
  IsArray,
  IsObject,
  IsOptional,
} from 'class-validator';

export enum ComparisonType {
  BUDGET_VS_ACTUAL = 'budget_vs_actual',
  FORECAST_VS_ACTUAL = 'forecast_vs_actual',
  PREVIOUS_PERIOD = 'previous_period',
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
