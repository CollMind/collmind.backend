import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsEnum,
  IsUUID,
  IsDateString,
} from 'class-validator';

export class PlanPerformanceRow {
  @ApiProperty({ description: 'Plan ID' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ description: 'Plan name' })
  @IsString()
  planName!: string;

  @ApiProperty({ description: 'Plan code' })
  @IsString()
  planCode!: string;

  @ApiProperty({ description: 'CPL name' })
  @IsString()
  cplName!: string;

  @ApiProperty({ description: 'Channel' })
  @IsString()
  channel!: string;

  @ApiProperty({ description: 'Category' })
  @IsString()
  category!: string;

  @ApiProperty({ description: 'Total spend' })
  @IsNumber()
  totalSpend!: number;

  @ApiProperty({ description: 'On-Invoice spend' })
  @IsNumber()
  onInvoiceSpend!: number;

  @ApiProperty({ description: 'Off-Invoice spend' })
  @IsNumber()
  offInvoiceSpend!: number;

  @ApiProperty({ description: 'On-Invoice percentage' })
  @IsNumber()
  onInvoicePercent!: number;

  @ApiProperty({ description: 'Off-Invoice percentage' })
  @IsNumber()
  offInvoicePercent!: number;

  @ApiProperty({ description: 'GP ROI percentage' })
  @IsNumber()
  gpRoi!: number;

  @ApiProperty({ description: 'RAG status', enum: ['RED', 'AMBER', 'GREEN'] })
  @IsEnum(['RED', 'AMBER', 'GREEN'])
  ragStatus!: string;

  @ApiProperty({ description: 'Plan status' })
  @IsString()
  status!: string;

  @ApiProperty({ description: 'Start date' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'End date' })
  @IsDateString()
  endDate!: string;
}

export class PaginatedPlanReport {
  @ApiProperty({
    description: 'Plan performance rows',
    type: [PlanPerformanceRow],
  })
  rows!: PlanPerformanceRow[];

  @ApiProperty({ description: 'Total count' })
  @IsNumber()
  total!: number;

  @ApiProperty({ description: 'Page number' })
  @IsNumber()
  page!: number;

  @ApiProperty({ description: 'Items per page' })
  @IsNumber()
  limit!: number;

  @ApiProperty({ description: 'Total pages' })
  @IsNumber()
  totalPages!: number;
}
