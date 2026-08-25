/**
 * tenant-capability-boundary.e2e-spec.ts
 *
 * `B3 W2` göçü — `tenant.controller.ts`'in SEKİZ rotası `@Roles(ADMIN)` →
 * `@RequireCapability(TENANT_READ|TENANT_WRITE)` göçürüldü. `ROLE_CAPABILITIES`'te
 * ikisi de yalnız `UserRole.ADMIN`'de (`capabilities.ts:667-669`) — yani göç
 * öncesi/sonrası davranış birebir aynı olmalı: ADMIN geçer, ADMIN dışı HER rol 403.
 *
 * Şekil `admin-audit-capability-boundary.e2e-spec.ts` ile aynı (`CLAUDE.md
 * §2.7 #6`): İKİ GİRDİ / İKİ ÇIKTI — `403` tek başına kanıt değildir, reddin
 * CapabilityGuard'dan geldiği ancak `403` ALMAYAN bir kardeş (ADMIN → guard
 * geçiyor) yanında yazılıysa ayırt edilir.
 *
 * ⚠️ Yan etkili dört rota (`POST /tenants`, `PATCH/DELETE /tenants/:id`,
 * `POST /tenants/:id/activate|suspend`) `agreement-transaction-role-boundary`
 * numarasıyla yazıldı: izinli rol için de gövde/hedef KASTEN geçersiz —
 * guard geçsin, servis/ValidationPipe reddetsin (400/404), DB'ye HİÇBİR SATIR
 * YAZILMASIN.
 *
 * ⛔ VE KORUMA BU NUMARANIN KENDİSİDİR — `T-047` DEĞİL.
 * Ölçüldü (`W2` review): `T-047` **yedi** tablo sayıyor (`agreements` · `plans` ·
 * `plan_fus` · `plan_skus` · `approval_requests` · `admin_audit_logs` · `users`
 * — `test/helpers/e2e-row-count.js`), ve **`main.tenants` O LİSTEDE YOK.**
 * Yani bu numara bir gün bozulursa (biri gövdeyi geçerli yaparsa) `main.tenants`
 * büyürken `T-047` **yeşil kalır**. Sahip olmadığı bir korumayı `T-047`'ye
 * atfetmek `W1`'in `S-3` sınıfıydı — tekrarlanmıyor.
 *
 *   POST /tenants                → name 'x' (MinLength(3) ihlali) → ADMIN 400
 *   PATCH/DELETE /tenants/:id    → rastgele (var olmayan) UUID     → ADMIN 404
 *   POST /tenants/:id/activate   → rastgele (var olmayan) UUID     → ADMIN 404
 *   POST /tenants/:id/suspend    → rastgele (var olmayan) UUID     → ADMIN 404
 *
 * Salt-okunur üç rota (`GET /tenants`, `GET /tenants/:id`, `GET
 * /tenants/:id/stats`) doğrudan pinlenir — DB'ye zaten yazmıyorlar.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis findOne'da 404 üretir. Hiçbir satır yazılmaz/silinmez.
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W2 — tenant.controller yetenek sınırı {ADMIN}', () => {
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

  describe('GET /tenants (TENANT_READ)', () => {
    it('ADMIN → 200 (POZ.KONTROL — guard GEÇİYOR)', async () => {
      const res = await request(app.getHttpServer())
        .get('/tenants')
        .set(admin.authHeader());
      expect(res.status).toBe(200);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_READ yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get('/tenants')
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('GET /tenants/:id (TENANT_READ)', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard GEÇİYOR, servis 404 üretiyor)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_READ yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get(`/tenants/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('GET /tenants/:id/stats (TENANT_READ)', () => {
    it('ADMIN → guard GEÇİYOR (403 DEĞİL)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${NONEXISTENT_UUID}/stats`)
        .set(admin.authHeader());
      expect(res.status).not.toBe(403);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_READ yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get(`/tenants/${NONEXISTENT_UUID}/stats`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /tenants (TENANT_WRITE) — guard GEÇSİN, DTO REDDETSİN', () => {
    const INVALID_BODY = { name: 'x' }; // MinLength(3) ihlali

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/tenants')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/tenants')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /tenants/:id (TENANT_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tenants/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send({ name: 'Guard Boundary Test Tenant' });
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/tenants/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader())
          .send({ name: 'Guard Boundary Test Tenant' });
        expect(res.status).toBe(403);
      },
    );
  });

  describe('DELETE /tenants/:id (TENANT_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/tenants/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .delete(`/tenants/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /tenants/:id/activate (TENANT_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tenants/${NONEXISTENT_UUID}/activate`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/tenants/${NONEXISTENT_UUID}/activate`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /tenants/:id/suspend (TENANT_WRITE) — guard GEÇSİN, servis 404 üretsin', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tenants/${NONEXISTENT_UUID}/suspend`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/tenants/${NONEXISTENT_UUID}/suspend`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });
});
