import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Matches,
  MaxLength,
  IsOptional,
  IsNumber,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLTARateDto {
  @ApiPropertyOptional({ description: 'Channel ID' })
  @IsUUID()
  @IsOptional()
  channelId?: string;

  @ApiProperty({ description: 'Channel name or "ALL"', example: 'NKA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  channel!: string; // NKA, Traditional Trade, etc. or "ALL"

  @ApiPropertyOptional({ description: 'Category ID' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiProperty({ description: 'Category name or "ALL"', example: 'Dairy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category!: string; // Dairy, Beverages, etc. or "ALL"

  @ApiProperty({
    description: 'On-invoice percentage',
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  onInvoicePercentage!: number;

  @ApiProperty({
    description: 'Off-invoice percentage',
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  offInvoicePercentage!: number;

  @ApiPropertyOptional({ description: 'Minimum volume commitment' })
  @IsNumber()
  @IsOptional()
  minimumVolumeCommitment?: number;

  @ApiPropertyOptional({ description: 'Maximum discount cap' })
  @IsNumber()
  @IsOptional()
  maximumDiscountCap?: number;

  @ApiPropertyOptional({ description: 'Payment terms', example: 'Net 30' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  paymentTerms?: string;

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsOptional()
  isActive?: boolean;
}

export class CreateLTAAgreementDto {
  @ApiProperty({ description: 'CPL ID' })
  @IsUUID()
  @IsNotEmpty()
  cplId!: string;

  @ApiProperty({
    description: 'Agreement name',
    example: 'Carrefour 2025 Annual Agreement',
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  agreementName!: string;

  @ApiProperty({ description: 'Agreement code', example: 'CARREFOUR_2025_LTA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'Agreement code must contain only uppercase letters, numbers, and underscores',
  })
  agreementCode!: string;

  @ApiProperty({ description: 'Effective date', example: '2025-01-01' })
  @IsDateString()
  @IsNotEmpty()
  effectiveDate!: string;

  @ApiPropertyOptional({ description: 'Expiry date', example: '2025-12-31' })
  @IsDateString()
  @IsOptional()
  @ValidateIf((o) => o.expiryDate !== null && o.expiryDate !== undefined)
  expiryDate?: string;

  @ApiPropertyOptional({ description: 'Total agreement value' })
  @IsNumber()
  @IsOptional()
  totalAgreementValue?: number;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'LTA rates',
    type: [CreateLTARateDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one rate must be provided' })
  @ValidateNested({ each: true })
  @Type(() => CreateLTARateDto)
  rates!: CreateLTARateDto[];
}
