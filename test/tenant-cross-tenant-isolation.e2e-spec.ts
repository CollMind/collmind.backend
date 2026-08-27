/**
 * tenant-cross-tenant-isolation.e2e-spec.ts
 *
 * T-307 / Z45 §2 — `tenant.controller.ts`'in sekiz rotasının hepsi
 * `@Roles(ADMIN)`/`@RequireCapability(TENANT_READ|TENANT_WRITE)` taşıyordu
 * ama HİÇBİRİ `id === çağıranın tenant'ı` predikatı taşımıyordu. Bir
 * kiracının ADMIN'i başka bir kiracıyı okuyabiliyor, değiştirebiliyor,
 * SİLEBİLİYORDU. Bugüne kadar görünmedi çünkü `main.tenants = 1` —
 * "verinin yokluğu örter"in kitabi vakası (`Z45 §2` madde 3).
 *
 * ⛔ Bu yüzden bu dosya İKİNCİ bir tenant'ı GERÇEKTEN kurar — repoda
 * hazır bir ikinci-tenant fixture yok (`optimistic-locking.e2e-spec.ts`
 * "cross-tenant isolation (Layer 6)" ile AYNI desen: `main.tenants`'a
 * doğrudan INSERT, JWT `JwtService` ile mint edilir — `/auth/login`'in
 * şifre kontrolünü BYPASS ETMEZ, `JwtStrategy#validate` yine gerçek bir DB
 * lookup yapar; sadece login FORM'unu atlar, çünkü ikinci tenant'ın gerçek
 * bir parolası yok).
 *
 * Fixture ikinci kiracıyı taşımadan hiçbir tenant-izolasyon pini PİN
 * DEĞİLDİR (`Z45 §2` madde 3) — T2 burada GERÇEK bir satır taşıyor (kendi
 * `name`/`status`/`id`'si ile), boş sonuç `T1-ADMIN → T2` reddinin
 * DELİLİ değil, T2'nin HİÇ VAR OLMAMASININ delili olurdu.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

describe('Tenant routes — cross-tenant isolation (T-307, E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: LoginResult; // Tenant A (seed tenant, wella.com) ADMIN

  let tenantBId: string;
  let tenantBName: string;
  let tenantBToken: string;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());
    admin = await loginAs(app, 'ADMIN');

    tenantBName = `E2E-TENANT-B-${Date.now()}`;
    const tenantRows = await dataSource.query(
      `INSERT INTO main.tenants (name, status)
       VALUES ($1, 'ACTIVE') RETURNING id`,
      [tenantBName],
    );
    tenantBId = tenantRows[0].id;

    const tenantBEmail = `e2e-tenant-b-admin-${Date.now()}@example.com`;
    const userRows = await dataSource.query(
      `INSERT INTO main.users (tenant_id, email, password_hash, role, status, full_name)
       VALUES ($1, $2, 'unused-hash-e2e-jwt-minted-directly', 'ADMIN', 'ACTIVE', 'E2E Tenant B Admin')
       RETURNING id`,
      [tenantBId, tenantBEmail],
    );
    const tenantBUserId = userRows[0].id;

    const jwtService = app.get(JwtService);
    tenantBToken = jwtService.sign({
      sub: tenantBUserId,
      tenantId: tenantBId,
      email: tenantBEmail,
      role: 'ADMIN',
    });
  });

  afterAll(async () => {
    try {
      // FK ON DELETE CASCADE on main.users(tenant_id) removes the user too.
      await dataSource.query(`DELETE FROM main.tenants WHERE id = $1`, [
        tenantBId,
      ]);
    } catch {
      // best-effort
    }
    await closeTestApp();
  });

  // ── POZİTİF KONTROL: T1'in ADMIN'i KENDİ kiracısına erişebiliyor ────────
  it('[DAVRANIŞSAL][YAPISAL] POZ.KONTROL — T1-ADMIN → T1 (own tenant) → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tenants/${admin.tenantId}`)
      .set(admin.authHeader());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(admin.tenantId);
  });

  // ── ASIL PİN — CANLI CROSS-TENANT BULGU KAPANDI ─────────────────────────
  it('[DAVRANIŞSAL][YAPISAL] GET /tenants/:id — T1-ADMIN → T2 → 403, T2 satırı hiç dönmez', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tenants/${tenantBId}`)
      .set(admin.authHeader());
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(tenantBName);
  });

  it('[DAVRANIŞSAL][YAPISAL] PATCH /tenants/:id — T1-ADMIN → T2 → 403, T2 değişmez', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/tenants/${tenantBId}`)
      .set(admin.authHeader())
      .send({ name: 'HACKED-BY-T1-ADMIN' });
    expect(res.status).toBe(403);

    const check = await dataSource.query(
      `SELECT name FROM main.tenants WHERE id = $1`,
      [tenantBId],
    );
    expect(check[0].name).toBe(tenantBName);
  });

  it('[DAVRANIŞSAL][YAPISAL] DELETE /tenants/:id — T1-ADMIN → T2 → 403, T2 silinmez', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/tenants/${tenantBId}`)
      .set(admin.authHeader());
    expect(res.status).toBe(403);

    const check = await dataSource.query(
      `SELECT deleted_at FROM main.tenants WHERE id = $1`,
      [tenantBId],
    );
    expect(check[0].deleted_at).toBeNull();
  });

  it('[DAVRANIŞSAL][YAPISAL] POST /tenants/:id/activate — T1-ADMIN → T2 → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/tenants/${tenantBId}/activate`)
      .set(admin.authHeader());
    expect(res.status).toBe(403);
  });

  it('[DAVRANIŞSAL][YAPISAL] POST /tenants/:id/suspend — T1-ADMIN → T2 → 403, T2 durumu değişmez', async () => {
    const res = await request(app.getHttpServer())
      .post(`/tenants/${tenantBId}/suspend`)
      .set(admin.authHeader());
    expect(res.status).toBe(403);

    const check = await dataSource.query(
      `SELECT status FROM main.tenants WHERE id = $1`,
      [tenantBId],
    );
    expect(check[0].status).toBe('ACTIVE');
  });

  it('[DAVRANIŞSAL][YAPISAL] GET /tenants/:id/stats — T1-ADMIN → T2 → 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tenants/${tenantBId}/stats`)
      .set(admin.authHeader());
    expect(res.status).toBe(403);
  });

  // ── SİMETRİ: T2-ADMIN → T1 için de aynı sınır geçerli ───────────────────
  it('[DAVRANIŞSAL][YAPISAL] SİMETRİ — T2-ADMIN → T1 (başka yöne) → 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tenants/${admin.tenantId}`)
      .set({ Authorization: `Bearer ${tenantBToken}` });
    expect(res.status).toBe(403);
  });

  // ── GET /tenants (liste) — T2-ADMIN kendi kiracısını görür, T1'i GÖRMEZ ─
  it('[DAVRANIŞSAL][YAPISAL] GET /tenants — T2-ADMIN listesinde yalnız T2 var, T1 YOK', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set({ Authorization: `Bearer ${tenantBToken}` });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map((t: { id: string }) => t.id);
    expect(ids).toEqual([tenantBId]);
    expect(ids).not.toContain(admin.tenantId);
  });
});
