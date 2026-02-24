import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty()
  current!: number;

  @ApiProperty()
  thisUpload!: number;

  @ApiProperty()
  after!: number;

  @ApiProperty({ enum: ['GREEN', 'YELLOW', 'RED'] })
  status!: 'GREEN' | 'YELLOW' | 'RED';
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
}
