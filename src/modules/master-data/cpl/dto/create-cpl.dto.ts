import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsNumber, MaxLength, IsEnum, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCplDto {
  @ApiProperty({ description: 'CPL code', example: 'CPL-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: 'CPL name', example: 'Metro Türkiye' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'CPL description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Channel ID' })
  @IsUUID()
  @IsNotEmpty()
  channelId!: string;

  @ApiPropertyOptional({ description: 'Region ID' })
  @IsUUID()
  @IsOptional()
  regionId?: string;

  @ApiPropertyOptional({ description: 'City' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Country' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ description: 'Contact person' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  contactPerson?: string;

  @ApiPropertyOptional({ description: 'Contact email' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional({ description: 'Contact phone' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  contactPhone?: string;

  @ApiPropertyOptional({ description: 'Customer tier', example: 'A' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  customerTier?: string;

  @ApiPropertyOptional({ description: 'Is VIP', default: false })
  @IsBoolean()
  @IsOptional()
  isVip?: boolean;

  @ApiPropertyOptional({ description: 'Annual revenue' })
  @IsNumber()
  @IsOptional()
  annualRevenue?: number;

  @ApiPropertyOptional({ description: 'Status', enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED'], default: 'ACTIVE' })
  @IsEnum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED'])
  @IsOptional()
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Customer IDs to assign to this CPL', type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  customerIds?: string[];
}
