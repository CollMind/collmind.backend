/**
 * plan-escalate-to-finance.e2e-spec.ts — `SC-1b` (`Faz-2 W1`, `FAZ2_PLANLAMA_BRIEF.md §1iv`)
 *
 * Kapsam: `POST /plans/:id/escalate-to-finance`
 * (`ApprovalWorkflowService#escalateToFinance`) — uçtan uca, mock YOK.
 * Ölçüldü: bu uca dokunan hiçbir e2e dosyası yoktu (aynı boşluk, `SC-1a` ile
 * kardeş).
 *
 * ⛔ `AYIRT EDİCİ` (brief `§1iv`, `K-2.2.7b` `notify|approve` ekseni —
 * `2b` devir-listesinde `L2`'ye henüz YAZILMAMIŞ, `TL görüşü (b)`): bu
 * yükselme bir **BİLDİRİM** mi (durum değişmez, CM hâlâ kendi kuyruğunda
 * görür/onaylayabilir) yoksa bir **ONAY GEÇİDİ** mi (durum PENDING_
 * FINANCE_REVIEW'a geçer, yetki CM'den FM'e devredilir)? Kod okuması
 * (`approval-workflow.service.ts:793-808`, `updateStatusCas` ile durum
 * yazımı) ikinciyi iddia ediyor — bu suite bunu GERÇEK HTTP ile ölçer ve
 * CM'in escalate SONRASI hâlâ approve edip edemediğini test eder (kod
 * okumasının doğrulanmamış varsayım olmadığını kanıtlamak için).
 *
 * Fixture izolasyonu: `E2E-PLANESCALATE-` önekli, sıfır-spend planlar.
 *
 * BULGU (kardeş dosya `plan-review-decision.e2e-spec.ts` başlığına bakınız):
 * `POST /plans/:id/review` `decision=approve` koşulsuz 400 veriyor
 * (`ApprovalWorkflowService#approvePlan`, kilitli satırdan boş channel
 * kodu okuyor). `escalateToFinance`'in KENDİSİ etkilenmiyor (E1/E4 YEŞİL)
 * — ama bu suite'in AYIRT EDİCİ kanıtı (`E2`/`E3`, FM'in escalate SONRASI
 * approve edebildiğini göstermek) o approve çağrısına dayanıyor ve bu
 * yüzden KIRMIZI kalıyor. Durum geçişinin kendisi (`PENDING_FINANCE_
 * REVIEW`) `E1`'de bağımsız SQL kanıtıyla zaten doğrulanmış durumda —
 * `E2`/`E3`'ün kırmızısı escalate mekanizmasının değil, approve
 * mekanizmasının kusurudur.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  E2EFixture,
  cleanupTestPlans,
  resolveIdByCode,
} from './helpers/seed-e2e';
import { closeAdminDataSource } from './helpers/admin-datasource';

describe('Plan Escalate To Finance (E2E) — POST /plans/:id/escalate-to-finance, SC-1b', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CPL_1: string;
  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let FU_TUP_BOYA: string;

  const NAME_PREFIX = 'E2E-PLANESCALATE-';

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [CPL_1, CHANNEL_NKA, CATEGORY_SAC_BOYASI, FU_TUP_BOYA] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'cpls', 'BS0501.50001'),
      resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
      resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-SAC-BOYASI'),
      resolveIdByCode(
        app,
        fixture.tenantId,
        'forecasting_units',
        'FU-TUP-BOYA',
      ),
    ]);
  }, 60000);

  afterAll(async () => {
    try {
      await cleanupTestPlans(app, fixture.tenantId, NAME_PREFIX);
    } catch (e) {
      console.warn('Cleanup (plan-escalate-to-finance plans) başarısız:', e);
    }
    await closeTestApp();
    await closeAdminDataSource();
  }, 60000);

  async function createPendingApprovalPlan(): Promise<string> {
    const planner = await loginAs(app, 'PLANNER');
    const createRes = await request(app.getHttpServer())
      .post('/plans')
      .set(planner.authHeader())
      .send({
        planName: `${NAME_PREFIX}${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`,
        cplId: CPL_1,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY_SAC_BOYASI,
        startDate: '2026-01-05',
        endDate: '2026-01-31',
      })
      .expect(201);
    const planId = createRes.body.id;

    await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(planner.authHeader())
      .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
      .expect(201);

    // FU eklemek plan.version'ı bump eder (recalc side-effect) — bkz.
    // plan-review-decision.e2e-spec.ts aynı not.
    const afterFuRes = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(planner.authHeader())
      .expect(200);

    await request(app.getHttpServer())
      .post(`/plans/${planId}/submit`)
      .set(planner.authHeader())
      .send({ version: afterFuRes.body.version })
      .expect(200);

    return planId;
  }

  it('E1: CATEGORY_MANAGER escalate eder — 200, plan durumu PENDING_FINANCE_REVIEW olur, plan_approval_history ESCALATED satırı yazılır', async () => {
    const planId = await createPendingApprovalPlan();
    const cm = await loginAs(app, 'CATEGORY_MANAGER');

    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/escalate-to-finance`)
      .set(cm.authHeader())
      .send({ reason: 'E1 e2e — finansa yükseltme', comments: 'test' });

    expect(res.status).toBe(200);

    const dbRow = await dataSource.query(
      `SELECT status, pending_finance_review, escalation_reason FROM main.plans WHERE id = $1`,
      [planId],
    );
    expect(dbRow[0].status).toBe('PENDING_FINANCE_REVIEW');
    expect(dbRow[0].pending_finance_review).toBe(true);
    expect(dbRow[0].escalation_reason).toBe('E1 e2e — finansa yükseltme');

    const historyRows = await dataSource.query(
      `SELECT action FROM main.plan_approval_history WHERE plan_id = $1 AND action = 'ESCALATED'`,
      [planId],
    );
    expect(historyRows.length).toBe(1);
  });

  // ── ⛔ AYIRT EDİCİ — bildirim mi (durum değişmez) onay geçidi mi (durum
  // değişir + FM devralır) — GERÇEK HTTP zinciriyle her ikisi de ölçülür ──

  it("E2 (AYIRT EDİCİ — ONAY GEÇİDİ kanıtı): escalate SONRASI FINANCE_MANAGER review edebiliyor — durum gerçekten PENDING_FINANCE_REVIEW'a geçti, bir 'bildirim' değil", async () => {
    const planId = await createPendingApprovalPlan();
    const cm = await loginAs(app, 'CATEGORY_MANAGER');
    await request(app.getHttpServer())
      .post(`/plans/${planId}/escalate-to-finance`)
      .set(cm.authHeader())
      .send({ reason: 'E2 e2e — FM devralımı kanıtı' })
      .expect(200);

    const fm = await loginAs(app, 'FINANCE_MANAGER');
    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/review`)
      .set(fm.authHeader())
      .send({ decision: 'approve', comments: 'FM onayı — escalate sonrası' });

    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('APPROVED');
  });

  it('E3 (durum-geçişi kanıtı — negatif taraf): escalate ÖNCESİ FINANCE_MANAGER aynı planı review edemez (bkz. SC-1a R2) — bu KONTRASTIR, bir bildirim olsaydı FARK YARATMAZDI', async () => {
    const planId = await createPendingApprovalPlan();
    const fm = await loginAs(app, 'FINANCE_MANAGER');

    const before = await request(app.getHttpServer())
      .post(`/plans/${planId}/review`)
      .set(fm.authHeader())
      .send({ decision: 'approve' });
    expect(before.status).toBe(403);

    const cm = await loginAs(app, 'CATEGORY_MANAGER');
    await request(app.getHttpServer())
      .post(`/plans/${planId}/escalate-to-finance`)
      .set(cm.authHeader())
      .send({ reason: 'E3 e2e — escalate sonrası tekrar dene' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .post(`/plans/${planId}/review`)
      .set(fm.authHeader())
      .send({ decision: 'approve', comments: 'E3 ikinci deneme' });
    expect(after.status).toBe(200);
  });

  it('E4 (RBAC — escalate ucu): PLANNER escalate edemez — 403, durum DEĞİŞMEZ', async () => {
    const planId = await createPendingApprovalPlan();
    const planner = await loginAs(app, 'PLANNER');

    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/escalate-to-finance`)
      .set(planner.authHeader())
      .send({ reason: 'PLANNER deneme' });

    expect(res.status).toBe(403);

    const dbRow = await dataSource.query(
      `SELECT status FROM main.plans WHERE id = $1`,
      [planId],
    );
    expect(dbRow[0].status).toBe('PENDING_APPROVAL');
  });
});
