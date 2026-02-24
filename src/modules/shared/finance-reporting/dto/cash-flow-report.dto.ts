import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsArray, IsObject, IsOptional } from 'class-validator';

export class CashFlowProjection {
  @ApiProperty({ description: 'Month (YYYY-MM)' })
  @IsString()
  month!: string;

  @ApiProperty({ description: 'On-Invoice cash outflow' })
  @IsNumber()
  onInvoiceOutflow!: number;

  @ApiProperty({ description: 'Off-Invoice cash outflow' })
  @IsNumber()
  offInvoiceOutflow!: number;

  @ApiProperty({ description: 'Total cash outflow' })
  @IsNumber()
  totalOutflow!: number;

  @ApiPropertyOptional({ description: 'Breakdown by plan', type: [Object] })
  @IsArray()
  @IsOptional()
  planBreakdown?: Array<{
    planId: string;
    planName: string;
    onInvoice: number;
    offInvoice: number;
    paymentDate: string;
  }>;
}

export class CashFlowReport {
  @ApiProperty({ description: 'Projection start date' })
  @IsString()
  startDate!: string;

  @ApiProperty({ description: 'Projection end date' })
  @IsString()
  endDate!: string;

  @ApiProperty({ description: 'Monthly projections', type: [CashFlowProjection] })
  @IsArray()
  projections!: CashFlowProjection[];

  @ApiProperty({ description: 'Total On-Invoice projected outflow' })
  @IsNumber()
  totalOnInvoiceOutflow!: number;

  @ApiProperty({ description: 'Total Off-Invoice projected outflow' })
  @IsNumber()
  totalOffInvoiceOutflow!: number;

  @ApiProperty({ description: 'Total projected outflow' })
  @IsNumber()
  totalOutflow!: number;
}
