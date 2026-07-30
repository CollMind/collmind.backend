import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * T-034b: submit() is the one state transition that ALSO validates
 * plans.version (docs/analysis/0005 §4 "Tek istisna: submit() version DE
 * ister") — unlike approve/reject/returnToDraft, which rely solely on
 * status-CAS because Pending/Rejected plans are immutable so no concurrent
 * content edit is possible. submit() commits the plan's CURRENT totalSpend
 * to a budget RESERVE; if the planner's in-memory view is stale (someone
 * else edited a SKU volume moments ago), submitting reserves a spend amount
 * the submitter never saw. Deliberately NOT `@IsNotEmpty()` — a missing
 * value must surface as 409 MISSING_VERSION (strict mode), not the
 * ValidationPipe's 400 — see update-plan.dto.ts for the same pattern.
 */
export class SubmitPlanDto {
  @ApiPropertyOptional({
    description:
      'Expected current plans.version (optimistic locking, T-034/T-034b). Required in practice — omitting it returns 409 MISSING_VERSION.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
