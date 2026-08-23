/**
 * role-journey.e2e-spec.ts
 *
 * QA teşhis testi — "Uçtan uca rol bazlı akış" (bkz. görev tanımı, 2026-07-27).
 *
 * AMAÇ: Kod okuyup tahmin etmek yerine, gerçek rol JWT'leri ile gerçek HTTP
 * isteklerini uçtan uca çalıştırıp CollMind TPM'in Planning-First ve
 * Actuals-First akışlarını, RBAC sınırlarını ve dashboard rol görünürlüğünü
 * fiilen kanıtlamak. Bu dosya DÜZELTME içermez — yalnızca teşhis + regresyon.
 *
 * Her `record()` çağrısı bir satırı "role-journey sonuç tablosu"na ekler;
 * bu tablo afterAll'da console.table ile basılır (raporlama için).
 *
 * Test verisi izolasyonu:
 *   - Plan/agreement isimleri "E2E-ROLE-JOURNEY-" öneki taşır.
 *   - Off-invoice transaction'lar "E2E-INV-" pattern'i kullanır → cleanupTestTransactions.
 *   - Sales-actuals "2027-*" fiscalPeriod kullanır → cleanupSalesActuals.
 *   - Plan/agreement DELETE endpoint'i olmadığından (yalnızca DRAFT plan silinebilir,
 *     agreement'ın DELETE'i yok) bu kayıtlar DB'de "E2E-ROLE-JOURNEY-*" olarak kalır;
 *     dev DB'de gürültü yaratmamak için testin sonunda mümkün olanlar temizlenir
 *     (cleanupTestPlans/cleanupTestAgreements — T-060'tan itibaren bunların
 *     ürettiği approval_requests/admin_audit_logs izlerini de kapsar).
 *   - N9'un POST /users ile yarattığı tek-kullanımlık kullanıcı → cleanupTestUsers
 *     (T-060; DELETE /users yok, önceden yalnız deactivate ediliyordu ve DB'de
 *     kalıcı birikiyordu — main.users'ın %97'si).
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
  cleanupTestTransactions,
  cleanupSalesActuals,
  cleanupTestPlans,
  cleanupTestAgreements,
  cleanupTestUsers,
} from './helpers/seed-e2e';
import { closeAdminDataSource } from './helpers/admin-datasource';
import * as bcrypt from 'bcrypt';
import {
  User,
  UserRole,
  UserStatus,
} from '../src/database/entities/user.entity';
// T-056 adım 5, A18 fixture düzeltmesi (Team Lead onaylı, 2026-08-03):
// canlı `/submit` artık hiçbir zaman TOTAL kova yazmıyor (K1/§3.3) — A18'in
// "legacy TOTAL RESERVE'li plan" ön koşulunu kurmak için gerçek servisleri
// doğrudan çağırıyoruz (aynı `reserveForPlan(..., 'TOTAL', ...)` motoru,
// `/submit`'in T-056 ÖNCESİ kullandığıyla birebir aynı key formatı/mantık).
import { BudgetService } from '../src/modules/shared/budget/budget.service';
import { ApprovalService } from '../src/modules/shared/approval/approval.service';
import { ApprovalRequestType } from '../src/database/entities/approval-request.entity';

// ── Seed sabitleri — beforeAll'da KODA göre çözülür (hardcoded UUID YASAK:
// cleanup-and-seed master-data'yı yeniden yaratınca id'ler değişir; kod sabittir) ──
let CPL_1: string; // BS0501.50001 Gratis
let CPL_2: string; // BS0501.50004 A.S.Watson

// T-028c: SCOPE_ENFORCEMENT_ENABLED is resolved ONCE at app bootstrap
// (AccessScopeService constructor reads ConfigService) — it cannot be
// toggled mid-run, so every PLANNER-scope assertion in this file branches on
// this same env read to stay correct whether the suite is run with the flag
// on or off (both runs must be green — see T-028c task report).
const SCOPE_ENFORCEMENT_ON = process.env.SCOPE_ENFORCEMENT_ENABLED === 'true';
let CHANNEL_NKA: string; // code NKA
let CATEGORY_SAC_BOYASI: string; // CAT-SAC-BOYASI
let FU_TUP_BOYA: string; // FU-TUP-BOYA
let FU_WELLA_HC_500ML: string; // agreement seed FU (FU-WELLA-HC-500ML)
let TACTIC_PROMO: string; // TAC-PROMO
let MECHANIC_DISCOUNT: string; // MEC-DISCOUNT (on_invoice_discount, PERCENT)

/** Kod → id çözümlemesi; bulunamazsa anlaşılır hata (seed eksik demektir). */
async function resolveIdByCode(
  ds: DataSource,
  tenantId: string,
  table: string,
  code: string,
): Promise<string> {
  const rows = await ds.query(
    `SELECT id FROM main.${table} WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantId, code],
  );
  if (!rows?.[0]?.id) {
    throw new Error(
      `role-journey fixture: main.${table} içinde code='${code}' bulunamadı — önce 'npm run seed' çalıştırın.`,
    );
  }
  return rows[0].id;
}

interface JourneyResult {
  step: string;
  role: string;
  endpoint: string;
  expected: string | number;
  actual: string | number;
  note: string;
}

const results: JourneyResult[] = [];
function record(r: JourneyResult) {
  results.push(r);
}

describe('Role Journey (E2E) — Uçtan uca rol bazlı akış teşhisi', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  // A) Planning-first akışı boyunca doldurulan durum
  let planId: string;
  let planFuId: string;
  let planSkuId: string;
  let envelopeId: string | undefined;

  // C) Actuals-first akışı
  let agreementSettlementId: string; // settlement close için
  let agreementReversalId: string; // reversal için
  let reversalTransactionId: string;

  // T-060: N9 (scope-satırı-olmayan PLANNER) testinin POST /users ile
  // yarattığı tek-kullanımlık kullanıcı(lar) — DELETE /users yok, afterAll'da
  // cleanupTestUsers ile hard-delete edilir (bkz. o testin içindeki yorum).
  const scratchUserIds: string[] = [];

  // T-036: erken-yakalama invaryantı — bu suite'in agreement fixture'ları
  // NKA-Q2 envelope'unu kullanıyor (bkz. C1/C7 startDate 2026-02-*).
  // beforeAll'da snapshot alınır, afterAll'da (temizlik SONRASI) delta=0
  // doğrulanır — sızıntı varsa "Insufficient budget" ile başka bir teste
  // (veya başka bir spec dosyasına) sıçramadan BURADA net şekilde patlar.
  async function getEnvelopeSummary(code: string) {
    const rows = await dataSource.query(
      `SELECT vs.reserved_amount, vs.consumed_amount
       FROM main.v_budget_summary vs
       JOIN main.budget_envelopes be ON be.id = vs.envelope_id
       WHERE be.code = $1`,
      [code],
    );
    if (!rows?.[0]) {
      throw new Error(`getEnvelopeSummary: envelope code=${code} bulunamadı`);
    }
    return {
      reserved: Number(rows[0].reserved_amount),
      consumed: Number(rows[0].consumed_amount),
    };
  }
  let baselineNkaQ2: { reserved: number; consumed: number };

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
    await cleanupSalesActuals(app, fixture.tenantId);
    baselineNkaQ2 = await getEnvelopeSummary('ENV-2026-NKA-Q2');

    // Master-data id'lerini KODA göre çöz (reseed-sonrası id değişimine dayanıklı)
    const t = fixture.tenantId;
    [
      CPL_1,
      CPL_2,
      CHANNEL_NKA,
      CATEGORY_SAC_BOYASI,
      FU_TUP_BOYA,
      FU_WELLA_HC_500ML,
      TACTIC_PROMO,
      MECHANIC_DISCOUNT,
    ] = await Promise.all([
      resolveIdByCode(dataSource, t, 'cpls', 'BS0501.50001'),
      resolveIdByCode(dataSource, t, 'cpls', 'BS0501.50004'),
      resolveIdByCode(dataSource, t, 'channels', 'NKA'),
      resolveIdByCode(dataSource, t, 'categories', 'CAT-SAC-BOYASI'),
      resolveIdByCode(dataSource, t, 'forecasting_units', 'FU-TUP-BOYA'),
      resolveIdByCode(dataSource, t, 'forecasting_units', 'FU-WELLA-HC-500ML'),
      resolveIdByCode(dataSource, t, 'tactics', 'TAC-PROMO'),
      resolveIdByCode(dataSource, t, 'mechanics', 'MEC-DISCOUNT'),
    ]);
  }, 60000);

  afterAll(async () => {
    // ── Temizlik: test verisi bırakma ──
    try {
      if (agreementReversalId) {
        await cleanupTestTransactions(app, agreementReversalId);
      }
    } catch (e) {
      console.warn('Cleanup (reversal tx) başarısız:', e);
    }
    try {
      if (agreementSettlementId) {
        await cleanupTestTransactions(app, agreementSettlementId);
      }
    } catch (e) {
      console.warn('Cleanup (settlement tx) başarısız:', e);
    }
    try {
      await cleanupSalesActuals(app, fixture.tenantId);
    } catch (e) {
      console.warn('Cleanup (sales-actuals) başarısız:', e);
    }
    // Bu spec'in ürettiği TÜM planları (DRAFT + APPROVED) ve bütçe/audit izlerini temizle.
    // APPROVED planlar API'den silinemez (BRD) ama T-029'dan sonra bütçeyi kalıcı tutuyorlar
    // → temizlenmezse birkaç koşumda zarf tükeniyor ve submit/approve testleri "Insufficient
    // budget" ile kırılıyor (kod hatası değil, state birikimi). Test-only doğrudan SQL.
    try {
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-');
    } catch (e) {
      console.warn('Cleanup (plan) başarısız:', e);
    }

    // A19 (T-056 adım 6): bu testin ürettiği split-envelope fixture'larını
    // (ON ikizi id'yi korur, kod öneki 'E2E-A19-SPLIT-'; OFF ikizi aynı
    // önekin '-OFF' sonekli kod türevi — LIKE deseni ikisini de yakalar)
    // temizle. cleanupTestPlans'tan SONRA çalışmalı: bu planın
    // budget_transactions satırları (envelope_id FK) zaten silinmiş olmalı.
    try {
      const a19EnvRows = await dataSource.query(
        `SELECT id FROM main.budget_envelopes WHERE tenant_id = $1 AND code LIKE 'E2E-A19-SPLIT-%'`,
        [fixture.tenantId],
      );
      const a19EnvIds: string[] = a19EnvRows.map((r: { id: string }) => r.id);
      if (a19EnvIds.length > 0) {
        await dataSource.query(
          `DELETE FROM main.budget_transactions WHERE envelope_id = ANY($1::uuid[])`,
          [a19EnvIds],
        );
        await dataSource.query(
          `DELETE FROM main.budget_envelopes WHERE id = ANY($1::uuid[])`,
          [a19EnvIds],
        );
      }
    } catch (e) {
      console.warn('Cleanup (A19 split envelope) başarısız:', e);
    }

    // T-036: bu spec'in ürettiği TÜM agreement'ları (DRAFT/PENDING/APPROVED/
    // CLOSED/CANCELLED/REJECTED — hepsi 'E2E-' önekli) ve bütçe/ledger/audit
    // izlerini temizle. Özellikle C7-C9 (agreementReversalId) hiçbir zaman
    // close/cancel edilmiyor — bu çağrı olmadan RESERVE'i kalıcı olarak
    // NKA-Q2'yi tüketirdi (bkz. cleanupTestAgreements JSDoc'u).
    try {
      await cleanupTestAgreements(app, fixture.tenantId, 'E2E-');
    } catch (e) {
      console.warn('Cleanup (agreement) başarısız:', e);
    }

    // T-060: N9'un POST /users ile yarattığı kullanıcı(lar)ı hard-delete et
    // (bkz. N9 testi içindeki yorum ve cleanupTestUsers JSDoc'u).
    try {
      await cleanupTestUsers(app, scratchUserIds);
    } catch (e) {
      console.warn('Cleanup (users) başarısız:', e);
    }

    // ── T-036 invaryantı: temizlik sonrası NKA-Q2 tam olarak koşum-öncesi
    // değerine dönmeli. Dönmüyorsa bu suite (veya kardeş suite'ler) bir
    // yerde bütçe rezervasyonu/ledger tüketimi bırakıyor demektir — sızıntı
    // burada, "Insufficient budget" ile başka bir teste sıçramadan yakalanır.
    const afterNkaQ2 = await getEnvelopeSummary('ENV-2026-NKA-Q2');
    expect(afterNkaQ2.reserved).toBeCloseTo(baselineNkaQ2.reserved, 2);
    expect(afterNkaQ2.consumed).toBeCloseTo(baselineNkaQ2.consumed, 2);

    // ── Sonuç tablosunu bas ──
    // eslint-disable-next-line no-console
    console.log('\n=== ROLE JOURNEY SONUÇ TABLOSU ===');
    // eslint-disable-next-line no-console
    console.table(results);

    await closeTestApp();
    // M-2 (2026-08-16): bu dosyanın tek/en-dış `afterAll`'ı (`beforeAll`'daki
    // `cleanupSalesActuals` çağrısı da dahil, admin bağlantısı bu dosyanın
    // ömrü boyunca burada açılır). E), E2), F) describe'larının kendi
    // `afterAll`'ları yalnız HTTP çağrısı yapıyor (admin datasource
    // KULLANMIYOR) ve nested oldukları için jest-circus'ta bu outer
    // `afterAll`'dan ÖNCE bitmiş olurlar (ölçüldü) — kapatmak güvenli.
    await closeAdminDataSource();
  }, 60000);

  // ══════════════════════════════════════════════════════════════════════
  // A) PLANNING-FIRST AKIŞI
  // ══════════════════════════════════════════════════════════════════════

  describe('A) Planning-first akışı', () => {
    it('A1. PLANNER → POST /plans (gerçek CPL+kategori+dönem)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });

      record({
        step: 'A1',
        role: 'PLANNER',
        endpoint: 'POST /plans',
        expected: 201,
        actual: res.status,
        note:
          res.status === 201
            ? `planId=${res.body.id}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(201);
      planId = res.body.id;
      expect(res.body.status).toBe('DRAFT');
    });

    it('A2. PLANNER → POST /plans/:id/fus (FU-TUP-BOYA)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 });

      record({
        step: 'A2',
        role: 'PLANNER',
        endpoint: 'POST /plans/:id/fus',
        expected: 201,
        actual: res.status,
        note:
          res.status === 201
            ? `planFuId=${res.body.id}, skuCount=?`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(201);
      planFuId = res.body.id;

      // İlk SKU'yu al (grid hiyerarşisi: FU eklenince SKU'lar otomatik miras alınır)
      const planRes = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus.find((f: any) => f.id === planFuId);
      expect(planFu).toBeDefined();
      expect(planFu.planSkus.length).toBeGreaterThan(0);
      planSkuId = planFu.planSkus[0].skuId;
    });

    it('A3. PLANNER → PATCH SKU volume', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/skus/${planSkuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 });

      record({
        step: 'A3',
        role: 'PLANNER',
        endpoint: 'PATCH /plans/:id/fus/:fuId/skus/:skuId/volume',
        expected: 200,
        actual: res.status,
        note:
          res.status === 200
            ? `plannedVolume=${res.body.plannedVolume}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(200);
    });

    it('A4. PLANNER → PATCH FU tactic (CPP_ON_PCT=10, VIS_LS=2000)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${FU_TUP_BOYA}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10, VIS_LS: 2000 }, version: 1 });

      record({
        step: 'A4',
        role: 'PLANNER',
        endpoint: 'PATCH /plans/:id/fus/:fuId/tactics',
        expected: 200,
        actual: res.status,
        note:
          res.status === 200
            ? `tactics=${JSON.stringify(res.body.tactics)}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(200);
    });

    it('A5. PLANNER → POST /plans/:id/recalculate — KPI/ROI/RAG doluyor mu (COGS eksik → null, T-027 fix)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post(`/plans/${planId}/recalculate`)
        .set(planner.authHeader())
        .send({});

      // NOT: `planSkuId` A2'de `planFu.planSkus[0].skuId` olarak set edildi
      // (yani Sku.id, PlanSku satır PK'sı değil) — API `:skuId` route
      // parametresi de Sku.id bekliyor (bkz. plan.controller.ts
      // `:id/fus/:fuId/skus/:skuId/volume`), bu yüzden karşılaştırma
      // `s.skuId` üzerinden yapılmalı (PlanSku satırının kendi `id`'si
      // değil — önceki sürümde bu karışıklık yüzünden `sku` hep undefined
      // dönüyordu).
      const sku = res.body?.planFus?.[0]?.planSkus?.find(
        (s: any) => s.skuId === planSkuId,
      );

      record({
        step: 'A5',
        role: 'PLANNER',
        endpoint: 'POST /plans/:id/recalculate',
        expected: 200,
        actual: res.status,
        note:
          res.status === 200
            ? `plan.overallRoi=${res.body.overallRoi}, plan.ragStatus=${res.body.ragStatus}, plan.totalSpend=${res.body.totalSpend}, sku.gpRoi=${sku?.gpRoi}, sku.ragStatus=${sku?.ragStatus}, sku.plannedTurnover=${sku?.plannedTurnover}, sku.plannedGp=${sku?.plannedGp}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(200);
      expect(res.body.totalSpend).not.toBeNull();
      expect(sku).toBeDefined();

      // ── T-027 FIX KANITI: "eksik veri → null" BRD kuralı artık uygulanıyor ──
      // Seed'deki HİÇBİR gerçek Wella SKU'sunda cogs (main.skus.cogs) dolu
      // değil (kaynak Product.xlsx'te COGS alanı yok; BRD "varsayım yapma"
      // gereği uydurma COGS eklenmedi). BRD kuralı: eksik veri → null KPI.
      // T-027 öncesi `plan.service.ts:628 Number(sku.cogs) || 0` eksik
      // COGS'u sessizce 0'a düşürüyordu → PLANNED_GP = PLANNED_TO (tam
      // ciro) → GP_ROI_PCT = %100, ragStatus = GREEN gibi YANILTICI bir
      // "mükemmel skor" üretiyordu. T-027 fix: context'e null geçiyor →
      // formula-parser'ın dependency-null propagation'ı (zaten T-008'de
      // kurulu) PLANNED_COGS → PLANNED_GP → INCR_GP → GP_ROI_PCT zincirini
      // null'a düşürüyor; RAG de null kalıyor (fabrik GREEN üretilmiyor).
      expect(sku?.plannedGp).toBeNull();
      expect(sku?.gpRoi).toBeNull();
      expect(sku?.ragStatus).toBeNull();
      // BPTT (unitPrice) gerçek Wella SKU'larında dolu olduğundan PLANNED_TO
      // hâlâ hesaplanabilir (yalnızca COGS'a bağlı KPI'lar null olmalı).
      expect(sku?.plannedTurnover).not.toBeNull();
      expect(res.body.overallRoi).toBeNull();
      expect(res.body.ragStatus).toBeNull();

      const skuRow = await dataSource.query(
        `SELECT ps.planned_turnover, ps.planned_gp, ps.gp_roi, ps.rag_status
         FROM main.plan_skus ps
         WHERE ps.plan_fu_id = $1 AND ps.sku_id = $2`,
        [planFuId, planSkuId],
      );
      record({
        step: 'A5b',
        role: '-',
        endpoint:
          'DB: main.plan_skus (COGS eksik veri — T-027 fix doğrulaması)',
        expected:
          'planned_gp/gp_roi/rag_status NULL, planned_turnover NOT NULL (eksik COGS, dolu BPTT)',
        actual: `planned_turnover=${skuRow[0]?.planned_turnover}, planned_gp=${skuRow[0]?.planned_gp}, gp_roi=${skuRow[0]?.gp_roi}, rag_status=${skuRow[0]?.rag_status}`,
        note: 'T-027 FIX: plan.service.ts context artık eksik COGS için null geçiyor (Number(x)||0 yerine toNullableNumber) → planned_gp/gp_roi/rag_status DB’de NULL persist ediliyor (undefined skip değil, açık null — bkz. plan.entity.ts nullable:true + migration 1788000000000).',
      });
      expect(skuRow[0]?.planned_gp).toBeNull();
      expect(skuRow[0]?.gp_roi).toBeNull();
      expect(skuRow[0]?.rag_status).toBeNull();
      expect(skuRow[0]?.planned_turnover).not.toBeNull();
    });

    it('A5c. PLANNER → COGS dolu fixture SKU (FU-WELLA-HC-500ML) ile plan → sayısal ROI + doğru RAG (T-027 pozitif yol)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      // Ayrı bir plan: FU-WELLA-HC-500ML altındaki senkron test fixture'ı
      // (SKU-E2E-COGS-FIXTURE, unitPrice=100/cogs=60 — bkz. agreement.seed.ts)
      // gerçek Wella kataloğunun bir parçası DEĞİL, yalnızca e2e için; COGS
      // burada açık şekilde verilebilir (BRD'nin "varsayım yapma" kuralı
      // gerçek master data'yı uydurmayı yasaklar, sentetik test verisini değil).
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-COGS-FIXTURE-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const cogsFixturePlanId = createRes.body.id;

      const fuRes = await request(app.getHttpServer())
        .post(`/plans/${cogsFixturePlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);
      const cogsFixturePlanFuId = fuRes.body.id;

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${cogsFixturePlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus.find(
        (f: any) => f.id === cogsFixturePlanFuId,
      );
      expect(planFu).toBeDefined();
      expect(planFu.planSkus.length).toBeGreaterThan(0);
      const cogsFixtureSkuId = planFu.planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(
          `/plans/${cogsFixturePlanId}/fus/${FU_WELLA_HC_500ML}/skus/${cogsFixtureSkuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/plans/${cogsFixturePlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10, VIS_LS: 2000 }, version: 1 })
        .expect(200);

      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${cogsFixturePlanId}/recalculate`)
        .set(planner.authHeader())
        .send({});

      const fixtureSku = recalcRes.body?.planFus?.[0]?.planSkus?.find(
        (s: any) => s.skuId === cogsFixtureSkuId,
      );

      record({
        step: 'A5c',
        role: 'PLANNER',
        endpoint: 'POST /plans/:id/recalculate (COGS dolu fixture)',
        expected: 200,
        actual: recalcRes.status,
        note: `plan.overallRoi=${recalcRes.body.overallRoi}, plan.ragStatus=${recalcRes.body.ragStatus}, sku.gpRoi=${fixtureSku?.gpRoi}, sku.ragStatus=${fixtureSku?.ragStatus}, sku.plannedGp=${fixtureSku?.plannedGp}`,
      });

      expect(recalcRes.status).toBe(200);
      expect(fixtureSku).toBeDefined();
      // COGS dolu (60) → PLANNED_GP < PLANNED_TO → gerçek (100'den farklı,
      // null olmayan) bir ROI ve config-driven bir RAG üretilmeli.
      expect(fixtureSku?.plannedGp).not.toBeNull();
      expect(fixtureSku?.gpRoi).not.toBeNull();
      expect(Number(fixtureSku?.gpRoi)).not.toBe(100);
      expect(['RED', 'AMBER', 'GREEN']).toContain(fixtureSku?.ragStatus);
      expect(recalcRes.body.overallRoi).not.toBeNull();

      // Temizlik: bu yardımcı plan DRAFT durumunda, silinebilir.
      await request(app.getHttpServer())
        .delete(`/plans/${cogsFixturePlanId}`)
        .set(planner.authHeader())
        .send({ version: recalcRes.body.version });
    });

    it('A6. PLANNER → GET /plans/:id/budget-check', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get(`/plans/${planId}/budget-check`)
        .set(planner.authHeader())
        .expect(200);

      record({
        step: 'A6',
        role: 'PLANNER',
        endpoint: 'GET /plans/:id/budget-check',
        expected: 200,
        actual: res.status,
        note: JSON.stringify(res.body).slice(0, 200),
      });

      envelopeId = res.body.envelope?.id;
      // T-028a (F9) FIX: PlanController @Get(':id/budget-check') Roles artık
      // ADMIN, PLANNER, CATEGORY_MANAGER, READONLY içeriyor — planı hazırlayan
      // PLANNER artık kendi planının bütçe uygunluğunu kontrol edebiliyor.
    });

    it('A6b. ADMIN → GET /plans/:id/budget-check (fallback ile envelope doğrula)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get(`/plans/${planId}/budget-check`)
        .set(admin.authHeader())
        .expect(200);

      record({
        step: 'A6b',
        role: 'ADMIN',
        endpoint: 'GET /plans/:id/budget-check',
        expected: 200,
        actual: res.status,
        note: `hasBudget=${res.body.hasBudget}, sufficient=${res.body.sufficient}, envelope=${res.body.envelope?.code}`,
      });

      envelopeId = res.body.envelope?.id;
      expect(res.body.hasBudget).toBe(true);
    });

    it('A7. PLANNER → GET /plans/:id/analysis', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get(`/plans/${planId}/analysis`)
        .set(planner.authHeader());

      record({
        step: 'A7',
        role: 'PLANNER',
        endpoint: 'GET /plans/:id/analysis',
        expected: 200,
        actual: res.status,
        note: JSON.stringify(res.body).slice(0, 150),
      });

      expect(res.status).toBe(200);
    });

    it('A8. PLANNER → POST /plans/:id/submit-for-approval', async () => {
      const planner = await loginAs(app, 'PLANNER');

      // T-034b (code-review fix): submit-for-approval now validates
      // plans.version too (K5 exception, same as PlanService#submit) —
      // fetch the current version rather than assuming it.
      const currentPlan = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(planner.authHeader())
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/plans/${planId}/submit-for-approval`)
        .set(planner.authHeader())
        .send({
          submissionNotes: 'E2E role-journey submission',
          version: currentPlan.body.version,
        });

      record({
        step: 'A8',
        role: 'PLANNER',
        endpoint: 'POST /plans/:id/submit-for-approval',
        expected: 200,
        actual: res.status,
        note: `status=${res.body.status}, budgetCheck.overallSufficient=${res.body.budgetCheck?.overallSufficient}`,
      });

      // T-026 (D-1) FIX: PlanApprovalHistory artık merkezi DataSource entity
      // listelerinde (typeorm.config.ts + database.module.ts) kayıtlı → submit
      // 200 + PENDING_APPROVAL dönüyor (BRD beklentisiyle uyumlu).
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING_APPROVAL');

      const admin = await loginAs(app, 'ADMIN');
      const planCheck = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(admin.authHeader())
        .expect(200);

      record({
        step: 'A8b',
        role: '-',
        endpoint: 'GET /plans/:id (DB gerçek durum kontrolü)',
        expected: 'PENDING_APPROVAL',
        actual: planCheck.body.status,
        note: 'submit-for-approval başarılı; plan durumu ve approval history tutarlı şekilde ilerledi',
      });
      expect(planCheck.body.status).toBe('PENDING_APPROVAL');
    });

    it('A8c. T-048 FIX PROOF — submit-for-approval writes TWO separate RESERVE rows (ON_INVOICE + OFF_INVOICE), off-invoice is genuinely encumbered', async () => {
      // Self-contained plan (NOT the shared golden-path `planId`).
      //
      // T-052 FIX: this fixture used to INSERT directly into
      // `plan_mechanic_values` (bypassing the real UI flow entirely) to
      // work around a genuine bug — `SpendCalculationService
      // #calculateAllSpendsForFU` (used by `ApprovalWorkflowService
      // #submitForApproval`'s `calculateSpendBreakdown`) read ONLY
      // `plan_mechanic_values.enteredValue`, never `plan_fus.tactics`
      // (written by the ONLY UI-reachable entry point,
      // `PATCH .../fus/:fuId/tactics` -> `PlanService#updateFuTactic`). A
      // plan built the real way therefore computed on=0/off=0 through THIS
      // path even though `plan.totalSpend` was correctly non-zero through
      // the OTHER canonical path (`PlanService#submit`). Fixed by
      // `SpendCalculationService#buildMechanicValues`, now the single
      // shared derivation point both canonical paths call — see its doc
      // comment. This test now drives the mechanic values through the REAL
      // tactics-PATCH flow (no direct table seeding) to prove the fix
      // against the actual UI-reachable path, not a fixture shortcut.
      const planner = await loginAs(app, 'PLANNER');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-A8C-T048-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const t048PlanId = createRes.body.id;

      const fuRes = await request(app.getHttpServer())
        .post(`/plans/${t048PlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);
      const t048PlanFuId = fuRes.body.id;

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${t048PlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const t048SkuId = planRes.body.planFus.find(
        (f: any) => f.id === t048PlanFuId,
      ).planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(
          `/plans/${t048PlanId}/fus/${FU_WELLA_HC_500ML}/skus/${t048SkuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      // T-052 FIX: drive mechanic values through the REAL tactics-PATCH flow
      // (`PlanService#updateFuTactic`) instead of seeding
      // `plan_mechanic_values` directly. MEC-DISCOUNT (on_invoice_discount,
      // PERCENT, 10%) and CPP_OFF_PCT (off_invoice_discount, PERCENT, 5%) —
      // both on the SAME FU/envelope, so submit-for-approval's TWO
      // reserveBudgetForPlan calls (ON then OFF) land on the same UNSPLIT
      // (Faz 1) envelope, which is exactly the T-048 bug's trigger
      // condition. The tactics PATCH body is keyed by mechanic CODE, not id
      // (`UpdateFuTacticDto#tactics`), so no mechanic id lookup is needed
      // for CPP_OFF_PCT here.
      const tacticsRes = await request(app.getHttpServer())
        .patch(`/plans/${t048PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({
          tactics: { 'MEC-DISCOUNT': 10, CPP_OFF_PCT: 5 },
          version: 1,
        })
        .expect(200);
      expect(tacticsRes.body.tactics).toEqual({
        'MEC-DISCOUNT': 10,
        CPP_OFF_PCT: 5,
      });

      const preSubmitRes = await request(app.getHttpServer())
        .get(`/plans/${t048PlanId}`)
        .set(planner.authHeader())
        .expect(200);

      const submitRes = await request(app.getHttpServer())
        .post(`/plans/${t048PlanId}/submit-for-approval`)
        .set(planner.authHeader())
        .send({
          submissionNotes: 'E2E T-048 proof',
          version: preSubmitRes.body.version,
        });

      // T-056 adım 7 (ADR 0005 K1, deprecation faz 1): /submit-for-approval
      // hâlâ çalışıyor ama HTTP Deprecation başlığı taşımalı — çağıranı
      // /submit'e yönlendiren sözleşme sinyali.
      record({
        step: 'A8c-deprecation',
        role: '-',
        endpoint: 'HTTP header: Deprecation (submit-for-approval yanıtı)',
        expected: 'true',
        actual: `${submitRes.headers['deprecation']}`,
        note: 'T-056 adım 7: endpoint yaşıyor (davranış aynı), yalnız deprecation sinyali eklendi — kaldırma T-058.',
      });
      expect(submitRes.headers['deprecation']).toBe('true');

      // MEC-DISCOUNT (on-invoice %) + CPP_OFF_PCT (off-invoice %) on this
      // plan's FU → SpendCalculationService computes non-zero on AND off
      // spend, so submit-for-approval (ApprovalWorkflowService
      // #submitForApproval, the SECOND canonical submit path) reserves BOTH.
      // Pre-T-048-fix, the OFF_INVOICE call silently no-op'd (kova-farkındalı
      // olmayan idempotency, docs/analysis/0008 §2.4) and this query would
      // have returned only 1 row.
      const budgetTxAfterSubmit = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY spend_type ASC NULLS LAST`,
        [t048PlanId],
      );

      record({
        step: 'A8c',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (submit-for-approval sonrası, T-048 kanıtı)',
        expected: '2 RESERVE satırı (ON_INVOICE + OFF_INVOICE)',
        actual: `submitStatus=${submitRes.status}, onInvoice=${submitRes.body?.budgetCheck?.onInvoice?.requested}, offInvoice=${submitRes.body?.budgetCheck?.offInvoice?.requested}, tx=${JSON.stringify(budgetTxAfterSubmit)}`,
        note: "T-048 FIX: reserveBudgetForPlan/reserveForPlan artık kova-farkındalı (bucket-aware) — ikinci (OFF_INVOICE) çağrı ilk (ON_INVOICE) çağrının net'ini görüp erken dönmüyor.",
      });

      expect(submitRes.status).toBe(200);
      expect(budgetTxAfterSubmit.length).toBe(2);
      const bySpendType = Object.fromEntries(
        budgetTxAfterSubmit.map((r: any) => [r.spend_type, Number(r.amount)]),
      );
      expect(bySpendType.ON_INVOICE).toBeGreaterThan(0);
      expect(bySpendType.OFF_INVOICE).toBeGreaterThan(0);
      expect(
        budgetTxAfterSubmit.every((r: any) => r.tx_status === 'POSTED'),
      ).toBe(true);

      // ── T-052 acceptance criterion: the TWO canonical spend-derivation
      // paths must agree numerically for the SAME plan.
      //   Path 1 (`PlanService#submit`): `plan.totalSpend`, computed by
      //     `recalculatePlanWithKpiEngineLocked` — already fresh here
      //     because the tactics PATCH above triggered a recalc, and
      //     `preSubmitRes` re-reads the plan afterwards.
      //   Path 2 (`ApprovalWorkflowService#submitForApproval`):
      //     `spendBreakdown.onInvoice + spendBreakdown.offInvoice`, computed
      //     by `calculateSpendBreakdown` -> `SpendCalculationService
      //     #calculateAllSpendsForFU` — exactly what was just reserved
      //     above (`bySpendType.ON_INVOICE + bySpendType.OFF_INVOICE`).
      // Before T-052, Path 2 was 0 for a tactics-only plan while Path 1 was
      // correctly non-zero — this assertion is the numeric proof they now
      // match (both derive `mechanicValues` from the same
      // `SpendCalculationService#buildMechanicValues`).
      const path1TotalSpend = Number(preSubmitRes.body.totalSpend);
      const path2TotalSpend = bySpendType.ON_INVOICE + bySpendType.OFF_INVOICE;

      record({
        step: 'A8c-T052',
        role: '-',
        endpoint: 'İki kanonik yol karşılaştırması (T-052)',
        expected:
          'path1TotalSpend === path2TotalSpend (aynı plan, aynı mekanik girişleri)',
        actual: `path1(plan.service#submit → plan.totalSpend)=${path1TotalSpend}, path2(approval-workflow#submitForApproval → on+off)=${path2TotalSpend}`,
        note: 'T-052 FIX: her iki yol da SpendCalculationService#buildMechanicValues üzerinden aynı mechanicValues haritasını türetiyor.',
      });

      expect(path1TotalSpend).toBeGreaterThan(0);
      expect(path1TotalSpend).toBeCloseTo(path2TotalSpend, 2);
    });

    it("A8c′. T-056 adım 7 — A8c'nin canlı-rota ikizi: POST /plans/:id/submit de İKİ tipli RESERVE satırı yazar (ON_INVOICE + OFF_INVOICE), SQL kanıtı", async () => {
      // ADR 0005 K1 (docs/decisions/0005-*, §4.6 D6): T-056 adım 5'ten beri
      // canlı `/submit` yolu da `reserveTypedForPlan` üzerinden aynı
      // rezervasyon motorunu kullanıyor — A8c bunu `/submit-for-approval`
      // ucunda kanıtlıyordu, bu test AYNI korumayı frontend'in gerçekten
      // çağırdığı `/submit` ucunda kilitliyor. `createT029TestPlan` A14/A16
      // ile aynı kanıtlı kombinasyonu (MEC-DISCOUNT on-invoice + CPP_OFF_PCT
      // off-invoice) kurar, yani her iki tip de garantili > 0 harcar.
      const planner = await loginAs(app, 'PLANNER');
      const { planId: a8cPrimePlanId, version: a8cPrimeVersion } =
        await createT029TestPlan(planner, 'E2E-ROLE-JOURNEY-A8CPRIME-T056');

      const submitRes = await request(app.getHttpServer())
        .post(`/plans/${a8cPrimePlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: a8cPrimeVersion });

      // T-056 adım 7 kontrast kanıtı: yalnız `/submit-for-approval`
      // deprecate edildi — canlı `/submit` bu başlığı taşımamalı.
      expect(submitRes.headers['deprecation']).toBeUndefined();

      const planAfterSubmit = await request(app.getHttpServer())
        .get(`/plans/${a8cPrimePlanId}`)
        .set(planner.authHeader())
        .expect(200);

      const budgetTxAfterSubmit = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY spend_type ASC NULLS LAST`,
        [a8cPrimePlanId],
      );

      record({
        step: 'A8c′',
        role: '-',
        endpoint:
          "DB: main.budget_transactions (canlı POST /plans/:id/submit sonrası, A8c'nin ikizi)",
        expected: '2 RESERVE satırı (ON_INVOICE + OFF_INVOICE), TOTAL kova YOK',
        actual: `submitStatus=${submitRes.status}, tx=${JSON.stringify(budgetTxAfterSubmit)}`,
        note: 'T-056 adım 5 fix: canlı /submit artık TOTAL kovaya değil, reserveTypedForPlan üzerinden tipli kovalara yazıyor — on/off ayrımı ilk kez frontend’in çağırdığı uçta erişilebilir.',
      });

      expect(submitRes.status).toBe(200);
      expect(budgetTxAfterSubmit.length).toBe(2);
      const bySpendTypeA8cPrime = Object.fromEntries(
        budgetTxAfterSubmit.map((r: any) => [r.spend_type, Number(r.amount)]),
      );
      expect(bySpendTypeA8cPrime.ON_INVOICE).toBeGreaterThan(0);
      expect(bySpendTypeA8cPrime.OFF_INVOICE).toBeGreaterThan(0);
      expect(
        bySpendTypeA8cPrime.ON_INVOICE + bySpendTypeA8cPrime.OFF_INVOICE,
      ).toBeCloseTo(Number(planAfterSubmit.body.totalSpend), 2);
      expect(
        budgetTxAfterSubmit.every((r: any) => r.tx_status === 'POSTED'),
      ).toBe(true);
      // TOTAL kova (spend_type=NULL) bu plan için hiç yazılmamalı — K1'in
      // "TOTAL yalnız legacy/okuma amaçlı" statüsünün canlı rota kanıtı.
      expect(budgetTxAfterSubmit.some((r: any) => r.spend_type === null)).toBe(
        false,
      );
    });

    it('A9. CATEGORY_MANAGER → GET /plans/approval-queue', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const res = await request(app.getHttpServer())
        .get('/plans/approval-queue')
        .set(cm.authHeader())
        .expect(200);

      record({
        step: 'A9',
        role: 'CATEGORY_MANAGER',
        endpoint: 'GET /plans/approval-queue',
        expected: 200,
        actual: res.status,
        note: 'T-028a FIX: MANAGER→CATEGORY_MANAGER alias konsolidasyonu ile CM artık plan.controller.ts approval-queue Roles listesinde. (Kategori-bazlı filtreleme henüz yok — T-028b işi.)',
      });
    });

    it('A9b. CATEGORY_MANAGER → GET /plans/pending-approvals', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const res = await request(app.getHttpServer())
        .get('/plans/pending-approvals')
        .set(cm.authHeader())
        .expect(200);

      record({
        step: 'A9b',
        role: 'CATEGORY_MANAGER',
        endpoint: 'GET /plans/pending-approvals',
        expected: 200,
        actual: res.status,
        note: 'T-028a FIX: CM artık plan modülünde görünür (MANAGER→CATEGORY_MANAGER alias).',
      });
    });

    it('A9c. CATEGORY_MANAGER → GET /plans/:id (planı görüntüleyebiliyor mu?)', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const res = await request(app.getHttpServer())
        .get(`/plans/${planId}`)
        .set(cm.authHeader())
        .expect(200);

      record({
        step: 'A9c',
        role: 'CATEGORY_MANAGER',
        endpoint: 'GET /plans/:id',
        expected: 200,
        actual: res.status,
        note: 'T-028a FIX: CM artık planı görüntüleyebiliyor (kategori-scope T-028b işi; şimdilik tenant-wide).',
      });
    });

    it('A10. CATEGORY_MANAGER → POST /plans/:id/approve (BRD: CM atanmış kategoriyi onaylar — ayrı scratch plan üzerinde, golden path planId bozulmadan)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const { planId: a10PlanId, version: a10Version } =
        await createT029TestPlan(planner, 'E2E-ROLE-JOURNEY-A10-CM-APPROVE');

      await request(app.getHttpServer())
        .post(`/plans/${a10PlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: a10Version })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/plans/${a10PlanId}/approve`)
        .set(cm.authHeader())
        .send({ comments: 'A10 CM approve — T-028a RBAC fix' });

      record({
        step: 'A10',
        role: 'CATEGORY_MANAGER',
        endpoint: 'POST /plans/:id/approve',
        expected: 200,
        actual: res.status,
        note: 'T-028a FIX: MANAGER bugün sahip olduğu onay yetkisi CATEGORY_MANAGER’a geçti (BRD: CM plan onaylar). golden-path planId etkilenmesin diye ayrı scratch plan kullanıldı.',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('A11. MANAGER → GET /budget/envelopes/:id/transactions (ÖNCESİ)', async () => {
      const manager = await loginAs(app, 'MANAGER');
      if (!envelopeId) {
        record({
          step: 'A11',
          role: 'MANAGER',
          endpoint: 'GET /budget/envelopes/:id/transactions',
          expected: 200,
          actual: 'SKIP',
          note: 'envelopeId bulunamadı (A6b başarısız olmuş olabilir)',
        });
        return;
      }
      const res = await request(app.getHttpServer())
        .get(`/budget/envelopes/${envelopeId}/transactions`)
        .set(manager.authHeader())
        .expect(200);

      // NOT: budget.service.ts#reserveForPlan() plan akışında txType=COMMIT
      // üretiyor (RESERVE değil). GET /reserved endpoint'i yalnızca
      // txType=RESERVE transaction'larını topluyor, bu yüzden plan bazlı
      // bütçe akışı için her zaman 0 döner — asıl bütçe kanıtı için
      // COMMIT transaction'larına (bu endpoint) bakmak gerekiyor. Bu isim/
      // davranış tutarsızlığı T-026 kapsamı dışında pre-existing bir mimari
      // nüans (raporlandı, düzeltilmedi).
      const planCommitTxs = (res.body as any[]).filter(
        (tx) => tx.txType === 'COMMIT' && tx.sourceId === planId,
      );
      (global as any).__planCommitCountBefore = planCommitTxs.length;
      (global as any).__planCommitSumBefore = planCommitTxs.reduce(
        (sum, tx) => sum + Number(tx.amount),
        0,
      );

      record({
        step: 'A11',
        role: 'MANAGER',
        endpoint: 'GET /budget/envelopes/:id/transactions (ÖNCESİ)',
        expected: 200,
        actual: res.status,
        note: `plan için COMMIT tx sayısı(önce)=${planCommitTxs.length}, toplam=${planCommitTxs.reduce((s, tx) => s + Number(tx.amount), 0)} (A8 submit anında zaten oluşmuş olmalı)`,
      });
    });

    it('A12. MANAGER → POST /plans/:id/approve → bütçe rezerve ediliyor mu', async () => {
      const manager = await loginAs(app, 'MANAGER');

      const res = await request(app.getHttpServer())
        .post(`/plans/${planId}/approve`)
        .set(manager.authHeader())
        .send({ comments: 'E2E role-journey approval' });

      record({
        step: 'A12',
        role: 'MANAGER',
        endpoint: 'POST /plans/:id/approve',
        expected: 200,
        actual: res.status,
        note: `status=${res.body.status}`,
      });

      // T-026 (D-2) FIX: BudgetSummaryView/BudgetEnvelope decimal kolonlarına
      // DecimalTransformer uygulandı → checkBudgetAvailability artık NUMERIC
      // karşılaştırma yapıyor (500000 >= 8187 === true). approve 200+APPROVED
      // dönüyor (BRD beklentisiyle uyumlu).
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');

      if (envelopeId) {
        const after = await request(app.getHttpServer())
          .get(`/budget/envelopes/${envelopeId}/transactions`)
          .set(manager.authHeader())
          .expect(200);

        const planCommitTxsAfter = (after.body as any[]).filter(
          (tx) => tx.txType === 'COMMIT' && tx.sourceId === planId,
        );
        const countBefore = (global as any).__planCommitCountBefore ?? 0;
        const sumBefore = (global as any).__planCommitSumBefore ?? 0;
        const sumAfter = planCommitTxsAfter.reduce(
          (s, tx) => s + Number(tx.amount),
          0,
        );

        record({
          step: 'A12b',
          role: 'MANAGER',
          endpoint:
            'GET /budget/envelopes/:id/transactions (SONRASI — approve, plan için COMMIT tx yaratmalı)',
          expected: `count > ${countBefore}, sum > ${sumBefore}`,
          actual: `count=${planCommitTxsAfter.length}, sum=${sumAfter}`,
          note: `commitBudgetForPlan() (approvePlan içinde) idempotencyKey=COMMIT|PLAN|${planId}|${envelopeId} ile bir COMMIT transaction yaratıyor; bu D-2 fix'i sayesinde artık checkBudgetAvailability doğru NUMERIC karşılaştırma yaptığından başarıyla tamamlanıyor.`,
        });

        expect(planCommitTxsAfter.length).toBeGreaterThan(countBefore);
        expect(sumAfter).toBeGreaterThan(sumBefore);
      }
    });

    /**
     * ⚠️ STALE PREMISE, CORRECTED (T-270/Z21, 2026-08-23): this test used to
     * assert `200` — that was correct for RBAC (the T-028a fix these two
     * tests were written for is untouched), but NOT correct for what the
     * route returns for a callER with no explicit `startDate`/`endDate` —
     * both default to `new Date()` (today), i.e. a single-day window with
     * no matching `budget_envelopes` row in this tenant. Before T-270/Z21,
     * `getBudgetUtilization` silently rendered an all-zero/GREEN report for
     * that (§2.5 sessiz sıfır) — the fix now throws `NotFoundException`
     * (404) instead of computing a figure for a window with no data (A1,
     * `dashboard-summary.dto.ts:76-105`'s `unavailable` contract's sibling
     * on the direct route, which has no status field to carry "unavailable"
     * in — a 404 is the honest equivalent). This is the DEFECT T-270/Z21
     * exists to close, measured on a THIRD call site (this direct
     * controller route) neither Z21's four kabul şartı nor the dashboard
     * pin enumerated.
     *
     * RBAC is verified SEPARATELY below (`not.toBe(403)`) — same
     * discipline as `t249-app-runtime-live-route-grants.e2e-spec.ts`'s
     * "guard passed, data path is a separate concern" pattern: a role
     * filter produces 403, a data-availability guard produces 404, and the
     * two must not be conflated.
     */
    it('A13. FINANCE_MANAGER → GET /finance-reporting/budget-utilization', async () => {
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-utilization')
        .set(fm.authHeader());

      record({
        step: 'A13',
        role: 'FINANCE_MANAGER',
        endpoint: 'GET /finance-reporting/budget-utilization',
        expected: 404,
        actual: res.status,
        note: 'T-028a (F8) FIX: RBAC guard passed (not 403). T-270/Z21: 404, not 200 — no budget_envelopes row for the default (today-only) date window; this is the intended fail-closed behaviour, not a regression.',
      });

      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    });

    it('A13b. FINANCE (deprecated alias, seed: finance@wella.com) → GET /finance-reporting/budget-utilization', async () => {
      const finance = await loginAs(app, 'FINANCE');

      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-utilization')
        .set(finance.authHeader());

      record({
        step: 'A13b',
        role: 'FINANCE (deprecated alias user, now stores FINANCE_MANAGER)',
        endpoint: 'GET /finance-reporting/budget-utilization',
        expected: 404,
        actual: res.status,
        note: `T-270/Z21: 404 expected (see A13's comment). items=${Array.isArray(res.body) ? res.body.length : JSON.stringify(res.body).slice(0, 100)}`,
      });

      // T-028a: migration 1791000000000-ConsolidateRolesToBrd, finance@wella.com
      // seed satırı da FINANCE → FINANCE_MANAGER'a taşındı (e-posta korunur) →
      // bu kullanıcı artık DB'de FINANCE_MANAGER rolüyle giriş yapıyor (RBAC
      // guard geçiliyor, 403 DEĞİL). T-270/Z21: 404, not 200 — see A13.
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(404);
    });

    // ────────────────────────────────────────────────────────────────────
    // T-029: audit ihlali + reserve/commit semantiği fix'lerinin kanıtı.
    // A1-A13 PLANNER→submit-for-approval / review akışını (ApprovalWorkflowService)
    // kullanır; burada frontend'in fiilen çağırdığı ve BRD state machine'inin
    // kanonik yolu olan `/plans/:id/submit` + `/approve` + `/reject`
    // (PlanService) doğrudan test edilir — SQL kanıtı ile.
    // ────────────────────────────────────────────────────────────────────

    async function createT029TestPlan(
      planner: Awaited<ReturnType<typeof loginAs>>,
      namePrefix: string,
    ): Promise<{ planId: string; version: number }> {
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `${namePrefix}-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const t029PlanId = createRes.body.id;

      // COGS dolu fixture FU (bkz. A5c) → totalSpend garanti > 0.
      await request(app.getHttpServer())
        .post(`/plans/${t029PlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${t029PlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus[0];
      const skuId = planFu.planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(
          `/plans/${t029PlanId}/fus/${FU_WELLA_HC_500ML}/skus/${skuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      // T-056 adım 5 fixture düzeltmesi (canlı DB ölçümüyle bulundu):
      // `VIS_LS` (LUMPSUM_SPEND kategorisi) `calculateAllSpendsForSKU`
      // içinde HER ZAMAN 0 döner (`spend-calculation.service.ts:165-167`,
      // "Lumpsum is calculated at FU level and distributed... return 0") —
      // dağıtım hiçbir yerden (`calculateAllSpendsForFU` DAHİL,
      // `distributeSpendToSKUs` hiç çağrılmıyor) tetiklenmiyor. Bu, T-056'dan
      // BAĞIMSIZ, önceden var olan bir spend-calculation boşluğu (ayrı task
      // gerektirir); `CPP_ON_PCT + VIS_LS` kombinasyonu bu yüzden hiçbir
      // zaman off-invoice > 0 üretmiyordu (yalnız TOTAL kova tek bir sayı
      // taşıdığı için T-056'dan önce görünmezdi). A17/A18'de kanıtlanmış
      // çalışan kombinasyona (`MEC-DISCOUNT` on-invoice + `CPP_OFF_PCT`
      // off-invoice) geçildi — her iki tipin de gerçekten > 0 harcandığı
      // ampirik olarak doğrulanmış (bkz. A17 `onAmount1`/`offAmount1`).
      await request(app.getHttpServer())
        .patch(`/plans/${t029PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { 'MEC-DISCOUNT': 10, CPP_OFF_PCT: 5 }, version: 1 })
        .expect(200);

      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${t029PlanId}/recalculate`)
        .set(planner.authHeader())
        .send({})
        .expect(200);
      expect(Number(recalcRes.body.totalSpend)).toBeGreaterThan(0);

      // T-034b: submit() also validates plans.version (K5 exception) — the
      // caller needs the CURRENT version (bumped once by addFu above;
      // recalculate/volume/tactic writes are unversioned/row-scoped, see
      // docs/analysis/0005 §3), not a hardcoded 1.
      return { planId: t029PlanId, version: recalcRes.body.version };
    }

    it('A14. T-029: PLANNER /plans/:id/submit → RESERVE + SUBMITTED history; MANAGER /plans/:id/approve → RESERVE→COMMIT + APPROVED history (SQL kanıtı)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const manager = await loginAs(app, 'MANAGER');

      const { planId: t029PlanId, version: t029Version } =
        await createT029TestPlan(planner, 'E2E-ROLE-JOURNEY-T029-RESERVE');

      // ── SUBMIT (PlanService.submit — frontend'in fiilen çağırdığı endpoint) ──
      const submitRes = await request(app.getHttpServer())
        .post(`/plans/${t029PlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: t029Version })
        .expect(200);
      expect(submitRes.body.status).toBe('PENDING_APPROVAL');

      const historyAfterSubmit = await dataSource.query(
        `SELECT action FROM main.plan_approval_history WHERE plan_id = $1 ORDER BY created_at ASC`,
        [t029PlanId],
      );
      record({
        step: 'A14a',
        role: '-',
        endpoint: 'DB: main.plan_approval_history (submit sonrası)',
        expected: '[SUBMITTED]',
        actual: JSON.stringify(historyAfterSubmit.map((r: any) => r.action)),
        note: 'T-029 FIX (SORUN 1): PlanService.submit() artık PlanApprovalHistory.SUBMITTED yazıyor — önceden /plans/:id/submit + /approve + /reject (fiilen kullanılan endpoint) hiçbir audit satırı üretmiyordu.',
      });
      expect(historyAfterSubmit.map((r: any) => r.action)).toEqual([
        'SUBMITTED',
      ]);

      const budgetTxAfterSubmit = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY spend_type ASC NULLS LAST, created_at ASC`,
        [t029PlanId],
      );
      const planRowAfterSubmit = await dataSource.query(
        `SELECT total_spend FROM main.plans WHERE id = $1`,
        [t029PlanId],
      );
      record({
        step: 'A14b',
        role: '-',
        endpoint: 'DB: main.budget_transactions (submit sonrası)',
        expected:
          '2x RESERVE (POSTED) — ON_INVOICE + OFF_INVOICE, toplam plan.totalSpend’e eşit',
        actual: JSON.stringify(budgetTxAfterSubmit),
        note: "T-056 adım 5 (0009 §5.1 #1): canlı /submit artık TOTAL kova yerine reserveTypedForPlan'ı çağırıyor — T-029'un tek-satır iddiası, iki tipli satır + tutar özdeşliği iddiasına SIKILAŞTIRILDI (bu tutar iddiası bugüne kadar hiç yoktu).",
      });
      expect(budgetTxAfterSubmit.length).toBe(2);
      for (const tx of budgetTxAfterSubmit) {
        expect(tx.tx_type).toBe('RESERVE');
        expect(tx.tx_status).toBe('POSTED');
      }
      const onTxA14b = budgetTxAfterSubmit.find(
        (r: any) => r.spend_type === 'ON_INVOICE',
      );
      const offTxA14b = budgetTxAfterSubmit.find(
        (r: any) => r.spend_type === 'OFF_INVOICE',
      );
      expect(Number(onTxA14b?.amount)).toBeGreaterThan(0);
      expect(Number(offTxA14b?.amount)).toBeGreaterThan(0);
      expect(Number(onTxA14b.amount) + Number(offTxA14b.amount)).toBeCloseTo(
        Number(planRowAfterSubmit[0].total_spend),
        2,
      );

      if (envelopeId) {
        const reservedRes = await request(app.getHttpServer())
          .get(`/budget/envelopes/${envelopeId}/reserved`)
          .set(manager.authHeader())
          .expect(200);
        record({
          step: 'A14c',
          role: 'MANAGER',
          endpoint: 'GET /budget/envelopes/:id/reserved (submit sonrası)',
          expected: '> 0 (bu planın RESERVE tutarını içermeli)',
          actual: reservedRes.body.reservedAmount,
          note: 'T-029 FIX: reserveForPlan artık RESERVE ürettiği için bu endpoint artık plan bazlı rezervasyonu doğru gösteriyor (önceden her zaman 0 dönüyordu, bkz. görev tanımı SORUN 2).',
        });
        expect(Number(reservedRes.body.reservedAmount)).toBeGreaterThan(0);
      }

      // ── APPROVE (PlanService.approve) ──
      const approveRes = await request(app.getHttpServer())
        .post(`/plans/${t029PlanId}/approve`)
        .set(manager.authHeader())
        .send({ comments: 'T-029 e2e approve' })
        .expect(200);
      expect(approveRes.body.status).toBe('APPROVED');

      const historyAfterApprove = await dataSource.query(
        `SELECT action FROM main.plan_approval_history WHERE plan_id = $1 ORDER BY created_at ASC`,
        [t029PlanId],
      );
      record({
        step: 'A14d',
        role: '-',
        endpoint: 'DB: main.plan_approval_history (approve sonrası)',
        expected: '[SUBMITTED, APPROVED]',
        actual: JSON.stringify(historyAfterApprove.map((r: any) => r.action)),
        note: 'T-029 FIX (SORUN 1): PlanService.approve() artık PlanApprovalHistory.APPROVED yazıyor.',
      });
      expect(historyAfterApprove.map((r: any) => r.action)).toEqual([
        'SUBMITTED',
        'APPROVED',
      ]);

      const budgetTxAfterApprove = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY spend_type ASC NULLS LAST, created_at ASC`,
        [t029PlanId],
      );
      record({
        step: 'A14e',
        role: '-',
        endpoint: 'DB: main.budget_transactions (approve sonrası)',
        expected:
          'ON_INVOICE ve OFF_INVOICE kovalarının HER İKİSİNDE de RESERVE + RELEASE(convert) + COMMIT (kova içi aynı tutar)',
        actual: JSON.stringify(budgetTxAfterApprove),
        note: "T-056 adım 5 (0009 §5.1 #2): T-029'un ilk `.find`'a dayalı (sıralamaya bağlı, kırılgan) eşitliği kova bazlı eşitliğe SIKILAŞTIRILDI — her spend_type için ayrı RESERVE/COMMIT karşılaştırması.",
      });
      const types = budgetTxAfterApprove.map((r: any) => r.tx_type);
      const bucketsWithReserveA14e = new Set(
        budgetTxAfterApprove
          .filter((r: any) => r.tx_type === 'RESERVE')
          .map((r: any) => r.spend_type),
      );
      expect(bucketsWithReserveA14e.size).toBe(2);
      expect(types.filter((t: string) => t === 'COMMIT').length).toBe(
        bucketsWithReserveA14e.size,
      );
      expect(
        types.filter((t: string) => t === 'RELEASE').length,
      ).toBeGreaterThanOrEqual(bucketsWithReserveA14e.size);
      for (const bucket of bucketsWithReserveA14e) {
        const reserveAmt = Number(
          budgetTxAfterApprove.find(
            (r: any) => r.tx_type === 'RESERVE' && r.spend_type === bucket,
          )?.amount,
        );
        const commitAmt = Number(
          budgetTxAfterApprove.find(
            (r: any) => r.tx_type === 'COMMIT' && r.spend_type === bucket,
          )?.amount,
        );
        expect(commitAmt).toBe(reserveAmt);
      }

      if (envelopeId) {
        const reservedAfter = await request(app.getHttpServer())
          .get(`/budget/envelopes/${envelopeId}/reserved`)
          .set(manager.authHeader())
          .expect(200);
        record({
          step: 'A14f',
          role: 'MANAGER',
          endpoint: 'GET /budget/envelopes/:id/reserved (approve sonrası)',
          expected: 'RESERVE COMMIT’e dönüştüğü için bu planın payı düşmeli',
          actual: reservedAfter.body.reservedAmount,
          note: 'RESERVE, approve sırasında RELEASE ile netlendi; COMMIT artık ayrı bir kovada (v_budget_summary.reserved_amount içinde sayılıyor — migration 1789000000000 — ama getReservedAmount() bilinçli olarak yalnızca RESERVE-RELEASE’i sayar).',
        });
      }
    });

    it('A15. T-029: yeni plan → PLANNER submit → MANAGER reject → REJECTED history + RESERVE RELEASE (SQL kanıtı)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const manager = await loginAs(app, 'MANAGER');

      const { planId: rejectPlanId, version: rejectPlanVersion } =
        await createT029TestPlan(planner, 'E2E-ROLE-JOURNEY-T029-REJECT');

      await request(app.getHttpServer())
        .post(`/plans/${rejectPlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: rejectPlanVersion })
        .expect(200);

      const budgetTxAfterSubmit = await dataSource.query(
        `SELECT tx_type, tx_status, amount FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY created_at ASC`,
        [rejectPlanId],
      );
      expect(
        budgetTxAfterSubmit.some((r: any) => r.tx_type === 'RESERVE'),
      ).toBe(true);

      const rejectRes = await request(app.getHttpServer())
        .post(`/plans/${rejectPlanId}/reject`)
        .set(manager.authHeader())
        .send({ reason: 'T-029 e2e reject test' })
        .expect(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      const historyAfterReject = await dataSource.query(
        `SELECT action, rejection_reason FROM main.plan_approval_history WHERE plan_id = $1 ORDER BY created_at ASC`,
        [rejectPlanId],
      );
      record({
        step: 'A15a',
        role: '-',
        endpoint: 'DB: main.plan_approval_history (reject sonrası)',
        expected: '[SUBMITTED, REJECTED]',
        actual: JSON.stringify(historyAfterReject.map((r: any) => r.action)),
        note: 'T-029 FIX (SORUN 1): PlanService.reject() artık PlanApprovalHistory.REJECTED yazıyor (rejection_reason dahil) — önceden reject hiçbir audit satırı üretmiyordu.',
      });
      expect(historyAfterReject.map((r: any) => r.action)).toEqual([
        'SUBMITTED',
        'REJECTED',
      ]);
      expect(historyAfterReject[1].rejection_reason).toBe(
        'T-029 e2e reject test',
      );

      const budgetTxAfterReject = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY spend_type ASC NULLS LAST, created_at ASC`,
        [rejectPlanId],
      );
      record({
        step: 'A15b',
        role: '-',
        endpoint: 'DB: main.budget_transactions (reject sonrası)',
        expected:
          'ON_INVOICE ve OFF_INVOICE kovalarının İKİSİNDE de RESERVE + RELEASE (kova içi aynı tutar, kova net’i 0)',
        actual: JSON.stringify(budgetTxAfterReject),
        note: "T-056 adım 5 (0009 §5.1 #3): kova bazlı eşitlik + net(kova)=0 — T-053 sınıfı sızıntı (RELEASE'in yanlış/eksik kovaya yazılması) doğrudan kilitleniyor.",
      });
      const bucketsAfterRejectA15 = new Set(
        budgetTxAfterReject.map((r: any) => r.spend_type),
      );
      expect(bucketsAfterRejectA15.size).toBe(2);
      for (const bucket of bucketsAfterRejectA15) {
        const reserveAmt = Number(
          budgetTxAfterReject.find(
            (r: any) => r.tx_type === 'RESERVE' && r.spend_type === bucket,
          )?.amount,
        );
        const releaseAmt = Number(
          budgetTxAfterReject.find(
            (r: any) => r.tx_type === 'RELEASE' && r.spend_type === bucket,
          )?.amount,
        );
        expect(reserveAmt).toBeGreaterThan(0);
        expect(releaseAmt).toBe(reserveAmt);
        const net = budgetTxAfterReject
          .filter((r: any) => r.spend_type === bucket)
          .reduce((n: number, tx: any) => {
            const amt = Number(tx.amount);
            if (tx.tx_type === 'RESERVE' || tx.tx_type === 'COMMIT')
              return n + amt;
            if (tx.tx_type === 'RELEASE') return n - amt;
            return n;
          }, 0);
        expect(net).toBe(0);
      }

      // Temizlik notu: REJECTED plan silinemez (yalnızca DRAFT silinebilir,
      // plan.controller.ts @Delete Roles/guard) — bu kayıt DB'de
      // "E2E-ROLE-JOURNEY-T029-REJECT-*" adıyla kalır (dosya başlığındaki
      // izolasyon/temizlik notuyla tutarlı, afterAll yalnızca ana `planId`'yi
      // hedefler).
    });

    it('A16. T-033: tam döngü — PLANNER submit → MANAGER reject → PLANNER return-to-draft → PLANNER resubmit → MANAGER approve (SQL kanıtı, tam action zinciri + bütçe akışı)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const manager = await loginAs(app, 'MANAGER');
      const otherPlanner = await loginAs(app, 'PLANNER2');

      const { planId: fullLoopPlanId, version: fullLoopVersion } =
        await createT029TestPlan(planner, 'E2E-ROLE-JOURNEY-T033-FULLLOOP');

      // ── 1) SUBMIT ──────────────────────────────────────────────────────
      await request(app.getHttpServer())
        .post(`/plans/${fullLoopPlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: fullLoopVersion })
        .expect(200);

      // ── 2) REJECT (MANAGER == CATEGORY_MANAGER fixture role) ───────────
      const rejectRes = await request(app.getHttpServer())
        .post(`/plans/${fullLoopPlanId}/reject`)
        .set(manager.authHeader())
        .send({ reason: 'T-033 e2e: needs volume correction' })
        .expect(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      // ── Negative: wrong-status guard — a non-REJECTED plan must 409.
      // Code-review fix: this used to reuse the module-level golden-path
      // `planId` fixture (populated by A1, APPROVED by A12) — that made
      // A16 depend on earlier tests in this same describe block having
      // already run. Running A16 in isolation (`-t "A16"`) left `planId`
      // `undefined`, which built `/plans/undefined/return-to-draft` and hit
      // an unrelated, pre-existing, codebase-wide gap (no `ParseUUIDPipe`
      // on any `:id` route param, confirmed across plan.controller.ts /
      // agreement.controller.ts) — a malformed UUID reached
      // `PlanRepository#findById`'s query builder as-is and Postgres threw
      // `invalid input syntax for type uuid`, uncaught -> 500. Not a
      // T-034b regression (the crash happened in the pre-transaction
      // `findById` call, unchanged by that task). T-043 closed the actual
      // gap (`ParseUUIDPipe` on every UUID route param across the
      // codebase, `/plans/undefined/...` now -> clean 400, see
      // `optimistic-locking.e2e-spec.ts`'s "T-043" describe block) — this
      // test keeps its own fix too (A16 no longer depends on any other
      // test's state; DRAFT is sufficient to prove "non-REJECTED") since
      // that was a real, separate flakiness bug independent of the 500.
      const scratchDraftRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-A16-SCRATCH-DRAFT-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const scratchDraftPlanId = scratchDraftRes.body.id;

      const notRejectedRes = await request(app.getHttpServer())
        .post(`/plans/${scratchDraftPlanId}/return-to-draft`)
        .set(planner.authHeader());
      record({
        step: 'A16a',
        role: 'PLANNER',
        endpoint: 'POST /plans/:id/return-to-draft (APPROVED plan → 409)',
        expected: '409 NOT_REJECTED',
        actual: notRejectedRes.status,
        note: 'T-033: return-to-draft yalnızca REJECTED statüsünde çalışır.',
      });
      expect(notRejectedRes.status).toBe(409);

      // ── Negative: CATEGORY_MANAGER cannot return-to-draft (BRD: CM plan
      // düzenleyemez) — blocked at RolesGuard level → 403.
      const cmAttempt = await request(app.getHttpServer())
        .post(`/plans/${fullLoopPlanId}/return-to-draft`)
        .set(manager.authHeader());
      expect(cmAttempt.status).toBe(403);

      // ── Negative: a different PLANNER (not the owner) → 404 OUT_OF_SCOPE.
      const otherPlannerAttempt = await request(app.getHttpServer())
        .post(`/plans/${fullLoopPlanId}/return-to-draft`)
        .set(otherPlanner.authHeader());
      record({
        step: 'A16b',
        role: 'PLANNER (non-owner)',
        endpoint: 'POST /plans/:id/return-to-draft (başka planner’ın planı)',
        expected: '404 OUT_OF_SCOPE (varlık sızdırma yok)',
        actual: `${otherPlannerAttempt.status} ${JSON.stringify(otherPlannerAttempt.body)}`,
        note: 'T-033: sahip olmayan PLANNER için 403 değil 404 — diğer scope kontrolleriyle tutarlı.',
      });
      expect(otherPlannerAttempt.status).toBe(404);

      // ── 3) RETURN TO DRAFT (owner PLANNER) ──────────────────────────────
      const returnRes = await request(app.getHttpServer())
        .post(`/plans/${fullLoopPlanId}/return-to-draft`)
        .set(planner.authHeader())
        .expect(200);
      expect(returnRes.body.status).toBe('DRAFT');

      const budgetTxAfterReturn = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY spend_type ASC NULLS LAST, created_at ASC`,
        [fullLoopPlanId],
      );
      record({
        step: 'A16c',
        role: '-',
        endpoint: 'DB: main.budget_transactions (return-to-draft sonrası)',
        expected:
          '4 satır (ON_INVOICE + OFF_INVOICE kovalarının HER İKİSİNDE de RESERVE+RELEASE) — her kova net 0 (return-to-draft bütçeye dokunmaz)',
        actual: JSON.stringify(budgetTxAfterReturn),
        note: 'T-033/T-056 adım 5 (0009 §5.1 #4): ham satır sayısı (1 kova/2 satır) yerine kova bazlı net iddiasına SIKILAŞTIRILDI — BudgetService çağrılmıyor, reject() zaten her iki kovayı da RELEASE etmişti (T-029/T-053).',
      });
      expect(budgetTxAfterReturn.length).toBe(4); // 2 kova x (RESERVE+RELEASE)
      const bucketsAfterReturn = new Set(
        budgetTxAfterReturn.map((r: any) => r.spend_type),
      );
      expect(bucketsAfterReturn.size).toBe(2);
      for (const bucket of bucketsAfterReturn) {
        const net = budgetTxAfterReturn
          .filter((r: any) => r.spend_type === bucket)
          .reduce((n: number, tx: any) => {
            const amt = Number(tx.amount);
            if (tx.tx_type === 'RESERVE' || tx.tx_type === 'COMMIT')
              return n + amt;
            if (tx.tx_type === 'RELEASE') return n - amt;
            return n;
          }, 0);
        expect(net).toBe(0);
      }

      // ── 4) RESUBMIT (must work from DRAFT again) ────────────────────────
      const resubmitRes = await request(app.getHttpServer())
        .post(`/plans/${fullLoopPlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: returnRes.body.version })
        .expect(200);
      expect(resubmitRes.body.status).toBe('PENDING_APPROVAL');

      // ── 5) APPROVE ───────────────────────────────────────────────────────
      const approveRes = await request(app.getHttpServer())
        .post(`/plans/${fullLoopPlanId}/approve`)
        .set(manager.authHeader())
        .send({ comments: 'T-033 e2e: approved after correction' })
        .expect(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // ── Full action-chain SQL proof ─────────────────────────────────────
      const fullHistory = await dataSource.query(
        `SELECT action, rejection_reason FROM main.plan_approval_history WHERE plan_id = $1 ORDER BY created_at ASC`,
        [fullLoopPlanId],
      );
      record({
        step: 'A16d',
        role: '-',
        endpoint: 'DB: main.plan_approval_history (tam döngü sonrası)',
        expected:
          '[SUBMITTED, REJECTED, RETURNED_TO_DRAFT, SUBMITTED, APPROVED] — eski satırlar silinmedi (audit immutable)',
        actual: JSON.stringify(fullHistory.map((r: any) => r.action)),
        note: 'T-033: BRD "Rejected → Draft (audit korunur)" — geçmiş satırlar SİLİNMEDİ, yeni RETURNED_TO_DRAFT satırı eklendi.',
      });
      expect(fullHistory.map((r: any) => r.action)).toEqual([
        'SUBMITTED',
        'REJECTED',
        'RETURNED_TO_DRAFT',
        'SUBMITTED',
        'APPROVED',
      ]);
      expect(fullHistory[1].rejection_reason).toBe(
        'T-033 e2e: needs volume correction',
      );

      const finalBudgetTx = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY spend_type ASC NULLS LAST, created_at ASC`,
        [fullLoopPlanId],
      );
      record({
        step: 'A16e',
        role: '-',
        endpoint: 'DB: main.budget_transactions (tam döngü sonrası)',
        expected:
          'RESERVE x4, RELEASE (≥4), COMMIT x2 — ON_INVOICE ve OFF_INVOICE kovalarının HER İKİSİNDE jenerasyon×kova matrisi (RESERVE gen1, RELEASE gen1, RESERVE gen2, RELEASE(convert) gen2, COMMIT gen2); her kova net = o kovanın COMMIT toplamı',
        actual: JSON.stringify(finalBudgetTx),
        note: 'T-033/T-056 adım 5 (0009 §5.1 #5): tek kovanın RESERVE 2/COMMIT 1 sayımı, iki kovanın jenerasyon×kova matrisine (RESERVE 4/COMMIT 2) SIKILAŞTIRILDI — return-to-draft satır eklemedi, yalnızca resubmit her iki kovada da yeni RESERVE üretti; approve bunları COMMIT’e çevirdi.',
      });
      const finalTypes = finalBudgetTx.map((r: any) => r.tx_type);
      expect(finalTypes.filter((t: string) => t === 'RESERVE').length).toBe(4);
      expect(finalTypes.filter((t: string) => t === 'COMMIT').length).toBe(2);
      expect(
        finalTypes.filter((t: string) => t === 'RELEASE').length,
      ).toBeGreaterThanOrEqual(4);
      const finalBuckets = new Set(finalBudgetTx.map((r: any) => r.spend_type));
      expect(finalBuckets.size).toBe(2);
      for (const bucket of finalBuckets) {
        const net = finalBudgetTx
          .filter((r: any) => r.spend_type === bucket)
          .reduce((n: number, tx: any) => {
            const amt = Number(tx.amount);
            if (tx.tx_type === 'RESERVE' || tx.tx_type === 'COMMIT')
              return n + amt;
            if (tx.tx_type === 'RELEASE') return n - amt;
            return n;
          }, 0);
        const commitTotal = finalBudgetTx
          .filter((r: any) => r.spend_type === bucket && r.tx_type === 'COMMIT')
          .reduce((s: number, tx: any) => s + Number(tx.amount), 0);
        expect(net).toBe(commitTotal);
      }

      // Sanity: final plan row's stale rejection/submission-of-record fields
      // were cleared by return-to-draft's DRAFT reset — the live row should
      // no longer show the original rejection, only the fresh
      // submit()/approve() actor.
      const finalPlanRow = await dataSource.query(
        `SELECT status, rejected_at, rejection_reason, submitted_by, approved_by
           FROM main.plans WHERE id = $1`,
        [fullLoopPlanId],
      );
      expect(finalPlanRow[0].status).toBe('APPROVED');
      expect(finalPlanRow[0].rejected_at).toBeNull();
      expect(finalPlanRow[0].rejection_reason).toBeNull();
      expect(finalPlanRow[0].submitted_by).toBe(planner.userId);
      expect(finalPlanRow[0].approved_by).toBe(manager.userId);
    });

    it('A17. T-053 — submit-for-approval (tipli kova) → reject → resubmit tam döngüsü YENİ RESERVE yazmalı (SQL kanıtı)', async () => {
      // A16'nın tipsiz ('TOTAL' bucket, PlanService#submit) ikizi — burada
      // TİPLİ ('ON_INVOICE'/'OFF_INVOICE' bucket, ApprovalWorkflowService
      // #submitForApproval) uçtan aynı reject→resubmit döngüsü kanıtlanıyor.
      // A8c'deki gibi hem on- hem off-invoice mekanik girip submit-for-approval'ın
      // İKİ RESERVE satırı yazmasını sağlıyoruz, sonra A16'daki gibi
      // reject→return-to-draft→resubmit yapıyoruz. T-053 teşhisi: reject'in
      // yazdığı RELEASE satırı spend_type=NULL (untyped) olduğu için,
      // resubmit'in bucket-farkındalı netOutstanding hesabı (matchesBucket)
      // bu RELEASE'i HİÇ görmüyor — eski RESERVE hâlâ "outstanding" görünüyor
      // ve resubmit YENİ bir RESERVE yazmadan sessizce eski (zaten net'i
      // sıfırlanmış) satırı döndürüyor.
      const planner = await loginAs(app, 'PLANNER');
      const manager = await loginAs(app, 'MANAGER');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-A17-T053-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const t053PlanId = createRes.body.id;

      const fuRes = await request(app.getHttpServer())
        .post(`/plans/${t053PlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);
      const t053PlanFuId = fuRes.body.id;

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${t053PlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const t053SkuId = planRes.body.planFus.find(
        (f: any) => f.id === t053PlanFuId,
      ).planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(
          `/plans/${t053PlanId}/fus/${FU_WELLA_HC_500ML}/skus/${t053SkuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      // MEC-DISCOUNT (on_invoice_discount) + CPP_OFF_PCT (off_invoice_discount)
      // — aynı A8c'deki gibi, submit-for-approval'ın İKİ reserveBudgetForPlan
      // çağrısının (ON sonra OFF) ikisinin de non-zero olmasını garanti eder.
      await request(app.getHttpServer())
        .patch(`/plans/${t053PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { 'MEC-DISCOUNT': 10, CPP_OFF_PCT: 5 }, version: 1 })
        .expect(200);

      // ── 1) İLK SUBMIT-FOR-APPROVAL ───────────────────────────────────────
      const preSubmit1 = await request(app.getHttpServer())
        .get(`/plans/${t053PlanId}`)
        .set(planner.authHeader())
        .expect(200);

      const submit1 = await request(app.getHttpServer())
        .post(`/plans/${t053PlanId}/submit-for-approval`)
        .set(planner.authHeader())
        .send({
          submissionNotes: 'T-053 e2e: ilk submit',
          version: preSubmit1.body.version,
        })
        .expect(200);
      expect(submit1.body.status).toBe('PENDING_APPROVAL');

      const reserveAfterSubmit1 = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY spend_type ASC NULLS LAST`,
        [t053PlanId],
      );
      record({
        step: 'A17a',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (ilk submit-for-approval sonrası)',
        expected: '2 RESERVE satırı (ON_INVOICE + OFF_INVOICE)',
        actual: JSON.stringify(reserveAfterSubmit1),
        note: 'A8c ile aynı ön koşul — tipli kova RESERVE ikisi de yazılmış olmalı.',
      });
      expect(reserveAfterSubmit1.length).toBe(2);
      const onAmount1 = Number(
        reserveAfterSubmit1.find((r: any) => r.spend_type === 'ON_INVOICE')
          ?.amount,
      );
      const offAmount1 = Number(
        reserveAfterSubmit1.find((r: any) => r.spend_type === 'OFF_INVOICE')
          ?.amount,
      );
      expect(onAmount1).toBeGreaterThan(0);
      expect(offAmount1).toBeGreaterThan(0);

      // ── 2) REJECT (MANAGER == CATEGORY_MANAGER fixture role, legacy
      //    PlanService#reject — bkz. A16; budgetService.releaseForPlan'a
      //    delege eder, submitForApproval ile aynı release motorunu kullanır) ──
      const rejectRes = await request(app.getHttpServer())
        .post(`/plans/${t053PlanId}/reject`)
        .set(manager.authHeader())
        .send({ reason: 'T-053 e2e: needs correction' })
        .expect(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      const releaseAfterReject = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, idempotency_key
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RELEASE'
          ORDER BY created_at ASC`,
        [t053PlanId],
      );
      record({
        step: 'A17b',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (reject sonrası, RELEASE satırları)',
        expected:
          'FIX ÖNCESİ: 1 tipsiz RELEASE (spend_type=NULL, tutar=on1+off1) · FIX SONRASI: 2 tipli RELEASE (ON_INVOICE=on1, OFF_INVOICE=off1)',
        actual: JSON.stringify(releaseAfterReject),
        note: 'T-053 teşhisi: releaseNetReservation yalnızca envelopeId ile grupluyor (kova-farkında değil).',
      });

      // ── 3) RETURN TO DRAFT ────────────────────────────────────────────────
      const returnRes = await request(app.getHttpServer())
        .post(`/plans/${t053PlanId}/return-to-draft`)
        .set(planner.authHeader())
        .expect(200);
      expect(returnRes.body.status).toBe('DRAFT');

      // ── 4) RESUBMIT-FOR-APPROVAL (T-053'ün asıl kanıtı) ─────────────────
      const preSubmit2 = await request(app.getHttpServer())
        .get(`/plans/${t053PlanId}`)
        .set(planner.authHeader())
        .expect(200);

      const submit2 = await request(app.getHttpServer())
        .post(`/plans/${t053PlanId}/submit-for-approval`)
        .set(planner.authHeader())
        .send({
          submissionNotes: 'T-053 e2e: resubmit (reject sonrası)',
          version: preSubmit2.body.version,
        });

      record({
        step: 'A17c',
        role: 'PLANNER',
        endpoint:
          'POST /plans/:id/submit-for-approval (resubmit, reject sonrası)',
        expected: 200,
        actual: submit2.status,
        note: `status=${submit2.body?.status}`,
      });
      expect(submit2.status).toBe(200);
      expect(submit2.body.status).toBe('PENDING_APPROVAL');

      const reserveAfterSubmit2 = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, idempotency_key, created_at
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY created_at ASC`,
        [t053PlanId],
      );
      record({
        step: 'A17d',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (resubmit sonrası, TÜM RESERVE satırları)',
        expected:
          '4 RESERVE satırı (2 ilk submit + 2 resubmit) — CANLI HATA varsa 2 kalır (yeni RESERVE hiç yazılmaz)',
        actual: JSON.stringify(reserveAfterSubmit2),
        note: "T-053 asıl kanıt: reserveForPlan bucket-scoped netOutstanding, tipsiz RELEASE'i görmediği için erken dönüyor (:490).",
      });

      // ── Ledger korunum invaryantı (tasarım §7 T1, bu plan'a scoped): bu
      // plan'ın envelope'a net katkısı submit1 sonrası on1+off1, reject
      // sonrası TAM 0 (envelope-net RELEASE tüm bucket'ları netler), resubmit
      // sonrası TEKRAR on2+off2 (yeni RESERVE'ler, on2=on1/off2=off1 — plan
      // konfigürasyonu değişmedi) olmalı. Bunu doğrudan bu plan'ın TÜM
      // POSTED tx'lerinin net toplamıyla (RESERVE+COMMIT-RELEASE) ölçüyoruz —
      // bu envelope-wide v_budget_summary'den BAĞIMSIZ, yalnızca bu plan'ın
      // kaynak bazlı net katkısı.
      const allPostedTx = await dataSource.query(
        `SELECT tx_type, amount FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_status = 'POSTED'`,
        [t053PlanId],
      );
      const netContribution = allPostedTx.reduce((net: number, tx: any) => {
        const amt = Number(tx.amount);
        if (tx.tx_type === 'RESERVE' || tx.tx_type === 'COMMIT')
          return net + amt;
        if (tx.tx_type === 'RELEASE') return net - amt;
        return net;
      }, 0);
      record({
        step: 'A17e',
        role: '-',
        endpoint:
          "Ledger korunum — bu plan'ın envelope'a net katkısı (resubmit sonrası)",
        expected: `on1+off1 = ${onAmount1 + offAmount1} (resubmit gerçek bir yeni encumbrance yazmış olmalı)`,
        actual: `${netContribution}`,
        note: 'CANLI HATA varsa net katkı 0 kalır — plan PENDING_APPROVAL ama bütçeden sessizce hiçbir şey rezerve edilmemiş (BRD ihlali).',
      });

      // T-053 asıl regresyon assertion'ı: resubmit YENİ RESERVE satırları
      // yazmış olmalı (toplam 4) ve plan'ın envelope'a net katkısı GERÇEKTEN
      // pozitif olmalı (sessizce 0 kalmamalı).
      expect(reserveAfterSubmit2.length).toBe(4);
      expect(netContribution).toBeCloseTo(onAmount1 + offAmount1, 2);
      expect(netContribution).toBeGreaterThan(0);
    });

    it("A17′. T-056 adım 7 — A17'nin canlı-rota ikizi: POST /plans/:id/submit ile reject → resubmit döngüsü TİPLİ RELEASE + YENİ (jenerasyon sonekli) RESERVE yazmalı (SQL kanıtı, T-053 korumasının yeni yolda geçerliliği)", async () => {
      // ADR 0005 K1: A17, T-053'ün korumasını `/submit-for-approval`
      // ucunda kanıtlıyordu. T-056 adım 5'ten beri para yolu ortak
      // (reserveTypedForPlan + kova-farkındalı releaseNetReservation), bu
      // test AYNI korumayı frontend'in gerçekten çağırdığı `/submit`
      // ucunda kilitliyor: reject sonrası RELEASE satırları TİPLİ olmalı
      // (spend_type NULL değil) ve resubmit YENİ (GEN2 soneki taşıyan)
      // RESERVE satırları yazmalı — eski, net'i sıfırlanmış satırı sessizce
      // "hâlâ outstanding" sanıp no-op dönmemeli.
      const planner = await loginAs(app, 'PLANNER');
      const manager = await loginAs(app, 'MANAGER');

      const { planId: a17PrimePlanId, version: a17PrimeVersion } =
        await createT029TestPlan(planner, 'E2E-ROLE-JOURNEY-A17PRIME-T056');

      // ── 1) İLK SUBMIT (canlı rota) ───────────────────────────────────────
      const submit1 = await request(app.getHttpServer())
        .post(`/plans/${a17PrimePlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: a17PrimeVersion })
        .expect(200);
      expect(submit1.body.status).toBe('PENDING_APPROVAL');

      const reserveAfterSubmit1 = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, idempotency_key FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY spend_type ASC NULLS LAST`,
        [a17PrimePlanId],
      );
      record({
        step: 'A17a′',
        role: '-',
        endpoint: 'DB: main.budget_transactions (ilk canlı /submit sonrası)',
        expected:
          '2 RESERVE satırı (ON_INVOICE + OFF_INVOICE), soneksiz key (ilk jenerasyon)',
        actual: JSON.stringify(reserveAfterSubmit1),
        note: "A17'deki gibi ön koşul — tipli kova RESERVE ikisi de yazılmış olmalı, ama motor artık PlanService#submit üzerinden çağrılıyor.",
      });
      expect(reserveAfterSubmit1.length).toBe(2);
      const onAmount1Prime = Number(
        reserveAfterSubmit1.find((r: any) => r.spend_type === 'ON_INVOICE')
          ?.amount,
      );
      const offAmount1Prime = Number(
        reserveAfterSubmit1.find((r: any) => r.spend_type === 'OFF_INVOICE')
          ?.amount,
      );
      expect(onAmount1Prime).toBeGreaterThan(0);
      expect(offAmount1Prime).toBeGreaterThan(0);
      // İlk jenerasyon key'leri soneksiz olmalı (T-033 GEN disiplini).
      expect(
        reserveAfterSubmit1.every(
          (r: any) => !String(r.idempotency_key).includes('|GEN'),
        ),
      ).toBe(true);

      // ── 2) REJECT (aynı endpoint, T-053'ün release motoru) ──────────────
      const rejectRes = await request(app.getHttpServer())
        .post(`/plans/${a17PrimePlanId}/reject`)
        .set(manager.authHeader())
        .send({ reason: 'T-056 adım 7 e2e: A17′ needs correction' })
        .expect(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      const releaseAfterReject = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, idempotency_key
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RELEASE'
          ORDER BY spend_type ASC NULLS LAST`,
        [a17PrimePlanId],
      );
      record({
        step: 'A17b′',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (reject sonrası, RELEASE satırları)',
        expected:
          '2 TİPLİ RELEASE (ON_INVOICE=on1, OFF_INVOICE=off1) — spend_type=NULL YOK',
        actual: JSON.stringify(releaseAfterReject),
        note: 'T-053 korumasının canlı rotada da geçerliliği: releaseNetReservation kova-farkındalı, her iki tipi de ayrı ayrı release ediyor.',
      });
      expect(releaseAfterReject.length).toBe(2);
      expect(releaseAfterReject.every((r: any) => r.spend_type !== null)).toBe(
        true,
      );
      const releaseByType = Object.fromEntries(
        releaseAfterReject.map((r: any) => [r.spend_type, Number(r.amount)]),
      );
      expect(releaseByType.ON_INVOICE).toBeCloseTo(onAmount1Prime, 2);
      expect(releaseByType.OFF_INVOICE).toBeCloseTo(offAmount1Prime, 2);

      // ── 3) RETURN TO DRAFT ────────────────────────────────────────────────
      const returnRes = await request(app.getHttpServer())
        .post(`/plans/${a17PrimePlanId}/return-to-draft`)
        .set(planner.authHeader())
        .expect(200);
      expect(returnRes.body.status).toBe('DRAFT');

      // ── 4) RESUBMIT (canlı rota, T-053'ün asıl kanıtı) ───────────────────
      const submit2 = await request(app.getHttpServer())
        .post(`/plans/${a17PrimePlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: returnRes.body.version });

      record({
        step: 'A17c′',
        role: 'PLANNER',
        endpoint:
          'POST /plans/:id/submit (resubmit, reject sonrası, canlı rota)',
        expected: 200,
        actual: submit2.status,
        note: `status=${submit2.body?.status}`,
      });
      expect(submit2.status).toBe(200);
      expect(submit2.body.status).toBe('PENDING_APPROVAL');

      const reserveAfterSubmit2 = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, idempotency_key, created_at
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY created_at ASC`,
        [a17PrimePlanId],
      );
      record({
        step: 'A17d′',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (resubmit sonrası, TÜM RESERVE satırları)',
        expected:
          '4 RESERVE satırı (2 ilk submit + 2 resubmit) — resubmit satırları |GEN2 soneki taşımalı. CANLI HATA varsa 2 kalır (yeni RESERVE hiç yazılmaz)',
        actual: JSON.stringify(reserveAfterSubmit2),
        note: "T-053'ün canlı-rota kanıtı: reserveForPlan bucket-scoped netOutstanding, T-053 fix sonrası tipli RELEASE'i görüp yeni RESERVE yazıyor.",
      });
      expect(reserveAfterSubmit2.length).toBe(4);

      // GEN soneği kanıtı: ilk jenerasyon (submit1) soneksiz, ikinci
      // jenerasyon (submit2/resubmit) |GEN2 taşımalı — her iki kovada da.
      const gen2Rows = reserveAfterSubmit2.filter((r: any) =>
        String(r.idempotency_key).includes('|GEN2'),
      );
      expect(gen2Rows.length).toBe(2);
      const gen2ByType = Object.fromEntries(
        gen2Rows.map((r: any) => [r.spend_type, Number(r.amount)]),
      );
      expect(gen2ByType.ON_INVOICE).toBeCloseTo(onAmount1Prime, 2);
      expect(gen2ByType.OFF_INVOICE).toBeCloseTo(offAmount1Prime, 2);

      // ── Ledger korunum invaryantı (A17'nin A17e'siyle aynı iddia,
      // yalnızca kaynak /submit) ────────────────────────────────────────
      const allPostedTx = await dataSource.query(
        `SELECT tx_type, amount FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_status = 'POSTED'`,
        [a17PrimePlanId],
      );
      const netContributionPrime = allPostedTx.reduce(
        (net: number, tx: any) => {
          const amt = Number(tx.amount);
          if (tx.tx_type === 'RESERVE' || tx.tx_type === 'COMMIT')
            return net + amt;
          if (tx.tx_type === 'RELEASE') return net - amt;
          return net;
        },
        0,
      );
      record({
        step: 'A17e′',
        role: '-',
        endpoint:
          "Ledger korunum — bu plan'ın envelope'a net katkısı (resubmit sonrası, canlı rota)",
        expected: `on1+off1 = ${onAmount1Prime + offAmount1Prime} (resubmit gerçek bir yeni encumbrance yazmış olmalı)`,
        actual: `${netContributionPrime}`,
        note: 'CANLI HATA varsa net katkı 0 kalır — plan PENDING_APPROVAL ama bütçeden sessizce hiçbir şey rezerve edilmemiş (BRD ihlali).',
      });
      expect(netContributionPrime).toBeCloseTo(
        onAmount1Prime + offAmount1Prime,
        2,
      );
      expect(netContributionPrime).toBeGreaterThan(0);
    });

    it('A18. T-056 F1 — çapraz yol (TOTAL /submit → reject → return-to-draft → tipli /submit-for-approval → approve) TOTAL kovada hayalet COMMIT üretmemeli (SQL kanıtı)', async () => {
      // 0009 §2.3 F1 teşhisi: commitAllReservedForPlan'ın kova keşfi HAM
      // POSTED RESERVE satırı varlığına bakıyor (net'e değil) — bir planın
      // ilk (TOTAL) submit'i reddedilip TAMAMEN release edildikten sonra
      // farklı (tipli ON/OFF) bir uçtan resubmit edilirse, eski TOTAL
      // RESERVE satırı hâlâ txStatus=POSTED olduğu için approve'da TEKRAR
      // "outstanding" sanılıp hayalet bir CONVERT-RELEASE + COMMIT çifti
      // üretiyor. v_budget_summary'nin net'i bu çift RESERVE/RELEASE'in
      // birbirini götürmesiyle korunur, ama bu planın TOTAL kovasındaki
      // ham (RESERVE-RELEASE, COMMIT hariç) katkısı NEGATİFE düşer —
      // APPROVED bir plan, bayat bir jenerasyonun COMMIT'ini taşımış olur.
      const planner = await loginAs(app, 'PLANNER');
      const manager = await loginAs(app, 'MANAGER');

      // A17'deki gibi MEC-DISCOUNT (on_invoice_discount) + CPP_OFF_PCT
      // (off_invoice_discount) — createT029TestPlan'ın CPP_ON_PCT+VIS_LS
      // kombinasyonundan FARKLI: VIS_LS lumpsum, calculateAllSpendsForFU
      // (submit-for-approval'ın kullandığı yol) lumpsum'u 0 döndürüyor
      // (`spend-calculation.service.ts:165-167`, distributeSpendToSKUs ayrı
      // bir çağrı zinciri) — o kombinasyon adım 4'te offAmount=0 üretir ve
      // testin ön koşulunu (her iki kova da POSTED RESERVE > 0) bozar. Bu
      // ayrım F1'in konusu değil; sadece doğru fixture seçimi.
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-T056-F1-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const f1PlanId = createRes.body.id;

      const fuRes = await request(app.getHttpServer())
        .post(`/plans/${f1PlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);
      const f1PlanFuId = fuRes.body.id;

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${f1PlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const f1SkuId = planRes.body.planFus.find((f: any) => f.id === f1PlanFuId)
        .planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(
          `/plans/${f1PlanId}/fus/${FU_WELLA_HC_500ML}/skus/${f1SkuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/plans/${f1PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { 'MEC-DISCOUNT': 10, CPP_OFF_PCT: 5 }, version: 1 })
        .expect(200);

      // plan.totalSpend'i doldurmak için recalculate.
      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${f1PlanId}/recalculate`)
        .set(planner.authHeader())
        .send({})
        .expect(200);
      expect(Number(recalcRes.body.totalSpend)).toBeGreaterThan(0);

      // ── 1) İLK "SUBMIT" — LEGACY TOTAL KOVA SİMÜLASYONU ─────────────────
      // Team Lead onayı (2026-08-03): T-056 adım 5'ten sonra canlı `/submit`
      // ARTIK HİÇBİR ZAMAN TOTAL yazmıyor (K1/§3.3'ün doğrudan sonucu —
      // TOTAL yalnızca okuma/keşif tarafında yaşıyor); bu, 0009 §5.2 madde
      // 11'in zaten öngördüğü "elle kurulmuş TOTAL satırı"dır. A18'in
      // konusu F1'in KORUMASI (bu tür bir legacy/tarihsel satırın approve'da
      // hayalet COMMIT üretmemesi) — kurulum YÖNTEMİ değil. Bu yüzden
      // canlı `/submit`'in T-056 ÖNCESİ kullandığı GERÇEK servisleri
      // (raw SQL DEĞİL) doğrudan çağırıyoruz: `reserveForPlan(..., 'TOTAL',
      // ...)` — üretimdeki `RESERVE|PLAN|<id>|<env>` (soneksiz) key
      // formatının BİREBİR AYNISINI üretir (bkz. `budget.service.ts:507-`).
      const budgetService = app.get(BudgetService);
      const approvalService = app.get(ApprovalService);

      const f1PlanForTotal = await request(app.getHttpServer())
        .get(`/plans/${f1PlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const f1ChannelCode = f1PlanForTotal.body.channel.code;
      const f1PeriodMonth = f1PlanForTotal.body.periodMonth;
      const f1TotalSpend = Number(f1PlanForTotal.body.totalSpend);
      expect(f1TotalSpend).toBeGreaterThan(0);

      // T-019 Faz 1 döneminde `/submit`'in yaptığı BİREBİR AYNI çağrı
      // (bkz. git history, plan.service.ts#submit T-056 öncesi): TOTAL
      // kovaya tek, ayrıştırılmamış tutar.
      await budgetService.reserveForPlan(
        f1PlanId,
        f1TotalSpend,
        f1ChannelCode,
        f1PeriodMonth,
        'TRY',
        fixture.tenantId,
        planner.userId,
        'TOTAL',
      );

      // Plan durumunu da eski `/submit`'in yaptığı gibi PENDING_APPROVAL'a
      // taşımak gerekiyor (reject() PENDING_APPROVAL + approvalRequestId
      // + submittedById şartlarını arıyor, plan.service.ts:1186-1198) —
      // gerçek ApprovalService.createRequest ile approval_request satırı
      // kuruluyor (FK/referential integrity korunur), yalnızca durum
      // GEÇİŞİ (status/submitted_by/approval_request_id) SQL ile yazılıyor
      // çünkü bunu tetikleyecek "eski tipte" bir canlı endpoint artık yok.
      const f1ApprovalRequest = await approvalService.createRequest(
        {
          requestType: ApprovalRequestType.PLAN,
          entityType: 'PLAN',
          entityId: f1PlanId,
        },
        fixture.tenantId,
        planner.userId,
      );
      await dataSource.query(
        `UPDATE main.plans
            SET status = 'PENDING_APPROVAL', approval_request_id = $2,
                submitted_by = $3, submitted_at = now(), version = version + 1
          WHERE id = $1`,
        [f1PlanId, f1ApprovalRequest.id, planner.userId],
      );

      const reserveAfterSubmit1 = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'`,
        [f1PlanId],
      );
      expect(reserveAfterSubmit1.length).toBe(1);
      expect(reserveAfterSubmit1[0].spend_type).toBeNull(); // TOTAL kova
      const totalReserveAmount = Number(reserveAfterSubmit1[0].amount);
      expect(totalReserveAmount).toBeGreaterThan(0);

      // ── 2) REJECT — TOTAL kova TAMAMEN release edilir (net = 0) ────────
      const rejectRes = await request(app.getHttpServer())
        .post(`/plans/${f1PlanId}/reject`)
        .set(manager.authHeader())
        .send({ reason: 'T-056 F1 e2e: cross-route repro' })
        .expect(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      // ── 3) RETURN TO DRAFT ───────────────────────────────────────────────
      const returnRes = await request(app.getHttpServer())
        .post(`/plans/${f1PlanId}/return-to-draft`)
        .set(planner.authHeader())
        .expect(200);
      expect(returnRes.body.status).toBe('DRAFT');

      // ── 4) RESUBMIT — ÇAPRAZ UÇ, tipli /submit-for-approval (ON+OFF) ────
      const preSubmit2 = await request(app.getHttpServer())
        .get(`/plans/${f1PlanId}`)
        .set(planner.authHeader())
        .expect(200);

      const submit2 = await request(app.getHttpServer())
        .post(`/plans/${f1PlanId}/submit-for-approval`)
        .set(planner.authHeader())
        .send({
          submissionNotes: 'T-056 F1 e2e: resubmit çapraz uçtan (tipli)',
          version: preSubmit2.body.version,
        })
        .expect(200);
      expect(submit2.body.status).toBe('PENDING_APPROVAL');

      const reserveAfterSubmit2 = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, idempotency_key
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY created_at ASC`,
        [f1PlanId],
      );
      record({
        step: 'A18a',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (çapraz-uç resubmit sonrası, TÜM RESERVE)',
        expected:
          '3 RESERVE satırı: 1 eski TOTAL (hâlâ txStatus=POSTED, net=0) + 2 yeni tipli (ON_INVOICE+OFF_INVOICE)',
        actual: JSON.stringify(reserveAfterSubmit2),
        note: 'F1 ön koşulu: TOTAL RESERVE satırı append-only ledger gereği hâlâ POSTED — bucketKeys keşfi bunu görmeye devam ediyor.',
      });
      expect(reserveAfterSubmit2.length).toBe(3);
      const onAmount = Number(
        reserveAfterSubmit2.find((r: any) => r.spend_type === 'ON_INVOICE')
          ?.amount,
      );
      const offAmount = Number(
        reserveAfterSubmit2.find((r: any) => r.spend_type === 'OFF_INVOICE')
          ?.amount,
      );
      expect(onAmount).toBeGreaterThan(0);
      expect(offAmount).toBeGreaterThan(0);

      // ── 5) APPROVE — F1'in asıl kanıt noktası ───────────────────────────
      const approveRes = await request(app.getHttpServer())
        .post(`/plans/${f1PlanId}/approve`)
        .set(manager.authHeader())
        .send({ comments: 'T-056 F1 e2e: approve after cross-route resubmit' })
        .expect(200);
      expect(approveRes.body.status).toBe('APPROVED');

      const commitRows = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, idempotency_key
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'COMMIT'
          ORDER BY created_at ASC`,
        [f1PlanId],
      );
      record({
        step: 'A18b',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (approve sonrası, COMMIT satırları)',
        expected:
          'FIX ÖNCESİ (CANLI HATA): 3 COMMIT (TOTAL hayalet dahil, spend_type IS NULL) · FIX SONRASI: 2 COMMIT (yalnız ON_INVOICE+OFF_INVOICE)',
        actual: JSON.stringify(commitRows),
        note: 'F1: commitAllReservedForPlan kova keşfi ham RESERVE satırı varlığına bakıyor — net=0 olan TOTAL kova da "outstanding" sanılıyor.',
      });

      const phantomTotalCommit = commitRows.filter(
        (r: any) => r.spend_type === null,
      );
      // F1 asıl regresyon assertion'ı: TOTAL kovada (spend_type NULL)
      // approve sonrası HİÇBİR COMMIT olmamalı — o kova reject'te zaten
      // tamamen release edilmişti (net=0), "outstanding" değildi.
      expect(phantomTotalCommit.length).toBe(0);
      expect(commitRows.length).toBe(2);
      expect(
        commitRows.every((r: any) =>
          ['ON_INVOICE', 'OFF_INVOICE'].includes(r.spend_type),
        ),
      ).toBe(true);

      // ── Plan'ın TOTAL kovadaki (spend_type IS NULL) ham net katkısı ─────
      // (RESERVE - RELEASE, COMMIT hariç — 0009 §2.3'ün "getReservedAmount"
      // formülünün bu plana scoped hâli). Reject net'i zaten 0'lamıştı;
      // hayalet CONVERT-RELEASE eklenmediği sürece bu 0'da KALMALI —
      // negatife düşerse F1 hatası hâlâ var demektir.
      const totalBucketTx = await dataSource.query(
        `SELECT tx_type, amount FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND spend_type IS NULL
            AND tx_status = 'POSTED'`,
        [f1PlanId],
      );
      const totalBucketNet = totalBucketTx.reduce((net: number, tx: any) => {
        const amt = Number(tx.amount);
        if (tx.tx_type === 'RESERVE') return net + amt;
        if (tx.tx_type === 'RELEASE') return net - amt;
        return net;
      }, 0);
      record({
        step: 'A18c',
        role: '-',
        endpoint:
          "TOTAL kova (spend_type IS NULL) ham net (RESERVE-RELEASE, COMMIT hariç) — bu plan'a scoped",
        expected:
          "0 (reject net'i zaten sıfırladı; hayalet CONVERT-RELEASE eklenmemeli)",
        actual: `${totalBucketNet}`,
        note: 'CANLI HATA varsa bu değer NEGATİF olur (fazladan bir CONVERT-RELEASE eklenir ama karşılığı RESERVE artmaz).',
      });
      expect(totalBucketNet).toBe(0);

      // ── Ledger korunumu (0009 §7 T1): v_budget_summary net'i her koşulda
      // korunur (hayalet COMMIT/RELEASE çifti birbirini götürür) — bu, F1'in
      // "neden fark edilmedi" kısmının kanıtı, F1 fix gerekliliğini AZALTMAZ
      // (getReservedAmount/audit-trail hâlâ yanlış).
      const envelopeRow = await dataSource.query(
        `SELECT e.id, e.code FROM main.budget_envelopes e
           JOIN main.plans p ON p.channel_id = e.channel_id
          WHERE p.id = $1 LIMIT 1`,
        [f1PlanId],
      );
      if (envelopeRow.length > 0) {
        const summaryRow = await dataSource.query(
          `SELECT reserved_amount FROM main.v_budget_summary WHERE envelope_id = $1`,
          [envelopeRow[0].id],
        );
        const ledgerNetRow = await dataSource.query(
          `SELECT COALESCE(SUM(CASE WHEN tx_type IN ('RESERVE','COMMIT') THEN amount
                                     WHEN tx_type = 'RELEASE' THEN -amount ELSE 0 END), 0) AS net
             FROM main.budget_transactions
            WHERE envelope_id = $1 AND tx_status = 'POSTED'`,
          [envelopeRow[0].id],
        );
        record({
          step: 'A18d',
          role: '-',
          endpoint: `Ledger korunumu — envelope ${envelopeRow[0].code}`,
          expected:
            'reserved_amount === ledger net (kova karışıklığından bağımsız)',
          actual: `reserved_amount=${summaryRow[0]?.reserved_amount} ledger_net=${ledgerNetRow[0]?.net}`,
          note: 'v_budget_summary hayalet COMMIT olsa bile korunur — F1 sessiz kalmasının nedeni budur.',
        });
      }
    });

    it('A19. T-056 adım 6 — bölünmüş bir boyutta submit → approve ÇALIŞMALI (R9: bu adım olmadan approve 400 verirdi, SQL kanıtı)', async () => {
      // R9 (0009 §4.5 madde 2, ADR 0004 Karar 5): split edilmiş bir
      // (channel, period) boyutunda approve()'un auto-create-on-approve
      // yolu tipsiz `findEnvelopeByDimensions` çağırıyordu →
      // SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION ile 400. Submit (adım 5)
      // zaten ON/OFF'u ayrı çözüyordu — yani "submit çalışır, approve
      // kırılır" ARA DURUMU tam burada canlı DB'de kanıtlanıyor.
      const admin = await loginAs(app, 'ADMIN');
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      const planner = await loginAs(app, 'PLANNER');
      const manager = await loginAs(app, 'MANAGER');

      // NKA kanalında bugüne kadar hiçbir testin kullanmadığı, taze bir
      // dönem (2026-09) — seed'in NKA-Q1/NKA-Q2 zarflarına (T-047
      // invaryantının izlediği) HİÇ dokunulmuyor.
      const a19Period = '2026-09';
      const a19EnvCode = `E2E-A19-SPLIT-${Date.now()}`;

      // ── 1) Taze UNSPLIT zarf (NKA / 2026-09) ────────────────────────────
      const createEnvRes = await request(app.getHttpServer())
        .post('/budget/envelopes')
        .set(admin.authHeader())
        .send({
          code: a19EnvCode,
          name: 'A19 split fixture',
          fiscalYear: '2026',
          period: a19Period,
          channel: 'NKA',
          allocatedAmount: 100000,
          status: 'ACTIVE',
          currency: 'TRY',
        })
        .expect(201);
      const a19EnvId = createEnvRes.body.id;

      // ── 2) FINANCE_MANAGER split eder — ON/OFF ikizleri doğar ───────────
      const splitRes = await request(app.getHttpServer())
        .post(`/budget/envelopes/${a19EnvId}/split`)
        .set(fm.authHeader())
        .send({ onInvoiceAllocated: 60000, offInvoiceAllocated: 40000 })
        .expect(201);
      const a19OnEnvelopeId = splitRes.body.onEnvelope.id; // id korunur
      const a19OffEnvelopeId = splitRes.body.offEnvelope.id; // yeni satır
      expect(a19OnEnvelopeId).toBe(a19EnvId);
      expect(a19OffEnvelopeId).not.toBe(a19EnvId);

      // ── 3) Plan: aynı boyutta (NKA / 2026-09) ───────────────────────────
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-A19-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: `${a19Period}-05`,
          endDate: `${a19Period}-30`,
        })
        .expect(201);
      const a19PlanId = createRes.body.id;

      const fuRes = await request(app.getHttpServer())
        .post(`/plans/${a19PlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);
      const a19PlanFuId = fuRes.body.id;

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${a19PlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const a19SkuId = planRes.body.planFus.find(
        (f: any) => f.id === a19PlanFuId,
      ).planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(
          `/plans/${a19PlanId}/fus/${FU_WELLA_HC_500ML}/skus/${a19SkuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      // A17/A18'de kanıtlanmış kombinasyon: MEC-DISCOUNT (on-invoice) +
      // CPP_OFF_PCT (off-invoice) — her iki tip de gerçekten > 0 harcar.
      await request(app.getHttpServer())
        .patch(`/plans/${a19PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { 'MEC-DISCOUNT': 10, CPP_OFF_PCT: 5 }, version: 1 })
        .expect(200);

      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${a19PlanId}/recalculate`)
        .set(planner.authHeader())
        .send({})
        .expect(200);
      expect(Number(recalcRes.body.totalSpend)).toBeGreaterThan(0);

      // ── 4) SUBMIT — split boyutta, ON/OFF ikizleri ZATEN var (adım 5) ───
      const submitRes = await request(app.getHttpServer())
        .post(`/plans/${a19PlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: recalcRes.body.version })
        .expect(200);
      expect(submitRes.body.status).toBe('PENDING_APPROVAL');

      const reserveRows = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, envelope_id
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'
          ORDER BY spend_type ASC`,
        [a19PlanId],
      );
      record({
        step: 'A19a',
        role: '-',
        endpoint: 'DB: main.budget_transactions (split boyutta submit sonrası)',
        expected: '2 RESERVE — doğru tipli (ON/OFF ikizi) zarflara',
        actual: JSON.stringify(reserveRows),
        note: 'Adım 5 zaten çalışıyordu — bu adımın konusu DEĞİL, yalnız approve öncesi taban çizgisi.',
      });
      expect(reserveRows.length).toBe(2);
      expect(
        reserveRows.every((r: any) =>
          [a19OnEnvelopeId, a19OffEnvelopeId].includes(r.envelope_id),
        ),
      ).toBe(true);
      const onReserve = reserveRows.find(
        (r: any) => r.spend_type === 'ON_INVOICE',
      );
      const offReserve = reserveRows.find(
        (r: any) => r.spend_type === 'OFF_INVOICE',
      );
      expect(onReserve.envelope_id).toBe(a19OnEnvelopeId);
      expect(offReserve.envelope_id).toBe(a19OffEnvelopeId);

      // ── 5) APPROVE — R9'un asıl kanıt noktası ───────────────────────────
      // Bu adım (T-056 adım 6) OLMADAN, `plan.service.ts` approve()'un
      // auto-create-on-approve bloğu `findEnvelopeByDimensions`'ı
      // spendType VERMEDEN çağırdığı için burada
      // SPEND_TYPE_REQUIRED_FOR_SPLIT_DIMENSION ile 400 dönerdi ("submit
      // çalışır, approve kırılır") — `.expect(200)` bunu canlı DB'de
      // kanıtlar.
      const approveRes = await request(app.getHttpServer())
        .post(`/plans/${a19PlanId}/approve`)
        .set(manager.authHeader())
        .send({ comments: 'A19 e2e: split boyutta approve' })
        .expect(200);
      expect(approveRes.body.status).toBe('APPROVED');

      const commitRows = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type, envelope_id
           FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'COMMIT'
          ORDER BY spend_type ASC`,
        [a19PlanId],
      );
      record({
        step: 'A19b',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (split boyutta approve sonrası)',
        expected: '2 COMMIT — ON/OFF ikizlerinde, RESERVE ile aynı tutar',
        actual: JSON.stringify(commitRows),
        note: 'T-056 adım 6: approve auto-create/existence-check artık ON/OFF ikizlerini AYRI AYRI çözüyor, tipsiz arama yapmıyor.',
      });
      expect(commitRows.length).toBe(2);
      expect(
        commitRows.every((r: any) =>
          [a19OnEnvelopeId, a19OffEnvelopeId].includes(r.envelope_id),
        ),
      ).toBe(true);
      for (const bucket of ['ON_INVOICE', 'OFF_INVOICE']) {
        const reserveAmt = Number(
          reserveRows.find((r: any) => r.spend_type === bucket)?.amount,
        );
        const commitAmt = Number(
          commitRows.find((r: any) => r.spend_type === bucket)?.amount,
        );
        expect(commitAmt).toBe(reserveAmt);
      }

      // ── Auto-create hiç tetiklenmedi (ikiz zarflar zaten vardı) — split
      // boyutta üçüncü/tipsiz bir zarf yaratılmadığının SQL kanıtı ────────
      const envelopesForDimension = await dataSource.query(
        `SELECT id, spend_type FROM main.budget_envelopes
          WHERE tenant_id = $1 AND channel = 'NKA' AND period = $2`,
        [fixture.tenantId, a19Period],
      );
      expect(envelopesForDimension.length).toBe(2); // yalnız ON + OFF
      expect(
        envelopesForDimension.every((e: any) =>
          ['ON_INVOICE', 'OFF_INVOICE'].includes(e.spend_type),
        ),
      ).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────
    // T-062: LUMPSUM_SPEND (VIS_LS) was recognised and routed to off-invoice
    // but ALWAYS computed as 0 (`distributeSpendToSKUs`, the method meant to
    // handle it, was never wired to any production caller) — a lumpsum
    // plan reserved ZERO budget. Fixed: distributed base-volume-proportional
    // across SKUs (docs/decisions/0006), null-base SKU gets zero share
    // (0001 Set C), exact-sum rounding, all-null-base FU noisily rejected
    // (not silently zeroed).
    // ────────────────────────────────────────────────────────────────────

    it('A20. T-062: LUMPSUM_SPEND (VIS_LS) reserves non-zero budget, distributed base-volume-proportional, null-base SKU gets zero share (SQL kanıtı)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-T062-LUMPSUM-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const a20PlanId = createRes.body.id;

      await request(app.getHttpServer())
        .post(`/plans/${a20PlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${a20PlanId}`)
        .set(planner.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus[0];
      const lumpsumSkuA = planFu.planSkus.find(
        (ps: any) => ps.sku?.code === 'SKU-E2E-LUMPSUM-A',
      );
      const lumpsumSkuB = planFu.planSkus.find(
        (ps: any) => ps.sku?.code === 'SKU-E2E-LUMPSUM-B',
      );
      const nullBaseSku = planFu.planSkus.find(
        (ps: any) => ps.sku?.code === 'SKU-E2E-COGS-FIXTURE',
      );
      expect(lumpsumSkuA).toBeDefined();
      expect(lumpsumSkuB).toBeDefined();
      expect(nullBaseSku).toBeDefined(); // deliberately left at null base volume below

      // Base volume ratio 1:2 (non-terminating decimal 33.33/66.67 split) —
      // exercises the exact-sum rounding-remainder path, not a coincidence.
      await request(app.getHttpServer())
        .patch(
          `/plans/${a20PlanId}/fus/${FU_WELLA_HC_500ML}/skus/${lumpsumSkuA.skuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 1, plannedVolume: 1, version: 1 })
        .expect(200);
      await request(app.getHttpServer())
        .patch(
          `/plans/${a20PlanId}/fus/${FU_WELLA_HC_500ML}/skus/${lumpsumSkuB.skuId}/volume`,
        )
        .set(planner.authHeader())
        .send({ baseVolume: 2, plannedVolume: 2, version: 1 })
        .expect(200);
      // nullBaseSku (SKU-E2E-COGS-FIXTURE) intentionally left untouched —
      // base volume stays null, proving the Set C rule end-to-end.

      // MEC-DISCOUNT (on-invoice %) + VIS_LS (off-invoice lumpsum, FU-level
      // amount) — proves BOTH buckets participate and on+off=total holds
      // with a real lumpsum contribution in the off-invoice bucket.
      await request(app.getHttpServer())
        .patch(`/plans/${a20PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { 'MEC-DISCOUNT': 10, VIS_LS: 100 }, version: 1 })
        .expect(200);

      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${a20PlanId}/recalculate`)
        .set(planner.authHeader())
        .send({})
        .expect(200);

      // GSV_A = 1*100 = 100, GSV_B = 2*100 = 200 (no LTA on NKA/CPL_1/
      // CAT-SAC-BOYASI — the only seeded LTA fixture is a DRAFT agreement on
      // a different channel). on = 10%*(100+200) = 30.00. off = pure VIS_LS
      // (no other off-invoice mechanic entered) = 100.00 exactly.
      record({
        step: 'A20a',
        role: '-',
        endpoint: 'POST /plans/:id/recalculate (VIS_LS lumpsum)',
        expected: 'on=30.00, off=100.00, total=130.00',
        actual: `on=${recalcRes.body.onInvoiceSpend}, off=${recalcRes.body.offInvoiceSpend}, total=${recalcRes.body.totalSpend}`,
        note: 'T-062 FIX: before this fix, VIS_LS always computed 0 — off would have been 0.00, total 30.00, and the plan would have reserved zero budget for its lumpsum mechanic.',
      });
      expect(Number(recalcRes.body.onInvoiceSpend)).toBeCloseTo(30, 2);
      expect(Number(recalcRes.body.offInvoiceSpend)).toBeCloseTo(100, 2);
      expect(Number(recalcRes.body.totalSpend)).toBeCloseTo(130, 2);
      // T-056 step 4 identity — must still hold with lumpsum in the mix.
      expect(
        Number(recalcRes.body.onInvoiceSpend) +
          Number(recalcRes.body.offInvoiceSpend),
      ).toBeCloseTo(Number(recalcRes.body.totalSpend), 2);

      // ── Per-SKU proof (main.plan_skus.tactic_spend) — the null-base SKU
      // must carry ZERO lumpsum contribution; the other two split 33.33/66.67
      // (rounding-remainder-corrected) plus their own on-invoice share.
      const planSkuRows = await dataSource.query(
        `SELECT s.code, ps.tactic_spend
           FROM main.plan_skus ps
           JOIN main.skus s ON s.id = ps.sku_id
          WHERE ps.plan_fu_id = $1`,
        [planFu.id],
      );
      const byCode: Record<string, number> = {};
      for (const r of planSkuRows) byCode[r.code] = Number(r.tactic_spend);
      record({
        step: 'A20b',
        role: '-',
        endpoint: 'DB: main.plan_skus.tactic_spend (per-SKU, VIS_LS dahil)',
        expected:
          'SKU-E2E-COGS-FIXTURE=0 (null base, 0001 Set C), LUMPSUM-A≈43.33, LUMPSUM-B≈86.67',
        actual: JSON.stringify(byCode),
        note: 'T-062: LUMPSUM-A/B tactic_spend = (10% on-invoice share) + (base-volume-proportional VIS_LS share, 33.33/66.67).',
      });
      expect(byCode['SKU-E2E-COGS-FIXTURE']).toBe(0);
      expect(byCode['SKU-E2E-LUMPSUM-A']).toBeCloseTo(10 + 33.33, 2);
      expect(byCode['SKU-E2E-LUMPSUM-B']).toBeCloseTo(20 + 66.67, 2);

      // ── SUBMIT — the actual bug this task closes: a lumpsum plan must
      // reserve a NON-ZERO budget amount, not silently reserve 0. ──────────
      const submitRes = await request(app.getHttpServer())
        .post(`/plans/${a20PlanId}/submit`)
        .set(planner.authHeader())
        .send({ version: recalcRes.body.version })
        .expect(200);
      expect(submitRes.body.status).toBe('PENDING_APPROVAL');

      const budgetTx = await dataSource.query(
        `SELECT tx_type, tx_status, amount, spend_type FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1
          ORDER BY spend_type ASC NULLS LAST, created_at ASC`,
        [a20PlanId],
      );
      const onTx = budgetTx.find((r: any) => r.spend_type === 'ON_INVOICE');
      const offTx = budgetTx.find((r: any) => r.spend_type === 'OFF_INVOICE');
      record({
        step: 'A20c',
        role: '-',
        endpoint:
          'DB: main.budget_transactions (submit sonrası, VIS_LS içeren plan)',
        expected:
          'RESERVE ON_INVOICE=30.00, RESERVE OFF_INVOICE=100.00 (T-062 öncesi: OFF_INVOICE=0)',
        actual: JSON.stringify(budgetTx),
        note: 'T-062: bu, görev tanımının SORUN cümlesinin ("lumpsum harcamalı plan bütçeden hiç düşmüyor") doğrudan SQL kanıtıdır — OFF_INVOICE RESERVE artık 0 DEĞİL.',
      });
      expect(budgetTx.length).toBe(2);
      expect(Number(onTx?.amount)).toBeCloseTo(30, 2);
      expect(Number(offTx?.amount)).toBeCloseTo(100, 2);
      expect(Number(offTx?.amount)).toBeGreaterThan(0); // the T-062 bug, directly asserted
      expect(Number(onTx.amount) + Number(offTx.amount)).toBeCloseTo(130, 2);
    });

    it("A21. T-062: FU-deki TÜM SKU'ların base hacmi null/0 iken lumpsum girilirse recalculate GÜRÜLTÜLÜ reddetmeli (sessiz 0 dağıtım YASAK — SQL kanıtı yok, bütçe hiç dokunulmamalı)", async () => {
      const planner = await loginAs(app, 'PLANNER');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-T062-NO-BASE-VOLUME-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      const a21PlanId = createRes.body.id;

      await request(app.getHttpServer())
        .post(`/plans/${a21PlanId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);

      // Deliberately NO volume PATCH — every SKU in this FU (3 fixture SKUs)
      // keeps its null base volume from `addFu`'s auto-added planSkus.
      // `PATCH .../tactics` itself triggers `recalculatePlanWithKpiEngine`
      // synchronously (`PlanService#updateFuTactic`) — so the rejection
      // surfaces right here, not on a later explicit `/recalculate` call.
      const tacticsRes = await request(app.getHttpServer())
        .patch(`/plans/${a21PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { VIS_LS: 100 }, version: 1 });

      record({
        step: 'A21',
        role: '-',
        endpoint:
          'PATCH /plans/:id/fus/:fuId/tactics (VIS_LS, tüm SKUlar null base)',
        expected:
          '400 LUMPSUM_DISTRIBUTION_NO_BASE_VOLUME (gürültülü red, sessiz 0 DEĞİL)',
        actual: `${tacticsRes.status} ${JSON.stringify(tacticsRes.body)}`,
        note: 'T-062 tuzak: dağıtım tabanı 0 iken sessizce 0 dağıtmak, bu görevin kapattığı sessiz-eksik-rezervasyon hatasını AYNEN yeniden üretirdi (ADR 0005 K3 emsali: gürültülü red). PATCH .../tactics kendi içinde recalculatePlanWithKpiEngine çağırdığı için red burada, ayrı bir /recalculate çağrısı beklemeden gerçekleşiyor.',
      });
      expect(tacticsRes.status).toBe(400);
      expect(tacticsRes.body.code).toBe('LUMPSUM_DISTRIBUTION_NO_BASE_VOLUME');

      // Budget must not have been touched — recalculate failed before any
      // reservation could happen (this plan never even reaches submit).
      const planRow = await dataSource.query(
        `SELECT total_spend, on_invoice_spend, off_invoice_spend FROM main.plans WHERE id = $1`,
        [a21PlanId],
      );
      expect(Number(planRow[0].total_spend)).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // B) PLANNER KAPSAM (B-3 kanıtı)
  // ══════════════════════════════════════════════════════════════════════

  describe('B) Planner kapsam (CPL scope) kanıtı', () => {
    it('B1. user_scopes tablosu dolu mu (T-028b: user-scope.seed.ts kanıtı; PLANNER enforcement hâlâ T-028c işi)', async () => {
      const rows = await dataSource.query(
        `SELECT count(*)::int AS c FROM main.user_scopes WHERE tenant_id = $1`,
        [fixture.tenantId],
      );
      record({
        step: 'B1',
        role: '-',
        endpoint: 'DB: main.user_scopes',
        expected:
          '> 0 satır (T-028b user-scope.seed.ts: planner/planner2/category.manager/category.manager2)',
        actual: rows[0].c,
        note: 'T-028b FIX: user-scope.seed.ts artık planner/planner2 (NKA/Distribütör CPL) ve category.manager/category.manager2 (kategori) satırlarını üretiyor (bkz. §9 N14). PLANNER için bu veri PlanService.findAll/create tarafından HENÜZ okunmuyor (T-028c) — bu satır sadece veri varlığını kanıtlar, enforcement B2/B3 hâlâ eski (bilinçli) davranışı gösterir.',
      });
      expect(rows[0].c).toBeGreaterThan(0);
    });

    it('B2. PLANNER → PLANNER kullanıcısına atanmamış farklı bir CPL ile POST /plans dener', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-ROLE-JOURNEY-SCOPE-${Date.now()}`,
          cplId: CPL_2,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });

      record({
        step: 'B2',
        role: 'PLANNER',
        endpoint: 'POST /plans (atanmamış CPL)',
        expected:
          '403 (BRD: yalnızca yetkili CPL+Category) — kod: 201 KABUL EDİYOR',
        actual: res.status,
        note: 'BRD İHLALİ: PlanService.create() hiçbir CPL/UserScope kontrolü yapmıyor — PLANNER herhangi bir CPL için plan açabiliyor',
      });

      expect(res.status).toBe(201);

      // Bu test kaydını temizle (DRAFT plan → silinebilir)
      if (res.status === 201) {
        const admin = await loginAs(app, 'ADMIN');
        await request(app.getHttpServer())
          .delete(`/plans/${res.body.id}`)
          .set(admin.authHeader())
          .send({ version: res.body.version });
      }
    });

    it('B3. PLANNER → GET /plans → başka CPL planlarını görebiliyor mu (tenant-wide mi?)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const admin = await loginAs(app, 'ADMIN');

      const plannerRes = await request(app.getHttpServer())
        .get('/plans')
        .set(planner.authHeader())
        .expect(200);
      const adminRes = await request(app.getHttpServer())
        .get('/plans')
        .set(admin.authHeader())
        .expect(200);

      record({
        step: 'B3',
        role: 'PLANNER vs ADMIN',
        endpoint: 'GET /plans',
        expected: SCOPE_ENFORCEMENT_ON
          ? 'PLANNER sayısı <= ADMIN sayısı (scope filtreli, T-028c)'
          : 'PLANNER sayısı == ADMIN sayısı (SCOPE_ENFORCEMENT_ENABLED=false, bugünkü davranış)',
        actual: `PLANNER=${plannerRes.body.length}, ADMIN=${adminRes.body.length}`,
        note: SCOPE_ENFORCEMENT_ON
          ? 'T-028c: findAll() artık AccessScopeService.applyToQueryBuilder ile PLANNER cpl+category pair scope’una göre filtreleniyor (kesin fark için bkz. F) bölümü N7).'
          : 'BRD İHLALİ (bilinçli — flag kapalı): PlanService.findAll() PLANNER için hiçbir CPL/UserScope kontrolü yapmıyor, tenant-wide görüyor. T-028c bunu flag AÇIKKEN düzeltiyor (bkz. F) bölümü).',
      });

      // Flag kapalıyken (varsayılan, bugünkü davranış): tam eşitlik.
      // Flag açıkken: PLANNER en fazla ADMIN kadar görür (kesin "<" kanıtı
      // için bkz. F) N7 — burada sadece genel gözlem, deterministik değil).
      if (SCOPE_ENFORCEMENT_ON) {
        expect(plannerRes.body.length).toBeLessThanOrEqual(
          adminRes.body.length,
        );
      } else {
        expect(plannerRes.body.length).toBe(adminRes.body.length);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // E) CM KATEGORİ-SCOPED ONAY (T-028b) — docs/analysis/0004 §3/§9
  // ══════════════════════════════════════════════════════════════════════
  //
  // category.manager@wella.com  -> scope: CAT-SAC-BOYASI, CAT-SET-BOYA
  // category.manager2@wella.com -> scope: CAT-SEKILLENDIRICI (KESİŞMEZ)
  // (bkz. src/database/seeds/user-scope.seed.ts)

  describe('E) CM kategori-scoped onay (T-028b)', () => {
    let CATEGORY_OTHER: string; // CAT-SEKILLENDIRICI — category.manager'ın DIŞINDA
    const scratchPlanIds: string[] = [];

    beforeAll(async () => {
      CATEGORY_OTHER = await resolveIdByCode(
        dataSource,
        fixture.tenantId,
        'categories',
        'CAT-SEKILLENDIRICI',
      );
    });

    afterAll(async () => {
      // Yalnızca DRAFT kalanlar silinebilir; APPROVED/PENDING olanlar BRD
      // gereği kalıcıdır (dosya başlığı izolasyon notuyla tutarlı).
      const admin = await loginAs(app, 'ADMIN');
      for (const id of scratchPlanIds) {
        try {
          const res = await request(app.getHttpServer())
            .get(`/plans/${id}`)
            .set(admin.authHeader());
          if (res.status === 200 && res.body?.status === 'DRAFT') {
            await request(app.getHttpServer())
              .delete(`/plans/${id}`)
              .set(admin.authHeader())
              .send({ version: res.body.version });
          }
        } catch {
          // best-effort cleanup
        }
      }
    });

    async function createDraftPlan(
      actor: Awaited<ReturnType<typeof loginAs>>,
      categoryId: string,
      namePrefix: string,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(actor.authHeader())
        .send({
          planName: `${namePrefix}-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      scratchPlanIds.push(res.body.id);
      return res.body.id;
    }

    /** DRAFT plan + FU_WELLA_HC_500ML (COGS dolu fixture) + submit -> PENDING_APPROVAL, totalSpend > 0. */
    async function createSubmittedPlan(
      actor: Awaited<ReturnType<typeof loginAs>>,
      categoryId: string,
      namePrefix: string,
    ): Promise<string> {
      const id = await createDraftPlan(actor, categoryId, namePrefix);

      await request(app.getHttpServer())
        .post(`/plans/${id}/fus`)
        .set(actor.authHeader())
        .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
        .expect(201);

      const planRes = await request(app.getHttpServer())
        .get(`/plans/${id}`)
        .set(actor.authHeader())
        .expect(200);
      const planFu = planRes.body.planFus[0];
      const skuId = planFu.planSkus[0].skuId;

      await request(app.getHttpServer())
        .patch(`/plans/${id}/fus/${FU_WELLA_HC_500ML}/skus/${skuId}/volume`)
        .set(actor.authHeader())
        .send({ baseVolume: 800, plannedVolume: 1000, version: 1 })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/plans/${id}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(actor.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10, VIS_LS: 2000 }, version: 1 })
        .expect(200);

      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${id}/recalculate`)
        .set(actor.authHeader())
        .send({})
        .expect(200);

      // T-034b: submit() also validates plans.version (K5 exception) — see
      // createT029TestPlan's identical comment above.
      await request(app.getHttpServer())
        .post(`/plans/${id}/submit`)
        .set(actor.authHeader())
        .send({ version: recalcRes.body.version })
        .expect(200);

      return id;
    }

    it('N1. CATEGORY_MANAGER → POST /plans → 403 (CM plan oluşturamaz)', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(cm.authHeader())
        .send({
          planName: `E2E-N1-CM-CREATE-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });

      record({
        step: 'N1',
        role: 'CATEGORY_MANAGER',
        endpoint: 'POST /plans',
        expected: 403,
        actual: res.status,
        note: "BRD: CM plan düzenleyemez/oluşturamaz — @Roles(ADMIN, PLANNER) zaten CM'i dışlıyor (RolesGuard, değişmedi).",
      });
      expect(res.status).toBe(403);
    });

    it('N2. CATEGORY_MANAGER → PATCH /plans/:id → 403 (kendi kategorisindeki plan olsa dahi)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const ownCategoryPlanId = await createDraftPlan(
        planner,
        CATEGORY_SAC_BOYASI,
        'E2E-N2-CM-UPDATE',
      );

      const res = await request(app.getHttpServer())
        .patch(`/plans/${ownCategoryPlanId}`)
        .set(cm.authHeader())
        .send({ planName: 'hacked-by-cm' });

      record({
        step: 'N2',
        role: 'CATEGORY_MANAGER',
        endpoint: 'PATCH /plans/:id',
        expected: 403,
        actual: res.status,
        note: 'BRD: CM plan düzenleyemez — kendi kategorisindeki bir plan olsa bile yazma yetkisi yok (@Roles(ADMIN, PLANNER)).',
      });
      expect(res.status).toBe(403);
    });

    it('N3. CATEGORY_MANAGER → GET /plans/:id (başka kategori) → 404 (varlık sızdırma yok)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const otherCategoryPlanId = await createDraftPlan(
        planner,
        CATEGORY_OTHER,
        'E2E-N3-CM-OUT-OF-SCOPE-GET',
      );

      const res = await request(app.getHttpServer())
        .get(`/plans/${otherCategoryPlanId}`)
        .set(cm.authHeader());

      record({
        step: 'N3',
        role: 'CATEGORY_MANAGER',
        endpoint: 'GET /plans/:id (kapsam dışı kategori)',
        expected: 404,
        actual: res.status,
        note: 'T-028b FIX: AccessScopeService.isInScope + PlanService#assertCmReadScope — CM kategori kesişimi yoksa 404 (varlık sızdırma yok, docs/analysis/0004 §3/§9 N3).',
      });
      expect(res.status).toBe(404);
      expect(res.body?.code).toBe('OUT_OF_SCOPE');
    });

    it('N3b. CATEGORY_MANAGER2 → aynı plan → 200 (kendi kategorisi — kesişim var)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm2 = await loginAs(app, 'CATEGORY_MANAGER2');
      const otherCategoryPlanId = await createDraftPlan(
        planner,
        CATEGORY_OTHER,
        'E2E-N3b-CM2-IN-SCOPE-GET',
      );

      const res = await request(app.getHttpServer())
        .get(`/plans/${otherCategoryPlanId}`)
        .set(cm2.authHeader());

      record({
        step: 'N3b',
        role: 'CATEGORY_MANAGER2',
        endpoint: 'GET /plans/:id (kendi kategorisi)',
        expected: 200,
        actual: res.status,
        note: 'Pozitif kontrol: N3 404 sonucunun rastgele değil, gerçek kategori kesişimine dayandığının kanıtı (category.manager2 -> CAT-SEKILLENDIRICI scope).',
      });
      expect(res.status).toBe(200);
    });

    it('N4. CATEGORY_MANAGER → POST /plans/:id/approve (başka kategori, PENDING_APPROVAL) → 403', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const otherCategoryPlanId = await createSubmittedPlan(
        planner,
        CATEGORY_OTHER,
        'E2E-N4-CM-OUT-OF-SCOPE-APPROVE',
      );

      const res = await request(app.getHttpServer())
        .post(`/plans/${otherCategoryPlanId}/approve`)
        .set(cm.authHeader())
        .send({ comments: 'should be forbidden' });

      record({
        step: 'N4',
        role: 'CATEGORY_MANAGER',
        endpoint: 'POST /plans/:id/approve (kapsam dışı kategori)',
        expected: 403,
        actual: res.status,
        note: "T-028b FIX: PlanService#assertCmDecisionScope — CM kategori kesişimi yoksa 403 (docs/analysis/0004 §3/§9 N4). approve() route ADMIN|CATEGORY_MANAGER'a açık (RolesGuard geçer), scope kontrolü servis katmanında.",
      });
      expect(res.status).toBe(403);

      // Bütçe reserve edilmiş olabilir (submit sırasında) — temizlik: reject
      // ile release et (admin, self-approval guard'ına takılmasın diye farklı hesap).
      const admin = await loginAs(app, 'ADMIN');
      await request(app.getHttpServer())
        .post(`/plans/${otherCategoryPlanId}/reject`)
        .set(admin.authHeader())
        .send({ reason: 'E2E N4 cleanup' });
    });

    it('N5. PLANNER → POST /plans/:id/approve → 403 (BRD: Planner onaylayamaz)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .post(`/plans/${planId}/approve`)
        .set(planner.authHeader())
        .send({ comments: 'planner cannot approve' });

      record({
        step: 'N5',
        role: 'PLANNER',
        endpoint: 'POST /plans/:id/approve',
        expected: 403,
        actual: res.status,
        note: "BRD: Planner plan onaylayamaz — @Roles(ADMIN, CATEGORY_MANAGER) zaten PLANNER'ı dışlıyor (RolesGuard, değişmedi).",
      });
      expect(res.status).toBe(403);
    });

    it('N11. FINANCE_MANAGER → POST /plans/:id/approve (PENDING_APPROVAL) → 403 (ADR-0002)', async () => {
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      const res = await request(app.getHttpServer())
        .post(`/plans/${planId}/approve`)
        .set(fm.authHeader())
        .send({ comments: 'fm cannot approve normal queue' });

      record({
        step: 'N11',
        role: 'FINANCE_MANAGER',
        endpoint: 'POST /plans/:id/approve',
        expected: 403,
        actual: res.status,
        note: "ADR-0002: FM yalnızca PENDING_FINANCE_REVIEW onaylar — /plans/:id/approve route'u zaten @Roles(ADMIN, CATEGORY_MANAGER) (FM listede yok), RolesGuard seviyesinde 403.",
      });
      expect(res.status).toBe(403);
    });

    it('N12. self-approval → 403 (F7: legacy PlanService.approve() self-approval guard)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const selfApprovePlanId = await createSubmittedPlan(
        admin,
        CATEGORY_SAC_BOYASI,
        'E2E-N12-SELF-APPROVE',
      );

      const res = await request(app.getHttpServer())
        .post(`/plans/${selfApprovePlanId}/approve`)
        .set(admin.authHeader())
        .send({ comments: 'self approving own submission' });

      record({
        step: 'N12',
        role: 'ADMIN (submitter === approver)',
        endpoint: 'POST /plans/:id/approve (self-approval)',
        expected: 403,
        actual: res.status,
        note: "F7 FIX (docs/analysis/0004 §1/§9 N12): PlanService.approve() artık plan.submittedById === userId ise 403 atıyor — önceden legacy/kanonik yol (submit()+approve(), frontend'in fiilen kullandığı) self-approval kontrolü yapmıyordu (yalnızca ApprovalWorkflowService#reviewPlan'de vardı). submit() artık submittedById'yi de yazıyor (bu fix olmadan guard veri yokluğundan hiç tetiklenmezdi).",
      });
      expect(res.status).toBe(403);

      // Temizlik: reject ile release et (farklı bir hesap — CATEGORY_MANAGER
      // kendi kategorisinde: CAT-SAC-BOYASI, admin self-approval'a takılmaz
      // çünkü submittedById === admin.id, reject de aynı guard'ı taşıyor —
      // CM ile temizle).
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      await request(app.getHttpServer())
        .post(`/plans/${selfApprovePlanId}/reject`)
        .set(cm.authHeader())
        .send({ reason: 'E2E N12 cleanup' });
    });

    it('N14. main.user_scopes satır sayısı > 0 (T-028b seed kanıtı — B1 ile aynı, burada da tekrarlanır)', async () => {
      const rows = await dataSource.query(
        `SELECT count(*)::int AS c FROM main.user_scopes WHERE tenant_id = $1`,
        [fixture.tenantId],
      );
      record({
        step: 'N14',
        role: '-',
        endpoint: 'DB: main.user_scopes',
        expected: '> 0',
        actual: rows[0].c,
        note: 'docs/analysis/0004 §9 N14 — user-scope.seed.ts idempotent upsert.',
      });
      expect(rows[0].c).toBeGreaterThan(0);
    });

    it('POZİTİF: CATEGORY_MANAGER → kendi kategorisinde approval-queue 200 + approve 200 (APPROVED + bütçe COMMIT)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const ownCategoryPlanId = await createSubmittedPlan(
        planner,
        CATEGORY_SAC_BOYASI,
        'E2E-POS-CM-OWN-CATEGORY',
      );

      const queueRes = await request(app.getHttpServer())
        .get('/plans/approval-queue')
        .set(cm.authHeader())
        .expect(200);
      const inQueue = (queueRes.body as any[]).some(
        (p) => p.id === ownCategoryPlanId,
      );

      const approveRes = await request(app.getHttpServer())
        .post(`/plans/${ownCategoryPlanId}/approve`)
        .set(cm.authHeader())
        .send({ comments: 'CM approves own-category plan' });

      const commitTx = await dataSource.query(
        `SELECT tx_type FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'COMMIT'`,
        [ownCategoryPlanId],
      );

      record({
        step: 'POS-CM',
        role: 'CATEGORY_MANAGER',
        endpoint:
          'GET /plans/approval-queue + POST /plans/:id/approve (kendi kategorisi)',
        expected: 'queue içinde=true, approve=200 APPROVED, >=1 COMMIT tx',
        actual: `queue içinde=${inQueue}, approve=${approveRes.status}/${approveRes.body?.status}, commitTxCount=${commitTx.length}`,
        note: "T-028b: F3 fix (approval-queue kategori kesişimi) + kendi kategorisinde approve akışının BRD state machine'i (PENDING_APPROVAL -> APPROVED, RESERVE -> COMMIT) bozmadığının kanıtı.",
      });

      expect(inQueue).toBe(true);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');
      expect(commitTx.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // E2) CM AGREEMENT KATEGORİ-SCOPE (T-028e) — code-review bulgusu (T-028c):
  // agreement.approve()/reject()/findById()/findAll() actor'suzdu, CM
  // herhangi bir kategorideki agreement'ı onaylayabiliyordu. Ürün kararı:
  // agreements.category_id neredeyse her satırda boş — efektif kategori
  // fuId -> forecasting_units.gu_id -> generic_units.category_id zincirinden
  // TÜRETİLİR (bkz. AgreementService#resolveEffectiveCategoryId).
  //
  // FU -> kategori eşleşmesi (DB'de doğrulandı, main.forecasting_units JOIN
  // main.generic_units JOIN main.categories):
  //   FU-TUP-BOYA  -> CAT-SAC-BOYASI     (category.manager@wella.com kapsamında)
  //   FU-NEW-WAVE  -> CAT-SEKILLENDIRICI (category.manager2@wella.com kapsamında,
  //                                       category.manager@wella.com'un DIŞINDA)
  // ══════════════════════════════════════════════════════════════════════

  describe('E2) CM agreement kategori-scoped onay/red/okuma (T-028e)', () => {
    let FU_NEW_WAVE: string; // CAT-SEKILLENDIRICI — category.manager'ın DIŞINDA
    const scratchAgreementIds: string[] = [];

    beforeAll(async () => {
      FU_NEW_WAVE = await resolveIdByCode(
        dataSource,
        fixture.tenantId,
        'forecasting_units',
        'FU-NEW-WAVE',
      );
    });

    /** DRAFT agreement — categoryId DTO'ya kasıtlı olarak GEÇİLMEZ (agreements.category_id
     * boş kalır), efektif kategori yalnızca fuId->gu->category zincirinden türetilebilsin diye. */
    async function createDraftAgreement(
      actor: Awaited<ReturnType<typeof loginAs>>,
      fuId: string,
      namePrefix: string,
      startDate: string,
      endDate: string,
      capTotalAmount = 3000,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/agreements')
        .set(actor.authHeader())
        .send({
          agreementName: `${namePrefix}-${Date.now()}`,
          agreementType: 'STA',
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          fuId,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          capTotalAmount,
          spendType: 'OFF_INVOICE',
          startDate,
          endDate,
          justification: `E2E T-028e — ${namePrefix}`,
        })
        .expect(201);
      scratchAgreementIds.push(res.body.id);
      expect(res.body.categoryId ?? null).toBeNull();
      return res.body.id;
    }

    async function createSubmittedAgreement(
      actor: Awaited<ReturnType<typeof loginAs>>,
      fuId: string,
      namePrefix: string,
      startDate: string,
      endDate: string,
    ): Promise<string> {
      const id = await createDraftAgreement(
        actor,
        fuId,
        namePrefix,
        startDate,
        endDate,
      );
      await request(app.getHttpServer())
        .post(`/agreements/${id}/submit`)
        .set(actor.authHeader())
        .send({})
        .expect(200);
      return id;
    }

    it('G1. CATEGORY_MANAGER → GET /agreements/:id (kendi kategorisi, FU->GU türetilmiş) → 200', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const ownCategoryAgreementId = await createDraftAgreement(
        planner,
        FU_TUP_BOYA,
        'E2E-G1-CM-OWN-CATEGORY-GET',
        '2026-01-05',
        '2026-01-15',
      );

      const res = await request(app.getHttpServer())
        .get(`/agreements/${ownCategoryAgreementId}`)
        .set(cm.authHeader());

      record({
        step: 'G1',
        role: 'CATEGORY_MANAGER',
        endpoint:
          'GET /agreements/:id (FU-TUP-BOYA -> CAT-SAC-BOYASI, kendi kategorisi)',
        expected: 200,
        actual: res.status,
        note: 'T-028e FIX: AgreementService#resolveEffectiveCategoryId — agreement.categoryId boş, kategori fuId->gu->category zincirinden türetildi ve CM scope kesişimi buldu.',
      });
      expect(res.status).toBe(200);
    });

    it('G2. CATEGORY_MANAGER → GET /agreements/:id (başka kategori, FU->GU türetilmiş) → 404 OUT_OF_SCOPE', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const otherCategoryAgreementId = await createDraftAgreement(
        planner,
        FU_NEW_WAVE,
        'E2E-G2-CM-OUT-OF-SCOPE-GET',
        '2026-01-05',
        '2026-01-15',
      );

      const res = await request(app.getHttpServer())
        .get(`/agreements/${otherCategoryAgreementId}`)
        .set(cm.authHeader());

      record({
        step: 'G2',
        role: 'CATEGORY_MANAGER',
        endpoint:
          'GET /agreements/:id (FU-NEW-WAVE -> CAT-SEKILLENDIRICI, kapsam dışı)',
        expected: 404,
        actual: res.status,
        note: "T-028e FIX: varlık sızdırma yok — CM önceden findById(id,tenantId) actor'suz olduğu için HERHANGİ agreement'ı görebiliyordu (SORUN). Artık AgreementActor thread edilip 404 dönüyor.",
      });
      expect(res.status).toBe(404);
      expect(res.body?.code).toBe('OUT_OF_SCOPE');
    });

    it('G2b. CATEGORY_MANAGER2 → aynı agreement (kendi kategorisi) → 200 (pozitif kontrol)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm2 = await loginAs(app, 'CATEGORY_MANAGER2');
      const otherCategoryAgreementId = await createDraftAgreement(
        planner,
        FU_NEW_WAVE,
        'E2E-G2b-CM2-IN-SCOPE-GET',
        '2026-01-05',
        '2026-01-15',
      );

      const res = await request(app.getHttpServer())
        .get(`/agreements/${otherCategoryAgreementId}`)
        .set(cm2.authHeader());

      record({
        step: 'G2b',
        role: 'CATEGORY_MANAGER2',
        endpoint: 'GET /agreements/:id (kendi kategorisi)',
        expected: 200,
        actual: res.status,
        note: 'Pozitif kontrol: G2 404 sonucunun rastgele değil, gerçek türetilmiş kategori kesişimine dayandığının kanıtı (category.manager2 -> CAT-SEKILLENDIRICI scope).',
      });
      expect(res.status).toBe(200);
    });

    it('G3. CATEGORY_MANAGER → POST /agreements/:id/approve (kendi kategorisi, PENDING) → 200 APPROVED', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const ownCategoryAgreementId = await createSubmittedAgreement(
        planner,
        FU_TUP_BOYA,
        'E2E-G3-CM-OWN-CATEGORY-APPROVE',
        '2026-01-05',
        '2026-01-15',
      );

      const res = await request(app.getHttpServer())
        .post(`/agreements/${ownCategoryAgreementId}/approve`)
        .set(cm.authHeader())
        .send({ comments: 'CM approves own-category agreement' });

      record({
        step: 'G3',
        role: 'CATEGORY_MANAGER',
        endpoint:
          'POST /agreements/:id/approve (FU-TUP-BOYA -> CAT-SAC-BOYASI, kendi kategorisi)',
        expected: 200,
        actual: res.status,
        note: 'T-028e FIX: AgreementService#assertCmDecisionScope — kesişim var, BRD state machine bozulmadan APPROVED + RESERVE.',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');

      // Temizlik: APPROVED agreement'lar silinemez (BRD) ve dev DB'de kalıcı
      // kalırsa `loadE2EFixture`'ın "en eski APPROVED agreement" seçim
      // stratejisini (test/helpers/seed-e2e.ts) dar tarih penceresiyle (2026-01)
      // bozup BAŞKA e2e dosyalarını (örn. reversal.e2e-spec.ts, sabit
      // invoiceDate=2026-02-15 varsayar) kırabilir. CANCEL ile APPROVED
      // havuzundan çıkar (ADMIN — cancel route @Roles(ADMIN, PLANNER)).
      const admin = await loginAs(app, 'ADMIN');
      await request(app.getHttpServer())
        .post(`/agreements/${ownCategoryAgreementId}/cancel`)
        .set(admin.authHeader())
        .send({
          reason: 'E2E G3 cleanup — APPROVED havuzunu kirletmemek için',
        });
    });

    it('G4. CATEGORY_MANAGER → POST /agreements/:id/approve (başka kategori, PENDING) → 403', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const otherCategoryAgreementId = await createSubmittedAgreement(
        planner,
        FU_NEW_WAVE,
        'E2E-G4-CM-OUT-OF-SCOPE-APPROVE',
        '2026-01-06',
        '2026-01-16',
      );

      const res = await request(app.getHttpServer())
        .post(`/agreements/${otherCategoryAgreementId}/approve`)
        .set(cm.authHeader())
        .send({ comments: 'should be forbidden' });

      record({
        step: 'G4',
        role: 'CATEGORY_MANAGER',
        endpoint:
          'POST /agreements/:id/approve (FU-NEW-WAVE -> CAT-SEKILLENDIRICI, kapsam dışı)',
        expected: 403,
        actual: res.status,
        note: "T-028e FIX (SORUN): önceden approve() actor almıyordu, CM HERHANGİ kategorideki agreement'ı onaylayabiliyordu. Artık AgreementService#assertCmDecisionScope 403 döner.",
      });
      expect(res.status).toBe(403);

      // Temizlik: kendi kategorisindeki CM2 ile reject et (PENDING'de henüz
      // bütçe reserve edilmemiş — RESERVE yalnızca approve() içinde yazılır —
      // ama agreement'ı PENDING'de bırakmamak için formel olarak kapatıyoruz).
      const cm2 = await loginAs(app, 'CATEGORY_MANAGER2');
      await request(app.getHttpServer())
        .post(`/agreements/${otherCategoryAgreementId}/reject`)
        .set(cm2.authHeader())
        .send({ reason: 'E2E G4 cleanup (kendi kategorisi)' });
    });

    it('G5. CATEGORY_MANAGER → POST /agreements/:id/reject (başka kategori, PENDING) → 403', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');
      const otherCategoryAgreementId = await createSubmittedAgreement(
        planner,
        FU_NEW_WAVE,
        'E2E-G5-CM-OUT-OF-SCOPE-REJECT',
        '2026-01-07',
        '2026-01-17',
      );

      const res = await request(app.getHttpServer())
        .post(`/agreements/${otherCategoryAgreementId}/reject`)
        .set(cm.authHeader())
        .send({ reason: 'should be forbidden' });

      record({
        step: 'G5',
        role: 'CATEGORY_MANAGER',
        endpoint:
          'POST /agreements/:id/reject (FU-NEW-WAVE -> CAT-SEKILLENDIRICI, kapsam dışı)',
        expected: 403,
        actual: res.status,
        note: 'T-028e FIX: reject() de approve() ile aynı assertCmDecisionScope kontrolünden geçiyor.',
      });
      expect(res.status).toBe(403);

      // Temizlik: kendi kategorisindeki CM2 ile kapat.
      const cm2 = await loginAs(app, 'CATEGORY_MANAGER2');
      await request(app.getHttpServer())
        .post(`/agreements/${otherCategoryAgreementId}/reject`)
        .set(cm2.authHeader())
        .send({ reason: 'E2E G5 cleanup (kendi kategorisi)' });
    });

    it('G6. GET /agreements — CATEGORY_MANAGER sonuç sayısı < ADMIN sonuç sayısı (liste JOINli türetilmiş kategori filtresi)', async () => {
      // Kapsam dışı en az bir agreement'ın var olduğundan emin ol (G2/G2b/G4/G5
      // zaten üretti, ama bu test bağımsız çalışabilsin diye kendi de üretiyor).
      const planner = await loginAs(app, 'PLANNER');
      await createDraftAgreement(
        planner,
        FU_NEW_WAVE,
        'E2E-G6-LIST-OUT-OF-SCOPE',
        '2026-01-08',
        '2026-01-18',
      );

      const admin = await loginAs(app, 'ADMIN');
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const [adminRes, cmRes] = await Promise.all([
        request(app.getHttpServer())
          .get('/agreements')
          .set(admin.authHeader())
          .expect(200),
        request(app.getHttpServer())
          .get('/agreements')
          .set(cm.authHeader())
          .expect(200),
      ]);

      record({
        step: 'G6',
        role: 'CATEGORY_MANAGER vs ADMIN',
        endpoint: 'GET /agreements',
        expected: 'CM sayısı < ADMIN sayısı',
        actual: `CM=${cmRes.body.length}, ADMIN=${adminRes.body.length}`,
        note: 'T-028e FIX: AgreementRepository#findAll artık LEFT JOIN forecasting_units+generic_units ile türetilmiş kategoriyi filtreliyor (N+1 yok, tek sorgu).',
      });
      expect(cmRes.body.length).toBeLessThan(adminRes.body.length);
    });

    afterAll(async () => {
      // Yalnızca DRAFT kalanlar silinebilir (agreement DELETE endpoint'i
      // DRAFT'ı destekler); PENDING/APPROVED/REJECTED kalıcıdır (BRD).
      const admin = await loginAs(app, 'ADMIN');
      for (const id of scratchAgreementIds) {
        try {
          const res = await request(app.getHttpServer())
            .get(`/agreements/${id}`)
            .set(admin.authHeader());
          if (res.status === 200 && res.body?.status === 'DRAFT') {
            await request(app.getHttpServer())
              .delete(`/agreements/${id}`)
              .set(admin.authHeader())
              .send({ version: res.body.version });
          }
        } catch {
          // best-effort cleanup
        }
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // F) PLANNER CPL/CATEGORY SCOPE ENFORCEMENT (T-028c) — docs/analysis/0004 §9
  // ══════════════════════════════════════════════════════════════════════
  //
  // ⚠️ TUZAK (görev talimatı): CPL_1 (BS0501.50001, Gratis) VE CPL_2
  // (BS0501.50004, A.S.Watson) ikisi de Ulusal->NKA kanalı, yani ikisi de
  // planner@wella.com'un kapsamındadır (user-scope.seed.ts: NKA CPL'leri).
  // "Yetkisiz CPL" testleri için CPL_2 KULLANILAMAZ — yanlış yeşil verir.
  // Bunun yerine bir DİSTRİBÜTÖR CPL'i kullanılır (BS0502.50002 —
  // planner2@wella.com'un kapsamında, planner@wella.com'un DEĞİL).
  //
  // Bu describe bloğu SCOPE_ENFORCEMENT_ON'a göre dallanır — dosyanın hem
  // flag KAPALI hem flag AÇIK koşumlarında da yeşil kalması gerekir (T-028c
  // görev talimatı: iki koşum da raporlanacak).

  describe('F) PLANNER CPL/Category scope enforcement (T-028c)', () => {
    let DISTRIBUTOR_CPL_ID: string; // BS0502.50002 — planner2 kapsamında
    let DISTRIBUTOR_CHANNEL_ID: string; // code DISTRIBUTOR
    const scratchPlanIds: string[] = [];
    const scratchAgreementIds: string[] = [];

    beforeAll(async () => {
      [DISTRIBUTOR_CPL_ID, DISTRIBUTOR_CHANNEL_ID] = await Promise.all([
        resolveIdByCode(dataSource, fixture.tenantId, 'cpls', 'BS0502.50002'),
        resolveIdByCode(
          dataSource,
          fixture.tenantId,
          'channels',
          'DISTRIBUTOR',
        ),
      ]);
    });

    afterAll(async () => {
      const admin = await loginAs(app, 'ADMIN');
      for (const id of scratchPlanIds) {
        try {
          const res = await request(app.getHttpServer())
            .get(`/plans/${id}`)
            .set(admin.authHeader());
          if (res.status === 200 && res.body?.status === 'DRAFT') {
            await request(app.getHttpServer())
              .delete(`/plans/${id}`)
              .set(admin.authHeader())
              .send({ version: res.body.version });
          }
        } catch {
          // best-effort cleanup
        }
      }
      // Agreements: DELETE endpoint yok — DRAFT'ları test verisi olarak
      // bırakıyoruz (dosya başlığı izolasyon notuyla tutarlı, "E2E-N" öneki).
      void scratchAgreementIds;
    });

    it('N6. PLANNER → yetkisiz CPL (Distribütör, planner’ın DEĞİL) ile POST /plans', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-N6-PLANNER-OUT-OF-SCOPE-${Date.now()}`,
          cplId: DISTRIBUTOR_CPL_ID,
          channelId: DISTRIBUTOR_CHANNEL_ID,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });

      record({
        step: 'N6',
        role: 'PLANNER',
        endpoint: 'POST /plans (Distribütör CPL — planner kapsamı DIŞI)',
        expected: SCOPE_ENFORCEMENT_ON
          ? '403 (T-028c enforcement AÇIK)'
          : '201 (SCOPE_ENFORCEMENT_ENABLED=false, bugünkü davranış — bkz. B2)',
        actual: res.status,
        note: 'docs/analysis/0004 §9 N6 — PlanService.create() artık AccessScopeService.assertEntityInScope ile PLANNER cpl+category pair scope’unu kontrol ediyor (flag AÇIKKEN).',
      });

      if (SCOPE_ENFORCEMENT_ON) {
        expect(res.status).toBe(403);
      } else {
        expect(res.status).toBe(201);
        if (res.status === 201) {
          scratchPlanIds.push(res.body.id);
        }
      }
    });

    it('N6-POZİTİF. PLANNER → kendi NKA CPL’inde POST /plans → 201 (golden path bozulmadı)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-N6-POS-PLANNER-IN-SCOPE-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });

      record({
        step: 'N6-POZİTİF',
        role: 'PLANNER',
        endpoint: 'POST /plans (kendi NKA CPL kapsamı)',
        expected: 201,
        actual: res.status,
        note: 'Enforcement açık ya da kapalı fark etmeksizin, kendi scope’undaki CPL için PLANNER her zaman 201 almalı (regresyon koruması).',
      });

      expect(res.status).toBe(201);
      if (res.status === 201) {
        scratchPlanIds.push(res.body.id);
      }
    });

    it('N7. GET /plans PLANNER sonuç sayısı < ADMIN (Distribütör kanalında ADMIN’in oluşturduğu ekstra plan planner’a görünmez)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const planner = await loginAs(app, 'PLANNER');

      const extraRes = await request(app.getHttpServer())
        .post('/plans')
        .set(admin.authHeader())
        .send({
          planName: `E2E-N7-ADMIN-DISTRIBUTOR-${Date.now()}`,
          cplId: DISTRIBUTOR_CPL_ID,
          channelId: DISTRIBUTOR_CHANNEL_ID,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      scratchPlanIds.push(extraRes.body.id);

      const plannerRes = await request(app.getHttpServer())
        .get('/plans')
        .set(planner.authHeader())
        .expect(200);
      const adminRes = await request(app.getHttpServer())
        .get('/plans')
        .set(admin.authHeader())
        .expect(200);

      const plannerSeesExtra = (plannerRes.body as any[]).some(
        (p) => p.id === extraRes.body.id,
      );
      const adminSeesExtra = (adminRes.body as any[]).some(
        (p) => p.id === extraRes.body.id,
      );

      record({
        step: 'N7',
        role: 'PLANNER vs ADMIN',
        endpoint: 'GET /plans (deterministik: ADMIN’in Distribütör planı)',
        expected: SCOPE_ENFORCEMENT_ON
          ? 'PLANNER extra planı GÖRMEZ, ADMIN görür → PLANNER < ADMIN'
          : 'PLANNER de görür (flag kapalı, tenant-wide)',
        actual: `plannerSeesExtra=${plannerSeesExtra}, adminSeesExtra=${adminSeesExtra}, PLANNER=${plannerRes.body.length}, ADMIN=${adminRes.body.length}`,
        note: 'docs/analysis/0004 §9 N7 — PlanRepository#findAll artık AccessScopeService.applyToQueryBuilder ile PLANNER cpl+category pair scope’una göre filtreleniyor (flag AÇIKKEN).',
      });

      expect(adminSeesExtra).toBe(true);
      if (SCOPE_ENFORCEMENT_ON) {
        expect(plannerSeesExtra).toBe(false);
        expect(plannerRes.body.length).toBeLessThan(adminRes.body.length);
      } else {
        expect(plannerSeesExtra).toBe(true);
      }
    });

    it('N8. PLANNER → planner2’nin (Distribütör CPL) planını GET /plans/:id → 404 (varlık sızdırma yok)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planner2 = await loginAs(app, 'PLANNER2');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner2.authHeader())
        .send({
          planName: `E2E-N8-PLANNER2-DISTRIBUTOR-${Date.now()}`,
          cplId: DISTRIBUTOR_CPL_ID,
          channelId: DISTRIBUTOR_CHANNEL_ID,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      scratchPlanIds.push(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}`)
        .set(planner.authHeader());

      record({
        step: 'N8',
        role: 'PLANNER',
        endpoint: 'GET /plans/:id (planner2’nin Distribütör planı)',
        expected: SCOPE_ENFORCEMENT_ON ? 404 : 200,
        actual: res.status,
        note: SCOPE_ENFORCEMENT_ON
          ? "docs/analysis/0004 §9 N8 — PlanService.findById() out-of-scope -> 404, body.code='OUT_OF_SCOPE' (varlık sızdırma yok)."
          : 'Flag kapalı: PLANNER hâlâ tenant-wide okuyor (bugünkü davranış).',
      });

      if (SCOPE_ENFORCEMENT_ON) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('OUT_OF_SCOPE');
      } else {
        expect(res.status).toBe(200);
      }
    });

    it('N8-RECALC. PLANNER → planner2’nin (Distribütör CPL) planında POST /:id/recalculate → 404 (varlık/scope kaçağı yok)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planner2 = await loginAs(app, 'PLANNER2');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner2.authHeader())
        .send({
          planName: `E2E-N8-RECALC-PLANNER2-DISTRIBUTOR-${Date.now()}`,
          cplId: DISTRIBUTOR_CPL_ID,
          channelId: DISTRIBUTOR_CHANNEL_ID,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      scratchPlanIds.push(createRes.body.id);

      const res = await request(app.getHttpServer())
        .post(`/plans/${createRes.body.id}/recalculate`)
        .set(planner.authHeader());

      record({
        step: 'N8-RECALC',
        role: 'PLANNER',
        endpoint:
          'POST /plans/:id/recalculate (planner2’nin Distribütör planı)',
        expected: SCOPE_ENFORCEMENT_ON ? 404 : 200,
        actual: res.status,
        note: SCOPE_ENFORCEMENT_ON
          ? 'T-028c BLOCKER FIX — PlanController#recalculate artık @CurrentUser() actor’ını PlanService.recalculatePlanWithKpiEngine/findById’a geçiriyor; out-of-scope PLANNER artık planı yazdıramıyor/içeriğini göremiyor (önceden actor’suzdu → 200 ile tam plan sızıyordu).'
          : 'Flag kapalı: PLANNER hâlâ tenant-wide yazabiliyor (bugünkü davranış).',
      });

      if (SCOPE_ENFORCEMENT_ON) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('OUT_OF_SCOPE');
      } else {
        expect(res.status).toBe(200);
      }
    });

    it('N8-CALCKPIS. PLANNER → planner2’nin (Distribütör CPL) planında POST /:id/calculate-kpis → 404 (varlık/scope kaçağı yok)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const planner2 = await loginAs(app, 'PLANNER2');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner2.authHeader())
        .send({
          planName: `E2E-N8-CALCKPIS-PLANNER2-DISTRIBUTOR-${Date.now()}`,
          cplId: DISTRIBUTOR_CPL_ID,
          channelId: DISTRIBUTOR_CHANNEL_ID,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      scratchPlanIds.push(createRes.body.id);

      const res = await request(app.getHttpServer())
        .post(`/plans/${createRes.body.id}/calculate-kpis`)
        .set(planner.authHeader());

      record({
        step: 'N8-CALCKPIS',
        role: 'PLANNER',
        endpoint:
          'POST /plans/:id/calculate-kpis (planner2’nin Distribütör planı)',
        expected: SCOPE_ENFORCEMENT_ON ? 404 : 200,
        actual: res.status,
        note: SCOPE_ENFORCEMENT_ON
          ? 'T-028c BLOCKER FIX — PlanController#calculateKpis artık @CurrentUser() actor’ını PlanService.calculateKpis’e geçiriyor; out-of-scope PLANNER artık kapsam dışı planın KPI sonuçlarını alamıyor.'
          : 'Flag kapalı: PLANNER hâlâ tenant-wide okuyabiliyor (bugünkü davranış).',
      });

      if (SCOPE_ENFORCEMENT_ON) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('OUT_OF_SCOPE');
      } else {
        expect(res.status).toBe(200);
      }
    });

    it('N8-POZİTİF. PLANNER → kendi NKA CPL planında POST /:id/recalculate ve /:id/calculate-kpis → 200/201 (golden path bozulmadı)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-N8-POS-PLANNER-IN-SCOPE-${Date.now()}`,
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      scratchPlanIds.push(createRes.body.id);

      const recalcRes = await request(app.getHttpServer())
        .post(`/plans/${createRes.body.id}/recalculate`)
        .set(planner.authHeader());

      const calcKpisRes = await request(app.getHttpServer())
        .post(`/plans/${createRes.body.id}/calculate-kpis`)
        .set(planner.authHeader());

      record({
        step: 'N8-POZİTİF',
        role: 'PLANNER',
        endpoint:
          'POST /plans/:id/recalculate ve /plans/:id/calculate-kpis (kendi NKA CPL kapsamı)',
        expected: '200/201 ikisi de',
        actual: `recalculate=${recalcRes.status}, calculate-kpis=${calcKpisRes.status}`,
        note: 'Enforcement açık ya da kapalı fark etmeksizin, kendi scope’undaki plan için PLANNER her zaman başarılı olmalı (regresyon koruması).',
      });

      expect([200, 201]).toContain(recalcRes.status);
      expect([200, 201]).toContain(calcKpisRes.status);
    });

    it('N9. Scope satırı OLMAYAN yeni bir PLANNER → GET /plans → [] (fail-closed, R-2)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-n9-scopeless-planner-${Date.now()}@wella.com`;
      const password = 'Collmind2026!';

      // T-241 (2026-08-19): `POST /users` artık PLANNER için scope'u ZORUNLU
      // kılıyor — kapsamsız bir PLANNER bu uçtan bir daha YARATILAMAZ (bu
      // testin ORİJİNAL kurulumu buydu, ve T-241'in kapattığı TAM OLARAK bu
      // delik). N9'un konusu ise `POST /users`'ın davranışı değil,
      // AccessScopeService'in R-2 fail-closed semantiği (scope satırı olmayan
      // bir PLANNER hiçbir şey görmemeli) — bu semantik T-241'in dokunmadığı
      // bir katmanda yaşıyor (K-2.6.10) ve gerçek bir DB'de hâlâ oluşabilir
      // (T-241 öncesi backfill edilmemiş kullanıcı, ileride bir toplu
      // import/migration senaryosu). Bu yüzden test kurulumu `POST /users`
      // yerine DOĞRUDAN repository insert'e geçirildi — ölçtüğü şey
      // (fail-closed) DEĞİŞMEDİ, yalnız önkoşulu KURMA YOLU değişti.
      const dataSourceForInsert = app.get<DataSource>(getDataSourceToken());
      const passwordHash = await bcrypt.hash(password, 10);
      const scopelessUser = await dataSourceForInsert.getRepository(User).save(
        dataSourceForInsert.getRepository(User).create({
          tenantId: fixture.tenantId,
          email,
          passwordHash,
          fullName:
            'E2E N9 Scopeless Planner (direct-insert, bkz. T-241 yorumu)',
          role: UserRole.PLANNER,
          status: UserStatus.ACTIVE,
        }),
      );
      const createUserRes = { body: { id: scopelessUser.id } };

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      const authHeader = {
        Authorization: `Bearer ${loginRes.body.accessToken}`,
      };

      const res = await request(app.getHttpServer())
        .get('/plans')
        .set(authHeader);

      record({
        step: 'N9',
        role: 'PLANNER (scope satırı yok)',
        endpoint: 'GET /plans',
        expected: SCOPE_ENFORCEMENT_ON
          ? '[] (fail-closed, R-2)'
          : 'tenant-wide (flag kapalı)',
        actual: `status=${res.status}, count=${Array.isArray(res.body) ? res.body.length : 'n/a'}`,
        note: 'docs/analysis/0004 §7 R-2 — main.user_scopes satırı olmayan PLANNER hiçbir şey görmemeli (deny-by-default). Bu kullanıcı user-scope.seed.ts/backfill migration’ının VE (T-241’den beri) `POST /users`’ın KAPSAMI DIŞINDA — doğrudan repository insert ile kuruldu (T-241 artık `POST /users`’tan kapsamsız PLANNER yaratılmasını 400 ile engelliyor; bu test AccessScopeService’in R-2 semantiğini sınıyor, oluşturma ucunu değil).',
      });

      expect(res.status).toBe(200);
      if (SCOPE_ENFORCEMENT_ON) {
        expect(res.body).toEqual([]);
      } else {
        expect(res.body.length).toBeGreaterThan(0);
      }

      // T-060: hard-delete afterAll'da cleanupTestUsers ile yapılır (DELETE
      // /users endpoint'i yok, satır DB'de kalıcı birikiyordu — ölçüm:
      // main.users'ın %97'si, 289 satır, bu tek testten). Deactivate burada
      // best-effort defense-in-depth olarak kalır: suite afterAll'a hiç
      // ulaşmadan çökerse (örn. beforeAll/diğer bir test throw ederse) bu
      // kullanıcı en azından aktif kalmaz.
      scratchUserIds.push(createUserRes.body.id);
      try {
        await request(app.getHttpServer())
          .post(`/users/${createUserRes.body.id}/deactivate`)
          .set(admin.authHeader());
      } catch {
        // best-effort cleanup
      }
    });

    it('N13. Cross-tenant izolasyon (proxy) — PLANNER’ın gördüğü TÜM planlar kendi tenant’ına ait', async () => {
      // Bu ortamda tek tenant seed edilmiştir (dashboard.e2e-spec.ts'teki
      // aynı sınırlama) — gerçek 2-tenant fixture yok. AccessScopeService'in
      // tenantId zorunluluğu ve cache-anahtarı ayrımı zaten birim testlerle
      // kanıtlı (access-scope.service.spec.ts "tenant isolation"). Burada
      // dolaylı kanıt: PLANNER'a dönen HER planın tenantId'si fixture
      // tenant'ı ile birebir aynı olmalı (tenantId sızıntısı yok).
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .get('/plans')
        .set(planner.authHeader())
        .expect(200);

      const foreignTenantRows = (res.body as any[]).filter(
        (p) => p.tenantId && p.tenantId !== fixture.tenantId,
      );

      record({
        step: 'N13',
        role: 'PLANNER',
        endpoint: 'GET /plans (proxy: tenantId tutarlılığı)',
        expected: '0 (yabancı tenant satırı yok)',
        actual: foreignTenantRows.length,
        note: 'Gerçek çok-tenant e2e fixture yok (bkz. dashboard.e2e-spec.ts aynı not) — asıl kanıt access-scope.service.spec.ts "tenant isolation" birim testlerinde (WHERE tenantId hiç atlanmıyor, farklı tenant için scope cache paylaşılmıyor).',
      });

      expect(foreignTenantRows.length).toBe(0);
    });

    it('AGREEMENT-POZİTİF. PLANNER → kendi NKA CPL’inde POST /agreements → 201', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post('/agreements')
        .set(planner.authHeader())
        .send({
          agreementName: `E2E-N-AGR-POS-${Date.now()}`,
          agreementType: 'STA',
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          capTotalAmount: 5000,
          spendType: 'OFF_INVOICE',
          startDate: '2026-03-05',
          endDate: '2026-03-20',
          justification: 'E2E N-AGR-POS — PLANNER kendi CPL scope’u',
        });

      record({
        step: 'AGREEMENT-POZİTİF',
        role: 'PLANNER',
        endpoint: 'POST /agreements (kendi NKA CPL)',
        expected: 201,
        actual: res.status,
        note: 'Enforcement açık ya da kapalı fark etmeksizin, kendi scope’undaki CPL için PLANNER her zaman 201 almalı (regresyon koruması).',
      });

      expect(res.status).toBe(201);
      if (res.status === 201) {
        scratchAgreementIds.push(res.body.id);
      }
    });

    it('AGREEMENT-NEGATİF. PLANNER → yetkisiz CPL (Distribütör) ile POST /agreements', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post('/agreements')
        .set(planner.authHeader())
        .send({
          agreementName: `E2E-N-AGR-NEG-${Date.now()}`,
          agreementType: 'STA',
          cplId: DISTRIBUTOR_CPL_ID,
          channelId: DISTRIBUTOR_CHANNEL_ID,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          capTotalAmount: 5000,
          spendType: 'OFF_INVOICE',
          startDate: '2026-03-05',
          endDate: '2026-03-20',
          justification: 'E2E N-AGR-NEG — planner kapsamı DIŞI CPL',
        });

      record({
        step: 'AGREEMENT-NEGATİF',
        role: 'PLANNER',
        endpoint: 'POST /agreements (Distribütör CPL — kapsam dışı)',
        expected: SCOPE_ENFORCEMENT_ON ? 403 : 201,
        actual: res.status,
        note: 'AgreementService.create() artık AccessScopeService.assertEntityInScope ile PLANNER cpl(+category) pair scope’unu kontrol ediyor (flag AÇIKKEN) — plan.service.ts ile aynı desen.',
      });

      if (SCOPE_ENFORCEMENT_ON) {
        expect(res.status).toBe(403);
      } else {
        expect(res.status).toBe(201);
        if (res.status === 201) {
          scratchAgreementIds.push(res.body.id);
        }
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // C) ACTUALS-FIRST AKIŞI
  // ══════════════════════════════════════════════════════════════════════

  describe('C) Actuals-first akışı', () => {
    it('C1. PLANNER → POST /agreements (settlement testi için)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post('/agreements')
        .set(planner.authHeader())
        .send({
          agreementName: `E2E-ROLE-JOURNEY-SETTLE-${Date.now()}`,
          agreementType: 'STA',
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          capTotalAmount: 20000,
          spendType: 'OFF_INVOICE',
          startDate: '2026-02-05',
          endDate: '2026-02-20',
          justification: 'E2E role-journey — settlement close testi',
        });

      record({
        step: 'C1',
        role: 'PLANNER',
        endpoint: 'POST /agreements',
        expected: 201,
        actual: res.status,
        note:
          res.status === 201
            ? `agreementId=${res.body.id}, status=${res.body.status}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(201);
      agreementSettlementId = res.body.id;
    });

    it('C2. PLANNER → POST /agreements/:id/submit', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post(`/agreements/${agreementSettlementId}/submit`)
        .set(planner.authHeader())
        .send({});

      record({
        step: 'C2',
        role: 'PLANNER',
        endpoint: 'POST /agreements/:id/submit',
        expected: 200,
        actual: res.status,
        note:
          res.status === 200
            ? `status=${res.body.status}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
    });

    it('C3. FINANCE_MANAGER → POST /agreements/:id/approve (hangi rol çalışıyor?)', async () => {
      // T-028e NOT: bu adım daha önce 'MANAGER' (=CATEGORY_MANAGER alias,
      // manager@wella.com) kullanıyordu ve FU_WELLA_HC_500ML -> HAIR_CARE
      // kategorisi manager@wella.com'un scope'unda (CAT-SAC-BOYASI/CAT-SET-BOYA)
      // OLMADIĞI için AgreementService#assertCmDecisionScope artık haklı
      // olarak 403 döndürüyor (bu SORUN'un ta kendisiydi — CM önceden
      // kapsam dışı agreement'ları onaylayabiliyordu). Bu test agreement
      // approve akışının genel mekaniğini (settlement/reversal fixture'ı)
      // kanıtlamak içindi, CM kategori-scope'unu değil (bu artık E2 bloğunun
      // işi) — approve() route'u zaten @Roles(ADMIN, CATEGORY_MANAGER,
      // FINANCE_MANAGER) olduğundan, kapsam kısıtına tabi olmayan (BRD: FM
      // okuma+bütçe, kategori scope'una tabi değil) FINANCE_MANAGER kullanılır.
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      const res = await request(app.getHttpServer())
        .post(`/agreements/${agreementSettlementId}/approve`)
        .set(fm.authHeader())
        .send({});

      record({
        step: 'C3',
        role: 'FINANCE_MANAGER',
        endpoint: 'POST /agreements/:id/approve',
        expected: 200,
        actual: res.status,
        note:
          res.status === 200
            ? `status=${res.body.status}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('C3b. T-032: SUBMIT + APPROVE agreement lifecycle audit rows exist in admin_audit_logs (SQL kanıtı)', async () => {
      // BRD: "Audit immutable; ... onay/red dahil her işlem loglanır." Before
      // T-032, AgreementService made ZERO calls to AdminAuditService for
      // SUBMIT/APPROVE/REJECT/CANCEL — only settlement-close (CLOSE) and
      // reversal (REVERSE) wrote to admin_audit_logs for entity_type=AGREEMENT.
      const rows = await dataSource.query(
        `SELECT action_type, entity_type, result, is_high_risk
           FROM main.admin_audit_logs
          WHERE entity_type = 'AGREEMENT' AND entity_id = $1
          ORDER BY created_at ASC`,
        [agreementSettlementId],
      );
      record({
        step: 'C3b',
        role: '-',
        endpoint:
          'DB: main.admin_audit_logs (submit+approve sonrası, agreementSettlementId)',
        expected: '[SUBMIT, APPROVE] (APPROVE is_high_risk=true)',
        actual: JSON.stringify(rows),
        note: 'T-032 FIX: agreement.service.ts#submit/#approve artık AdminAuditService.logAdminAction çağırıyor — önceden bu iki endpoint hiçbir admin_audit_logs satırı üretmiyordu (CLOSE/REVERSE dışında).',
      });
      expect(rows.map((r: any) => r.action_type)).toEqual([
        'SUBMIT',
        'APPROVE',
      ]);
      expect(rows.every((r: any) => r.result === 'SUCCESS')).toBe(true);
      const approveRow = rows.find((r: any) => r.action_type === 'APPROVE');
      expect(approveRow.is_high_risk).toBe(true);
      const submitRow = rows.find((r: any) => r.action_type === 'SUBMIT');
      expect(submitRow.is_high_risk).toBe(false);
    });

    it('C4. ADMIN → POST /agreement-transactions (off-invoice)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post('/agreement-transactions')
        .set(admin.authHeader())
        .send({
          agreementId: agreementSettlementId,
          invoiceNo: `E2E-INV-JOURNEY-${Date.now()}`,
          invoiceDate: '2026-02-10',
          fiscalPeriod: '2026-02',
          amount: 5000,
          currency: 'TRY',
          notes: 'E2E role-journey transaction',
        });

      record({
        step: 'C4',
        role: 'ADMIN',
        endpoint: 'POST /agreement-transactions',
        expected: 201,
        actual: res.status,
        note:
          res.status === 201 ? `txId=${res.body.id}` : JSON.stringify(res.body),
      });

      expect(res.status).toBe(201);
    });

    it('C5. PLANNER → GET /ledger/agreement/:id/consumed — DEBIT oluştu mu', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get(`/ledger/agreement/${agreementSettlementId}/consumed`)
        .set(planner.authHeader());

      record({
        step: 'C5',
        role: 'PLANNER',
        endpoint: 'GET /ledger/agreement/:id/consumed',
        expected: 200,
        actual: res.status,
        note: JSON.stringify(res.body).slice(0, 150),
      });

      expect(res.status).toBe(200);
    });

    it('C6. CATEGORY_MANAGER → POST /actuals-first/settlements/close/:agreementId', async () => {
      const cm = await loginAs(app, 'CATEGORY_MANAGER');

      const res = await request(app.getHttpServer())
        .post(`/actuals-first/settlements/close/${agreementSettlementId}`)
        .set(cm.authHeader())
        .send({ justification: 'E2E role-journey settlement close' });

      record({
        step: 'C6',
        role: 'CATEGORY_MANAGER',
        endpoint: 'POST /actuals-first/settlements/close/:agreementId',
        expected: 201,
        actual: res.status,
        note:
          res.status === 201
            ? `status=${res.body.status}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CLOSED');
    });

    // ── Reversal için AYRI bir agreement (settlement CLOSED yaptığı için
    //    reversal APPROVED/ACTIVE state gerektirdiğinden aynısı kullanılamaz) ──

    it('C7. ADMIN → POST /agreements (reversal testi için, ayrı agreement)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      // T-028e NOT: 'MANAGER' (=CATEGORY_MANAGER, manager@wella.com) FU_WELLA_HC_500ML
      // -> HAIR_CARE kategorisinde scope'u olmadığından artık 403 alır (bkz. C3 notu).
      // Bu adımın amacı self-approval guard'ını (submit eden ADMIN approve edemez)
      // aşacak, kategori scope'una tabi OLMAYAN ikinci bir onaylayıcı — FINANCE_MANAGER.
      const financeApprover = await loginAs(app, 'FINANCE_MANAGER');

      const res = await request(app.getHttpServer())
        .post('/agreements')
        .set(admin.authHeader())
        .send({
          agreementName: `E2E-ROLE-JOURNEY-REVERSAL-${Date.now()}`,
          agreementType: 'STA',
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          capTotalAmount: 20000,
          spendType: 'OFF_INVOICE',
          startDate: '2026-02-05',
          endDate: '2026-02-20',
          justification: 'E2E role-journey — reversal testi',
        })
        .expect(201);

      agreementReversalId = res.body.id;

      await request(app.getHttpServer())
        .post(`/agreements/${agreementReversalId}/submit`)
        .set(admin.authHeader())
        .expect(200);

      // T-257: genel `/approvals/:id/approve` ucu (K-2.5.11'in generik pini
      // orada duruyordu) KALDIRILDI. `agreement.service.ts`'in — plan.service.ts
      // ve approval-workflow.service.ts'in aksine — KENDİ self-approval guard'ı
      // YOK; koruma tamamen ApprovalService.approve()'un paylaşılan kontrolüne
      // dayanıyor (approval.service.ts:114, "You cannot approve your own
      // request"). Bu yüzden pin BURAYA (agreement domain akışına) taşındı —
      // önceden yalnız bir yorumdu, şimdi gerçek bir assertion.
      const selfApproveRes = await request(app.getHttpServer())
        .post(`/agreements/${agreementReversalId}/approve`)
        .set(admin.authHeader())
        .send({ comments: 'self-approval attempt (T-257 pin)' });

      expect(selfApproveRes.status).toBe(403);
      expect(selfApproveRes.body.message).toMatch(/own request/i);

      // Ve durum değişmedi: transaction (budget RESERVE + approval decision)
      // bütünüyle geri alındı, agreement hâlâ PENDING.
      const stillPending = await request(app.getHttpServer())
        .get(`/agreements/${agreementReversalId}`)
        .set(admin.authHeader())
        .expect(200);
      expect(stillPending.body.status).toBe('PENDING');

      // Onaylayan FINANCE_MANAGER kullanılır (T-028e: CATEGORY_MANAGER artık
      // kategori-scope'una tabi, bu senaryo için uygun değil).
      const approveRes = await request(app.getHttpServer())
        .post(`/agreements/${agreementReversalId}/approve`)
        .set(financeApprover.authHeader())
        .expect(200);

      record({
        step: 'C7',
        role: 'ADMIN (create/submit) + FINANCE_MANAGER (approve)',
        endpoint: 'POST /agreements + submit + approve (reversal fixture)',
        expected: 'APPROVED',
        actual: approveRes.body.status,
        note: `agreementId=${agreementReversalId} — self-approval GERÇEKTEN sınandı (403, approval.service.ts:114), sonra approve farklı rol ile yapıldı`,
      });
    });

    it('C8. ADMIN → POST /agreement-transactions (reversal edilecek tx)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post('/agreement-transactions')
        .set(admin.authHeader())
        .send({
          agreementId: agreementReversalId,
          invoiceNo: `E2E-INV-REV-${Date.now()}`,
          invoiceDate: '2026-02-12',
          fiscalPeriod: '2026-02',
          amount: 3000,
          currency: 'TRY',
          notes: 'E2E role-journey reversal tx',
        })
        .expect(201);

      reversalTransactionId = res.body.id;

      record({
        step: 'C8',
        role: 'ADMIN',
        endpoint: 'POST /agreement-transactions (reversal fixture)',
        expected: 201,
        actual: res.status,
        note: `txId=${reversalTransactionId}`,
      });
    });

    it('C9. ADMIN → POST /actuals-first/reversals/agreement-transaction/:txId — ledger CREDIT + bütçe geri döndü mü', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const before = await request(app.getHttpServer())
        .get(`/ledger/agreement/${agreementReversalId}/consumed`)
        .set(admin.authHeader())
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(
          `/actuals-first/reversals/agreement-transaction/${reversalTransactionId}`,
        )
        .set(admin.authHeader())
        .send({ justification: 'E2E role-journey reversal' });

      const after = await request(app.getHttpServer())
        .get(`/ledger/agreement/${agreementReversalId}/consumed`)
        .set(admin.authHeader())
        .expect(200);

      record({
        step: 'C9',
        role: 'ADMIN',
        endpoint: 'POST /actuals-first/reversals/agreement-transaction/:txId',
        expected: 200,
        actual: res.status,
        note: `consumed(önce)=${JSON.stringify(before.body)}, consumed(sonra)=${JSON.stringify(after.body)}, reversedAmount=${res.body.reversedAmount}`,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REVERSED');
    });

    it('C9b. T-032: REJECT agreement lifecycle audit row exists in admin_audit_logs (SQL kanıtı)', async () => {
      const fm = await loginAs(app, 'FINANCE_MANAGER');
      // T-257 pin için: self-rejection denemesinin RolesGuard'a değil
      // ApprovalService'in kontrolüne çarpması gerekiyor — bu yüzden
      // submitter, `/agreements/:id/reject`'e de erişimi olan ADMIN
      // (PLANNER reject uçuna hiç giremez: @Roles(ADMIN, CATEGORY_MANAGER,
      // FINANCE), agreement.controller.ts:219).
      const admin = await loginAs(app, 'ADMIN');

      const createRes = await request(app.getHttpServer())
        .post('/agreements')
        .set(admin.authHeader())
        .send({
          agreementName: `E2E-ROLE-JOURNEY-T032-REJECT-${Date.now()}`,
          agreementType: 'STA',
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          capTotalAmount: 15000,
          spendType: 'OFF_INVOICE',
          startDate: '2026-02-05',
          endDate: '2026-02-20',
          justification: 'E2E role-journey — T-032 reject audit testi',
        })
        .expect(201);
      const rejectAgreementId: string = createRes.body.id;

      await request(app.getHttpServer())
        .post(`/agreements/${rejectAgreementId}/submit`)
        .set(admin.authHeader())
        .send({})
        .expect(200);

      // T-257: `agreement.service.ts#reject`'in — plan.service.ts'in aksine —
      // KENDİ self-rejection guard'ı YOK; koruma tamamen
      // ApprovalService.reject()'in paylaşılan kontrolüne dayanıyor
      // (approval.service.ts:179, "You cannot reject your own request").
      // Genel `/approvals/:id/reject` ucu kaldırıldığı için bu pin BURAYA
      // (agreement domain akışına) taşındı. `planner` KULLANILMADI (reject
      // uçuna erişimi yok — RBAC 403'ü self-rejection 403'ü ile karıştırırdı).
      const selfRejectRes = await request(app.getHttpServer())
        .post(`/agreements/${rejectAgreementId}/reject`)
        .set(admin.authHeader())
        .send({ reason: 'self-rejection attempt (T-257 pin)' });
      expect(selfRejectRes.status).toBe(403);
      expect(selfRejectRes.body.message).toMatch(/own request/i);

      const rejectRes = await request(app.getHttpServer())
        .post(`/agreements/${rejectAgreementId}/reject`)
        .set(fm.authHeader())
        .send({ reason: 'E2E T-032 reject audit test' })
        .expect(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      const rows = await dataSource.query(
        `SELECT action_type, result, is_high_risk, justification
           FROM main.admin_audit_logs
          WHERE entity_type = 'AGREEMENT' AND entity_id = $1
          ORDER BY created_at ASC`,
        [rejectAgreementId],
      );
      record({
        step: 'C9b',
        role: '-',
        endpoint: 'DB: main.admin_audit_logs (submit+reject sonrası)',
        expected:
          '[SUBMIT, REJECT] (REJECT is_high_risk=false — tartışmalı, gerekçe: reject genelde bütçe rezervi henüz yokken olur)',
        actual: JSON.stringify(rows),
        note: 'T-032 FIX: agreement.service.ts#reject artık AdminAuditService.logAdminAction çağırıyor — önceden POST /agreements/:id/reject hiçbir admin_audit_logs satırı üretmiyordu.',
      });
      expect(rows.map((r: any) => r.action_type)).toEqual(['SUBMIT', 'REJECT']);
      const rejectRow = rows.find((r: any) => r.action_type === 'REJECT');
      expect(rejectRow.result).toBe('SUCCESS');
      expect(rejectRow.is_high_risk).toBe(false);
      expect(rejectRow.justification).toBe('E2E T-032 reject audit test');
    });

    it('C9c. T-032: CANCEL agreement lifecycle audit row exists in admin_audit_logs (SQL kanıtı)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      const createRes = await request(app.getHttpServer())
        .post('/agreements')
        .set(planner.authHeader())
        .send({
          agreementName: `E2E-ROLE-JOURNEY-T032-CANCEL-${Date.now()}`,
          agreementType: 'STA',
          cplId: CPL_1,
          channelId: CHANNEL_NKA,
          fuId: FU_WELLA_HC_500ML,
          tacticId: TACTIC_PROMO,
          mechanicId: MECHANIC_DISCOUNT,
          skuScope: 'FU',
          capTotalAmount: 12000,
          spendType: 'OFF_INVOICE',
          startDate: '2026-02-05',
          endDate: '2026-02-20',
          justification: 'E2E role-journey — T-032 cancel audit testi',
        })
        .expect(201);
      const cancelAgreementId: string = createRes.body.id;

      await request(app.getHttpServer())
        .post(`/agreements/${cancelAgreementId}/submit`)
        .set(planner.authHeader())
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .post(`/agreements/${cancelAgreementId}/approve`)
        .set(fm.authHeader())
        .send({})
        .expect(200);

      // BRD "her işlem loglanır" — cancel budget'ı release ettiği için
      // (T-030, releaseAgreementReservation) bu testin sonunda zarf tekrar
      // boşalır; dev DB'yi kirletmez (cleanupTestPlans'daki mantıkla aynı
      // ilke — bkz. görev tanımı).
      const cancelRes = await request(app.getHttpServer())
        .post(`/agreements/${cancelAgreementId}/cancel`)
        .set(planner.authHeader())
        .send({ reason: 'E2E T-032 cancel audit test' })
        .expect(200);
      expect(cancelRes.body.status).toBe('CANCELLED');

      const rows = await dataSource.query(
        `SELECT action_type, result, is_high_risk, justification
           FROM main.admin_audit_logs
          WHERE entity_type = 'AGREEMENT' AND entity_id = $1
          ORDER BY created_at ASC`,
        [cancelAgreementId],
      );
      record({
        step: 'C9c',
        role: '-',
        endpoint: 'DB: main.admin_audit_logs (submit+approve+cancel sonrası)',
        expected: '[SUBMIT, APPROVE, CANCEL] (CANCEL is_high_risk=true)',
        actual: JSON.stringify(rows),
        note: 'T-032 FIX: agreement.service.ts#cancel artık AdminAuditService.logAdminAction çağırıyor — önceden POST /agreements/:id/cancel hiçbir admin_audit_logs satırı üretmiyordu.',
      });
      expect(rows.map((r: any) => r.action_type)).toEqual([
        'SUBMIT',
        'APPROVE',
        'CANCEL',
      ]);
      const cancelRow = rows.find((r: any) => r.action_type === 'CANCEL');
      expect(cancelRow.result).toBe('SUCCESS');
      expect(cancelRow.is_high_risk).toBe(true);
      expect(cancelRow.justification).toBe('E2E T-032 cancel audit test');

      const releaseTx = await dataSource.query(
        `SELECT tx_type FROM main.budget_transactions
          WHERE source_type = 'AGREEMENT' AND source_id = $1 AND tx_type = 'RELEASE'`,
        [cancelAgreementId],
      );
      expect(releaseTx.length).toBeGreaterThan(0);
    });

    it('C10. FINANCE → POST /actuals-first/sales-actuals/upload (2027-01 test CSV)', async () => {
      const finance = await loginAs(app, 'FINANCE');
      const cplRows = await dataSource.query(
        `SELECT code FROM main.cpls WHERE id = $1`,
        [CPL_1],
      );
      const cplCode = cplRows[0].code;
      const nonce = Date.now() % 100000;

      const csvContent = Buffer.from(
        [
          'cpl_code,category,channel_code,gross_amount,net_amount,discount_amount',
          `${cplCode},Saç Boyası,NKA,${100000 + nonce},95000,5000`,
        ].join('\n'),
        'utf-8',
      );

      const res = await request(app.getHttpServer())
        .post('/actuals-first/sales-actuals/upload?fiscalPeriod=2027-01')
        .set(finance.authHeader())
        .attach('file', csvContent, 'e2e_role_journey_actuals.csv');

      record({
        step: 'C10',
        role: 'FINANCE',
        endpoint: 'POST /actuals-first/sales-actuals/upload',
        expected: 201,
        actual: res.status,
        note:
          res.status === 201
            ? `totalRows=${res.body.totalRows}, validRows=${res.body.validRows}, batches=${res.body.batches?.length}`
            : JSON.stringify(res.body),
      });

      expect(res.status).toBe(201);
      expect(res.body.validRows).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // D) DASHBOARD/RAPOR ROL GÖRÜNÜRLÜĞÜ
  // ══════════════════════════════════════════════════════════════════════

  describe('D) Dashboard rol görünürlüğü', () => {
    const roles = [
      'PLANNER',
      'CATEGORY_MANAGER',
      'FINANCE_MANAGER',
      'READONLY',
    ] as const;
    const endpoints = [
      { path: '/dashboard/summary', step: 'D-summary' },
      { path: '/dashboard/pending-tasks', step: 'D-pending' },
      { path: '/dashboard/cpl-status', step: 'D-cpl-status' },
    ];

    for (const role of roles) {
      for (const ep of endpoints) {
        it(`${role} → GET ${ep.path} → 200 mü, içerik role uygun mu`, async () => {
          const user = await loginAs(app, role);

          const res = await request(app.getHttpServer())
            .get(ep.path)
            .set(user.authHeader());

          record({
            step: `${ep.step}`,
            role,
            endpoint: `GET ${ep.path}`,
            expected: 200,
            actual: res.status,
            note: JSON.stringify(res.body).slice(0, 120),
          });

          expect(res.status).toBe(200);
        });
      }
    }

    it('D-scope. PLANNER summary → sonradan oluşturulan CPL_1 planı scope içinde mi (yeni approved plan var)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const admin = await loginAs(app, 'ADMIN');

      const plannerRes = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(planner.authHeader())
        .expect(200);
      const adminRes = await request(app.getHttpServer())
        .get('/dashboard/summary')
        .set(admin.authHeader())
        .expect(200);

      record({
        step: 'D-scope',
        role: 'PLANNER vs ADMIN',
        endpoint: 'GET /dashboard/summary',
        expected: 'PLANNER <= ADMIN (CPL scope)',
        actual: `PLANNER.activeAgreementCount=${plannerRes.body.activeAgreementCount}, ADMIN.activeAgreementCount=${adminRes.body.activeAgreementCount}`,
        note: 'Dashboard modülü UserScope tablosunu kullanıyor (dashboard.service.ts) — ancak B1 kanıtı user_scopes boş olduğundan, PLANNER burada da fiilen tenant-wide veri görüyor olabilir (scope fallback davranışı)',
      });

      expect(plannerRes.body.activeAgreementCount).toBeLessThanOrEqual(
        adminRes.body.activeAgreementCount,
      );
    });
  });
});
