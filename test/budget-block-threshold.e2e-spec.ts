/**
 * budget-block-threshold.e2e-spec.ts — `T-330` (`T-321`'in e2e kapsaması)
 *
 * `T-321` `K-2.2.7a` `%100 BLOCKED` kapısını indirdi ve UNIT seviyesinde
 * mutasyonla kanıtladı (`budget.service.spec.ts`, mock'lu `v_budget_summary`
 * + mock'lu `BudgetPolicyService`). Ölçüldü: `budget-tier-notification.
 * e2e-spec.ts` ve `budget-reserve-canonical-path.e2e-spec.ts`'de `BLOCKED`/
 * `assertNotBlocked` SIFIR — kapının kendi davranışının uçtan uca (GERÇEK
 * `v_budget_summary`, GERÇEK politika satırı, GERÇEK transaction) kanıtı
 * yoktu. Bu dosya onu kapatır.
 *
 * ⛔ NEDEN UNIT YETMİYOR: `projectedPct` hesabı `v_budget_summary`'nin
 * DÖNDÜRDÜĞÜ TİPLERE bağlı (`@ViewColumn({transformer})` — `Z47`'de tam bu
 * sınıfta bir vaka: `Number(null)` sessizce `0` üretiyordu, mock o farkı
 * GÖSTEREMEZ).
 *
 * İKİ EKSEN (task metni, `.claude/backlog/tasks/T-330.md`):
 *   1. plan/taahhüt (RESERVE)  — zarf %100'ü AŞACAK bir RESERVE → REDDEDİLİR
 *      (`ConflictException`, `BUDGET_BLOCK_THRESHOLD_EXCEEDED`), ve
 *      `budget_transactions`'a SATIR YAZILMADIĞI SQL ile doğrulanır.
 *   2. hakediş (LEDGER)        — zarf %100 üstündeyken bir LEDGER yazımı
 *      (on-invoice) → GEÇER (`K-2.2.7c`: "borç doğmuştur, süreç durmaz").
 *      `ledger.service.ts#createEntry` `assertNotBlocked` ÇAĞIRMIYOR
 *      (ölçüldü, `grep`) — axis 2 bu YAPISAL ayrımı pinler.
 *
 * POZ.KONTROL: `blockPct` TENANT KONFİGÜRASYONUNDAN değiştirilir (kategori-
 * scoped `budget_policies` satırı, `K-2.2.8` en-spesifik-kazanır), sabit
 * `100` YAZILMAZ (`Z56 §4` ilişki-pini deseni) — pin blockPct DEĞİŞTİĞİNDE
 * de tutuyor mu?
 *
 * ⛔ FIXTURE UYARISI (`§2.7`, "verinin yokluğu örter"): her iki envelope da
 * bu dosyaya ÖZEL, TAZE — sıfır önceki kullanım, yolu GERÇEKTEN tetikler.
 *
 * ⚠️ `budget_policies`e `app_runtime`'ın INSERT/UPDATE/DELETE hakkı YOK
 * (ölçüldü, `has_table_privilege('app_runtime', 'main.budget_policies',
 * 'INSERT')` → `f`) — POZ.KONTROL satırı `app_migrate` (`adminDataSource`)
 * üzerinden yazılır/silinir (K-2.6.13 KARAR 1 ile aynı aile).
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
  E2EFixture,
} from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

describe('Budget Block Threshold (E2E) — K-2.2.7a %100 BLOCKED, T-330', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CPL_1: string;
  let CHANNEL_NKA: string;
  let FU_WELLA_HC_500ML: string;
  let TACTIC_PROMO: string;
  let MECHANIC_OFF: string;

  // ── Envelope 1: DEFAULT tenant joker politikası (80/90/100/NOTIFY) ──
  const PERIOD_DEFAULT = '2025-06'; // dedike, GEÇMİŞ tarih
  const ENV_CODE_DEFAULT = `E2E-T330-DEFAULT-${Date.now()}`;
  let envelopeDefaultId: string;

  // ── Envelope 2: POZ.KONTROL — kategori-scoped özel politika (blockPct=60) ──
  const PERIOD_CUSTOM = '2025-07'; // dedike, GEÇMİŞ tarih
  const ENV_CODE_CUSTOM = `E2E-T330-CUSTOM-${Date.now()}`;
  let envelopeCustomId: string;

  // ── Envelope 3: negatif kontrast — DEFAULT politika, AYRI/BAKİR envelope
  // (AXIS-1/AXIS-2'nin envelopeDefaultId'yi tükettiği envelope İLE
  // KARIŞTIRILMAZ — "aynı %70 default'ta GEÇER" iddiası TEMİZ bir zarf
  // ister, AXIS-2'nin ledger tüketimiyle kirlenmiş biri değil).
  const PERIOD_CONTRAST = '2025-08'; // dedike, GEÇMİŞ tarih
  const ENV_CODE_CONTRAST = `E2E-T330-CONTRAST-${Date.now()}`;
  let envelopeContrastId: string;
  let customPolicyId: string;
  let categoryDigerId: string;

  const createdAgreementIds: string[] = [];
  const createdBatchIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [
      CPL_1,
      CHANNEL_NKA,
      FU_WELLA_HC_500ML,
      TACTIC_PROMO,
      MECHANIC_OFF,
      categoryDigerId,
    ] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'cpls', 'BS0501.50001'),
      resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
      resolveIdByCode(
        app,
        fixture.tenantId,
        'forecasting_units',
        'FU-WELLA-HC-500ML',
      ),
      resolveIdByCode(app, fixture.tenantId, 'tactics', 'TAC-PROMO'),
      resolveIdByCode(app, fixture.tenantId, 'mechanics', 'CPP_OFF_PCT'),
      resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-DIGER'),
    ]);

    const admin = await loginAs(app, 'ADMIN');

    // Envelope 1 — DEFAULT politika (kategori/kanal-scoped satır YOK, joker
    // 80/90/100/NOTIFY uygulanır — bkz. budget-policy.seed.ts).
    const env1 = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code: ENV_CODE_DEFAULT,
        name: 'T-330 fixture — default policy',
        fiscalYear: '2025',
        period: PERIOD_DEFAULT,
        channel: 'NKA',
        category: 'CAT-SAC-BOYASI',
        allocatedAmount: 1000,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    envelopeDefaultId = env1.body.id;

    // Envelope 2 — CAT-DIGER'e scoped (canlı DB'de ÖLÇÜLDÜ: hem
    // budget_policies hem budget_envelopes'ta 0 önceki satır — taze).
    const env2 = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code: ENV_CODE_CUSTOM,
        name: 'T-330 fixture — custom policy (POZ.KONTROL)',
        fiscalYear: '2025',
        period: PERIOD_CUSTOM,
        channel: 'NKA',
        category: 'CAT-DIGER',
        categoryId: categoryDigerId,
        allocatedAmount: 1000,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    envelopeCustomId = env2.body.id;

    // Envelope 3 — DEFAULT politika, AXIS-1/AXIS-2'den TAMAMEN AYRI/BAKİR
    // (negatif kontrast testinin "%70 default'ta geçer" iddiası temiz bir
    // zarf ister).
    const env3 = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code: ENV_CODE_CONTRAST,
        name: 'T-330 fixture — negatif kontrast (bakir, default policy)',
        fiscalYear: '2025',
        period: PERIOD_CONTRAST,
        channel: 'NKA',
        category: 'CAT-SAC-BOYASI',
        allocatedAmount: 1000,
        status: 'ACTIVE',
        currency: 'TRY',
      })
      .expect(201);
    envelopeContrastId = env3.body.id;

    // POZ.KONTROL satırı: CAT-DIGER için blockPct=60 (tenant joker'ın
    // 100'ünden FARKLI) — `app_migrate` (budget_policies'e app_runtime'ın
    // yazma hakkı yok, ölçüldü).
    const adminDataSource = await getAdminDataSource();
    const policyRows = await adminDataSource.query(
      `INSERT INTO main.budget_policies
         (tenant_id, category_id, warning_threshold_pct,
          finance_review_threshold_pct, block_threshold_pct, finance_review_mode)
       VALUES ($1, $2, 40, 50, 60, 'NOTIFY')
       RETURNING id`,
      [fixture.tenantId, categoryDigerId],
    );
    customPolicyId = policyRows[0].id;
  }, 60000);

  afterAll(async () => {
    try {
      const adminDataSource = await getAdminDataSource();
      for (const agreementId of createdAgreementIds) {
        // `admin_audit_logs` de korunmuş-tablo ailesi (`app_runtime` DELETE
        // hakkı yok) — APPROVE denemeleri (bloklanan dahil) `AdminAuditService
        // .logAdminAction` çağırıyor (T-032), yoksa T-047 satır-sayısı
        // invaryantı bu suite'i KIRAR (ölçüldü: ilk koşumda delta 4).
        await adminDataSource.query(
          `DELETE FROM main.admin_audit_logs WHERE entity_type = 'AGREEMENT' AND entity_id = $1`,
          [agreementId],
        );
        await adminDataSource.query(
          `DELETE FROM main.ledger_entries WHERE agreement_id = $1`,
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
      for (const batchId of createdBatchIds) {
        const entryRows = await dataSource.query(
          `SELECT id FROM main.on_invoice_entries WHERE batch_id = $1`,
          [batchId],
        );
        for (const e of entryRows) {
          await adminDataSource.query(
            `DELETE FROM main.ledger_entries WHERE source_id = $1`,
            [e.id],
          );
        }
        await dataSource.query(
          `DELETE FROM main.on_invoice_entries WHERE batch_id = $1`,
          [batchId],
        );
        await dataSource.query(
          `DELETE FROM main.on_invoice_batches WHERE id = $1`,
          [batchId],
        );
      }
      if (customPolicyId) {
        await adminDataSource.query(
          `DELETE FROM main.budget_policies WHERE id = $1`,
          [customPolicyId],
        );
      }
      // `main.notifications`'ta `budget_envelope_id` KOLONU YOK (polimorfik,
      // `metadata` jsonb'de — bkz. `budget-tier-notification.e2e-spec.ts`
      // aynı not) — RESERVE/COMMIT/RELEASE tetiklediği %80/90/100 tier
      // geçişleri bu üç envelope için satır bırakabilir. `app_runtime`'ın
      // DELETE hakkı yok (`notifications` de korunmuş-tablo ailesi).
      await adminDataSource.query(
        `DELETE FROM main.notifications
          WHERE metadata->>'budgetEnvelopeId' = ANY($1::text[])`,
        [[envelopeDefaultId, envelopeCustomId, envelopeContrastId]],
      );
      await dataSource.query(
        `DELETE FROM main.budget_transactions WHERE envelope_id = ANY($1::uuid[])`,
        [[envelopeDefaultId, envelopeCustomId, envelopeContrastId]],
      );
      await dataSource.query(
        `DELETE FROM main.budget_envelopes WHERE id = ANY($1::uuid[])`,
        [[envelopeDefaultId, envelopeCustomId, envelopeContrastId]],
      );
    } catch (e) {
      console.warn('Cleanup (T-330) başarısız:', e);
    }
    await closeTestApp();
    await closeAdminDataSource();
  }, 60000);

  async function createAndSubmitAgreement(
    capTotalAmount: number,
    period: string,
    namePrefix: string,
  ): Promise<string> {
    const admin = await loginAs(app, 'ADMIN');
    const createRes = await request(app.getHttpServer())
      .post('/agreements')
      .set(admin.authHeader())
      .send({
        agreementName: `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        agreementType: 'STA',
        cplId: CPL_1,
        channelId: CHANNEL_NKA,
        fuId: FU_WELLA_HC_500ML,
        tacticId: TACTIC_PROMO,
        mechanicId: MECHANIC_OFF,
        skuScope: 'FU',
        capTotalAmount,
        spendType: 'BOTH',
        startDate: `${period}-05`,
        endDate: `${period}-25`,
        justification: 'T-330 e2e — budget block threshold',
      })
      .expect(201);
    const agreementId = createRes.body.id;
    createdAgreementIds.push(agreementId);

    await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/submit`)
      .set(admin.authHeader())
      .send({})
      .expect(200);

    return agreementId;
  }

  // ── EKSEN 1 — plan/taahhüt (RESERVE) — TAM sınırda (%100) REDDEDİLİR ────

  it('AXIS-1: %100 eşitliğinde RESERVE REDDEDİLİR (409 BUDGET_BLOCK_THRESHOLD_EXCEEDED), budget_transactions SATIR ALMAZ', async () => {
    const agreementId = await createAndSubmitAgreement(
      1000, // == allocatedAmount → projectedPct tam %100
      PERIOD_DEFAULT,
      'E2E-T330-AX1',
    );

    const before = await dataSource.query(
      `SELECT count(*)::int AS c FROM main.budget_transactions
        WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2`,
      [fixture.tenantId, agreementId],
    );
    expect(before[0].c).toBe(0);

    const fm = await loginAs(app, 'FINANCE_MANAGER');
    const approveRes = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/approve`)
      .set(fm.authHeader())
      .send({});

    expect(approveRes.status).toBe(409);
    expect(approveRes.body.code).toBe('BUDGET_BLOCK_THRESHOLD_EXCEEDED');

    const after = await dataSource.query(
      `SELECT count(*)::int AS c FROM main.budget_transactions
        WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2`,
      [fixture.tenantId, agreementId],
    );
    expect(after[0].c).toBe(0); // ⇒ before === after: yazım hiç GERÇEKLEŞMEDİ

    const agreementRow = await dataSource.query(
      `SELECT status FROM main.agreements WHERE id = $1`,
      [agreementId],
    );
    expect(agreementRow[0].status).toBe('PENDING'); // durum da değişmedi
  });

  // ── EKSEN 2 — hakediş (LEDGER, on-invoice) — zarf ZATEN %100 üstündeyken GEÇER ──

  it('AXIS-2 (K-2.2.7c): zarf %100 ÜSTÜNDEYKEN LEDGER yazımı (on-invoice) GEÇER — assertNotBlocked bu yolu KAPSAMIYOR', async () => {
    // CUST002 (NKA) + SKU 6099350117818 (CAT-SAC-BOYASI, envelopeDefault'un
    // kategorisiyle eşleşir) — iki satır: ilki zarfı %100'ün ÜSTÜNE taşır,
    // ikincisi zarf ZATEN üstündeyken yazılır (K-2.2.7c'nin iki yarısı).
    const admin = await loginAs(app, 'ADMIN');
    const csv = [
      'CUSTOMER_CODE,INVOICE_NO,INVOICE_DATE,FISCAL_PERIOD,SKU_CODE,QUANTITY,LIST_PRICE,ACTUAL_PRICE,DISCOUNT,DISCOUNT_TYPE',
      `CUST002,E2E-T330-AX2-A-${Date.now()},${PERIOD_DEFAULT}-10,${PERIOD_DEFAULT},6099350117818,10,185.00,170.00,1050.00,CPP_ON`,
      `CUST002,E2E-T330-AX2-B-${Date.now()},${PERIOD_DEFAULT}-11,${PERIOD_DEFAULT},6099350117818,10,185.00,170.00,50.00,CPP_ON`,
    ].join('\n');

    const uploadRes = await request(app.getHttpServer())
      .post('/on-invoice/upload')
      .set(admin.authHeader())
      .attach('file', Buffer.from(csv, 'utf-8'), 'e2e-t330-ax2.csv')
      .expect(201);
    const batchId = uploadRes.body.batchId;
    createdBatchIds.push(batchId);
    expect(uploadRes.body.validation.lineAnalysis.valid).toBe(2);
    expect(uploadRes.body.validation.lineAnalysis.errors).toBe(0);

    const processRes = await request(app.getHttpServer())
      .post(`/on-invoice/${batchId}/process`)
      .set(admin.authHeader())
      .send({})
      .expect(201);
    expect(
      processRes.body.processedCount ?? processRes.body.processed,
    ).not.toBe(0);

    const entryRows = await dataSource.query(
      `SELECT id, status FROM main.on_invoice_entries WHERE batch_id = $1 ORDER BY invoice_no`,
      [batchId],
    );
    expect(entryRows.length).toBe(2);
    for (const row of entryRows) {
      expect(row.status).toBe('POSTED'); // ikisi de GEÇTİ — hiçbiri reddedilmedi
    }

    const ledgerRows = await dataSource.query(
      `SELECT le.amount, le.spend_type FROM main.ledger_entries le
         JOIN main.on_invoice_entries e ON e.id = le.source_id
        WHERE e.batch_id = $1`,
      [batchId],
    );
    expect(ledgerRows.length).toBe(2);
    expect(
      ledgerRows.every(
        (r: { spend_type: string }) => r.spend_type === 'ON_INVOICE',
      ),
    ).toBe(true);

    // Zarf artık GERÇEKTEN %100'ün üstünde — SQL ile doğrudan doğrulanır
    // (mock DEĞİL, gerçek v_budget_summary).
    const summary = await dataSource.query(
      `SELECT allocated_amount, available_amount FROM main.v_budget_summary
        WHERE envelope_id = $1 AND tenant_id = $2`,
      [envelopeDefaultId, fixture.tenantId],
    );
    const allocated = Number(summary[0].allocated_amount);
    const available = Number(summary[0].available_amount);
    const utilizationPct = ((allocated - available) / allocated) * 100;
    expect(utilizationPct).toBeGreaterThan(100);
  });

  // ── POZ.KONTROL — blockPct KONFİGÜRASYONDAN değiştirilir, pin YİNE tutar ──

  it('POZ.KONTROL: blockPct=60 (CAT-DIGER özel politikası) — %70 RESERVE (default %100 eşiğinde GEÇERDİ) yine de REDDEDİLİR', async () => {
    const agreementId = await createAndSubmitAgreement(
      700, // %70 — DEFAULT joker (100) altında ama ÖZEL politika (60) üstünde
      PERIOD_CUSTOM,
      'E2E-T330-POZ',
    );

    const fm = await loginAs(app, 'FINANCE_MANAGER');
    const approveRes = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/approve`)
      .set(fm.authHeader())
      .send({});

    expect(approveRes.status).toBe(409);
    expect(approveRes.body.code).toBe('BUDGET_BLOCK_THRESHOLD_EXCEEDED');
    // Mesaj gövdesinde GERÇEKTEN 60'ın okunduğunu (sabit 100 DEĞİL) doğrula.
    expect(JSON.stringify(approveRes.body)).toMatch(/%60/);

    const txRows = await dataSource.query(
      `SELECT count(*)::int AS c FROM main.budget_transactions
        WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2`,
      [fixture.tenantId, agreementId],
    );
    expect(txRows[0].c).toBe(0);
  });

  it('POZ.KONTROL — negatif kontrast: AYNI %70 tutar, BAKİR bir DEFAULT (blockPct=100) zarfında GEÇER (özel politikanın gerçekten SEÇİCİ olduğunun kanıtı)', async () => {
    // `envelopeContrastId` — AXIS-1/AXIS-2'nin tükettiği `envelopeDefaultId`
    // İLE KARIŞTIRILMAZ (bkz. beforeAll'daki not) — tamamen bakir bir zarf.
    const agreementId = await createAndSubmitAgreement(
      700, // %70 of 1000 — default joker (100) altında, bloklanmamalı
      PERIOD_CONTRAST,
      'E2E-T330-CONTRAST',
    );
    const fm = await loginAs(app, 'FINANCE_MANAGER');
    const approveRes = await request(app.getHttpServer())
      .post(`/agreements/${agreementId}/approve`)
      .set(fm.authHeader())
      .send({});

    expect(approveRes.status).toBe(200);

    const txRows = await dataSource.query(
      `SELECT tx_type, tx_status FROM main.budget_transactions
        WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2`,
      [fixture.tenantId, agreementId],
    );
    expect(txRows.length).toBeGreaterThan(0);
    expect(
      txRows.every((r: { tx_status: string }) => r.tx_status === 'POSTED'),
    ).toBe(true);
  });
});
