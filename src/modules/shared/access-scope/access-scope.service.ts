import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { UserScope } from '../../../database/entities/user-scope.entity';
import { UserRole } from '../../../database/entities/user.entity';

/**
 * T-028b — AccessScopeService
 *
 * Tek çıkış noktası: scope mantığı elle üçüncü kez yazılmayacak
 * (docs/analysis/0004-rbac-brd-alignment.md §4/§7 — "R-1 scope
 * düzleştirme" bağlayıcı koşul). Dashboard (`dashboard.service.ts
 * #resolveCplScope`) ve settlement-summary (`settlement-summary.service.ts`)
 * bugünkü ad-hoc kopyaları BU servise refactor edilecek (T-028d, F6 fix
 * dahil) — bu task (T-028b) yalnızca servisi kurar + CM plan enforcement'ı
 * için kullanır; PLANNER enforcement T-028c'nin işi.
 *
 * Sözleşme (docs/analysis/0004 §4):
 *   resolveScope(tenantId, userId, role)        -> EffectiveScope
 *   assertEntityInScope(scope, {cplId,categoryId}) -> void (403)
 *   isInScope(scope, {cplId,categoryId})           -> boolean (404 kararı çağıran yerde)
 *   applyToQueryBuilder(qb, alias, scope)          -> OR-grubu WHERE eklenir
 *
 * BAĞLAYICI KURALLAR:
 *   R-1 — pair semantiği, cplIds[] x categoryIds[] DÜZLEŞTİRME YASAK. Her
 *         UserScope satırı kendi (cplId, categoryId) çiftini taşır; predicate
 *         satır-bazlı OR: OR_i( (cplId_i IS NULL OR e.cplId=cplId_i) AND
 *         (categoryId_i IS NULL OR e.categoryId=categoryId_i) ).
 *   R-2 — fail-closed. pairs.length===0 → applyToQueryBuilder '1=0' üretir,
 *         isInScope false döner. Scope satırı olmayan kullanıcı hiçbir şey
 *         görmez (deny-by-default).
 *   NULL = "hepsi" (user-scope.entity.ts:22). Tek satır {cplId:null,
 *         categoryId:null} → UNRESTRICTED (F6 latent-bug fix: eskiden
 *         dashboard.service.ts'de `.filter(id=>!!id)` bunu sessizce
 *         "hiçbiri"ye çeviriyordu — bu servis NULL'ı doğru "hepsi" olarak
 *         yorumlar).
 *   Rol semantiği TEK yerde (burada): ADMIN/FINANCE_MANAGER/READONLY ->
 *         UNRESTRICTED (BRD: bu roller kategori/CPL scope'una tabi değil) ·
 *         PLANNER -> cpl+category pair (ikisi de kullanılır) ·
 *         CATEGORY_MANAGER -> yalnız category boyutu, cplId satırdan
 *         gelse bile normalize edilip null'a düşürülür (BRD: "kategori
 *         sahibi, kanaldan bağımsız").
 *   tenantId ZORUNLU — her UserScope sorgusu tenantId ile filtrelenir.
 *   Perf: request başına 1 sorgu + kısa TTL (5sn) in-memory cache. Bilinçli
 *   olarak Scope.REQUEST KULLANILMADI (tüm DI zincirini request-scoped
 *   yapıp performans/karmaşıklık maliyeti getirir); servis singleton, cache
 *   key = tenantId:userId:role, kısa TTL rol/scope değişikliğinin makul
 *   sürede yansımasını sağlar.
 *   Guard değil SERVİS — enforcement noktaları (controller/service) DTO'ya
 *   göre heterojen; RolesGuard yalnızca kaba rol filtresi yapmaya devam
 *   eder, entity-seviyesi scope kararı bu serviste.
 */

export interface ScopePair {
  cplId: string | null;
  categoryId: string | null;
}

export type EffectiveScope =
  | { kind: 'UNRESTRICTED' }
  | { kind: 'SCOPED'; pairs: ScopePair[] };

export interface ScopableEntity {
  cplId?: string | null;
  categoryId?: string | null;
}

/** Roller: her zaman tüm tenant görür (kategori/CPL scope'una tabi değil). */
const UNRESTRICTED_ROLES = new Set<UserRole>([
  UserRole.ADMIN,
  UserRole.FINANCE_MANAGER,
  UserRole.READONLY,
]);

const CACHE_TTL_MS = 5000;

@Injectable()
export class AccessScopeService {
  private readonly logger = new Logger(AccessScopeService.name);
  private readonly cache = new Map<
    string,
    { value: EffectiveScope; expiresAt: number }
  >();

  constructor(
    @InjectRepository(UserScope)
    private readonly userScopeRepo: Repository<UserScope>,
  ) {}

