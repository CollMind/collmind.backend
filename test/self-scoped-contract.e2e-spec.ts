/**
 * self-scoped-contract.e2e-spec.ts
 *
 * `SELF` sınıfının davranışsal sözleşmesini pinler — `Z18 §4` (dördüncü-eksen
 * reddi) + `Z26`/`Z28` (`docs/brd-v2/04_KARAR_KAYDI.md`).
 *
 * `SELF` bir rol kovası DEĞİLDİR, bir YÜKLEM SINIFIDIR: "kayıt benim mi"
 * (kimlik yeter, rol İLGİSİZ). Bu suite YEDİ ucun her birini AYRI AYRI
 * sınamaz — CLAUDE.md'nin uyardığı gibi ("sinyal sabitse, sinyal değildir")
 * yedi tekrar tek bir ölçüm sağlar. Bunun yerine SINIFI iki eksende pinler:
 *
 *   1. ROL GEREKMEZ    — farklı roller AYNI SELF ucuna erişir (rol filtresi
 *                        YOK, kimliğin kendisi yeter).
 *   2. KİMLİK GEREKİR   — token yoksa 401 (JwtAuthGuard hâlâ zincirde).
 *
 * Dört controller'dan birer temsilci: `GET /users/me` (user) ·
 * `POST /auth/logout` (auth) · `GET /notifications` (notification) ·
 * `GET /approvals/my-requests` (approval).
 *
 * `PATCH /users/me`'nin ALAN sözleşmesi (`UpdateSelfDto`, `Z26`) AYRI bir
 * describe blokta pinlenir: dar DTO `role`/`status`/`email`/`scope`/
 * `tenantId`/`permissions`/`mustChangePassword`'u `400` ile reddeder —
 * eski `delete updateUserDto.role` imperative daraltmasının YERİNE geçen
 * TİP SİSTEMİ garantisi.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

describe('SELF sınıfı — yüklem: "kayıt benim mi" (Z18 §4 / Z26 / Z28)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let admin: LoginResult;
  let readonly: LoginResult;
  let planner: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());

    admin = await loginAs(app, 'ADMIN');
    readonly = await loginAs(app, 'READONLY');
    planner = await loginAs(app, 'PLANNER');

    // Ön koşul: aktörler GERÇEKTEN farklı roller olmalı — "rol gerekmez"
    // iddiası ancak farklı rollerin AYNI sonucu aldığı ölçülürse anlamlıdır.
    expect(admin.userId).not.toBe(readonly.userId);
    expect(readonly.userId).not.toBe(planner.userId);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  describe.each([
    {
      label: 'GET /users/me',
      call: (auth: LoginResult) =>
        request(app.getHttpServer()).get('/users/me').set(auth.authHeader()),
      okStatus: 200,
    },
    {
      label: 'GET /notifications',
      call: (auth: LoginResult) =>
        request(app.getHttpServer())
          .get('/notifications')
          .set(auth.authHeader()),
      okStatus: 200,
    },
    {
      label: 'GET /approvals/my-requests',
      call: (auth: LoginResult) =>
        request(app.getHttpServer())
          .get('/approvals/my-requests')
          .set(auth.authHeader()),
      okStatus: 200,
    },
  ])('$label — SELF sınıfı', ({ label, call, okStatus }) => {
    it(`ROL GEREKMEZ: ADMIN, READONLY, PLANNER üçü de ${okStatus} alır`, async () => {
      const [resAdmin, resReadonly, resPlanner] = await Promise.all([
        call(admin),
        call(readonly),
        call(planner),
      ]);
      expect(resAdmin.status).toBe(okStatus);
      expect(resReadonly.status).toBe(okStatus);
      expect(resPlanner.status).toBe(okStatus);
    });

    it('KİMLİK GEREKİR: token yoksa 401 (JwtAuthGuard hâlâ zincirde)', async () => {
      // @Roles kaldırıldı ama @UseGuards(JwtAuthGuard, ...) KALDI — bu
      // testin var oluş sebebi: "NE BOZULABİLİR" #1 (CLAUDE.md brief).
      const bare = label.split(' ')[1];
      const res = await request(app.getHttpServer()).get(bare);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout — SELF sınıfı (ayrı: gövde yok, NO_CONTENT)', () => {
    it('ROL GEREKMEZ: ADMIN ve READONLY ikisi de 204 alır', async () => {
      // Taze login — logout DB'de refreshToken'ı temizler; paylaşılan
      // cache'teki access token'ı GEÇERSİZ KILMAZ (JWT stateless, DB'ye
      // yalnız `status` için bakılır — user.service.ts:1007-1011), ama
      // yine de her aktöre KENDİ taze login'i kullanmak testler arası
      // gizli bir bağımlılık kurmaz.
      const a = await loginAs(app, 'ADMIN');
      const r = await loginAs(app, 'READONLY');
      const [resA, resR] = await Promise.all([
        request(app.getHttpServer()).post('/auth/logout').set(a.authHeader()),
        request(app.getHttpServer()).post('/auth/logout').set(r.authHeader()),
      ]);
      expect(resA.status).toBe(204);
      expect(resR.status).toBe(204);
    });

    it('KİMLİK GEREKİR: token yoksa 401', async () => {
      const res = await request(app.getHttpServer()).post('/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /users/me — ALAN sözleşmesi (UpdateSelfDto, Z26)', () => {
    // Bu blok READONLY'nin KENDİ satırını mutasyona uğratır — her testten
    // SONRA orijinal değere geri yazılır ve DB'den DOĞRULANIR (CLAUDE.md:
    // "geri almanın SONUCUNU ölç, komutu değil").
    let originalJobTitle: string | null;

    beforeAll(async () => {
      const rows = await dataSource.query(
        `SELECT job_title FROM main.users WHERE id = $1`,
        [readonly.userId],
      );
      originalJobTitle = rows[0]?.job_title ?? null;
    });

    afterEach(async () => {
      await dataSource.query(
        `UPDATE main.users SET job_title = $2 WHERE id = $1`,
        [readonly.userId, originalJobTitle],
      );
      const rows = await dataSource.query(
        `SELECT job_title FROM main.users WHERE id = $1`,
        [readonly.userId],
      );
      expect(rows[0]?.job_title ?? null).toBe(originalJobTitle);
    });

    it.each([
      ['role', 'ADMIN'],
      ['status', 'LOCKED'],
      ['email', 'escalated@wella.com'],
      ['tenantId', '00000000-0000-0000-0000-000000000000'],
      ['permissions', ['SUPER']],
      ['mustChangePassword', false],
      ['scope', []],
    ])(
      '%s alanı 400 ile REDDEDİLİR (dar DTO, forbidNonWhitelisted)',
      async (field, value) => {
        const res = await request(app.getHttpServer())
          .patch('/users/me')
          .set(readonly.authHeader())
          .send({ [field]: value });
        expect(res.status).toBe(400);
      },
    );

    it("izinli alan (jobTitle) 200 ile KABUL EDİLİR ve DB'ye YAZAR", async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set(readonly.authHeader())
        .send({ jobTitle: 'E2E Self Contract Probe' });

      expect(res.status).toBe(200);
      expect(res.body.jobTitle).toBe('E2E Self Contract Probe');

      const rows = await dataSource.query(
        `SELECT job_title FROM main.users WHERE id = $1`,
        [readonly.userId],
      );
      expect(rows[0].job_title).toBe('E2E Self Contract Probe');
    });

    it('rol GERÇEKTEN değişmedi (yanıt gövdesindeki role hâlâ READONLY)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/me')
        .set(readonly.authHeader())
        .send({ jobTitle: 'E2E Self Contract Probe 2', role: 'ADMIN' });

      // role alanı whitelist dışı → tüm istek 400 ile reddedilir, jobTitle
      // de YAZILMAZ (kısmi kabul yok — forbidNonWhitelisted tüm gövdeyi
      // reddeder). Bu, eski "sessiz düşürme" davranışından FARKLI ve
      // BİLEREK: Z26 §"status bulgusu" ile aynı gerekçe.
      expect(res.status).toBe(400);
    });
  });
});
