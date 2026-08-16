import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * Role family — `roller` / `kullanici_rolleri` (B dalgası / S6, `K-2.6.4`,
 * `K-2.6.5a`–`5d`).
 *
 * `K-2.6.5a`: rol bir VARLIKTIR, bir enum değeri değil. `K-2.6.5`: bir kullanıcı
 * birden çok rol taşıyabilir (birleştirme tablosu). `K-2.6.5b`: etkin yetki =
 * rollerin BİRLEŞİMİ (kesişim/koşullu devreye alma yok). `users.role` (tekil enum
 * kolonu) bu tablo ailesiyle BİRLİKTE yaşıyor — R2a yalnız enum değerlerini
 * değiştirdi, kolonu kaldırmadı.
 *
 * ⚠️ `Capability`/`RoleCapability` (`capabilities`/`role_capabilities` — B dalgası
 * S6'nın orijinal DÖRT tablosunun ikisi) `0056-K3(b)` kararıyla KALDIRILDI
 * (migration `1807000000000`, kayıt `Z4`): **yetenekler kod, veri değil**
 * (`const CAPABILITIES`, tablo değil). Geri EKLENMEZ — bu yorum onu durdurmak için
 * burada. `roles` ve `user_role_assignments` kararın kapsamı DIŞINDA, ikisi de kalır.
 */
@Entity({ name: 'roles', schema: 'main' })
@Index('UQ_roles_tenant_code', ['tenantId', 'code'], { unique: true })
export class Role extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}

@Entity({ name: 'user_role_assignments', schema: 'main' })
@Index('UQ_user_role_assignments_user_role', ['userId', 'roleId'], {
  unique: true,
})
export class UserRoleAssignment extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;
}
