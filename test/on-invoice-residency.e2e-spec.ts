/**
 * on-invoice-residency.e2e-spec.ts — `SC-2b` (`Faz-2 W1`, `FAZ2_PLANLAMA_BRIEF.md §1iv`)
 *
 * Kapsam: on-invoice'un ürettiği `ON_INVOICE` defter satırının gerçekten bir
 * AŞAĞI-AKIŞ okuma yüzeyinde GÖRÜNÜR olduğunu kanıtlar ("ikamet" — kaydın
 * kalıcı ve erişilebilir olduğu, yalnız yazıldığı değil).
 *
 * ⚠️ KAPSAM KARARI (ölçülü, DUR listesine uyar): "aşağı-akış" için
 * `finance-reporting` YERİNE `GET /ledger` seçildi — `T-329` `finance-
 * reporting`'i zaten kapsıyor ve bu turun DUR listesi o modüle dokunmayı
 * yasaklıyor (`Faz2 brief`). `GET /ledger` de gerçek bir aşağı-akış okuma
 * yüzeyidir (`ledger.controller.ts`, `on_invoice_entries`'ten TAMAMEN AYRI
 * bir tablo/repository) — yazan yol (on-invoice) ile okuyan yol (ledger)
 * arasında gerçek bir modül sınırı var.
 *
 * ⛔ `AYIRT EDİCİ`: aynı envelope'un ledger görünümü YÜKLEMEDEN ÖNCE boş
 * küme, YÜKLEMEDEN SONRA dolu küme — `§2.7`: "verinin yokluğu örter"
 * sınıfına düşmemek için ayrımın İKİ TARAFI da bu suite'in KENDİ, taze
 * ürettiği veriyle ölçülüyor (paylaşılan/mevcut satırlara güvenilmiyor).
 *
 * Fixture izolasyonu: kendine özel dedike dönem (`2025-05` — GEÇMİŞ tarih)
 * + envelope.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture } from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

describe('On-Invoice Residency (E2E) — ON_INVOICE ledger satırı aşağı-akışta görünüyor mu, SC-2b', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const PERIOD = '2025-05'; // dedike, GEÇMİŞ tarih (on-invoice validation gelecek tarihi reddediyor)
  const ENV_CODE = `E2E-SC2B-${Date.now()}`;
  const DISCOUNT_AMOUNT = 333.5;

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
        name: 'SC-2b fixture envelope',
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
  }, 60000);

  afterAll(async () => {
    try {
      const adminDataSource = await getAdminDataSource();
      if (entryId) {
        await adminDataSource.query(
          `DELETE FROM main.ledger_entries WHERE source_id = $1`,
          [entryId],
        );
      }
      if (batchId) {
        await dataSource.query(
          `DELETE FROM main.on_invoice_entries WHERE batch_id = $1`,
          [batchId],
        );
        await dataSource.query(
          `DELETE FROM main.on_invoice_batches WHERE id = $1`,
          [batchId],
        );
      }
      await dataSource.query(
        `DELETE FROM main.budget_transactions WHERE envelope_id = $1`,
        [envelopeId],
      );
      await dataSource.query(
        `DELETE FROM main.budget_envelopes WHERE id = $1`,
        [envelopeId],
      );
    } catch (e) {
      console.warn('Cleanup (SC-2b) başarısız:', e);
    }
    await closeTestApp();
    await closeAdminDataSource();
  }, 60000);

  it('⛔ AYIRT EDİCİ — YÜKLEMEDEN ÖNCE GET /ledger?budgetEnvelopeId=<taze> boş küme, YÜKLEMEDEN SONRA dolu küme (aynı envelope, gerçek HTTP zinciri)', async () => {
    const planner = await loginAs(app, 'PLANNER');
    const admin = await loginAs(app, 'ADMIN');

    // 1) ÖNCE — taze envelope, henüz hiçbir ledger yazımı yok.
    const beforeRes = await request(app.getHttpServer())
      .get('/ledger')
      .query({ budgetEnvelopeId: envelopeId })
      .set(planner.authHeader())
      .expect(200);
    expect(Array.isArray(beforeRes.body)).toBe(true);
    expect(beforeRes.body.length).toBe(0);

    // 2) GERÇEK on-invoice yazımı (upload → process, T-057 deseni).
    const csv = [
      'CUSTOMER_CODE,INVOICE_NO,INVOICE_DATE,FISCAL_PERIOD,SKU_CODE,QUANTITY,LIST_PRICE,ACTUAL_PRICE,DISCOUNT,DISCOUNT_TYPE',
      `CUST002,E2E-SC2B-${Date.now()},${PERIOD}-10,${PERIOD},6099350117818,10,185.00,170.00,${DISCOUNT_AMOUNT},CPP_ON`,
    ].join('\n');

    const uploadRes = await request(app.getHttpServer())
      .post('/on-invoice/upload')
      .set(admin.authHeader())
      .attach('file', Buffer.from(csv, 'utf-8'), 'e2e-sc2b.csv')
      .expect(201);
    batchId = uploadRes.body.batchId;
    expect(uploadRes.body.validation.lineAnalysis.valid).toBe(1);

    await request(app.getHttpServer())
      .post(`/on-invoice/${batchId}/process`)
      .set(admin.authHeader())
      .send({})
      .expect(201);

    const entryRows = await dataSource.query(
      `SELECT id FROM main.on_invoice_entries WHERE batch_id = $1`,
      [batchId],
    );
    expect(entryRows.length).toBe(1);
    entryId = entryRows[0].id;

    // 3) SONRA — AYNI envelope, AYNI filtre, GERÇEK downstream okuma yüzeyi.
    const afterRes = await request(app.getHttpServer())
      .get('/ledger')
      .query({ budgetEnvelopeId: envelopeId })
      .set(planner.authHeader())
      .expect(200);
    expect(Array.isArray(afterRes.body)).toBe(true);
    expect(afterRes.body.length).toBe(1);
    expect(afterRes.body[0].spendType).toBe('ON_INVOICE');
    expect(Number(afterRes.body[0].amount)).toBe(DISCOUNT_AMOUNT);
    expect(afterRes.body[0].sourceId).toBe(entryId);

    // 4) tekil okuma ucu da (GET /ledger/:id) aynı satırı gerçekten döndürüyor mu.
    const singleRes = await request(app.getHttpServer())
      .get(`/ledger/${afterRes.body[0].id}`)
      .set(planner.authHeader())
      .expect(200);
    expect(singleRes.body.id).toBe(afterRes.body[0].id);
    expect(singleRes.body.spendType).toBe('ON_INVOICE');
  });
});
