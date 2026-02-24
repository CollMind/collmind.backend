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
  mechanicValues!: Record<string, number>; // mechanicCode -> enteredValue

  @ApiPropertyOptional({ description: 'LTA on-invoice percentage' })
  ltaOnInvoicePct?: number;

  @ApiPropertyOptional({ description: 'LTA off-invoice percentage' })
  ltaOffInvoicePct?: number;
}
