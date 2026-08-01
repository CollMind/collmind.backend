import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateKpiDto } from './create-kpi.dto';

export class UpdateKpiDto extends PartialType(CreateKpiDto) {
  // T-039: optimistic-locking CAS token. Optional (additive rollout — the
  // KPI admin screen does not send this yet; see kpi.entity.ts#version).
  // When present, the update is rejected with 409 STALE_VERSION if the row
  // was modified since this version was read. When absent, the update
  // proceeds unconditionally (pre-T-039 behavior) and still bumps the
  // stored version so a future version-aware client sees an accurate value.
  @ApiPropertyOptional({
    example: 3,
    description:
      'Expected current version for optimistic-locking CAS. Omit to update unconditionally (legacy behavior).',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  version?: number;
}
