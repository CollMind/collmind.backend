import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsUUID,
  IsString,
  IsEnum,
  IsArray,
  IsObject,
  IsBoolean,
} from 'class-validator';

export enum DistributionStatus {
  SUCCESS = 'success',
  PARTIAL = 'partial',
  FAILED = 'failed',
}

export class SKUDistribution {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ description: 'SKU Code' })
  @IsString()
  skuCode!: string;

  @ApiProperty({ description: 'Distributed amount for this SKU' })
  @IsNumber()
  amount!: number;

  @ApiProperty({ description: 'Distribution ratio (0-1)' })
  @IsNumber()
  ratio!: number;

  @ApiProperty({ description: 'Distribution basis used' })
  @IsString()
  basis!: string; // 'base_volume_ratio', 'planned_volume_ratio', 'equal', 'percentage', 'per_unit'
}

export class DistributionResult {
  @ApiProperty({ description: 'Distribution status', enum: DistributionStatus })
  @IsEnum(DistributionStatus)
  status!: DistributionStatus;

  @ApiProperty({ description: 'Total FU-level spend' })
  @IsNumber()
  totalSpend!: number;

  @ApiProperty({ description: 'Sum of all SKU distributions' })
  @IsNumber()
  distributedTotal!: number;

  @ApiProperty({ description: 'Difference (should be 0 or within tolerance)' })
  @IsNumber()
  difference!: number;

  @ApiProperty({
    description: 'SKU-level distributions',
    type: [SKUDistribution],
  })
  @IsArray()
  skuDistributions!: SKUDistribution[];

  @ApiPropertyOptional({ description: 'Warning messages' })
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];

  @ApiPropertyOptional({ description: 'Error messages' })
  @IsArray()
  @IsString({ each: true })
  errors?: string[];
}

export class FUDistributionBreakdown {
  @ApiProperty({ description: 'Plan FU ID' })
  @IsUUID()
  planFuId!: string;

  @ApiProperty({ description: 'Mechanic distributions', type: 'object' })
  @IsObject()
  mechanics!: Record<
    string,
    {
      mechanicCode: string;
      mechanicName: string;
      fuValue: number;
      distributionMethod: string;
      skuDistributions: SKUDistribution[];
      totalDistributed: number;
      isValid: boolean;
    }
  >;

  @ApiProperty({ description: 'Total on-invoice spend' })
  @IsNumber()
  totalOnInvoice!: number;

  @ApiProperty({ description: 'Total off-invoice spend' })
  @IsNumber()
  totalOffInvoice!: number;
}

export class DistributionValidationResult {
  @ApiProperty({ description: 'Is distribution valid?' })
  @IsBoolean()
  isValid!: boolean;

  @ApiProperty({ description: 'Total FU spend' })
  @IsNumber()
  fuTotalSpend!: number;

  @ApiProperty({ description: 'Sum of SKU distributions' })
  @IsNumber()
  skuTotalDistributed!: number;

  @ApiProperty({ description: 'Difference' })
  @IsNumber()
  difference!: number;

  @ApiProperty({ description: 'Tolerance used' })
  @IsNumber()
  tolerance!: number;

  @ApiPropertyOptional({
    description: 'Mechanics with validation issues',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  invalidMechanics?: string[];

  @ApiPropertyOptional({
    description: 'Adjustments made to fix rounding errors',
  })
  @IsObject()
  adjustments?: Record<string, number>;
}
