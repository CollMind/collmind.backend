import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  FormulaType,
  CalculationLevel,
  DisplayFormat,
  AggregationMethod,
} from '../../../../database/entities/kpi.entity';

export class CreateKpiDto {
  @ApiProperty({ example: 'INCR_VOL' })
  @IsString()
  @IsNotEmpty()
  kpiCode!: string;

  @ApiProperty({ example: 'Incremental Volume' })
  @IsString()
  @IsNotEmpty()
  kpiName!: string;

  @ApiProperty({ example: 'Volume' })
  @IsString()
  @IsNotEmpty()
  kpiGroup!: string;

  @ApiPropertyOptional({ example: 'Planned volume minus base volume' })
  @IsString()
  @IsOptional()
  kpiDescription?: string;

  @ApiProperty({ enum: FormulaType })
  @IsEnum(FormulaType)
  formulaType!: FormulaType;

  @ApiProperty({ example: 'PLANNED_VOL - BASE_VOL' })
  @IsString()
  @IsNotEmpty()
  formulaText!: string;

  @ApiPropertyOptional({ example: ['PLANNED_VOL', 'BASE_VOL'] })
  @IsArray()
  @IsOptional()
  dependsOnKpis?: string[];

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(1)
  @Max(50)
  calculationOrder!: number;

  @ApiProperty({ enum: CalculationLevel })
  @IsEnum(CalculationLevel)
  calculationLevel!: CalculationLevel;

  @ApiProperty({ enum: DisplayFormat })
  @IsEnum(DisplayFormat)
  displayFormat!: DisplayFormat;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  decimalPlaces?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  showInGrid?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsNumber()
  @IsOptional()
  columnOrder?: number;

  @ApiPropertyOptional({ enum: AggregationMethod })
  @IsEnum(AggregationMethod)
  @IsOptional()
  aggregationMethodFu?: AggregationMethod;

  @ApiPropertyOptional({ example: 20 })
  @IsNumber()
  @IsOptional()
  ragGreenThreshold?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsNumber()
  @IsOptional()
  ragAmberThreshold?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, any>;
}
