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
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

// T-249 — bu üç rota `@Roles` TAŞIMIYORDU → `RolesGuard` fail-open
// ([[T-181]] sınıfı, `0074 §5`'in 72 rol-kısıtsız ucundan üçü). Karar
// (ürün sahibi, 2026-08-20, T-249 §2): `GRANT` ile AYNI turda eklendi —
// `ADIM 3`'ün (default-deny göçü) `Faz B`'si uzak, üç canlı uç o kadar
// kırık kalamaz.
//
// Rol seti: TÜM beş `UserRole` — `dashboard.controller.ts#getSummary`
// (`GET /dashboard/summary`) ile AYNI emsal: bildirimler bir iş
// fonksiyonu kapısı değil, KİŞİYE ÖZEL bir veri görünümü (sorgu zaten
// `tenantId` + `recipientId = user.id` ile daralıyor — `notification.
// repository.ts` `findByRecipient`/`findUnreadByRecipient`/`findById`).
// Bir rolü dışarıda bırakmak o rolün KENDİ bildirimlerini görememesi
// demek olurdu, iş kuralı değil.
//
// ⚠️ Bu `@Roles` yalnız "KİM çağırabilir" sorusunu daraltır — kaynak sahipliği
// (`recipientId`) AYRI bir kontroldür. T-249 bunu bilerek erteledi ("markAsRead
// hâlâ çağıranın recipientId'sini kontrol etmiyor"); T-249'un GRANT'i `500`
// örtüsünü kaldırınca içteki kusur CANLI hâle geldi ve düzeltildi (T-275,
// 2026-08-24): `markAsRead` artık `@CurrentUser('id')` alıyor ve
// `NotificationRepository.findById` `recipientId`'yi WHERE'e katıyor —
// kardeşleri (`findByRecipient`/`findUnreadByRecipient`/`countUnread`) ile
// AYNI şart. Sahiplenmeyen/var olmayan kayıt ikisi de `404` (varlık sızmaz).
const NOTIFICATION_ROLES = [
  UserRole.ADMIN,
  UserRole.FINANCE,
  UserRole.CATEGORY_MANAGER,
  UserRole.PLANNER,
  UserRole.READONLY,
] as const;

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @Roles(...NOTIFICATION_ROLES)
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
  @Roles(...NOTIFICATION_ROLES)
  @ApiOperation({ summary: 'Get unread notifications for current user' })
  @ApiResponse({ status: 200, description: 'List of unread notifications' })
  getUnreadNotifications(
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.notificationService.getUnreadNotifications(tenantId, user.id);
  }

  // T-275: `recipientId` artık servise geçiyor — kardeşleri (`getAllNotifications`,
  // `getUnreadNotifications`) zaten `user.id`'yi kullanıyordu, bu uç KULLANMIYORDU.
  @Post(':id/read')
  @Roles(...NOTIFICATION_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({
    status: 404,
    description: 'Notification not found or not owned by caller',
  })
  markAsRead(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationService.markAsRead(tenantId, userId, id);
  }
}
