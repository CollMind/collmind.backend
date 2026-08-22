/**
 * t254-empty-scope-budget-utilization.e2e-spec.ts
 *
 * [[T-254]] — BOŞ KAPSAM (`[]`) iki katmanda ZIT yorumlanıyordu:
 *
 *   dashboard.service.ts      `cplIds !== null`      → `[]` "filtre VAR"  → gönderilir
 *   finance-reporting.service `cplIds.length > 0`    → `[]` "filtre YOK"  → KISIT DÜŞER
 *
 * Sonuç bir FAIL-OPEN'dı: kapsamı boşaltılmış (`PATCH /users/:id/scope`,
 * `intent: REVOKE_ALL` — [[T-242a]]) bir kullanıcı `/dashboard/summary`'nin
 * `budgetUtilization` bölümünde TÜM TENANT'ın bütçe tahsislerini görüyordu.
 * `K-2.6.8a`: "Boş kapsam = ERİŞİM YOK."
 *
 * ⚠️ İKİ GİRDİ, İKİ ÇIKTI (task AC): yalnız "boş kapsam → 0" pinlenirse o `0`
 * "veri yok"tan da gelebilirdi. Bu yüzden aynı fixture üzerinde ÜÇ ölçüm var
 * ve üçü FARKLI sayı döndürür:
 *
 *   ADMIN (UNRESTRICTED)          → A + B  (tenant geneli)
 *   PLANNER, kapsam = [CPL_A]     → A      (yalnız kendi CPL'i)
 *   PLANNER, kapsam = []          → 0      (hiçbir satır)
 *
 * ⚠️ POZİTİF KONTROL (task AC): boş kapsamlı kullanıcıda diğer ÜÇ sayaç
 * (`activeAgreementCount` · `pendingApprovalCount` · `openTaskCount`) zaten
 * DOĞRU davranıyordu — `0`. Onlar da assert ediliyor: kusurun TEK NOKTADA
 * olduğunu ve düzeltmenin sistematik bir şeyi değiştirmediğini gösterir.
 *
 * ⚠️ SCOPE_ENFORCEMENT_ENABLED bu suite'in KENDİ process'inde, app boot'undan
 * ÖNCE, module-level'de zorlanır (user-scope-creation.e2e-spec.ts'in aynı
 * deseni ve aynı gerekçesi): AccessScopeService bayrağı yalnız constructor'da
 * bir kez okur, ve bayrak kapalıyken PLANNER koşulsuz UNRESTRICTED döner —
 * yani bu dosyanın ölçtüğü `[]` durumu HİÇ OLUŞMAZ ve suite sessizce hiçbir
 * şey ölçmez (CLAUDE.md §2.7). Bayrağın etkili olduğu `beforeAll`'da AYRICA
 * doğrulanır, ve dosya kendi ölçümünden sonra bayrağı ESKİ DEĞERİNE geri
 * koyar (`--runInBand` altında process env dosyalar arasında paylaşılır).
 *
 * ⚠️ AccessScopeService'in 5 sn'lik kapsam cache'i bilinçli olarak
 * ATLANIYOR — `clearCache`'in üretim çağıranı yok ([[T-242a]] bulgusu). Boş
 * kapsamlı kullanıcı, REVOKE_ALL'dan ÖNCE hiçbir kapsamlı uca istek atmaz,
 * yani onun için cache satırı hiç doğmaz. `sleep(5s)` ile beklemek yerine bu
 * seçildi: bekleme, ölçümü zamana bağlar.
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
 * Uzak bir dönem BİLİNÇLİ: bu suite'in tahsisleri seed'in/başka spec'lerin
 * tahsisleriyle karışmasın diye. Böylece "ADMIN tam olarak A+B görür"
 * assertion'ı bir EŞİTLİK olabiliyor — `toBeGreaterThan` değil.
 */
const PERIOD = '2099-07';
const PERIOD_START = '2099-07-01';
const PERIOD_END = '2099-07-31';
const FISCAL_YEAR = 2099;

const ALLOC_A_ON = 1000;
const ALLOC_A_OFF = 500;
const ALLOC_B_ON = 7000;
const ALLOC_B_OFF = 3000;
const TOTAL_A = ALLOC_A_ON + ALLOC_A_OFF; // 1500
const TOTAL_B = ALLOC_B_ON + ALLOC_B_OFF; // 10000
const TOTAL_TENANT = TOTAL_A + TOTAL_B; // 11500

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

