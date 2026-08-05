import { IsOptional, IsObject, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFuTacticDto {
  @ApiPropertyOptional({
    description:
      'Tactic values as key-value pairs (e.g., { "CPP_ON_PCT": 10, "DISPLAY_FEE": 5000 })',
    type: 'object',
  })
  // ADR 0008: an explicit `{"tactics": null}` body means "no change", the same
  // as omitting the field. `@IsOptional()` skips `null` as well as `undefined`
  // in class-validator, so `updateFuTactic`'s ternary takes the falsy branch and
  // the existing tactics are left alone.
  //
  // This used to be true by ACCIDENT — nobody had decided what `null` meant, and
  // the wire protocol had quietly bound it anyway. ADR 0008 makes it the
  // decision: there is no meaning difference between an absent entry and a zero
  // one, so `null` is not spent on a third meaning either.
  //
  // Consequence worth stating: REMOVING a tactic will NOT come through `null`.
  // If that capability is ever needed it takes an explicit endpoint
  // (`DELETE .../tactics/:code`) or an explicit sentinel — see T-083.
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
