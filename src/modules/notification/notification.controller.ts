import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all notifications for current user' })
  @ApiResponse({ status: 200, description: 'List of notifications' })
  getAllNotifications(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: number,
  ) {
    return this.notificationService.getAllNotifications(
      tenantId,
      user.id,
      limit ? parseInt(limit.toString()) : 30,
    );
  }

  @Get('unread')
  @ApiOperation({ summary: 'Get unread notifications for current user' })
  @ApiResponse({ status: 200, description: 'List of unread notifications' })
  getUnreadNotifications(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.notificationService.getUnreadNotifications(tenantId, user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  markAsRead(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationService.markAsRead(tenantId, id);
  }
}
