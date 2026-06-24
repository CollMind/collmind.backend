import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReverseTransactionDto {
  @ApiPropertyOptional({
    description: 'İşlemin neden geri alındığına dair açıklama (opsiyonel)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  justification?: string;
}
