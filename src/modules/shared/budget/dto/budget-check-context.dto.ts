import {
  IsUUID,
  IsString,
  IsDateString,
  IsNumber,
  Min,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BudgetCheckContext {
  @ApiPropertyOptional({ description: 'Plan ID (if revising existing plan)' })
  @IsUUID()
  @IsOptional()
  planId?: string;

  @ApiProperty({ description: 'CPL ID' })
  @IsUUID()
  cplId!: string;

  @ApiProperty({ description: 'Channel code' })
  @IsString()
  channel!: string;

  @ApiProperty({ description: 'Category code' })
  @IsString()
  category!: string;

  @ApiProperty({ description: 'Period start date', example: '2025-01-01' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ description: 'Period end date', example: '2025-12-31' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ description: 'Estimated on-invoice spend', minimum: 0 })
  @IsNumber()
  @Min(0)
  estimatedOnInvoiceSpend!: number;

  @ApiProperty({ description: 'Estimated off-invoice spend', minimum: 0 })
  @IsNumber()
  @Min(0)
  estimatedOffInvoiceSpend!: number;
}

export class AvailabilityResult {
  @ApiProperty({ description: 'Available on-invoice budget' })
  onInvoiceAvailable!: number;

  @ApiProperty({ description: 'Available off-invoice budget' })
  offInvoiceAvailable!: number;

  @ApiProperty({ description: 'Is on-invoice budget sufficient' })
  onInvoiceSufficient!: boolean;

  @ApiProperty({ description: 'Is off-invoice budget sufficient' })
  offInvoiceSufficient!: boolean;

  @ApiProperty({ description: 'On-invoice shortfall (0 or positive)' })
  onInvoiceShortfall!: number;

  @ApiProperty({ description: 'Off-invoice shortfall (0 or positive)' })
  offInvoiceShortfall!: number;

  @ApiProperty({ description: 'Suggestions to fit budget', type: [String] })
  suggestions!: string[];

  @ApiProperty({ description: 'Budget allocation ID' })
  budgetAllocationId?: string;
}
