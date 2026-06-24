import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { AdminAuditService } from '../../common/services/admin-audit.service';

@ApiTags('Admin - Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get('audit-log')
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get high-risk audit logs' })
  @ApiResponse({ status: 200, description: 'List of high-risk audit logs' })
  getHighRisk(@TenantId() tenantId: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.auditService.getHighRiskActions(tenantId, limitNum);
  }
}
