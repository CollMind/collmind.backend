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
 * T-244 — `docs/process/DENETIM_SOZLUGU.md` `Madde 1`'in İKİ olay türü, TEK
 * kaynaktan. `[[T-244]]` (yaratma anı — eski küme HER ZAMAN `∅`) ve
 * `[[T-242a]]` (güncelleme/boşaltma) BURADAN okur; sözlüğün "üçüncü tür
 * AÇILMAZ" kararı (`Z16`) bu sabiti PAYLAŞARAK korunuyor — iki tür kendi
 * dosyasında ayrı ayrı tanımlansaydı bir sonraki yazan üçüncü bir tür
 * ekleyebilirdi.
 *
 * `SCOPE_UPDATE`: hedef küme boş DEĞİL (yaratmada eski küme `∅`, güncellemede
 * eski küme önceki satırlar).
 * `SCOPE_REVOKE_ALL`: kapsam tümüyle boşaltıldı — `K-2.6.8a` gereği boş
 * kapsam erişim YOK demektir, yani bu bir güncelleme değil bir erişim
 * kaldırmadır (Madde 1, ayrım ekseni "hedef küme boşalıyor mu").
 *
 * m2 (`Z17`): bu değer, `AdminAuditService.logAdminAction`'ın `actionType`
 * ("ne") argümanına GİDER — ayrı bir "niyet" kolonu YOK. Uç tarafındaki
 * `intent: UPDATE | REVOKE_ALL` (T-242a'nın DTO'su) girdi doğrulaması
 * içindir; kayıt tarafında ikinci bir kolon hiçbir bilgi taşımazdı (iki tür
 * zaten iki değer — `İlke 1`).
 */
export enum ScopeAuditActionType {
  SCOPE_UPDATE = 'SCOPE_UPDATE',
  SCOPE_REVOKE_ALL = 'SCOPE_REVOKE_ALL',
}

/**
 * `AdminAuditService.logAdminAction`'ın `entityType` alanı — `'user'`
 * (`DENETIM_SOZLUGU.md` `Madde 1` `Z17`, kod: `m1`).
 *
 * ⚠️ ÖNCEDEN `'user_scope'`'tu — DÜZELTİLDİ (code-review, T-244, `Z17`):
 * repodaki 16 `logAdminAction` üreticisinin 16'sında `entityId`,
 * `entityType`'ın ADLANDIRDIĞI TABLONUN id'sidir (`'AGREEMENT'` →
 * `agreements.id`, `'mechanic'` → `mechanics.id`, ...). `'user_scope'` bu
 * kalıbın TEK istisnasıydı ve ölçüldü: `entityId` hiçbir zaman bir
 * `user_scopes.id` DEĞİL — her zaman ETKİLENEN KULLANICININ id'si, yani
 * `JOIN user_scopes ON id = entity_id` HER ZAMAN 0 satır dönerdi.
 *
 * Olay, kullanıcının KAPSAMININ değişmesidir — bir kapsam SATIRININ değil.
 * `replace` semantiğinde hedef bir küme, kümenin sahibi kullanıcı. Kapsam
 * kümesinin kendisi `before_values`/`after_values`'ta yaşar (Madde 1:
 * *"eski küme → yeni küme"*) — `entityType`'ın onu taşımasına gerek yok.
 *
 * Bir çağrı birden çok `user_scopes` satırı yazabilir/siler; denetim kaydı
 * bunu tek bir olay (bir kullanıcı, bir küme değişimi) olarak taşır.
 */
export const SCOPE_AUDIT_ENTITY_TYPE = 'user';

/** Bir kapsam denetim kaydının `before_values`/`after_values.scope`'unda taşınan çift. */
export interface ScopeAuditPair {
  cplId: string | null;
  categoryId: string | null;
}

/**
 * m3 (code-review, T-244): `[{A},{B}]` ile `[{B},{A}]` AYNI KÜME ama iki
 * farklı JSON üretir. Bugün etkisiz (T-244'ün `before_values.scope` her
 * zaman `[]` — yaratma anı) ama biçim BURADA donuyor: `[[T-242a]]` bir
 * `before`↔`after` KARŞILAŞTIRMASI yapacak (hiçbir şey değişmedi mi?) ve
 * kanonik sıralama olmadan aynı küme farklı sırayla yazılıp gelirse
 * "değişti" görünür.
 *
 * `cplId`, sonra `categoryId`'ye göre, `NULL` önce (Postgres `NULLS FIRST`
 * ile aynı sözleşme — joker satır `{null,null}` her zaman ilk sırada).
 */
export function sortScopeAuditPairsCanonically<T extends ScopeAuditPair>(
  pairs: readonly T[],
): T[] {
  const compareNullableUuid = (a: string | null, b: string | null): number => {
    if (a === b) {
      return 0;
    }
    if (a === null) {
      return -1;
    }
    if (b === null) {
      return 1;
    }
    return a < b ? -1 : 1;
  };

  return [...pairs].sort((x, y) => {
    const cplCmp = compareNullableUuid(x.cplId, y.cplId);
    if (cplCmp !== 0) {
      return cplCmp;
    }
    return compareNullableUuid(x.categoryId, y.categoryId);
  });
}

// ⚠️ [[T-245]] (migration 1810000000000): `UNIQUE NULLS NOT DISTINCT (user_id,
// cpl_id, category_id)` TypeORM `@Index` dekoratörüyle ifade EDİLEMEZ —
// `UQ_user_scopes_user_cpl_category` migration'da ham SQL ile kurulur.
// Entity bu index'i BİLEREK TANIMLAMAZ (aksi hâlde `migration:generate`
// standart bir düz UNIQUE INDEX önerir ve `NULLS NOT DISTINCT` klozunu
// kaybettirirdi — `T-101` dersi). Aynı desen: `budget-policy.entity.ts`
// (`UQ_budget_policies_tenant_channel_category`, `K-2.2.8b`).
//
// Önceki hâl (`@Index(['userId','cplId','categoryId'], {unique:true})`) düz
// bir UNIQUE'di ve PostgreSQL'de NULL'lar birbirinden AYRI sayıldığı için
// `(user_id, cpl_id, NULL)` gibi çiftlerde HİÇ ateşlemiyordu — `R1`/`A5`
// gereği `CATEGORY_MANAGER`/`PLANNER` çiftlerinin ezici çoğunluğu bu şekilde.

/**
 * User Scope Entity
 *
 * Maps users to their authorized CPLs and Categories
 * Rule: Planner → sadece yetkili CPL + Category görür
 */
@Entity({ name: 'user_scopes', schema: 'main' })
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
