/**
 * auth.e2e-spec.ts
 *
 * Kapsam: Authentication endpoint'leri (POST /auth/login)
 *
 * Senaryolar:
 *   1. ADMIN ile başarılı login → 200 + accessToken + user objesi
 *   2. Yanlış şifre → 401 Unauthorized
 *   3. Var olmayan email → 401 Unauthorized
 *   4. Token ile korunan endpoint (GET /dashboard/summary) → 200
 *   5. Token olmadan korunan endpoint → 401
 *   6. Geçersiz/manipüle edilmiş token → 401
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { SEED_USERS, clearTokenCache } from './helpers/auth';

describe('Auth (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  describe('POST /auth/login', () => {
    it('ADMIN geçerli kimlik bilgileriyle login → 200 + accessToken döner', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: SEED_USERS.ADMIN.email,
          password: SEED_USERS.ADMIN.password,
        })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toMatchObject({
        email: SEED_USERS.ADMIN.email,
        role: 'ADMIN',
      });
      expect(res.body.user).toHaveProperty('tenantId');
      expect(res.body.user).toHaveProperty('id');
      // JWT format: header.payload.signature
      expect(res.body.accessToken.split('.').length).toBe(3);
    });

    it('PLANNER geçerli kimlik bilgileriyle login → 200 + PLANNER rolü', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: SEED_USERS.PLANNER.email,
          password: SEED_USERS.PLANNER.password,
        })
        .expect(200);

      expect(res.body.user.role).toBe('PLANNER');
    });

    it('Yanlış şifre → 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: SEED_USERS.ADMIN.email,
          password: 'WrongPassword999!',
        })
        .expect(401);

      expect(res.body).toHaveProperty('statusCode', 401);
    });

    it('Var olmayan email → 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@wella.com',
          password: 'AnyPassword123!',
        })
        .expect(401);
    });

    it('Eksik email alanı (validation) → 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ password: 'Collmind2026!' })
        .expect(400);
    });

    it('Boş body → 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({})
        .expect(400);
    });
  });

  describe('JWT korumalı endpoint erişimi', () => {
    it('Geçerli Bearer token ile GET /dashboard/summary → 200', async () => {
      // Önce token al
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: SEED_USERS.ADMIN.email,
          password: SEED_USERS.ADMIN.password,
        })
        .expect(200);

      const token = loginRes.body.accessToken;

      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('Token olmadan GET /dashboard/summary → 401', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .expect(401);
    });

    it('Geçersiz/manipüle edilmiş token → 401', async () => {
      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set('Authorization', 'Bearer invalidtoken.fakeheader.fakesignature')
        .expect(401);
    });

    it('"Bearer" prefix olmadan token → 401', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: SEED_USERS.ADMIN.email,
          password: SEED_USERS.ADMIN.password,
        })
        .expect(200);

      // Bearer prefix olmadan gönder
      await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set('Authorization', loginRes.body.accessToken)
        .expect(401);
    });
  });
});
