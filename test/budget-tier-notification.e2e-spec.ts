/**
 * budget-tier-notification.e2e-spec.ts — `T-319` `P4b` (bildirim-yolu-
 * canlılığı, UÇTAN UCA/mock'suz) + görünür fallback pini (`Z59 §2`).
 *
 * Kaynak: `Z56 §4` · `Z57` · `Z59` (`docs/brd-v2/04_KARAR_KAYDI.md`).
 *
 * `P1`–`P4a` (ilişki-pini/şablon/tekrar-bastırma/sessiz-düşme yasağı) unit
 * seviyesinde pinli: `src/modules/shared/budget/budget-tier-notification
 * .service.spec.ts`. Bu dosya YALNIZ `P4b`'yi (ve onun ayrılmaz parçası
 * görünür-fallback'i) uçtan uca — gerçek HTTP RESERVE tetikleyicisi
 * (`agreement approve`) → gerçek DB satırı → `GET /notifications`
 * gerçekten O SATIRI döndürüyor mu — sınar. Mock YOK.
 *
 * Gerekçe (task metni): "tablo, servis, kanal ve UI'ın dördü de vardı ve
 * zincir KOPUKTU — her parça tek tek 'var' diye raporlanabilirdi"
 * (bileşimsel fail-open). `createNotification çağrıldı mı` sorusu YETMEZ.
 *
 * Fixture izolasyonu: her senaryo TAZE (bu dosyaya özel, önceden hiç
 * kullanılmamış) bir dönem + zarf kullanır (`E2E-TIER-` önekli kod).
 * `afterAll` bu suite'in ürettiği TÜM satırları temizler.
 *
 * ⚠️ `main.notifications` üzerinde `app_runtime`'ın DELETE hakkı YOK
 * (ölçüldü, `relacl`: `app_runtime=arw` — DELETE'siz, `ledger_entries`/
 * `admin_audit_logs`/`agreement_transactions` ile AYNI korunmuş-tablo
 * ailesi, K-2.6.13 KARAR 1 deseni). Bu yüzden bu suite'in `notifications`
 * temizliği `adminDataSource` (`app_migrate`) üzerinden yapılır — diğer
 * tablolar (`budget_envelopes`/`budget_transactions`/`agreements`/
 * `agreement_transactions`... agreement_transactions AYRICA korunmuş)
 * `dataSource` (`app_runtime`) ile.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

describe('Budget Tier Notification — P4b uçtan uca + görünür fallback (T-319)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CPL_1: string;
  let CHANNEL_NKA: string;
  let FU: string;
  let TACTIC: string;
  let MECHANIC_OFF: string;
  let categoryManagerUserId: string;

  // Bu dosyaya özel, seed'de/başka hiçbir e2e dosyasında kullanılmayan
  // dönemler — `budget_envelopes` seed'inde en yüksek period '2026-02'
  // (ölçüldü); '2028-*' hem seed'den hem sales-actuals'ın kullandığı
  // '2027-*' fiscal_period aralığından (ayrı bir kavram, ama karışıklığı
  // önlemek için) uzak.
  const PERIOD_OWNER = '2028-01';
  const PERIOD_FALLBACK = '2028-02';
  const ENV_CODE_OWNER = `E2E-TIER-OWNER-${Date.now()}`;
  const ENV_CODE_FALLBACK = `E2E-TIER-FALLBACK-${Date.now()}`;

  const createdEnvelopeIds: string[] = [];
  const createdAgreementIds: string[] = [];

  interface NotificationRow {
    type: string;
    recipientId: string;
    status: string;
    body: string;
    metadata?: {
      budgetEnvelopeId?: string;
      fallbackRecipient?: boolean;
      fallbackReason?: string;
      financeReviewThresholdPct?: number;
    };
  }

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

  async function createEnvelope(
    code: string,
    period: string,
    budgetOwnerId?: string,
  ): Promise<string> {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(admin.authHeader())
      .send({
        code,
        name: `T-319 fixture ${code}`,
        fiscalYear: '2028',
        period,
        channel: 'NKA',
        channelId: CHANNEL_NKA,
        allocatedAmount: 1000,
        status: 'ACTIVE',
        currency: 'TRY',
        ...(budgetOwnerId ? { budgetOwnerId } : {}),
      })
      .expect(201);
    createdEnvelopeIds.push(res.body.id);
    return res.body.id as string;
  }

  /** Oluşturur + submit eder + FINANCE_MANAGER onaylar — capTotalAmount kadar RESERVE yazar. */
  async function approveAgreementReserving(
    period: string,
    capTotalAmount: number,
  ): Promise<string> {
    const admin = await loginAs(app, 'ADMIN');
    const createRes = await request(app.getHttpServer())
      .post('/agreements')
      .set(admin.authHeader())
      .send({
        agreementName: `E2E-TIER-AGR-${period}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`,
        agreementType: 'STA',
        cplId: CPL_1,
        channelId: CHANNEL_NKA,
        fuId: FU,
        tacticId: TACTIC,
        mechanicId: MECHANIC_OFF,
        skuScope: 'FU',
        capTotalAmount,
        spendType: 'BOTH', // UNSPLIT zarf — §5.7 interim rule
        startDate: `${period}-05`,
        endDate: `${period}-25`,
        justification: 'T-319 uçtan uca — budget tier notification',
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

    return agreementId;
  }

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [CPL_1, CHANNEL_NKA, FU, TACTIC, MECHANIC_OFF] = await Promise.all([
      resolveIdByCode('cpls', 'BS0501.50001'),
      resolveIdByCode('channels', 'NKA'),
      resolveIdByCode('forecasting_units', 'FU-WELLA-HC-500ML'),
      resolveIdByCode('tactics', 'TAC-PROMO'),
      resolveIdByCode('mechanics', 'CPP_OFF_PCT'),
    ]);

    const cmRows = await dataSource.query(
      `SELECT id FROM main.users WHERE tenant_id = $1 AND email = 'category.manager@wella.com' LIMIT 1`,
      [fixture.tenantId],
    );
    if (!cmRows?.[0]?.id) {
      throw new Error('fixture missing: category.manager@wella.com');
    }
    categoryManagerUserId = cmRows[0].id;
  }, 60000);

  afterAll(async () => {
    try {
      const adminDataSource = await getAdminDataSource();

      for (const agreementId of createdAgreementIds) {
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
      if (createdAgreementIds.length > 0) {
        // `admin_audit_logs` — app_runtime DELETE hakkı yok (K-2.6.13 KARAR 1)
        await adminDataSource.query(
          `DELETE FROM main.admin_audit_logs WHERE entity_id = ANY($1::uuid[])`,
          [createdAgreementIds],
        );
      }

      if (createdEnvelopeIds.length > 0) {
        // `notifications` — ÖLÇÜLDÜ: app_runtime relacl = 'arw' (DELETE yok,
        // ledger_entries/admin_audit_logs/agreement_transactions ile aynı
        // korunmuş-tablo ailesi) — bu yüzden app_migrate.
        await adminDataSource.query(
          `DELETE FROM main.notifications WHERE metadata->>'budgetEnvelopeId' = ANY($1::text[])`,
          [createdEnvelopeIds],
        );
        await dataSource.query(
          `DELETE FROM main.budget_transactions WHERE envelope_id = ANY($1::uuid[])`,
          [createdEnvelopeIds],
        );
        await dataSource.query(
          `DELETE FROM main.budget_envelopes WHERE id = ANY($1::uuid[])`,
          [createdEnvelopeIds],
        );
      }
    } catch (e) {
      console.warn('Cleanup (budget tier notification e2e) başarısız:', e);
    }

    await closeTestApp();
    await closeAdminDataSource();
  });

  it(
    'TN-01 (owner path): WARNING (%80) sahibe, FINANCE_REVIEW (%90) FINANCE ' +
      "rolüne — İKİSİ DE GET /notifications ile GERÇEKTEN OKUNABİLİR (mock'suz)",
    async () => {
      const envelopeId = await createEnvelope(
        ENV_CODE_OWNER,
        PERIOD_OWNER,
        categoryManagerUserId,
      );

      // %80'e tam ulaşır (800/1000) — WARNING tetiklenmeli, doğrudan owner'a.
      await approveAgreementReserving(PERIOD_OWNER, 800);

      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const cmNotifRes = await request(app.getHttpServer())
        .get('/notifications?limit=100')
        .set(cm.authHeader())
        .expect(200);

      const warningRow = cmNotifRes.body.find(
        (n: NotificationRow) =>
          n.type === 'BUDGET_ALERT_80' &&
          n.metadata?.budgetEnvelopeId === envelopeId,
      );
      // P4b — YETMEZ "createNotification çağrıldı", GEREKLİ GET satırı
      // GERÇEKTEN döndürüyor.
      expect(warningRow).toBeDefined();
      expect(warningRow.recipientId).toBe(categoryManagerUserId);
      expect(warningRow.metadata.fallbackRecipient).toBeFalsy();
      expect(warningRow.status).not.toBe('FAILED'); // P4a: IN_APP yolu FAILED üretmiyor

      // %90'a çıkar (900/1000) — FINANCE_REVIEW tetiklenmeli, FINANCE rolüne.
      await approveAgreementReserving(PERIOD_OWNER, 100);

      const fm = await loginAs(app, 'FINANCE_MANAGER');
      const finance = await loginAs(app, 'FINANCE');
      const [fmNotifRes, financeNotifRes] = await Promise.all([
        request(app.getHttpServer())
          .get('/notifications?limit=100')
          .set(fm.authHeader())
          .expect(200),
        request(app.getHttpServer())
          .get('/notifications?limit=100')
          .set(finance.authHeader())
          .expect(200),
      ]);

      for (const res of [fmNotifRes, financeNotifRes]) {
        const financeReviewRow = res.body.find(
          (n: NotificationRow) =>
            n.type === 'BUDGET_FINANCE_REVIEW' &&
            n.metadata?.budgetEnvelopeId === envelopeId,
        );
        expect(financeReviewRow).toBeDefined();
        expect(financeReviewRow.metadata.financeReviewThresholdPct).toBe(90);
      }
    },
    30000,
  );

  it(
    "TN-02 (görünür fallback, Z59 §2): owner'sız zarf → WARNING FINANCE'e " +
      'düşer VE gövde "yönlendirilemedi" bilgisini TAŞIR — mock\'suz GET ile',
    async () => {
      // Fixture ayrımı KASITLI: owner FINANCE OLMAYAN biri değil, HİÇ owner
      // yok — bu yüzden owner-yolu ile fallback-yolu FARKLI alıcılara düşer
      // (task uyarısı: fixture, ayırt etmek istediği iki tarafta FARKLI
      // değer taşımalı). CATEGORY_MANAGER'ın bu bildirimi ALMADIĞI da pinli.
      const envelopeId = await createEnvelope(
        ENV_CODE_FALLBACK,
        PERIOD_FALLBACK,
        undefined, // owner YOK
      );

      await approveAgreementReserving(PERIOD_FALLBACK, 800); // %80

      const finance = await loginAs(app, 'FINANCE');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const [financeNotifRes, cmNotifRes] = await Promise.all([
        request(app.getHttpServer())
          .get('/notifications?limit=100')
          .set(finance.authHeader())
          .expect(200),
        request(app.getHttpServer())
          .get('/notifications?limit=100')
          .set(cm.authHeader())
          .expect(200),
      ]);

      const fallbackRow = financeNotifRes.body.find(
        (n: NotificationRow) =>
          n.type === 'BUDGET_ALERT_80' &&
          n.metadata?.budgetEnvelopeId === envelopeId,
      );
      expect(fallbackRow).toBeDefined();
      expect(fallbackRow.metadata.fallbackRecipient).toBe(true);
      expect(fallbackRow.metadata.fallbackReason).toBe('OWNER_UNSET');
      // Asıl satır: bir log satırı değil, ÜRÜN YÜZEYİNDE (gövde) görünürlük.
      expect(String(fallbackRow.body)).toMatch(/yönlendirilemedi/);
      expect(fallbackRow.status).not.toBe('FAILED');

      const cmLeakRow = cmNotifRes.body.find(
        (n: NotificationRow) => n.metadata?.budgetEnvelopeId === envelopeId,
      );
      expect(cmLeakRow).toBeUndefined();
    },
    30000,
  );
});
