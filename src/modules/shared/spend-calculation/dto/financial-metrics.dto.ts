import { ApiProperty } from '@nestjs/swagger';
import { SpendBreakdown } from './spend-breakdown.dto';

export class NIVMetrics {
  @ApiProperty({ description: 'Base NIV' })
  baseNiv!: number;

  @ApiProperty({ description: 'Planned NIV' })
  plannedNiv!: number;

  @ApiProperty({ description: 'Incremental NIV' })
  incrementalNiv!: number;
}

export class TurnoverMetrics {
  @ApiProperty({ description: 'Base Turnover' })
  baseTo!: number;

  @ApiProperty({ description: 'Planned Turnover' })
  plannedTo!: number;

  @ApiProperty({ description: 'Incremental Turnover' })
  incrementalTo!: number;
}

export class COGSMetrics {
  @ApiProperty({ description: 'Base COGS' })
  baseCogs!: number;

  @ApiProperty({ description: 'Planned COGS' })
  plannedCogs!: number;

  @ApiProperty({ description: 'Incremental COGS' })
  incrementalCogs!: number;
}

export class ProfitMetrics {
  @ApiProperty({ description: 'Base Gross Profit' })
  baseGp!: number;

  @ApiProperty({ description: 'Planned Gross Profit' })
  plannedGp!: number;

  @ApiProperty({ description: 'Incremental Gross Profit' })
  incrementalGp!: number;
}

export class ROIMetrics {
  @ApiProperty({ description: 'GP ROI percentage' })
  gpRoiPct!: number | null;

  @ApiProperty({ description: 'Turnover ROI percentage' })
  toRoiPct!: number | null;
}

export class MarginMetrics {
  @ApiProperty({ description: 'Planned Gross Margin percentage' })
  plannedGmPct!: number | null;

  @ApiProperty({ description: 'Incremental Gross Margin percentage' })
  incrementalGmPct!: number | null;
}

export class CompleteSKUFinancialMetrics {
  @ApiProperty({ description: 'SKU ID' })
  skuId!: string;

  @ApiProperty({ description: 'Spend breakdown', type: SpendBreakdown })
  spendBreakdown!: SpendBreakdown;

  @ApiProperty({ description: 'NIV metrics', type: NIVMetrics })
  niv!: NIVMetrics;

  @ApiProperty({ description: 'Turnover metrics', type: TurnoverMetrics })
  turnover!: TurnoverMetrics;

  @ApiProperty({ description: 'COGS metrics', type: COGSMetrics })
  cogs!: COGSMetrics;

  @ApiProperty({ description: 'Profit metrics', type: ProfitMetrics })
  profit!: ProfitMetrics;

  @ApiProperty({ description: 'ROI metrics', type: ROIMetrics })
  roi!: ROIMetrics;

  @ApiProperty({ description: 'Margin metrics', type: MarginMetrics })
  margin!: MarginMetrics;
}
