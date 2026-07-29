import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateAgreementDto } from './create-agreement.dto';

export class UpdateAgreementDto extends PartialType(CreateAgreementDto) {
  // T-034: optimistic-locking CAS. Deliberately NOT `@IsNotEmpty()` — a
  // missing value must surface as 409 MISSING_VERSION (strict mode), not
  // the ValidationPipe's 400; AgreementService#update makes that
  // distinction (mirrors update-plan.dto.ts#version).
  @ApiPropertyOptional({
    description:
      'Expected current version (optimistic locking, T-034). Required in practice — omitting it returns 409 MISSING_VERSION.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
