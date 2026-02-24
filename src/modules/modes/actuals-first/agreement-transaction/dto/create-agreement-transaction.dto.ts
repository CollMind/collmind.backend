import { IsString, IsUUID, IsNumber, IsDateString, IsOptional, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgreementTransactionDto {
  @ApiProperty()
  @IsUUID()
  agreementId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  invoiceNo!: string;

  @ApiProperty()
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ description: 'Fiscal period in YYYY-MM format (used for budget deduction)', example: '2026-01' })
  @IsOptional()
  @IsString()
  @MaxLength(7)
  fiscalPeriod?: string; // YYYY-MM format

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

