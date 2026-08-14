import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsArray,
  IsObject,
  IsOptional,
  IsEnum,
} from 'class-validator';

export class RiskPlan {
  @ApiProperty({ description: 'Plan ID' })
  @IsString()
  planId!: string;

  @ApiProperty({ description: 'Plan name' })
  @IsString()
  planName!: string;

  // T-215 / INV-N-004 / K-2.4.22a1: `null` means "coverage was not full —
  // no colour is safe to show" (kpi-engine.service.ts fullCoverage guard).
  // See plan-performance.dto.ts PlanPerformanceRow.ragStatus for the same
  // fix and rationale.
  @ApiProperty({
    description:
      'RAG status. null = partial/zero KPI coverage — no full-coverage colour may be shown (K-2.4.22c)',
    enum: ['RED', 'AMBER', 'GREEN'],
    nullable: true,
  })
  @IsOptional()
  @IsEnum(['RED', 'AMBER', 'GREEN'])
  ragStatus!: string | null;

  // T-216b / INV-N-004 / K-2.4.22c: same field/rationale as
  // PlanPerformanceRow.coverageRatio (plan-performance.dto.ts) — plans.
  // coverage_ratio (T-218), null = nothing to aggregate.
  @ApiProperty({
    description:
      'Fraction of FUs whose GP_ROI_PCT resolved into gpRoi (0-1). null = nothing to aggregate.',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  coverageRatio!: number | null;

  @ApiProperty({ description: 'Total spend' })
  @IsNumber()
  totalSpend!: number;

  @ApiProperty({ description: 'GP ROI' })
  @IsNumber()
  // T-172: `null` = hesaplanamadı. `0` DEĞİL — sıfır bir iş yargısıdır.
  gpRoi!: number | null;

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
