import { IsOptional, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * T-034 (code-review follow-up, 2026-07-29): delete is a destructive
 * change — CAS against agreements.version, same rationale as
 * update-agreement.dto.ts#version. Not `@IsNotEmpty()` on purpose (409
 * MISSING_VERSION, not 400).
 */
export class DeleteAgreementDto {
  @ApiPropertyOptional({
    description:
      'Expected current agreements.version (optimistic locking, T-034).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
