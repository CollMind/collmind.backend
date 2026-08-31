import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface MechanicSpendMap {
  [mechanicCode: string]: number | undefined;
}

/**
 * ⛔ **BU NESNENİN KENDİSİ `null` OLABİLİR** (`SpendBreakdown.base`) —
 * `T-337` / `Z77 §2`. Alanları değil, **nesne** düşer: taban ya bütünüyle
 * hesaplanır ya hiç hesaplanmaz, çünkü tek girdisi `BASE_VOL × BPTT`'dir.
 *
 * `plan_skus.base_volume` **NULLABLE** bir kolondur (`K1 §3`) ve `null`
 * girilen bir `0` ile aynı şey değildir. Eskiden `?? 0` düşürülüyordu ⇒
 * `baseTotalSpend = 0` ⇒ `INCR_SPEND = planned − 0` **ŞİŞKİN** bir sayı
 * olarak KPI motoruna gidiyordu (`K1 §1b:2532`).
 */
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

/**
 * ⛔ **NESNE `null` OLABİLİR** (`PLAN_VOL` yoksa: planlanan taraf hiç
 * hesaplanmaz), **VE** nesne varken üç alanı ayrıca `null` olabilir
 * (`BASE_VOL` yoksa: taban çıkarılamaz). İki eksen, iki ayrı olgu.
 */
export class IncrementalSpendBreakdown {
  /**
   * ⛔ `null` OLABİLİR — taban çıkarılarak türer (`planned − base`), yani
   * `BASE_VOL` yoksa TANIMSIZDIR. Bkz. `BaseSpendBreakdown` doc.
   */
  @ApiPropertyOptional({ description: 'Incremental on-invoice spend' })
  onInvoice!: number | null;

  @ApiPropertyOptional({ description: 'Incremental off-invoice spend' })
  offInvoice!: number | null;

  @ApiPropertyOptional({ description: 'Incremental total spend' })
  total!: number | null;

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
   * ⛔ `total` (LTA dahil) bütçe/`plan.totalSpend` tarafını besler.
   *
   * ⚠️ `T-337`: `total` artık `number | null` (taban yoksa tanımsız), ama
   * **`promoTotal` DEĞİL** — tabana bağlı değildir (`baseTotalOnInv =
   * baseLtaOnInv` ⇒ taban promo cebirsel olarak `0`), yani `BASE_VOL`
   * eksikken de tanımlıdır. İkisinin nullability'si bilerek AYRIŞIYOR.
   */
  @ApiProperty({
    description: 'Incremental PROMO spend (LTA excluded) — ROI denominator',
  })
  promoTotal!: number;
}

/**
 * ⛔ ÜÇ KOVA, **İKİ BAĞIMSIZ EKSEN** — `T-337` / `Z77 §2`.
 *
 * ```
 * BASE_VOL yok   ⇒ base = null · incremental.{on,off,total} = null
 *                  planned SAĞLAM  (planlanan taraf tabana bağlı DEĞİL)
 * PLAN_VOL yok   ⇒ planned = null · incremental = null
 *                  base SAĞLAM     (taban = BASE_VOL × BPTT, PLAN_VOL'e bağlı DEĞİL)
 * BPTT yok       ⇒ hiçbiri hesaplanamaz — resolver `ctx` bile üretmez
 * ```
 * ⚠️ **İKİ EKSENİN AYRI OLMASI ÖLÇÜLDÜ, TASARLANMADI.** İlk uygulama
 * `PLAN_VOL` yokluğunu *"hiç breakdown yok"* diye ele aldı ve **taban
 * zincirini de öldürdü**; `lta-lifecycle-bond-and-base-chain.e2e-spec.ts`
 * (`T-293`) bunu yakaladı: yalnız `baseVolume` girilmiş bir SKU'da
 * `BASE_LTA_ON` `null`'a düştü. `§7.1` — *"düzeltmeden önce say"*: taban
 * alanlarının tüketicisi planlanan taraftan BAĞIMSIZ.
 */
export class SpendBreakdown {
  @ApiProperty({ description: 'SKU ID' })
  skuId!: string;

  @ApiPropertyOptional({
    description: 'Base spend breakdown — null when BASE_VOL is not entered',
    type: BaseSpendBreakdown,
  })
  base!: BaseSpendBreakdown | null;

  @ApiPropertyOptional({
    description: 'Planned spend breakdown — null when PLAN_VOL is not entered',
    type: PlannedSpendBreakdown,
  })
  planned!: PlannedSpendBreakdown | null;

  @ApiPropertyOptional({
    description: 'Incremental spend breakdown — null when planned is null',
    type: IncrementalSpendBreakdown,
  })
  incremental!: IncrementalSpendBreakdown | null;
}

export class FUSpendBreakdown {
  @ApiProperty({ description: 'FU ID' })
  fuId!: string;

  @ApiProperty({ description: 'SKU spend breakdowns', type: [SpendBreakdown] })
  skuBreakdowns!: SpendBreakdown[];

  @ApiPropertyOptional({
    description:
      'Aggregated base spend breakdown (null if any SKU lacks BASE_VOL)',
    type: BaseSpendBreakdown,
  })
  aggregatedBase!: BaseSpendBreakdown | null;

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

  /**
   * `T-337` / `Z77 §1` — harcaması **hesaplanamayan** SKU'lar, eksik alan
   * ADIYLA. Bu SKU'lar yukarıdaki toplamlara **girmez**; eskiden `0`
   * katkısıyla giriyor ve toplam *"tam"* görünüyordu.
   *
   * ⛔ Boş dizi ≠ alan yok: boş dizi *"hepsi hesaplandı"* demektir.
   */
  @ApiProperty({
    description: 'SKUs whose spend could not be evaluated (missing inputs)',
  })
  notEvaluableSkus!: Array<{ skuId: string; missing: readonly string[] }>;
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
