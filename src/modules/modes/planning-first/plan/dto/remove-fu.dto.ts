import { IsOptional, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * T-034: removing an FU is a structural plan change (bumps plans.version) —
 * same rationale as AddFuDto#planVersion (docs/analysis/0005 §3). Not
 * `@IsNotEmpty()` on purpose (409 MISSING_VERSION, not 400 — see
 * update-plan.dto.ts).
 */
export class RemoveFuDto {
  @ApiPropertyOptional({
    description: 'Expected current plans.version (optimistic locking, T-034).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  planVersion?: number;
}
