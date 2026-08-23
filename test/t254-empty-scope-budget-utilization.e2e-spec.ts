/**
 * t254-empty-scope-budget-utilization.e2e-spec.ts
 *
 * ⚠️ REWRITTEN (T-270/Z21, 2026-08-23) — the ORIGINAL [[T-254]] fail-open
 * fix this file guarded (`budgetUtilization` fail-open on an empty CPL
 * scope) lived entirely on `budget_allocations` via `POST
 * /budget-allocations`. `budget_allocations` is now RETIRED as a data
 * source (K-2.2.3 violation, 0 rows in every measured tenant — Z21 karar
 * kaydı): `FinanceReportingService#getBudgetUtilization` reads
 * `budget_envelopes` exclusively. Running the ORIGINAL assertions against
 * today's code measured THREE failures — all three original tests expected
 * `budgetUtilizationStatus: 'ok'` and got `'unavailable'`, because
 * `budget_allocations` no longer feeds this endpoint at all.
 *
 * This is not a mechanical port. `budget_envelopes` has NO `cplId` column
 * (K-2.2.1 defines an envelope as Kanal × Kategori × Dönem; A7 places CPL in
 * the scope layer). `DashboardService#getSummary` was changed (same T-270
 * turn) to FAIL CLOSED for a CPL-scoped caller (R-2) rather than call
 * `getBudgetUtilization` with a restriction it cannot honour — so the
 * ORIGINAL "PLANNER, kapsam=[CPL_A] → sees only CPL_A's total" scenario is
 * no longer just untested, it is no longer a claim this system can make.
 * What replaces it: EVERY CPL-scoped Planner (empty scope or not) now gets
 * `unavailable`, and that collapse is itself the thing under test.
 *
 * ⚠️ SCOPE_ENFORCEMENT_ENABLED bu suite'in KENDİ process'inde, app boot'undan
 * ÖNCE, module-level'de zorlanır (user-scope-creation.e2e-spec.ts'in aynı
 * deseni ve aynı gerekçesi): AccessScopeService bayrağı yalnız constructor'da
 * bir kez okur, ve bayrak kapalıyken PLANNER koşulsuz UNRESTRICTED döner —
 * yani bu dosyanın ölçtüğü CPL-scope durumu HİÇ OLUŞMAZ. Bayrağın etkili
 * olduğu `beforeAll`'da AYRICA doğrulanır, ve dosya kendi ölçümünden sonra
 * bayrağı ESKİ DEĞERİNE geri koyar (`--runInBand` altında process env
 * dosyalar arasında paylaşılır).
 */
process.env.SCOPE_ENFORCEMENT_ENABLED = 'true';

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { closeAdminDataSource } from './helpers/admin-datasource';
import {
  loadE2EFixture,
  E2EFixture,
  resolveIdByCode,
  cleanupTestUsers,
} from './helpers/seed-e2e';

/**
 * Uzak bir dönem BİLİNÇLİ: bu suite'in zarflarının seed'in/başka
 * spec'lerin zarflarıyla karışmasın diye. `EMPTY_PERIOD` ise A1'in
 * "boş küme → unavailable" pinini taşımak için AYRICA uzak ve HİÇ zarf
 * yaratılmayan bir dönem.
 */
const PERIOD = '2099-07';
const PERIOD_2 = '2099-08';
const EMPTY_PERIOD = '2099-09';
const FISCAL_YEAR = '2099';

const ENVELOPE_ALLOCATED = 11500;
const CODE_PREFIX = 'T270-E2E';

interface SummaryBody {
  budgetUtilizationStatus: 'ok' | 'unavailable';
  budgetUtilization: {
    total: { allocated: number };
    onInvoice: { allocated: number };
    offInvoice: { allocated: number };
  } | null;
  activeAgreementCount: number;
  pendingApprovalCount: number;
  openTaskCount: number;
}

