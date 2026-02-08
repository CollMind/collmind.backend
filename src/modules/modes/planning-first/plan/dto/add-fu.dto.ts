import { IsUUID, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddFuDto {
  @ApiProperty({ description: 'Forecasting Unit ID' })
  @IsUUID()
  @IsNotEmpty()
  fuId!: string;

  @ApiPropertyOptional({
    description: 'Tactic values as key-value pairs (e.g., { "CPP_ON_PCT": 10, "DISPLAY_FEE": 5000 })',
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  tactics?: Record<string, number>;
}
