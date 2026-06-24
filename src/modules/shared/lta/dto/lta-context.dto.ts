import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LTAAgreement } from '../../../../database/entities/lta-agreement.entity';
import { LTARate } from '../../../../database/entities/lta-rate.entity';

export class LTAContext {
  @ApiProperty({ description: 'LTA Agreement', type: LTAAgreement })
  agreement!: LTAAgreement;

  @ApiProperty({ description: 'Applicable LTA Rate', type: LTARate })
  rate!: LTARate;

  @ApiPropertyOptional({
    description: 'Override on-invoice percentage if exists',
  })
  overrideOnInvoicePct?: number;

  @ApiPropertyOptional({
    description: 'Override off-invoice percentage if exists',
  })
  overrideOffInvoicePct?: number;

  @ApiProperty({ description: 'Final on-invoice percentage to use' })
  finalOnInvoicePct!: number;

  @ApiProperty({ description: 'Final off-invoice percentage to use' })
  finalOffInvoicePct!: number;
}

export class LTASpendBreakdown {
  @ApiProperty({ description: 'Base LTA on-invoice spend' })
  baseLtaOnInvoiceSpend!: number;

  @ApiProperty({ description: 'Base LTA off-invoice spend' })
  baseLtaOffInvoiceSpend!: number;

  @ApiProperty({ description: 'Planned LTA on-invoice spend' })
  plannedLtaOnInvoiceSpend!: number;

  @ApiProperty({ description: 'Planned LTA off-invoice spend' })
  plannedLtaOffInvoiceSpend!: number;

  @ApiProperty({ description: 'Base GSV' })
  baseGsv!: number;

  @ApiProperty({ description: 'Planned GSV' })
  plannedGsv!: number;

  @ApiProperty({ description: 'Base volume' })
  baseVolume!: number;

  @ApiProperty({ description: 'Planned volume' })
  plannedVolume!: number;

  @ApiProperty({ description: 'List price' })
  listPrice!: number;
}
