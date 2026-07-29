/**
 * reversal.e2e-spec.ts
 *
 * Kapsam: POST /actuals-first/reversals/agreement-transaction/:transactionId
 *
 * BRD kuralları:
 *   - Yalnızca ADMIN veya CATEGORY_MANAGER reverse edebilir (PLANNER → 403)
 *   - APPROVED/ACTIVE agreement'taki transaction'lar geri alınabilir
 *   - Zaten geri alınmış transaction → 409 ALREADY_REVERSED
 *   - Reversal sonrası ledger net tüketim azalır (GET /ledger/agreement/:id/consumed)
 *   - Audit log immutable (reversal sonrası admin-audit-log'da kayıt var)
 *
 * Fixture stratejisi (T-037):
 *   - Bu spec artık seed'deki paylaşılan APPROVED agreement'ını
 *     (STA-2026-0002, `fixture.approvedAgreementId`) KULLANMAZ. Jest spec
 *     dosyalarını varsayılan olarak paralel worker'larda çalıştırır;
 *     `settlement.e2e-spec.ts` aynı agreement'ı close ediyordu ve bu spec
 *     ona off-invoice transaction yazıp reverse ediyordu → race → flaky
 *     400/409 (bkz. T-037 task raporu). Ayrıca bu paylaşımı telafi etmek
 *     için `seed-e2e.ts`'de var olan "diriltme" hack'i (agreement'ı SQL ile
 *     geri APPROVED yapıp bütçe rezervasyonunu geri kurmadan) BRD-ihlali
 *     bir durum (APPROVED ama net rezervasyonu 0 olan agreement) bırakıyordu.
 *   - Çözüm: `createAndApproveAgreement` ile kendi izole APPROVED
 *     agreement'ını yarat (aynı desen: `settlement-budget-release.e2e-spec.ts`).
 *     Suite sonunda agreement `cleanupTestAgreements` ile tamamen silinir
 *     (rezervasyon dahil, satırlar bazında doğrulanır).
 *   - Her reversal testi için createOffInvoiceTransaction ile yeni transaction yarat
 *   - "tekrar reverse" testi: aynı transactionId ile ikinci kez dene
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
  createOffInvoiceTransaction,
  cleanupTestAgreements,
  E2EFixture,
} from './helpers/seed-e2e';

describe('Reversal (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;
  let agreementId: string;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    const [channelId, fuId, tacticId, mechanicId] = await Promise.all([
      // T-037: NKA channel/NKA-Q2 envelope bilinçli olarak KAÇINILIYOR —
      // settlement-budget-release.e2e-spec.ts ve role-journey.e2e-spec.ts
      // aynı envelope'u (ENV-2026-NKA-Q2) delta-bazlı before/after
      // invaryantlarla yoğun kullanıyor; bu spec paralel worker'da aynı
      // envelope'a eşzamanlı yazınca o testlerin before/after okumaları
      // arasına girip false-negative üretebiliyor (canlı kanıt: bu fix
      // öncesi bir koşumda BR-E2E-02 bu şekilde flake etti). E_COMMERCE
      // kanalı/ENV-2026-ECOM-Q1 hiçbir spec tarafından kullanılmıyor —
      // tam izolasyon.
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

    const created = await createAndApproveAgreement(app, {
      tenantId: fixture.tenantId,
      cplId: fixture.cplId,
      channelId,
      fuId,
      tacticId,
      mechanicId,
      capTotalAmount: 50000,
      namePrefix: 'E2E-REV',
    });
    agreementId = created.agreementId;
  });

  afterAll(async () => {
    // T-037: agreement bu spec'e izole olduğundan (paylaşılan seed agreement
    // DEĞİL), tam silme ile temizlik yeterli — rezervasyon da satırlarla
    // birlikte kalkar. NOT: burada envelope'un mutlak reserved/consumed
    // değerini suite-öncesi baseline'a karşı KARŞILAŞTIRMIYORUZ — bu
    // envelope (ENV-2026-NKA-Q2) başka spec dosyalarında da (paralel
    // worker'larda) eşzamanlı kullanılıyor, mutlak-değer karşılaştırması
    // gerçek paralellikte kaçınılmaz false-negative üretir. Bunun yerine
    // yalnızca bu agreement'a ait satırların (budget_transactions) hiç
    // kalmadığını doğrulayan izole bir invaryant kullanılıyor (aşağıda).
    try {
      await cleanupTestAgreements(app, fixture.tenantId, 'E2E-REV');
    } catch (e) {
      console.warn('Cleanup (reversal agreement) başarısız:', e);
    }

    const leftoverTx = await dataSource.query(
      `SELECT id FROM main.budget_transactions
       WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2`,
      [fixture.tenantId, agreementId],
    );
    expect(leftoverTx).toHaveLength(0);

    await closeTestApp();
  });

  describe('BRD invaryantı: APPROVED agreement net rezervasyon > 0', () => {
    it('bu spec\'in kendi APPROVED agreement\'ı bütçeden gerçekten düşüyor (diriltme hack\'i regresyon guard\'ı)', async () => {
      // T-037: eski "diriltme" hack'i APPROVED durumunu SQL ile geri
      // yazıyor ama rezervasyonu geri kurmuyordu (net rezervasyon = 0,
      // BRD "Approved bütçeden düşer" ihlali). Bu test doğrudan bu sınıf
      // hatayı yakalar — envelope-genelinde DEĞİL, yalnızca bu agreement'a
      // ait RESERVE/RELEASE satırları üzerinden (diğer paralel spec'lerin
      // aynı envelope'daki eşzamanlı aktivitesinden etkilenmez):
      // agreement hâlâ APPROVED iken net rezervasyonu capTotalAmount'a
      // (50000) eşit olmalı, 0 DEĞİL.
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
      const netReserved = Number(rows[0].net_reserved);
      expect(netReserved).toBeCloseTo(50000, 2);
      expect(netReserved).toBeGreaterThan(0);
    });
  });

  describe('RBAC: Yalnızca ADMIN/CATEGORY_MANAGER erişebilir', () => {
    it('PLANNER bir transaction reverse etmeye çalışır → 403 FORBIDDEN', async () => {
      const planner = await loginAs(app, 'PLANNER');
      // Rastgele bir UUID (erişim kontrolü PLANNER'da route'a giremeden yapılır)
      const fakeTransactionId = '00000000-0000-0000-0000-000000000099';

      const res = await request(app.getHttpServer())
        .post(
          `/actuals-first/reversals/agreement-transaction/${fakeTransactionId}`,
        )
        .set(planner.authHeader())
        .send({})
        .expect(403);

      expect(res.body.message).toBeDefined();
    });

    it('FINANCE rolü reverse etmeye çalışır → 403 FORBIDDEN', async () => {
      const finance = await loginAs(app, 'FINANCE');
      const fakeTransactionId = '00000000-0000-0000-0000-000000000099';

      await request(app.getHttpServer())
        .post(
          `/actuals-first/reversals/agreement-transaction/${fakeTransactionId}`,
        )
        .set(finance.authHeader())
        .send({})
        .expect(403);
    });

    it('Token olmadan reverse → 401 Unauthorized', async () => {
      const fakeTransactionId = '00000000-0000-0000-0000-000000000099';

      await request(app.getHttpServer())
        .post(
          `/actuals-first/reversals/agreement-transaction/${fakeTransactionId}`,
        )
        .send({})
        .expect(401);
    });
  });

  describe('Başarılı reversal (ADMIN)', () => {
    it('ADMIN off-invoice transaction reverse eder → 200 + reversalLedgerId + reversedAmount', async () => {
      const admin = await loginAs(app, 'ADMIN');

      // Bu test için özgün bir transaction oluştur
      const transactionId = await createOffInvoiceTransaction(
        app,
        agreementId,
        `REV-SUCCESS-${Date.now()}`,
      );

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/reversals/agreement-transaction/${transactionId}`)
        .set(admin.authHeader())
        .send({ justification: 'E2E test reversal - fatura iptali' })
        // Reversal mevcut bir tx'i tersine çevirir, yeni kaynak yaratmaz → 200
        .expect(200);

      expect(res.body).toMatchObject({
        transactionId,
        status: 'REVERSED',
      });
      expect(res.body).toHaveProperty('reversalLedgerId');
      expect(res.body).toHaveProperty('reversedAmount');
      expect(typeof res.body.reversedAmount).toBe('number');
      expect(res.body.reversedAmount).toBeGreaterThan(0);
    });

    it('CATEGORY_MANAGER off-invoice transaction reverse eder → 200', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const transactionId = await createOffInvoiceTransaction(
        app,
        agreementId,
        `REV-CM-${Date.now()}`,
      );

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/reversals/agreement-transaction/${transactionId}`)
        .set(cm.authHeader())
        .send({ justification: 'E2E test - CM reversal' })
        .expect(200);

      expect(res.body.status).toBe('REVERSED');
    });
  });

  describe('State machine: ALREADY_REVERSED (409)', () => {
    it('Aynı transaction tekrar reverse edilmeye çalışılır → 409 ALREADY_REVERSED', async () => {
      const admin = await loginAs(app, 'ADMIN');

      // Reversal için yeni bir transaction yarat
      const transactionId = await createOffInvoiceTransaction(
        app,
        agreementId,
        `REV-DOUBLE-${Date.now()}`,
      );

      // İlk reversal başarılı
      await request(app.getHttpServer())
        .post(`/actuals-first/reversals/agreement-transaction/${transactionId}`)
        .set(admin.authHeader())
        .send({ justification: 'İlk reversal' })
        .expect(200);

      // İkinci reversal → 409
      const res = await request(app.getHttpServer())
        .post(`/actuals-first/reversals/agreement-transaction/${transactionId}`)
        .set(admin.authHeader())
        .send({ justification: 'İkinci reversal denemesi' })
        .expect(409);

      expect(res.body.message).toBeDefined();
      // BRD: 409 body'sinde ALREADY_REVERSED kodu beklenir
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).toContain('ALREADY_REVERSED');
    });
  });

  describe('Ledger net tüketim kontrolü', () => {
    it('Reversal sonrası consumed amount azalır', async () => {
      const admin = await loginAs(app, 'ADMIN');

      // Transaction oluştur
      const transactionId = await createOffInvoiceTransaction(
        app,
        agreementId,
        `REV-NET-${Date.now()}`,
      );

      // Reversal öncesi consumed
      const beforeRes = await request(app.getHttpServer())
        .get(`/ledger/agreement/${agreementId}/consumed`)
        .set(admin.authHeader())
        .expect(200);
      const consumedBefore = Number(beforeRes.body.consumed);

      // Reversal yap
      await request(app.getHttpServer())
        .post(`/actuals-first/reversals/agreement-transaction/${transactionId}`)
        .set(admin.authHeader())
        .send({ justification: 'Net consumed test' })
        .expect(200);

      // Reversal sonrası consumed
      const afterRes = await request(app.getHttpServer())
        .get(`/ledger/agreement/${agreementId}/consumed`)
        .set(admin.authHeader())
        .expect(200);
      const consumedAfter = Number(afterRes.body.consumed);

      // CREDIT entry net consumed'ı düşürmeli
      expect(consumedAfter).toBeLessThan(consumedBefore);
      // Tam olarak 5000 TRY (createOffInvoiceTransaction'daki amount) kadar azalmalı
      expect(consumedBefore - consumedAfter).toBeCloseTo(5000, 0);
    });
  });

  describe('Var olmayan transaction', () => {
    it('Var olmayan transactionId → 404', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const nonExistentId = '00000000-0000-0000-0000-000000000001';

      await request(app.getHttpServer())
        .post(`/actuals-first/reversals/agreement-transaction/${nonExistentId}`)
        .set(admin.authHeader())
        .send({})
        .expect(404);
    });

    it('Geçersiz UUID formatı → 400', async () => {
      const admin = await loginAs(app, 'ADMIN');

      await request(app.getHttpServer())
        .post('/actuals-first/reversals/agreement-transaction/not-a-uuid')
        .set(admin.authHeader())
        .send({})
        .expect(400);
    });
  });
});
