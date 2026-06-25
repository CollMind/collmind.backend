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
 * Fixture stratejisi:
 *   - loadE2EFixture ile seed'deki APPROVED agreement'ı bul
 *   - Her reversal testi için createOffInvoiceTransaction ile yeni transaction yarat
 *   - "tekrar reverse" testi: aynı transactionId ile ikinci kez dene
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  createOffInvoiceTransaction,
  cleanupTestTransactions,
  E2EFixture,
} from './helpers/seed-e2e';

describe('Reversal (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    // Önceki koşumlardan kalan E2E test transaction'larını temizle (cap overflow önlemi)
    await cleanupTestTransactions(app, fixture.approvedAgreementId);
  });

  afterAll(async () => {
    await closeTestApp();
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
        fixture.approvedAgreementId,
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
        fixture.approvedAgreementId,
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
        fixture.approvedAgreementId,
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
      const agreementId = fixture.approvedAgreementId;

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
