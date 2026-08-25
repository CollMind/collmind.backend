/**
 * shared-read-w4a-boundary.e2e-spec.ts
 *
 * `B3 W4a` göçü — `SHARED_READ` hücresindeki **16 rota**
 * `@Roles(ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY)` (5/5) →
 * `@RequireCapability(CAPABILITIES.SHARED_READ)` göçürüldü.
 * `ROLE_CAPABILITIES`'te `SHARED_READ` de aynı beş rolde (`capabilities.ts:593-602`)
 * — göç öncesi/sonrası davranış BİREBİR aynı olmalı.
 *
 * ⛔ BU HÜCREDE NEGATİF YARI YOK (5/5) — `admin-audit`/`tenant`/`user`
 * pinlerinin aksine, reddedilecek bir "diğer roller" kümesi yoktur. Bu
 * DOĞALDIR, kusur değil — brief'in kendi notu. Ayırt edicilik bu yüzden
 * `CapabilityGuard`'ı GEÇİCİ kaldırarak sağlanır (bkz. dosya sonu yorumu),
 * kalıcı test şekli değil.
 *
 * Şekil: her rota için BEŞ ROL de çağrılır ve HEPSİNİN AYNI (403 OLMAYAN)
 * durum kodunu döndürdüğü doğrulanır — `CLAUDE.md §2.7 #6`: tek girdiyle
 * (tek rol) guard'ın geçtiğini iddia etmek ayırt etmez; beş rolün BEŞİNİN
 * DE aynı sonucu vermesi guard'ın bu beşi ayırmadığını (yani SHARED_READ
 * tabanının bozulmadığını) gösterir.
 *
 * Servis-tarafı 404/500 farkları (`spend-calculation` doğrulama uçları
 * `throw new Error(...)` kullanıyor, `NotFoundException` değil — ölçüldü,
 * `spend-validation.service.ts:78,255,696`) BU TESTİN KAPSAMI DIŞINDA;
 * yalnız guard katmanının beş rolü de EŞİT geçirdiği pinlenir.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis 404/500 üretir (rotaya göre). Hiçbir satır yazılmaz/silinmez —
// bu dosyadaki HİÇBİR rota yazma yapmaz (hepsi GET).
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W4a — SHARED_READ yetenek tabanı {ADMIN,CATEGORY_MANAGER,FINANCE,PLANNER,READONLY}', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let finance: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

  const ALL_FIVE: Array<[string, () => LoginResult]> = [
    ['ADMIN', () => admin],
    ['CATEGORY_MANAGER', () => categoryManager],
    ['FINANCE', () => finance],
    ['PLANNER', () => planner],
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

  /**
   * Beş rolü aynı istekle çağırır, hepsinin AYNI (403 dışı) durumu
   * döndürdüğünü doğrular. `buildRequest` her rol için taze bir supertest
   * isteği kurar (gövde/query farklı olabileceği için).
   */
  function pinAllFive(
    label: string,
    buildRequest: (
      agent: request.SuperTest<request.Test>,
      user: LoginResult,
    ) => request.Test,
  ) {
    describe(label, () => {
      it('BEŞ ROL de AYNI durumu döndürür (403 DEĞİL)', async () => {
        const statuses: Record<string, number> = {};
        for (const [roleLabel, getUser] of ALL_FIVE) {
          const res = await buildRequest(
            request(
              app.getHttpServer(),
            ) as unknown as request.SuperTest<request.Test>,
            getUser(),
          );
          statuses[roleLabel] = res.status;
        }
        const first = Object.values(statuses)[0];
        for (const status of Object.values(statuses)) {
          expect(status).not.toBe(403);
          expect(status).toBe(first); // beşi de AYNI davranışı almalı
        }
      });
    });
  }

  // -- approval.controller.ts --------------------------------------------
  pinAllFive('GET approvals/:id', (agent, user) =>
    agent.get(`/approvals/${NONEXISTENT_UUID}`).set(user.authHeader()),
  );

  // -- budget.controller.ts ------------------------------------------------
  pinAllFive('GET budget/envelopes', (agent, user) =>
    agent.get('/budget/envelopes').set(user.authHeader()),
  );

  pinAllFive('GET budget/envelopes/:id', (agent, user) =>
    agent.get(`/budget/envelopes/${NONEXISTENT_UUID}`).set(user.authHeader()),
  );

  pinAllFive('GET budget/envelopes/:id/reserved', (agent, user) =>
    agent
      .get(`/budget/envelopes/${NONEXISTENT_UUID}/reserved`)
      .set(user.authHeader()),
  );

  pinAllFive('GET budget/envelopes/:id/transactions', (agent, user) =>
    agent
      .get(`/budget/envelopes/${NONEXISTENT_UUID}/transactions`)
      .set(user.authHeader()),
  );

  pinAllFive('GET budget/status', (agent, user) =>
    agent.get('/budget/status?channel=ON_INVOICE').set(user.authHeader()),
  );

  // -- dashboard.controller.ts ---------------------------------------------
  pinAllFive('GET dashboard/pending-tasks', (agent, user) =>
    agent.get('/dashboard/pending-tasks').set(user.authHeader()),
  );

  pinAllFive('GET dashboard/cpl-status', (agent, user) =>
    agent.get('/dashboard/cpl-status').set(user.authHeader()),
  );

  // -- lta-agreement.controller.ts ------------------------------------------
  pinAllFive('GET lta-agreements', (agent, user) =>
    agent.get('/lta-agreements').set(user.authHeader()),
  );

  pinAllFive('GET lta-agreements/:id', (agent, user) =>
    agent.get(`/lta-agreements/${NONEXISTENT_UUID}`).set(user.authHeader()),
  );

  pinAllFive('GET lta-agreements/cpl/:cplId/active', (agent, user) =>
    agent
      .get(`/lta-agreements/cpl/${NONEXISTENT_UUID}/active`)
      .set(user.authHeader()),
  );

  // -- spend-calculation.controller.ts --------------------------------------
  pinAllFive('GET spend-calculation/breakdown/:planFuId', (agent, user) =>
    agent
      .get(`/spend-calculation/breakdown/${NONEXISTENT_UUID}`)
      .set(user.authHeader()),
  );

  pinAllFive(
    'GET spend-calculation/validate-distribution/:planFuId',
    (agent, user) =>
      agent
        .get(`/spend-calculation/validate-distribution/${NONEXISTENT_UUID}`)
        .set(user.authHeader()),
  );

  pinAllFive('GET spend-calculation/validate-inputs/:planFuId', (agent, user) =>
    agent
      .get(`/spend-calculation/validate-inputs/${NONEXISTENT_UUID}`)
      .set(user.authHeader()),
  );

  pinAllFive(
    'GET spend-calculation/validate-combinations/:planFuId',
    (agent, user) =>
      agent
        .get(`/spend-calculation/validate-combinations/${NONEXISTENT_UUID}`)
        .set(user.authHeader()),
  );

  pinAllFive(
    'GET spend-calculation/validate-before-submission/:planId',
    (agent, user) =>
      agent
        .get(
          `/spend-calculation/validate-before-submission/${NONEXISTENT_UUID}`,
        )
        .set(user.authHeader()),
  );
});
