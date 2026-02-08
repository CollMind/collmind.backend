import { IsString, IsUUID, IsEnum, IsNumber, IsDateString, IsOptional, Min, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpendType } from '../../../../../database/entities/ledger-entry.entity';

export enum LedgerSourceType {
  AGREEMENT = 'AGREEMENT',
  PLAN = 'PLAN',
  MANUAL = 'MANUAL',
}

export class CreateLedgerEntryDto {
  @ApiProperty({ enum: LedgerSourceType })
  @IsEnum(LedgerSourceType)
  sourceType!: LedgerSourceType;

  @ApiProperty()
  @IsUUID()
  sourceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agreementId?: string;

  @ApiProperty({ enum: SpendType })
  @IsEnum(SpendType)
  spendType!: SpendType;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ description: 'Format: YYYY-MM' })
  @IsString()
  @MaxLength(7)
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodMonth must be in YYYY-MM format' })
  periodMonth!: string;

  @ApiProperty()
  @IsDateString()
  postingDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cplId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fuId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tacticId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mechanicId?: string;

  @ApiProperty()
  @IsUUID()
  budgetEnvelopeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

