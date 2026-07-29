import { IsOptional, IsNumber, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSkuVolumeDto {
  @ApiPropertyOptional({ description: 'Base volume (historical baseline)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseVolume?: number;

  @ApiPropertyOptional({ description: 'Planned volume for this SKU' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedVolume?: number;

  // T-034: optimistic-locking CAS against plan_skus.version. Grid hot path
  // (BRD <500ms) — not @IsNotEmpty() on purpose, see update-plan.dto.ts.
  @ApiPropertyOptional({
    description:
      'Expected current plan_skus.version (optimistic locking, T-034).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
