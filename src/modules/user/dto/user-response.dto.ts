import { ApiProperty } from '@nestjs/swagger';
import {
  User,
  UserRole,
  UserStatus,
} from '../../../database/entities/user.entity';

/**
 * [[T-255]] ⛔ P0 — bu sınıfın alan listesi `User` entity'sinin bir ALT
 * KÜMESİ olmalı, ASLA `User`'ın kendisi ya da bir spread'i değil.
 *
 * Ölçüldü (2026-08-21): `user.controller.ts`'in sekiz yanıt-döndüren
 * ucu bu DTO'yu SWAGGER TİPİ olarak beyan ediyordu (`@ApiResponse({ type:
 * UserResponseDto })`) ama gerçek dönüş değeri HAM `User` entity'siydi —
 * repoda `ClassSerializerInterceptor` HİÇ uygulanmıyor (0 kullanım,
 * `grep -rn ClassSerializerInterceptor src/`), yani entity'deki
 * `@Exclude()` dekoratörleri de (passwordHash, refreshToken,
 * emailVerificationToken, passwordResetToken) ÖLÜ KOD — hiçbir zaman
 * çalıştırılmıyorlar. Canlı pozitif kontrol (PLANNER token'ıyla
 * `GET /users/<başka kullanıcı>`): 31 alan, `passwordHash` ve üç token
 * dahil, `200` ile dönüyordu.
 *
 * Düzeltme: manuel eşleme (`fromEntity`), controller sınırında —
 * `ClassSerializerInterceptor` global olarak eklenmedi (kapsam dışı, ayrı
 * bir karar: tüm entity'leri etkiler, yalnız `User`'ı değil).
 *
 * ⚠️ Bu DTO'nun alan listesi `collmind.frontend/src/types/user.types.ts`
 * `User` arayüzüyle KARŞILAŞTIRILDI (2026-08-21) — birebir eşleşiyor,
 * eksik/fazla alan yok. Yeni bir alan eklerken o dosyayla senkron tut.
 */
export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  firstName?: string;

  @ApiProperty()
  lastName?: string;

  @ApiProperty()
  phoneNumber?: string;

  @ApiProperty()
  department?: string;

  @ApiProperty()
  jobTitle?: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  lastLoginAt?: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  /**
   * `User` entity'sinden bu DTO'ya eşleme — TEK yer (İlke 4). Alan
   * bazında KOPYALAR, spread/`Object.assign` KULLANMAZ — spread yeni bir
   * entity kolonu eklendiğinde (ör. `mfaSecret`) onu SESSİZCE bu DTO'ya
   * da taşırdı; alan-bazlı liste yeni kolonu dışarıda bırakır (fail-closed).
   */
  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.role = user.role;
    dto.status = user.status;
    dto.fullName = user.fullName;
    dto.firstName = user.firstName;
    dto.lastName = user.lastName;
    dto.phoneNumber = user.phoneNumber;
    dto.department = user.department;
    dto.jobTitle = user.jobTitle;
    dto.tenantId = user.tenantId;
    dto.lastLoginAt = user.lastLoginAt;
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.updatedAt;
    return dto;
  }

  static fromEntities(users: User[]): UserResponseDto[] {
    return users.map((u) => UserResponseDto.fromEntity(u));
  }
}
