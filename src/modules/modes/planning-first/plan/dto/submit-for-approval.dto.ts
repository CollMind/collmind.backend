import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';

export class SubmitForApprovalDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  submissionNotes?: string;

  // T-034b (code-review fix, docs/analysis/0005 §4 K5 exception): this is
  // the SAME submit transition as PlanService#submit (POST /plans/:id/
  // submit) — a second canonical path that reserves `plan.totalSpend`
  // against a budget envelope from a plan the caller may not have actually
  // seen if someone else edited a SKU volume moments before submission.
  // Both canonical paths must validate `plans.version` identically (T-028c
  // taught this codebase what happens when a check exists on one of two
  // parallel canonical routes and not the other — same task instruction
  // called this out by name). Deliberately NOT `@IsNotEmpty()` — a missing
  // value must surface as 409 MISSING_VERSION (strict mode), not the
  // ValidationPipe's 400 — see submit-plan.dto.ts / update-plan.dto.ts for
  // the identical pattern.
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
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
