import {
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsPositive,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReserveBudgetDto {
  @ApiProperty({ example: 'envelope-uuid', description: 'Budget envelope ID' })
  @IsUUID()
  envelopeId!: string;

  @ApiProperty({ example: 2500, description: 'Amount to reserve' })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({
    example: 'agreement-uuid',
    description: 'Agreement ID (required for RESERVE transaction)',
  })
  @IsUUID()
  agreementId!: string;

  @ApiPropertyOptional({
    example: 'TRY',
    description: 'Currency',
    default: 'TRY',
  })
  @IsString()
  @IsOptional()
  currency?: string;
}
