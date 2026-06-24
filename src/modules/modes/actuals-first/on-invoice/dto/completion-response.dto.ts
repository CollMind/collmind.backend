import { ApiProperty } from '@nestjs/swagger';

export class CompletionResponseDto {
  @ApiProperty({ description: 'Batch ID', example: 'BATCH-ON-2026-001' })
  batchId!: string;

  @ApiProperty({ description: 'Yüklenen kayıt sayısı', example: 1238 })
  uploadedRecords!: number;

  @ApiProperty({ description: 'Toplam indirim tutarı', example: 156750.0 })
  totalDiscount!: number;

  @ApiProperty({ description: 'Etkilenen envelope sayısı', example: 3 })
  affectedEnvelopes!: number;
}