describe('T-270/Z21 — budget_envelopes canonical: dashboard budgetUtilization', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let CPL_A: string;

  const envelopeIds: string[] = [];
  const scratchUserIds: string[] = [];

  let scopedPlannerAuth: { Authorization: string };
  let emptyScopePlannerAuth: { Authorization: string };

  const previousFlag = process.env.SCOPE_ENFORCEMENT_ENABLED;

  async function createActiveEnvelope(
    adminHeader: { Authorization: string },
    code: string,
    period: string,
    allocatedAmount: number,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/budget/envelopes')
      .set(adminHeader)
      .send({
        code,
        fiscalYear: FISCAL_YEAR,
        period,
        allocatedAmount,
        status: 'ACTIVE',
        // spendType intentionally omitted — UNSPLIT (spend_type NULL),
        // the regime every seeded envelope in this tenant already uses
        // (measured 2026-08-23, main.budget_envelopes: 4/4 NULL).
      })
      .expect(201);
    envelopeIds.push(res.body.id);
    return res.body.id;
  }

  /** Kapsamlı bir PLANNER yaratır ve token'ını döner. */
  async function createPlannerWithScope(
    adminHeader: { Authorization: string },
    label: string,
  ): Promise<{ userId: string; header: { Authorization: string } }> {
    const email = `e2e-t270-${label}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@wella.com`;
    const password = 'Collmind2026!';

    const created = await request(app.getHttpServer())
      .post('/users')
      .set(adminHeader)
      .send({
        email,
        password,
        fullName: `T-270 ${label}`,
        role: 'PLANNER',
        status: 'ACTIVE',
        scope: [{ cplId: CPL_A, categoryId: null }],
      })
      .expect(201);
    scratchUserIds.push(created.body.id);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return {
      userId: created.body.id,
      header: { Authorization: `Bearer ${login.body.accessToken}` },
    };
  }

  async function summary(
    header: { Authorization: string },
    period: string,
  ): Promise<SummaryBody> {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/summary?period=${period}`)
      .set(header)
      .expect(200);
    return res.body as SummaryBody;
  }

  beforeAll(async () => {
    if (process.env.SCOPE_ENFORCEMENT_ENABLED !== 'true') {
      // §2.7 pozitif kontrol: bayrak bu process'te gerçekten etkili mi?
      // Değilse PLANNER UNRESTRICTED'a düşer ve bu dosya hiçbir şey ölçmez.
      throw new Error(
        't270 spec: SCOPE_ENFORCEMENT_ENABLED bu process\'te "true" değil — ' +
          'dosyanın en üstündeki atama AppModule import edilmeden önce ' +
          'çalışmalıydı.',
      );
    }

    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());
    clearTokenCache();
    fixture = await loadE2EFixture(app);

    CPL_A = await resolveIdByCode(
      app,
      fixture.tenantId,
      'cpls',
      'BS0501.50001',
    );

    const admin = await loginAs(app, 'ADMIN');
    const adminHeader = admin.authHeader();

    // Önceki bir koşumun kalıntısı varsa temizle — aksi halde `createActiveEnvelope`
    // 409 (code çakışması) döner ve suite kurulumda patlar.
    await dataSource.query(
      `DELETE FROM main.budget_envelopes
        WHERE tenant_id = $1 AND fiscal_year = $2`,
      [fixture.tenantId, FISCAL_YEAR],
    );

    await createActiveEnvelope(
      adminHeader,
      `${CODE_PREFIX}/${PERIOD}`,
      PERIOD,
      ENVELOPE_ALLOCATED,
    );

    const scoped = await createPlannerWithScope(adminHeader, 'scoped');
    scopedPlannerAuth = scoped.header;

    const empty = await createPlannerWithScope(adminHeader, 'empty');
    emptyScopePlannerAuth = empty.header;

    // [[T-242a]] — kapsamı BOŞALT. Bu kullanıcı bu andan önce hiçbir
    // kapsamlı uca istek atmadı, yani AccessScopeService cache'inde satırı
    // yok.
    await request(app.getHttpServer())
      .patch(`/users/${empty.userId}/scope`)
      .set(adminHeader)
      .send({
        intent: 'REVOKE_ALL',
        scope: [],
        reason: 'T-270 e2e — CPL-scope fail-closed reprodüksiyonu',
      })
      .expect(200);

    const rows = await dataSource.query(
      `SELECT count(*)::int AS c FROM main.user_scopes
        WHERE user_id = $1 AND is_active = true`,
      [empty.userId],
    );
    if (rows[0].c !== 0) {
      throw new Error(
        `t270 spec: REVOKE_ALL sonrası aktif kapsam satırı ${rows[0].c} — ` +
          '0 bekleniyordu; boş kapsam durumu KURULAMADI.',
      );
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized && envelopeIds.length > 0) {
      await dataSource.query(
        `DELETE FROM main.budget_envelopes WHERE id = ANY($1::uuid[])`,
        [envelopeIds],
      );
    }
    // `cleanupTestUsers` `app_migrate` bağlantısını açar (admin_audit_logs
    // DELETE hakkı `app_runtime`'da yok) — kapatılmazsa suite sonuna kadar
    // açık kalır (helpers/admin-datasource.ts, M-2 notu).
    await cleanupTestUsers(app, scratchUserIds);
    await closeAdminDataSource();
    await closeTestApp();

    if (previousFlag === undefined) {
      delete process.env.SCOPE_ENFORCEMENT_ENABLED;
    } else {
      process.env.SCOPE_ENFORCEMENT_ENABLED = previousFlag;
    }
  });

  /* ================================================================ *
   * Z21 pin #1 — davranışsal pin ÇİFTİ: gerçek veri görünür ∧ boş küme
   * unavailable/GREY döner (GREEN DEĞİL). İki girdi, iki çıktı.
   * ================================================================ */
  it('A1+A2 GİRDİ 1 — gerçek zarf verisi olan bir dönemde ADMIN "ok" + gerçek toplamı görür', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const body = await summary(admin.authHeader(), PERIOD);

    expect(body.budgetUtilizationStatus).toBe('ok');
    expect(body.budgetUtilization?.total.allocated).toBe(ENVELOPE_ALLOCATED);
  });

  it('A1 GİRDİ 2 — zarfı OLMAYAN bir dönemde ADMIN "unavailable" görür, "ok" + ₺0 DEĞİL', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const body = await summary(admin.authHeader(), EMPTY_PERIOD);

    expect(body.budgetUtilizationStatus).toBe('unavailable');
    expect(body.budgetUtilization).toBeNull();
  });

  /* ================================================================ *
   * T-270/Z21 measured gap — CPL-scoped bir çağıran hiçbir zaman "ok"
   * DÖNMEMELİ: budget_envelopes'ta cplId boyutu yok, ve bu kısıtı
   * onurlandıramayan bir çağrı sessizce geniş bir figür göstermemeli
   * (K-2.6.8a fail-open sınıfı; fail-closed, R-2).
   * ================================================================ */
  it('T-270/Z21 — kapsamı DOLU (gerçek CPL) PLANNER "unavailable" görür, envelope modelinde CPL kısıtı onurlandırılamaz', async () => {
    const body = await summary(scopedPlannerAuth, PERIOD);

    expect(body.budgetUtilizationStatus).toBe('unavailable');
    expect(body.budgetUtilization).toBeNull();
  });

  it('T-270/Z21 — kapsamı BOŞ (REVOKE_ALL) PLANNER de "unavailable" görür (aynı fail-closed dal)', async () => {
    const body = await summary(emptyScopePlannerAuth, PERIOD);

    expect(body.budgetUtilizationStatus).toBe('unavailable');
    expect(body.budgetUtilization).toBeNull();
  });

  it('POZİTİF KONTROL — CPL-scoped PLANNER için diğer ÜÇ sayaç bu dalın DIŞINDA, hâlâ hesaplanıyor', async () => {
    const body = await summary(scopedPlannerAuth, PERIOD_2);

    // Bu üç sayaç FinanceReportingService'ten değil, DashboardService'in
    // kendi Agreement/ApprovalRequest sorgularından gelir — budget_envelopes
    // modeliyle ilgisi yok, ve fail-closed dal onları etkilememeli.
    expect(typeof body.activeAgreementCount).toBe('number');
    expect(typeof body.pendingApprovalCount).toBe('number');
    expect(typeof body.openTaskCount).toBe('number');
    expect(body.budgetUtilizationStatus).toBe('unavailable');
  });
});