  /**
   * Resolves the caller's effective scope. tenantId is mandatory (multi-tenant
   * isolation — never resolve scope without it).
   */
  async resolveScope(
    tenantId: string,
    userId: string,
    role: UserRole,
  ): Promise<EffectiveScope> {
    if (!tenantId) {
      throw new Error('AccessScopeService.resolveScope: tenantId is required');
    }
    if (!userId) {
      throw new Error('AccessScopeService.resolveScope: userId is required');
    }

    if (UNRESTRICTED_ROLES.has(role)) {
      return { kind: 'UNRESTRICTED' };
    }

    const cacheKey = `${tenantId}:${userId}:${role}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // tenantId WHERE zorunlu — cross-tenant scope sızıntısını engeller.
    const rows = await this.userScopeRepo.find({
      where: { tenantId, userId, isActive: true },
    });

    const scope = this.buildScope(role, rows);
    this.cache.set(cacheKey, {
      value: scope,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return scope;
  }

  private buildScope(role: UserRole, rows: UserScope[]): EffectiveScope {
    if (rows.length === 0) {
      // R-2 fail-closed: scope satırı yok => hiçbir şey.
      return { kind: 'SCOPED', pairs: [] };
    }

    // NULL = "hepsi": tek satır {cplId:null, categoryId:null} => UNRESTRICTED.
    const hasUnrestrictedRow = rows.some(
      (r) => (r.cplId ?? null) === null && (r.categoryId ?? null) === null,
    );
    if (hasUnrestrictedRow) {
      return { kind: 'UNRESTRICTED' };
    }

    const pairs: ScopePair[] = rows.map((r) => {
      if (role === UserRole.CATEGORY_MANAGER) {
        // CM: yalnız kategori boyutu — kanal/CPL'den bağımsız kategori sahibi.
        return { cplId: null, categoryId: r.categoryId ?? null };
      }
      // PLANNER (ve gelecekte scope kullanan diğer roller): satır-bazlı pair,
      // DÜZLEŞTİRME YOK (R-1).
      return { cplId: r.cplId ?? null, categoryId: r.categoryId ?? null };
    });

    return { kind: 'SCOPED', pairs };
  }

  /**
   * 403 kararı — yazma/onay işlemleri (approve/reject vb.) için.
   */
  assertEntityInScope(scope: EffectiveScope, entity: ScopableEntity): void {
    if (!this.isInScope(scope, entity)) {
      throw new ForbiddenException(
        'Access denied: entity is outside your authorized scope',
      );
    }
  }

  /**
   * 404 kararı — okuma işlemleri (varlık sızdırmama) için boolean döner.
   */
  isInScope(scope: EffectiveScope, entity: ScopableEntity): boolean {
    if (scope.kind === 'UNRESTRICTED') {
      return true;
    }
    if (scope.pairs.length === 0) {
      return false; // R-2 fail-closed
    }
    const entityCplId = entity.cplId ?? null;
    const entityCategoryId = entity.categoryId ?? null;

    return scope.pairs.some((pair) => {
      const cplOk = pair.cplId === null || pair.cplId === entityCplId;
      const categoryOk =
        pair.categoryId === null || pair.categoryId === entityCategoryId;
      return cplOk && categoryOk;
    });
  }

  /**
   * QueryBuilder'a scope kısıtını OR-grubu olarak ekler. Çağıran, kendi
   * tenantId filtresini (WHERE alias.tenantId = :tenantId) ÖNCEDEN eklemiş
   * olmalı — bu metod tenant filtresi eklemez, yalnızca cpl/category
   * kısıtını uygular.
   *
   * alias.cplId / alias.categoryId property adları (TypeORM camelCase) hedef
   * entity'de mevcut olmalı (örn. Plan.cplId / Plan.categoryId).
   */
  applyToQueryBuilder<T extends object>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    scope: EffectiveScope,
  ): void {
    if (scope.kind === 'UNRESTRICTED') {
      return;
    }
    if (scope.pairs.length === 0) {
      // R-2 fail-closed
      qb.andWhere('1=0');
      return;
    }

    qb.andWhere(
      new Brackets((qbInner) => {
        scope.pairs.forEach((pair, idx) => {
          const conditions: string[] = [];
          const params: Record<string, string> = {};

          if (pair.cplId !== null) {
            const paramName = `scopeCpl${idx}`;
            conditions.push(`${alias}.cplId = :${paramName}`);
            params[paramName] = pair.cplId;
          }
          if (pair.categoryId !== null) {
            const paramName = `scopeCat${idx}`;
            conditions.push(`${alias}.categoryId = :${paramName}`);
            params[paramName] = pair.categoryId;
          }

          const clause =
            conditions.length > 0 ? conditions.join(' AND ') : '1=1';
          if (idx === 0) {
            qbInner.where(clause, params);
          } else {
            qbInner.orWhere(clause, params);
          }
        });
      }),
    );
  }

  /** Test/ops yardımcı: cache'i temizler (rol/scope değişikliği sonrası). */
  clearCache(): void {
    this.cache.clear();
  }
}
