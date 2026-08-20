/**
 * current-user.decorator.spec.ts
 *
 * T-256 regresyon pini (birim katmanı).
 *
 * ⚠️ Bu dosya kontrolün İKİNCİ BİR KOPYASINI çalıştırmaz (CLAUDE.md §2.7 #8):
 * `CurrentUser` dekoratörünün `createParamDecorator`'a verdiği fabrikanın
 * TA KENDİSİ (`currentUserFactory`) çağrılır. Dekoratörün kendisi Nest'in
 * çalışma zamanı olmadan çağrılamaz; e2e katmanı (`test/
 * approval-current-user.e2e-spec.ts`) tam yolu HTTP üzerinden pinler.
 */

import { ExecutionContext } from '@nestjs/common';
import {
  currentUserFactory,
  AuthenticatedUser,
} from './current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';

/** JwtStrategy.validate'in ÖLÇÜLMÜŞ çıktı şekli (bkz. dekoratör JSDoc'u). */
const USER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'planner@wella.com',
  role: UserRole.PLANNER,
  tenantId: '22222222-2222-4222-8222-222222222222',
};

function ctxWith(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('currentUserFactory (T-256)', () => {
  describe("argümanlı — @CurrentUser('id')", () => {
    it("'id' verildiğinde OBJE değil, string id döner", () => {
      const out = currentUserFactory('id', ctxWith(USER));

      // ⚠️ Ayırt edici assertion: kusurlu sürüm `request.user` objesini
      // dönüyordu ve `toBe(USER.id)` o sürümde KIRMIZI verir.
      expect(out).toBe(USER.id);
      expect(typeof out).toBe('string');
      expect(out).not.toBe(USER);
    });

    it("'tenantId' / 'email' / 'role' de alan bazında çözülür", () => {
      expect(currentUserFactory('tenantId', ctxWith(USER))).toBe(USER.tenantId);
      expect(currentUserFactory('email', ctxWith(USER))).toBe(USER.email);
      expect(currentUserFactory('role', ctxWith(USER))).toBe(UserRole.PLANNER);
    });

    it('kullanıcı YOKSA sessizce undefined DÖNMEZ — açık hata (§2.5)', () => {
      expect(() => currentUserFactory('id', ctxWith(undefined))).toThrow(
        /çözülemiyor/,
      );
    });

    it('alan YOKSA sessizce undefined DÖNMEZ — açık hata (§2.5)', () => {
      // JwtStrategy sözleşmesi bozulursa (ör. `id` düşerse) sessiz bir
      // `undefined` self-approval korumasını YİNE fail-open bırakırdı —
      // `requestedById === undefined` hiçbir zaman true olmaz.
      const broken = { sub: USER.sub, email: USER.email } as unknown;
      expect(() => currentUserFactory('id', ctxWith(broken))).toThrow(
        /JwtStrategy/,
      );
    });
  });

  describe('argümansız — @CurrentUser() (REGRESYON: davranış değişmemeli)', () => {
    it('tüm request.user objesini aynen döner', () => {
      expect(currentUserFactory(undefined, ctxWith(USER))).toBe(USER);
    });

    it('kullanıcı yoksa undefined döner — fırlatmaz (eski davranış korunur)', () => {
      expect(currentUserFactory(undefined, ctxWith(undefined))).toBeUndefined();
    });
  });
});
