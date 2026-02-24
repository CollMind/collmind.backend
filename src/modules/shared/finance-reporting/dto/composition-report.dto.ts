import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsArray, IsObject, IsOptional } from 'class-validator';

export class CompositionSlice {
  @ApiProperty({ description: 'Mechanic code' })
  @IsString()
  mechanicCode!: string;

  @ApiProperty({ description: 'Mechanic name' })
  @IsString()
  mechanicName!: string;

  @ApiProperty({ description: 'Spend amount' })
  @IsNumber()
  amount!: number;

  @ApiProperty({ description: 'Percentage of total' })
  @IsNumber()
  percentage!: number;

  @ApiProperty({ description: 'Number of plans using this mechanic' })
  @IsNumber()
  planCount!: number;

  @ApiPropertyOptional({ description: 'Average ROI for this mechanic' })
  @IsNumber()
  @IsOptional()
  avgRoi?: number;
}

export class CompositionReport {
  @ApiProperty({ description: 'On-Invoice composition', type: [CompositionSlice] })
  @IsArray()
  onInvoice!: CompositionSlice[];

  @ApiProperty({ description: 'Off-Invoice composition', type: [CompositionSlice] })
  @IsArray()
  offInvoice!: CompositionSlice[];

  @ApiProperty({ description: 'Total On-Invoice spend' })
  @IsNumber()
  totalOnInvoice!: number;

  @ApiProperty({ description: 'Total Off-Invoice spend' })
  @IsNumber()
  totalOffInvoice!: number;
}
