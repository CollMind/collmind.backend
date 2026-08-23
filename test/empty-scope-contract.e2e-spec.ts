/**
 * empty-scope-contract.e2e-spec.ts
 *
 * ⚠️ DARALTILDI (T-272/Z22, 2026-08-23) — T-270/Z21 bu dosyayı "EVERY
 * CPL-scoped Planner (empty scope or not) now gets `unavailable`" diye
 * yazmıştı: `budget_envelopes`'ın `cplId` boyutu yok diye
 * `DashboardService#getSummary` CPL-kapsamlı her çağıran için
 * `getBudgetUtilization`'ı HİÇ ÇAĞIRMIYORDU (fail-closed kapı).
 *
 * O beklenti `docs/decisions/PLAN_BUTCE_NETLESTIRME.md` `netleştirme-1` ile
 * ÇELİŞİYORDU: kilitlemesiz model görünürlük olmadan savunulamaz, ve bir
 * PLANNER zarf doluluğunu GÖNDERİMDEN ÖNCE GÖRMEK ZORUNDA. Kapı Z22 ile
 * KALDIRILDI — gerekçe: `getBudgetUtilization` `filters.cplIds`'i zaten HİÇ
 * UYGULAMIYORDU (`computeBudgetUtilization` JSDoc'u, A7: bütçe CPL
 * ekseninde TANIMSAL olarak duyarsız), yani kapı bir kısıtı korumuyordu —
 * yalnız bir yeteneği (görünürlüğü) kapatıyordu.
 *
 * `A1` ile bu karar KARIŞMAZ: veri yokluğu (`unavailable`) ile kapsam AYRI
 * sinyallerdir, ve zarf özetinde kapsam UYGULANMAZ — bkz. `A1 GİRDİ 2`.
 *
 * ⚠️ Ve `K-2.6.8a` (`REVOKE_ALL` = erişim yok) bu kararla ÇELİŞMEZ:
 * `REVOKE_ALL` MÜŞTERİ-SATIRI erişimini kaldırır (`Agreement`/
 * `ApprovalRequest` sorguları — `cplIds` ile hâlâ filtrelenir, aşağıdaki
 * poz.kontrol bunu ayrıca ölçer). Zarf özeti TENANT-YAPISAL veridir (katalog
 * sınıfı — `Z22` karar kaydı) ve rol katmanının konusudur, kapsam katmanının
 * değil. Tam kilitleme isteniyorsa aracı HESAP ASKIYA ALMADIR, kapsam
 * boşaltma değil.
 *
 * ⛔ Bu dosya SİLİNMEDİ — daraltıldı: müşteri-verisi tarafında boş kapsam
 * beklentisi hâlâ doğru (üç sayaç `0` kalır), yalnız zarf tarafında yanlıştı.
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

describe('T-272/Z22 — budget_envelopes tenant-yapısal veridir: dashboard budgetUtilization kapsam-duyarsız', () => {
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
   * T-272/Z22 pin #1 — kapı KALDIRILDI: CPL-kapsamlı bir PLANNER (dolu ya
   * da boş kapsam) ADMIN'in gördüğü AYNI tenant toplamını görür. Bütçe CPL
   * ekseninde TANIMSAL olarak duyarsız (A7) — kapsam bu dalı etkilemez.
   * ================================================================ */
  it('T-272/Z22 PİN 1 — kapsamı DOLU (gerçek CPL) PLANNER "ok" + ADMIN ile AYNI toplamı görür', async () => {
    const body = await summary(scopedPlannerAuth, PERIOD);

    expect(body.budgetUtilizationStatus).toBe('ok');
    expect(body.budgetUtilization?.total.allocated).toBe(ENVELOPE_ALLOCATED);
  });

  it('T-272/Z22 PİN 3 — kapsamı BOŞ (REVOKE_ALL) PLANNER de "ok" + AYNI toplamı görür (zarf paneli AÇIK)', async () => {
    const body = await summary(emptyScopePlannerAuth, PERIOD);

    expect(body.budgetUtilizationStatus).toBe('ok');
    expect(body.budgetUtilization?.total.allocated).toBe(ENVELOPE_ALLOCATED);
  });

  /* ================================================================ *
   * A1 KORUNUR (T-272/Z22 pin #2) — veri yokluğu ile kapsam ayrı sinyal.
   * Zarfı OLMAYAN bir dönemde REVOKE_ALL PLANNER da "unavailable" görür —
   * kapsam genişledi diye YANLIŞ bir sıfır rakamı ASLA üretilmez.
   * ================================================================ */
  it('A1 KORUNUR — zarfı OLMAYAN dönemde REVOKE_ALL PLANNER "unavailable" görür, "ok" + ₺0 DEĞİL', async () => {
    const body = await summary(emptyScopePlannerAuth, EMPTY_PERIOD);

    expect(body.budgetUtilizationStatus).toBe('unavailable');
    expect(body.budgetUtilization).toBeNull();
  });

  it('POZİTİF KONTROL — CPL-scoped PLANNER için diğer ÜÇ sayaç bu dalın DIŞINDA, hâlâ hesaplanıyor', async () => {
    // ⚠️ ÖLÇÜLDÜ: PERIOD_2'de (2099-08) hiç zarf YOK — bu suite yalnız
    // PERIOD'a (2099-07) zarf yaratıyor. Yani buradaki 'unavailable' A1'İN
    // (veri yokluğu) cevabıdır, kapsamın DEĞİL — ilk taslak bunu 'ok'
    // bekliyordu ve PERIOD_2'yi PERIOD ile karıştırıyordu (yanlış yöne
    // yanılan bir ölçüm, ölçülüp düzeltildi). Kapsamın bu dalı etkilemediği
    // zaten PİN 1/PİN 3 testlerinde (PERIOD, 'ok') ayrıca kanıtlı; bu test
    // yalnız üç sayacın A1/A2 dalından BAĞIMSIZ hesaplandığını gösterir.
    const body = await summary(scopedPlannerAuth, PERIOD_2);

    expect(typeof body.activeAgreementCount).toBe('number');
    expect(typeof body.pendingApprovalCount).toBe('number');
    expect(typeof body.openTaskCount).toBe('number');
    expect(body.budgetUtilizationStatus).toBe('unavailable');
  });

  /* ================================================================ *
   * T-272/Z22 PİN 3 — DAVRANIŞSAL: "müşteri panelleri KAPALI · zarf paneli
   * AÇIK" tek bir sayının aynı yönde yanılmadığını göstermek için İKİ FARKLI
   * kapsamla ölçülür (fixture'ın ayırt etme gücü — CLAUDE.md "Fixture, iki
   * tarafta FARKLI değer taşımalı"). `GET /dashboard/cpl-status` CPL
   * (Customer × Product Line) satırı döner — müşteri-satırı verisi, ve
   * REVOKE_ALL burada hâlâ KAPALI olmalı (K-2.6.8a bozulmadı); aynı anda
   * `/dashboard/summary`'nin zarf paneli AÇIK.
   * ================================================================ */
  it("T-272/Z22 PİN 3 (davranışsal) — kapsamı DOLU PLANNER cpl-status'ta CPL_A'yı GÖRÜR", async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/cpl-status')
      .set(scopedPlannerAuth)
      .expect(200);

    expect(
      (res.body.items as Array<{ cplId: string }>).some(
        (item) => item.cplId === CPL_A,
      ),
    ).toBe(true);
  });

  it("T-272/Z22 PİN 3 (davranışsal) — kapsamı BOŞ (REVOKE_ALL) PLANNER cpl-status'ta HİÇBİR ŞEY GÖRMEZ — müşteri paneli KAPALI kalır", async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/cpl-status')
      .set(emptyScopePlannerAuth)
      .expect(200);

    expect(res.body.items).toEqual([]);

    // Aynı kullanıcı, aynı anda: zarf paneli AÇIK. İki panel AYNI kapsamdan
    // farklı sinyal üretiyor — kapsam katmanı ile bütçenin CPL-ekseni
    // duyarsızlığı (A7) birbirine KARIŞMIYOR.
    const budgetBody = await summary(emptyScopePlannerAuth, PERIOD);
    expect(budgetBody.budgetUtilizationStatus).toBe('ok');
  });
});
