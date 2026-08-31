/**
 * q20-untouched-vs-partial-row-gate.e2e-spec.ts
 *
 * `Q20` (ürün sahibi, 2026-08-31) — canlı `/submit` rotasında ÜÇ sınıfın
 * ayırt edildiğini kanıtlar:
 *
 * ```
 * DOKUNULMAMIŞ satır (base_volume=NULL, planned_volume=NULL — doğum hâli)
 *   → spend-katkısı YOK, ama rezervasyonu BLOKLAMAZ
 * KISMİ satır (en az bir alan dolu, gerekli biri eksik)
 *   → NOT_EVALUABLE → rezervasyon REDDİ, ALAN ADIYLA (Z77 hâlâ yaşıyor)
 * PLAN düzeyi: dolu-satır-sayısı 0
 *   → submit-uyarısı "boş plan" (BLOKLAMAZ)
 * ```
 *
 * `FU-WELLA-HC-500ML`'in seed'de **4 SKU**'su var (ölçüldü,
 * `main.forecasting_units`/`main.skus`, `gu_id` üzerinden JOIN). `addFu`
 * her SKU satırını `base_volume=NULL, planned_volume=NULL` ile doğurur
 * (`plan.repository.ts#addSku`) — yani grid'e hiç dokunulmamış bir plan
 * BUGÜN de HER ZAMAN bu 4-satır dokunulmamış hâlde doğar.
 *
 * ── `R2` (Team Lead, 2026-08-31) — BPTT dalı, DOĞRU TEŞHİS + ÖLÇÜLMÜŞ CEVAP ──
 * İlk sürüm "seed'de `unit_price` NULL olan SKU yok, o yüzden bu dal
 * yalnız unit seviyesinde kanıtlanabilir" diyordu. Team Lead ölçtü:
 * `information_schema.columns` → `main.skus.unit_price` `is_nullable =
 * YES` ⇒ **BPTT dalı ÜRETİMDE ULAŞILABİLİR**, seed'de sadece TANIĞI
 * yoktu. `DISIPLIN`: *"negatif davranışsal kanıt, tetikleyen fixture
 * olmadan kanıt değildir"* — veri yokluğu dalı ÖRTÜYORDU.
 *
 * ⇒ Vaka 4 bunu KAPATIR: paylaşılan seed'i BOZMADAN (adminDataSource ile
 * TEK bir SKU'nun `unit_price`'ı geçici olarak `NULL` yapılır, assertion
 * sonrası ORİJİNAL değere GERİ YAZILIR ve okunarak DOĞRULANIR — `DISIPLIN`:
 * *"bir yazma işleminin dönüş değeri, yazdığının kanıtı değildir"* ve
 * *"geri almanın SONUCUNU ölç, komutun çalıştığını değil"*). Pencere tek
 * bir `it()`'in senkron akışı kadar dar ve `--runInBand` altında dosyalar
 * SIRAYLA koşar — başka hiçbir test bu SKU'yu bu pencerede okumaz.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  resolveIdByCode,
  cleanupTestPlans,
  E2EFixture,
} from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

describe('Q20 — UNTOUCHED vs NOT_EVALUABLE plan-row gate (E2E)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let FU_WELLA_HC_500ML: string;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [CHANNEL_NKA, CATEGORY_SAC_BOYASI, FU_WELLA_HC_500ML] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
      resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-SAC-BOYASI'),
      resolveIdByCode(
        app,
        fixture.tenantId,
        'forecasting_units',
        'FU-WELLA-HC-500ML',
      ),
    ]);
  }, 60000);

  afterAll(async () => {
    try {
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-Q20-');
    } catch {
      // best-effort
    }
    await closeTestApp();
    await closeAdminDataSource();
  });

  /** Plan + tek FU (4 planSkus, hepsi DOKUNULMAMIŞ doğar) + %10 mekanik. */
  async function createPlanWithFu(namePrefix: string): Promise<{
    planId: string;
    planSkuIds: string[];
    fuVersion: number;
  }> {
    const planner = await loginAs(app, 'PLANNER');
    const planRes = await request(app.getHttpServer())
      .post('/plans')
      .set(planner.authHeader())
      .send({
        planName: `E2E-Q20-${namePrefix}-${Date.now()}`,
        cplId: fixture.cplId,
        channelId: CHANNEL_NKA,
        categoryId: CATEGORY_SAC_BOYASI,
        startDate: '2026-01-05',
        endDate: '2026-01-31',
      })
      .expect(201);
    const planId = planRes.body.id;

    const addFuRes = await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(planner.authHeader())
      .send({ fuId: FU_WELLA_HC_500ML, planVersion: 1 })
      .expect(201);
    const fuId = addFuRes.body.id;

    const planReadRes = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(planner.authHeader())
      .expect(200);
    const planFu = (
      planReadRes.body.planFus as Array<{
        id: string;
        planSkus: Array<{ skuId: string }>;
      }>
    ).find((f) => f.id === fuId);
    const planSkuIds: string[] = (planFu?.planSkus ?? []).map((s) => s.skuId);
    expect(planSkuIds.length).toBeGreaterThanOrEqual(2); // ölçüldü: 4

    return { planId, planSkuIds, fuVersion: addFuRes.body.version };
  }

  async function setVolume(
    planId: string,
    skuId: string,
    baseVolume: number | undefined,
    plannedVolume: number | undefined,
  ) {
    const planner = await loginAs(app, 'PLANNER');
    await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU_WELLA_HC_500ML}/skus/${skuId}/volume`)
      .set(planner.authHeader())
      .send({ baseVolume, plannedVolume, version: 1 })
      .expect(200);
  }

  async function setTactics(planId: string, version: number) {
    const planner = await loginAs(app, 'PLANNER');
    await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${FU_WELLA_HC_500ML}/tactics`)
      .set(planner.authHeader())
      .send({ tactics: { 'MEC-DISCOUNT': 10 }, version })
      .expect(200);
  }

  async function submit(planId: string) {
    const planner = await loginAs(app, 'PLANNER');
    const preSubmit = await request(app.getHttpServer())
      .get(`/plans/${planId}`)
      .set(planner.authHeader())
      .expect(200);
    const res = await request(app.getHttpServer())
      .post(`/plans/${planId}/submit`)
      .set(planner.authHeader())
      .send({ submissionNotes: 'Q20 pin', version: preSubmit.body.version });
    return res;
  }

  async function reserveOnInvoiceAmount(planId: string): Promise<number> {
    const rows = await dataSource.query(
      `SELECT amount FROM main.budget_transactions
        WHERE source_type = 'PLAN' AND source_id = $1
          AND tx_type = 'RESERVE' AND spend_type = 'ON_INVOICE'`,
      [planId],
    );
    expect(rows.length).toBe(1);
    return Number(rows[0].amount);
  }

  /**
   * `R2` — `skuId`'nin `unit_price`'ını (BPTT) geçici olarak `NULL` yapar,
   * `fn`'i çalıştırır, sonra ORİJİNAL değere geri yazar. Restore hem
   * yazma hem OKUMA ile doğrulanır (`DISIPLIN`: bir yazmanın dönüş değeri
   * yazdığının kanıtı değildir) — `finally` içinde, `fn` fırlatsa bile.
   */
  async function withNulledUnitPrice<T>(
    skuId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const adminDs = await getAdminDataSource();
    const before = await adminDs.query(
      `SELECT unit_price FROM main.skus WHERE id = $1`,
      [skuId],
    );
    if (before.length !== 1) {
      throw new Error(
        `withNulledUnitPrice: sku ${skuId} main.skus'te bulunamadı.`,
      );
    }
    const originalPrice = before[0].unit_price;

    await adminDs.query(
      `UPDATE main.skus SET unit_price = NULL WHERE id = $1`,
      [skuId],
    );
    const nulled = await adminDs.query(
      `SELECT unit_price FROM main.skus WHERE id = $1`,
      [skuId],
    );
    if (nulled.length !== 1 || nulled[0].unit_price !== null) {
      throw new Error(
        `withNulledUnitPrice: sku ${skuId} unit_price NULL'a taşınamadı ` +
          `(okunan: ${JSON.stringify(nulled)}).`,
      );
    }

    try {
      return await fn();
    } finally {
      await adminDs.query(
        `UPDATE main.skus SET unit_price = $2 WHERE id = $1`,
        [skuId, originalPrice],
      );
      const restored = await adminDs.query(
        `SELECT unit_price FROM main.skus WHERE id = $1`,
        [skuId],
      );
      if (
        restored.length !== 1 ||
        Number(restored[0].unit_price) !== Number(originalPrice)
      ) {
        throw new Error(
          `withNulledUnitPrice: sku ${skuId} orijinal unit_price'a geri ` +
            `YÜKLENEMEDİ (beklenen ${originalPrice}, okunan: ` +
            `${JSON.stringify(restored)}).`,
        );
      }
    }
  }

  // ── VAKA 1 — 1-dolu + N-boş: submit OLUR, rezervasyon YALNIZ dolu satırı taşır ──
  it('vaka 1: 1-dolu + N-boş satırlı plan → submit 200, rezervasyon yalnız dolu satırdan (Q20)', async () => {
    const oneRow = await createPlanWithFu('V1-ONE');
    await setVolume(oneRow.planId, oneRow.planSkuIds[0], 800, 1000);
    await setTactics(oneRow.planId, oneRow.fuVersion);

    const submitRes = await submit(oneRow.planId);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe('PENDING_APPROVAL');
    // `Q20`: dokunulmamış satırlar bir uyarı ÜRETMEZ (ne "eksik" ne
    // "boş plan" — plan dolu, yalnız kısmen). Uyarı gövdesi
    // `budgetCheck.warnings`'te taşınır (`plan.controller.ts` doc notu).
    expect(submitRes.body.budgetCheck?.warnings ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Plan boş')]),
    );

    const oneRowAmount = await reserveOnInvoiceAmount(oneRow.planId);
    expect(oneRowAmount).toBeGreaterThan(0);

    // Karşılaştırma: AYNI FU, AYNI mekanik, ama İKİ satır dolu. Tutar
    // FARKLI olmalı (ayırt etme gücü — `§2.7 #6`, tek satırlık girdide
    // iki senaryo aynı sonucu vermemeli).
    const twoRows = await createPlanWithFu('V1-TWO');
    await setVolume(twoRows.planId, twoRows.planSkuIds[0], 800, 1000);
    await setVolume(twoRows.planId, twoRows.planSkuIds[1], 800, 1000);
    await setTactics(twoRows.planId, twoRows.fuVersion);
    const submitRes2 = await submit(twoRows.planId);
    expect(submitRes2.status).toBe(200);
    const twoRowAmount = await reserveOnInvoiceAmount(twoRows.planId);

    // ⛔ ÖLÇÜLMÜŞ REZERVASYON TUTARI — "yalnız dolu satırı taşır" bir
    // SAYIDIR, bir cümle değil.
    expect(twoRowAmount).toBeGreaterThan(oneRowAmount);
  });

  // ── VAKA 2 — kısmi satır (dokunulmuş ama eksik) → rezervasyon REDDİ ──
  it('vaka 2: kısmi satır (dokunulmuş, PLAN_VOL eksik) → REZERVASYON REDDİ, ALAN ADIYLA (Q20/Z77)', async () => {
    const { planId, planSkuIds, fuVersion } = await createPlanWithFu('V2');
    // ⛔ Kapı yalnız `USABLE` (total_spend > 0) dalının İÇİNDE (Z77 §1
    // A/B ayrımı, `plan.service.ts` submit yorumu). Tek satır KISMİ ve
    // tek dolu satırsa toplam `0` kalır (`NO_SPEND`, kapı hiç koşmaz) —
    // bu yüzden BİR satır TAM (spend > 0 üretir), BİR satır KISMİ
    // (dokunulmuş, `plannedVolume` eksik) olacak şekilde kuruldu: "A —
    // bazı SKU'da PLAN_VOL var, bazısında YOK" vakası.
    await setVolume(planId, planSkuIds[0], 800, 1000); // TAM — spend > 0
    // Yalnız baseVolume gönderilir — plannedVolume dokunulmadan NULL kalır.
    // ⛔ Bu satır UNTOUCHED DEĞİL (baseVolume dolu) — KISMİ.
    await setVolume(planId, planSkuIds[1], 800, undefined);
    await setTactics(planId, fuVersion);

    const res = await submit(planId);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESERVATION_INPUT_INCOMPLETE');
    expect(res.body.message).toContain('PLAN_VOL');

    // Hiçbir RESERVE satırı YAZILMAMALI — kapı yazmadan ÖNCE reddediyor.
    const rows = await dataSource.query(
      `SELECT id FROM main.budget_transactions
        WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'`,
      [planId],
    );
    expect(rows.length).toBe(0);
  });

  // ── VAKA 3 — 0-dolu satır → submit-uyarısı "boş plan", BLOKLAMAZ ──
  it('vaka 3: 0-dolu satır (hiç dokunulmadı) → submit 200 + "boş plan" uyarısı, BLOKLAMAZ (Q20)', async () => {
    const { planId } = await createPlanWithFu('V3');
    // Hiçbir SKU satırına dokunulmadı — 4 satır da UNTOUCHED doğar.
    const res = await submit(planId);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING_APPROVAL');
    // Uyarı gövdesi `budgetCheck.warnings`'te taşınır (submit endpoint'in
    // sözleşmesi, `plan.controller.ts` doc notu).
    expect(res.body.budgetCheck?.warnings ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining('Plan boş')]),
    );

    // Hiçbir SKU'ya spend katkısı yok ⇒ hiçbir RESERVE satırı da yok
    // (`PlanSpendBreakdown` `NO_SPEND` dalı — zarfa hiçbir şey yazılmaz).
    const rows = await dataSource.query(
      `SELECT id FROM main.budget_transactions
        WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'`,
      [planId],
    );
    expect(rows.length).toBe(0);
  });

  // ── VAKA 4 — kısmi satır, BPTT YOK → REZERVASYON REDDİ, ALAN ADIYLA (R2) ──
  //
  // `R2`: BPTT-null dalı üretimde ulaşılabilir (`main.skus.unit_price` DB
  // seviyesinde nullable) ama seed'de tanığı yok. Bu test PARA YOLUNUN
  // UÇTAN UCA tanığıdır — unit seviyesindeki `sku-spend-inputs.spec.ts` /
  // `submission-checks.spec.ts` kapsaması bunun YERİNE geçmez (`DISIPLIN`:
  // negatif davranışsal kanıt, tetikleyen fixture olmadan kanıt değildir).
  it('vaka 4: kısmi satır (dokunulmuş, BPTT eksik) → REZERVASYON REDDİ, ALAN ADIYLA (Q20/Z77/R2)', async () => {
    const { planId, planSkuIds, fuVersion } = await createPlanWithFu('V4');
    // Bir satır TAM (spend > 0 üretir, `USABLE` dalını açar — vaka 2'deki
    // "A" deseninin AYNISI: kapı yalnız total_spend > 0 iken koşar).
    await setVolume(planId, planSkuIds[0], 800, 1000);
    // İkinci satır da hacim olarak TAM — eksik olan BPTT (SKU ana-verisi),
    // satırın kendi alanı DEĞİL.
    await setVolume(planId, planSkuIds[1], 800, 1000);

    await withNulledUnitPrice(planSkuIds[1], async () => {
      await setTactics(planId, fuVersion);

      const res = await submit(planId);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RESERVATION_INPUT_INCOMPLETE');
      // ⛔ AYIRT EDİCİ: vaka 2 'PLAN_VOL' içeriyordu, bu 'BPTT' içerir —
      // aynı sınıf (`NOT_EVALUABLE`), FARKLI alan adı, farklı cümle.
      expect(res.body.message).toContain('BPTT');
      expect(res.body.message).not.toContain('PLAN_VOL');

      // Hiçbir RESERVE satırı YAZILMAMALI — kapı yazmadan ÖNCE reddediyor.
      const rows = await dataSource.query(
        `SELECT id FROM main.budget_transactions
          WHERE source_type = 'PLAN' AND source_id = $1 AND tx_type = 'RESERVE'`,
        [planId],
      );
      expect(rows.length).toBe(0);
    });

    // ⛔ RESTORE KANITI: `withNulledUnitPrice`'ın kendi `finally`'si zaten
    // okuyarak doğruluyor (yukarıda, `restored[0].unit_price` karşılaştırması
    // fırlatmadıysa geçmiştir) — burada AYRICA, bu testin dışından
    // (yeni bir okuma) bir kez daha doğrula: fixture testin SONUNDA kirli
    // KALMAMALI.
    const finalPrice = await dataSource.query(
      `SELECT unit_price FROM main.skus WHERE id = $1`,
      [planSkuIds[1]],
    );
    expect(finalPrice.length).toBe(1);
    expect(finalPrice[0].unit_price).not.toBeNull();
  });
});
