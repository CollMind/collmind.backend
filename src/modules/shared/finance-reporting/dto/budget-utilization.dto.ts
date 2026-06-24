import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsEnum,
  IsArray,
  IsObject,
  IsOptional,
} from 'class-validator';

export enum UtilizationStatus {
  GREEN = 'GREEN',
  AMBER = 'AMBER',
  RED = 'RED',
}

export class BudgetSummary {
  @ApiProperty({ description: 'Total allocated budget' })
  @IsNumber()
  allocated!: number;

  @ApiProperty({ description: 'Amount utilized' })
  @IsNumber()
  utilized!: number;

  @ApiProperty({ description: 'Amount reserved' })
  @IsNumber()
  reserved!: number;

  @ApiProperty({ description: 'Amount available' })
  @IsNumber()
  available!: number;

  @ApiProperty({ description: 'Utilization percentage' })
  @IsNumber()
  utilizationPercent!: number;

  @ApiProperty({ description: 'Status', enum: UtilizationStatus })
  @IsEnum(UtilizationStatus)
  status!: UtilizationStatus;
}

export class BudgetUtilizationReport {
  @ApiProperty({
    description: 'On-Invoice budget summary',
    type: BudgetSummary,
  })
  @IsObject()
  onInvoice!: BudgetSummary;

  @ApiProperty({
    description: 'Off-Invoice budget summary',
    type: BudgetSummary,
  })
  @IsObject()
  offInvoice!: BudgetSummary;

  @ApiProperty({ description: 'Total budget summary', type: BudgetSummary })
  @IsObject()
  total!: BudgetSummary;

  @ApiProperty({ description: 'Period start date' })
  @IsString()
  periodStart!: string;

  @ApiProperty({ description: 'Period end date' })
  @IsString()
  periodEnd!: string;

  @ApiPropertyOptional({ description: 'Breakdown by CPL', type: [Object] })
  @IsArray()
  @IsOptional()
  byCpl?: Array<{
    cplId: string;
    cplName: string;
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
  }>;

  @ApiPropertyOptional({ description: 'Breakdown by Channel', type: [Object] })
  @IsArray()
  @IsOptional()
  byChannel?: Array<{
    channel: string;
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
  }>;

  @ApiPropertyOptional({ description: 'Breakdown by Category', type: [Object] })
  @IsArray()
  @IsOptional()
  byCategory?: Array<{
    category: string;
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
  }>;
}
