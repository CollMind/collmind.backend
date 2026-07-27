import { IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadSalesActualsQueryDto {
  @ApiPropertyOptional({
    description:
      'YYYY-MM formatında dönem. Verilmezse dosya adından çıkarılır (actuals_YYYY-MM.csv).',
    example: '2026-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'fiscalPeriod YYYY-MM formatında olmalıdır',
  })
  fiscalPeriod?: string;
}
