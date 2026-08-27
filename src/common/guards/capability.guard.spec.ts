import { ExecutionContext, UseGuards, CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CapabilityGuard } from './capability.guard';
import { RequireCapability } from '../decorators/require-capability.decorator';
import { Roles } from '../decorators/roles.decorator';
import { Public } from '../decorators/public.decorator';
import { SelfScoped } from '../decorators/self-scoped.decorator';
import { CAPABILITIES } from '../authorization/capabilities';
import { UserRole } from '../../database/entities/user.entity';

/**
 * `Z44` keskinleştirme-1 pinleri — TANINAN domain-guard İSİM-TABANLI
 * tanınır, sınıf REFERANSI ile DEĞİL (`capability.guard.ts` dosya başı
 * yorumu: `common/` katmanı feature guard'ları ithal ETMEZ). Bu yüzden
 * fixture'lar GERÇEK `SettlementGuard`/`ReversalGuard`'ı import ETMEZ —
 * yalnız AYNI ADI taşıyan sahte sınıflar tanımlar. `FakeUnknownGuard` ise
 * KNOWN_DOMAIN_GUARD_NAMES'te OLMAYAN bir isim taşır (negatif kontrol).
 */
class SettlementGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
class FakeUnknownGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/**
 * `B4` `A′` (`Z44 §2/§7`) — `CapabilityGuard` **default-deny** pinleri.
 *
 * ⚠️ Fixture GERÇEK bir controller sınıfı taşımaz — yalnız Nest'in
 * `@SetMetadata` tabanlı dekoratörlerinin (`@RequireCapability`, `@Roles`,
 * `@Public`, `@SelfScoped`) reflect-metadata'ya yazdığı anahtarları taşıyan
 * KÜÇÜK bir sınıf. `unmappedRoute` bugün **hiçbir gerçek rotanın** karşılığı
 * DEĞİL (`Z44 §5`: bugün yetenek-yok∧`@Roles`-yok∧`@Public`-yok∧`@SelfScoped`
 * -yok sınıfında gerçek bir rota YOK) — bu yüzden **SENTETİKTİR**
 * (`§2.7 #4`: ölçülmek istenen durum mevcut değil, o yüzden üretilir).
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

  // ⛔ SENTETİK — `Z44 §5`: hiçbir dekoratör yok. `default-deny`'ın KENDİSİNİ
  // sınayan tek yol budur; bugün bu sınıfta gerçek bir rota yok.
  unmappedRoute() {}

  // `@Roles` taşıyan ama `@RequireCapability` TAŞIMAYAN rota — kalan-`@Roles`
  // kovasının bugünkü gerçek şekli. MUAFİYET: `RolesGuard`'a bırakılır.
  @Roles(UserRole.ADMIN)
  rolesOnlyRoute() {}

  // `@Public()` — kimliksiz açık uç (login/refresh/health ailesi).
  @Public()
  publicRoute() {}

  // `@SelfScoped()` — "kayıt benim mi" yüklemi, rol kümesine bağlı değil.
  @SelfScoped()
  selfScopedRoute() {}

  // TANINAN DOMAIN-GUARD — `SettlementGuard` İSMİYLE tanınır
  // (`KNOWN_DOMAIN_GUARD_NAMES`); ne yetenek ne `@Roles` taşımaz, erişimi
  // yalnız bu guard zorlar (bugünkü `close/:agreementId` şekli).
  @UseGuards(SettlementGuard)
  domainGuardedRoute() {}

  // NEGATİF KONTROL — TANINMAYAN bir guard adı MUAFİYET üretmemeli;
  // yetenek/`@Roles`/`@Public`/`@SelfScoped` yoksa hâlâ DEFAULT-DENY.
  @UseGuards(FakeUnknownGuard)
  unknownGuardedRoute() {}

  // Rota başına tek mekanizma — çalışma zamanı savunması: İKİSİ BİRDEN.
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  @Roles(UserRole.ADMIN)
  dualMechanismRoute() {}

  // ⛔ `A-prime` review `B1` PİNİ — YETENEK **VE** TANINAN DOMAIN-GUARD.
  // İlk yazımda domain-guard muafiyeti `required` kontrolünün ÖNÜNDEYDİ ve
  // bu rota `READONLY` ile bile `true` dönüyordu (yetenek kontrolü ATLANIYOR).
  // Statik taraf ise onu `CAPABILITY` kovasında sayıyordu ⇒ İKİ TARAF ZIT
  // SIRALI, `İlke-4`. Düzeltme: muafiyet `!required` dalının İÇİNE alındı.
  // ⇒ YETENEK BAĞLAR.
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  @UseGuards(SettlementGuard)
  capabilityPlusDomainGuardRoute() {}
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

  describe('⛔ DEFAULT-DENY — SENTETİK rota (`Z44 §5`, bugün gerçek karşılığı YOK)', () => {
    it('yetenek YOK ∧ `@Roles` YOK ∧ `@Public` YOK ∧ `@SelfScoped` YOK → false (403)', () => {
      const ctx = buildContext(new Fixture().unmappedRoute, {
        role: UserRole.READONLY,
      });
      expect(guard.canActivate(ctx)).toBe(false);
    });

    it('kullanıcı yokken de false döner (fail-closed, default-deny altında iki kat)', () => {
      const ctx = buildContext(new Fixture().unmappedRoute, undefined);
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });

  describe('MUAFİYET — `@Roles` taşıyan rota, TÜRETİLMİŞ evrenden (elle liste DEĞİL)', () => {
    it('yetenek YOK ∧ `@Roles` VAR → true (kontrol RolesGuard’a bırakılır)', () => {
      const ctx = buildContext(new Fixture().rolesOnlyRoute, {
        role: UserRole.PLANNER,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('`@Roles` muafiyeti kullanıcısız istekte de true döner (RolesGuard karar verecek)', () => {
      const ctx = buildContext(new Fixture().rolesOnlyRoute, undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('`@Public()` — kimliksiz açık uç', () => {
    it('kullanıcı yokken bile true döner', () => {
      const ctx = buildContext(new Fixture().publicRoute, undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('`@SelfScoped()` — "kayıt benim mi" yüklemi', () => {
    it('kimliklenmiş her kullanıcı için true döner (rol kümesine bağlı değil)', () => {
      const ctx = buildContext(new Fixture().selfScopedRoute, {
        role: UserRole.READONLY,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('TANINAN DOMAIN-GUARD — `Z44` keskinleştirme-1 (settlement/close vakası)', () => {
    it("rota tanınan bir domain-guard taşıyorsa true döner (default-deny'a kesilmez)", () => {
      const ctx = buildContext(new Fixture().domainGuardedRoute, {
        role: UserRole.READONLY,
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('yetenek VE tanınan domain-guard birlikteyse YETENEK BAĞLAR — muafiyet ÖNE GEÇMEZ (review B1)', () => {
      const yetkili = buildContext(
        new Fixture().capabilityPlusDomainGuardRoute,
        { role: UserRole.ADMIN },
      );
      const yetkisiz = buildContext(
        new Fixture().capabilityPlusDomainGuardRoute,
        { role: UserRole.READONLY },
      );
      // AYIRT EDİCİ: muafiyet öne geçseydi İKİSİ DE true olurdu.
      expect(guard.canActivate(yetkili)).toBe(true);
      expect(guard.canActivate(yetkisiz)).toBe(false);
    });

    it("kullanıcısız istekte de true döner (kontrol domain-guard'ın kendisine bırakılır)", () => {
      const ctx = buildContext(new Fixture().domainGuardedRoute, undefined);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('NEGATİF KONTROL — TANINMAYAN bir guard adı muafiyet ÜRETMEZ, hâlâ default-deny (false)', () => {
      const ctx = buildContext(new Fixture().unknownGuardedRoute, {
        role: UserRole.READONLY,
      });
      expect(guard.canActivate(ctx)).toBe(false);
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
