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
import { CapabilityGuard } from '../../common/guards/capability.guard';
import { RequireCapability } from '../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../common/authorization/capabilities';
import { SelfScoped } from '../../common/decorators/self-scoped.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// T-249 — bu üç rota `@Roles` TAŞIMIYORDU → `RolesGuard` fail-open
// ([[T-181]] sınıfı, `0074 §5`'in 72 rol-kısıtsız ucundan üçü). Karar
// (ürün sahibi, 2026-08-20, T-249 §2): `GRANT` ile AYNI turda eklendi —
// `ADIM 3`'ün (default-deny göçü) `Faz B`'si uzak, üç canlı uç o kadar
// kırık kalamaz.
//
// `Z26` (SELF kovası, 2026-08-23) ile GÖÇ: `getAllNotifications` ve
// `getUnreadNotifications` sorgusu zaten `tenantId` + `recipientId =
// user.id` ile daralıyor (`notification.repository.ts`
// `findByRecipient`/`findUnreadByRecipient`) — bu, `@Roles`'un TÜM beş
// rolü sayarak taklit ettiği "rolsüz" davranışın DOĞRU temsili
// (`SELF_OLCUM_RAPORU.md §1`: "Bir rolü dışarıda bırakmak o rolün KENDİ
// bildirimlerini görememesi demek olurdu, iş kuralı değil" — `Z18 §4`'ün
// "union böyle dedi" gerekçesinin canlı vakasıydı). İki uç `@SelfScoped()`
// aldı; `markAsRead` `Z26`'nın kapsamı DIŞINDA kalmıştı (bir SELF yüklemi
// değil, `recipientId` sahiplik kontrolü AYRI bir sınıf, T-275).
//
// ⚠️ `@Roles`/`@RequireCapability` yalnız "KİM çağırabilir" sorusunu daraltır
// — kaynak sahipliği (`recipientId`) AYRI bir kontroldür. T-249 bunu bilerek
// erteledi ("markAsRead hâlâ çağıranın recipientId'sini kontrol etmiyor");
// T-249'un GRANT'i `500` örtüsünü kaldırınca içteki kusur CANLI hâle geldi ve
// düzeltildi (T-275, 2026-08-24): `markAsRead` artık `@CurrentUser('id')`
// alıyor ve `NotificationRepository.findById` `recipientId`'yi WHERE'e
// katıyor — kardeşleri (`findByRecipient`/`findUnreadByRecipient`/
// `countUnread`) ile AYNI şart. Sahiplenmeyen/var olmayan kayıt ikisi de
// `404` (varlık sızmaz).
//
// `B3 W1` pilot göçü (2026-08-25): `@Roles(...NOTIFICATION_ROLES)` →
// `@RequireCapability(NOTIFICATION_WRITE)`. `ROLE_CAPABILITIES`'te
// `NOTIFICATION_WRITE` beş rolün BEŞİNDE de var (ADMIN, PLANNER,
// CATEGORY_MANAGER, FINANCE, READONLY) — eski `NOTIFICATION_ROLES` listesiyle
// birebir aynı küme. Davranış KORUNUYOR (pin: göç öncesi/sonrası dokuz seed
// kullanıcının hepsi `404`, hiçbiri `403`).

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @SelfScoped()
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
  @SelfScoped()
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
  @RequireCapability(CAPABILITIES.NOTIFICATION_WRITE)
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
