/**
 * user-capability-boundary.e2e-spec.ts
 *
 * `B3 W3` göçü — `user.controller.ts`'in SEKİZ rotası `@Roles(ADMIN)` →
 * `@RequireCapability(USER_WRITE|USER_MANAGE)` göçürüldü. `ROLE_CAPABILITIES`'te
 * ikisi de yalnız `UserRole.ADMIN`'de (`capabilities.ts:672-673`) — yani göç
 * öncesi/sonrası davranış birebir aynı olmalı: ADMIN geçer, ADMIN dışı HER rol 403.
 *
 * Şekil `tenant-capability-boundary.e2e-spec.ts` ile aynı (`CLAUDE.md §2.7 #6`):
 * İKİ GİRDİ / İKİ ÇIKTI — `403` tek başına kanıt değildir, reddin
 * CapabilityGuard'dan geldiği ancak `403` ALMAYAN bir kardeş (ADMIN → guard
 * geçiyor) yanında yazılıysa ayırt edilir.
 *
 * ⛔ `GET /users` (`@Roles(ADMIN, FINANCE)`) BU DOSYANIN KAPSAMI DIŞINDA —
 * göçMEDİ (`user.controller.ts`'teki `B3 W3` yorumuna bkz.: göçürmek
 * `ROLE_CAPABILITIES`'in `USER_WRITE`/`USER_MANAGE`'i yalnız `{ADMIN}` taşıdığı
 * için FINANCE'ı düşürürdü — `Z20` daraltması, bu dalganın işi değil).
 * `@SelfScoped()` uçlar (`me` ailesi) de kapsam dışı — rol değil kimlik gerektirir.
 *
 * ⚠️ Yan etkili rotalar (`POST /users`, `PATCH /users/:id`,
 * `PATCH /users/:id/scope`, `PATCH /users/:id/password`,
 * `POST /users/:id/activate`, `POST /users/:id/deactivate`,
 * `DELETE /users/:id`) `tenant-capability-boundary`/`agreement-transaction-
 * role-boundary` numarasıyla yazıldı: izinli rol için de gövde/hedef KASTEN
 * geçersiz/yok — guard geçsin, servis/ValidationPipe reddetsin (400/404),
 * DB'ye HİÇBİR SATIR YAZILMASIN/DEĞİŞTİRİLMESİN.
 *
 * ⛔ VE KORUMA BU NUMARANIN KENDİSİDİR — `T-047` DEĞİL.
 * `T-047` (`test/helpers/e2e-row-count.js`) **yedi** tablo sayıyor (`agreements` ·
 * `plans` · `plan_fus` · `plan_skus` · `approval_requests` · `admin_audit_logs` ·
 * `users`) — `main.users` O LİSTEDE VAR, ama bu dosyanın koruması onun ÜZERİNE
 * KURULMADI: aşağıdaki her yazma yolu nonexistent UUID'ye ya da geçersiz DTO'ya
 * hedeflenmiş, yani ADMIN dahil hiçbir çağrı bir satır yazmaz/değiştirmez —
 * `T-047`'nin görüp görmeyeceği ayrı bir soru, burada test edilen şey guard'ın
 * kendisi.
 *
 *   POST /users                  → {} (email/password/fullName/role eksik) → ADMIN 400
 *   PATCH /users/:id              → {} (boş, PartialType) + nonexistent UUID → ADMIN 404
 *   PATCH /users/:id/scope        → geçerli REVOKE_ALL gövdesi + nonexistent UUID → ADMIN 404
 *   PATCH /users/:id/password     → geçerli ChangePasswordDto + nonexistent UUID → ADMIN 404
 *   POST /users/:id/activate      → nonexistent UUID → ADMIN 404
 *   POST /users/:id/deactivate    → nonexistent UUID → ADMIN 404
 *   DELETE /users/:id             → nonexistent UUID → ADMIN 404
 *
 * Salt-okunur bir rota (`GET /users/:id`) doğrudan pinlenir — DB'ye zaten
 * yazmıyor, nonexistent UUID → 404.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis findOne'da 404 üretir. Hiçbir satır yazılmaz/silinmez.
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W3 — user.controller yetenek sınırı {ADMIN}', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let finance: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

  const OTHER_ROLES: Array<[string, () => LoginResult]> = [
    ['PLANNER', () => planner],
    ['FINANCE', () => finance],
    ['CATEGORY_MANAGER', () => categoryManager],
    ['READONLY', () => readonly],
  ];

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    planner = await loginAs(app, 'PLANNER');
    finance = await loginAs(app, 'FINANCE');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  describe('POST /users (USER_WRITE) — guard GEÇSİN, DTO REDDETSİN', () => {
    const INVALID_BODY = {}; // email/password/fullName/role hepsi zorunlu, eksik

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/users')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('GET /users/:id (USER_MANAGE)', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard GEÇİYOR, servis 404 üretiyor)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/users/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_MANAGE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get(`/users/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /users/:id (USER_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send({});
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/users/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader())
          .send({});
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /users/:id/scope (USER_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    // Geçerli DTO şekli (REVOKE_ALL + reason) — guard'ın önündeki ValidationPipe'ı
    // geçmesi için, ama hedef kullanıcı yok olduğundan findOne 404 üretir.
    const VALID_SHAPE_BODY = {
      intent: 'REVOKE_ALL',
      scope: [],
      reason: 'B3 W3 pin — hedef kullanıcı yok, satır yazılmaz',
    };

    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${NONEXISTENT_UUID}/scope`)
        .set(admin.authHeader())
        .send(VALID_SHAPE_BODY);
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/users/${NONEXISTENT_UUID}/scope`)
          .set(getUser().authHeader())
          .send(VALID_SHAPE_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /users/:id/password (USER_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    const VALID_SHAPE_BODY = {
      currentPassword: 'DoesNotMatter123!',
      newPassword: 'NewPassword123!',
    };

    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${NONEXISTENT_UUID}/password`)
        .set(admin.authHeader())
        .send(VALID_SHAPE_BODY);
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/users/${NONEXISTENT_UUID}/password`)
          .set(getUser().authHeader())
          .send(VALID_SHAPE_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /users/:id/activate (USER_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${NONEXISTENT_UUID}/activate`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/users/${NONEXISTENT_UUID}/activate`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /users/:id/deactivate (USER_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${NONEXISTENT_UUID}/deactivate`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/users/${NONEXISTENT_UUID}/deactivate`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('DELETE /users/:id (USER_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/users/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (USER_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .delete(`/users/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });
});
