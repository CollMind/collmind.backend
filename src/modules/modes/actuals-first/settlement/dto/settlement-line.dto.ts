import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgreementStatus,
  SpendType,
} from '../../../../../database/entities/agreement.entity';

/**
 * Agreement bazlı settlement satırı.
 * "claim" değil "line" adı kullanılır (BRD terminolojisi).
 * claimAmount = capTotalAmount (agreement.capTotalAmount)
 * invoicedAmount = ledger DEBIT − CREDIT (direction-aware sum, reversals otomatik düşer)
 * remainingAmount = claimAmount − invoicedAmount (negatif olabilir — aşım durumu)
 */
export class SettlementLineDto {
  @ApiProperty({ description: 'Agreement UUID' })
  agreementId!: string;

  @ApiProperty({ description: 'Agreement code (e.g. STA-2026-001)' })
  agreementCode!: string;

  @ApiPropertyOptional({ description: 'Agreement name' })
  agreementName?: string;

  @ApiProperty({ description: 'CPL UUID' })
  cplId!: string;

  @ApiProperty({ description: 'Agreement status', enum: AgreementStatus })
  status!: AgreementStatus;

  @ApiPropertyOptional({ description: 'Spend type', enum: SpendType })
  spendType?: SpendType;

  @ApiProperty({
    description:
      'Total claim amount = agreement.capTotalAmount (budget ceiling)',
    example: 50000.0,
  })
  claimAmount!: number;

  @ApiProperty({
    description:
      'Total invoiced amount = ledger DEBIT − CREDIT (direction-aware; reversals already netted)',
    example: 42000.0,
  })
  invoicedAmount!: number;

  @ApiProperty({
    description:
      'Remaining amount = claimAmount − invoicedAmount (null if claimAmount is zero)',
    nullable: true,
    example: 8000.0,
  })
  remainingAmount!: number | null;

  @ApiPropertyOptional({ description: 'Period month (YYYY-MM)' })
  periodMonth?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when agreement was closed',
  })
  closedAt?: Date;

  @ApiPropertyOptional({
    description: 'User UUID who closed the agreement',
  })
  closedBy?: string;
}
