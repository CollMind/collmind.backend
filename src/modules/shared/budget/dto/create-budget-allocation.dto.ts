import {
  IsEnum,
  IsDateString,
  IsInt,
  IsUUID,
  IsString,
  IsNumber,
  Min,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateIf,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PeriodType } from '../../../../database/entities/budget-allocation.entity';

export class CreateBudgetAllocationDto {
  @ApiProperty({ description: 'Period type', enum: PeriodType })
  @IsEnum(PeriodType)
  periodType!: PeriodType;

  @ApiProperty({ description: 'Period start date', example: '2025-01-01' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ description: 'Period end date', example: '2025-12-31' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ description: 'Fiscal year', example: 2025 })
  @IsInt()
  fiscalYear!: number;

  @ApiPropertyOptional({ description: 'CPL ID (optional - for general budget)' })
  @IsUUID()
  @IsOptional()
  cplId?: string;

  @ApiPropertyOptional({ description: 'Channel code (optional)', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  channel?: string;

  @ApiPropertyOptional({ description: 'Category code (optional)', maxLength: 100 })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ description: 'On-invoice budget amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  onInvoiceBudget!: number;

  @ApiProperty({ description: 'Off-invoice budget amount', minimum: 0 })
  @IsNumber()
  @Min(0)
  offInvoiceBudget!: number;

  @ApiPropertyOptional({ description: 'Alert threshold 80% enabled', default: true })
  @IsBoolean()
  @IsOptional()
  alertThreshold80?: boolean;

  @ApiPropertyOptional({ description: 'Alert threshold 95% enabled', default: true })
  @IsBoolean()
  @IsOptional()
  alertThreshold95?: boolean;

  @ApiPropertyOptional({ description: 'Alert threshold 100% enabled', default: true })
  @IsBoolean()
  @IsOptional()
  alertThreshold100?: boolean;

  @ApiPropertyOptional({ description: 'Alert recipients (email list)', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  alertRecipients?: string[];

  @ApiPropertyOptional({ description: 'Hard limit mode (block on 100%)', default: false })
  @IsBoolean()
  @IsOptional()
  hardLimitMode?: boolean;

  @ApiPropertyOptional({ description: 'Allow carry forward', default: false })
  @IsBoolean()
  @IsOptional()
  allowCarryForward?: boolean;
}
