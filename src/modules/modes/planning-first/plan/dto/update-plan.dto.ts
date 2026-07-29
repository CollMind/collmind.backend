import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreatePlanDto } from './create-plan.dto';

export class UpdatePlanDto extends PartialType(CreatePlanDto) {
  // T-034: optimistic-locking CAS. Deliberately NOT `@IsNotEmpty()` — a
  // missing value must surface as 409 MISSING_VERSION (strict mode), not
  // the ValidationPipe's 400; PlanService#update makes that distinction.
  // See docs/analysis/0005-optimistic-locking-design.md §5 — DTO field, not
  // If-Match/ETag (three separately-versioned entities, one header can't
  // express that).
  @ApiPropertyOptional({
    description:
      'Expected current version (optimistic locking, T-034). Required in practice — omitting it returns 409 MISSING_VERSION.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
