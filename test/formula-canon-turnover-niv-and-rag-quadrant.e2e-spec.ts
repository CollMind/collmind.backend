/**
 * formula-canon-turnover-niv-and-rag-quadrant.e2e-spec.ts
 *
 * SÖZLEŞME (`Z65 §1` · `Z66 §1-3` · `T-334`): **`TO` ve `NIV` İKİ AYRI
 * KAVRAMDIR**, ve promo-mekaniklerinin TABAN HİYERARŞİSİ Excel formül
 * sözlüğüne (`docs/research/DEMO_EXCEL_KPI_TACTIC_REFERANSI.md §1`) uyar:
 *
 * ```
 * NIV  = GSV − TotalSpendOn            (yalnız on-invoice düşer)
 * TO   = GSV − TotalSpend(on + off)    (hepsi düşer)
 * GP   = TO − COGS                     (Excel: BaseGrossProfit = BaseTurnover − BaseCOGS)
 *
 * on-invoice %-mekanik  tabanı = GSV − LTA_On
 * off-invoice %-mekanik tabanı = NIV                 ← `Q5` (LTA_Off DÜŞÜLMEZ)
 * LTA_Off               tabanı = PlannedPromoNIV     ← `Q8` (promo-on DÜŞÜLÜR)
 * ROI paydası           = INCR_PROMO_SPEND           ← `Q6` (yalnız promo, LTA hariç)
 * ```
 *
 * ── FIXTURE AYIRT-EDİCİLİĞİ (`DISIPLIN`: fark taşımak GEREKLİ, o farkı
 *    OKUYAN assertion olmadan YETERSİZ) ─────────────────────────────────
 * LTA `on=%7 / off=%2` **ve** promo `CPP_ON=%10 / CPP_OFF=%5` birlikte
 * kurulur. Dördü de **farklı** ⇒ dört tabanın karışması dört ayrı
 * assertion'ı düşürür. `LTA_Off > 0` **ve** `off-promo > 0` olmadan
 * `Q5`/`Q8` pinleri **KÖR** olurdu (`T-273` ailesi — `A1 §4.2 D-3`).
 *
 * ── `Q7` RAG İKİ-EKSEN KADRANI ───────────────────────────────────────
 * Excel: `Red: iTO ≤ 0` · `Amber: iTO > 0 ∧ iGP ≤ 0` · `Green: ikisi > 0`.
 * ⛔ **Canlı model TEK EKSENDİR** (`kpi-engine.determineRagStatus`, eşik
 * `GP_ROI_PCT >= 20 / >= 10`) — ölçüldü, ve `T-334` turunda **BİLEREK
 * DEĞİŞTİRİLMEDİ**: model değişimi ürün sahibi hükmü bekliyor
 * (`Z66 §2` ⇒ `eşleşen-sapmalı`). Bu dosya kadranın **dört hücresini**
 * fixture olarak kurar ve **bugünkü tek-eksen rengi ile kanonik kadran
 * rengini AYNI SATIRDA** ölçer; hüküm indiği gün değişecek tek şey
 * `expectedLiveRag` sütunudur.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  cleanupTestPlans,
  E2EFixture,
} from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

// ── Oranlar: DÖRDÜ DE FARKLI (ayırt-edicilik) ─────────────────────────
const LTA_ON_PCT = 7;
const LTA_OFF_PCT = 2;
const CPP_ON_PCT = 10;
const CPP_OFF_PCT = 5;

// `B` planı: kadranın DÖRDÜNCÜ hücresi (`iTO ≤ 0 ∧ iGP > 0`) yalnız
// "birim harcama oranı > birim marjı" olduğunda ULAŞILABİLİRDİR:
//   iGP = (price − cogs)·Δvol − Δspend,  iTO = price·Δvol − Δspend
//   Δvol < 0 iken iGP > 0  ⟺  Δspend < (price−cogs)·Δvol < 0
//   ⇒ spend-oranı (on + (1−on)·off) > marj-oranı (price−cogs)/price
// `7/2` ile 0.0886 < 0.40 ⇒ hücre ULAŞILAMAZ. `35/10` ile 0.415 > 0.40.
const LTA_B_ON_PCT = 35;
const LTA_B_OFF_PCT = 10;

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * KANON — Excel `§1` formül sözlüğünün BAĞIMSIZ bir uygulaması.
 * ⛔ Üretim kodundan hiçbir şey çağırmaz (`§2.7-8`: bir kontrolü sınayan
 * test o kontrolün kopyasını çalıştırmamalı — burada kopya değil,
 * KAYNAK BELGENİN kendisi yeniden yazılıdır).
 */
