import {
  Controller,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalPolicyService } from './approval-policy.service';
import { UpdateApprovalPolicyDto } from './dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../database/entities/user.entity';

/**
 * T-214 — `approval_policies` yazma yolu (`K-2.5.13c`).
 *
 * Bilerek TEK uç: şablon (`template`) ve tutar eşiği (`amountThreshold`)
 * AYNI istekte değişir. `tierRoles`/`delegateAllowed` bu ucun kapsamında
 * DEĞİL — bkz. `UpdateApprovalPolicyDto` dosya üstü yorumu.
 *
 * `B3 W4b` göçü (2026-08-26, `Z36` SINIF A): `@Roles(ADMIN)` →
 * `@RequireCapability(SHARED_POLICY_WRITE)`. `ROLE_CAPABILITIES`'te
 * `SHARED_POLICY_WRITE` yalnız `UserRole.ADMIN`'de — davranış BİREBİR
 * korunuyor. Gerekçe: `K-2.6.4a/b` SoD — FINANCE onay-eşiği politikasının
 * ÖZNESİDİR, yazma yetkisi FINANCE'in kümesine giremez.
 */
@ApiTags('Approval Policies')
@ApiBearerAuth()
@Controller('approval-policies')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class ApprovalPolicyController {
  constructor(private readonly approvalPolicyService: ApprovalPolicyService) {}

  @Patch(':id')
  @RequireCapability(CAPABILITIES.SHARED_POLICY_WRITE)
  @ApiOperation({
    summary:
      'Onay politikası şablonunu ve (yalnız THRESHOLD için) tutar eşiğini ' +
      'birlikte günceller',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApprovalPolicyDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.approvalPolicyService.update(id, tenantId, dto, user.id);
  }
}
