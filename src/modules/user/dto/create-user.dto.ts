import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  MinLength,
  MaxLength,
  IsBoolean,
  IsArray,
  IsUUID,
  ArrayMinSize,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../../../database/entities/user.entity';
import { SCOPE_REQUIRED_ROLES } from '../../../database/entities/user-scope.entity';

/**
 * T-241 — R-1 pair semantiği (access-scope.service.ts): her satır kendi
 * (cplId, categoryId) çiftini taşır, düzleştirme (cplIds[] x categoryIds[])
 * YASAK. `null` = "hepsi" o boyutta (user-scope.entity.ts'in dokümante ettiği
 * anlam). Bu DTO yalnız YAZAR (uç bir kapsam yazar, hesaplamaz — K-2.6.10);
 * pair'lerin çözümlenmesi (UNRESTRICTED/SCOPED, CM normalizasyonu) yine
 * AccessScopeService#buildScope'ta, okuma zamanında olur.
 */
export class UserScopePairDto {
  @ApiPropertyOptional({
    description: 'null = bu çiftte tüm CPLler',
    nullable: true,
    example: 'a1b2c3d4-0000-0000-0000-000000000000',
  })
  @ValidateIf((o: UserScopePairDto) => o.cplId !== null)
  @IsOptional()
  @IsUUID()
  cplId?: string | null;

  @ApiPropertyOptional({
    description: 'null = bu çiftte tüm kategoriler',
    nullable: true,
    example: 'e5f6a7b8-0000-0000-0000-000000000000',
  })
  @ValidateIf((o: UserScopePairDto) => o.categoryId !== null)
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}

export class CreateUserDto {
  @ApiProperty({ example: 'john.doe@acme.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ enum: UserRole, default: UserRole.PLANNER })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({ example: '+90 555 123 4567' })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 'Sales' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: 'Sales Manager' })
  @IsString()
  @IsOptional()
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  mustChangePassword?: boolean;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  permissions?: string[];

  /**
   * T-241 (`.claude/backlog/tasks/T-241.md`, karar (b)): rol + kapsam TEK
   * çağrıda. `role` `SCOPE_REQUIRED_ROLES`'ta (PLANNER, CATEGORY_MANAGER)
   * ise bu alan ZORUNLU ve en az 1 çift taşımalı — yoksa ValidationPipe 400
   * döner (forbidNonWhitelisted açık olduğundan alan sessizce yok sayılamaz).
   * `role` `WILDCARD_ON_CREATE_ROLES`'taysa (ADMIN, FINANCE, READONLY) bu alan
   * YOK SAYILIR — o roller her zaman otomatik joker kapsamla yaratılır
   * (UserService#create), çağıranın ne gönderdiği fark etmez.
   */
  @ApiPropertyOptional({
    type: [UserScopePairDto],
    description:
      'PLANNER/CATEGORY_MANAGER için ZORUNLU (≥1 çift). ADMIN/FINANCE/READONLY ' +
      'için yok sayılır — bu roller otomatik joker kapsamla yaratılır.',
  })
  @ValidateIf((o: CreateUserDto) => SCOPE_REQUIRED_ROLES.has(o.role))
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UserScopePairDto)
  scope?: UserScopePairDto[];
}
