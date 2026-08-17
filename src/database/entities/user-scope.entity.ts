import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Cpl } from './cpl.entity';
import { Category } from './category.entity';

/**
 * User Scope Entity
 *
 * Maps users to their authorized CPLs and Categories
 * Rule: Planner → sadece yetkili CPL + Category görür
 */
@Entity({ name: 'user_scopes', schema: 'main' })
@Index(['userId', 'cplId', 'categoryId'], { unique: true })
@Index(['userId'])
export class UserScope extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'cpl_id', type: 'uuid', nullable: true })
  cplId?: string; // If null, user has access to all CPLs in their channel

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string; // If null, user has access to all categories

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string; // Optional: can restrict to specific channel

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // Relations
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Cpl, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  cpl?: Cpl;

  // T-237 (migration 1808000000000): category_id — bugüne kadar FK'sız
  // (aynı tabloda cpl_id/tenant_id/user_id CASCADE FK taşıyor, category_id
  // hiç taşımıyordu — kök neden `1779000000000-CreateUserScopes.ts`'in FK
  // yazmayı atlaması). `ON DELETE RESTRICT`: ADR 0012'nin gerekçesi ("sessiz
  // destruction'ı tespit edilebilir bir hataya çevirir") + K-2.6.8a'nın kapsam
  // tarafı varsayılanı KISITLI (boş kapsam = erişim yok) — sessiz kayıp en
  // kötü sonuç, CASCADE tam onu üretirdi. `foreignKeyConstraintName`: bu
  // tablonun diğer üç FK'si okunabilir isim kullanıyor (hash değil,
  // `FK_user_scopes_cpl/tenant/user`); aynı konvansiyon burada da korunuyor
  // VE TypeORM'un hash türetmesini önleyerek migration:generate'in bu FK'yi
  // "yeniden adlandırma" olarak önermesini kapatıyor (katalogla adı da eşit).
  @ManyToOne(() => Category, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'category_id',
    foreignKeyConstraintName: 'FK_user_scopes_category',
  })
  category?: Category;
}
