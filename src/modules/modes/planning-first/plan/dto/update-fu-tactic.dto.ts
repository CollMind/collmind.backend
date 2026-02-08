import { IsOptional, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFuTacticDto {
  @ApiPropertyOptional({
    description: 'Tactic values as key-value pairs (e.g., { "CPP_ON_PCT": 10, "DISPLAY_FEE": 5000 })',
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  tactics?: Record<string, number>;
}
