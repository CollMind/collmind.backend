/**
 * customer-capability-boundary.e2e-spec.ts
 *
 * `B3 W5` göçü (`Z39`, 2026-08-26) — `customer.controller.ts`'in 17 rotası
 * `@Roles` → `@RequireCapability` göçürüldü:
 *
 *   10 × GET   `@Roles(ADMIN,PLANNER,CATEGORY_MANAGER,FINANCE,READONLY)` → `CUSTOMER_READ` (5/5)
 *    7 × yazma `@Roles(ADMIN,PLANNER)`                                    → `CUSTOMER_WRITE` ({A,P})
 *
 * `ROLE_CAPABILITIES`'te ikisi de göç öncesi @Roles kümesiyle BİREBİR —
 * davranış KORUNUYOR.
 *
 * `CLAUDE.md §2.7 #6` — İKİ GİRDİ / İKİ ÇIKTI: `CUSTOMER_WRITE`'ın NEGATİF
 * YARISI VAR (izinli rol 403 ALMAZ, izinsiz rol 403 ALIR) — pin gerçek
 * ayırt edici. `CUSTOMER_READ` 5/5 — NEGATİF YARI YOK, pin bu hücrede
 * `route-scope.sh`'ın FILTRESIZ ölçümünü DOĞRULAMAZ (dedektör: route-scope.sh
 * FILTRESIZ kovası, `CAPABILITY` kovasına yazar); burada BEŞ ROLÜN BEŞİNİN
 * DE aynı (403 dışı) sonucu aldığı pinlenir — `tetiklenmiyor, çünkü negatif
 * yarı mevcut değil` (`B3B1_DALGA_PLANI_ONERI.md` `PİN ZORUNLU`).
 *
 * Yan etkili yedi rota (`CUSTOMER_WRITE`) `tenant-capability-boundary`
 * numarasıyla yazıldı: izinli rol için de gövde/hedef KASTEN geçersiz —
 * guard geçsin, servis/ValidationPipe reddetsin, DB'ye HİÇBİR SATIR
 * YAZILMASIN.
 *
 *   POST   /customers                 → code eksik (MinLength ihlali)     → ADMIN 400
 *   POST   /customers/bulk            → customers=[] boş dizi             → ADMIN 201 (0 oluşturuldu, satır YOK)
 *   PATCH  /customers/:id             → nonexistent UUID                  → ADMIN 404
 *   DELETE /customers/:id             → nonexistent UUID                  → ADMIN 404
 *   POST   /customers/:id/activate    → nonexistent UUID                  → ADMIN 404
 *   POST   /customers/:id/deactivate  → nonexistent UUID                  → ADMIN 404
 *   POST   /customers/import          → dosya YOK                         → ADMIN 400
 *
 * Salt-okunur on rota (`CUSTOMER_READ`) doğrudan pinlenir — DB'ye
 * zaten yazmıyorlar.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis findOne'da 404 üretir. Hiçbir satır yazılmaz/silinmez.
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W5 — customer.controller yetenek sınırı', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let categoryManager: LoginResult;
  let finance: LoginResult;
  let readonly: LoginResult;

  const ALL_ROLES: Array<[string, () => LoginResult]> = [
    ['ADMIN', () => admin],
    ['PLANNER', () => planner],
    ['CATEGORY_MANAGER', () => categoryManager],
    ['FINANCE', () => finance],
    ['READONLY', () => readonly],
  ];

  const WRITE_OTHER_ROLES: Array<[string, () => LoginResult]> = [
    ['CATEGORY_MANAGER', () => categoryManager],
    ['FINANCE', () => finance],
    ['READONLY', () => readonly],
  ];

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    planner = await loginAs(app, 'PLANNER');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    finance = await loginAs(app, 'FINANCE');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  // ── CUSTOMER_READ — 5/5, negatif yarı YOK ──────────────────────────────
  describe('GET /customers (CUSTOMER_READ 5/5 — negatif yarı yok)', () => {
    it.each(ALL_ROLES)(
      '%s → 403 ALMAZ (route-scope.sh FILTRESIZ değil, CAPABILITY kovasında)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get('/customers')
          .set(getUser().authHeader());
        expect(res.status).not.toBe(403);
      },
    );
  });

  describe('GET /customers/:id/stats (CUSTOMER_READ 5/5 — negatif yarı yok)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get(`/customers/${NONEXISTENT_UUID}/stats`)
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  // ── CUSTOMER_WRITE — {ADMIN,PLANNER}, negatif yarı VAR ─────────────────
  describe('POST /customers (CUSTOMER_WRITE {ADMIN,PLANNER})', () => {
    const INVALID_BODY = { name: 'x' }; // code zorunlu (MinLength) — eksik

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/customers')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it('PLANNER → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/customers')
        .set(planner.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (CUSTOMER_WRITE yalnız ADMIN,PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/customers')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /customers/:id (CUSTOMER_WRITE {ADMIN,PLANNER})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/customers/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send({ name: 'Nonexistent Update' });
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (CUSTOMER_WRITE yalnız ADMIN,PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/customers/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader())
          .send({ name: 'Nonexistent Update' });
        expect(res.status).toBe(403);
      },
    );
  });

  describe('DELETE /customers/:id (CUSTOMER_WRITE {ADMIN,PLANNER})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/customers/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (CUSTOMER_WRITE yalnız ADMIN,PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .delete(`/customers/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /customers/:id/activate (CUSTOMER_WRITE {ADMIN,PLANNER})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/customers/${NONEXISTENT_UUID}/activate`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (CUSTOMER_WRITE yalnız ADMIN,PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/customers/${NONEXISTENT_UUID}/activate`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /customers/:id/deactivate (CUSTOMER_WRITE {ADMIN,PLANNER})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/customers/${NONEXISTENT_UUID}/deactivate`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (CUSTOMER_WRITE yalnız ADMIN,PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/customers/${NONEXISTENT_UUID}/deactivate`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /customers/import (CUSTOMER_WRITE {ADMIN,PLANNER})', () => {
    it('ADMIN → 400 (POZ.KONTROL — guard geçti, controller dosya-yok kontrolü reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/customers/import')
        .set(admin.authHeader());
      expect(res.status).toBe(400);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (CUSTOMER_WRITE yalnız ADMIN,PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/customers/import')
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /customers/bulk (CUSTOMER_WRITE {ADMIN,PLANNER})', () => {
    // Boş dizi — guard geçsin, servis 0 satır oluştursun (yan etki yok).
    it('ADMIN → 201, 0 satır oluşturulur', async () => {
      const res = await request(app.getHttpServer())
        .post('/customers/bulk')
        .set(admin.authHeader())
        .send({ customers: [] });
      expect(res.status).toBe(201);
      expect(res.body).toEqual([]);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (CUSTOMER_WRITE yalnız ADMIN,PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/customers/bulk')
          .set(getUser().authHeader())
          .send({ customers: [] });
        expect(res.status).toBe(403);
      },
    );
  });
});
