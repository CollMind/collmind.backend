/**
 * tenant-capability-boundary.e2e-spec.ts
 *
 * `B3 W2` göçü — `tenant.controller.ts`'in rotaları `@Roles(ADMIN)` →
 * `@RequireCapability(TENANT_READ|TENANT_WRITE)` göçürüldü. `ROLE_CAPABILITIES`'te
 * ikisi de yalnız `UserRole.ADMIN`'de (`capabilities.ts:667-669`) — yani göç
 * öncesi/sonrası davranış birebir aynı olmalı: ADMIN geçer, ADMIN dışı HER rol 403.
 *
 * Şekil `admin-audit-capability-boundary.e2e-spec.ts` ile aynı (`CLAUDE.md
 * §2.7 #6`): İKİ GİRDİ / İKİ ÇIKTI — `403` tek başına kanıt değildir, reddin
 * CapabilityGuard'dan geldiği ancak `403` ALMAYAN bir kardeş (ADMIN → guard
 * geçiyor) yanında yazılıysa ayırt edilir.
 *
 * ⛔ `T-307-m2` / `Z46 §1` (2026-08-27) — `POST /tenants` (create) ·
 * `DELETE /tenants/:id` (remove) · `GET /tenants` (findAll/liste) BURADAN
 * KALDIRILDI: bu rotalar artık YOK (yaşam-döngüsü operatör-yoluna taşındı,
 * bkz. `tenant.controller.ts` başlık yorumu). Bu dosyanın onlara ait
 * describe blokları da kaldırıldı — kalan sınama yüzeyi: `GET /tenants/:id`,
 * `GET /tenants/:id/stats`, `PATCH /tenants/:id`, `POST /tenants/:id/
 * activate|suspend` (tümü self-tenant, kiracı-içi meşru yüzey).
 *
 * ⚠️ Yan etkili rotalar (`PATCH /tenants/:id`, `POST /tenants/:id/
 * activate|suspend`) `agreement-transaction-role-boundary` numarasıyla
 * yazıldı: izinli rol için de hedef KASTEN geçersiz (kendi tenant'ı DEĞİL)
 * — guard geçsin, self-tenant guard reddetsin (403), DB'ye HİÇBİR SATIR
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
 * ⚠️ `T-307` / `Z45 §2` GÜNCELLEMESİ (2026-08-27): `tenant.service.ts` artık
 * `id === callerTenantId` zorunluluğu taşıyor (`assertSelfTenant`) —
 * `NONEXISTENT_UUID` ADMIN'in KENDİ kiracısı olamayacağı için bu kontrol
 * SERVİSİN 404/DTO reddinden ÖNCE ateşler. Aşağıdaki ADMIN beklentileri bu
 * yüzden `404`/`not 403`'ten `403`'e GÜNCELLENDİ — capability guard hâlâ
 * geçiyor (rol sınırı bu dosyanın konusu, hâlâ doğru), ama self-tenant
 * guard'ı ARDINDAN ateşliyor. Cross-tenant izolasyonun kendisinin pini
 * `test/tenant-cross-tenant-isolation.e2e-spec.ts`'te (iki-tenant fixture,
 * gerçek satır taşıyan T2).
 *
 *   PATCH /tenants/:id           → rastgele (var olmayan) UUID     → ADMIN 403 (self-tenant guard)
 *   POST /tenants/:id/activate   → rastgele (var olmayan) UUID     → ADMIN 403 (self-tenant guard)
 *   POST /tenants/:id/suspend    → rastgele (var olmayan) UUID     → ADMIN 403 (self-tenant guard)
 *
 * Salt-okunur rotalar (`GET /tenants/:id`, `GET /tenants/:id/stats`)
 * doğrudan pinlenir — DB'ye zaten yazmıyorlar.
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

  describe('GET /tenants/:id (TENANT_READ)', () => {
    // T-307: `id` must equal the caller's OWN tenant now (self-tenant
    // guard), so NONEXISTENT_UUID would give ADMIN a 403 too — collapsing
    // the positive control this file's header describes (§2.7 #6: "403
    // alone is not proof"). Using ADMIN's REAL tenant id keeps both guards
    // (capability + self-tenant) passing, so 200 still isolates "this is a
    // CAPABILITY boundary test" from the self-tenant boundary (pinned
    // separately in tenant-cross-tenant-isolation.e2e-spec.ts).
    it('ADMIN → 200 (POZ.KONTROL — guard GEÇİYOR, own tenant id)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${admin.tenantId}`)
        .set(admin.authHeader());
      expect(res.status).toBe(200);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_READ yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get(`/tenants/${admin.tenantId}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );

    // T-307 self-tenant guard, isolated from the capability guard above:
    // ADMIN (correct capability) targeting a NON-self id is still rejected.
    it('ADMIN → 403 targeting a non-self id (self-tenant guard, independent of capability)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(403);
    });
  });

  describe('GET /tenants/:id/stats (TENANT_READ)', () => {
    it('ADMIN → guard GEÇİYOR (403 DEĞİL, own tenant id)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${admin.tenantId}/stats`)
        .set(admin.authHeader());
      expect(res.status).not.toBe(403);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (TENANT_READ yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get(`/tenants/${admin.tenantId}/stats`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );

    it('ADMIN → 403 targeting a non-self id (self-tenant guard, independent of capability)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${NONEXISTENT_UUID}/stats`)
        .set(admin.authHeader());
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /tenants/:id (TENANT_WRITE) — guard GEÇSİN, self-tenant guard reddetsin', () => {
    // T-307: NONEXISTENT_UUID admin'in kendi tenant'ı olamayacağı için
    // self-tenant guard servisin 404'ünden ÖNCE ateşliyor — hiçbir satır
    // yazılmıyor (eski davranışla AYNI garanti, farklı status kodu).
    it('ADMIN → 403 (POZ.KONTROL — capability guard geçti, self-tenant guard reddetti; T-307)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tenants/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send({ name: 'Guard Boundary Test Tenant' });
      expect(res.status).toBe(403);
      // ⛔ AYIRT EDİCİ (review `B4`): status TEK BAŞINA yetmez — bu testte
      // ADMIN de diğer roller de 403 bekliyor ⇒ POZİTİF KONTROL ÇÖKMÜŞTÜ.
      // `TENANT_WRITE` yarın ADMIN'den alınsa test YEŞİL KALIRDI. İki 403'ü
      // AYIRAN ŞEY MESAJDIR: CapabilityGuard `false` → Nest'in varsayılan
      // 'Forbidden resource'; assertSelfTenant → kendi cümlesi.
      // ⇒ ADMIN'in capability kapısını GEÇTİĞİ burada kanıtlanır.
      expect(String(res.body.message)).toContain('kendi kiracınızı');
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

  describe('POST /tenants/:id/activate (TENANT_WRITE) — guard GEÇSİN, self-tenant guard reddetsin', () => {
    it('ADMIN → 403 (POZ.KONTROL — capability guard geçti, self-tenant guard reddetti; T-307)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tenants/${NONEXISTENT_UUID}/activate`)
        .set(admin.authHeader());
      expect(res.status).toBe(403);
      // ⛔ AYIRT EDİCİ (review `B4`): status TEK BAŞINA yetmez — bu testte
      // ADMIN de diğer roller de 403 bekliyor ⇒ POZİTİF KONTROL ÇÖKMÜŞTÜ.
      // `TENANT_WRITE` yarın ADMIN'den alınsa test YEŞİL KALIRDI. İki 403'ü
      // AYIRAN ŞEY MESAJDIR: CapabilityGuard `false` → Nest'in varsayılan
      // 'Forbidden resource'; assertSelfTenant → kendi cümlesi.
      // ⇒ ADMIN'in capability kapısını GEÇTİĞİ burada kanıtlanır.
      expect(String(res.body.message)).toContain('kendi kiracınızı');
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

  describe('POST /tenants/:id/suspend (TENANT_WRITE) — guard GEÇSİN, self-tenant guard reddetsin', () => {
    it('ADMIN → 403 (POZ.KONTROL — capability guard geçti, self-tenant guard reddetti; T-307)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tenants/${NONEXISTENT_UUID}/suspend`)
        .set(admin.authHeader());
      expect(res.status).toBe(403);
      // ⛔ AYIRT EDİCİ (review `B4`): status TEK BAŞINA yetmez — bu testte
      // ADMIN de diğer roller de 403 bekliyor ⇒ POZİTİF KONTROL ÇÖKMÜŞTÜ.
      // `TENANT_WRITE` yarın ADMIN'den alınsa test YEŞİL KALIRDI. İki 403'ü
      // AYIRAN ŞEY MESAJDIR: CapabilityGuard `false` → Nest'in varsayılan
      // 'Forbidden resource'; assertSelfTenant → kendi cümlesi.
      // ⇒ ADMIN'in capability kapısını GEÇTİĞİ burada kanıtlanır.
      expect(String(res.body.message)).toContain('kendi kiracınızı');
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
