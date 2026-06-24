import { ApiProperty } from '@nestjs/swagger';

export class ReversalResponseDto {
  @ApiProperty({ description: 'Geri alınan agreement transaction ID' })
  transactionId!: string;

  @ApiProperty({ description: 'Oluşturulan reversal ledger entry ID' })
  reversalLedgerId!: string;

  @ApiProperty({ description: 'Geri alınan tutar (mutlak değer)' })
  reversedAmount!: number;

  @ApiProperty({ description: 'İşlem durumu', example: 'REVERSED' })
  status!: string;
}
