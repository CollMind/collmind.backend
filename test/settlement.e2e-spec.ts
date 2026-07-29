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
 * Fixture stratejisi (T-037):
 *   - "Başarılı close" testleri artık paylaşılan seed agreement'ını
 *     (STA-2026-0002, `fixture.approvedAgreementId`) KULLANMAZ — jest
 *     spec dosyalarını varsayılan olarak paralel worker'larda çalıştırdığı
 *     için bu paylaşılan/mutable agreement `reversal.e2e-spec.ts` ile race
 *     yaratıyordu, ve suite'i kapatınca `seed-e2e.ts`'deki "diriltme" hack'i
 *     (agreement'ı SQL ile geri APPROVED yapıp bütçe rezervasyonunu geri
 *     kurmadan) BRD-ihlali bir durum bırakıyordu (bkz. T-037 task raporu).
 *   - Bunun yerine her "başarılı close" testi `createAndApproveAgreement`
 *     ile kendi izole APPROVED agreement'ını yaratır (aynı desen:
 *     `settlement-budget-release.e2e-spec.ts`). Seed'in APPROVED
 *     agreement'ı (`fixture.approvedAgreementId`) artık hiçbir spec
 *     tarafından mutate edilmiyor — DRAFT/UUID/RBAC testleri için hâlâ
 *     referans olarak kullanılıyor (yalnızca okuma).
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
import {
  loadE2EFixture,
  resolveIdByCode,
  createAndApproveAgreement,
  cleanupTestAgreements,
  E2EFixture,
} from './helpers/seed-e2e';

describe('Settlement (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CHANNEL_NKA: string;
  let FU_WELLA_HC_500ML: string;
  let TACTIC_PROMO: string;
  let MECHANIC_DISCOUNT: string;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [CHANNEL_NKA, FU_WELLA_HC_500ML, TACTIC_PROMO, MECHANIC_DISCOUNT] =
      await Promise.all([
        // T-037: NKA/ENV-2026-NKA-Q2 bilinçli olarak KAÇINILIYOR —
        // settlement-budget-release.e2e-spec.ts ve role-journey.e2e-spec.ts
        // aynı envelope'u delta-bazlı before/after invaryantlarla yoğun
        // kullanıyor; bu spec'in paralel worker'da aynı envelope'a eşzamanlı
        // yazması o testlerin okumaları arasına girip false-negative
        // üretebiliyor (canlı kanıt: bu fix öncesi bir koşumda BR-E2E-02 bu
        // şekilde flake etti). E_COMMERCE/ENV-2026-ECOM-Q1 hiçbir spec
        // tarafından kullanılmıyor — tam izolasyon.
        resolveIdByCode(app, fixture.tenantId, 'channels', 'E_COMMERCE'),
        resolveIdByCode(
          app,
          fixture.tenantId,
          'forecasting_units',
          'FU-WELLA-HC-500ML',
        ),
        resolveIdByCode(app, fixture.tenantId, 'tactics', 'TAC-PROMO'),
        resolveIdByCode(app, fixture.tenantId, 'mechanics', 'MEC-DISCOUNT'),
      ]);
  });

  afterAll(async () => {
    try {
      await cleanupTestAgreements(app, fixture.tenantId, 'E2E-SETTLE');
    } catch (e) {
      console.warn('Cleanup (settlement agreement) başarısız:', e);
    }
    await closeTestApp();
  });

  async function newApprovedAgreement(capTotalAmount = 4000) {
    return createAndApproveAgreement(app, {
      tenantId: fixture.tenantId,
      cplId: fixture.cplId,
      channelId: CHANNEL_NKA,
      fuId: FU_WELLA_HC_500ML,
      tacticId: TACTIC_PROMO,
      mechanicId: MECHANIC_DISCOUNT,
      capTotalAmount,
      namePrefix: 'E2E-SETTLE',
    });
  }

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
     * T-037: her test artık kendi izole APPROVED agreement'ını yaratır
     * (`newApprovedAgreement`) — paylaşılan seed agreement'ı
     * (`fixture.approvedAgreementId`) hiçbir zaman mutate edilmez. Bu,
     * `reversal.e2e-spec.ts` ile paralel koşumdaki race'i ve "diriltme"
     * hack'ine olan bağımlılığı ortadan kaldırır.
     */
    it('ADMIN APPROVED agreement close eder → 201 + status=CLOSED', async () => {
      const { agreementId, capTotalAmount } = await newApprovedAgreement();

      // T-037 BRD invaryantı: close öncesi bu agreement bütçeden düşmüş
      // olmalı (net rezervasyon = cap, "diriltme" hack'inin ürettiği
      // 0-rezervasyonlu APPROVED durumu regresyonuna karşı guard).
      const netReserved = async () => {
        const rows = await dataSource.query(
          `SELECT COALESCE(SUM(
             CASE WHEN tx_type = 'RESERVE' THEN amount
                  WHEN tx_type = 'RELEASE' THEN -amount
                  ELSE 0 END
           ), 0) AS net_reserved
           FROM main.budget_transactions
           WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2
             AND tx_status = 'POSTED'`,
          [fixture.tenantId, agreementId],
        );
        return Number(rows[0].net_reserved);
      };
      expect(await netReserved()).toBeCloseTo(capTotalAmount, 2);

      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'E2E test - başarılı settlement close' })
        .expect(201);

      expect(res.body).toMatchObject({
        agreementId,
        status: 'CLOSED',
      });
      expect(res.body).toHaveProperty('closedAt');

      // Close sonrası net rezervasyon 0'a döner (RELEASE tam cap kadar) —
      // hem BRD (approve→bütçeden düş, close→release) hem de "diriltme"
      // hack'inin tersi bir regresyonu (close etkisiz kalıp rezerv kalıcı
      // asılı kalması) yakalar.
      expect(await netReserved()).toBeCloseTo(0, 2);
    });

    it('Zaten CLOSED agreement tekrar close edilmeye çalışılır → 409 ALREADY_SETTLED', async () => {
      const { agreementId } = await newApprovedAgreement();
      const admin = await loginAs(app, 'ADMIN');

      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'İlk close' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'Tekrar close denemesi' })
        .expect(409);

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).toContain('ALREADY_SETTLED');
    });

    it("CATEGORY_MANAGER kendi APPROVED agreement'ını close edebilir", async () => {
      const { agreementId } = await newApprovedAgreement();
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(cm.authHeader())
        .send({ justification: 'Category manager E2E close test' })
        .expect(201);

      expect(res.body.status).toBe('CLOSED');
    });
  });
});
