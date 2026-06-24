import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsArray, IsOptional } from 'class-validator';

export class MechanicEffectiveness {
  @ApiProperty({ description: 'Mechanic code' })
  @IsString()
  mechanicCode!: string;

  @ApiProperty({ description: 'Mechanic name' })
  @IsString()
  mechanicName!: string;

  @ApiProperty({ description: 'Total spend' })
  @IsNumber()
  totalSpend!: number;

  @ApiProperty({ description: 'Number of plans using this mechanic' })
  @IsNumber()
  planCount!: number;

  @ApiProperty({ description: 'Average GP ROI' })
  @IsNumber()
  avgGpRoi!: number;

  @ApiProperty({ description: 'Average TO ROI' })
  @IsNumber()
  avgToRoi!: number;

  @ApiProperty({ description: 'Total incremental GP generated' })
  @IsNumber()
  totalIncrementalGp!: number;

  @ApiProperty({ description: 'Efficiency score (GP ROI weighted by spend)' })
  @IsNumber()
  efficiencyScore!: number;

  @ApiPropertyOptional({ description: 'Insights', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  insights?: string[];
}

export class MechanicReport {
  @ApiProperty({
    description: 'Mechanic effectiveness data',
    type: [MechanicEffectiveness],
  })
  @IsArray()
  mechanics!: MechanicEffectiveness[];

  @ApiProperty({ description: 'Total spend across all mechanics' })
  @IsNumber()
  totalSpend!: number;

  @ApiProperty({ description: 'Most efficient mechanic' })
  @IsString()
  mostEfficient!: string;

  @ApiProperty({ description: 'Least efficient mechanic' })
  @IsString()
  leastEfficient!: string;
}
