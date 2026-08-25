/**
 * t267-roles-behavioral-pin.e2e-spec.ts — T-267 (ADIM 3 B2)
 *
 * ⛔ BAYAT ATIF DÜZELTMESİ (`B3 W2`, 2026-08-25): hedef rota
 * `GET /tenants/:id/stats` bu turda `@Roles(ADMIN)` → `@RequireCapability(
 * TENANT_READ)` GÖÇTÜ. Pin **geçmeye devam ediyor** (davranış birebir korundu)
 * ama artık `RolesGuard`'ı değil **`CapabilityGuard`**'ı ölçüyor.
 * Başlıktaki *"@Roles davranışsal pin"* ifadesi o yüzden **tarihsel**.
 * `@Roles` kovasının davranışsal pini pinsiz KALMADI:
 * `agreement-transaction-role-boundary.e2e-spec.ts` ve `role-journey.e2e-spec.ts`
 * ayakta (ölçüldü, `W2` review).
 * 📌 Yeniden adlandırma (`§`: *"test dosyası task numarası değil SÖZLEŞME adı
 * taşır"*) aday — ama `T-286`/`B4` işi, bu turda değil.
 *
 * Kapsam: `route-scope` ratchet'inin B2 turunda `@Roles`'a bağladığı 59 uçtan
 * BİRİNİN gerçekten davranışsal olarak korunduğunu pinler (CLAUDE.md
 * "Doğrulama bir KAPIDIR — durdurmuyorsa doğrulama değildir").
 *
 * Hedef: `GET /tenants/:id/stats` (B1 §1e — KARDEŞ uç: tenant.controller'ın
 * yedi kardeşinin yedisi de @Roles(ADMIN)). Bu uç öncesinde @Roles TAŞIMIYORDU
 * — route-scope-baseline.txt'te FILTRESIZ olarak kayıtlıydı.
 *
 *   kapsam DIŞI rol (PLANNER) → 403
 *   kapsam İÇİ rol (ADMIN)    → 200   (pozitif kontrol — negatif sonuç tek
 *                                       başına yeterli değil, CLAUDE.md §7.1)
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';

describe('T-267 — @Roles davranışsal pin (GET /tenants/:id/stats)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it('kapsam DIŞI rol (PLANNER) → 403 Forbidden', async () => {
    const planner = await loginAs(app, 'PLANNER');

    await request(app.getHttpServer())
      .get(`/tenants/${planner.tenantId}/stats`)
      .set(planner.authHeader())
      .expect(403);
  });

  it('POZİTİF KONTROL — kapsam İÇİ rol (ADMIN) → 200 OK', async () => {
    const admin = await loginAs(app, 'ADMIN');

    const res = await request(app.getHttpServer())
      .get(`/tenants/${admin.tenantId}/stats`)
      .set(admin.authHeader())
      .expect(200);

    expect(res.body).toBeDefined();
  });
});
