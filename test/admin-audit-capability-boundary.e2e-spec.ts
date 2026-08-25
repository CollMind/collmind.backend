/**
 * admin-audit-capability-boundary.e2e-spec.ts
 *
 * `B3 W1` göçü (2026-08-25) — `admin/audit-log` ve `admin/audit-log/high-risk`
 * `@Roles(ADMIN)` → `@RequireCapability(ADMIN_READ)` göçürüldü
 * (`admin-audit.controller.ts`). Göç yorumu davranışın korunduğunu iddia
 * ediyordu ama iddia yalnız kod yorumunda yaşıyordu — hiçbir test dosyası
 * `admin`/`audit-log` içermiyordu (`code-reviewer` `S-7`).
 *
 * Bu dosya iddiayı HTTP seviyesinde pinler: `ROLE_CAPABILITIES`'te
 * `ADMIN_READ` yalnız `UserRole.ADMIN`'de (`capabilities.ts`), yani göç
 * öncesi/sonrası davranış birebir aynı olmalı — ADMIN 200, diğer roller 403.
 *
 * Şekil `agreement-transaction-role-boundary.e2e-spec.ts` ile aynı
 * (`CLAUDE.md §2.7 #6`): İKİ GİRDİ / İKİ ÇIKTI. Tek başına `403` kanıt
 * değildir — reddin CapabilityGuard'dan geldiği ancak `403` ALMAYAN bir
 * kardeş (ADMIN → 200) yanında yazılıysa ayırt edilir.
 *
 * Bu iki rota salt-okunur (GET) — `agreement-transaction-role-boundary`'nin
 * "guard geçsin ama gövde reddetsin" numarasına gerek yok, DB'ye hiçbir satır
 * yazılmaz.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

describe('B3 W1 — admin/audit-log yetenek sınırı {ADMIN}', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let finance: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

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

  describe('GET /admin/audit-log', () => {
    it('ADMIN → 200 (POZ.KONTROL — guard GEÇİYOR)', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-log')
        .set(admin.authHeader());
      expect(res.status).toBe(200);
    });

    it.each([
      ['PLANNER', () => planner],
      ['FINANCE', () => finance],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ])(
      '%s → 403 (ADMIN_READ yalnız ADMIN rolünde)',
      async (_label, getUser) => {
        const res = await request(app.getHttpServer())
          .get('/admin/audit-log')
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('GET /admin/audit-log/high-risk', () => {
    it('ADMIN → 200 (POZ.KONTROL — guard GEÇİYOR)', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-log/high-risk')
        .set(admin.authHeader());
      expect(res.status).toBe(200);
    });

    it.each([
      ['PLANNER', () => planner],
      ['FINANCE', () => finance],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ])(
      '%s → 403 (ADMIN_READ yalnız ADMIN rolünde)',
      async (_label, getUser) => {
        const res = await request(app.getHttpServer())
          .get('/admin/audit-log/high-risk')
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });
});
