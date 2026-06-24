import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsArray,
  IsObject,
  IsOptional,
} from 'class-validator';

export class RiskPlan {
  @ApiProperty({ description: 'Plan ID' })
  @IsString()
  planId!: string;

  @ApiProperty({ description: 'Plan name' })
  @IsString()
  planName!: string;

  @ApiProperty({ description: 'RAG status' })
  @IsString()
  ragStatus!: string;

  @ApiProperty({ description: 'Total spend' })
  @IsNumber()
  totalSpend!: number;

  @ApiProperty({ description: 'GP ROI' })
  @IsNumber()
  gpRoi!: number;

  @ApiProperty({ description: 'Risk level' })
  @IsString()
  riskLevel!: string; // 'HIGH', 'MEDIUM', 'LOW'
}

export class RiskReport {
  @ApiProperty({ description: 'RED status plans spend total' })
  @IsNumber()
  redPlansSpend!: number;

  @ApiProperty({ description: 'AMBER status plans spend total' })
  @IsNumber()
  amberPlansSpend!: number;

  @ApiProperty({ description: 'Total at-risk spend' })
  @IsNumber()
  totalAtRisk!: number;

  @ApiProperty({ description: 'Percentage of total budget at risk' })
  @IsNumber()
  riskPercentage!: number;

  @ApiProperty({ description: 'RED status plans', type: [RiskPlan] })
  @IsArray()
  redPlans!: RiskPlan[];

  @ApiProperty({ description: 'AMBER status plans', type: [RiskPlan] })
  @IsArray()
  amberPlans!: RiskPlan[];

  @ApiPropertyOptional({ description: 'Recommendations', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  recommendations?: string[];
}
