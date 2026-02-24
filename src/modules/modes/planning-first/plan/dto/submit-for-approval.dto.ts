import { IsString, IsOptional, MaxLength } from 'class-validator';

export class SubmitForApprovalDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  submissionNotes?: string;
}

export interface SubmissionResult {
  success: boolean;
  planId: string;
  status: string;
  budgetCheck: {
    onInvoice: {
      available: number;
      requested: number;
      sufficient: boolean;
    };
    offInvoice: {
      available: number;
      requested: number;
      sufficient: boolean;
    };
    overallSufficient: boolean;
    warnings?: string[];
  };
  validationErrors?: string[];
  approvalRequestId: string;
}
