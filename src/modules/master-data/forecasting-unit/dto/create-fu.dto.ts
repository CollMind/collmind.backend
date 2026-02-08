import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsUUID, IsNumber, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFuDto {
  @ApiProperty({ description: 'FU code', example: 'FU-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: 'FU name', example: '500ml Shampoo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'FU description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Generic Unit ID' })
  @IsUUID()
  @IsNotEmpty()
  guId!: string;

  @ApiPropertyOptional({ description: 'Size', example: '500ml' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  size?: string;

  @ApiPropertyOptional({ description: 'Segment', example: 'Premium' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  segment?: string;

  @ApiPropertyOptional({ description: 'Is plannable', default: true })
  @IsBoolean()
  @IsOptional()
  isPlannable?: boolean;

  @ApiPropertyOptional({ description: 'Default base volume' })
  @IsNumber()
  @IsOptional()
  defaultBaseVolume?: number;

  @ApiPropertyOptional({ description: 'Base price' })
  @IsNumber()
  @IsOptional()
  basePrice?: number;

  @ApiPropertyOptional({ description: 'Currency', default: 'TRY' })
  @IsString()
  @IsOptional()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Unit of measure', example: 'EA' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  unitOfMeasure?: string;

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, any>;
}
