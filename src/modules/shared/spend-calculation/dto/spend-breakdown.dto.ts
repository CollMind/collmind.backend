import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface MechanicSpendMap {
  [mechanicCode: string]: number | undefined;
}

export class BaseSpendBreakdown {
  @ApiProperty({ description: 'Base LTA on-invoice spend' })
  ltaOnInvoice!: number;

  @ApiProperty({ description: 'Base LTA off-invoice spend' })
  ltaOffInvoice!: number;

  @ApiProperty({ description: 'Base total on-invoice spend' })
  totalOnInvoice!: number;

  @ApiProperty({ description: 'Base total off-invoice spend' })
  totalOffInvoice!: number;

  @ApiProperty({ description: 'Base total spend' })
  totalSpend!: number;
}

export class PromoOnInvoiceSpend {
  @ApiPropertyOptional({ description: 'CPP on-invoice spend' })
  cppOn?: number;

  @ApiPropertyOptional({ description: 'TPR on-invoice spend' })
  tprOn?: number;

  @ApiPropertyOptional({
    description: 'WS TPR on-invoice spend (Wholesale only)',
  })
  wsTprOn?: number;

  [mechanicCode: string]: number | undefined;
}

export class PromoOffInvoiceSpend {
  @ApiPropertyOptional({ description: 'CPP off-invoice spend' })
  cppOff?: number;

  @ApiPropertyOptional({ description: 'WS TPR off-invoice spend' })
  wsTprOff?: number;

  @ApiPropertyOptional({ description: 'Price support spend' })
  priceSupport?: number;

  @ApiPropertyOptional({ description: 'Visibility MTPH spend' })
  visibilityMtph?: number;

  @ApiPropertyOptional({ description: 'Visibility GT spend' })
  visibilityGt?: number;

  @ApiPropertyOptional({ description: 'TPR lumpsum spend' })
  tprLumpsum?: number;

  [mechanicCode: string]: number | undefined;
}

export class PlannedSpendBreakdown {
  @ApiProperty({ description: 'Planned LTA on-invoice spend' })
  ltaOnInvoice!: number;

  @ApiProperty({ description: 'Planned LTA off-invoice spend' })
  ltaOffInvoice!: number;

  @ApiProperty({
    description: 'Promo on-invoice spend breakdown',
    type: PromoOnInvoiceSpend,
  })
  promoOnInvoice!: PromoOnInvoiceSpend;

  @ApiProperty({
    description: 'Promo off-invoice spend breakdown',
    type: PromoOffInvoiceSpend,
  })
  promoOffInvoice!: PromoOffInvoiceSpend;

  @ApiProperty({ description: 'Total promo on-invoice spend' })
  totalPromoOnInvoice!: number;

  @ApiProperty({ description: 'Total promo off-invoice spend' })
  totalPromoOffInvoice!: number;

  @ApiProperty({ description: 'Total planned on-invoice spend' })
  totalOnInvoice!: number;

  @ApiProperty({ description: 'Total planned off-invoice spend' })
  totalOffInvoice!: number;

  @ApiProperty({ description: 'Total planned spend' })
  totalSpend!: number;
}

export class IncrementalSpendBreakdown {
  @ApiProperty({ description: 'Incremental on-invoice spend' })
  onInvoice!: number;

  @ApiProperty({ description: 'Incremental off-invoice spend' })
  offInvoice!: number;

  @ApiProperty({ description: 'Incremental total spend' })
  total!: number;

  /**
   * `T-334` / `Z66 §1` (`Q6`) — ROI PAYDASI.
   * *Yalnız promo · LTA HARİÇ · incremental* (`Z62 §6-3`).
   *
   * Tabanda promo harcaması **yoktur** (`SpendCalculationService`,
   * `SEVIYE 4`: `baseTotalOnInv = baseLtaOnInv`) ⇒ bu sayı planlanan promo
   * toplamına **eşittir**. ⛔ Bir ara sürümde buraya *"tabana bir gün promo
   * girerse kendiliğinden doğru kalır"* yazılmıştı — **YANLIŞTI** (review
   * `S2`): türetme, tabanı `lta`'ya sabitleyen satırlardan mekanik olarak
   * çıkıyordu ve daima `0` veriyordu. Doğrusu: taban promo alırsa
   * `SEVIYE 4` **ve** bu sayının türetimi **birlikte** değişmek zorundadır.
   *
   * ⛔ `total` (LTA dahil) DEĞİŞMEDİ: bütçe/`plan.totalSpend` onu okur.
   */
  @ApiProperty({
    description: 'Incremental PROMO spend (LTA excluded) — ROI denominator',
  })
  promoTotal!: number;
}

export class SpendBreakdown {
  @ApiProperty({ description: 'SKU ID' })
  skuId!: string;

  @ApiProperty({
    description: 'Base spend breakdown',
    type: BaseSpendBreakdown,
  })
  base!: BaseSpendBreakdown;

  @ApiProperty({
    description: 'Planned spend breakdown',
    type: PlannedSpendBreakdown,
  })
  planned!: PlannedSpendBreakdown;

  @ApiProperty({
    description: 'Incremental spend breakdown',
    type: IncrementalSpendBreakdown,
  })
  incremental!: IncrementalSpendBreakdown;
}

export class FUSpendBreakdown {
  @ApiProperty({ description: 'FU ID' })
  fuId!: string;

  @ApiProperty({ description: 'SKU spend breakdowns', type: [SpendBreakdown] })
  skuBreakdowns!: SpendBreakdown[];

  @ApiProperty({
    description: 'Aggregated base spend breakdown',
    type: BaseSpendBreakdown,
  })
  aggregatedBase!: BaseSpendBreakdown;

  @ApiProperty({
    description: 'Aggregated planned spend breakdown',
    type: PlannedSpendBreakdown,
  })
  aggregatedPlanned!: PlannedSpendBreakdown;

  @ApiProperty({
    description: 'Aggregated incremental spend breakdown',
    type: IncrementalSpendBreakdown,
  })
  aggregatedIncremental!: IncrementalSpendBreakdown;
}

export class SKUSpendDistribution {
  @ApiProperty({ description: 'SKU ID' })
  skuId!: string;

  @ApiProperty({ description: 'Distributed amount' })
  amount!: number;

  @ApiProperty({ description: 'Distribution ratio' })
  ratio!: number;
}

export class ValidationResult {
  @ApiProperty({ description: 'Is valid' })
  isValid!: boolean;

  @ApiProperty({ description: 'Validation errors', type: [String] })
  errors!: string[];

  @ApiProperty({ description: 'Validation warnings', type: [String] })
  warnings!: string[];
}
