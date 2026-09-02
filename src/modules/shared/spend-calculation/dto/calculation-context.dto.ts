import { MechanicInput } from '../../../../common/numeric/mechanic-input';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ⛔ MARKA — `export EDİLMEZ` ve `declare const`'tir (çalışma zamanında
 * KARŞILIĞI YOKTUR). Başka hiçbir dosya bu özelliği adlandıramaz ⇒
 * `const x: SKUContext = { ... }` **derlenmez**. Tek üretici
 * `sku-spend-inputs.ts#resolveSkuSpendInputs` (`Z77 §2`).
 */
declare const SKU_CONTEXT_BRAND: unique symbol;

/**
 * ⛔ **NESNE LİTERALİYLE İNŞA EDİLEMEZ** — `Z77 §2` / `T-337`.
 *
 * > *"Bir çağıran unutuldu ⇒ DERLEME HATASI olur, BÜTÇE SAPMASI değil."*
 *
 * `listPrice` **her zaman sonlu sayıdır** (eksikse resolver bu tipi hiç
 * üretmez). `baseVolume`/`plannedVolume`/`cogsPerUnit` `null` olabilir ve
 * bu **bir varsayılan değil, taşınan bir olgudur** (`CLAUDE.md §2.5`) —
 * her biri AYRI bir kovayı düşürür, hepsini birden değil.
 *
 * Ölçüm ve gerekçe: `docs/research/K1_SESSIZ_SIFIR_OLCUM_TABLOSU.md`.
 */
export class SKUContext {
  /**
   * Yalnız derleyici için. Çalışma zamanında bu alan YOKTUR ve hiçbir kod
   * onu okumaz — `resolveSkuSpendInputs`'un tek `as unknown as SKUContext`
   * dönüşümü onu atlar.
   */
  readonly [SKU_CONTEXT_BRAND]!: true;

  @ApiProperty({ description: 'SKU ID' })
  skuId!: string;

  /**
   * `plan_skus.base_volume` — **NULLABLE** kolon (`K1 §3`). `null` =
   * *"taban hacmi girilmemiş"*, `0` ile aynı şey DEĞİLDİR:
   * `null` ⇒ `SpendBreakdown.base.*` ve `incremental.{onInvoice,offInvoice,
   * total}` `null` döner (eskiden `INCR_SPEND` **şişkin bir sayı** olarak
   * KPI motoruna gidiyordu — `K1 §1b:2532`).
   */
  @ApiPropertyOptional({ description: 'Base volume (null = not entered)' })
  baseVolume!: number | null;

  /**
   * `plan_skus.planned_volume` — **NULLABLE** kolon. `null` = *"planlanan
   * hacim girilmemiş"* ⇒ **planlanan** harcama hesaplanamaz
   * (`SpendBreakdown.planned = null`), ama **taban ETKİLENMEZ**: taban
   * `BASE_VOL × BPTT`'dir ve `PLAN_VOL`'e bağlı değildir.
   */
  @ApiPropertyOptional({ description: 'Planned volume (null = not entered)' })
  plannedVolume!: number | null;

  /**
   * `skus.unit_price` (BPTT) — master data. ⛔ Resolver'ın garantisiyle
   * **daima sonlu sayıdır**: eksikse hiçbir kova hesaplanamaz, o yüzden
   * resolver bu tipi HİÇ üretmez (`NOT_EVALUABLE` + `ctx: null`).
   */
  @ApiProperty({
    description: 'List price (BPTT) — resolver guarantees finite',
  })
  listPrice!: number;

  /**
   * `skus.cogs` — **NULLABLE**; bugün `166/170` satırda `NULL` ve
   * `cogs = 0` olan satır **SIFIR** (`Z77 §3b`: *"`0` meşru bir değer
   * olsaydı, veride en az bir tane olurdu"*).
   */
  @ApiPropertyOptional({ description: 'COGS per unit (null = not configured)' })
  cogsPerUnit!: number | null;

  @ApiPropertyOptional({ description: 'Channel code' })
  channelCode?: string;

  @ApiPropertyOptional({ description: 'Category code' })
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'CPL ID' })
  cplId?: string;
}

export class CalculationContext {
  @ApiProperty({ description: 'Plan ID' })
  planId!: string;

  @ApiProperty({ description: 'FU ID' })
  fuId!: string;

  @ApiProperty({ description: 'SKU contexts', type: [SKUContext] })
  skuContexts!: SKUContext[];

  @ApiProperty({ description: 'Mechanic values map', type: 'object' })
  /**
   * mechanicCode -> the planner's entry, TAGGED with the scale it means
   * (ADR 0007 F2/C2a). Was `Record<string, number>`, which forced every reader
   * to re-derive "is this a percentage or TRY?" from the mechanic row. The
   * scale is now resolved once, in `toMechanicInput`.
   * Collapse to a raw number with `rawOf()`. That collapse maps an absent entry
   * onto zero on purpose — ADR 0008: no meaning difference between the two.
   */
  mechanicValues!: Record<string, MechanicInput>;

  @ApiPropertyOptional({ description: 'LTA on-invoice percentage' })
  ltaOnInvoicePct?: number;

  @ApiPropertyOptional({ description: 'LTA off-invoice percentage' })
  ltaOffInvoicePct?: number;

  /**
   * T-062: pre-computed LUMPSUM_SPEND distribution for this FU, keyed
   * `skuId -> mechanicCode -> distributedAmount`. Populated ONCE per FU
   * (before the per-SKU loop) by
   * `SpendCalculationService#computeLumpsumDistribution` — never per-SKU —
   * because a correct base-volume-proportional split with an exact-sum
   * rounding guarantee (docs/decisions/0006) requires knowing every
   * sibling SKU's base volume up front, which a single SKU's calculation
   * does not have. `undefined` means the caller did not provide FU
   * context (e.g. a standalone `calculateMechanicSpend`/
   * `calculateCompleteSKUFinancialMetrics` call outside a FU loop) — in
   * that case LUMPSUM_SPEND mechanics degrade to 0 (documented, not a
   * silent production behaviour: the one live per-FU entry point,
   * `PlanService#recalculatePlanWithKpiEngineLocked`, always populates this
   * field — its former sibling `calculateAllSpendsForFU` was deleted,
   * `T-350`/`Z79 §7`, zero production callers).
   */
  lumpsumSharesBySku?: Record<string, Record<string, number>>;
}
