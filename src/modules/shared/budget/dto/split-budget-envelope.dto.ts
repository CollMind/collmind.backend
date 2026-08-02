import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * T-019b (Faz 2, docs/analysis/0008 §4): `POST /budget/envelopes/:id/split`
 * body. `onInvoiceAllocated + offInvoiceAllocated` MUST equal the envelope's
 * CURRENT `allocated_amount` — this endpoint re-labels the existing pool
 * into two typed twins, it does not grow/shrink the budget (that is a
 * separate operation, out of scope here).
 */
export class SplitBudgetEnvelopeDto {
  @ApiProperty({
    example: 300000,
    description: 'Amount allocated to the new ON_INVOICE envelope',
  })
  @IsNumber()
  @Min(0)
  onInvoiceAllocated!: number;

  @ApiProperty({
    example: 200000,
    description: 'Amount allocated to the new OFF_INVOICE envelope',
  })
  @IsNumber()
  @Min(0)
  offInvoiceAllocated!: number;
}
