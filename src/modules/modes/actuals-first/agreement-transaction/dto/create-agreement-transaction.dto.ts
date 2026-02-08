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

