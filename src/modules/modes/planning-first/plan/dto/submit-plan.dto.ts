import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * T-034b: submit() is the one state transition that ALSO validates
 * plans.version (docs/analysis/0005 §4 "Tek istisna: submit() version DE
 * ister") — unlike approve/reject/returnToDraft, which rely solely on
 * status-CAS because Pending/Rejected plans are immutable so no concurrent
 * content edit is possible. submit() commits the plan's CURRENT totalSpend
 * to a budget RESERVE; if the planner's in-memory view is stale (someone
 * else edited a SKU volume moments ago), submitting reserves a spend amount
 * the submitter never saw. Deliberately NOT `@IsNotEmpty()` — a missing
 * value must surface as 409 MISSING_VERSION (strict mode), not the
 * ValidationPipe's 400 — see update-plan.dto.ts for the same pattern.
 */
export class SubmitPlanDto {
  @ApiPropertyOptional({
    description:
      'Expected current plans.version (optimistic locking, T-034/T-034b). Required in practice — omitting it returns 409 MISSING_VERSION.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /** `T-344`: bkz. aşağıdaki taşıma notu. */
  @ApiPropertyOptional({
    description:
      'Optional free-text submission note recorded on the plan and in the approval history.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  submissionNotes?: string;
}

/**
 * `T-344` / `Z73 §1` — `SubmitForApprovalDto`'dan taşındı.
 *
 * `POST /plans/:id/submit-for-approval` **öldü** ve tek submit yolu
 * `POST /plans/:id/submit`. O rotanın taşıdığı serbest metinli gönderim
 * notu bu DTO'ya indi: rota ölürken **yeteneği sessizce düşürmedik**
 * (`plans.submission_notes` kolonu + approval history girdisi hâlâ bunu
 * okuyor — yazan kimse kalmasaydı kolon yazma-ölüsü olurdu).
 */

/**
 * `T-344` / `Z73 §1` — submit'in dönüş sözleşmesi.
 *
 * ⛔ **`Plan` DEĞİL.** `ADR 0005 K2`'nin `F12`'si (*"koşulu doldu"*): submit
 * artık yalnız bir durum geçişi bildirmiyor, **iki katman** taşıyor —
 * ```
 * validationErrors   BLOKLAR      (success:false, plan DRAFT kalır)
 * budgetCheck.warnings  BLOKLAMAZ (submit oldu, karar desteği konuşuyor)
 * ```
 * `Q13` uyarı katmanı (`RED` · `AMBER` · `LTA_ONLY` · hedef-altı) canlı
 * kullanıcı yüzeyine **bu alan üzerinden** ulaşır. Alan boş bırakılırsa
 * uyarılar ekranda **ölü doğar** — bu dalganın düzeltmek için var olduğu
 * kusurun ta kendisi (`Z73 §3` şart 2).
 */
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