function canon(p: {
  price: number;
  cogs: number;
  baseVol: number;
  planVol: number;
  ltaOnPct: number;
  ltaOffPct: number;
  cppOnPct: number;
  cppOffPct: number;
}) {
  const baseGsv = p.baseVol * p.price;
  const baseLtaOn = (baseGsv * p.ltaOnPct) / 100;
  const baseNiv = baseGsv - baseLtaOn; // tabanda promo YOK
  const baseLtaOff = (baseNiv * p.ltaOffPct) / 100;
  const baseSpend = baseLtaOn + baseLtaOff;
  const baseTo = baseGsv - baseSpend;
  const baseCogs = p.baseVol * p.cogs;
  const baseGp = baseTo - baseCogs;

  const planGsv = p.planVol * p.price;
  const planLtaOn = (planGsv * p.ltaOnPct) / 100;
  const promoOn = ((planGsv - planLtaOn) * p.cppOnPct) / 100; // taban: GSV − LTA_On
  const planNiv = planGsv - planLtaOn - promoOn; // = GSV − TotalSpendOn
  const planLtaOff = (planNiv * p.ltaOffPct) / 100; // `Q8`
  const promoOff = (planNiv * p.cppOffPct) / 100; // `Q5`
  const planOn = planLtaOn + promoOn;
  const planOff = planLtaOff + promoOff;
  const planSpend = planOn + planOff;
  const planTo = planGsv - planSpend;
  const planCogs = p.planVol * p.cogs;
  const planGp = planTo - planCogs;

  const incrPromoSpend = promoOn + promoOff; // `Q6` — LTA HARİÇ
  const incrGp = planGp - baseGp;

  return {
    baseGsv,
    baseLtaOn,
    baseLtaOff,
    baseNiv,
    baseSpend,
    baseTo,
    baseGp,
    planGsv,
    planLtaOn,
    planLtaOff,
    promoOn,
    promoOff,
    planNiv,
    planOn,
    planSpend,
    planTo,
    planGp,
    incrNiv: planNiv - baseNiv,
    incrTo: planTo - baseTo,
    incrGp,
    incrPromoSpend,
    gpRoiPct: incrPromoSpend === 0 ? null : (incrGp / incrPromoSpend) * 100,
    /** Excel `PlannedOPSOQuadrant` — İKİ EKSEN. */
    canonicalRag:
      planTo - baseTo <= 0 ? 'RED' : incrGp <= 0 ? 'AMBER' : 'GREEN',
  };
}

/** `1781` öncesi/sonrası SAPMALI taban — assertion'ın OKUDUĞU fark. */
function deviantPlannedLtaOff(
  planGsv: number,
  planLtaOn: number,
  ltaOffPct: number,
): number {
  return ((planGsv - planLtaOn) * ltaOffPct) / 100; // promo-on DÜŞÜLMEMİŞ (`Q8` sapması)
}

