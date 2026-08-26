import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseUUIDPipe,
  Delete,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSelfDto } from './dto/update-self.dto';
import { UpdateUserScopeDto } from './dto/update-user-scope.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CapabilityGuard } from '../../common/guards/capability.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireCapability } from '../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../common/authorization/capabilities';
import { SelfScoped } from '../../common/decorators/self-scoped.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

// `B3 W3` göçü (2026-08-25): sekiz rota `@Roles(ADMIN)` →
// `@RequireCapability(USER_WRITE|USER_MANAGE)`. `ROLE_CAPABILITIES`'te
// ikisi de yalnız `UserRole.ADMIN`'de (`capabilities.ts` `USER_WRITE` satırı (`:672-673`), **dal 1+2** (tek küme + beş filtresiz hariç — `capabilities.ts:152` başlık kaydı; satır-içi yorum yalnız `dal 1` diyor) —
// tek rol kümesi, mekanik) — davranış KORUNUYOR (pin:
// `test/user-capability-boundary.e2e-spec.ts`, göç öncesi/sonrası birebir:
// ADMIN geçer, ADMIN dışı HER rol 403).
//
// ⛔ `GET /users` (`@Roles(ADMIN, FINANCE)`) BİLİNÇLİ OLARAK GÖÇMEDİ —
// `USER_MANAGE`/`USER_WRITE` `ROLE_CAPABILITIES`'te yalnız `{ADMIN}`,
// göçürmek FINANCE'ı DÜŞÜRÜRDÜ. `@SelfScoped()` uçlar (`me` ailesi) de bu
// göçün kapsamı dışında.
//
// `B3` kaza-dalgası `K1` (2026-08-26): `Z20` daraltması BURADA UYGULANDI —
// `GET /users` `@Roles(ADMIN, FINANCE)` → `@Roles(ADMIN)`, FINANCE DÜŞTÜ.
// Kayıt: `docs/brd-v2/04_KARAR_KAYDI.md` `Z20`/`H7` — `GET /users/:id`
// (`T-255`) zaten `ADMIN`'e daraltılmıştı; `GET /users` onun liste hâli,
// aynı veri sınıfı aynı rol. Pin: `test/z20-users-list-role-boundary.
// e2e-spec.ts`.
@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @RequireCapability(CAPABILITIES.USER_WRITE)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: UserResponseDto,
  })
  async create(
    @TenantId() tenantId: string,
    @Body() createUserDto: CreateUserDto,
    // T-244 (A1): daha önce bu rota @CurrentUser() ALMIYORDU, yani
    // user.service.ts kapsam satırının createdBy'ını yeni kullanıcının
    // KENDİSİYLE dolduruyordu ("kullanıcı kendi erişimini verdi" — bir
    // kusur). `email` de gerekli — A7'nin denetim kaydı için aktörün kimliği.
    @CurrentUser() actor: { id: string; email: string; role: UserRole },
    @Request() req: ExpressRequest,
  ) {
    const ipAddress = req.ip || req.socket?.remoteAddress;
    const user = await this.userService.create(
      tenantId,
      createUserDto,
      actor.id,
      actor.email,
      ipAddress,
    );
    return UserResponseDto.fromEntity(user);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({
    status: 200,
    description: 'List of users',
    type: [UserResponseDto],
  })
  async findAll(@TenantId() tenantId: string) {
    const users = await this.userService.findAll(tenantId);
    return UserResponseDto.fromEntities(users);
  }

  @Get('me')
  @SelfScoped()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile',
    type: UserResponseDto,
  })
  async getProfile(@Request() req: any) {
    const user = await this.userService.getProfile(
      req.user.tenantId,
      req.user.sub,
    );
    return UserResponseDto.fromEntity(user);
  }

  /**
   * `Z26` (`docs/brd-v2/04_KARAR_KAYDI.md`): `SELF` sözleşmesinin ALAN
   * parçası artık TİP SİSTEMİNDE — `UpdateSelfDto` yalnız
   * `fullName/firstName/lastName/phoneNumber/department/jobTitle` taşır,
   * `role`/`status`/`scope`/`tenantId`/`permissions`/`mustChangePassword`/
   * `email` bu tipte YOKTUR. `ValidationPipe`'ın `forbidNonWhitelisted`'ı
   * bunların DIŞINDA gönderilen her alanı `400` ile reddeder — eski
   * `if (updateUserDto.role) delete updateUserDto.role` imperative
   * daraltması bu yüzden KALDIRILDI (ölü kalırsa "demek ki gerekliydi"
   * diye geri getirilir, `Z26` ⛔ GENİŞLEMENİN ŞEKLİ).
   */
  @Patch('me')
  @SelfScoped()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({
    status: 200,
    description: 'Profile updated',
    type: UserResponseDto,
  })
  async updateProfile(
    @Request() req: any,
    @Body() updateSelfDto: UpdateSelfDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const updated = await this.userService.update(
      req.user.tenantId,
      req.user.sub,
      updateSelfDto,
      user.id,
      user.role,
    );
    return UserResponseDto.fromEntity(updated);
  }

  @Patch('me/password')
  @SelfScoped()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 204, description: 'Password changed successfully' })
  changeMyPassword(
    @Request() req: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(
      req.user.tenantId,
      req.user.sub,
      changePasswordDto,
    );
  }

  // T-253: `GET /users/dashboard-summary` (@deprecated) kaldırıldı —
  // `userService.getDashboardSummary(tenantId)` yalnız tenantId alıyordu,
  // userId/role hiç geçmiyordu (AccessScopeService enjekte edilmemişti),
  // yani her rol tüm tenant'ı görüyordu (canlı kapsam bypass'ı, ölçüldü
  // 2026-08-21: planner (11 CPL) ve planner2 (17 CPL) BİREBİR AYNI yanıtı
  // alıyordu). ÇAĞIRAN ölçümü (2026-08-22): backend'de yalnız kendi
  // controller/service/spec'i — ⚠️ bu bir ÇAĞIRAN sayısıdır, bir ATIF
  // sayısı değil: `capabilities.ts` (B1 taksonomisi) ve
  // `TEST_DOCUMENTATION.md` rotayı metinde anıyor, ikisi de yorum/belge.
  // collmind.frontend'de `dashboard-summary` /
  // `getDashboardSummary` / `users/dashboard` 0 eşleşme (pozitif kontrol:
  // aynı grep aracı `/dashboard/summary` — kardeş rota — için eşleşiyor);
  // hiçbir e2e/seed bu rotaya değinmiyor. Kardeş rota `GET /dashboard/summary`
  // (`DashboardService`) zaten `resolveScopedCplIds` ile doğru kapsıyor ve
  // frontend onu kullanıyor. Bkz. `.claude/backlog/tasks/T-253.md`.

  /**
   * [[T-255]] ⛔ P0, ürün sahibi kararı (2026-08-21) — DUR kapandı:
   *
   * `(3)` (entity ham dönüyor) `UserResponseDto.fromEntity` ile
   * düzeltildi — kimlik materyali (`passwordHash` · `refreshToken` ·
   * `passwordResetToken` · `emailVerificationToken`) artık HİÇBİR role
   * dönmez.
   *
   * `(1)`/`(2)` (sahiplik/rol) — KARAR: `@Roles(UserRole.ADMIN)` (`B3 W3`'ten
   * beri `@RequireCapability(USER_MANAGE)` — AYNI KAPI, farklı mekanizma;
   * küme birebir `{ADMIN}`, `capabilities.ts:673`).
   * Gerekçe: `GET /users/me` `READ_OWN`'ın örneği (yüklemi zaten doğru,
   * `req.user.sub`); `GET /users/:id` bir YÖNETİM UCU (T-241/T-242a'nın
   * kullanıcı yönetimi akışının parçası) — `Z18` taksonomisinin ayrımı.
   * BAŞKA rol başkasının kaydını okuyamaz.
   *
   * ⚠️ `route-scope-baseline.txt:68`'deki
   * `F src/modules/user/user.controller.ts|GET|users/:id 159` satırı bu
   * yüzden AYRI bir commit'te düşürülmeli (B2 deseni, T-252) — bu
   * dosyanın commit'i O satırı GÜNCEL OLMAYAN bırakır, ratchet bunu
   * "iyileşme" olarak görüp DURACAK; baseline güncellemesi Team Lead
   * tarafından ayrı commit'te yapılır.
   */
  @Get(':id')
  @RequireCapability(CAPABILITIES.USER_MANAGE)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({
    status: 200,
    description: 'User details',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = await this.userService.findOne(tenantId, id);
    return UserResponseDto.fromEntity(user);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITIES.USER_WRITE)
  @ApiOperation({ summary: 'Update user (EA-001: Admin restrictions apply)' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  async update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const updated = await this.userService.update(
      tenantId,
      id,
      updateUserDto,
      user.id,
      user.role,
    );
    return UserResponseDto.fromEntity(updated);
  }

  /**
   * [[T-242a]] — kapsam GÜNCELLEME/BOŞALTMA. `PATCH /users/:id`'in genel
   * gövdesi `scope`'u artık KABUL ETMİYOR (bilinmeyen alan → 400,
   * `update-user.dto.ts`'in JSDoc'una bkz. — ADIM 0'ın ölçtüğü sessiz
   * no-op'un kapatılması). RBAC `POST /users` ile TUTARLI: yalnız ADMIN.
   */
  @Patch(':id/scope')
  @RequireCapability(CAPABILITIES.USER_WRITE)
  @ApiOperation({
    summary:
      'Update user scope (TAM DEĞİŞTİRME — hedef durumu alır, ekle/çıkar değil)',
  })
  @ApiResponse({ status: 200, description: 'Scope updated' })
  updateScope(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserScopeDto: UpdateUserScopeDto,
    @CurrentUser() actor: { id: string; email: string; role: UserRole },
    @Request() req: ExpressRequest,
  ) {
    const ipAddress = req.ip || req.socket?.remoteAddress;
    return this.userService.updateScope(
      tenantId,
      id,
      updateUserScopeDto,
      actor.id,
      actor.email,
      ipAddress,
    );
  }

  @Patch(':id/password')
  @RequireCapability(CAPABILITIES.USER_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 204, description: 'Password changed successfully' })
  changePassword(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(tenantId, id, changePasswordDto);
  }

  @Post(':id/activate')
  @RequireCapability(CAPABILITIES.USER_WRITE)
  @ApiOperation({ summary: 'Activate user' })
  @ApiResponse({ status: 200, description: 'User activated' })
  async activate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = await this.userService.activate(tenantId, id);
    return UserResponseDto.fromEntity(user);
  }

  @Post(':id/deactivate')
  @RequireCapability(CAPABILITIES.USER_WRITE)
  @ApiOperation({ summary: 'Deactivate user' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  async deactivate(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = await this.userService.deactivate(tenantId, id);
    return UserResponseDto.fromEntity(user);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITIES.USER_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 204, description: 'User deleted successfully' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.userService.remove(tenantId, id);
  }
}
