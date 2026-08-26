/**
 * z20-users-list-role-boundary.e2e-spec.ts
 *
 * `B3` kaza-dalgası `K1` — `Z20` daraltması (`docs/brd-v2/04_KARAR_KAYDI.md` `Z20` ·
 * `H7`), bilinçli/KAYITLI davranış-değiştiren istisna:
 *
 *   GET /users   @Roles(ADMIN, FINANCE)  →  @Roles(ADMIN)      FINANCE DÜŞER
 *
 * Gerekçe (`Z20`): `GET /users/:id` `T-255`'te `ADMIN`'e daraltıldı; `GET /users`
 * onun liste hâli — aynı veri sınıfı, aynı rol. `K-2.6.4` cümle testi Finans'a
 * kullanıcı-listesi vermiyor. `user.controller.ts`'teki `B3 W3` göç yorumu bu
 * daraltmayı **bilerek** bu dalgaya bıraktı (`test/user-capability-boundary.
 * e2e-spec.ts`'in kapsam-dışı notuna bkz.).
 *
 * ⛔ YÖN: DARALTMA. `FINANCE` bugün `200` → bu değişiklikle `403`.
 *
 * ── PİN ŞEKLİ — İKİ GİRDİ / İKİ ÇIKTI (`CLAUDE.md §2.7 #6`) ─────────────────
 *
 * Tek başına `FINANCE → 403` bir kanıt değildir (`W4a`'nın "hücre 5/5, negatif
 * yarı yok" kör-noktası — burada tam tersi risk: HERKESİ kapatan bir kaza da
 * `403` üretir). Pinin ayırt etme gücü şu ikisinden gelir:
 *
 *   1. FINANCE → 403     (hedef daralıyor)
 *   2. ADMIN   → 200     (kardeş AYNEN geçiyor — daralma yalnız hedefte)
 *
 * `PLANNER`/`CATEGORY_MANAGER`/`READONLY` zaten bugün `403` (rota hiç
 * `ADMIN,FINANCE` dışına açık değildi) — bunlar da ayrıca ölçülür ki bir
 * "herkese kapat" kazası bu suite'i yanlışlıkla yeşil bırakmasın.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

describe('B3 K1 — Z20 daraltması: GET /users {ADMIN,FINANCE} → {ADMIN} [DARALTMA]', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let finance: LoginResult;
  let planner: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    finance = await loginAs(app, 'FINANCE');
    planner = await loginAs(app, 'PLANNER');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  it('ADMIN → 200 (POZ.KONTROL — kardeş AYNEN geçiyor, daralma yalnız FINANCE hedefinde)', async () => {
    const res = await request(app.getHttpServer())
      .get('/users')
      .set(admin.authHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('FINANCE → 403 (HEDEF — Z20 daraltması burada ölçülür)', async () => {
    const res = await request(app.getHttpServer())
      .get('/users')
      .set(finance.authHeader());
    expect(res.status).toBe(403);
  });

  it.each([
    ['PLANNER', () => planner],
    ['CATEGORY_MANAGER', () => categoryManager],
    ['READONLY', () => readonly],
  ])(
    '%s → 403 (değişmedi — rota daraltmadan ÖNCE de bu rollere kapalıydı)',
    async (_label, getUser) => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .set(getUser().authHeader());
      expect(res.status).toBe(403);
    },
  );
});
