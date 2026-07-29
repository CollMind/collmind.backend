import { IsOptional, IsObject, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFuTacticDto {
  @ApiPropertyOptional({
    description:
      'Tactic values as key-value pairs (e.g., { "CPP_ON_PCT": 10, "DISPLAY_FEE": 5000 })',
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  tactics?: Record<string, number>;

  // T-034: optimistic-locking CAS against plan_fus.version (row-level, not
  // the plan header — see update-plan.dto.ts for the "not @IsNotEmpty()"
  // rationale).
  @ApiPropertyOptional({
    description:
      'Expected current plan_fus.version (optimistic locking, T-034).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
