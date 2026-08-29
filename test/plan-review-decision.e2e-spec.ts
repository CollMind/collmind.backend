/**
 * plan-review-decision.e2e-spec.ts — `SC-1a` (`Faz-2 W1`, `FAZ2_PLANLAMA_BRIEF.md §1iv`)
 *
 * Kapsam: `POST /plans/:id/review` (`ApprovalWorkflowService#reviewPlan`) —
 * uçtan uca, mock YOK. Ölçüldü: bu uca dokunan hiçbir e2e dosyası yoktu
 * (`grep -rn "/review\b" test/*.e2e-spec.ts` → 0 satır) — kapanış beyanının
 * "halka 1" boşluğu.
 *
 * ⛔ `AYIRT EDİCİ`: bu suite ÜÇ farklı reddedişi/kabulü birbirinden ayırır —
 * hepsi aynı HTTP 403/200 kabuğunun ALTINDA farklı bir mekanizmadır:
 *   1) RBAC reddi        — rol `@Roles` kümesinde YOK (PLANNER)
 *   2) durum-bağımlı red — rol kümede VAR ama plan durumu uygun DEĞİL
 *      (FINANCE, `ADR 0002`: yalnız PENDING_FINANCE_REVIEW inceleyebilir)
 *   3) gerçek durum geçişi + audit satırı — CATEGORY_MANAGER APPROVE/REJECT
 * Üçü de aynı testte "403 döndü" diye tek bir kovaya atılırsa (`§2.7 #6`)
 * hangi mekanizmanın çalıştığı hiç ölçülmemiş olur.
 *
 * Fixture izolasyonu: `E2E-PLANREVIEW-` önekli plan adları; sıfır-spend
 * (FU eklenir, volume/tactic PATCH edilmez — reviewPlan'in durum makinesini
 * test eder, bütçe tutarını değil) → envelope kapasitesine bağımlılık yok.
 *
 * ⛔ BULGU (bu suite'in ürettiği, DÜZELTİLMEDİ — QA kapsamı raporlar,
 * düzeltmez): `POST /plans/:id/review` `decision=approve`, GERÇEK bir
 * approve YAPAMIYOR — `ApprovalWorkflowService#approvePlan`
 * (`approval-workflow.service.ts` ~505), `channelCode`'u KİLİTLİ satırdan
 * okuyor (`plan.channel?.code`, `findByIdForUpdate` sonucu — bu sorgu
 * `relations: ['channel']` TAŞIMIYOR, TypeORM `@ManyToOne` varsayılan
 * olarak eager DEĞİL) ⇒ `channel` HER ZAMAN `undefined`, `channelCode`
 * HER ZAMAN `''` ⇒ envelope arama `channel: ''` ile başarısız olur ⇒
 * HER approve denemesi `400 "No active budget envelope found for
 * channel: , period: ..."` ile döner — fixture'a bağlı değil, KOŞULSUZ.
 * Kontrast: kardeş uç `PlanService#approve` (`plan.service.ts:1363`)
 * `channelCode`'u KİLİT ÖNCESİ `this.findById(id, tenantId)`'den okur
 * (o metod relation'ları yükler) — AYNI hatayı YAPMIYOR. Yani bu, `§7`'nin
 * "aynı yetenek iki kez yazıldı, biri doğru biri yanlış" sınıfının yeni
 * bir vakası. `R3`/`R4` bu yüzden `approve` dalında KIRMIZI kalıyor —
 * testin kendisi değil, ölçtüğü uç bozuk. Kayıt: yeni bir debugger task'ı
 * gerektirir (bu dosyanın kapsamı dışında, `DUR` listesi: "başka kusur
 * bulursan RAPOR ET, DÜZELTME").
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

describe('Plan Review Decision (E2E) — POST /plans/:id/review, SC-1a', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CPL_1: string;
  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let FU_TUP_BOYA: string;

  const NAME_PREFIX = 'E2E-PLANREVIEW-';

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
      console.warn('Cleanup (plan-review-decision plans) başarısız:', e);
    }
    await closeTestApp();
    await closeAdminDataSource();
  }, 60000);

  /** DRAFT plan yaratır, bir FU ekler (grid mirası SKU'yu otomatik getirir),
   * ve PENDING_APPROVAL'a submit eder. Sıfır-spend — bu suite'in kapsamı
   * durum makinesi/RBAC/audit, bütçe tutarı değil. */
  async function createPendingApprovalPlan(): Promise<{
    planId: string;
    submitterId: string;
  }> {
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
    expect(createRes.body.status).toBe('DRAFT');

    await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(planner.authHeader())
      .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
      .expect(201);

    // FU eklemek plan.version'ı bump eder (recalc side-effect) — submit'in
    // K5 optimistic-lock kontrolü GERÇEK güncel versiyonu ister, sabit `1`
    // DEĞİL (ölçüldü: FU sonrası version=2).
    const afterFuRes = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(planner.authHeader())
      .expect(200);
    const currentVersion = afterFuRes.body.version;

    const submitRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/submit`)
      .set(planner.authHeader())
      .send({ version: currentVersion })
      .expect(200);
    expect(submitRes.body.status).toBe('PENDING_APPROVAL');

    return { planId, submitterId: planner.userId };
  }

  // ── AYIRT EDİCİ 1: RBAC reddi (rol @Roles kümesinde yok) ─────────────────

  it('R1 (RBAC reddi): PLANNER kendi PENDING_APPROVAL planını /review edemez — 403, plan durumu DEĞİŞMEZ', async () => {
    const { planId } = await createPendingApprovalPlan();
    const planner = await loginAs(app, 'PLANNER');

    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/review`)
      .set(planner.authHeader())
      .send({ decision: 'approve', comments: 'self-review deneme' });

    expect(res.status).toBe(403);

    const dbRow = await dataSource.query(
      `SELECT status FROM main.plans WHERE id = $1`,
      [planId],
    );
    expect(dbRow[0].status).toBe('PENDING_APPROVAL');

    const historyRows = await dataSource.query(
      `SELECT action FROM main.plan_approval_history WHERE plan_id = $1 AND action IN ('APPROVED','REJECTED')`,
      [planId],
    );
    expect(historyRows.length).toBe(0);
  });

  // ── AYIRT EDİCİ 2: durum-bağımlı red (rol kümede var, plan durumu uygun değil, ADR 0002) ──

  it('R2 (durum-bağımlı red, ADR 0002): FINANCE, escalate EDİLMEMİŞ (PENDING_APPROVAL) bir planı review edemez — 403, RBAC reddinden FARKLI SEBEP', async () => {
    const { planId } = await createPendingApprovalPlan();
    const finance = await loginAs(app, 'FINANCE_MANAGER');

    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/review`)
      .set(finance.authHeader())
      .send({ decision: 'approve', comments: 'FM erken müdahale deneme' });

    // Route seviyesinde FINANCE @Roles kümesinde VAR (403 burada RolesGuard'dan
    // DEĞİL, ApprovalWorkflowService#reviewPlan'in ADR-0002 durum kontrolünden
    // gelmeli) — R1'in RBAC reddinden mekanik olarak FARKLI.
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/PENDING_FINANCE_REVIEW/);

    const dbRow = await dataSource.query(
      `SELECT status FROM main.plans WHERE id = $1`,
      [planId],
    );
    expect(dbRow[0].status).toBe('PENDING_APPROVAL');
  });

  // ── AYIRT EDİCİ 3: gerçek durum geçişi + audit satırı (APPROVE) ──────────

  it('R3 (durum geçişi + audit, APPROVE): CATEGORY_MANAGER onaylar — plan APPROVED olur, plan_approval_history APPROVED satırı yazılır', async () => {
    const { planId } = await createPendingApprovalPlan();
    const cm = await loginAs(app, 'CATEGORY_MANAGER');

    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/review`)
      .set(cm.authHeader())
      .send({ decision: 'approve', comments: 'R3 e2e onay' });

    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('APPROVED');

    const dbRow = await dataSource.query(
      `SELECT status FROM main.plans WHERE id = $1`,
      [planId],
    );
    expect(dbRow[0].status).toBe('APPROVED');

    const historyRows = await dataSource.query(
      `SELECT action, comments FROM main.plan_approval_history
        WHERE plan_id = $1 AND action = 'APPROVED'`,
      [planId],
    );
    expect(historyRows.length).toBe(1);
    expect(historyRows[0].comments).toBe('R3 e2e onay');
  });

  // ── AYIRT EDİCİ 3b (kardeş yol): gerçek durum geçişi + audit satırı (REJECT) ──

  it('R4 (durum geçişi + audit, REJECT): CATEGORY_MANAGER reddeder — plan REJECTED olur, plan_approval_history REJECTED satırı yazılır', async () => {
    const { planId } = await createPendingApprovalPlan();
    const cm = await loginAs(app, 'CATEGORY_MANAGER');

    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/review`)
      .set(cm.authHeader())
      .send({ decision: 'reject', rejectionReason: 'R4 e2e red gerekçesi' });

    expect(res.status).toBe(200);
    expect(res.body.newStatus).toBe('REJECTED');

    const dbRow = await dataSource.query(
      `SELECT status FROM main.plans WHERE id = $1`,
      [planId],
    );
    expect(dbRow[0].status).toBe('REJECTED');

    const historyRows = await dataSource.query(
      `SELECT action FROM main.plan_approval_history
        WHERE plan_id = $1 AND action = 'REJECTED'`,
      [planId],
    );
    expect(historyRows.length).toBe(1);
  });
});
