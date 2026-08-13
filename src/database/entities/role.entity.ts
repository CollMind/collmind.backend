import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * Role family — `roller` / `yetenekler` / `rol_yetenekleri` / `kullanici_rolleri`
 * (B dalgası / S6, `K-2.6.4`, `K-2.6.5a`–`5d`).
 *
 * `K-2.6.5a`: rol bir VARLIKTIR, bir enum değeri değil. `K-2.6.5`: bir kullanıcı
 * birden çok rol taşıyabilir (birleştirme tablosu). `K-2.6.5b`: etkin yetki =
 * rollerin BİRLEŞİMİ (kesişim/koşullu devreye alma yok).
 *
 * ⚠️ Kapsam: bu migration yalnız DÖRT TABLOYU açar ve `roles`'u K-2.6.4'ün beş
 * kanonik rolüyle SEEDLER (seed item 3). `capabilities`/`role_capabilities`/
 * `user_role_assignments` BOŞ kalır — yetenek kataloğunun içeriği (K-2.6.3'ün
 * "plan oluşturabilir" vb. örnekleri) ve kullanıcı-rol ataması ayrı bir iştir; şema
 * burada, popülasyon değil (S13 emsali). `users.role` (tekil enum kolonu) BU
 * migration'da KALDIRILMIYOR — R2a yalnız enum değerlerini değiştiriyor, kolonu değil.
 */
@Entity({ name: 'roles', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
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

@Entity({ name: 'capabilities', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
export class Capability extends BaseEntity {
  @Column({ length: 100 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;
}

@Entity({ name: 'role_capabilities', schema: 'main' })
@Index(['roleId', 'capabilityId'], { unique: true })
export class RoleCapability extends BaseEntity {
  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Column({ name: 'capability_id', type: 'uuid' })
  capabilityId!: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @ManyToOne(() => Capability, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'capability_id' })
  capability!: Capability;
}

@Entity({ name: 'user_role_assignments', schema: 'main' })
@Index(['userId', 'roleId'], { unique: true })
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
