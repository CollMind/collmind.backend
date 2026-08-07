import { ApiProperty } from '@nestjs/swagger';
import { UtilizationStatus } from '../../../../shared/finance-reporting/dto/budget-utilization.dto';

export class LineAnalysisDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  valid!: number;

  @ApiProperty()
  errors!: number;
}

export class FinancialSummaryDto {
  @ApiProperty()
  totalDiscount!: number;
}

export class DiscountDistributionItemDto {
  @ApiProperty()
  amount!: number;

  @ApiProperty()
  percentage!: number;
}

export class DiscountDistributionDto {
  @ApiProperty({ type: DiscountDistributionItemDto, nullable: true })
  cppOnInvoice?: DiscountDistributionItemDto;

  @ApiProperty({ type: DiscountDistributionItemDto, nullable: true })
  ltaOnInvoice?: DiscountDistributionItemDto;

  @ApiProperty({ type: DiscountDistributionItemDto, nullable: true })
  promoDiscount?: DiscountDistributionItemDto;
}

export class BudgetImpactItemDto {
  @ApiProperty()
  envelopeCode!: string;

  /**
   * T-098: `null` when the envelope's figures could not be read.
   *
   * This used to be `0` in the failure branch, while the success branch put the
   * real utilisation here. Zero is a valid budget figure, so the reader had no
   * way to tell "this envelope is unused" from "we could not read it" — an error
   * wearing the costume of a result. `null` cannot be mistaken for a measurement.
   *
   * The row is still emitted, deliberately. Dropping it would be the same lie in
   * the other direction: an envelope missing from a budget-impact report reads as
   * "not affected".
   */
  @ApiProperty({
    nullable: true,
    description: 'null when dataStatus is unavailable — never render as zero.',
  })
  current!: number | null;

  @ApiProperty()
  thisUpload!: number;

  @ApiProperty({ nullable: true, description: 'null when unreadable.' })
  after!: number | null;

  /**
   * T-098: `null` when unreadable. RED is a FINDING — it means the upload pushes
   * this envelope past its threshold — and a failure to read must not be dressed
   * up as one. Reporting an error as a business result is how it stops looking
   * like an error.
   */
  @ApiProperty({ enum: UtilizationStatus, nullable: true })
  status!: UtilizationStatus | null;

  @ApiProperty({
    enum: ['ok', 'unavailable'],
    description: 'Whether the figures on this row could be computed at all.',
  })
  dataStatus!: 'ok' | 'unavailable';
}

export class ValidationErrorDto {
  @ApiProperty()
  rowNumber!: number;

  @ApiProperty({ required: false })
  field?: string;

  @ApiProperty()
  message!: string;
}

export class ValidationResponseDto {
  @ApiProperty({ type: LineAnalysisDto })
  lineAnalysis!: LineAnalysisDto;

  @ApiProperty({ type: FinancialSummaryDto })
  financialSummary!: FinancialSummaryDto;

  @ApiProperty({ type: DiscountDistributionDto })
  discountDistribution!: DiscountDistributionDto;

  @ApiProperty({ type: [BudgetImpactItemDto] })
  budgetImpact!: BudgetImpactItemDto[];

  @ApiProperty({ type: [ValidationErrorDto] })
  errors!: ValidationErrorDto[];

  @ApiProperty()
  criticalEnvelopesCount!: number; // RED seviyesine düşecek envelope sayısı

  /**
   * T-098: envelopes whose figures could not be computed.
   *
   * `criticalEnvelopesCount` counts `status === 'RED'`. Once an unreadable
   * envelope stopped claiming RED — which it should never have claimed, RED being
   * a finding — it stopped being counted anywhere, and the summary read "0
   * critical" while an envelope was unreadable. The row-level `dataStatus` was
   * honest and the summary above it was not.
   *
   * A failure that is merely absent from a total is still a failure being
   * reported as an absence, one level up.
   */
  @ApiProperty({
    description:
      'Envelopes whose budget impact could not be computed. Not included in ' +
      'criticalEnvelopesCount — an unreadable envelope is not a finding.',
  })
  unreadableEnvelopesCount!: number;
}
