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
 *     dev DB'de gürültü yaratmamak için testin sonunda mümkün olanlar temizlenir.
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
} from './helpers/seed-e2e';

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
let MECHANIC_DISCOUNT: string; // MEC-DISCOUNT

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

    it('A13. FINANCE_MANAGER → GET /finance-reporting/budget-utilization', async () => {
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      const res = await request(app.getHttpServer())
        .get('/finance-reporting/budget-utilization')
        .set(fm.authHeader());

      record({
        step: 'A13',
        role: 'FINANCE_MANAGER',
        endpoint: 'GET /finance-reporting/budget-utilization',
        expected: 200,
        actual: res.status,
        note: 'T-028a (F8) FIX: finance-reporting Roles listesi FINANCE (deprecated) yerine FINANCE_MANAGER içeriyor.',
      });

      // T-028a (F8) FIX: deprecated FINANCE alias'ı FINANCE_MANAGER'a
      // konsolide edildi → Finance Manager artık kendi raporunu okuyabiliyor.
      expect(res.status).toBe(200);
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
        expected: 200,
        actual: res.status,
        note: `items=${Array.isArray(res.body) ? res.body.length : JSON.stringify(res.body).slice(0, 100)}`,
      });

      // T-028a: migration 1791000000000-ConsolidateRolesToBrd, finance@wella.com
      // seed satırı da FINANCE → FINANCE_MANAGER'a taşındı (e-posta korunur) →
      // bu kullanıcı artık DB'de FINANCE_MANAGER rolüyle giriş yapıyor.
      expect(res.status).toBe(200);
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

      await request(app.getHttpServer())
        .patch(`/plans/${t029PlanId}/fus/${FU_WELLA_HC_500ML}/tactics`)
        .set(planner.authHeader())
        .send({ tactics: { CPP_ON_PCT: 10, VIS_LS: 2000 }, version: 1 })
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
        `SELECT tx_type, tx_status, amount FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY created_at ASC`,
        [t029PlanId],
      );
      record({
        step: 'A14b',
        role: '-',
        endpoint: 'DB: main.budget_transactions (submit sonrası)',
        expected: '1x RESERVE (POSTED)',
        actual: JSON.stringify(budgetTxAfterSubmit),
        note: 'T-029 FIX (SORUN 2): budget.service.ts#reserveForPlan artık RESERVE tipi üretiyor (önceden yanlışlıkla her zaman COMMIT üretiyordu → /reserved endpoint plan rezervasyonları için hep 0 dönüyordu).',
      });
      expect(budgetTxAfterSubmit.length).toBe(1);
      expect(budgetTxAfterSubmit[0].tx_type).toBe('RESERVE');
      expect(budgetTxAfterSubmit[0].tx_status).toBe('POSTED');

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
        `SELECT tx_type, tx_status, amount FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY created_at ASC`,
        [t029PlanId],
      );
      record({
        step: 'A14e',
        role: '-',
        endpoint: 'DB: main.budget_transactions (approve sonrası)',
        expected: 'RESERVE + RELEASE(convert) + COMMIT (aynı tutar)',
        actual: JSON.stringify(budgetTxAfterApprove),
        note: "T-029 FIX (SORUN 2): budget.service.ts#commitReservedForPlan, submit'teki RESERVE'i RELEASE ile netleyip COMMIT'e çeviriyor (BRD: Approved → COMMIT).",
      });
      const types = budgetTxAfterApprove.map((r: any) => r.tx_type);
      expect(types).toContain('RESERVE');
      expect(types).toContain('COMMIT');
      expect(
        types.filter((t: string) => t === 'RELEASE').length,
      ).toBeGreaterThanOrEqual(1);
      const reserveAmt = Number(
        budgetTxAfterApprove.find((r: any) => r.tx_type === 'RESERVE')?.amount,
      );
      const commitAmt = Number(
        budgetTxAfterApprove.find((r: any) => r.tx_type === 'COMMIT')?.amount,
      );
      expect(commitAmt).toBe(reserveAmt);

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
        `SELECT tx_type, tx_status, amount FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY created_at ASC`,
        [rejectPlanId],
      );
      record({
        step: 'A15b',
        role: '-',
        endpoint: 'DB: main.budget_transactions (reject sonrası)',
        expected: 'RESERVE + RELEASE (aynı tutar)',
        actual: JSON.stringify(budgetTxAfterReject),
        note: 'T-029 FIX (SORUN 2): PlanService.reject() artık budgetService.releaseForPlan() çağırıyor (BRD: Rejected → RELEASE) — önceden reject bütçeyi hiç serbest bırakmıyordu (bütçe sızıntısı).',
      });
      const reserveTx = budgetTxAfterReject.find(
        (r: any) => r.tx_type === 'RESERVE',
      );
      const releaseTx = budgetTxAfterReject.find(
        (r: any) => r.tx_type === 'RELEASE',
      );
      expect(reserveTx).toBeDefined();
      expect(releaseTx).toBeDefined();
      expect(Number(releaseTx.amount)).toBe(Number(reserveTx.amount));

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
      // agreement.controller.ts) — a malformed UUID reaches
      // `PlanRepository#findById`'s query builder as-is and Postgres
      // throws `invalid input syntax for type uuid`, uncaught -> 500. Not a
      // T-034b regression (the crash happens in the pre-transaction
      // `findById` call, unchanged by this task) and not worth a broad
      // `ParseUUIDPipe` rollout across every controller as a side quest
      // here — fixed at the actual fault: A16 no longer depends on any
      // other test's state. DRAFT is sufficient to prove "non-REJECTED".
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
        `SELECT tx_type, tx_status, amount FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY created_at ASC`,
        [fullLoopPlanId],
      );
      record({
        step: 'A16c',
        role: '-',
        endpoint: 'DB: main.budget_transactions (return-to-draft sonrası)',
        expected:
          'RESERVE + RELEASE ile aynı (return-to-draft bütçeye dokunmaz — yeni RESERVE yalnızca resubmit ile)',
        actual: JSON.stringify(budgetTxAfterReturn),
        note: 'T-033: BudgetService çağrılmıyor — reject() zaten RELEASE etmişti (T-029); işlem satır sayısı burada değişmemeli.',
      });
      expect(budgetTxAfterReturn.length).toBe(2); // RESERVE + RELEASE only

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
        `SELECT tx_type, tx_status, amount FROM main.budget_transactions WHERE source_type = 'PLAN' AND source_id = $1 ORDER BY created_at ASC`,
        [fullLoopPlanId],
      );
      record({
        step: 'A16e',
        role: '-',
        endpoint: 'DB: main.budget_transactions (tam döngü sonrası)',
        expected: 'RESERVE, RELEASE, RESERVE, RELEASE(convert), COMMIT',
        actual: JSON.stringify(finalBudgetTx),
        note: 'T-033: return-to-draft rezerv KURMADI (satır eklemedi) — yalnızca resubmit yeni bir RESERVE üretti; approve bunu COMMIT’e çevirdi (T-029 semantiği korunuyor).',
      });
      const finalTypes = finalBudgetTx.map((r: any) => r.tx_type);
      expect(finalTypes.filter((t: string) => t === 'RESERVE').length).toBe(2);
      expect(finalTypes.filter((t: string) => t === 'COMMIT').length).toBe(1);
      expect(
        finalTypes.filter((t: string) => t === 'RELEASE').length,
      ).toBeGreaterThanOrEqual(2);

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

      const createUserRes = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password,
          fullName: 'E2E N9 Scopeless Planner',
          role: 'PLANNER',
          status: 'ACTIVE',
        })
        .expect(201);

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
        note: 'docs/analysis/0004 §7 R-2 — main.user_scopes satırı olmayan PLANNER hiçbir şey görmemeli (deny-by-default). Bu kullanıcı user-scope.seed.ts/backfill migration’ının KAPSAMI DIŞINDA (POST /users ile şimdi oluşturuldu, geçmiş plan yok) — tam olarak T-028c task raporunun "planı olmayan Planner" uyarısının kanıtı.',
      });

      expect(res.status).toBe(200);
      if (SCOPE_ENFORCEMENT_ON) {
        expect(res.body).toEqual([]);
      } else {
        expect(res.body.length).toBeGreaterThan(0);
      }

      // Temizlik: test kullanıcısını deaktive et (silme endpoint'i yok / hard
      // delete istenmiyor — deactivate en yakın temiz kapama).
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

      // NOT: Aynı kullanıcı (ADMIN) hem submit hem approve ederse
      // ApprovalService "You cannot approve your own request" (403) döner —
      // bu BEKLENEN/DOĞRU bir self-approval segregation-of-duties davranışı
      // (approval.service.ts:104). Bu yüzden approve için FINANCE_MANAGER
      // kullanılır (T-028e: CATEGORY_MANAGER artık kategori-scope'una tabi).
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
        note: `agreementId=${agreementReversalId} — self-approval doğru şekilde 403 ile engelleniyor (approval.service.ts), bu yüzden approve farklı rol ile yapıldı`,
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
      const planner = await loginAs(app, 'PLANNER');
      const fm = await loginAs(app, 'FINANCE_MANAGER');

      const createRes = await request(app.getHttpServer())
        .post('/agreements')
        .set(planner.authHeader())
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
        .set(planner.authHeader())
        .send({})
        .expect(200);

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
