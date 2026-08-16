/**
 * sales-actuals.e2e-spec.ts — T-020
 *
 * Kapsam: POST/GET /actuals-first/sales-actuals/*
 *
 * BRD kuralları:
 *   - Actuals = CPL x Kategori x Kanal x Dönem TUTAR agregası (FU/SKU/volume yok)
 *   - Replacement hard-delete YAPMAZ — eski batch REPLACED olur, satırlar kalır
 *   - Aynı dosya (fileHash) tekrar yüklenirse idempotent no-op
 *   - RBAC: ADMIN/FINANCE/FINANCE_MANAGER yazar; PLANNER/CATEGORY_MANAGER/
 *     READONLY yalnızca okur
 *   - Tenant izolasyonu
 *   - Actuals KPI/ledger/budget'a YAZMAZ — v_budget_summary değişmez (SA-E2E-06)
 *   - Audit: UPLOAD + REPLACE kaydı var, DELETE endpoint yok
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  E2EFixture,
  cleanupSalesActuals,
} from './helpers/seed-e2e';
import { closeAdminDataSource } from './helpers/admin-datasource';
import { BudgetRepository } from '../src/modules/shared/budget/budget.repository';

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf-8');
}

const HEADER =
  'cpl_code,category,channel_code,gross_amount,net_amount,discount_amount';

describe('Sales Actuals (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
    // `--runInBand` tekrar koşumlarında önceki koşumdan kalan 2027-* test
    // fixture'larını temizle (idempotency: her koşum temiz state ile başlar).
    await cleanupSalesActuals(app, fixture.tenantId);
  });

  afterAll(async () => {
    // Dev/shared DB'de test fixture birikimini önle — gerçek Wella verisine
    // (2026-*) dokunmaz, yalnızca 2027-* test batch/satır/audit kayıtlarını siler.
    await cleanupSalesActuals(app, fixture.tenantId);
    await closeTestApp();
    // M-2 (2026-08-16): `cleanupSalesActuals` (burada + `beforeAll`'da)
    // `getAdminDataSource()`'ı tetikler. Bu dosyanın tek/en-dış `afterAll`'ı,
    // hiçbir nested describe'ın kendi `afterAll`'ı yok — kapatmak güvenli.
    await closeAdminDataSource();
  });

  async function getCplCode(): Promise<{ cplId: string; cplCode: string }> {
    const rows = await dataSource.query(
      `SELECT id, code FROM main.cpls WHERE id = $1 LIMIT 1`,
      [fixture.cplId],
    );
    return { cplId: rows[0].id, cplCode: rows[0].code };
  }

  // ── SA-E2E-01: temel upload ────────────────────────────────────────────

  describe('SA-E2E-01: Wella actuals CSV upload', () => {
    it('geçerli 2 satırlık CSV -> 2 batch (2 scope), 200', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();
      // Nonce: testin farklı DB oturumlarında tekrar çalıştırılması durumunda
      // fileHash çakışmasını (idempotent no-op) önlemek için tutar benzersizleştirilir.
      const nonce = Date.now() % 100000;

      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,${111000 + nonce},100000,5000`,
        `${cplCode},Saç Boyası,NKA,${222000 + nonce},200000,10000`,
      ]);

      const res = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-01')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-01.csv')
        .expect(201);

      expect(res.body.fiscalPeriod).toBe('2027-01');
      expect(res.body.totalRows).toBe(2);
      expect(res.body.validRows).toBe(2);
      expect(res.body.errorRows).toBe(0);
      expect(res.body.batches).toHaveLength(2);
      for (const batch of res.body.batches) {
        // CREATED (temiz DB) ya da REPLACED (aynı scope'ta önceki test
        // koşumundan kalan ACTIVE batch) — her ikisi de "yeni içerik başarıyla
        // yüklendi" anlamına gelir; IDEMPOTENT_DUPLICATE olmamalı (nonce farklı).
        expect(['CREATED', 'REPLACED']).toContain(batch.status);
      }
    });
  });

  // ── SA-E2E-02: idempotent tekrar yükleme ───────────────────────────────

  describe('SA-E2E-02: aynı dosya tekrar yüklenirse idempotent no-op', () => {
    it('ACTIVE batch id değişmez, status IDEMPOTENT_DUPLICATE', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();
      const nonce = Date.now() % 100000;

      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,${50000 + nonce},45000,2000`,
      ]);

      const first = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-02')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-02.csv')
        .expect(201);

      const firstBatchId = first.body.batches[0].batchId;
      expect(['CREATED', 'REPLACED']).toContain(first.body.batches[0].status);

      const second = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-02')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-02.csv')
        .expect(201);

      expect(second.body.batches[0].status).toBe('IDEMPOTENT_DUPLICATE');
      expect(second.body.batches[0].batchId).toBe(firstBatchId);
    });
  });

  // ── SA-E2E-03: replacement — hard delete YOK ───────────────────────────

  describe('SA-E2E-03: aynı dönem farklı içerik -> REPLACED, eski satırlar kalır', () => {
    it('eski batch REPLACED olur, replacedByBatchId dolar, eski satırlar DB’de duruyor', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();

      const contentV1 = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,70000,65000,3000`,
      ]);
      const contentV2 = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,80000,75000,4000`,
      ]);

      const v1 = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-03')
        .set(admin.authHeader())
        .attach('file', contentV1, 'actuals_2027-03.csv')
        .expect(201);
      const oldBatchId = v1.body.batches[0].batchId;

      const v2 = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-03')
        .set(admin.authHeader())
        .attach('file', contentV2, 'actuals_2027-03-v2.csv')
        .expect(201);

      expect(v2.body.batches[0].status).toBe('REPLACED');
      const newBatchId = v2.body.batches[0].batchId;
      expect(v2.body.batches[0].replacedBatchId).toBe(oldBatchId);
      expect(newBatchId).not.toBe(oldBatchId);

      // Eski batch hâlâ okunabilir (hard delete yok), status = REPLACED
      const oldBatchRes = await request(app.getHttpServer())
        .get(`/actuals-first/sales-actuals/batches/${oldBatchId}`)
        .set(admin.authHeader())
        .expect(200);
      expect(oldBatchRes.body.status).toBe('REPLACED');
      expect(oldBatchRes.body.replacedByBatchId).toBe(newBatchId);

      // Eski satırlar DB'de duruyor
      const oldRowsRes = await request(app.getHttpServer())
        .get(`/actuals-first/sales-actuals/batches/${oldBatchId}/rows`)
        .set(admin.authHeader())
        .expect(200);
      expect(oldRowsRes.body).toHaveLength(1);
      expect(Number(oldRowsRes.body[0].grossAmount)).toBe(70000);

      // Yeni ACTIVE batch listeleme -> yalnızca yeni batch görünür
      const activeBatches = await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/batches?fiscalPeriod=2027-03')
        .set(admin.authHeader())
        .expect(200);
      const ids = activeBatches.body.map((b: any) => b.id);
      expect(ids).toContain(newBatchId);
      expect(ids).not.toContain(oldBatchId);
    });
  });

  // ── SA-E2E-04: kısmi hata, doğru kod ───────────────────────────────────

  describe('SA-E2E-04: bilinmeyen cpl/kategori karışık -> geçerliler yüklenir', () => {
    it('geçerli satır batch olur, hatalı satır doğru kodla döner', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();

      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,90000,85000,3000`,
        `UNKNOWN-CPL-XYZ,Şekillendirici,NKA,10000,9000,500`,
        `${cplCode},Var Olmayan Kategori,NKA,10000,9000,500`,
      ]);

      const res = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-04')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-04.csv')
        .expect(201);

      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(2);
      const codes = res.body.errors.map((e: any) => e.code);
      expect(codes).toContain('UNKNOWN_CPL');
      expect(codes).toContain('UNKNOWN_CATEGORY');
    });
  });

  // ── SA-E2E-05: tümü hatalı -> 400, batch yok ───────────────────────────

  describe('SA-E2E-05: tüm satırlar hatalı -> 400, batch oluşmaz', () => {
    it('NO_VALID_ROWS ile 400 döner', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const content = csv([HEADER, `UNKNOWN,Bilinmeyen,XX,`]);

      const res = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-05')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-05.csv')
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('NO_VALID_ROWS');
    });
  });

  // ── SA-E2E-06: LEDGER SINIRI — en kritik test ──────────────────────────

  describe('SA-E2E-06: actuals ledger/budget’a yazmaz', () => {
    /**
     * T-037/T-038 FIX (kök neden — coordinator review):
     *
     * Önceki implementasyon `main.v_budget_summary`'nin TÜM tenant'taki
     * TÜM zarflarının snapshot'ını upload öncesi/sonrası birebir eşitlik
     * ile karşılaştırıyordu. Bu, jest'in spec dosyalarını varsayılan olarak
     * paralel worker'larda çalıştırması nedeniyle YAPISAL OLARAK kırılgandı:
     * bu test çalışırken başka HERHANGİ bir spec (role-journey,
     * settlement-budget-release, reversal, settlement, ...) aynı tenant'ta
     * MEŞRU bir RESERVE/RELEASE/COMMIT yazarsa (ki bu doğru/beklenen ürün
     * davranışıdır), before/after snapshot'ları farklılaşır ve test
     * false-negative ile flake eder — sorun ürün kodunda değil, testin
     * "sahip olmadığı" (bu isteğin yazmadığı) tenant-geneli duruma
     * bakmasındaydı (canlı kanıt: bağımsız 7 paralel koşumda 3/3 tutarlı
     * SA-E2E-06 hatası, coordinator review).
     *
     * Doğru/izole invaryant: "bu HTTP isteği, `main.budget_transactions`
     * tablosuna hiç satır yazmadı" — tenant/envelope durumuna bakmak yerine,
     * `main.budget_transactions`'a yazan TEK giriş noktasını
     * (`BudgetRepository#createTransaction`, bkz. budget.repository.ts —
     * tüm RESERVE/COMMIT/RELEASE/ALLOCATE/TRANSFER/ADJUST çağrıları bu
     * metottan geçer) BU testin kendi app instance'ında (`app.get(...)`)
     * spy'lıyoruz. Bu, yalnızca BU isteğin bu metodu çağırıp çağırmadığını
     * gözlemler — başka bir spec dosyasının KENDİ app instance'ında
     * (ayrı `createTestApp()` çağrısı) yaptığı çağrılardan etkilenmez,
     * çünkü NestJS provider'ları process-wide değil, app-instance-wide
     * singleton'dır. Tam izolasyon, sıfır tenant-geneli/envelope-geneli
     * karşılaştırma.
     */
    it('upload budget_transactions tablosuna hiç satır yazmaz (spy-bazlı, izole)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();

      const budgetRepository = app.get(BudgetRepository);
      const createTransactionSpy = jest.spyOn(
        budgetRepository,
        'createTransaction',
      );

      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,999999,900000,50000`,
      ]);

      try {
        await request(app.getHttpServer())
          .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-06')
          .set(admin.authHeader())
          .attach('file', content, 'actuals_2027-06.csv')
          .expect(201);

        expect(createTransactionSpy).not.toHaveBeenCalled();
      } finally {
        createTransactionSpy.mockRestore();
      }
    });
  });

  // ── SA-E2E-07: RBAC ─────────────────────────────────────────────────────

  describe('SA-E2E-07: RBAC', () => {
    it('PLANNER upload -> 403, read -> 200', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const { cplCode } = await getCplCode();

      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,1000,900,50`,
      ]);

      await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-07')
        .set(planner.authHeader())
        .attach('file', content, 'actuals_2027-07.csv')
        .expect(403);

      await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/batches')
        .set(planner.authHeader())
        .expect(200);
    });

    it('READONLY upload -> 403', async () => {
      const readonly = await loginAs(app, 'READONLY');
      const { cplCode } = await getCplCode();
      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,1000,900,50`,
      ]);

      await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-07')
        .set(readonly.authHeader())
        .attach('file', content, 'actuals_2027-07.csv')
        .expect(403);
    });

    it('FINANCE upload -> 200/201', async () => {
      const finance = await loginAs(app, 'FINANCE');
      const { cplCode } = await getCplCode();
      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,2000,1800,100`,
      ]);

      await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-08')
        .set(finance.authHeader())
        .attach('file', content, 'actuals_2027-08.csv')
        .expect(201);
    });

    it('Token olmadan upload -> 401', async () => {
      const content = csv([HEADER, `X,Y,Z,1,1,1`]);
      await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-09')
        .attach('file', content, 'actuals_2027-09.csv')
        .expect(401);
    });
  });

  // ── SA-E2E-08: tenant izolasyonu ────────────────────────────────────────

  describe('SA-E2E-08: tenant izolasyonu', () => {
    it('var olmayan batch id -> 404 (cross-tenant veya hiç yok)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const fakeId = '00000000-0000-0000-0000-000000000099';

      await request(app.getHttpServer())
        .get(`/actuals-first/sales-actuals/batches/${fakeId}`)
        .set(admin.authHeader())
        .expect(404);
    });
  });

  // ── SA-E2E-09: audit ─────────────────────────────────────────────────────

  describe('SA-E2E-09: audit log immutable — UPLOAD + REPLACE kaydı var, DELETE yok', () => {
    it('upload sonrası admin_audit_logs SALES_ACTUALS_UPLOAD kaydı içerir', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();
      const nonce = Date.now() % 100000;

      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,${3000 + nonce},2700,150`,
      ]);

      const res = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-10')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-10.csv')
        .expect(201);

      const batchId = res.body.batches[0].batchId;
      // Yeni içerik olduğundan CREATED ya da (bu scope daha önce dolduysa) REPLACED
      // olabilir; her iki durumda da audit action_type 'SALES_ACTUALS_UPLOAD' veya
      // 'SALES_ACTUALS_REPLACE' olarak loglanır. Test yalnızca bir audit kaydının
      // var olduğunu (immutable, silinmemiş) doğrular.
      const logs = await dataSource.query(
        `SELECT action_type FROM main.admin_audit_logs
         WHERE tenant_id = $1 AND entity_type = 'SalesActualBatch' AND entity_id = $2`,
        [fixture.tenantId, batchId],
      );
      const actionTypes = logs.map((l: any) => l.action_type);
      const hasExpectedAction =
        actionTypes.includes('SALES_ACTUALS_UPLOAD') ||
        actionTypes.includes('SALES_ACTUALS_REPLACE');
      expect(hasExpectedAction).toBe(true);
    });

    it('DELETE endpoint yok (immutable) — actuals-first/sales-actuals altında DELETE route tanımsız', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const res = await request(app.getHttpServer())
        .delete(
          '/actuals-first/sales-actuals/batches/00000000-0000-0000-0000-000000000001',
        )
        .set(admin.authHeader());
      expect([404]).toContain(res.status);
    });
  });

  // ── SA-E2E-10: dönem çıkarımı ────────────────────────────────────────────

  describe('SA-E2E-10: fiscalPeriod query verilmezse dosya adından çıkarılır', () => {
    it('actuals_YYYY-MM.csv adından dönem doğru çıkarılır', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();
      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,NKA,4000,3600,200`,
      ]);

      const res = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-11.csv')
        .expect(201);

      expect(res.body.fiscalPeriod).toBe('2027-11');
    });

    it('ne query ne dosya adı formata uyarsa 400', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const content = csv([HEADER, `X,Y,Z,1,1,1`]);

      await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload')
        .set(admin.authHeader())
        .attach('file', content, 'random-file-name.csv')
        .expect(400);
    });
  });

  // ── SA-E2E-11: CHANNEL_MISMATCH ─────────────────────────────────────────

  describe('SA-E2E-11: channel_code CPL kanalıyla uyuşmuyorsa satır reddi', () => {
    it('CHANNEL_MISMATCH kodu döner', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const { cplCode } = await getCplCode();
      // cplCode NKA kanalına ait; DISTRIBUTOR ile uyuşmaz
      const content = csv([
        HEADER,
        `${cplCode},Şekillendirici,DISTRIBUTOR,5000,4500,250`,
      ]);

      const res = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-12')
        .set(admin.authHeader())
        .attach('file', content, 'actuals_2027-12.csv')
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('CHANNEL_MISMATCH');
    });
  });

  // ── Summary endpoint ─────────────────────────────────────────────────────

  describe('GET /actuals-first/sales-actuals/summary', () => {
    it('ACTIVE batch satırları üzerinden toplam döner', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get('/actuals-first/sales-actuals/summary?fiscalPeriod=2027-01')
        .set(admin.authHeader())
        .expect(200);

      expect(res.body).toHaveProperty('grossTotal');
      expect(res.body).toHaveProperty('rowCount');
      expect(Number(res.body.rowCount)).toBeGreaterThanOrEqual(2);
    });
  });
});
