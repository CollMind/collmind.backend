/**
 * lta-lifecycle-bond-and-base-chain.e2e-spec.ts
 *
 * SÖZLEŞME: LTA oran şartları bir YAŞAM DÖNGÜSÜ kaydına bağlı doğar, ve o
 * bağın taşıdığı oran LTA TABAN ZİNCİRİNİ uçtan uca besler.
 *
 *   agreements(agreement_type=LTA)          ← kullanıcı formunun yazdığı yer
 *        │  (BAĞ — bu turda kuruldu, `1817000000000`)
 *        ▼
 *   lta_agreements + lta_rates              ← motorun okuduğu yer
 *        ▼
 *   LTAAgreementService.getLTAForPlanContext
 *        ▼
 *   SpendCalculationService  →  BASE_LTA_ON / BASE_LTA_OFF
 *        ▼
 *   BASE_NIV = BASE_GSV − BASE_LTA_ON       ← `T-334` sonrası kendi kodu
 *   BASE_TO  = BASE_GSV − BASE_TOTAL_SPEND  ← gerçek `TO` (on + off)
 *
 * ✅ **`Z65 §1` SAPMASI KAPANDI — [[T-334]] / `migration 1818` indi**
 * (2026-08-30). Şerh **silinmedi, GÜNCELLENDİ** (append-only iz):
 * `1781` `NIV` ihtiyacını `TO` adının üstüne yamamıştı (`Z65 §0`:
 * derleme-kaybı zinciri); `1818` kavramları ayırdı —
 * `BASE_TO = BASE_GSV − BASE_TOTAL_SPEND` ve
 * `BASE_NIV = BASE_GSV − BASE_LTA_ON`.
 * Aşağıdaki assertion **kırmızıya döndü ve güncellendi**; dönüşüm
 * ölçümüyle birlikte `4` numaralı adımda kayıtlıdır.
 *
 * 📌 Şerh `CLAUDE.md §7.1` `T-084` emsali yüzünden yazıldı: *"bir hatayı
 * belgelemek, onu KORUMA ALTINA ALIR"* — şerhsiz bırakılsaydı bu satır
 * sapmayı bir **sözleşme** olarak pinler ve `T-334`'ü "regresyon" diye
 * gösterirdi.
 *
 * ── KUSUR (ölçüldü 2026-08-30, canlı DB, şema-nitelendirilmiş) ───────────
 *   lta_agreements 0 · lta_rates 0 · lta_plan_overrides 0
 *   agreements WHERE agreement_type='LTA'  =  1     ← form BURAYA yazıyor
 * İki tablo arasında hiçbir bağ yoktu: bir oran-şartları başlığı HİÇBİR
 * yaşam döngüsü kaydına ait olmadan doğabiliyordu, ve motorun uyguladığı
 * indirimin onaylı/denetlenebilir bir anlaşmaya izi sürülemiyordu
 * (`Z38 §3`: *"bağ + eksik yüzey"*).
 *
 * ── REPRODÜKSİYON (düzeltmeden ÖNCE koşturuldu) ─────────────────────────
 * Aşağıdaki `describe`ların ikisi de KIRMIZIydı, ve kırmızının SEBEBİ
 * doğrudan kusurun kendisiydi:
 *   POST /lta-agreements { agreementId: … }
 *     →  400 "property agreementId should not exist"
 *        (ValidationPipe `forbidNonWhitelisted:true`) — yani BAĞ ALANI YOK.
 *   POST /lta-agreements { agreementId YOK }
 *     →  201 — yani ÖKSÜZ bir oran-şartları başlığı DOĞABİLİYOR.
 *
 * ── FIXTURE (kalıcı değer taşır — `T-273` ailesi) ───────────────────────
 * `lta_rates` bugün 0 satır ⇒ zincir HİÇ KOŞMUYOR. Bu suite kalıcı bir
 * fixture kurar: on-invoice **%7**, off-invoice **%2**.
 * ⚠️ İki oran BİLEREK FARKLI (ve repodaki diğer LTA fixture'ının 5/3'ünden
 * de farklı) — `DISIPLIN` (`Z64 §5-1`): *"fixture farkı taşımak GEREKLİ;
 * o farkı OKUYAN assertion olmadan YETERSİZ."* Aşağıdaki assertion'lar
 * hem 7↔2 farkını hem 7↔5 farkını AYRI AYRI okur.
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

const ON_PCT = 7; // ⚠️ 5'ten (repodaki diğer fixture) ve 2'den FARKLI — bilerek
const OFF_PCT = 2;
const OTHER_FIXTURE_ON_PCT = 5; // ayırt-edicilik referansı

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

describe('LTA yaşam-döngüsü BAĞI + taban zinciri (T-293)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let channelNka: string;
  let categorySacBoyasi: string;
  let fuTupBoya: string;
  let tacticId: string;
  let mechanicId: string;

  const createdLifecycleAgreementIds: string[] = [];
  const createdLtaAgreementIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [channelNka, categorySacBoyasi, fuTupBoya] = await Promise.all([
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
          `SELECT id FROM main.forecasting_units WHERE tenant_id = $1 AND code = 'FU-TUP-BOYA'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
    ]);

    const tacticRows = await dataSource.query(
      `SELECT id FROM main.tactics WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId],
    );
    const mechanicRows = await dataSource.query(
      `SELECT id FROM main.mechanics WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId],
    );
    if (tacticRows.length === 0 || mechanicRows.length === 0) {
      throw new Error(
        'E2E fixture eksik: tactic/mechanic bulunamadı (`npm run seed` çalıştırın).',
      );
    }
    tacticId = tacticRows[0].id;
    mechanicId = mechanicRows[0].id;
  });

  afterAll(async () => {
    const admin = await getAdminDataSource();
    // ⚠️ Temizlik id LİSTESİNE DEĞİL, ÖN EKE dayanır — bir assertion
    // düştüğünde `push` satırına HİÇ ULAŞILMAZ ve satır sızar (`T-047`
    // invaryantı bunu bir kez yakaladı, kırmızı-öncesi koşumda).
    // `lta_rates.lta_agreement_id` FK'si ON DELETE CASCADE — rate satırı
    // ayrıca silinmez.
    await admin.query(
      `DELETE FROM main.lta_agreements WHERE tenant_id = $1 AND agreement_code LIKE 'T293\\_%'`,
      [fixture.tenantId],
    );
    void createdLtaAgreementIds;
    for (const id of createdLifecycleAgreementIds) {
      // ⚠️ SIRA ZORUNLU: `FK_lta_agreements_agreement` ON DELETE RESTRICT —
      // önce oran-şartları başlığı, sonra yaşam döngüsü kaydı.
      await admin.query(`DELETE FROM main.agreements WHERE id = $1`, [id]);
    }
    await closeTestApp();
    await closeAdminDataSource();
  });

  beforeEach(() => clearTokenCache());

  /** Kullanıcı formunun yazdığı yer: `main.agreements` (yaşam döngüsü). */
  async function createLifecycleAgreement(
    type: 'LTA' | 'STA',
  ): Promise<string> {
    const admin = await loginAs(app, 'ADMIN');
    // STA ≤ 30 gün, LTA > 30 gün (agreement.service.ts:100-111)
    const endDate = type === 'LTA' ? isoPlusDays(90) : isoPlusDays(20);
    const res = await request(app.getHttpServer())
      .post('/agreements')
      .set(admin.authHeader())
      .send({
        agreementName: `E2E-LTA-BOND-${type}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        agreementType: type,
        cplId: fixture.cplId,
        channelId: channelNka,
        categoryId: categorySacBoyasi,
        fuId: fuTupBoya,
        tacticId,
        mechanicId,
        skuScope: 'FU',
        capTotalAmount: 100000,
        spendType: 'BOTH',
        startDate: isoToday(),
        endDate,
        justification: 'T-293 e2e — LTA yaşam döngüsü bağı',
      })
      .expect(201);
    createdLifecycleAgreementIds.push(res.body.id);
    return res.body.id;
  }

  // ────────────────────────────────────────────────────────────────────
  // BAĞ — oran şartları bir yaşam döngüsü kaydına BAĞLI DOĞAR
  // ────────────────────────────────────────────────────────────────────
  describe('Bağ: lta_agreements → agreements(LTA)', () => {
    // ⚠️ Bu blok `fixture.cplId` için AÇIK UÇLU (expiry yok) bir LTA
    // oran-şartları başlığı üretiyor; bırakılırsa bir sonraki describe'ın
    // `createAgreement`'ı `findOverlappingAgreements`'a takılıp 409 alır
    // (canlı koşumda ölçüldü). Bu yüzden blok kendi satırlarını siler.
    afterAll(async () => {
      const admin = await getAdminDataSource();
      await admin.query(
        `DELETE FROM main.lta_agreements
          WHERE tenant_id = $1 AND agreement_code LIKE 'T293\\_%'`,
        [fixture.tenantId],
      );
    });

    it('BAĞSIZ doğamaz — agreementId göndermeden POST /lta-agreements 400 (ÖNCE: 201, öksüz satır doğuyordu)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const res = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          cplId: fixture.cplId,
          agreementName: 'T-293 bağsız deneme',
          agreementCode: `T293_ORPHAN_${Date.now()}`,
          effectiveDate: isoToday(),
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: ON_PCT,
              offInvoicePercentage: OFF_PCT,
            },
          ],
        });

      expect(res.status).toBe(400);
      // Satır GERÇEKTEN yazılmadı — 400'ün "yan etkisiz" olduğunun kanıtı
      // (poz. kontrol: aşağıdaki mutlu yol AYNI uçtan 201 alıyor).
      const rows = await dataSource.query(
        `SELECT count(*)::int AS c FROM main.lta_agreements WHERE tenant_id = $1 AND agreement_name = $2`,
        [fixture.tenantId, 'T-293 bağsız deneme'],
      );
      expect(rows[0].c).toBe(0);
    });

    it('EBEVEYN LTA OLMALI — agreement_type=STA bir kayda bağlanamaz (400)', async () => {
      const staId = await createLifecycleAgreement('STA');
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          agreementId: staId,
          cplId: fixture.cplId,
          agreementName: 'T-293 STA ebeveyn denemesi',
          agreementCode: `T293_STAPARENT_${Date.now()}`,
          effectiveDate: isoToday(),
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: ON_PCT,
              offInvoicePercentage: OFF_PCT,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/LTA/);
    });

    it('MUTLU YOL — LTA ebeveynine bağlı doğar, ve bağ okunabilir (201 + agreementId)', async () => {
      const parentId = await createLifecycleAgreement('LTA');
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          agreementId: parentId,
          cplId: fixture.cplId,
          agreementName: 'T-293 bağlı oran şartları',
          agreementCode: `T293_BOUND_${Date.now()}`,
          effectiveDate: isoToday(),
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: ON_PCT,
              offInvoicePercentage: OFF_PCT,
            },
          ],
        });

      expect(res.status).toBe(201);
      createdLtaAgreementIds.push(res.body.id);
      expect(res.body.agreementId).toBe(parentId);

      // Bağ DB'de gerçekten var (yalnız response'ta değil).
      const rows = await dataSource.query(
        `SELECT agreement_id FROM main.lta_agreements WHERE id = $1`,
        [res.body.id],
      );
      expect(rows[0].agreement_id).toBe(parentId);

      // TEKİLLİK: aynı ebeveyne ikinci bir oran-şartları başlığı bağlanamaz.
      const dup = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          agreementId: parentId,
          cplId: fixture.cplId,
          agreementName: 'T-293 ikinci başlık',
          agreementCode: `T293_DUP_${Date.now()}`,
          effectiveDate: isoToday(),
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: ON_PCT,
              offInvoicePercentage: OFF_PCT,
            },
          ],
        });
      expect(dup.status).toBe(409);

      // ── review `S2` — KİMLİK ALANLARI PATCH'te SESSİZCE YOK SAYILMAZ ──
      // `UpdateLTAAgreementDto = PartialType(Create)` ⇒ `agreementId` ve
      // `cplId` şema düzeyinde KABUL edilir ama `Object.assign` ikisini de
      // UYGULAMAZ. `cplId` için bu, yaratımda `400` ile korunan
      // `parent.cplId === dto.cplId` invaryantının PATCH KAÇIŞ DELİĞİYDİ.
      const otherCplRows = await dataSource.query(
        `SELECT id FROM main.cpls WHERE tenant_id = $1 AND id <> $2 LIMIT 1`,
        [fixture.tenantId, fixture.cplId],
      );
      expect(otherCplRows).toHaveLength(1); // poz. kontrol: ikinci CPL var

      const patchCpl = await request(app.getHttpServer())
        .patch(`/lta-agreements/${res.body.id}`)
        .set(admin.authHeader())
        .send({ cplId: otherCplRows[0].id });
      expect(patchCpl.status).toBe(400);

      const patchBond = await request(app.getHttpServer())
        .patch(`/lta-agreements/${res.body.id}`)
        .set(admin.authHeader())
        .send({ agreementId: otherCplRows[0].id });
      expect(patchBond.status).toBe(400);

      // POZ. KONTROL — reddedilen şey KİMLİK alanları, PATCH'in kendisi
      // DEĞİL: kimlik-dışı bir alan aynı uçtan hâlâ geçiyor.
      const patchOk = await request(app.getHttpServer())
        .patch(`/lta-agreements/${res.body.id}`)
        .set(admin.authHeader())
        .send({ notes: 'T-293 S2 poz. kontrol' });
      expect(patchOk.status).toBe(200);

      // Ve DB gerçekten dokunulmadı (400 yan etkisiz)
      const after = await dataSource.query(
        `SELECT agreement_id, cpl_id FROM main.lta_agreements WHERE id = $1`,
        [res.body.id],
      );
      expect(after[0].agreement_id).toBe(parentId);
      expect(after[0].cpl_id).toBe(fixture.cplId);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // TABAN ZİNCİRİ — bağın taşıdığı oran, BASE_LTA_ON → BASE_TO'ya iniyor
  // ────────────────────────────────────────────────────────────────────
  describe('Taban zinciri: bağ → BASE_LTA_ON/OFF → BASE_TO', () => {
    const PLAN_NAME = `E2E-T293-CHAIN-${Date.now()}`;
    let planId: string;
    let skuId: string;
    let listPrice: number;

    beforeAll(async () => {
      const parentId = await createLifecycleAgreement('LTA');
      const admin = await loginAs(app, 'ADMIN');

      // Oran şartları — GERÇEK üretim ucundan (admin SQL'i DEĞİL).
      const ltaRes = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          agreementId: parentId,
          cplId: fixture.cplId,
          agreementName: 'T-293 taban zinciri fixture',
          agreementCode: `T293_CHAIN_${Date.now()}`,
          effectiveDate: isoToday(),
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: ON_PCT,
              offInvoicePercentage: OFF_PCT,
            },
          ],
        })
        .expect(201);
      createdLtaAgreementIds.push(ltaRes.body.id);

      await request(app.getHttpServer())
        .post(`/lta-agreements/${ltaRes.body.id}/activate`)
        .set(admin.authHeader())
        .expect(204);

      const planner = await loginAs(app, 'PLANNER');
      const planRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: PLAN_NAME,
          cplId: fixture.cplId,
          channelId: channelNka,
          categoryId: categorySacBoyasi,
          startDate: isoToday(),
          endDate: isoPlusDays(25),
        })
        .expect(201);
      planId = planRes.body.id;

      await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: fuTupBoya, planVersion: 1 })
        .expect(201);

      const planSkuRows: Array<{ sku_id: string; unit_price: string }> =
        await dataSource.query(
          `SELECT ps.sku_id, sk.unit_price
             FROM main.plan_skus ps
             JOIN main.skus sk ON sk.id = ps.sku_id
            WHERE ps.plan_fu_id = (
              SELECT id FROM main.plan_fus WHERE plan_id = $1 LIMIT 1
            )
            LIMIT 1`,
          [planId],
        );
      skuId = planSkuRows[0].sku_id;
      listPrice = parseFloat(planSkuRows[0].unit_price);
    });

    afterAll(async () => {
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-T293-');
    });

    it('BASE_LTA_ON/OFF bağın taşıdığı orandan (%7/%2) türüyor, ve BASE_TO = BASE_GSV − BASE_LTA_ON', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${fuTupBoya}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 1000, version: 1 })
        .expect(200);

      const kpis = res.body.calculatedKpis;
      const baseGsv = 1000 * listPrice;
      const expectedOn = (baseGsv * ON_PCT) / 100;
      const expectedOff = ((baseGsv - expectedOn) * OFF_PCT) / 100;

      // 1 · Zincir gerçekten koştu (bugün `lta_rates` 0 satır ⇒ hiç koşmuyordu)
      expect(kpis.BASE_GSV.value).toBeCloseTo(baseGsv, 2);
      expect(kpis.BASE_LTA_ON.value).toBeCloseTo(expectedOn, 2);
      expect(kpis.BASE_LTA_OFF.value).toBeCloseTo(expectedOff, 2);

      // 2 · FARKI OKUYAN assertion (Z64 §5-1): on ≠ off — iki oran
      //     karışsaydı bu düşerdi.
      expect(kpis.BASE_LTA_ON.value).not.toBeCloseTo(
        kpis.BASE_LTA_OFF.value,
        2,
      );
      // 3 · FARKI OKUYAN assertion: %7, repodaki diğer fixture'ın %5'i
      //     DEĞİL — bağ yanlış oran-şartları başlığına düşseydi bu düşerdi.
      expect(kpis.BASE_LTA_ON.value).not.toBeCloseTo(
        (baseGsv * OTHER_FIXTURE_ON_PCT) / 100,
        2,
      );

      // 4 · ✅ [[T-334]] İNDİ — DÖNÜŞÜM YAPILDI (2026-08-30, `migration 1818`)
      //
      // ŞERHİN ÖNCEKİ HÂLİ (silinmez, iz olarak kalır): bu satır
      // `BASE_GSV - BASE_LTA_ON`'u (migration `1781`) ölçüyordu ve
      // `Z65 §1` onu **SAPMA** ilan etmişti — o formül aslında **`NIV`**.
      // Şerhte *"`T-334` indiğinde bu assertion KIRMIZIYA DÖNECEK"*
      // yazıyordu; **döndü** (ölçüldü: beklenen `76139.10`, gelen
      // `74616.318`, fark `1522.782` = tam olarak `BASE_LTA_OFF`), ve
      // aşağıdaki iki satır o dönüşümün kaydıdır.
      //
      // ⛔ Ve pin artık İKİ KAVRAMI DA okuyor: `TO ≠ NIV` olduğunu
      // gösteren fark bir assertion'a bağlı (`DISIPLIN`: *"fark taşımak
      // gerekli, o farkı OKUYAN assertion olmadan yetersiz"*).
      expect(kpis.BASE_TO.value).toBeCloseTo(
        baseGsv - (expectedOn + expectedOff),
        2,
      );
      expect(kpis.BASE_NIV.value).toBeCloseTo(baseGsv - expectedOn, 2);
      expect(kpis.BASE_NIV.value! - kpis.BASE_TO.value!).toBeCloseTo(
        expectedOff,
        2,
      );
    });
  });
});
