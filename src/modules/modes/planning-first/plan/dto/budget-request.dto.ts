import { IsNumber, IsString, Min } from 'class-validator';

export class RequestBudgetIncreaseDto {
  @IsNumber()
  @Min(0)
  requestedOnInvoiceAmount!: number;

  @IsNumber()
  @Min(0)
  requestedOffInvoiceAmount!: number;

  @IsString()
  justification!: string;
}

export interface BudgetRequestResult {
  success: boolean;
  requestId: string;
  message: string;
}
