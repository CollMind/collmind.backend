/**
 * user-scope-update.e2e-spec.ts
 *
 * [[T-242a]] — `PATCH /users/:id/scope`, kapsam GÜNCELLEME/BOŞALTMA yolu.
 *
 * DAR tutuldu (task brief): burada yalnız "üretim çağrı yolu var" iddiasını
 * kanıtlayan ASGARİ kontroller var — HTTP rotası + RBAC + temel replace +
 * ölçülmüş idempotence + Z15 KARAR 2'nin RET koşulları. Ayırt edici
 * davranışsal pinler (ör. unique-index reaktivasyon köşesi, B1/R1 paylaşılan
 * doğrulamanın update tarafında da tuttuğu) ayrı bir turda `qa-engineer`
 * tarafından yazılacak (CLAUDE.md §3: bir ajan kendi yazdığı kodun testini
 * yazmaz).
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  E2EFixture,
  resolveIdByCode,
  cleanupTestUsers,
} from './helpers/seed-e2e';

describe('T-242a — PATCH /users/:id/scope: kapsam GÜNCELLEME/BOŞALTMA', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;
  let CPL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;

  const scratchUserIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());
    fixture = await loadE2EFixture(app);
    [CPL_NKA, CATEGORY_SAC_BOYASI] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'cpls', 'BS0501.50001'),
      resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-SAC-BOYASI'),
    ]);
  });

  afterAll(async () => {
    await cleanupTestUsers(app, scratchUserIds);
    await closeTestApp();
  });

  beforeEach(() => clearTokenCache());

  async function readScopeRows(
    userId: string,
  ): Promise<Array<{ cpl_id: string | null; category_id: string | null }>> {
    return dataSource.query(
      `SELECT cpl_id, category_id FROM main.user_scopes
        WHERE user_id = $1 AND is_active = true
        ORDER BY cpl_id NULLS FIRST, category_id NULLS FIRST`,
      [userId],
    );
  }

  /**
   * M3 (code-review MAJOR): `readScopeRows` yalnız (cpl_id, category_id)
   * okuyor — "no-op" ile "deaktive edip AYNI görünen satırı yeniden yazdı"
   * AYNI ÇIKTIYI verir, bu ikisini ayırt edemez (1808'in `deletedRows`
   * kapısıyla aynı sınıf). `id`/`created_at`/`updated_at` üçü de: gerçek
   * no-op'ta `updateScope`'un `if (!existingRow.isActive)` kapısı hiç
   * `save()` çağırmaz — üçü de DEĞİŞMEZ. Guard kaldırılsaydı (regresyon)
   * `updated_at` her çağrıda ilerlerdi, bu satırlar YAKALARDI.
   */
  async function readScopeRowsFull(userId: string): Promise<
    Array<{
      id: string;
      cpl_id: string | null;
      category_id: string | null;
      created_at: Date;
      updated_at: Date;
    }>
  > {
    return dataSource.query(
      `SELECT id, cpl_id, category_id, created_at, updated_at
         FROM main.user_scopes
        WHERE user_id = $1 AND is_active = true
        ORDER BY cpl_id NULLS FIRST, category_id NULLS FIRST`,
      [userId],
    );
  }

  async function createScopedPlanner(): Promise<string> {
    const admin = await loginAs(app, 'ADMIN');
    const email = `e2e-t242a-planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@wella.com`;
    const res = await request(app.getHttpServer())
      .post('/users')
      .set(admin.authHeader())
      .send({
        email,
        password: 'Collmind2026!',
        fullName: 'T-242a scoped planner',
        role: 'PLANNER',
        status: 'ACTIVE',
        scope: [{ cplId: CPL_NKA, categoryId: null }],
      })
      .expect(201);
    scratchUserIds.push(res.body.id);
    return res.body.id;
  }

  it('ADIM 0 kapanışı: PATCH /users/:id (genel gövde) scope ile çağrılırsa 400 döner, user_scopes DEĞİŞMEZ', async () => {
    const userId = await createScopedPlanner();
    const before = await readScopeRows(userId);

    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set(admin.authHeader())
      .send({ scope: [{ cplId: null, categoryId: CATEGORY_SAC_BOYASI }] });

    expect(res.status).toBe(400);
    expect(await readScopeRows(userId)).toEqual(before);
  });

  it('PATCH /users/:id/scope intent=UPDATE → 200, user_scopes gönderilen HEDEF kümeyle BİREBİR eşleşir (replace)', async () => {
    const userId = await createScopedPlanner();
    const admin = await loginAs(app, 'ADMIN');

    const res = await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(admin.authHeader())
      .send({
        intent: 'UPDATE',
        scope: [{ cplId: null, categoryId: CATEGORY_SAC_BOYASI }],
      });

    expect(res.status).toBe(200);
    expect(await readScopeRows(userId)).toEqual([
      { cpl_id: null, category_id: CATEGORY_SAC_BOYASI },
    ]);
  });

  it('idempotence: AYNI istek iki kez → aynı DB durumu (ikinci çağrı da 200, satır sayısı değişmez)', async () => {
    const userId = await createScopedPlanner();
    const admin = await loginAs(app, 'ADMIN');
    const body = {
      intent: 'UPDATE',
      scope: [{ cplId: CPL_NKA, categoryId: null }],
    };

    const first = await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(admin.authHeader())
      .send(body);
    expect(first.status).toBe(200);
    const afterFirst = await readScopeRows(userId);

    const second = await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(admin.authHeader())
      .send(body);
    expect(second.status).toBe(200);
    const afterSecond = await readScopeRows(userId);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond).toEqual([{ cpl_id: CPL_NKA, category_id: null }]);
  });

  // M3 (code-review MAJOR): yukarıdaki test yalnız (cpl_id, category_id)
  // okuyor — "no-op" ile "deaktive edip AYNI görünen satırı yeniden yazdı"
  // (id değişir, updated_at ilerler) aynı çıktıyı verir, ayırt EDEMEZ.
  // Burada `id`/`created_at`/`updated_at` üçü de İKİ çağrı arasında
  // DEĞİŞMEDEN kalmalı — gerçek bir no-op'un imzası budur.
  it('M3: idempotence — GERÇEK no-op imzası (id/created_at/updated_at İKİ çağrı arasında DEĞİŞMEZ)', async () => {
    const userId = await createScopedPlanner();
    const admin = await loginAs(app, 'ADMIN');
    const body = {
      intent: 'UPDATE',
      scope: [{ cplId: CPL_NKA, categoryId: null }],
    };

    const beforeAny = await readScopeRowsFull(userId);
    expect(beforeAny).toHaveLength(1);

    // Bu istek zaten yaratma anındaki hedefle BİREBİR aynı (createScopedPlanner
    // AYNI çifti veriyor) — yani BİRİNCİ çağrı da bir no-op'tur, `save()`
    // hiç tetiklenmemelidir.
    const first = await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(admin.authHeader())
      .send(body);
    expect(first.status).toBe(200);
    const afterFirst = await readScopeRowsFull(userId);

    const second = await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(admin.authHeader())
      .send(body);
    expect(second.status).toBe(200);
    const afterSecond = await readScopeRowsFull(userId);

    expect(afterFirst).toHaveLength(1);
    expect(afterSecond).toHaveLength(1);
    expect(afterFirst[0].id).toBe(beforeAny[0].id);
    expect(afterSecond[0].id).toBe(beforeAny[0].id);
    expect(new Date(afterFirst[0].created_at).getTime()).toBe(
      new Date(beforeAny[0].created_at).getTime(),
    );
    expect(new Date(afterFirst[0].updated_at).getTime()).toBe(
      new Date(beforeAny[0].updated_at).getTime(),
    );
    expect(new Date(afterSecond[0].updated_at).getTime()).toBe(
      new Date(beforeAny[0].updated_at).getTime(),
    );
  });

  it('idempotence — boşalt sonra AYNI çifti geri ver (unique index reaktivasyon yolu, satır sayısı 1 kalır)', async () => {
    const userId = await createScopedPlanner();
    const admin = await loginAs(app, 'ADMIN');

    await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(admin.authHeader())
      .send({ intent: 'REVOKE_ALL', scope: [], reason: 'T-242a e2e' })
      .expect(200);
    expect(await readScopeRows(userId)).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(admin.authHeader())
      .send({
        intent: 'UPDATE',
        scope: [{ cplId: CPL_NKA, categoryId: null }],
      })
      .expect(200);
    expect(await readScopeRows(userId)).toEqual([
      { cpl_id: CPL_NKA, category_id: null },
    ]);
  });

  describe('Z15 KARAR 2 — boşaltma izinli ama SESSİZ OLAMAZ', () => {
    it('intent=UPDATE + boş scope → 400 (RET, sessiz temizleme yok)', async () => {
      const userId = await createScopedPlanner();
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/users/${userId}/scope`)
        .set(admin.authHeader())
        .send({ intent: 'UPDATE', scope: [] });

      expect(res.status).toBe(400);
    });

    it('intent=REVOKE_ALL + gerekçesiz → 400', async () => {
      const userId = await createScopedPlanner();
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/users/${userId}/scope`)
        .set(admin.authHeader())
        .send({ intent: 'REVOKE_ALL', scope: [] });

      expect(res.status).toBe(400);
    });

    it('intent=REVOKE_ALL + dolu scope → 400 (tutarsız niyet)', async () => {
      const userId = await createScopedPlanner();
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/users/${userId}/scope`)
        .set(admin.authHeader())
        .send({
          intent: 'REVOKE_ALL',
          scope: [{ cplId: CPL_NKA, categoryId: null }],
          reason: 'tutarsız',
        });

      expect(res.status).toBe(400);
    });

    it('intent=REVOKE_ALL + gerekçeli → 200, user_scopes BOŞALIR', async () => {
      const userId = await createScopedPlanner();
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/users/${userId}/scope`)
        .set(admin.authHeader())
        .send({
          intent: 'REVOKE_ALL',
          scope: [],
          reason: 'T-242a e2e — kasıtlı boşaltma',
        });

      expect(res.status).toBe(200);
      expect(await readScopeRows(userId)).toEqual([]);
    });
  });

  it('WILDCARD_SCOPE_ROLES (ör. FINANCE) için bu uç 400 döner — kapsam yalnız rol değişimiyle yönetilir', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const email = `e2e-t242a-finance-${Date.now()}@wella.com`;
    const createRes = await request(app.getHttpServer())
      .post('/users')
      .set(admin.authHeader())
      .send({
        email,
        password: 'Collmind2026!',
        fullName: 'T-242a wildcard finance',
        role: 'FINANCE',
        status: 'ACTIVE',
      })
      .expect(201);
    scratchUserIds.push(createRes.body.id);

    const res = await request(app.getHttpServer())
      .patch(`/users/${createRes.body.id}/scope`)
      .set(admin.authHeader())
      .send({
        intent: 'UPDATE',
        scope: [{ cplId: CPL_NKA, categoryId: null }],
      });

    expect(res.status).toBe(400);
  });

  it('RBAC — yalnızca ADMIN kapsam güncelleyebilir (PLANNER → 403)', async () => {
    const userId = await createScopedPlanner();
    const planner = await loginAs(app, 'PLANNER');

    const res = await request(app.getHttpServer())
      .patch(`/users/${userId}/scope`)
      .set(planner.authHeader())
      .send({
        intent: 'UPDATE',
        scope: [{ cplId: CPL_NKA, categoryId: null }],
      });

    expect(res.status).toBe(403);
  });
});
