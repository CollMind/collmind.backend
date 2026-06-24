import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Close settlement isteği DTO.
 * justification alanı isteğe bağlıdır; audit log'a kaydedilir.
 */
export class CloseSettlementDto {
  @ApiPropertyOptional({
    description: 'Optional business justification for closing the agreement',
    example: 'Promotion period ended, all invoices received and reconciled',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  justification?: string;
}
