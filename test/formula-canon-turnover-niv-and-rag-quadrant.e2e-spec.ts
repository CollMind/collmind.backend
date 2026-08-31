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
 * ── `Q7` RAG İKİ-EKSEN KADRANI — ✅ HÜKÜM İNDİ (`Z68 §1`, `T-342`) ────
 * Excel: `Red: iTO ≤ 0` · `Amber: iTO > 0 ∧ iGP ≤ 0` · `Green: ikisi > 0`.
 *
 * `T-334` bu dosyayı **randevu** olarak kurmuştu: canlı model tek-eksendi
 * (`GP_ROI_PCT >= 20 / >= 10`) ve her hücre bugünkü rengi **literal bir
 * sabit** olarak taşıyordu, *"hüküm indiği gün BİLEREK kırılır"* şerhiyle.
 * `T-342` o günü getirdi — ve sabitler **kırıldığı GÖRÜLDÜKTEN sonra**
 * yenilendi (reprodüksiyon şartı; ölçüm `T-342` raporunda):
 *
 * ```
 * HÜCRE 2   iTO=+2.269 · iGP=-9.731 · ROI=-60,13%   RED  →  AMBER   ⭐ bkz. aşağı
 * HÜCRE 4   iTO=-11.700 · iGP=+300 · INCR_PROMO=0   null →  null    ama SEBEBİ DEĞİŞTİ
 * HÜCRE 1/3                                          değişmedi
 * ```
 *
 * ⛔ **ÖNCÜL DÜZELTMESİ (`Z71 §0`) — *"`AMBER` İLK KEZ DOĞUYOR"* YANLIŞTI.**
 * Ölçüldü (`main.kpis`): `GP_ROI_PCT` `rag_green=20 · rag_amber=10` ⇒ eski
 * tek-eksen model `10 ≤ ROI < 20` aralığında **`AMBER` ÜRETİYORDU**.
 * Doğru ifade: **negatif ROI'den `AMBER`** — eşik modelinin ÜRETEMEYECEĞİ
 * renk. `HÜCRE 2`'de ROI `-%60,13`; hiçbir `>= eşik` kuralı oradan `AMBER`
 * çıkaramaz. *(`DISIPLIN`: yanlış öncül, doğru taramayı yanlış eksene
 * kilitler — ve gerçek risk `RED→AMBER` değil **`RED→GREEN`**'di, bkz.
 * `below-target` pini aşağıda.)*
 *
 * ── `S1` TANIMLI-YOKLUK — ve `HÜCRE 4`'ün SESSİZ TUZAĞI ──────────────
 * `HÜCRE 4` hüküm öncesi de sonrası da `null` renk verir, **ama aynı
 * sebeple DEĞİL**: önce payda `0` olduğu için `GP_ROI_PCT` `null`'dı ve
 * renksizlik bir **yan etkiydi**; kadran iki ekseni de dolu okuduğu için
 * (`-11.700` / `+300`) artık `RED` üretirdi. Ölçüldü: dışlama kapısı
 * devre dışı bırakıldığında bu hücre `RED` döndü (`T-342` mutasyon kanıtı).
 * ⇒ Bu yüzden `HÜCRE 4`'ün pini **renge değil, `ragExclusionReason`'a**
 * bağlanır: aynı `null`, farklı iki mekanizma (`§2.7 #6`).
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
    /** Excel `PlannedOPSOQuadrant` — İKİ EKSEN. Artık CANLI model de bu. */
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
    kpis: Record<
      string,
      {
        value: number | null;
        ragStatus: string | null;
        // `T-342`: tanımlı-yokluk sebebi. Anahtar ESKİ JSONB satırlarında
        // hiç bulunmayabilir ⇒ `?` + okurken `?? null`.
        ragExclusionReason?: string | null;
      }
    >;
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
       * ⛔ CANLI RENK — **LİTERAL**, hesaplanmış DEĞİL.
       * Bir ara sürümde burada `roi >= 20 ? 'GREEN' : …` vardı; o
       * `determineRagStatus`'ün **testteki yeniden uygulamasıydı**
       * (`§2.7 #8`) — eşikler kodda kayarsa test de birlikte kayar,
       * yani hiçbir şey ölçmez. Review `S3` yakaladı.
       * `T-342`'de bu sabitler **kırıldığı görüldükten sonra** yenilendi.
       */
      liveRag: 'RED' | 'AMBER' | 'GREEN' | null;
      /**
       * `S1` (`Z68 §2`): renk yokken **sebebin kendisi**. `null` renk +
       * `null` sebep = *"değerlendirilemedi"*; `null` renk + `'LTA_ONLY'` =
       * *"değerlendirme DIŞI"*. Bu sütun olmasaydı `HÜCRE 4` iki farklı
       * mekanizmayı **aynı** `null` ile geçerdi.
       */
      liveExclusionReason: 'LTA_ONLY' | null;
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
        // DEĞİŞMEDİ (ölçüldü: ROI %742,31 ⇒ eşik modeli de GREEN diyordu)
        liveRag: 'GREEN',
        liveExclusionReason: null,
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
        // ⭐ SAPMA KAPANDI (`Z68 §1`): kanon `AMBER` ("satış var, kâr
        //    yok"), ve canlı model artık AYNISINI diyor.
        //    ⛔ ÖLÇÜLDÜ — `RED` → `AMBER`, `AMBER`'ın bu üründe **İLK
        //    DOĞUŞU**: iGP = -9.730,80 ⇒ ROI = -%60,13. Eşik modeli
        //    (`>= 10 AMBER`) bu sayıdan `AMBER` **üretemezdi**; renk
        //    yalnız iki eksenli kadrandan gelebilir.
        canonRag: 'AMBER',
        liveRag: 'AMBER',
        liveExclusionReason: null,
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
        // DEĞİŞMEDİ (iTO = -21.083,10 ⇒ iki modelde de RED)
        liveRag: 'RED',
        liveExclusionReason: null,
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
        // ⚠️ KANON burada bir PROMOSYON yargısı verir (`iTO ≤ 0` ⇒ `RED`)
        //    — ama bu plan bir promosyon DEĞİL. `S1` tam olarak bu farkı
        //    kapatır: kadran uygulanmadan ÖNCE kapsam sorulur.
        canonRag: 'RED',
        // ⛔ `S1` (`Z68 §2`) — TANIMLI-YOKLUK. `INCR_PROMO_SPEND` tam `0`
        //    ⇒ plan bir promosyon değerlendirmesi değil ⇒ renk YOK, ve
        //    yokluğun SEBEBİ taşınır.
        //    ⚠️ Bu `null` `T-334`'teki `null` ile AYNI DEĞİL: orada payda
        //    sıfır olduğu için `GP_ROI_PCT` çözülemiyordu (yan etki);
        //    burada iki eksen de dolu (`iTO=-11.700` · `iGP=+300`) ve
        //    renk BİLİNÇLİ olarak verilmiyor. Fark `liveExclusionReason`
        //    ile okunuyor — mutasyon kanıtı: kapı kapatıldığında bu hücre
        //    `RED` döndü (`T-342`).
        liveRag: null,
        liveExclusionReason: 'LTA_ONLY',
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

          // ⛔ CANLI MODEL — MOTORDAN OKUNUR, beklenen değer bir SABİTTİR
          // (`cell.liveRag`); testin içinde yeniden hesaplanmaz.
          expect(r.kpis.GP_ROI_PCT.ragStatus).toBe(cell.liveRag);
          // ⭐ `S1` — AYNI `null`'ın İKİ SEBEBİNİ AYIRT EDEN SATIR.
          // Bu assertion olmadan `HÜCRE 4` "payda sıfır olduğu için
          // renksiz" ile "promosyon olmadığı için değerlendirme dışı"yı
          // aynı geçişle kabul ederdi (`§2.7 #6`: kapsam var, ayırt etme
          // gücü yok).
          expect(r.kpis.GP_ROI_PCT.ragExclusionReason ?? null).toBe(
            cell.liveExclusionReason,
          );
          // ⛔ Renk varken sebep OLAMAZ — taşıyıcı tutarlılığı.
          if (cell.liveRag !== null) {
            expect(r.kpis.GP_ROI_PCT.ragExclusionReason ?? null).toBeNull();
          }
        },
        120000,
      );
    }

    it('⭐ KADRAN İNDİ: `AMBER` bir EŞİKTEN gelemezdi — motor iki eksenden okuyor', async () => {
      // `HÜCRE 2` = `iTO > 0 ∧ iGP ≤ 0`. `T-334`'te kanon `AMBER`, canlı
      // tek-eksen `RED` idi; `Z68 §1` ile ikisi YAKINSADI.
      // ⛔ Bir ara sürümde bu test yalnız `canon()`'u kendi kendine
      // karşılaştırıyordu — kendi yardımcısı hakkında bir TOTOLOJİ,
      // motordan tek bir değer okumadan (review `S3`). Şimdi hücre yeniden
      // kuruluyor ve renk MOTORDAN geliyor.
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

      // ── `N1` (review) — İKİ İDDİA AYRIŞTIRILDI ────────────────────────
      // ⛔ Aşağıdaki satır YALNIZ `canon()` yardımcısının kendi pinidir
      // (*"bu fixture gerçekten AMBER hücresi mi"*), motor hakkında HİÇBİR
      // ŞEY söylemez. Motor iddiası bir satır aşağıda ve **literal**.
      // İkisini tek `expect` zincirinde okumak `§2.7 #8` ailesidir: testin
      // kendi kadran uygulaması ile üretimin uygulaması aynı ifadede
      // karşılaşırsa, ikisi BİRLİKTE kayabilir.
      expect(c.canonicalRag).toBe('AMBER'); // ← FIXTURE pini

      // ← MOTOR iddiası: LİTERAL bir sabit, `canon()` DEĞİL.
      expect(r.kpis.GP_ROI_PCT.ragStatus).toBe('AMBER');

      // ⭐ VE BU RENK BİR EŞİKTEN GELEMEZDİ — testin AYIRT EDİCİ yarısı.
      // Eşik modeli `AMBER`'ı yalnız `GP_ROI_PCT >= ragAmberThreshold`
      // (seed: `10`) iken üretebilir. Burada ROI **negatif** ⇒ eşik
      // modelinin tek olası cevabı `RED`'di. Yani yeşil bir sonuç
      // "kadran uygulandı"nın kanıtıdır, "sabit tuttu"nun değil.
      expect(r.kpis.GP_ROI_PCT.value).not.toBeNull();
      expect(r.kpis.GP_ROI_PCT.value!).toBeLessThan(0);
      expect(r.kpis.GP_ROI_PCT.value!).toBeCloseTo(c.gpRoiPct!, 4);

      // Renk varken dışlama sebebi OLAMAZ.
      expect(r.kpis.GP_ROI_PCT.ragExclusionReason ?? null).toBeNull();
    }, 120000);

    // ══════════════════════════════════════════════════════════════════
    // `Z71 §1a` — BELOW-TARGET DİLİMİ: kadranın SESSİZLEŞTİRECEĞİ yer
    // ══════════════════════════════════════════════════════════════════
    /**
     * ⛔ **GERÇEK RİSK `RED→AMBER` DEĞİL, `RED→GREEN`'Dİ.**
     *
     * `T-342`'nin ilk turu *"AMBER ilk kez doğuyor"* öncülüyle tarandı ve o
     * öncül yanlıştı (`Z71 §0`). Doğru eksen bu: kadran, `iTO > 0 ∧ iGP > 0`
     * olan ama **hedefin çok altında** getiri üreten planları `GREEN` yapar.
     * Ölçülmüş geçiş matrisi (`green=20 · amber=10`):
     * ```
     * 0 < ROI < 10     ÖNCE RED    → SONRA GREEN
     * 10 ≤ ROI < 20    ÖNCE AMBER  → SONRA GREEN
     * ```
     * Uyarının yerine **sessizlik değil, karşı yönde güvence** geçerdi:
     * ekranda **"İYİ"**.
     *
     * ⚠️ **`T-273` şartı — fixture bu dilimi GERÇEKTEN üretiyor mu?**
     * Aşağıdaki assertion'lar önce dilimin varlığını **motordan** ölçüyor
     * (`0 < ROI < 20` ∧ `iGP > 0` ∧ `iTO > 0`); dilim üretilmeseydi
     * *"below-target yolu koşmuyor"* sonucu bir kanıt DEĞİL, koşmamış bir
     * yol olurdu.
     */
    it('⭐ `Z71 §1a` — `0 < ROI < 20 ∧ iGP > 0` dilimi: kadran GREEN diyor, ve ONU SÖYLEYEN TEK ŞEY kalmıyor', async () => {
      // `10 ≤ ROI < 20` dilimi (eski model: `AMBER`) — parametreler
      // ampirik taramayla seçildi, tahminle değil.
      const baseVol = 1000;
      const planVol = 1150;
      const cppOn = 1;
      const cppOff = 3;

      const r = await runCell({
        planId: planA,
        fuVersion: fuVersionA,
        skuVersion: skuVersionA,
        baseVol,
        planVol,
        cppOn,
        cppOff,
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
        cppOnPct: cppOn,
        cppOffPct: cppOff,
      });

      // ── 1 · DİLİM GERÇEKTEN ÜRETİLDİ Mİ (`T-273`) ────────────────────
      // Üçü de MOTORDAN okunuyor; `canon()` yalnız sayısal yakınlık için.
      expect(r.kpis.INCR_TO.value!).toBeGreaterThan(0);
      expect(r.kpis.INCR_GP.value!).toBeGreaterThan(0);
      expect(r.kpis.GP_ROI_PCT.value!).toBeGreaterThan(0);
      expect(r.kpis.GP_ROI_PCT.value!).toBeLessThan(20);
      expect(r.kpis.GP_ROI_PCT.value).toBeCloseTo(c.gpRoiPct!, 4);

      // ⛔ Ve dilimin HANGİ YARISI olduğu da pinleniyor: `10 ≤ ROI < 20`,
      // yani ESKİ tek-eksen modelin `AMBER` dediği aralık. Bu satır
      // olmadan test `0 < ROI < 10` yarısına kayabilir ve *"AMBER→GREEN"*
      // iddiası ölçülmemiş kalırdı.
      expect(r.kpis.GP_ROI_PCT.value!).toBeGreaterThanOrEqual(10);

      // ── 2 · KADRAN GREEN DİYOR — ve bu DOĞRU ─────────────────────────
      // Plan gerçekten incremental ciro VE incremental kâr üretiyor.
      expect(r.kpis.GP_ROI_PCT.ragStatus).toBe('GREEN');
      expect(r.kpis.GP_ROI_PCT.ragExclusionReason ?? null).toBeNull();

      // ── 3 · ⛔ AMA "İYİ" TEK BAŞINA YANILTICI ────────────────────────
      // `GP_ROI_PCT = %10,5` ve kataloğa göre hedef `%20`. Yani bu plan
      // kadrana göre sağlıklı, Target-ROI eksenine göre **hedefin altında**.
      // İki eksenin AYRI konuşması `Z71 §1`'in hükmü; aşağıdaki satır
      // hedefin gerçekten bu planın ÜSTÜNDE olduğunu ölçüyor ki
      // below-target yolunun tetikleyicisi bir varsayım olmasın.
      const admin = await loginAs(app, 'ADMIN');
      const kpiList = await request(app.getHttpServer())
        .get('/master-data/kpis')
        .set(admin.authHeader())
        .expect(200);
      const rows: Array<{ kpiCode: string; targetRoiThreshold?: number }> =
        Array.isArray(kpiList.body) ? kpiList.body : kpiList.body.data;
      const gpRoiKpi = rows.find((k) => k.kpiCode === 'GP_ROI_PCT');
      expect(gpRoiKpi).toBeDefined();
      // ⛔ Alan ADI da pinleniyor: `T-343` `rag_green_threshold`'u
      // `target_roi_threshold` yaptı. Eski ad dönerse bu satır kırılır.
      expect(gpRoiKpi!.targetRoiThreshold).toBeDefined();
      expect(Number(gpRoiKpi!.targetRoiThreshold)).toBeGreaterThan(
        r.kpis.GP_ROI_PCT.value!,
      );
    }, 120000);
  });
});