describe('T-254 — boş kapsam → budgetUtilization (fail-open regresyonu)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let CPL_A: string;
  let CPL_B: string;

  const allocationIds: string[] = [];
  const scratchUserIds: string[] = [];

  let scopedPlannerAuth: { Authorization: string };
  let emptyScopePlannerAuth: { Authorization: string };

  const previousFlag = process.env.SCOPE_ENFORCEMENT_ENABLED;

  async function createAllocation(
    adminHeader: { Authorization: string },
    cplId: string,
    onInvoiceBudget: number,
    offInvoiceBudget: number,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/budget-allocations')
      .set(adminHeader)
      .send({
        periodType: 'monthly',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        fiscalYear: FISCAL_YEAR,
        cplId,
        onInvoiceBudget,
        offInvoiceBudget,
      })
      .expect(201);
    allocationIds.push(res.body.id);
    return res.body.id;
  }

  /** Kapsamlı bir PLANNER yaratır ve token'ını döner. */
  async function createPlannerWithScope(
    adminHeader: { Authorization: string },
    label: string,
  ): Promise<{ userId: string; header: { Authorization: string } }> {
    const email = `e2e-t254-${label}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@wella.com`;
    const password = 'Collmind2026!';

    const created = await request(app.getHttpServer())
      .post('/users')
      .set(adminHeader)
      .send({
        email,
        password,
        fullName: `T-254 ${label}`,
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

  async function summary(header: {
    Authorization: string;
  }): Promise<SummaryBody> {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/summary?period=${PERIOD}`)
      .set(header)
      .expect(200);
    return res.body as SummaryBody;
  }

  beforeAll(async () => {
    if (process.env.SCOPE_ENFORCEMENT_ENABLED !== 'true') {
      // §2.7 pozitif kontrol: bayrak bu process'te gerçekten etkili mi?
      // Değilse PLANNER UNRESTRICTED'a düşer ve bu dosya hiçbir şey ölçmez.
      throw new Error(
        't254 spec: SCOPE_ENFORCEMENT_ENABLED bu process\'te "true" değil — ' +
          'dosyanın en üstündeki atama AppModule import edilmeden önce ' +
          'çalışmalıydı.',
      );
    }

    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());
    clearTokenCache();
    fixture = await loadE2EFixture(app);

    [CPL_A, CPL_B] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'cpls', 'BS0501.50001'),
      resolveIdByCode(app, fixture.tenantId, 'cpls', 'BS0502.50002'),
    ]);

    const admin = await loginAs(app, 'ADMIN');
    const adminHeader = admin.authHeader();

    // Önceki bir koşumun kalıntısı varsa temizle — aksi halde
    // `createAllocation` 409 (overlapping) döner ve suite kurulumda patlar.
    await dataSource.query(
      `DELETE FROM main.budget_allocations
        WHERE tenant_id = $1 AND fiscal_year = $2`,
      [fixture.tenantId, FISCAL_YEAR],
    );

    await createAllocation(adminHeader, CPL_A, ALLOC_A_ON, ALLOC_A_OFF);
    await createAllocation(adminHeader, CPL_B, ALLOC_B_ON, ALLOC_B_OFF);

    const scoped = await createPlannerWithScope(adminHeader, 'scoped');
    scopedPlannerAuth = scoped.header;

    const empty = await createPlannerWithScope(adminHeader, 'empty');
    emptyScopePlannerAuth = empty.header;

    // [[T-242a]] — kapsamı BOŞALT. Bu kullanıcı bu andan önce hiçbir
    // kapsamlı uca istek atmadı, yani AccessScopeService cache'inde satırı
    // yok (dosya başlığındaki nota bkz.).
    await request(app.getHttpServer())
      .patch(`/users/${empty.userId}/scope`)
      .set(adminHeader)
      .send({
        intent: 'REVOKE_ALL',
        scope: [],
        reason: 'T-254 e2e — boş kapsam fail-open reprodüksiyonu',
      })
      .expect(200);

    const rows = await dataSource.query(
      `SELECT count(*)::int AS c FROM main.user_scopes
        WHERE user_id = $1 AND is_active = true`,
      [empty.userId],
    );
    if (rows[0].c !== 0) {
      throw new Error(
        `t254 spec: REVOKE_ALL sonrası aktif kapsam satırı ${rows[0].c} — ` +
          '0 bekleniyordu; boş kapsam durumu KURULAMADI.',
      );
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized && allocationIds.length > 0) {
      // budget_transaction_logs → budget_allocations FK'si ON DELETE CASCADE
      // (budget-transaction-log.entity.ts) — tahsisi silmek ALLOCATION log
      // satırını da götürür.
      await dataSource.query(
        `DELETE FROM main.budget_allocations WHERE id = ANY($1::uuid[])`,
        [allocationIds],
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

  it('ÖN KOŞUL — ADMIN (UNRESTRICTED) tenant geneli tahsisi görür: A + B', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const body = await summary(admin.authHeader());

    expect(body.budgetUtilizationStatus).toBe('ok');
    expect(body.budgetUtilization?.total.allocated).toBe(TOTAL_TENANT);
  });

  it("GİRDİ 1 — kapsamı DOLU PLANNER yalnız kendi CPL'ini görür: A", async () => {
    const body = await summary(scopedPlannerAuth);

    expect(body.budgetUtilizationStatus).toBe('ok');
    expect(body.budgetUtilization?.total.allocated).toBe(TOTAL_A);
    // Ayırt edicilik: B'nin tek başına bile görünmediğini göster.
    expect(body.budgetUtilization?.total.allocated).not.toBe(TOTAL_TENANT);
    expect(body.budgetUtilization?.total.allocated).not.toBe(TOTAL_B);
  });

  it('GİRDİ 2 — kapsamı BOŞ (REVOKE_ALL) PLANNER hiçbir satır görmez: 0 (K-2.6.8a)', async () => {
    const body = await summary(emptyScopePlannerAuth);

    expect(body.budgetUtilizationStatus).toBe('ok');
    expect(body.budgetUtilization?.total.allocated).toBe(0);
    expect(body.budgetUtilization?.onInvoice.allocated).toBe(0);
    expect(body.budgetUtilization?.offInvoice.allocated).toBe(0);
  });

  it('POZİTİF KONTROL — aynı boş kapsamda diğer ÜÇ sayaç zaten 0 (kusur TEK noktadaydı)', async () => {
    const body = await summary(emptyScopePlannerAuth);

    expect(body.activeAgreementCount).toBe(0);
    expect(body.pendingApprovalCount).toBe(0);
    expect(body.openTaskCount).toBe(0);
  });
});