describe('FORMÜL-KANON: TO ≠ NIV, taban hiyerarşisi, RAG kadranı (T-334)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let channelNka: string;
  let categorySacBoyasi: string;
  let fuSingleSku: string;
  let tacticId: string;
  let mechanicId: string;
  let cplB: string;

  let price: number;
  let cogs: number;
  let skuId: string;

  const createdLifecycleAgreementIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [channelNka, categorySacBoyasi, fuSingleSku] = await Promise.all([
      dataSource
        .query(
          `SELECT id FROM main.channels WHERE tenant_id = $1 AND code = 'NKA'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
      dataSource
        .query(
          `SELECT id FROM main.categories WHERE tenant_id = $1 AND code = 'CAT-SAC-BOYASI'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
      dataSource
        .query(
          `SELECT id FROM main.forecasting_units WHERE tenant_id = $1 AND code = 'FU-E2E-GRID-SINGLE-SKU'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
    ]);

    // TEK SKU'lu FU — FU/plan agregasyonu = SKU değeri (coverage = 1),
    // yani RAG rengi gerçekten atanır (`T-177`: kısmi kapsamda renk YOK).
    const skuRows = await dataSource.query(
      `SELECT id, unit_price, cogs FROM main.skus WHERE tenant_id = $1 AND fu_id = $2`,
      [fixture.tenantId, fuSingleSku],
    );
    expect(skuRows).toHaveLength(1); // poz. kontrol: fixture gerçekten tek-SKU
    skuId = skuRows[0].id;
    price = parseFloat(skuRows[0].unit_price);
    cogs = parseFloat(skuRows[0].cogs);
    expect(price).toBeGreaterThan(0);
    expect(cogs).toBeGreaterThan(0);

    const tacticRows = await dataSource.query(
      `SELECT id FROM main.tactics WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId],
    );
    const mechanicRows = await dataSource.query(
      `SELECT id FROM main.mechanics WHERE tenant_id = $1 AND code = 'CPP_ON_PCT'`,
      [fixture.tenantId],
    );
    tacticId = tacticRows[0].id;
    mechanicId = mechanicRows[0].id;

    const cplRows = await dataSource.query(
      `SELECT id FROM main.cpls WHERE tenant_id = $1 AND id <> $2 ORDER BY code LIMIT 1`,
      [fixture.tenantId, fixture.cplId],
    );
    cplB = cplRows[0].id;
  }, 120000);

  afterAll(async () => {
    await cleanupTestPlans(app, fixture.tenantId, 'E2E-T334-');
    const admin = await getAdminDataSource();
    await admin.query(
      `DELETE FROM main.lta_agreements WHERE tenant_id = $1 AND agreement_code LIKE 'T334\\_%'`,
      [fixture.tenantId],
    );
    for (const id of createdLifecycleAgreementIds) {
      await admin.query(`DELETE FROM main.agreements WHERE id = $1`, [id]);
    }
    await closeTestApp();
    await closeAdminDataSource();
  });

  beforeEach(() => clearTokenCache());

  async function createLtaFor(
    cplId: string,
    onPct: number,
    offPct: number,
    suffix: string,
  ): Promise<void> {
    const admin = await loginAs(app, 'ADMIN');
    const parent = await request(app.getHttpServer())
      .post('/agreements')
      .set(admin.authHeader())
      .send({
        agreementName: `E2E-T334-LTA-${suffix}-${Date.now()}`,
        agreementType: 'LTA',
        cplId,
        channelId: channelNka,
        categoryId: categorySacBoyasi,
        fuId: fuSingleSku,
        tacticId,
        mechanicId,
        skuScope: 'FU',
        capTotalAmount: 1000000,
        spendType: 'BOTH',
        startDate: isoToday(),
        endDate: isoPlusDays(90),
        justification: 'T-334 formül-kanon fixture',
      })
      .expect(201);
    createdLifecycleAgreementIds.push(parent.body.id);

    const lta = await request(app.getHttpServer())
      .post('/lta-agreements')
      .set(admin.authHeader())
      .send({
        agreementId: parent.body.id,
        cplId,
        agreementName: `T-334 ${suffix} oran şartları`,
        agreementCode: `T334_${suffix}_${Date.now()}`,
        effectiveDate: isoToday(),
        rates: [
          {
            channel: 'ALL',
            category: 'ALL',
            onInvoicePercentage: onPct,
            offInvoicePercentage: offPct,
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/lta-agreements/${lta.body.id}/activate`)
      .set(admin.authHeader())
      .expect(204);
  }

  async function createPlanWithFu(
    cplId: string,
    name: string,
  ): Promise<{ planId: string; fuVersion: number }> {
    const planner = await loginAs(app, 'PLANNER');
    const planRes = await request(app.getHttpServer())
      .post('/plans')
      .set(planner.authHeader())
      .send({
        planName: name,
        cplId,
        channelId: channelNka,
        categoryId: categorySacBoyasi,
        startDate: isoToday(),
        endDate: isoPlusDays(25),
      })
      .expect(201);

    const fuRes = await request(app.getHttpServer())
      .post(`/plans/${planRes.body.id}/fus`)
      .set(planner.authHeader())
      .send({ fuId: fuSingleSku, planVersion: 1 })
      .expect(201);

    return { planId: planRes.body.id, fuVersion: fuRes.body.version ?? 1 };
  }

  /** Bir hücreyi kurar ve SKU'nun canlı KPI'larını döndürür. */
  async function runCell(input: {
    planId: string;
    fuVersion: number;
    skuVersion: number;
    baseVol: number;
    planVol: number;
    cppOn: number;
    cppOff: number;
  }): Promise<{
    kpis: Record<string, { value: number | null; ragStatus: string | null }>;
    fuVersion: number;
    skuVersion: number;
  }> {
    const planner = await loginAs(app, 'PLANNER');

    const tacticRes = await request(app.getHttpServer())
      .patch(`/plans/${input.planId}/fus/${fuSingleSku}/tactics`)
      .set(planner.authHeader())
      .send({
        tactics: { CPP_ON_PCT: input.cppOn, CPP_OFF_PCT: input.cppOff },
        version: input.fuVersion,
      })
      .expect(200);

    const volRes = await request(app.getHttpServer())
      .patch(`/plans/${input.planId}/fus/${fuSingleSku}/skus/${skuId}/volume`)
      .set(planner.authHeader())
      .send({
        baseVolume: input.baseVol,
        plannedVolume: input.planVol,
        version: input.skuVersion,
      })
      .expect(200);

    return {
      kpis: volRes.body.calculatedKpis,
      fuVersion: tacticRes.body.version,
      skuVersion: volRes.body.version,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // 1 · TO ≠ NIV — kavram ayrıştırması (Q2) + taban hiyerarşisi (Q5/Q8)
  // ══════════════════════════════════════════════════════════════════
  describe('Kavram ayrıştırma + taban hiyerarşisi (Q2 · Q5 · Q8 · Q6)', () => {
    let planId: string;
    let fuVersion: number;
    let skuVersion = 1;

    beforeAll(async () => {
      await createLtaFor(fixture.cplId, LTA_ON_PCT, LTA_OFF_PCT, 'A');
      const p = await createPlanWithFu(
        fixture.cplId,
        `E2E-T334-CANON-${Date.now()}`,
      );
      planId = p.planId;
      fuVersion = p.fuVersion;
    }, 120000);

    it('TO ve NIV AYRI sayılardır; GP `TO` tabanlıdır; off-invoice tabanı NIV; ROI paydası promo-only', async () => {
      const baseVol = 1000;
      const planVol = 1200;
      const r = await runCell({
        planId,
        fuVersion,
        skuVersion,
        baseVol,
        planVol,
        cppOn: CPP_ON_PCT,
        cppOff: CPP_OFF_PCT,
      });
      fuVersion = r.fuVersion;
      skuVersion = r.skuVersion;

      const c = canon({
        price,
        cogs,
        baseVol,
        planVol,
        ltaOnPct: LTA_ON_PCT,
        ltaOffPct: LTA_OFF_PCT,
        cppOnPct: CPP_ON_PCT,
        cppOffPct: CPP_OFF_PCT,
      });
      const k = r.kpis;

      // 0 · POZ. KONTROL — zincir gerçekten koştu (LTA oranı SKU'ya indi)
      expect(k.BASE_GSV.value).toBeCloseTo(c.baseGsv, 2);
      expect(k.BASE_LTA_ON.value).toBeCloseTo(c.baseLtaOn, 2);
      expect(k.BASE_LTA_OFF.value).toBeCloseTo(c.baseLtaOff, 2);
      // ⛔ `Q5`/`Q8` pinleri KÖR DEĞİL — İKİ KOŞUL BİRDEN gerekli
      // (`T-273` ailesi): `LTA_Off > 0` **VE** off-invoice promo > 0.
      // İkincisi review `N2`'de eksikti; artık doğrudan ölçülüyor.
      expect(k.BASE_LTA_OFF.value!).toBeGreaterThan(0);
      expect(k.PLANNED_LTA_OFF.value!).toBeGreaterThan(0);
      expect(c.promoOff).toBeGreaterThan(0);
      expect(c.promoOn).toBeGreaterThan(0);

      // 1 · NIV kendi kodlarıyla var
      expect(k.BASE_NIV.value).toBeCloseTo(c.baseNiv, 2);
      expect(k.PLANNED_NIV.value).toBeCloseTo(c.planNiv, 2);
      expect(k.INCR_NIV.value).toBeCloseTo(c.incrNiv, 2);

      // 2 · TO gerçek TO'dur — ve NIV'DEN FARKLIDIR (farkı OKUYAN assertion)
      expect(k.BASE_TO.value).toBeCloseTo(c.baseTo, 2);
      expect(k.PLANNED_TO.value).toBeCloseTo(c.planTo, 2);
      expect(k.INCR_TO.value).toBeCloseTo(c.incrTo, 2);
      expect(k.BASE_TO.value).not.toBeCloseTo(k.BASE_NIV.value!, 2);
      expect(k.PLANNED_TO.value).not.toBeCloseTo(k.PLANNED_NIV.value!, 2);
      // fark TAM OLARAK off-invoice toplamıdır
      expect(k.BASE_NIV.value! - k.BASE_TO.value!).toBeCloseTo(c.baseLtaOff, 2);
      expect(k.PLANNED_NIV.value! - k.PLANNED_TO.value!).toBeCloseTo(
        c.planLtaOff + c.promoOff,
        2,
      );

      // 3 · `Q8` — LTA_Off tabanı PlannedNIV (promo-on DÜŞÜLMÜŞ)
      expect(k.PLANNED_LTA_OFF.value).toBeCloseTo(c.planLtaOff, 2);
      expect(k.PLANNED_LTA_OFF.value).not.toBeCloseTo(
        deviantPlannedLtaOff(c.planGsv, c.planLtaOn, LTA_OFF_PCT),
        2,
      );

      // 4 · `Q5` — off-invoice mekanik tabanı NIV; LTA_Off DÜŞÜLMEZ.
      //     TOTAL_PLANNED_SPEND üzerinden okunur (promoOff onun içindedir).
      expect(k.TOTAL_PLANNED_SPEND.value).toBeCloseTo(c.planSpend, 2);
      expect(k.PLANNED_ON_INVOICE_SPEND.value).toBeCloseTo(c.planOn, 2);
      // sapmalı taban (NIV − LTA_Off) ile AYNI OLMADIĞINI oku
      const deviantPromoOff = ((c.planNiv - c.planLtaOff) * CPP_OFF_PCT) / 100;
      expect(c.promoOff).not.toBeCloseTo(deviantPromoOff, 2); // fixture ayırt edici
      expect(k.TOTAL_PLANNED_SPEND.value).not.toBeCloseTo(
        c.planOn + c.planLtaOff + deviantPromoOff,
        2,
      );

      // 5 · MUTABAKAT (`A1 §4.2 D-4`): total = on + off, birikimli sapma
      expect(
        k.TOTAL_PLANNED_SPEND.value! - k.PLANNED_ON_INVOICE_SPEND.value!,
      ).toBeCloseTo(c.planLtaOff + c.promoOff, 2);

      // 6 · `Q3` — GP ailesi TO tabanlı (formül METNİ değişmedi, DEĞER değişti)
      expect(k.BASE_GP.value).toBeCloseTo(c.baseGp, 2);
      expect(k.PLANNED_GP.value).toBeCloseTo(c.planGp, 2);
      expect(k.INCR_GP.value).toBeCloseTo(c.incrGp, 2);
      expect(k.GP_MARGIN_PCT.value).toBeCloseTo((c.planGp / c.planTo) * 100, 4);
      // NIV tabanlı GP ile AYNI DEĞİL (farkı okuyan assertion)
      expect(k.PLANNED_GP.value).not.toBeCloseTo(c.planNiv - planVol * cogs, 2);

      // 7 · `Q6` — ROI paydası AYRI KALEM: promo-only, LTA hariç, incremental
      expect(k.INCR_PROMO_SPEND.value).toBeCloseTo(c.incrPromoSpend, 2);
      expect(k.INCR_PROMO_SPEND.value).not.toBeCloseTo(
        k.TOTAL_PLANNED_SPEND.value!,
        2,
      );
      expect(k.INCR_PROMO_SPEND.value).not.toBeCloseTo(k.INCR_SPEND.value!, 2);
      expect(k.GP_ROI_PCT.value).toBeCloseTo(c.gpRoiPct!, 4);
    }, 120000);
  });

  // ══════════════════════════════════════════════════════════════════
  // 2 · RAG — İKİ EKSEN KADRANI (Q7): DÖRT HÜCRE, HÜCRE BAŞINA BİR VAKA
  // ══════════════════════════════════════════════════════════════════
  describe('Q7 · RAG kadranı — dört hücre (canlı model TEK EKSEN: eşleşen-sapmalı)', () => {
    let planA: string;
    let fuVersionA: number;
    let skuVersionA = 1;
    let planB: string;
    let fuVersionB: number;
    let skuVersionB = 1;

    beforeAll(async () => {
      const a = await createPlanWithFu(
        fixture.cplId,
        `E2E-T334-QUAD-A-${Date.now()}`,
      );
      planA = a.planId;
      fuVersionA = a.fuVersion;

      await createLtaFor(cplB, LTA_B_ON_PCT, LTA_B_OFF_PCT, 'B');
      const b = await createPlanWithFu(cplB, `E2E-T334-QUAD-B-${Date.now()}`);
      planB = b.planId;
      fuVersionB = b.fuVersion;
    }, 120000);

    const cells: Array<{
      name: string;
      plan: 'A' | 'B';
      baseVol: number;
      planVol: number;
      cppOn: number;
      cppOff: number;
      iTo: 'pos' | 'nonpos';
      iGp: 'pos' | 'nonpos';
      canonRag: 'RED' | 'AMBER' | 'GREEN';
      /**
       * ⛔ BUGÜNKÜ CANLI RENK — **LİTERAL**, hesaplanmış DEĞİL.
       * Bir ara sürümde burada `roi >= 20 ? 'GREEN' : …` vardı; o
       * `determineRagStatus`'ün **testteki yeniden uygulamasıydı**
       * (`§2.7 #8`) — eşikler kodda kayarsa test de birlikte kayar,
       * yani hiçbir şey ölçmez. Review `S3` yakaladı.
       * Bu sabitler `Q7` hükmü indiği gün **BİLEREK KIRILIR**.
       */
      liveRag: 'RED' | 'AMBER' | 'GREEN' | null;
    }> = [
      {
        name: 'HÜCRE 1 — iTO>0 ∧ iGP>0  ⇒ kanon GREEN',
        plan: 'A',
        baseVol: 1000,
        planVol: 2000,
        cppOn: 1,
        cppOff: 1,
        iTo: 'pos',
        iGp: 'pos',
        canonRag: 'GREEN',
        liveRag: 'GREEN',
      },
      {
        name: 'HÜCRE 2 — iTO>0 ∧ iGP≤0  ⇒ kanon AMBER ("satış var, kâr yok")',
        plan: 'A',
        baseVol: 1000,
        planVol: 1200,
        cppOn: CPP_ON_PCT,
        cppOff: CPP_OFF_PCT,
        iTo: 'pos',
        iGp: 'nonpos',
        // ⭐ `Z66 §2`'nin SAPMASI TAM BURADA: kanon `AMBER`
        //    ("satış var, kâr yok"), canlı tek-eksen `RED`.
        canonRag: 'AMBER',
        liveRag: 'RED',
      },
      {
        name: 'HÜCRE 3 — iTO≤0 ∧ iGP≤0  ⇒ kanon RED',
        plan: 'A',
        baseVol: 1000,
        planVol: 900,
        cppOn: CPP_ON_PCT,
        cppOff: CPP_OFF_PCT,
        iTo: 'nonpos',
        iGp: 'nonpos',
        canonRag: 'RED',
        liveRag: 'RED',
      },
      {
        name: 'HÜCRE 4 — iTO≤0 ∧ iGP>0  ⇒ kanon RED (iTO ekseni BASKIN)',
        plan: 'B',
        baseVol: 1000,
        planVol: 800,
        cppOn: 0,
        cppOff: 0,
        iTo: 'nonpos',
        iGp: 'pos',
        canonRag: 'RED',
        // ⚠️ `S1`: promo mekaniği YOK ⇒ ROI paydası (`INCR_PROMO_SPEND`)
        //    tam `0` ⇒ `GP_ROI_PCT` `null` ⇒ **RAG rengi de `null`**.
        //    LTA-only planların ekranda RENKSİZ kalması `Q6`'nın
        //    ürün-görünür sonucudur ve beklenen-değişim listesindedir.
        liveRag: null,
      },
    ];

    for (const cell of cells) {
      it(
        cell.name,
        async () => {
          const onPct = cell.plan === 'A' ? LTA_ON_PCT : LTA_B_ON_PCT;
          const offPct = cell.plan === 'A' ? LTA_OFF_PCT : LTA_B_OFF_PCT;
          const r = await runCell({
            planId: cell.plan === 'A' ? planA : planB,
            fuVersion: cell.plan === 'A' ? fuVersionA : fuVersionB,
            skuVersion: cell.plan === 'A' ? skuVersionA : skuVersionB,
            baseVol: cell.baseVol,
            planVol: cell.planVol,
            cppOn: cell.cppOn,
            cppOff: cell.cppOff,
          });
          if (cell.plan === 'A') {
            fuVersionA = r.fuVersion;
            skuVersionA = r.skuVersion;
          } else {
            fuVersionB = r.fuVersion;
            skuVersionB = r.skuVersion;
          }

          const c = canon({
            price,
            cogs,
            baseVol: cell.baseVol,
            planVol: cell.planVol,
            ltaOnPct: onPct,
            ltaOffPct: offPct,
            cppOnPct: cell.cppOn,
            cppOffPct: cell.cppOff,
          });

          // Hücre GERÇEKTEN o hücre mi — fixture'ın kendisini doğrula
          if (cell.iTo === 'pos') expect(c.incrTo).toBeGreaterThan(0);
          else expect(c.incrTo).toBeLessThanOrEqual(0);
          if (cell.iGp === 'pos') expect(c.incrGp).toBeGreaterThan(0);
          else expect(c.incrGp).toBeLessThanOrEqual(0);
          expect(c.canonicalRag).toBe(cell.canonRag);

          // Motor bu hücrenin İKİ EKSENİNİ de ÜRETİYOR (kadran uygulanabilir)
          expect(r.kpis.INCR_TO.value).toBeCloseTo(c.incrTo, 2);
          expect(r.kpis.INCR_GP.value).toBeCloseTo(c.incrGp, 2);

          // ⛔ BUGÜNKÜ CANLI MODEL — TEK EKSEN (eşik), ve MOTORDAN OKUNUR.
          // Beklenen değer bir SABİTTİR (`cell.liveRag`); testin içinde
          // yeniden hesaplanmaz. `Q7` hükmü indiği gün bu satır kırılır —
          // kırılması BEKLENENDİR, çünkü model değişecektir.
          expect(r.kpis.GP_ROI_PCT.ragStatus).toBe(cell.liveRag);
        },
        120000,
      );
    }

    it('⭐ KADRAN ile EŞİK AYNI ŞEY DEĞİLDİR — ve fark MOTORDAN okunur', async () => {
      // `HÜCRE 2` = `iTO > 0 ∧ iGP ≤ 0`. Kanon `AMBER` ("satış var, kâr
      // yok"), canlı tek-eksen `RED`. ⛔ Bir ara sürümde bu test yalnız
      // `canon()`'u kendi kendine karşılaştırıyordu — kendi yardımcısı
      // hakkında bir TOTOLOJİ, motordan tek bir değer okumadan (review
      // `S3`). Şimdi hücre yeniden kuruluyor ve renk MOTORDAN geliyor.
      const baseVol = 1000;
      const planVol = 1200;
      const r = await runCell({
        planId: planA,
        fuVersion: fuVersionA,
        skuVersion: skuVersionA,
        baseVol,
        planVol,
        cppOn: CPP_ON_PCT,
        cppOff: CPP_OFF_PCT,
      });
      fuVersionA = r.fuVersion;
      skuVersionA = r.skuVersion;

      const c = canon({
        price,
        cogs,
        baseVol,
        planVol,
        ltaOnPct: LTA_ON_PCT,
        ltaOffPct: LTA_OFF_PCT,
        cppOnPct: CPP_ON_PCT,
        cppOffPct: CPP_OFF_PCT,
      });

      // Kadranın iki ekseni de MOTORDAN — ve işaretleri `AMBER` hücresi.
      expect(r.kpis.INCR_TO.value!).toBeGreaterThan(0);
      expect(r.kpis.INCR_GP.value!).toBeLessThanOrEqual(0);
      expect(c.canonicalRag).toBe('AMBER');

      // Canlı renk MOTORDAN, ve LİTERAL bir sabitle karşılaştırılıyor.
      expect(r.kpis.GP_ROI_PCT.ragStatus).toBe('RED');

      // ⇒ AYRIŞMA: aynı hücrede kanon `AMBER`, canlı `RED`.
      expect(r.kpis.GP_ROI_PCT.ragStatus).not.toBe(c.canonicalRag);
    }, 120000);
  });
});
