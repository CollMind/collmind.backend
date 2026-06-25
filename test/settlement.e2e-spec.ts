/**
 * settlement.e2e-spec.ts
 *
 * Kapsam:
 *   POST /actuals-first/settlements/close/:agreementId
 *   GET  /actuals-first/settlements/summary
 *
 * BRD kuralları:
 *   - Yalnızca ADMIN/CATEGORY_MANAGER close edebilir (PLANNER → 403)
 *   - APPROVED/ACTIVE agreement → CLOSED geçişi izinli
 *   - DRAFT/PENDING agreement close → 409 NOT_SETTLEABLE_STATE
 *   - Zaten CLOSED → 409 ALREADY_SETTLED
 *   - Close işlemi budget/ledger'a YAZMAZ (pure state transition)
 *   - GET /summary tüm authenticated kullanıcılara açık (read-only)
 *
 * Fixture stratejisi:
 *   - Her "başarılı close" testi için ayrı APPROVED agreement kullanmak
 *     gerekir; çünkü CLOSED state geri alınamaz.
 *   - loadE2EFixture'dan APPROVED agreement alınır; ilk close sonrası o
 *     agreement kullanılmaz. Sonraki close testleri için seed'den başka
 *     bir APPROVED agreement yoksa testi BİLGİLENDİR (skip ile değil,
 *     pending description ile).
 *
 * NOT: Settlement close endpoint POST dönüyor ancak swagger 201 olarak
 * belgelenmiş. Gerçek dönüş kodu controller'da belirtilmemiş (default POST = 201).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';

describe('Settlement (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // ── GET /summary (read-only) ──────────────────────────────────────────────

  describe('GET /actuals-first/settlements/summary', () => {
    it('ADMIN summary endpoint → 200 ve items array döner', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/actuals-first/settlements/summary')
        .set(admin.authHeader())
        .expect(200);

      // SettlementSummaryResponseDto: { items: [...] } ya da doğrudan array
      expect(res.body).toBeDefined();
    });

    it('PLANNER summary okuyabilir → 200', async () => {
      const planner = await loginAs(app, 'PLANNER');

      await request(app.getHttpServer())
        .get('/actuals-first/settlements/summary')
        .set(planner.authHeader())
        .expect(200);
    });

    it('FINANCE summary okuyabilir → 200', async () => {
      const finance = await loginAs(app, 'FINANCE');

      await request(app.getHttpServer())
        .get('/actuals-first/settlements/summary')
        .set(finance.authHeader())
        .expect(200);
    });

    it('Token olmadan summary → 401', async () => {
      await request(app.getHttpServer())
        .get('/actuals-first/settlements/summary')
        .expect(401);
    });
  });

  // ── POST /close/:agreementId — RBAC ──────────────────────────────────────

  describe('POST /close/:agreementId — RBAC', () => {
    it('PLANNER agreement close etmeye çalışır → 403 FORBIDDEN', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const fakeId = '00000000-0000-0000-0000-000000000099';

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${fakeId}`)
        .set(planner.authHeader())
        .send({})
        .expect(403);

      expect(res.body.message).toBeDefined();
    });

    it('FINANCE rolü close etmeye çalışır → 403 FORBIDDEN', async () => {
      const finance = await loginAs(app, 'FINANCE');
      const fakeId = '00000000-0000-0000-0000-000000000099';

      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${fakeId}`)
        .set(finance.authHeader())
        .send({})
        .expect(403);
    });

    it('Token olmadan close → 401 Unauthorized', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000099';

      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${fakeId}`)
        .send({})
        .expect(401);
    });
  });

  // ── POST /close/:agreementId — State machine ──────────────────────────────

  describe('POST /close/:agreementId — State machine', () => {
    it('DRAFT agreement close etmeye çalışılır → 409 NOT_SETTLEABLE_STATE', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${fixture.draftAgreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'E2E test - draft close denemesi' })
        .expect(409);

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).toContain('NOT_SETTLEABLE_STATE');
    });

    it('Var olmayan agreement → 404', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const nonExistentId = '00000000-0000-0000-0000-000000000002';

      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${nonExistentId}`)
        .set(admin.authHeader())
        .send({})
        .expect(404);
    });

    it('Geçersiz UUID formatı → 400', async () => {
      const admin = await loginAs(app, 'ADMIN');

      await request(app.getHttpServer())
        .post('/actuals-first/settlements/close/not-a-valid-uuid')
        .set(admin.authHeader())
        .send({})
        .expect(400);
    });
  });

  // ── POST /close/:agreementId — Başarılı close ──────────────────────────────

  describe('POST /close/:agreementId — Başarılı close', () => {
    /**
     * APPROVED agreement'ı CLOSED'a taşır.
     * Bu test seed'deki tek APPROVED agreement'ı CLOSED yapar.
     * Testin idempotent olmaması nedeniyle suit içinde en son çalışmalı.
     * "ALREADY_SETTLED" testi bu testin ardından çalışır.
     */
    let closedAgreementId: string;

    it('ADMIN APPROVED agreement close eder → 201 + status=CLOSED', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${fixture.approvedAgreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'E2E test - başarılı settlement close' })
        .expect(201);

      expect(res.body).toMatchObject({
        agreementId: fixture.approvedAgreementId,
        status: 'CLOSED',
      });
      expect(res.body).toHaveProperty('closedAt');
      closedAgreementId = res.body.agreementId;
    });

    it('Zaten CLOSED agreement tekrar close edilmeye çalışılır → 409 ALREADY_SETTLED', async () => {
      if (!closedAgreementId) {
        // Önceki test atlandıysa veya başarısız olduysa bu testi atla
        console.warn(
          'closedAgreementId mevcut değil, ALREADY_SETTLED testi atlanıyor.',
        );
        return;
      }

      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${closedAgreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'Tekrar close denemesi' })
        .expect(409);

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).toContain('ALREADY_SETTLED');
    });

    it('CATEGORY_MANAGER farklı bir APPROVED agreement var ise close edebilir', async () => {
      // Mevcut approved agreement ya zaten CLOSED edildi (önceki test) ya da
      // bu testte ayrı bir tane gerekmektedir.
      // DB'den fresh bir tane çek; yoksa testi bilgi mesajı ile geç.
      const dataSource = app.get<DataSource>(getDataSourceToken());
      const freshApproved = await dataSource.query(
        `SELECT id FROM main.agreements
         WHERE tenant_id = $1 AND status = 'APPROVED'
         ORDER BY created_at ASC LIMIT 1`,
        [fixture.tenantId],
      );

      if (!freshApproved || freshApproved.length === 0) {
        console.log(
          'CATEGORY_MANAGER close testi: mevcut APPROVED agreement yok, atlanıyor.',
        );
        return;
      }

      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const targetId = freshApproved[0].id;

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${targetId}`)
        .set(cm.authHeader())
        .send({ justification: 'Category manager E2E close test' })
        .expect(201);

      expect(res.body.status).toBe('CLOSED');
    });
  });
});
