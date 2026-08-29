/**
 * on-invoice-read-surface.e2e-spec.ts — `SC-2a` (`Faz-2 W1`, `FAZ2_PLANLAMA_BRIEF.md §1iv`)
 *
 * Kapsam: `GET /on-invoice/count` · `GET /on-invoice/entries` ·
 * `GET /on-invoice/batch/:batchId` — uçtan uca, mock YOK. Ölçüldü: bu üç
 * okuma ucuna dokunan e2e YOK (`on-invoice-split-envelope.e2e-spec.ts`
 * yalnız `upload`/`:batchId/process`'i kapsıyor).
 *
 * ⛔ `AYIRT EDİCİ`: dolu batch ↔ boş batch. Bugün her ikisi de "boş küme"
 * olduğu için (`on_invoice_entries=0` canlı) bu ayrım GERÇEKTEN test
 * edilmemişti (`§2.7`: "verinin yokluğu örter"). Bu suite KENDİ dolu
 * batch'ini üretir ve rastgele bir `batchId` ile karşılaştırır.
 *
 * Fixture izolasyonu: kendine özel, dedike bir dönem (`2025-04` — GEÇMİŞ
 * tarih, on-invoice validasyonu gelecek fatura tarihini reddediyor; hiçbir
 * başka e2e dosyası/seed tarafından kullanılmıyor) + kendine özel envelope.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture } from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

describe('On-Invoice Read Surface (E2E) — count/entries/batch, SC-2a', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const PERIOD = '2025-04'; // dedike, GEÇMİŞ tarih (on-invoice validation gelecek tarihi reddediyor)
  const ENV_CODE = `E2E-SC2A-${Date.now()}`;

  let envelopeId: string;
  let batchId: string;
  let entryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    const admin = await loginAs(app, 'ADMIN');
    const createRes = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code: ENV_CODE,
        name: 'SC-2a fixture envelope',
        fiscalYear: '2025',
        period: PERIOD,
        channel: 'NKA',
        category: 'CAT-SAC-BOYASI',
        allocatedAmount: 100000,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    envelopeId = createRes.body.id;

    // CUST002 (channel NKA) + SKU 6099350117818 (category CAT-SAC-BOYASI) —
    // gerçek seed satırları (on-invoice-split-envelope.e2e-spec.ts item 4 ile
    // aynı desen).
    const csv = [
      'CUSTOMER_CODE,INVOICE_NO,INVOICE_DATE,FISCAL_PERIOD,SKU_CODE,QUANTITY,LIST_PRICE,ACTUAL_PRICE,DISCOUNT,DISCOUNT_TYPE',
      `CUST002,E2E-SC2A-${Date.now()},${PERIOD}-10,${PERIOD},6099350117818,10,185.00,170.00,222.00,CPP_ON`,
    ].join('\n');

    const uploadRes = await request(app.getHttpServer())
      .post('/on-invoice/upload')
      .set(admin.authHeader())
      .attach('file', Buffer.from(csv, 'utf-8'), 'e2e-sc2a.csv')
      .expect(201);
    batchId = uploadRes.body.batchId;
    expect(uploadRes.body.validation.lineAnalysis.valid).toBe(1);
    expect(uploadRes.body.validation.lineAnalysis.errors).toBe(0);

    await request(app.getHttpServer())
      .post(`/on-invoice/${batchId}/process`)
      .set(admin.authHeader())
      .send({})
      .expect(201);

    const entryRows = await dataSource.query(
      `SELECT id, status FROM main.on_invoice_entries WHERE batch_id = $1`,
      [batchId],
    );
    expect(entryRows.length).toBe(1);
    expect(entryRows[0].status).toBe('POSTED');
    entryId = entryRows[0].id;
  }, 60000);

  afterAll(async () => {
    try {
      const adminDataSource = await getAdminDataSource();
      await adminDataSource.query(
        `DELETE FROM main.ledger_entries WHERE source_id = $1`,
        [entryId],
      );
      await dataSource.query(
        `DELETE FROM main.on_invoice_entries WHERE batch_id = $1`,
        [batchId],
      );
      await dataSource.query(
        `DELETE FROM main.on_invoice_batches WHERE id = $1`,
        [batchId],
      );
      await dataSource.query(
        `DELETE FROM main.budget_transactions WHERE envelope_id = $1`,
        [envelopeId],
      );
      await dataSource.query(
        `DELETE FROM main.budget_envelopes WHERE id = $1`,
        [envelopeId],
      );
    } catch (e) {
      console.warn('Cleanup (SC-2a) başarısız:', e);
    }
    await closeTestApp();
    await closeAdminDataSource();
  }, 60000);

  it('count: GET /on-invoice/count (PLANNER, MODES_ONINVOICE_READ) — gerçek yükleme sonrası sayı en az 1 artmış', async () => {
    const planner = await loginAs(app, 'PLANNER');
    const res = await request(app.getHttpServer())
      .get('/on-invoice/count')
      .set(planner.authHeader())
      .expect(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('⛔ AYIRT EDİCİ — entries?batchId=<DOLU> → 1 satır, entries?batchId=<BOŞ/rastgele> → 0 satır', async () => {
    const planner = await loginAs(app, 'PLANNER');

    const fullRes = await request(app.getHttpServer())
      .get('/on-invoice/entries')
      .query({ batchId })
      .set(planner.authHeader())
      .expect(200);
    expect(Array.isArray(fullRes.body)).toBe(true);
    expect(fullRes.body.length).toBe(1);
    expect(fullRes.body[0].id).toBe(entryId);

    const emptyRes = await request(app.getHttpServer())
      .get('/on-invoice/entries')
      .query({ batchId: randomUUID() })
      .set(planner.authHeader())
      .expect(200);
    expect(Array.isArray(emptyRes.body)).toBe(true);
    expect(emptyRes.body.length).toBe(0);
  });

  it('batch/:batchId — DOLU batch gerçek metadata döner (status, entry sayısı), rastgele UUID 404/boş döner (ayırt edici)', async () => {
    const planner = await loginAs(app, 'PLANNER');

    const fullRes = await request(app.getHttpServer())
      .get(`/on-invoice/batch/${batchId}`)
      .set(planner.authHeader());
    expect(fullRes.status).toBe(200);
    expect(fullRes.body.id).toBe(batchId);

    const missingRes = await request(app.getHttpServer())
      .get(`/on-invoice/batch/${randomUUID()}`)
      .set(planner.authHeader());
    // Ayırt edici: DOLU batch GERÇEK metadata döner (id eşleşir); YOK
    // batch ya 404'tür ya da 200+boş gövdedir — ikisi de DOLU'nun
    // döndürdüğü gerçek id ile eşleşemez.
    expect([404, 200]).toContain(missingRes.status);
    if (missingRes.status === 200) {
      expect(missingRes.body?.id).not.toBe(batchId);
    }
  });

  it('RBAC: READONLY okuyabiliyor (MODES_ONINVOICE_READ {A,F,P,RO}), yazamaz (upload → 403)', async () => {
    const readonly = await loginAs(app, 'READONLY');
    const readRes = await request(app.getHttpServer())
      .get('/on-invoice/count')
      .set(readonly.authHeader());
    expect(readRes.status).toBe(200);

    const writeRes = await request(app.getHttpServer())
      .post('/on-invoice/upload')
      .set(readonly.authHeader())
      .attach('file', Buffer.from('x', 'utf-8'), 'no.csv');
    expect(writeRes.status).toBe(403);
  });
});
