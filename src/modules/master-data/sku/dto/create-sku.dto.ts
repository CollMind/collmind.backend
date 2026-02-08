import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsUUID, IsNumber, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSkuDto {
  @ApiProperty({ description: 'SKU code', example: 'SKU-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: 'SKU name', example: 'Pantene 500ml Parlak Renkler' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'SKU description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Generic Unit ID' })
  @IsUUID()
  @IsNotEmpty()
  guId!: string;

  @ApiPropertyOptional({ description: 'Forecasting Unit ID' })
  @IsUUID()
  @IsOptional()
  fuId?: string;

  @ApiPropertyOptional({ description: 'Variant', example: 'Parlak Renkler' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  variant?: string;

  @ApiPropertyOptional({ description: 'Size', example: '500ml' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  size?: string;

  @ApiPropertyOptional({ description: 'Barcode' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  barcode?: string;

  @ApiPropertyOptional({ description: 'Unit price' })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Cost of Goods Sold' })
  @IsNumber()
  @IsOptional()
  cogs?: number;

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
