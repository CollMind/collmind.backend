/**
 * Bölünmüş (split) zarf boyutunda uçtan uca regresyon koruması — T-057.
 *
 * KALICI test (Team Lead kararı 2026-08-04). Başlangıçta geçici bir kanıt
 * betiğiydi, ama içeriği artık daha değerli bir şeyi koruyor: **on-invoice
 * akışının gerçekten ledger'a yazabildiğini**. `postingDate` hatası
 * (`entry.invoiceDate.toISOString()` — TypeORM `type:'date'` kolonları `Date`
 * değil `'YYYY-MM-DD'` string olarak hydrate ediyor) yüzünden on-invoice
 * özelliği bugüne kadar üretimde **tek bir POSTED ledger satırı bile**
 * üretememişti; bu dosya o regresyonun geri gelmesini engelliyor.
 *
 * Kapsadığı yollar (hepsi GERÇEKTEN bölünmüş bir boyutta):
 *   1. `checkBudget` — tip kırılımı (`bySpendType`), mevcut alanlar korunarak
 *   3. `agreement-transaction` — agreement `spend_type`'ına göre tipli zarf
 *   4. `on-invoice` — koşulsuz ON_INVOICE ledger kaydı
 *   5. F4 — `commitAllReservedForPlan` legacy TOTAL dalı
 *
 * Fixture izolasyonu: kendine ait, daha önce hiç kullanılmamış bir dönem
 * kullanır ve `afterAll`'da kendi satırlarını temizler (T-047 satır-sayısı
 * invaryantı bunu üç ardışık koşumda doğruluyor).
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

describe('T-057 — uçtan uca (split dimension, items 1/3/5)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CPL_1: string;
  let CHANNEL_NKA: string;
  let CATEGORY: string;
  let FU: string;
  let TACTIC: string;
  let MECHANIC_OFF: string;

  const PERIOD = '2026-12'; // never used by any other seed/fixture envelope
  const ENV_CODE = `E2E-SPLIT-T057-${Date.now()}`;

  const createdAgreementIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdBatchIds: string[] = [];
  let envelopeId: string;
  let onEnvelopeId: string;
  let offEnvelopeId: string;
  const CAT_ENV_CODE = `E2E-SPLIT-T057-CAT-${Date.now()}`;
  // item 4's on-invoice validation rejects future invoice dates — unlike
  // PERIOD (used only for plan/agreement fixtures, which have no such
  // check), this must be <= today. Dedicated month, no category-scoped
  // envelope exists for NKA in seed data (verified: 0 rows), so no
  // collision risk regardless of reuse.
  const CAT_PERIOD = '2026-07';
  let catEnvelopeId: string;
  let catOnEnvelopeId: string;
  let catOffEnvelopeId: string;

  async function resolveIdByCode(table: string, code: string) {
    const rows = await dataSource.query(
      `SELECT id FROM main.${table} WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId, code],
    );
    if (!rows?.[0]?.id) {
      throw new Error(`fixture missing: ${table}.code=${code}`);
    }
    return rows[0].id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [CPL_1, CHANNEL_NKA, CATEGORY, FU, TACTIC, MECHANIC_OFF] =
      await Promise.all([
        resolveIdByCode('cpls', 'BS0501.50001'),
        resolveIdByCode('channels', 'NKA'),
        resolveIdByCode('categories', 'CAT-SAC-BOYASI'),
        resolveIdByCode('forecasting_units', 'FU-WELLA-HC-500ML'),
        resolveIdByCode('tactics', 'TAC-PROMO'),
        resolveIdByCode('mechanics', 'CPP_OFF_PCT'),
      ]);
  }, 60000);

  afterAll(async () => {
    try {
      // K-2.6.13 KARAR 1 (2026-08-16): `app_runtime`'ın `ledger_entries`/
      // `agreement_transactions`/`admin_audit_logs` üzerinde artık DELETE
      // hakkı YOK (K-2.3.4/K-2.11.6/K-2.11.7/INV-L-003 — defter/denetim
      // kaydı, DB seviyesinde korunur). Bu üç tabloyu hedefleyen satırlar
      // aşağıda `adminDataSource` (app_migrate) kullanır; geri kalanı
      // `dataSource` (app_runtime, hâlâ DELETE'e sahip) üzerinden yürür.
      const adminDataSource = await getAdminDataSource();
      for (const planId of createdPlanIds) {
        await dataSource.query(
          `DELETE FROM main.plan_approval_history WHERE plan_id = $1`,
          [planId],
        );
        await dataSource.query(
          `DELETE FROM main.plan_mechanic_values WHERE plan_fu_id IN (SELECT id FROM main.plan_fus WHERE plan_id = $1)`,
          [planId],
        );
        await dataSource.query(
          `DELETE FROM main.plan_skus WHERE plan_fu_id IN (SELECT id FROM main.plan_fus WHERE plan_id = $1)`,
          [planId],
        );
        await dataSource.query(`DELETE FROM main.plan_fus WHERE plan_id = $1`, [
          planId,
        ]);
        await dataSource.query(
          `DELETE FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1`,
          [planId],
        );
        await dataSource.query(
          `DELETE FROM main.approval_requests WHERE entity_type = 'PLAN' AND entity_id = $1`,
          [planId],
        );
        await dataSource.query(`DELETE FROM main.plans WHERE id = $1`, [
          planId,
        ]);
      }
      for (const agreementId of createdAgreementIds) {
        await adminDataSource.query(
          `DELETE FROM main.ledger_entries WHERE source_id = $1`,
          [agreementId],
        );
        await adminDataSource.query(
          `DELETE FROM main.agreement_transactions WHERE agreement_id = $1`,
          [agreementId],
        );
        await dataSource.query(
          `DELETE FROM main.budget_transactions WHERE source_type = 'AGREEMENT' AND source_id = $1`,
          [agreementId],
        );
        await dataSource.query(
          `DELETE FROM main.approval_requests WHERE entity_type = 'AGREEMENT' AND entity_id = $1`,
          [agreementId],
        );
        await dataSource.query(`DELETE FROM main.agreements WHERE id = $1`, [
          agreementId,
        ]);
      }
      const allEntityIds = [...createdPlanIds, ...createdAgreementIds];
      if (allEntityIds.length > 0) {
        await adminDataSource.query(
          `DELETE FROM main.admin_audit_logs WHERE entity_id = ANY($1::uuid[])`,
          [allEntityIds],
        );
      }
      for (const batchId of createdBatchIds) {
        await adminDataSource.query(
          `DELETE FROM main.ledger_entries WHERE source_id IN (SELECT id FROM main.on_invoice_entries WHERE batch_id = $1)`,
          [batchId],
        );
        await dataSource.query(
          `DELETE FROM main.on_invoice_entries WHERE batch_id = $1`,
          [batchId],
        );
        await dataSource.query(
          `DELETE FROM main.on_invoice_batches WHERE id = $1`,
          [batchId],
        );
      }
      const envRows = await dataSource.query(
        `SELECT id FROM main.budget_envelopes WHERE tenant_id = $1 AND code LIKE $2`,
        [fixture.tenantId, `E2E-SPLIT-T057%`],
      );
      const envIds: string[] = envRows.map((r: { id: string }) => r.id);
      if (envIds.length > 0) {
        await dataSource.query(
          `DELETE FROM main.budget_transactions WHERE envelope_id = ANY($1::uuid[])`,
          [envIds],
        );
        await adminDataSource.query(
          `DELETE FROM main.ledger_entries WHERE budget_envelope_id = ANY($1::uuid[])`,
          [envIds],
        );
        await dataSource.query(
          `DELETE FROM main.budget_envelopes WHERE id = ANY($1::uuid[])`,
          [envIds],
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('T-057 cleanup failed:', e);
    }
    await closeTestApp();
    // M-2 (2026-08-16): bu, dosyanın tek/en-dış `afterAll`'ı — yukarıdaki
    // temizlik `adminDataSource`'ı zaten kullanmış bitirmiş durumda, bu
    // yüzden burada kapatmak güvenli (bkz. admin-datasource.ts JSDoc'u).
    await closeAdminDataSource();
  });

  it('0) fresh envelope + split — dedicated, unused dimension', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const createRes = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code: ENV_CODE,
        name: 'T-057 uçtan uca fixture',
        fiscalYear: '2026',
        period: PERIOD,
        channel: 'NKA',
        allocatedAmount: 300000,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    envelopeId = createRes.body.id;

    const fm = await loginAs(app, 'FINANCE_MANAGER');
    const splitRes = await request(app.getHttpServer())
      .post(`/budget/envelopes/${envelopeId}/split`)
      .set(fm.authHeader())
      .send({ onInvoiceAllocated: 180000, offInvoiceAllocated: 120000 })
      .expect(201);
    onEnvelopeId = splitRes.body.onEnvelope.id;
    offEnvelopeId = splitRes.body.offEnvelope.id;
    expect(onEnvelopeId).toBe(envelopeId); // id preserved
    expect(offEnvelopeId).not.toBe(envelopeId);

    // eslint-disable-next-line no-console
    console.log('T-057 EVIDENCE 0: split created', {
      envelopeId,
      onEnvelopeId,
      offEnvelopeId,
    });
  });

  it('1) item 1 — checkBudget does NOT crash on the split dimension, bySpendType reflects the correct twins', async () => {
    const admin = await loginAs(app, 'ADMIN');

    const createRes = await request(app.getHttpServer())
      .post('/plans')
      .set(admin.authHeader())
      .send({
        planName: `E2E-T057-CHECKBUDGET-${Date.now()}`,
        cplId: CPL_1,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY,
        startDate: `${PERIOD}-05`,
        endDate: `${PERIOD}-25`,
      })
      .expect(201);
    const planId = createRes.body.id;
    createdPlanIds.push(planId);

    const fuRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(admin.authHeader())
      .send({ fuId: FU, planVersion: 1 })
      .expect(201);
    const planFuId = fuRes.body.id;

    const planRes = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(admin.authHeader())
      .expect(200);
    const skuId = planRes.body.planFus.find((f: any) => f.id === planFuId)
      .planSkus[0].skuId;

    await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU}/skus/${skuId}/volume`)
      .set(admin.authHeader())
      .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU}/tactics`)
      .set(admin.authHeader())
      .send({ tactics: { 'MEC-DISCOUNT': 10, CPP_OFF_PCT: 5 }, version: 1 })
      .expect(200);

    const recalcRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/recalculate`)
      .set(admin.authHeader())
      .send({})
      .expect(200);
    expect(Number(recalcRes.body.totalSpend)).toBeGreaterThan(0);
    expect(Number(recalcRes.body.onInvoiceSpend)).toBeGreaterThan(0);
    expect(Number(recalcRes.body.offInvoiceSpend)).toBeGreaterThan(0);

    // Item 1: checkBudget on a SPLIT dimension — must NOT crash.
    const checkRes = await request(app.getHttpServer())
      .get(`/plans/${planId}/budget-check`)
      .set(admin.authHeader())
      .expect(200);

    // eslint-disable-next-line no-console
    console.log(
      'T-057 EVIDENCE 1: checkBudget on split dimension',
      JSON.stringify(checkRes.body),
    );

    expect(checkRes.body.hasBudget).toBe(true);
    expect(checkRes.body.bySpendType.onInvoice.totalAllocation).toBe(180000);
    expect(checkRes.body.bySpendType.offInvoice.totalAllocation).toBe(120000);
    expect(checkRes.body.envelope.allocatedAmount).toBe(300000); // combined 180000+120000
  });

  it('2) item 3 — agreement-transaction resolves the CORRECT typed twin on the split dimension', async () => {
    const admin = await loginAs(app, 'ADMIN');

    const createRes = await request(app.getHttpServer())
      .post('/agreements')
      .set(admin.authHeader())
      .send({
        agreementName: `E2E-T057-AGRTX-${Date.now()}`,
        agreementType: 'STA',
        cplId: CPL_1,
        channelId: CHANNEL_NKA,
        fuId: FU,
        tacticId: TACTIC,
        mechanicId: MECHANIC_OFF,
        skuScope: 'FU',
        capTotalAmount: 50000,
        spendType: 'OFF_INVOICE',
        startDate: `${PERIOD}-05`,
        endDate: `${PERIOD}-25`,
        justification: 'T-057 uçtan uca — item 3',
      })
      .expect(201);
    const agreementId = createRes.body.id;
    createdAgreementIds.push(agreementId);

    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/submit`)
      .set(admin.authHeader())
      .send({})
      .expect(200);

    const fm = await loginAs(app, 'FINANCE_MANAGER');
    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/approve`)
      .set(fm.authHeader())
      .send({})
      .expect(200);

    const txRes = await request(app.getHttpServer())
      .post('/agreement-transactions')
      .set(admin.authHeader())
      .send({
        agreementId,
        invoiceNo: `E2E-T057-INV-${Date.now()}`,
        invoiceDate: `${PERIOD}-10`,
        fiscalPeriod: PERIOD,
        amount: 3000,
        currency: 'TRY',
        notes: 'T-057 uçtan uca item 3',
      })
      .expect(201);

    const ledgerRows = await dataSource.query(
      `SELECT budget_envelope_id, spend_type, amount
         FROM main.ledger_entries
        WHERE source_id = $1`,
      [agreementId],
    );

    // eslint-disable-next-line no-console
    console.log('T-057 EVIDENCE 2: agreement-transaction ledger row', {
      txId: txRes.body.id,
      onEnvelopeId,
      offEnvelopeId,
      ledgerRows,
    });

    expect(ledgerRows.length).toBe(1);
    // MUST resolve to the OFF twin — NOT the ON twin, NOT some unrelated
    // envelope (the exact regression this task's fix closes).
    expect(ledgerRows[0].budget_envelope_id).toBe(offEnvelopeId);
    expect(Number(ledgerRows[0].amount)).toBe(3000);
  });

  it('3) item 5 (F4) — legacy "never reserved" plan on a split dimension commits ON/OFF independently using REAL evidence', async () => {
    const admin = await loginAs(app, 'ADMIN');

    const createRes = await request(app.getHttpServer())
      .post('/plans')
      .set(admin.authHeader())
      .send({
        planName: `E2E-T057-F4-${Date.now()}`,
        cplId: CPL_1,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY,
        startDate: `${PERIOD}-05`,
        endDate: `${PERIOD}-25`,
      })
      .expect(201);
    const planId = createRes.body.id;
    createdPlanIds.push(planId);

    const fuRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(admin.authHeader())
      .send({ fuId: FU, planVersion: 1 })
      .expect(201);
    const planFuId = fuRes.body.id;

    const planRes = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(admin.authHeader())
      .expect(200);
    const skuId = planRes.body.planFus.find((f: any) => f.id === planFuId)
      .planSkus[0].skuId;

    await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU}/skus/${skuId}/volume`)
      .set(admin.authHeader())
      .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU}/tactics`)
      .set(admin.authHeader())
      .send({ tactics: { 'MEC-DISCOUNT': 10, CPP_OFF_PCT: 5 }, version: 1 })
      .expect(200);

    const recalcRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/recalculate`)
      .set(admin.authHeader())
      .send({})
      .expect(200);
    const onSpend = Number(recalcRes.body.onInvoiceSpend);
    const offSpend = Number(recalcRes.body.offInvoiceSpend);
    expect(onSpend).toBeGreaterThan(0);
    expect(offSpend).toBeGreaterThan(0);

    // Simulate the LEGACY "never went through the reserving submit path"
    // scenario (T-056 F1/F4 note: this is proven UNREACHABLE via the live
    // HTTP API today — `/submit` always reserves before PENDING_APPROVAL —
    // so it can only be exercised by direct SQL, mirroring a pre-T-056
    // legacy row or a future admin/import path). NO budget_transactions
    // RESERVE row exists for this plan.
    const adminUser = await dataSource.query(
      `SELECT id FROM main.users WHERE tenant_id = $1 AND email = 'admin@wella.com' LIMIT 1`,
      [fixture.tenantId],
    );
    const approvalRequestId = randomUUID();
    await dataSource.query(
      `INSERT INTO main.approval_requests
         (id, tenant_id, request_type, entity_type, entity_id, requested_by_id, status, current_level)
       VALUES ($1, $2, 'PLAN', 'PLAN', $3, $4, 'PENDING', 1)`,
      [approvalRequestId, fixture.tenantId, planId, adminUser[0].id],
    );
    await dataSource.query(
      `UPDATE main.plans
          SET status = 'PENDING_APPROVAL', approval_request_id = $1,
              submitted_by = $2, submitted_at = now()
        WHERE id = $3`,
      [approvalRequestId, adminUser[0].id, planId],
    );

    const preReserveRows = await dataSource.query(
      `SELECT count(*)::int AS cnt FROM main.budget_transactions
        WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'`,
      [planId],
    );
    expect(preReserveRows[0].cnt).toBe(0); // genuinely "never reserved"

    const cm = await loginAs(app, 'CATEGORY_MANAGER');
    const approveRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/approve`)
      .set(cm.authHeader())
      .send({ comments: 'T-057 F4 uçtan uca' })
      .expect(200);
    expect(approveRes.body.status).toBe('APPROVED');

    const commitRows = await dataSource.query(
      `SELECT envelope_id, spend_type, amount, idempotency_key
         FROM main.budget_transactions
        WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'COMMIT'
        ORDER BY spend_type ASC`,
      [planId],
    );

    // eslint-disable-next-line no-console
    console.log('T-057 EVIDENCE 3 (F4): legacy plan COMMIT rows', {
      onSpend,
      offSpend,
      onEnvelopeId,
      offEnvelopeId,
      commitRows,
    });

    expect(commitRows.length).toBe(2); // ON + OFF, independently — no single fabricated TOTAL commit
    const onCommit = commitRows.find((r: any) => r.spend_type === 'ON_INVOICE');
    const offCommit = commitRows.find(
      (r: any) => r.spend_type === 'OFF_INVOICE',
    );
    expect(onCommit.envelope_id).toBe(onEnvelopeId);
    expect(offCommit.envelope_id).toBe(offEnvelopeId);
    // REAL evidence (adım 4's recalc columns), not a fabricated 50/50 split.
    expect(Number(onCommit.amount)).toBeCloseTo(onSpend, 2);
    expect(Number(offCommit.amount)).toBeCloseTo(offSpend, 2);
  });

  it('4) item 4 — on-invoice processBatch resolves the correct ON_INVOICE twin on a split (category-scoped) dimension', async () => {
    // Item 4's envelope lookup includes `category` (unlike items 1/3/5) —
    // needs its OWN split envelope scoped to a real category so the
    // resolved SKU's category actually matches (CAT-SAC-BOYASI, the same
    // category used by the plan fixtures above).
    const admin = await loginAs(app, 'ADMIN');
    const createRes = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code: CAT_ENV_CODE,
        name: 'T-057 uçtan uca fixture (category-scoped)',
        fiscalYear: '2026',
        period: CAT_PERIOD,
        channel: 'NKA',
        category: 'CAT-SAC-BOYASI',
        allocatedAmount: 300000,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    catEnvelopeId = createRes.body.id;

    const fm = await loginAs(app, 'FINANCE_MANAGER');
    const splitRes = await request(app.getHttpServer())
      .post(`/budget/envelopes/${catEnvelopeId}/split`)
      .set(fm.authHeader())
      .send({ onInvoiceAllocated: 180000, offInvoiceAllocated: 120000 })
      .expect(201);
    catOnEnvelopeId = splitRes.body.onEnvelope.id;
    catOffEnvelopeId = splitRes.body.offEnvelope.id;

    // CUST002 (channel NKA) + SKU 6099350117818 (category CAT-SAC-BOYASI) —
    // real seed rows, not fabricated. Discount amount deliberately unique.
    const csv = [
      'CUSTOMER_CODE,INVOICE_NO,INVOICE_DATE,FISCAL_PERIOD,SKU_CODE,QUANTITY,LIST_PRICE,ACTUAL_PRICE,DISCOUNT,DISCOUNT_TYPE',
      `CUST002,E2E-T057-ITEM4-${Date.now()},${CAT_PERIOD}-10,${CAT_PERIOD},6099350117818,10,185.00,170.00,150.00,CPP_ON`,
    ].join('\n');

    const uploadRes = await request(app.getHttpServer())
      .post('/on-invoice/upload')
      .set(admin.authHeader())
      .attach('file', Buffer.from(csv, 'utf-8'), 'e2e-t057-item4.csv')
      .expect(201);
    const batchId = uploadRes.body.batchId;
    createdBatchIds.push(batchId);
    expect(uploadRes.body.validation.lineAnalysis.valid).toBe(1);
    expect(uploadRes.body.validation.lineAnalysis.errors).toBe(0);

    const processRes = await request(app.getHttpServer())
      .post(`/on-invoice/${batchId}/process`)
      .set(admin.authHeader())
      .send({})
      .expect(201);

    const entryRows = await dataSource.query(
      `SELECT id, status, validation_status, budget_envelope_id, validation_errors
         FROM main.on_invoice_entries WHERE batch_id = $1`,
      [batchId],
    );
    const ledgerRows = await dataSource.query(
      `SELECT le.budget_envelope_id, le.spend_type, le.amount
         FROM main.ledger_entries le
         JOIN main.on_invoice_entries e ON e.id = le.source_id
        WHERE e.batch_id = $1`,
      [batchId],
    );

    expect(entryRows.length).toBe(1);
    expect(entryRows[0].status).toBe('POSTED');
    expect(entryRows[0].budget_envelope_id).toBe(catOnEnvelopeId);

    expect(ledgerRows.length).toBe(1);
    // MUST resolve to the ON twin (this service is unconditionally
    // ON_INVOICE, measured — never the OFF twin, never a crash).
    expect(ledgerRows[0].budget_envelope_id).toBe(catOnEnvelopeId);
    expect(ledgerRows[0].spend_type).toBe('ON_INVOICE');
    expect(Number(ledgerRows[0].amount)).toBe(150);
  });
});
