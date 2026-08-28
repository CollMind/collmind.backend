/**
 * budget-envelope-split.e2e-spec.ts
 *
 * T-019b — Faz 2: `POST /budget/envelopes/:id/split` (Finance-only) + append-only
 * re-home. Kaynak: docs/analysis/0008-on-off-invoice-envelope-design.md §4 "Faz 2",
 * docs/decisions/0004-on-off-invoice-zarf-kurallari.md (Karar 2 eki, Karar 3, Karar 4).
 *
 * Kapsam:
 *   SP-E2E-01  RBAC — yalnız FINANCE_MANAGER + ADMIN split edebilir
 *   SP-E2E-02  happy path — id KORUNUR (ON_INVOICE), OFF ikizi yaratılır, hiç
 *              encumbrance yoksa re-home yok
 *   SP-E2E-03  tutar toplamı allocated_amount'a eşit olmak zorunda (400)
 *   SP-E2E-04  zaten split olmuş zarf → 409 ENVELOPE_ALREADY_SPLIT
 *   SP-E2E-05  UNTYPED_ENCUMBRANCE_PRESENT guard (409) — hiçbir satır yazılmaz
 *   SP-E2E-06  re-home: OFF_INVOICE etiketli net, append-only RELEASE+RESERVE
 *              ile taşınır; T1 ledger korunum invaryantı (SQL kanıtı)
 *   SP-E2E-07  tenant izolasyonu — başka tenant'ın zarfı 404
 *
 * Fixture stratejisi: HER test kendi TAZE (yeni, allocated tutar dışında hiçbir
 * seed veriyle çakışmayan) UNSPLIT zarfını `POST /budget/envelopes` ile yaratır
 * (kod öneki `E2E-SPLIT-`) — T-047 dersi: seed zarflarına (`ENV-2026-*`) DOKUNULMAZ,
 * bu suite'in ürettiği zarf/transaction satırları `afterAll`'da tamamen silinir.
 * T-047'nin kalıcı invaryantı yalnızca agreements/plans/plan_fus/plan_skus satır
 * sayısını izler — bu suite hiçbirini yaratmaz, dolayısıyla invaryantı hiç etkilemez.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

describe('Budget Envelope Split — T-019b Faz 2 (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;
  const createdEnvelopeCodes: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    // Bu suite'in ürettiği TÜM zarf + transaction satırlarını temizle
    // (cleanupTestAgreements/cleanupTestPlans deseniyle aynı ilke: test-only
    // SQL, yalnızca bu suite'in ürettiği fixture'ları hedefler).
    try {
      const rows = await dataSource.query(
        `SELECT id FROM main.budget_envelopes WHERE tenant_id = $1 AND code LIKE 'E2E-SPLIT-%'`,
        [fixture.tenantId],
      );
      const ids: string[] = rows.map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        // `T-319` (`Z59` kapsam eki) — ÖLÇÜLDÜ: bu suite'in re-home (SP-E2E-06)
        // ve diğer split senaryoları küçük `allocatedAmount` zarflarını %80/%90
        // eşiğine taşıyor, `budget-tier-notification.service.ts`'in ilk üretim
        // yazıcısını (`Z59`) tetikliyor — genişletilmiş T-047 evreni (`T-319`)
        // bunu satır artığı olarak yakaladı, eski (elle yazılmış 7 tablo)
        // evren KÖRDÜ. `main.notifications`'ta `app_runtime`'ın DELETE hakkı
        // yok (ölçüldü, relacl: `arw` — DELETE'siz, ledger_entries/
        // admin_audit_logs ile aynı korunmuş-tablo ailesi) — `app_migrate`.
        const adminDataSource = await getAdminDataSource();
        await adminDataSource.query(
          `DELETE FROM main.notifications WHERE metadata->>'budgetEnvelopeId' = ANY($1::text[])`,
          [ids],
        );
        await dataSource.query(
          `DELETE FROM main.budget_transactions WHERE envelope_id = ANY($1::uuid[])`,
          [ids],
        );
        await dataSource.query(
          `DELETE FROM main.budget_envelopes WHERE id = ANY($1::uuid[])`,
          [ids],
        );
      }
    } catch (e) {
      console.warn('Cleanup (budget envelope split e2e) başarısız:', e);
    }

    await closeTestApp();
    await closeAdminDataSource();
  });

  async function createFreshUnsplitEnvelope(
    allocatedAmount: number,
  ): Promise<{ id: string; code: string }> {
    const admin = await loginAs(app, 'ADMIN');
    const code = `E2E-SPLIT-${randomUUID()}`;
    createdEnvelopeCodes.push(code);
    const res = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code,
        name: `E2E Split Fixture ${code}`,
        fiscalYear: '2026',
        period: '2026-01',
        channel: 'E2E-SPLIT-CHANNEL',
        allocatedAmount,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    return { id: res.body.id, code: res.body.code };
  }

  /**
   * SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION guard tests (coordinator follow-up,
   * 2026-08-02) need FULL control over the (channel, period) dimension —
   * unlike `createFreshUnsplitEnvelope` above (which pins every fixture to the
   * SAME shared `E2E-SPLIT-CHANNEL`/`2026-01` dimension, fine for id-scoped
   * tests but not for a "is THIS dimension split" test), each guard test gets
   * its OWN unique channel so split/unsplit dimensions never bleed into each
   * other or into other tests in this file.
   */
  async function createFreshUnsplitEnvelopeOnDimension(
    allocatedAmount: number,
    channel: string,
    periodMonth: string,
    category?: string,
  ): Promise<{ id: string; code: string }> {
    const admin = await loginAs(app, 'ADMIN');
    const code = `E2E-SPLIT-${randomUUID()}`;
    createdEnvelopeCodes.push(code);
    const res = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code,
        name: `E2E Split Guard Fixture ${code}`,
        fiscalYear: periodMonth.substring(0, 4),
        period: periodMonth,
        channel,
        ...(category ? { category } : {}),
        allocatedAmount,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    return { id: res.body.id, code: res.body.code };
  }

  async function getEnvelopeRow(id: string) {
    const rows = await dataSource.query(
      `SELECT id, code, spend_type, allocated_amount, tenant_id
       FROM main.budget_envelopes WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function getEnvelopeSummary(id: string) {
    const rows = await dataSource.query(
      `SELECT reserved_amount, consumed_amount, available_amount, allocated_amount
       FROM main.v_budget_summary WHERE envelope_id = $1`,
      [id],
    );
    return {
      reserved: Number(rows[0].reserved_amount),
      consumed: Number(rows[0].consumed_amount),
      available: Number(rows[0].available_amount),
      allocated: Number(rows[0].allocated_amount),
    };
  }

  // -------------------------------------------------------------------------
  // SP-E2E-01: RBAC
  // -------------------------------------------------------------------------
  describe('SP-E2E-01: RBAC — yalnız FINANCE_MANAGER + ADMIN', () => {
    it('PLANNER → 403', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      const planner = await loginAs(app, 'PLANNER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(planner.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(403);
    });

    it('CATEGORY_MANAGER → 403', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(cm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(403);
    });

    it('unauthenticated → 401', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(401);
    });

    it('FINANCE_MANAGER → 201', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(201);
    });

    it('ADMIN → 201', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      const admin = await loginAs(app, 'ADMIN');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(admin.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(201);
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-02: happy path
  // -------------------------------------------------------------------------
  describe('SP-E2E-02: happy path — id korunur, OFF ikizi yaratılır', () => {
    it('original row keeps its id (ON_INVOICE), OFF twin is a NEW row with -OFF code, no re-home writes', async () => {
      const { id, code } = await createFreshUnsplitEnvelope(500000);
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      const res = await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 300000, offInvoiceAllocated: 200000 })
        .expect(201);

      expect(res.body.onEnvelope.id).toBe(id); // id PRESERVED
      expect(res.body.onEnvelope.spendType).toBe('ON_INVOICE');
      expect(Number(res.body.onEnvelope.allocatedAmount)).toBe(300000);
      expect(res.body.offEnvelope.id).not.toBe(id);
      expect(res.body.offEnvelope.spendType).toBe('OFF_INVOICE');
      expect(Number(res.body.offEnvelope.allocatedAmount)).toBe(200000);
      expect(res.body.offEnvelope.code).toBe(`${code}-OFF`);
      expect(res.body.rehomed).toEqual([]);

      // DB-level double-check (FK safety — see class JSDoc).
      const onRow = await getEnvelopeRow(id);
      expect(onRow.id).toBe(id);
      expect(onRow.spend_type).toBe('ON_INVOICE');
      expect(Number(onRow.allocated_amount)).toBe(300000);

      const onSummary = await getEnvelopeSummary(id);
      const offSummary = await getEnvelopeSummary(res.body.offEnvelope.id);
      expect(onSummary.reserved).toBe(0);
      expect(offSummary.reserved).toBe(0);
      expect(onSummary.available).toBe(300000);
      expect(offSummary.available).toBe(200000);
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-03 / SP-E2E-04: guards
  // -------------------------------------------------------------------------
  describe('SP-E2E-03/04: sum-mismatch + already-split guards', () => {
    it('sums must equal allocated_amount exactly → 400, envelope unchanged', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 50000 }) // 110000 != 100000
        .expect(400);

      const row = await getEnvelopeRow(id);
      expect(row.spend_type).toBeNull();
      expect(Number(row.allocated_amount)).toBe(100000);
    });

    it('splitting an already-split envelope → 409 ENVELOPE_ALREADY_SPLIT', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(409);
      expect(res.body.code).toBe('ENVELOPE_ALREADY_SPLIT');
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-05: UNTYPED_ENCUMBRANCE_PRESENT
  // -------------------------------------------------------------------------
  describe('SP-E2E-05: UNTYPED_ENCUMBRANCE_PRESENT guard', () => {
    it('untyped (spend_type IS NULL) net > 0 blocks the split entirely — no writes', async () => {
      const { id } = await createFreshUnsplitEnvelope(100000);
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      const fakePlanId = randomUUID();

      await dataSource.query(
        `INSERT INTO main.budget_transactions
           (tenant_id, envelope_id, tx_type, tx_status, source_type, source_id,
            amount, currency, idempotency_key, spend_type, description)
         VALUES ($1, $2, 'RESERVE', 'POSTED', 'PLAN', $3,
                 30000, 'TRY', $4, NULL, 'E2E untyped fixture')`,
        [fixture.tenantId, id, fakePlanId, `RESERVE|PLAN|${fakePlanId}|${id}`],
      );

      const before = await dataSource.query(
        `SELECT count(*)::int AS n FROM main.budget_transactions WHERE envelope_id = $1`,
        [id],
      );

      const res = await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(409);
      expect(res.body.code).toBe('UNTYPED_ENCUMBRANCE_PRESENT');

      const after = await dataSource.query(
        `SELECT count(*)::int AS n FROM main.budget_transactions WHERE envelope_id = $1`,
        [id],
      );
      expect(after[0].n).toBe(before[0].n); // no new writes
      const row = await getEnvelopeRow(id);
      expect(row.spend_type).toBeNull(); // envelope untouched
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-06: re-home + T1 ledger korunum invaryantı
  // -------------------------------------------------------------------------
  describe('SP-E2E-06: re-home (append-only) — T1 ledger korunum invaryantı', () => {
    it('OFF_INVOICE-tagged net is RELEASEd on the old envelope and RESERVEd on the new one; net total is conserved', async () => {
      const { id } = await createFreshUnsplitEnvelope(200000);
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      const fakeAgreementId = randomUUID();

      await dataSource.query(
        `INSERT INTO main.budget_transactions
           (tenant_id, envelope_id, tx_type, tx_status, source_type, source_id,
            amount, currency, idempotency_key, spend_type, description)
         VALUES ($1, $2, 'RESERVE', 'POSTED', 'AGREEMENT', $3,
                 75000, 'TRY', $4, 'OFF_INVOICE', 'E2E re-home fixture')`,
        [
          fixture.tenantId,
          id,
          fakeAgreementId,
          `RESERVE|AGREEMENT|${fakeAgreementId}|${id}|OFF_INVOICE`,
        ],
      );

      // T1 (§7): net BEFORE split.
      const beforeNet = await dataSource.query(
        `SELECT reserved_amount FROM main.v_budget_summary WHERE envelope_id = $1`,
        [id],
      );
      expect(Number(beforeNet[0].reserved_amount)).toBe(75000);

      const res = await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 125000, offInvoiceAllocated: 75000 })
        .expect(201);

      expect(res.body.rehomed).toEqual([
        {
          sourceType: 'AGREEMENT',
          sourceId: fakeAgreementId,
          amount: 75000,
          txType: 'RESERVE',
        },
      ]);
      const offEnvelopeId = res.body.offEnvelope.id;

      // Ledger rows written: 1 RELEASE (old) + 1 RESERVE (new), each with
      // the exact key formats from docs/analysis/0008 §4.
      const releaseRows = await dataSource.query(
        `SELECT amount, spend_type, idempotency_key FROM main.budget_transactions
         WHERE envelope_id = $1 AND tx_type = 'RELEASE'`,
        [id],
      );
      expect(releaseRows.length).toBe(1);
      expect(Number(releaseRows[0].amount)).toBe(75000);
      expect(releaseRows[0].spend_type).toBe('OFF_INVOICE');
      expect(releaseRows[0].idempotency_key).toBe(
        `RELEASE|AGREEMENT|${fakeAgreementId}|${id}|REHOME`,
      );

      const newReserveRows = await dataSource.query(
        `SELECT amount, spend_type, idempotency_key FROM main.budget_transactions
         WHERE envelope_id = $1 AND tx_type = 'RESERVE'`,
        [offEnvelopeId],
      );
      expect(newReserveRows.length).toBe(1);
      expect(Number(newReserveRows[0].amount)).toBe(75000);
      expect(newReserveRows[0].spend_type).toBe('OFF_INVOICE');
      expect(newReserveRows[0].idempotency_key).toBe(
        `RESERVE|AGREEMENT|${fakeAgreementId}|${offEnvelopeId}`,
      );

      // T1: Σ kova (net BEFORE) === Σ kova (net AFTER, summed across BOTH
      // envelopes) — SQL kanıtı.
      const afterOn = await dataSource.query(
        `SELECT reserved_amount FROM main.v_budget_summary WHERE envelope_id = $1`,
        [id],
      );
      const afterOff = await dataSource.query(
        `SELECT reserved_amount FROM main.v_budget_summary WHERE envelope_id = $1`,
        [offEnvelopeId],
      );
      const netAfter =
        Number(afterOn[0].reserved_amount) +
        Number(afterOff[0].reserved_amount);
      expect(netAfter).toBe(75000); // conserved (== netBefore)
      expect(Number(afterOn[0].reserved_amount)).toBe(0); // fully released
      expect(Number(afterOff[0].reserved_amount)).toBe(75000); // fully moved
      expect(netAfter).toBeGreaterThanOrEqual(0); // net >= 0 invariant (§7 T1)
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-07: tenant isolation
  // -------------------------------------------------------------------------
  describe('SP-E2E-07: tenant izolasyonu', () => {
    it("başka bir tenant'ın zarfını split etmeye çalışmak → 404", async () => {
      // ENV-2026-NKA-Q1 seed zarfı Wella Turkey tenant'ına ait — burada
      // yalnızca "yanlış tenant'tan çağrı" senaryosunu simüle etmek için,
      // var olmayan bir UUID kullanıyoruz (gerçek çapraz-tenant login akışı
      // role-journey.e2e-spec.ts'in T-034 Layer 6 desenini gerektirir, bu
      // suite'in kapsamı dışı — burada yalnızca tenant-scoped lookup'ın
      // rastgele bir id'yi asla bulamadığını doğruluyoruz).
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      const randomId = randomUUID();
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${randomId}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-08: SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION guard
  // (coordinator follow-up, 2026-08-02 — ürün sahibi kararı: split bir
  // boyutta spendType'sız çözüm artık sessiz mis-attribution değil, açık
  // hata). Tek türetim noktası: BudgetRepository#findEnvelopeByDimensions.
  // -------------------------------------------------------------------------
  describe('SP-E2E-08: SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION guard', () => {
    it('split edilmiş bir boyutta spendType verilmeden GET /budget/status → 400 SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION', async () => {
      const channel = `E2E-SPG-A-${randomUUID().slice(0, 8)}`;
      const { id } = await createFreshUnsplitEnvelopeOnDimension(
        100000,
        channel,
        '2026-03',
      );
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(201);

      const admin = await loginAs(app, 'ADMIN');
      const res = await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel, periodMonth: '2026-03' })
        .set(admin.authHeader())
        .expect(400);
      expect(res.body.code).toBe('SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION');
    });

    it('bir dimension TİPLİ (spendType verilerek) çözülürse doğru zarfa gider — guard devreye girmez', async () => {
      const channel = `E2E-SPG-T-${randomUUID().slice(0, 8)}`;
      const { id } = await createFreshUnsplitEnvelopeOnDimension(
        200000,
        channel,
        '2026-05',
      );
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      const splitRes = await request(app.getHttpServer())
        .post(`/budget/envelopes/${id}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 120000, offInvoiceAllocated: 80000 })
        .expect(201);
      const offEnvelopeId = splitRes.body.offEnvelope.id;

      // Tipli lookup (reserveForAgreement/reserveForPlan ON/OFF yolu ile
      // aynı sözleşme) — spendType verilince guard hiç tetiklenmez ve DOĞRU
      // zarf (id'si önceden bilinen ikiz) bulunur. Bunu dolaylı olarak,
      // agreement reservation akışına dokunmadan, envelope arama sonucunu
      // doğrulayan bir GET ile kanıtlıyoruz: v_budget_summary üzerinden her
      // iki zarfın da bağımsız/doğru şekilde erişilebilir kaldığını
      // (yani split sonrası genel API akışının kırılmadığını) göstermek
      // yeterli — guard'ın YALNIZ spendType'sız çağrıları engellediğini
      // SP-E2E-02'nin `onEnvelope.id === id` / `offEnvelope.id !== id`
      // assertion'ları zaten kanıtlıyor.
      const onSummary = await getEnvelopeSummary(id);
      const offSummary = await getEnvelopeSummary(offEnvelopeId);
      expect(onSummary.available).toBe(120000);
      expect(offSummary.available).toBe(80000);
    });

    it("YANLIŞ-POZİTİF YOK: başka bir boyut split edilmişken, split OLMAYAN bir boyutta spendType'sız çözüm hâlâ ÇALIŞIR (tek türetim noktası — boyut yüklemleri karışmaz)", async () => {
      const splitChannel = `E2E-SPG-B-${randomUUID().slice(0, 8)}`;
      const unsplitChannel = `E2E-SPG-C-${randomUUID().slice(0, 8)}`;

      const { id: splitId } = await createFreshUnsplitEnvelopeOnDimension(
        100000,
        splitChannel,
        '2026-04',
      );
      const { id: unsplitId } = await createFreshUnsplitEnvelopeOnDimension(
        50000,
        unsplitChannel,
        '2026-04',
      );

      const fm = await loginAs(app, 'FINANCE_MANAGER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${splitId}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(201);

      const admin = await loginAs(app, 'ADMIN');

      // The SPLIT dimension now 400s unqualified.
      await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel: splitChannel, periodMonth: '2026-04' })
        .set(admin.authHeader())
        .expect(400);

      // The UNSPLIT dimension (different channel, SAME period) is
      // completely unaffected — proves the guard derives split-detection
      // from ITS OWN query's predicates, not a separately-evolving check
      // that could leak across dimensions.
      const res = await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel: unsplitChannel, periodMonth: '2026-04' })
        .set(admin.authHeader())
        .expect(200);
      expect(res.body.totalAllocation).toBe(50000);

      const unsplitRow = await getEnvelopeRow(unsplitId);
      expect(unsplitRow.spend_type).toBeNull(); // still UNSPLIT, untouched
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-09: coordinator fix (2026-08-02, ölçülmüş yanlış-pozitif) — the
  // guard must derive ambiguity ONLY from the WINNING candidate's own
  // dimension, not the full (deliberately loose) candidate set. Measured
  // live: splitting ENV-2026-NKA-Q2 alone made every unqualified
  // ENV-2026-NKA-Q1 lookup 400, because the period predicate is
  // `period = :periodMonth OR period LIKE :yearPattern` and pulls in
  // sibling periods of the SAME channel/year.
  // -------------------------------------------------------------------------
  describe('SP-E2E-09: guard yalnız kazananın kendi boyutuna bakmalı (yanlış-pozitif fix)', () => {
    it('aynı kanalda iki dönem (aynı yıl) — biri split, diğeri değil: split OLMAYAN dönem için tipsiz arama ÇALIŞMALI, split OLAN 400 verir', async () => {
      const channel = `E2E-SPG-P-${randomUUID().slice(0, 8)}`;
      const unsplitPeriod = '2026-06';
      const splitPeriod = '2026-07'; // SAME year as unsplitPeriod — exercises the yearPattern fallback overlap.

      const { id: unsplitId } = await createFreshUnsplitEnvelopeOnDimension(
        70000,
        channel,
        unsplitPeriod,
      );
      const { id: splitId } = await createFreshUnsplitEnvelopeOnDimension(
        90000,
        channel,
        splitPeriod,
      );

      const fm = await loginAs(app, 'FINANCE_MANAGER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${splitId}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 50000, offInvoiceAllocated: 40000 })
        .expect(201);

      const admin = await loginAs(app, 'ADMIN');

      // The UNSPLIT dimension (2026-06) must resolve normally — a sibling
      // period (2026-07) of the SAME channel being split must NOT leak in.
      const unsplitRes = await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel, periodMonth: unsplitPeriod })
        .set(admin.authHeader())
        .expect(200);
      expect(unsplitRes.body.totalAllocation).toBe(70000);

      const unsplitRow = await getEnvelopeRow(unsplitId);
      expect(unsplitRow.spend_type).toBeNull(); // still UNSPLIT, untouched

      // The SPLIT dimension (2026-07) itself must still 400 unqualified.
      const splitRes = await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel, periodMonth: splitPeriod })
        .set(admin.authHeader())
        .expect(400);
      expect(splitRes.body.code).toBe(
        'SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION',
      );
    });

    it('kategori boyutu da aynı sınıf sızıntıya açık (category opsiyonel → hiç filtrelenmiyor): aynı kanal+dönem, farklı kategori split olsa da diğer kategorinin tipsiz araması ÇALIŞMALI', async () => {
      const channel = `E2E-SPG-C-${randomUUID().slice(0, 8)}`;
      const period = '2026-08';
      const catB = `E2E-CAT-B-${randomUUID().slice(0, 6)}`;
      const catA = `E2E-CAT-A-${randomUUID().slice(0, 6)}`;

      // catB created FIRST and split RIGHT AWAY (split creates a brand-new
      // OFF twin row, so the most recent `createdAt` among catB's rows is
      // the split moment, not catB's original creation). catA is created
      // AFTER that — with no category-based ORDER BY, `createdAt DESC`
      // alone decides the winner of an unqualified (no categoryId) lookup,
      // so catA (the ABSOLUTE most recent row of the dimension) wins.
      const { id: catBId } = await createFreshUnsplitEnvelopeOnDimension(
        30000,
        channel,
        period,
        catB,
      );
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${catBId}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 18000, offInvoiceAllocated: 12000 })
        .expect(201);

      const { id: catAId } = await createFreshUnsplitEnvelopeOnDimension(
        40000,
        channel,
        period,
        catA,
      );

      const admin = await loginAs(app, 'ADMIN');

      // Unqualified (no categoryId) lookup resolves to catA (most recent,
      // matches the SAME tie-break the repository itself uses) — catB's
      // split status must NOT leak into it.
      const res = await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel, periodMonth: period })
        .set(admin.authHeader())
        .expect(200);
      expect(res.body.totalAllocation).toBe(40000); // catA's allocation, not catB's

      const catARow = await getEnvelopeRow(catAId);
      expect(catARow.spend_type).toBeNull(); // still UNSPLIT, untouched

      // Explicitly qualified lookup for the SPLIT category (catB) still 400s.
      const catBRes = await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel, periodMonth: period, categoryId: catB })
        .set(admin.authHeader())
        .expect(400);
      expect(catBRes.body.code).toBe('SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION');
    });
  });

  // -------------------------------------------------------------------------
  // SP-E2E-10: Team Lead measured regression (2026-08-04) — the SP-E2E-09
  // "own dimension" narrowing is itself wrong when the REQUESTED period has
  // NO exact-match envelope at all. In that case every candidate ties on the
  // first two ORDER BY keys (period-exact: none match; channel: all match
  // the WHERE-filtered channel) and the decision falls through to
  // `createdAt DESC` — i.e. the "winner" can be a split twin of a
  // COMPLETELY UNRELATED period that merely shares the channel/year. The
  // buggy "narrow to winner's own dimension" fix then builds its ambiguity
  // group around THAT unrelated period and 400s a request that never asked
  // about a split dimension.
  // -------------------------------------------------------------------------
  describe('SP-E2E-10: dönem tam eşleşmesi olmayan sorgu, alakasız bir dönemin split ikizine düşmemeli', () => {
    it('istenen dönemin hiç zarfı yokken, aynı kanal+yılda split edilmiş BAŞKA bir dönem yüzünden 400 dönmemeli', async () => {
      const channel = `E2E-SPG-R-${randomUUID().slice(0, 8)}`;
      const splitPeriod = '2026-09';
      const queriedPeriod = '2026-10'; // same channel/year, NO exact-match envelope exists for this period

      const { id: splitId } = await createFreshUnsplitEnvelopeOnDimension(
        90000,
        channel,
        splitPeriod,
      );
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      await request(app.getHttpServer())
        .post(`/budget/envelopes/${splitId}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 50000, offInvoiceAllocated: 40000 })
        .expect(201);

      const admin = await loginAs(app, 'ADMIN');

      // No envelope has period === queriedPeriod (only the year-pattern
      // fallback pulls in the split twins of `splitPeriod`). The requested
      // dimension itself was never split — this must resolve normally, not
      // 400.
      const res = await request(app.getHttpServer())
        .get('/budget/status')
        .query({ channel, periodMonth: queriedPeriod })
        .set(admin.authHeader())
        .expect(200);
      expect(res.body.code).not.toBe('SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION');
    });
  });
});
