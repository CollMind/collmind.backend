import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsArray,
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ReportGranularity {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum ComparisonType {
  BUDGET_VS_ACTUAL = 'budget_vs_actual',
  FORECAST_VS_ACTUAL = 'forecast_vs_actual',
  PREVIOUS_PERIOD = 'previous_period',
}

export class ReportFilters {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  /**
   * ⛔ [[T-254]] — `[]` "filtre yok" DEĞİLDİR:
   *   alan yok / `undefined` → bu boyut kısıtlanmıyor
   *   `[]`                   → BOŞ KÜME → hiçbir satır (`K-2.6.8a`)
   * Sözleşmenin tek tanımı: `src/common/query/array-filter.ts`. Bu alan
   * `dashboard.service.ts` tarafından KAPSAMDAN doldurulur — `.length > 0`
   * ile kontrol eden her okuyucu bir fail-open üretir.
   */
  @ApiPropertyOptional({
    description:
      'CPL IDs to filter. Absent = unfiltered; [] = empty set (no rows, K-2.6.8a).',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  cplIds?: string[];

  @ApiPropertyOptional({ description: 'Channels to filter', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  channels?: string[];

  @ApiPropertyOptional({ description: 'Categories to filter', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categories?: string[];

  @ApiPropertyOptional({
    description: 'Plan statuses to filter',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  planStatuses?: string[];

  @ApiPropertyOptional({
    description: 'RAG statuses to filter',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ragStatuses?: string[];

  @ApiPropertyOptional({
    description: 'Mechanic codes to filter',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  mechanicCodes?: string[];

  @ApiPropertyOptional({ description: 'Fiscal year' })
  @IsString()
  @IsOptional()
  fiscalYear?: string;
}

export class PaginationParams {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @Type(() => Number)
  @IsOptional()
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'Sort field' })
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsEnum(['ASC', 'DESC'])
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
