import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DashboardSummaryQueryDto
 *
 * Query params for GET /dashboard/summary
 */
export class DashboardSummaryQueryDto {
  /**
   * Period code to scope the summary.
   * Accepted formats: "YYYY-MM" (month), "YYYY-QN" (quarter), "ALL".
   * Defaults to current month when omitted.
   */
  @ApiPropertyOptional({
    description:
      'Period filter. Formats: YYYY-MM | YYYY-QN | ALL. Defaults to current YYYY-MM.',
    example: '2026-06',
  })
  @IsString()
  @IsOptional()
  period?: string;
}

/**
 * PendingTasksQueryDto
 *
 * Query params for GET /dashboard/pending-tasks
 */
export class PendingTasksQueryDto {
  @ApiPropertyOptional({
    description:
      'Period filter. Formats: YYYY-MM | ALL. Defaults to current month.',
    example: '2026-06',
  })
  @IsString()
  @IsOptional()
  period?: string;

  @ApiPropertyOptional({
    description: 'Include items from past periods. Default: false.',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includePast?: boolean = false;
}
