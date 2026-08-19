import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User, UserRole } from './user.entity';
import { Cpl } from './cpl.entity';
import { Category } from './category.entity';

/**
 * T-241 — roller: bir kullanıcı bu rollerden BİRİYLE yaratıldığında, kapsam
 * satırı her zaman JOKER olarak yazılır ({cplId: null, categoryId: null}) —
 * çağıran bir `scope` GÖNDERSE bile yok sayılır (yaratma HER ZAMAN ≥1 kapsam
 * satırı bırakır, K-2.6.8a). Diğer roller (PLANNER, CATEGORY_MANAGER) çağrıda
 * AÇIK kapsam vermek ZORUNDADIR — yoksa `POST /users` 400 döner (T-241 karar
 * (b), `.claude/backlog/tasks/T-241.md`).
 *
 * Kaynak: `src/database/seeds/user-scope.seed.ts`'in aynı adlı sabitiyle
 * BİREBİR aynı olmalı — tek kaynak burası, seed BURADAN import eder.
 * `user.service.ts#create` da BURADAN import eder (iki yazma yolu, tek
 * liste).
 *
 * ⚠️ `AccessScopeService.UNRESTRICTED_ROLES` (yalnız ADMIN+FINANCE) İLE
 * KARIŞTIRILMAMALI: bu sabit YAZMA tarafı (hangi rol joker SATIR alır), o
 * sabit OKUMA/karar tarafı (hangi rol kod dalıyla, satırsız bile,
 * UNRESTRICTED sayılır). READONLY burada var (satır alır) ama orada yok
 * (T-235 ADIM 2 — artık satırdan geliyor, kod dalından değil).
 */
export const WILDCARD_SCOPE_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.ADMIN,
  UserRole.FINANCE,
  UserRole.READONLY,
]);

/**
 * T-241 — roller: bu rollerde bir kullanıcı yaratılırken çağıran AÇIK bir
 * `scope` (≥1 çift) vermek ZORUNDADIR; boş/eksikse `POST /users` 400 döner.
 * `WILDCARD_SCOPE_ROLES`'un tümleyeni (bugünkü `UserRole` kümesinde) — bir
 * rol ikisinde birden olamaz, ikisinde de olmayan bir rol de olamaz (ADIM 3
 * yeni bir rol eklerse bu iki sabit BİRLİKTE güncellenmeli).
 */
export const SCOPE_REQUIRED_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.PLANNER,
  UserRole.CATEGORY_MANAGER,
]);

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
  cplId?: string; // If null, user has access to all CPLs

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string; // If null, user has access to all categories

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
