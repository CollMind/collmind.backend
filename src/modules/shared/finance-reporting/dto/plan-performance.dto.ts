import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsEnum,
  IsUUID,
  IsDateString,
  IsOptional,
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
  // T-172: `null` = hesaplanamadı. `0` DEĞİL — sıfır bir iş yargısıdır.
  gpRoi!: number | null;

  // T-215 / INV-N-004 / K-2.4.22a1: `null` means "coverage was not full —
  // no colour is safe to show" (kpi-engine.service.ts fullCoverage guard).
  // It is a distinct, legitimate value, not an absent field — `@IsOptional`
  // here means "skip enum validation when null", not "field may be missing".
  @ApiProperty({
    description:
      'RAG status. null = partial/zero KPI coverage — no full-coverage colour may be shown (K-2.4.22c)',
    enum: ['RED', 'AMBER', 'GREEN'],
    nullable: true,
  })
  @IsOptional()
  @IsEnum(['RED', 'AMBER', 'GREEN'])
  ragStatus!: string | null;

  /**
   * `T-342` / `Z68 §2` — TANIMLI-YOKLUK. `ragStatus === null` iki ayrı
   * gerçeği anlatır ve bu alan onları ayırır:
   * ```
   * null        "değerlendirilemedi"  → eksik/kısmi veri (bkz. coverageRatio)
   * 'LTA_ONLY'  "değerlendirme DIŞI"  → plan bir promosyon değerlendirmesi değil
   * ```
   * ⛔ `Z71 §2`: bu ayrımı yalnız grid'in göstermesi YARIM bir iniş olurdu —
   * raporlar da tanır.
   */
  @ApiProperty({
    description:
      'Reason a RAG colour is legitimately absent. null = not excluded (either coloured, or unevaluable — see coverageRatio).',
    enum: ['LTA_ONLY'],
    nullable: true,
  })
  @IsOptional()
  @IsEnum(['LTA_ONLY'])
  ragExclusionReason!: string | null;

  // T-216b / INV-N-004 / K-2.4.22c: the fraction of FUs that resolved into
  // `gpRoi` (plans.coverage_ratio — T-218). `null` = engine reported no
  // ratio (no FUs to aggregate). This is what lets a client render the
  // K-2.4.22a grey badge honestly ("4/170 kapsama") instead of a bare
  // withdrawn colour with no explanation — the second measured INV-N-004
  // violation ("kapsama oranı istemciye ulaşmıyor").
  @ApiProperty({
    description:
      'Fraction of FUs whose GP_ROI_PCT resolved into gpRoi (0-1). null = nothing to aggregate.',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  coverageRatio!: number | null;

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
