import { IsOptional, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * T-034 (code-review follow-up, 2026-07-29): delete is a destructive
 * structural change — CAS against plans.version, same rationale as
 * RemoveFuDto#planVersion. Not `@IsNotEmpty()` on purpose (409
 * MISSING_VERSION, not 400 — see update-plan.dto.ts).
 */
export class DeletePlanDto {
  @ApiPropertyOptional({
    description: 'Expected current plans.version (optimistic locking, T-034).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
