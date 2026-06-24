import { ApiProperty } from '@nestjs/swagger';
import { SettlementLineDto } from './settlement-line.dto';

/**
 * Settlement özet yanıtı.
 *
 * Sayaçlar:
 *   - closedCount: status === CLOSED
 *   - settledCount: status ACTIVE veya CLOSED (fiilen tamamlanmış anlaşmalar)
 *   - pendingCount: status APPROVED veya ACTIVE (hâlâ açık)
 *
 * Toplam değerler:
 *   - totalClaimAmount: CANCELLED/REJECTED/DRAFT/PENDING hariç tüm capTotalAmount toplamı
 *   - totalInvoicedAmount: ledger DEBIT − CREDIT (direction-aware; reversal'lar düşülür)
 *   - totalRemainingAmount: claim − invoiced (null if division-by-zero guard tetiklenirse)
 */
export class SettlementSummaryResponseDto {
  @ApiProperty({ description: 'Total number of agreements in scope' })
  totalCount!: number;

  @ApiProperty({ description: 'Number of CLOSED agreements' })
  closedCount!: number;

  @ApiProperty({
    description: 'Number of settled agreements (ACTIVE + CLOSED)',
  })
  settledCount!: number;

  @ApiProperty({
    description: 'Number of pending/open agreements (APPROVED + ACTIVE)',
  })
  pendingCount!: number;

  @ApiProperty({
    description:
      'Sum of capTotalAmount across in-scope agreements (excludes CANCELLED/REJECTED/DRAFT/PENDING)',
    example: 500000.0,
  })
  totalClaimAmount!: number;

  @ApiProperty({
    description:
      'Sum of net invoiced amount from ledger (DEBIT − CREDIT, direction-aware)',
    example: 420000.0,
  })
  totalInvoicedAmount!: number;

  @ApiProperty({
    description:
      'totalClaimAmount − totalInvoicedAmount. Null if totalClaimAmount is 0 (division-by-zero guard per BRD)',
    nullable: true,
    example: 80000.0,
  })
  totalRemainingAmount!: number | null;

  @ApiProperty({
    description: 'Agreement-level settlement lines',
    type: [SettlementLineDto],
  })
  lines!: SettlementLineDto[];
}
