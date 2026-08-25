import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CapabilityGuard } from '../../common/guards/capability.guard';
import { RequireCapability } from '../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../common/authorization/capabilities';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminAuditService } from '../../common/services/admin-audit.service';

// `B3 W1` pilot göçü (2026-08-25): `@Roles(ADMIN)` → `@RequireCapability(ADMIN_READ)`.
// `ROLE_CAPABILITIES`'te `ADMIN_READ` yalnız `UserRole.ADMIN`'de — davranış
// KORUNUYOR (pin: göç öncesi/sonrası ADMIN 200, diğer sekiz rol 403, birebir).
@ApiTags('Admin - Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('admin')
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get('audit-log')
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  @ApiOperation({ summary: 'Get audit logs' })
  @ApiResponse({ status: 200, description: 'List of audit logs' })
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser('id') adminId: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    // Get all audit logs (not filtered by adminId for admin users)
    return this.auditService.getAuditLogs(tenantId, undefined, limitNum);
  }

  @Get('audit-log/high-risk')
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  @ApiOperation({ summary: 'Get high-risk audit logs' })
  @ApiResponse({ status: 200, description: 'List of high-risk audit logs' })
  getHighRisk(@TenantId() tenantId: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.auditService.getHighRiskActions(tenantId, limitNum);
  }
}
