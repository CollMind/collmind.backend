/**
 * settlement-budget-release.e2e-spec.ts
 *
 * T-030 — Agreement bütçe rezerv release'i (F1 sızıntı fix'i).
 * Kaynak: docs/analysis/0003-agreement-reservation-lifecycle.md §7 (BR-E2E-*)
 *
 * Kapsam:
 *   BR-E2E-01  close öncesi/sonrası view: reserved azalır, consumed birebir
 *              aynı kalır, available artar
 *   BR-E2E-02  kısmi tüketimli close — Ö2 sayısal kanıtı (0003 §3): TAM net
 *              release, `reserve − consumed` DEĞİL
 *   BR-E2E-03  tekrar close → 409 ALREADY_SETTLED + RELEASE sayısı hâlâ 1
 *   BR-E2E-04  cancel → net rezerv release edilir, negatife düşmez
 *   BR-E2E-05  reject (approve öncesi) → no-op, budget'a hiç yazılmaz
 *   BR-E2E-06  reversal + close → çifte iade yok (reserved=0, consumed=0,
 *              available=allocated)
 *   BR-E2E-09  tenant izolasyonu — yanlış tenantId ile release çağrısı hiçbir
 *              satır yazmaz, doğru tenant'ın rezervi bozulmadan kalır
 *
 * Fixture stratejisi: her test kendi APPROVED (veya PENDING) agreement'ını
 * `createAndApproveAgreement`/`createAndSubmitAgreement` ile yaratır (bkz.
 * test/helpers/seed-e2e.ts) — CLOSED/CANCELLED/REJECTED terminal state'ler
 * geri alınamaz, bu yüzden testler arasında paylaşılan agreement kullanılmaz
 * (role-journey.e2e-spec.ts C1-C9 ile aynı desen). Envelope NKA-Q2 2026-02
 * (allocated=600.000) — mevcut seed verisiyle çakışmayacak kadar headroom var.
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
  createAndSubmitAgreement,
  createOffInvoiceTransaction,
  cleanupTestTransactions,
  E2EFixture,
} from './helpers/seed-e2e';
import { BudgetReservationService } from '../src/modules/shared/budget/budget-reservation.service';

describe('Settlement — Budget Reservation Release (T-030, E2E)', () => {
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
        resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
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
    await closeTestApp();
  });

  async function newApprovedAgreement(
    capTotalAmount: number,
    namePrefix: string,
  ) {
    return createAndApproveAgreement(app, {
      tenantId: fixture.tenantId,
      cplId: fixture.cplId,
      channelId: CHANNEL_NKA,
      fuId: FU_WELLA_HC_500ML,
      tacticId: TACTIC_PROMO,
      mechanicId: MECHANIC_DISCOUNT,
      capTotalAmount,
      namePrefix,
    });
  }

  // Envelope summary bir REST endpoint'i olarak açık değil (yalnızca
  // GET /budget/envelopes/:id/reserved var, tam summary yok) — v_budget_summary
  // view'ı doğrudan sorgulanır (settlement.e2e-spec.ts'teki dataSource.query
  // deseniyle aynı).
  async function getSummary(envelopeId: string) {
    const rows = await dataSource.query(
      `SELECT reserved_amount, consumed_amount, available_amount, allocated_amount
       FROM main.v_budget_summary WHERE envelope_id = $1`,
      [envelopeId],
    );
    if (!rows?.[0]) {
      throw new Error(
        `getSummary: envelope ${envelopeId} v_budget_summary'de bulunamadı`,
      );
    }
    return {
      reservedAmount: Number(rows[0].reserved_amount),
      consumedAmount: Number(rows[0].consumed_amount),
      availableAmount: Number(rows[0].available_amount),
      allocatedAmount: Number(rows[0].allocated_amount),
    };
  }

  // -------------------------------------------------------------------------
  // BR-E2E-01: close öncesi/sonrası — reserved düşer, consumed sabit, available artar
  // -------------------------------------------------------------------------

  describe('BR-E2E-01: close öncesi/sonrası view', () => {
    it('reserved azalır, consumed birebir aynı kalır, available tam cap kadar artar', async () => {
      const { agreementId, envelopeId, capTotalAmount } =
        await newApprovedAgreement(15000, 'E2E-BR01');

      const before = await getSummary(envelopeId);

      const admin = await loginAs(app, 'ADMIN');
      const closeRes = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'BR-E2E-01' })
        .expect(201);
      expect(closeRes.body.status).toBe('CLOSED');

      const after = await getSummary(envelopeId);

      expect(after.reservedAmount).toBeCloseTo(
        before.reservedAmount - capTotalAmount,
        2,
      );
      expect(after.consumedAmount).toBeCloseTo(before.consumedAmount, 2); // birebir aynı
      expect(after.availableAmount).toBeCloseTo(
        before.availableAmount + capTotalAmount,
        2,
      );
    });
  });

  // -------------------------------------------------------------------------
  // BR-E2E-02: kısmi tüketimli close — Ö2 sayısal kanıtı (0003 §3)
  // -------------------------------------------------------------------------

  describe('BR-E2E-02: kısmi tüketimli close — TAM net release (Ö2)', () => {
    it('cap=20000, DEBIT(consumed)=12000 → close sonrası available tam +20000 artar (+8000 DEĞİL)', async () => {
      const { agreementId, envelopeId } = await newApprovedAgreement(
        20000,
        'E2E-BR02',
      );

      await createOffInvoiceTransaction(
        app,
        agreementId,
        `BR02-${Date.now()}`,
        12000,
      );

      const before = await getSummary(envelopeId);
      // Ö2 ön koşulu: bu agreement'ın kendi payı reserved havuzunda 20000,
      // consumed havuzunda 12000 olarak görünmeli (diğer testlerle paylaşılan
      // envelope'da mutlak değerler değil, close öncesi/sonrası DELTA'lar
      // doğrulanır — bu da testin envelope-izolasyonsuz paralel koşumlara
      // dayanıklı olmasını sağlar).

      const admin = await loginAs(app, 'ADMIN');
      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'BR-E2E-02' })
        .expect(201);

      const after = await getSummary(envelopeId);

      // TAM net release: reserved düşüşü = 20000 (cap), consumed DEĞİŞMEZ.
      expect(before.reservedAmount - after.reservedAmount).toBeCloseTo(
        20000,
        2,
      );
      expect(after.consumedAmount).toBeCloseTo(before.consumedAmount, 2);
      // available artışı = 20000 (TAM cap) — Ö3'teki yanlış "8000" DEĞİL.
      expect(after.availableAmount - before.availableAmount).toBeCloseTo(
        20000,
        2,
      );

      await cleanupTestTransactions(app, agreementId);
    });
  });

  // -------------------------------------------------------------------------
  // BR-E2E-03: tekrar close → 409 + RELEASE sayısı hâlâ 1
  // -------------------------------------------------------------------------

  describe('BR-E2E-03: tekrar close → 409 ALREADY_SETTLED, RELEASE sayısı 1', () => {
    it('ikinci close denemesi 409 döner ve budget_transactions içinde tek bir RELEASE kalır', async () => {
      const { agreementId, envelopeId } = await newApprovedAgreement(
        8000,
        'E2E-BR03',
      );

      const admin = await loginAs(app, 'ADMIN');
      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'BR-E2E-03 ilk close' })
        .expect(201);

      const secondClose = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'BR-E2E-03 ikinci close' })
        .expect(409);
      expect(JSON.stringify(secondClose.body)).toContain('ALREADY_SETTLED');

      const releases = await dataSource.query(
        `SELECT id, amount FROM main.budget_transactions
         WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2
           AND envelope_id = $3 AND tx_type = 'RELEASE'`,
        [fixture.tenantId, agreementId, envelopeId],
      );
      expect(releases).toHaveLength(1);
      expect(Number(releases[0].amount)).toBeCloseTo(8000, 2);
    });
  });

  // -------------------------------------------------------------------------
  // BR-E2E-04: cancel → net rezerv release edilir, negatife düşmez
  // -------------------------------------------------------------------------

  describe('BR-E2E-04: cancel → net release, negatife düşmez', () => {
    it('APPROVED agreement cancel edilir → reserved düşer, available artar, negatif olmaz', async () => {
      const { agreementId, envelopeId, capTotalAmount } =
        await newApprovedAgreement(5000, 'E2E-BR04');

      const before = await getSummary(envelopeId);

      const admin = await loginAs(app, 'ADMIN');
      const cancelRes = await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/cancel`)
        .set(admin.authHeader())
        .send({ reason: 'BR-E2E-04' })
        .expect(200);
      expect(cancelRes.body.status).toBe('CANCELLED');

      const after = await getSummary(envelopeId);
      expect(after.reservedAmount).toBeCloseTo(
        before.reservedAmount - capTotalAmount,
        2,
      );
      expect(after.reservedAmount).toBeGreaterThanOrEqual(0); // negatife düşmez
      expect(after.availableAmount).toBeCloseTo(
        before.availableAmount + capTotalAmount,
        2,
      );

      // İkinci cancel denemesi: state machine artık CANCELLED → 400, ve
      // ikinci bir RELEASE YAZILMAZ (idempotency key çakışması no-op'a düşer,
      // ama zaten state guard'ı önce devreye girer).
      await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/cancel`)
        .set(admin.authHeader())
        .send({ reason: 'BR-E2E-04 tekrar' })
        .expect(400);

      const releases = await dataSource.query(
        `SELECT id FROM main.budget_transactions
         WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2
           AND tx_type = 'RELEASE'`,
        [fixture.tenantId, agreementId],
      );
      expect(releases).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // BR-E2E-05: reject (approve öncesi) → no-op, budget'a hiç yazılmaz
  // -------------------------------------------------------------------------

  describe('BR-E2E-05: reject (PENDING, approve öncesi) → no-op', () => {
    it('PENDING agreement reject edilir → REJECTED, hiçbir budget_transactions satırı yazılmaz', async () => {
      const agreementId = await createAndSubmitAgreement(app, {
        tenantId: fixture.tenantId,
        cplId: fixture.cplId,
        channelId: CHANNEL_NKA,
        fuId: FU_WELLA_HC_500ML,
        tacticId: TACTIC_PROMO,
        mechanicId: MECHANIC_DISCOUNT,
        capTotalAmount: 3000,
        namePrefix: 'E2E-BR05',
      });

      // T-028e: reject() de AgreementService#assertCmDecisionScope'a tabi —
      // FU_WELLA_HC_500ML (HAIR_CARE) manager@wella.com'un (CATEGORY_MANAGER)
      // scope'unda (CAT-SAC-BOYASI/CAT-SET-BOYA) DEĞİL, bu yüzden kategori
      // scope'una tabi OLMAYAN FINANCE_MANAGER kullanılır (segregation-of-duties
      // korunur — reject eden farklı hesap).
      const financeApprover = await loginAs(app, 'FINANCE_MANAGER');
      const rejectRes = await request(app.getHttpServer())
        .post(`/agreements/${agreementId}/reject`)
        .set(financeApprover.authHeader())
        .send({ reason: 'BR-E2E-05' })
        .expect(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      const txs = await dataSource.query(
        `SELECT id FROM main.budget_transactions
         WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2`,
        [fixture.tenantId, agreementId],
      );
      expect(txs).toHaveLength(0); // hiç RESERVE olmadı, hiç RELEASE de yazılmadı
    });
  });

  // -------------------------------------------------------------------------
  // BR-E2E-06: reversal + close → çifte iade yok
  // -------------------------------------------------------------------------

  describe('BR-E2E-06: reversal + close → çifte iade yok', () => {
    it('DEBIT tersine çevrilir (consumed→0), sonra close (reserved→0) → available tam allocated′a döner', async () => {
      const { agreementId, envelopeId, capTotalAmount } =
        await newApprovedAgreement(9000, 'E2E-BR06');

      const before = await getSummary(envelopeId);

      const transactionId = await createOffInvoiceTransaction(
        app,
        agreementId,
        `BR06-${Date.now()}`,
        4000,
      );

      const afterDebit = await getSummary(envelopeId);
      expect(afterDebit.consumedAmount).toBeCloseTo(
        before.consumedAmount + 4000,
        2,
      );

      const admin = await loginAs(app, 'ADMIN');
      await request(app.getHttpServer())
        .post(`/actuals-first/reversals/agreement-transaction/${transactionId}`)
        .set(admin.authHeader())
        .send({ justification: 'BR-E2E-06 reversal' })
        .expect(200);

      const afterReversal = await getSummary(envelopeId);
      expect(afterReversal.consumedAmount).toBeCloseTo(
        before.consumedAmount,
        2,
      ); // CREDIT geri aldı

      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'BR-E2E-06 close' })
        .expect(201);

      const afterClose = await getSummary(envelopeId);
      // reserved bu agreement'ın cap'i kadar tam release edildi (before zaten
      // bu agreement'ın kendi RESERVE'ini içeriyordu — approve sonrası alındı),
      // consumed reversal'dan beri sabit → available tam capTotalAmount kadar
      // artar (çifte iade yok: reversal'ın consumed'ı sıfırlaması ile close'un
      // reserved'ı sıfırlaması birbirinden bağımsız, üst üste binmiyor).
      expect(afterClose.reservedAmount).toBeCloseTo(
        before.reservedAmount - capTotalAmount,
        2,
      );
      expect(afterClose.consumedAmount).toBeCloseTo(before.consumedAmount, 2);
      expect(afterClose.availableAmount).toBeCloseTo(
        before.availableAmount + capTotalAmount,
        2,
      );

      await cleanupTestTransactions(app, agreementId);
    });
  });

  // -------------------------------------------------------------------------
  // BR-E2E-09: tenant izolasyonu
  // -------------------------------------------------------------------------

  describe('BR-E2E-09: tenant izolasyonu', () => {
    it('yanlış tenantId ile release çağrısı hiçbir satır yazmaz; doğru tenant rezervi bozulmadan kalır', async () => {
      const { agreementId, envelopeId, capTotalAmount } =
        await newApprovedAgreement(6000, 'E2E-BR09');

      const budgetReservationService = app.get(BudgetReservationService);

      const crossTenantReleases =
        await budgetReservationService.releaseAgreementReservation(
          agreementId,
          '00000000-0000-0000-0000-0000000000ee',
          'e2e-user',
          'CLOSE',
        );
      expect(crossTenantReleases).toHaveLength(0); // tenant scope: hiçbir tx bulunamadı

      // Doğru tenant'ın rezervi hâlâ tam (bozulmadı) — gerçek close hâlâ
      // doğru miktarı release edebiliyor.
      const summaryBeforeRealClose = await getSummary(envelopeId);

      const admin = await loginAs(app, 'ADMIN');
      await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementId}`)
        .set(admin.authHeader())
        .send({ justification: 'BR-E2E-09 gerçek tenant close' })
        .expect(201);

      const summaryAfterRealClose = await getSummary(envelopeId);
      expect(
        summaryBeforeRealClose.reservedAmount -
          summaryAfterRealClose.reservedAmount,
      ).toBeCloseTo(capTotalAmount, 2);

      // Yanlış tenant için hiçbir RELEASE satırı yazılmadığını da doğrudan kanıtla.
      const wrongTenantRows = await dataSource.query(
        `SELECT id FROM main.budget_transactions WHERE tenant_id = $1`,
        ['00000000-0000-0000-0000-0000000000ee'],
      );
      expect(wrongTenantRows).toHaveLength(0);
    });
  });
});
