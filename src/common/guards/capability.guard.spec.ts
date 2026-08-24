import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CapabilityGuard } from './capability.guard';
import { RequireCapability } from '../decorators/require-capability.decorator';
import { Roles } from '../decorators/roles.decorator';
import { CAPABILITIES } from '../authorization/capabilities';
import { UserRole } from '../../database/entities/user.entity';

/**
 * `B3 Dalga-M` — `CapabilityGuard` pinleri.
 *
 * ⚠️ `CapabilityGuard` bugün hiçbir gerçek controller'a takılı DEĞİL (`0`
 * rota göçtü). Bu yüzden fixture GERÇEK bir controller sınıfı taşımaz —
 * yalnız Nest'in `@SetMetadata` tabanlı dekoratörlerinin (`@RequireCapability`,
 * `@Roles`) reflect-metadata'ya yazdığı anahtarları taşıyan KÜÇÜK bir sınıf.
 *
 * `Reflector` GERÇEK (mock DEĞİL) — `getAllAndOverride` Nest'in kendi
 * metadata okuma mantığıdır; onu taklit etmek `§2.7`'nin "mock taklit
 * ettiği TİPE bağlanmalı" kuralını ihlal ederdi.
 *
 * `ROLE_CAPABILITIES` de GERÇEK haritadan okunur (import edilir, test
 * içinde yeniden yazılmaz) — `§2.7 #8`: kontrolün KOPYASI değil, kontrolün
 * KENDİSİ sınanır.
 */

class Fixture {
  // Bacak 1/2: haritalı rota. ADMIN_READ yalnız ADMIN'de var (PLANNER'da yok)
  // — fixture'ın iki tarafı FARKLI değer taşıyor (`§2.7 #6`).
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  mappedRoute() {}

  // Bacak 3: haritasız rota — hiçbir dekoratör yok. Bugünün `223` rotasının
  // çoğunun hâli budur (henüz `@RequireCapability`'ye göçmedi).
  unmappedRoute() {}

  // Bacak 3'ün bir varyantı: `@Roles` taşıyan ama `@RequireCapability`
  // TAŞIMAYAN rota — bugün `RolesGuard`'ın taşıdığı gerçek şekil.
  @Roles(UserRole.ADMIN)
  rolesOnlyRoute() {}

  // Rota başına tek mekanizma — çalışma zamanı savunması: İKİSİ BİRDEN.
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  @Roles(UserRole.ADMIN)
  dualMechanismRoute() {}
}

function buildContext(handler: () => void, user?: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Fixture,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('CapabilityGuard', () => {
  let guard: CapabilityGuard;

  beforeEach(() => {
    guard = new CapabilityGuard(new Reflector());
  });

  describe('bacak 1 — doğru capability', () => {
    it('rol o yeteneği ALIYORSA true döner (200)', () => {
      const ctx = buildContext(new Fixture().mappedRoute, {
        role: UserRole.ADMIN,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('bacak 2 — yanlış capability', () => {
    it('rol o yeteneği ALMIYORSA false döner (403)', () => {
      const ctx = buildContext(new Fixture().mappedRoute, {
        role: UserRole.PLANNER,
      });
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });

  describe('bacak 3 — haritasız rota, mevcut davranış DEĞİŞMEMELİ', () => {
    it('`@RequireCapability` taşımayan rotada true döner (RolesGuard’a bırakır)', () => {
      const ctx = buildContext(new Fixture().unmappedRoute, {
        role: UserRole.READONLY,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('`@Roles` taşıyan ama `@RequireCapability` taşımayan rotada da true döner', () => {
      const ctx = buildContext(new Fixture().rolesOnlyRoute, {
        role: UserRole.PLANNER,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('kullanıcı yokken de haritasız rotada true döner (bu guard’ın konusu değil)', () => {
      const ctx = buildContext(new Fixture().unmappedRoute, undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('rota başına tek mekanizma — çalışma zamanı savunması', () => {
    it('hem `@Roles` hem `@RequireCapability` taşıyan rotada FAIL-CLOSED (false)', () => {
      const ctx = buildContext(new Fixture().dualMechanismRoute, {
        role: UserRole.ADMIN,
      });
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });

  describe('§2.5 — sessiz sıfır yasağı', () => {
    it('`user` yoksa false döner (fail-closed)', () => {
      const ctx = buildContext(new Fixture().mappedRoute, undefined);
      expect(guard.canActivate(ctx)).toBe(false);
    });

    it('bilinmeyen/eksik rol false döner, boş liste sayılmaz', () => {
      const ctx = buildContext(new Fixture().mappedRoute, {
        role: 'NOT_A_REAL_ROLE',
      });
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });
});
