import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsArray,
  IsObject,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReportFilters } from './report-filters.dto';

/**
 * [[T-294]]/[[T-296]] — `cash-flow-projection`'a özel. `months` önceden
 * paylaşılan `ReportFilters`'taydı (`T-294`) — ama `ReportFilters` SEKİZ
 * uçta kullanılıyor (`§7.1` sayımı, `T-296`): o sekiz ucun hepsi
 * `?months=6`'yı sessizce kabul edip yok sayıyordu, ve `?months=0` gibi
 * kendileri için ANLAMSIZ bir girdide gerekçesiz `400` veriyordu. `months`
 * bu yüzden tek kullanıcısı olan bu DTO'ya taşındı — `BudgetVarianceQueryDto`
 * ile aynı desen (uç-özel query DTO, paylaşılan DTO'yu genişletir).
 */
export class CashFlowProjectionQueryDto extends ReportFilters {
  @ApiPropertyOptional({
    description:
      'Cash-flow projection ileri ay sayısı (yalnız cash-flow-projection). 1-60 arası.',
    default: 12,
    minimum: 1,
    maximum: 60,
  })
  // ⚠️ `60` SEÇİLMİŞ bir üst sınırdır (5 yıl) — ölçülmüş ya da BRD kaynaklı
  // DEĞİL. Amacı sınırsız projeksiyon isteğini reddetmek. (`DISIPLIN`:
  // "mekanik olarak türetilmiş bir değer, GEREKÇE değildir" — seçilmiş bir
  // sayı sorun değil, ama SEÇİLMİŞ olduğu YAZILMALI; yoksa okuyucu onu bir
  // BRD kuralı sanar.)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  months?: number = 12;
}

export class CashFlowProjection {
  @ApiProperty({ description: 'Month (YYYY-MM)' })
  @IsString()
  month!: string;

  @ApiProperty({ description: 'On-Invoice cash outflow' })
  @IsNumber()
  onInvoiceOutflow!: number;

  @ApiProperty({ description: 'Off-Invoice cash outflow' })
  @IsNumber()
  offInvoiceOutflow!: number;

  @ApiProperty({ description: 'Total cash outflow' })
  @IsNumber()
  totalOutflow!: number;

  @ApiPropertyOptional({ description: 'Breakdown by plan', type: [Object] })
  @IsArray()
  @IsOptional()
  planBreakdown?: Array<{
    planId: string;
    planName: string;
    onInvoice: number;
    offInvoice: number;
    paymentDate: string;
  }>;
}

export class CashFlowReport {
  @ApiProperty({ description: 'Projection start date' })
  @IsString()
  startDate!: string;

  @ApiProperty({ description: 'Projection end date' })
  @IsString()
  endDate!: string;

  @ApiProperty({
    description: 'Monthly projections',
    type: [CashFlowProjection],
  })
  @IsArray()
  projections!: CashFlowProjection[];

  @ApiProperty({ description: 'Total On-Invoice projected outflow' })
  @IsNumber()
  totalOnInvoiceOutflow!: number;

  @ApiProperty({ description: 'Total Off-Invoice projected outflow' })
  @IsNumber()
  totalOffInvoiceOutflow!: number;

  @ApiProperty({ description: 'Total projected outflow' })
  @IsNumber()
  totalOutflow!: number;
}
