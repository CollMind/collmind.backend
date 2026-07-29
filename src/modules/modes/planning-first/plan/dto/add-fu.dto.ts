import {
  IsUUID,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddFuDto {
  @ApiProperty({ description: 'Forecasting Unit ID' })
  @IsUUID()
  @IsNotEmpty()
  fuId!: string;

  @ApiPropertyOptional({
    description:
      'Tactic values as key-value pairs (e.g., { "CPP_ON_PCT": 10, "DISPLAY_FEE": 5000 })',
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  tactics?: Record<string, number>;

  // T-034: adding an FU is a structural plan change (bumps plans.version) —
  // see docs/analysis/0005 §3 "addFu/removeFu neden plan seviyesi?". Not
  // `@IsNotEmpty()` on purpose (409 MISSING_VERSION, not 400 — see
  // update-plan.dto.ts).
  @ApiPropertyOptional({
    description: 'Expected current plans.version (optimistic locking, T-034).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  planVersion?: number;
}
