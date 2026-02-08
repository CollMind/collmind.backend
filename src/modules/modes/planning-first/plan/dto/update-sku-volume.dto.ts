import { IsOptional, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSkuVolumeDto {
  @ApiPropertyOptional({ description: 'Base volume (historical baseline)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseVolume?: number;

  @ApiPropertyOptional({ description: 'Planned volume for this SKU' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedVolume?: number;
}
