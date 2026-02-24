import { ApiProperty } from '@nestjs/swagger';

export class UploadFileResponseDto {
  @ApiProperty({ description: 'Batch ID' })
  batchId!: string;

  @ApiProperty({ description: 'Toplam satır sayısı' })
  totalRows!: number;

  @ApiProperty({ description: 'Geçerli satır sayısı' })
  validRows!: number;

  @ApiProperty({ description: 'Hatalı satır sayısı' })
  errorRows!: number;
}
