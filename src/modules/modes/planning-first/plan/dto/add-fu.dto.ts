import { IsUUID, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddFuDto {
  @ApiProperty({ description: 'Forecasting Unit ID' })
  @IsUUID()
  @IsNotEmpty()
  fuId!: string;

  // T-079: `tactics` REMOVED. It used to be accepted here and written straight
  // into `plan_fus.tactics` with no scale validation — so `{ CPP_ON_PCT: 999 }`
  // returned 201 through this endpoint while F2/C3's gate rejected the same
  // value with 400 on `PATCH .../tactics`. Two write paths to one JSONB column,
  // one gated and one open.
  //
  // WHY REMOVED RATHER THAN GATED
  // Measured 2026-08-05: the field had ZERO callers. All three frontend call
  // sites send `{ fuId, planVersion }`; so does every `POST .../fus` body in
  // the e2e suite; no seed uses it. It carried a risk and no value.
  // (A count is deliberately not quoted here — it drifts with every test added,
  // and two independent recounts of it already disagreed. The claim that
  // matters is "none", which does not drift.)
  //
  // Adding the gate here instead would have made the two write paths PERMANENT
  // and merely gated both — and the lesson from this repo's seven recorded
  // divergences is that two paths drift even when both are correct at the time
  // (`filter_allowlist` and `validate_allowlist` read one format under two
  // rules, and both were "right"). Removing the field eliminates the path; a
  // second gate would only have covered it.
  //
  // `forbidNonWhitelisted: true` (main.ts:34) means a client that still sends
  // `tactics` now gets a 400 rather than having it silently dropped — the
  // closure announces itself.
  //
  // If "set tactics while adding an FU" is ever actually wanted, the field comes
  // back WITH its gate in one piece. The scale contract, `toMechanicInput` and
  // C3's validation will all be in place by then, so that gate will be better
  // than one written today for a caller that does not exist.

  // T-034: adding an FU is a structural plan change (bumps plans.version) —
  // see docs/analysis/0005 §3 "addFu/removeFu neden plan seviyesi?". Not
  // `@IsNotEmpty()` on purpose (409 MISSING_VERSION, not 400 — see
  // update-plan.dto.ts).
  @ApiPropertyOptional({
    description: 'Expected current plans.version (optimistic locking, T-034).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  planVersion?: number;
}
