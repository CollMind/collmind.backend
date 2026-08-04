import { MechanicInput } from '../../../../common/numeric/mechanic-input';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SKUContext {
  @ApiProperty({ description: 'SKU ID' })
  skuId!: string;

  @ApiProperty({ description: 'Base volume' })
  baseVolume!: number;

  @ApiProperty({ description: 'Planned volume' })
  plannedVolume!: number;

  @ApiProperty({ description: 'List price (BPTT)' })
  listPrice!: number;

  @ApiProperty({ description: 'COGS per unit' })
  cogsPerUnit!: number;

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
   * Collapse to a raw number with `rawOf()` — and see T-078 for what that
   * collapse still loses.
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
   * silent production behaviour: both canonical entry points,
   * `calculateAllSpendsForFU` and `PlanService#recalculatePlanWithKpiEngineLocked`,
   * always populate this field).
   */
  lumpsumSharesBySku?: Record<string, Record<string, number>>;
}
