import { IsString, IsOptional, IsUUID, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlanContextDto {
  @ApiPropertyOptional({ description: 'Channel code', example: 'NKA' })
  @IsString()
  @IsOptional()
  channelCode?: string;

  @ApiPropertyOptional({ description: 'Channel ID' })
  @IsUUID()
  @IsOptional()
  channelId?: string;

  @ApiPropertyOptional({ description: 'Category code', example: 'Dairy' })
  @IsString()
  @IsOptional()
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'CPL ID' })
  @IsUUID()
  @IsOptional()
  cplId?: string;

  @ApiPropertyOptional({ description: 'CPL codes', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cplCodes?: string[];
}
