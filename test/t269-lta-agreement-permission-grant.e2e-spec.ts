/**
 * t269-lta-agreement-permission-grant.e2e-spec.ts
 *
 * [[T-269]] — LTA yaşam döngüsünün TAMAMI `500` veriyordu, ve altında
 * ikinci bir kusur vardı (plan override hiç uygulanmıyordu). İKİ kusur
 * TEK turda düzeltildi (CLAUDE.md: "bir kusur başka bir kusur tarafından
 * örtülebilir — dıştaki düzeltilince içteki ORTAYA ÇIKAR").
 *
 * ── KUSUR 1 (GRANT) ─────────────────────────────────────────────────
 * `lta-agreement.repository.ts:39` `findById`'nin `relations` dizisi
 * `'planOverrides'` taşıyordu, ve `app_runtime`'ın `main.lta_plan_overrides`
 * üzerinde SIFIR ayrıcalığı vardı — ölçüldü:
 *   `has_table_privilege('app_runtime','main.lta_plan_overrides','SELECT')`
 *   → f (GRANT'ten ÖNCE), POZ. KONTROL `main.lta_agreements` → t.
 * `findById`'yi BEŞ metot çağırıyor — bu dosya `findOne`'ı (T-265'in
 * tüketicisiz ucu) hedefliyor.
 *
 * ── KUSUR 2 (join eksik) ────────────────────────────────────────────
 * `lta-agreement.service.ts:420`'nin `agreement.planOverrides` kontrolü
 * `findActiveForCPL`'den gelen `agreement`de HER ZAMAN `undefined`'dı —
 * o metot `planOverrides`'ı hiç join etmiyordu. Sonuç: canlı harcama
 * hesabı (`spend-calculation.service.ts` → `getLtaContextForPlan` →
 * `getLTAForPlanContext`) plan bazlı müzakere edilmiş LTA oranını
 * SESSİZCE yok sayıp varsayılan orana çöküyordu (`§2.5` ihlali).
 *
 * Bu dosyanın "override" describe bloğu, bunu GERÇEK üretim yolundan
 * (`PATCH /plans/:id/fus/:fuId/skus/:skuId/volume` → plan recalc →
 * `BASE_LTA_ON`/`BASE_LTA_OFF` KPI'ları) ÖNCE/SONRA ölçerek kanıtlıyor —
 * `getLTAForPlanContext`'i izole çağırmak yerine, `plan.service.ts:2260`
 * `getLtaContextForPlan`'ın gerçekten kullandığı zinciri.
 *
 * ── [[T-271]] (2026-08-23) — KUSUR 3 + KUSUR 4, AYNI TURDA DÜZELTİLDİ ──
 *
 * T-269'un DUR bıraktığı iki AYRI kusur — biri diğerini maskeliyordu
 * (CLAUDE.md: "bir kusur başka bir kusur tarafından örtülebilir —
 * dıştaki düzeltilince içteki ORTAYA ÇIKAR").
 *
 * KUSUR 3 — `app_runtime`, `main.lta_agreements` VE `main.lta_rates`
 * üzerinde SIFIR INSERT/UPDATE ayrıcalığına sahipti (yalnız SELECT —
 * `02-runtime-grants.sql` tur 10/11). Ölçüldü (düzeltmeden ÖNCE):
 *   SET ROLE app_runtime;
 *   INSERT INTO main.lta_agreements (...) VALUES (...);
 *     → ERROR: permission denied for table lta_agreements
 * Düzeltme: `02-runtime-grants.sql` S3 tur 25 —
 *   `GRANT INSERT, UPDATE ON lta_agreements` ·
 *   `GRANT INSERT, UPDATE, DELETE ON lta_rates`.
 *
 * ⚠️ `lta_rates UPDATE` İLK ölçümde (yalnız DI-çağrı grep'i) gereksiz
 * sanılmıştı — canlı sorgu logu çürüttü: `LTAAgreement.rates`
 * `{ cascade: true }`, ve `findById` her zaman `rates`'i yüklüyor; bu
 * yüzden `updateAgreement`/`activateAgreement`/`terminateAgreement`'ın
 * HİÇBİRİ rate'lere DOKUNMASA bile `.save(agreement)` cascade'i
 * `lta_rates`'e bir UPDATE dener (`UPDATE lta_rates SET channel_id = $1,
 * category_id = $2 ... WHERE id IN ($3)`). `02-runtime-grants.sql`
 * S3 tur 25 yorumunda tam ölçüm var. Bu, DI-çağrı taramasının
 * YAKALAYAMADIĞI beşinci bir yüzey (ORM cascade) — `§ DÖRT YÜZEY`'e
 * eklenmesi gereken bir ders, Team Lead'e ayrıca raporlandı.
 *
 * ⚠️ RAPOR (bu turda GENİŞLETİLMEDİ — `touches:` `lta-agreement.service.ts`'i
 * KAPSAMIYOR): `LTAAgreement.planOverrides` AYNI `{ cascade: true }`'ı
 * taşıyor ve `findById` onu da her zaman yüklüyor. Bu dosyanın testlerinde
 * override dizisi HER ZAMAN boş olduğu için cascade hiç ateşlemedi — ama
 * bir agreement'ın GERÇEK bir `lta_plan_overrides` satırı varken
 * `PATCH`/`activate`/`terminate` çağrılırsa AYNI cascade mekanizması
 * `lta_plan_overrides`'a yazmayı dener ve `permission denied` ile 500
 * verir (o tablo BİLEREK yalnız SELECT alıyor — tur 24). Yeni bir task
 * gerektirir; iki olası çözüm `02-runtime-grants.sql` S3 tur 25 yorumunda.
 *
 * KUSUR 4 — `findOverlappingAgreements`'in (`lta-agreement.repository.ts`)
 * raw SQL fragment'i `:expiryDate`'i AYNI positional parametrede (`$5`)
 * üç farklı bağlamda kullanıyordu, ve ilk kullanımı (`$5 IS NOT NULL`)
 * tip ipucu VERMİYORDU — Postgres extended query protocol'ünde bu,
 * DEĞERDEN BAĞIMSIZ olarak "could not determine data type of parameter
 * $5" ile HER ZAMAN düşüyordu (ölçüldü: hem `expiryDate` GÖNDERİLMEDEN
 * hem GERÇEK bir tarihle aynı hata). GRANT'ten TAMAMEN BAĞIMSIZDI —
 * Kusur 3 tek başına düzeltilseydi bu metodu çağıran uçlar YİNE 500
 * verirdi (bu yüzden ikisi AYNI turda düzeltildi).
 * Düzeltme: `lta-agreement.repository.ts` `findOverlappingAgreements` —
 * `:expiryDate::date IS NOT NULL` (kolon tipiyle BİREBİR cast, ilk
 * kullanıma tip bağlıyor).
 *
 * ── PER-UÇ ATIF (ölçülmüş, düzeltmeden ÖNCEki durum) ──────────────────
 *   createAgreement    → KUSUR 4 (`validateNoOverlappingAgreements` HER
 *                         ZAMAN çağrılır, INSERT'e hiç ULAŞILMIYORDU —
 *                         Kusur 3'ü MASKELİYORDU)
 *   activateAgreement  → KUSUR 4 (aynı çağrı, UPDATE'e hiç ULAŞILMIYORDU
 *                         — Kusur 3'ü MASKELİYORDU)
 *   updateAgreement    → KUSUR 3 (bu testin DTO'su `effectiveDate`/
 *                         `expiryDate` GÖNDERMİYOR → Kusur 4'ün olduğu
 *                         kod yolu hiç ÇALIŞMIYOR, doğrudan UPDATE'e düşer)
 *   terminateAgreement → KUSUR 3 (`validateNoOverlappingAgreements`'ı
 *                         HİÇ ÇAĞIRMIYOR, doğrudan UPDATE'e düşer)
 *
 * `createAgreement`'ın "yaz-sonra-oku" tehlikesi düzeltmeden SONRA
 * GERÇEKTEN materyalize olabilir — artık satır GERÇEKTEN yazılıyor.
 * Aşağıdaki test bunu canlı ölçer (satır yazıldı VE `findById` onu
 * gerçekten okuyabiliyor mu).
 *
 * ── İKİ-GİRDİLİ ÇAKIŞMA SINAVI (ayrı ölçüm, task raporunda) ───────────
 * `findOverlappingAgreements` bugüne kadar hiç doğru çalışmadığı için
 * doğruluğu bilinmiyordu (§: "bir kuralın doğru olduğunu kırmızıya
 * dönmemesinden çıkarma"). Canlı ölçüm — gerçek CPL, aynı tarih ailesi:
 *   çakışan (içe düşen, tarihli)         → 409 Conflict ✓
 *   çakışan (açık uçlu, effective içeride) → 409 Conflict ✓
 *   çakışmayan (tarihli, sonraki aralık)   → 201 Created ✓
 *   çakışmayan (açık uçlu, sonraki tarih)  → 201 Created ✓
 * Dördü de görev raporunda; bu dosyaya ayrı bir e2e olarak eklenmedi
 * (kapsam: `touches:` bu dosyayı Kusur 3/4 pin testlerini ÇEVİRMEK için
 * listeliyor, yeni bir describe bloğu değil).
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

describe('T-269 — LTA agreement: app_runtime GRANT + plan-override join', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await closeTestApp();
    await closeAdminDataSource();
  });

  beforeEach(() => clearTokenCache());

  // ────────────────────────────────────────────────────────────────────
  // Kusur 1 — GET /lta-agreements/:id: 500 → 200/404
  // ────────────────────────────────────────────────────────────────────
  describe('GET /lta-agreements/:id — findById + planOverrides join (Kusur 1)', () => {
    let agreementId: string;

    beforeAll(async () => {
      // `createAgreement` (POST) 500 veriyor (Kusur 3, kapsam dışı) — bu
      // yüzden fixture doğrudan `app_migrate` (admin) bağlantısıyla
      // yazılıyor. T-249'un `insertNotification` deseniyle AYNI gerekçe:
      // app_runtime'ın bu tabloda INSERT'i yok.
      const admin = await getAdminDataSource();
      const rows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_agreements
           (tenant_id, cpl_id, agreement_name, agreement_code, effective_date, status)
         VALUES ($1, $2, 'T-269 e2e fixture', $3, '2026-01-01', 'active')
         RETURNING id`,
        [fixture.tenantId, fixture.cplId, `T269_E2E_${Date.now()}`],
      );
      agreementId = rows[0].id;
    });

    afterAll(async () => {
      const admin = await getAdminDataSource();
      await admin.query(`DELETE FROM main.lta_agreements WHERE id = $1`, [
        agreementId,
      ]);
    });

    it('GET /lta-agreements/:id — 200, planOverrides:[] döner (önceden 500 — permission denied for table lta_plan_overrides)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get(`/lta-agreements/${agreementId}`)
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(agreementId);
      // Relations dizisi 'planOverrides' taşıyor — boş de olsa alan var
      // olmalı (join'in GERÇEKTEN çalıştığının kanıtı, yalnız 200'ün değil).
      expect(res.body.planOverrides).toEqual([]);
    });

    it('POZ. KONTROL — GET /lta-agreements/<var olmayan id> — 404 (guard geçildi, satır gerçekten yok; 500 DEĞİL)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get('/lta-agreements/00000000-0000-0000-0000-000000000099')
        .set(planner.authHeader());

      expect(res.status).toBe(404);
    });

    it("POZ. KONTROL — GET /lta-agreements (liste) — 200 [] (rota ailesi ve auth zaten çalışıyordu, Kusur 1'den ETKİLENMEMİŞTİ)", async () => {
      const readonly = await loginAs(app, 'READONLY');

      const res = await request(app.getHttpServer())
        .get('/lta-agreements')
        .set(readonly.authHeader());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Kusur 2 — plan override, CANLI harcama hesabında ÖNCE/SONRA
  // ────────────────────────────────────────────────────────────────────
  describe('Plan override, canlı harcama hesabında ateşliyor (Kusur 2)', () => {
    const PLAN_NAME = `E2E-T269-OVR-${Date.now()}`;
    let planId: string;
    let planFuCatalogId: string;
    let skuId: string;
    let listPrice: number;
    let agreementId: string;
    let rateId: string;

    beforeAll(async () => {
      // Sabit seed kodları (T-249 spec'inin de kullandığı fixture'lar).
      const [channelNka, categorySacBoyasi, fuTupBoya] = await Promise.all([
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
      planFuCatalogId = fuTupBoya;

      const planner = await loginAs(app, 'PLANNER');

      const planRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: PLAN_NAME,
          cplId: fixture.cplId,
          channelId: channelNka,
          categoryId: categorySacBoyasi,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      planId = planRes.body.id;

      await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: planFuCatalogId, planVersion: 1 })
        .expect(201);

      // İlk plan_sku'yu al — hangisi olduğu önemli değil, hepsi aynı
      // unitPrice'a sahip (master data), formül ondan bağımsız doğrulanıyor.
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

      // LTA agreement + rate: `createAgreement` 500 verdiği için (Kusur 3,
      // kapsam dışı) admin bağlantısıyla doğrudan yazılıyor.
      const admin = await getAdminDataSource();
      const agreementRows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_agreements
           (tenant_id, cpl_id, agreement_name, agreement_code, effective_date, status)
         VALUES ($1, $2, 'T-269 override fixture', $3, '2026-01-01', 'active')
         RETURNING id`,
        [fixture.tenantId, fixture.cplId, `T269_OVR_${Date.now()}`],
      );
      agreementId = agreementRows[0].id;

      const rateRows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_rates
           (tenant_id, lta_agreement_id, channel, category, on_invoice_percentage, off_invoice_percentage, is_active)
         VALUES ($1, $2, 'ALL', 'ALL', 5, 3, true)
         RETURNING id`,
        [fixture.tenantId, agreementId],
      );
      rateId = rateRows[0].id;
    });

    afterAll(async () => {
      const admin = await getAdminDataSource();
      // `lta_plan_overrides.plan_id` -> `plans` FK'si ON DELETE CASCADE
      // (`lta-plan-override.entity.ts:52`) — plan silinince override satırı
      // da gider, ayrı bir DELETE gerekmiyor.
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-T269-');
      await admin.query(`DELETE FROM main.lta_agreements WHERE id = $1`, [
        agreementId,
      ]);
    });

    async function patchBaseVolumeAndReadLtaKpis(version: number): Promise<{
      baseLtaOn: number;
      baseLtaOff: number;
    }> {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/fus/${planFuCatalogId}/skus/${skuId}/volume`)
        .set(planner.authHeader())
        .send({ baseVolume: 1000, version })
        .expect(200);

      return {
        baseLtaOn: res.body.calculatedKpis.BASE_LTA_ON.value,
        baseLtaOff: res.body.calculatedKpis.BASE_LTA_OFF.value,
      };
    }

    it('ÖNCE (override yok) — BASE_LTA_ON/OFF varsayılan orana (5%/3%) göre hesaplanıyor', async () => {
      const before = await patchBaseVolumeAndReadLtaKpis(1);

      const baseGsv = 1000 * listPrice;
      const expectedOn = (baseGsv * 5) / 100;
      const expectedOff = ((baseGsv - expectedOn) * 3) / 100;

      expect(before.baseLtaOn).toBeCloseTo(expectedOn, 2);
      expect(before.baseLtaOff).toBeCloseTo(expectedOff, 2);
    });

    it('SONRA (plan-scoped override eklendi) — BASE_LTA_ON/OFF override orana (10%/1%) göre değişiyor, VE önceki değerden FARKLI (Kusur 2 kapandı)', async () => {
      const beforeGsv = 1000 * listPrice;
      const beforeOn = (beforeGsv * 5) / 100;
      const beforeOff = ((beforeGsv - beforeOn) * 3) / 100;

      // Kusur 2 düzeltilmeden ÖNCE bu satırın hiçbir etkisi OLMAZDI —
      // `findActiveForCPL` `planOverrides`'ı join etmediği için
      // `agreement.planOverrides` her zaman undefined'dı ve override dalı
      // hiç ateşlemezdi.
      const admin = await getAdminDataSource();
      const overrideRows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_plan_overrides
           (tenant_id, plan_id, lta_rate_id, lta_agreement_id,
            override_on_invoice_pct, override_off_invoice_pct, override_reason)
         VALUES ($1, $2, $3, $4, 10, 1, 'T-269 e2e — before/after ölçüm')
         RETURNING id`,
        [fixture.tenantId, planId, rateId, agreementId],
      );

      const after = await patchBaseVolumeAndReadLtaKpis(2);

      const afterGsv = 1000 * listPrice;
      const expectedOnAfter = (afterGsv * 10) / 100;
      const expectedOffAfter = ((afterGsv - expectedOnAfter) * 1) / 100;

      expect(after.baseLtaOn).toBeCloseTo(expectedOnAfter, 2);
      expect(after.baseLtaOff).toBeCloseTo(expectedOffAfter, 2);

      // Asıl iddia: override dalı İLK KEZ ateşledi ve sayı GERÇEKTEN
      // değişti (aynı kalmadı) — CLAUDE.md "bir düzeltme, düzelttiği
      // sınıfın yeni bir vakasını üretebilir" disiplini: burada tersine,
      // düzeltmenin GERÇEKTEN etkili olduğunu (no-op olmadığını) kanıtlıyor.
      expect(after.baseLtaOn).not.toBeCloseTo(beforeOn, 2);
      expect(after.baseLtaOff).not.toBeCloseTo(beforeOff, 2);

      void overrideRows; // yalnız insert'in başarılı olduğunu (id döndüğünü) kanıtlamak için tutuluyor
      expect(overrideRows).toHaveLength(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // [[T-271]] — Kusur 3 (GRANT) + Kusur 4 (tipsiz parametre) AYNI turda
  // düzeltildi. Bu dört test T-269'un "kusur pini" testleriydi (bugünkü
  // kırmızıyı poz. kontrollü assert ediyorlardı) — CLAUDE.md "kusur pini"
  // sınıfı: düzeltmede SİLİNMEZ, YEŞİLE ÇEVRİLİR (T-260 dersi).
  // ────────────────────────────────────────────────────────────────────
  describe('Dört canlı @Roles(ADMIN) ucu — Kusur 3 + Kusur 4 DÜZELTİLDİ ([[T-271]])', () => {
    let probeAgreementId: string;
    let probeRateId: string;
    let createCplId: string;

    beforeAll(async () => {
      const admin = await getAdminDataSource();
      const rows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_agreements
           (tenant_id, cpl_id, agreement_name, agreement_code, effective_date, status)
         VALUES ($1, $2, 'T-271 probe (write-path)', $3, '2026-01-01', 'draft')
         RETURNING id`,
        [fixture.tenantId, fixture.cplId, `T271_PROBE_${Date.now()}`],
      );
      probeAgreementId = rows[0].id;

      // "POST /lta-agreements" testi AYRI bir CPL kullanıyor —
      // `probeAgreementId` (yukarısı) `fixture.cplId` için AÇIK UÇLU
      // (`expiry_date` NULL, `effective_date` GEÇMİŞTE) bir kayıt; bu CPL
      // için oluşturulacak HERHANGİ bir gelecek tarihli agreement gerçek
      // bir çakışmaya düşer (findOverlappingAgreements'ın 1. OR kolu).
      // Create testi Kusur 3/4'ü (GRANT + tip cast) ölçmek istiyor,
      // çakışma kuralını değil — o ayrı describe'da ("iki-girdili sınav").
      const otherCpl: Array<{ id: string }> = await admin.query(
        `SELECT id FROM main.cpls WHERE tenant_id = $1 AND id != $2 LIMIT 1`,
        [fixture.tenantId, fixture.cplId],
      );
      if (!otherCpl || otherCpl.length === 0) {
        throw new Error(
          'E2E fixture eksik: fixture.cplId DIŞINDA ikinci bir CPL bulunamadı (`npm run seed` çalıştırın).',
        );
      }
      createCplId = otherCpl[0].id;

      // Bir rate satırı EKLENİYOR — `lta_rates` UPDATE grant'inin ölçtüğü
      // cascade davranışı (`LTAAgreement.rates` `{ cascade: true }`) yalnız
      // `agreement.rates` DOLUYSA ateşler. Rate'siz bir agreement'ta PATCH/
      // activate/terminate `lta_rates`'e hiç dokunmaz — bu satır olmadan
      // test, S3 tur 25'in düzelttiği gerçek yolu ÖLÇMEZ.
      const rateRows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_rates
           (tenant_id, lta_agreement_id, channel, category, on_invoice_percentage, off_invoice_percentage, is_active)
         VALUES ($1, $2, 'ALL', 'ALL', 5, 3, true)
         RETURNING id`,
        [fixture.tenantId, probeAgreementId],
      );
      probeRateId = rateRows[0].id;
    });

    afterAll(async () => {
      const admin = await getAdminDataSource();
      // `lta_rates.lta_agreement_id` -> `lta_agreements` FK'si ON DELETE
      // CASCADE (`lta-rate.entity.ts:76-79`) — agreement silinince rate
      // satırı da gider, ayrı bir DELETE gerekmiyor.
      await admin.query(`DELETE FROM main.lta_agreements WHERE id = $1`, [
        probeAgreementId,
      ]);
      void probeRateId; // yalnız beforeAll'ın insert'i başarılı olduğunu (id döndüğünü) doğrulamak için tutuluyor
    });

    it("POST /lta-agreements (ADMIN) — 201: KUSUR 4 düzeltildi (validateNoOverlappingAgreements artık düşmüyor), KUSUR 3 düzeltildi (INSERT/lta_agreements + INSERT/lta_rates izinli) — satır GERÇEKTEN yazılıyor VE 'yaz-sonra-oku' (findById) GERÇEKTEN okuyor", async () => {
      const admin = await loginAs(app, 'ADMIN');
      const code = `T271_CREATE_PROBE_${Date.now()}`;

      const res = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          cplId: createCplId,
          agreementName: 'T-271 create probe',
          agreementCode: code,
          effectiveDate: '2027-09-01',
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: 5,
              offInvoicePercentage: 3,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.agreementCode).toBe(code);
      // "yaz-sonra-oku" tehlikesi ([[T-269]] görev dosyasının endişesi,
      // artık MATERYALİZE OLABİLİR çünkü INSERT gerçekten çalışıyor):
      // `createAgreement`'ın son satırı ayrı bir `findById` ile okuyor —
      // response'un dolu gelmesi (rates dahil) o okumanın BAŞARILI
      // olduğunun kanıtı, yalnız 201'in değil.
      expect(res.body.rates).toHaveLength(1);

      // Poz. kontrol: satır GERÇEKTEN yazıldı (Kusur 4 öncesi satır hiç
      // yazılmıyordu — bu artık tersi).
      const rows = await dataSource.query(
        `SELECT id FROM main.lta_agreements WHERE agreement_code = $1`,
        [code],
      );
      expect(rows).toHaveLength(1);

      // Test verisi temizliği (görev dosyası: "ölçtüğün satırları temizle").
      const admin2 = await getAdminDataSource();
      await admin2.query(`DELETE FROM main.lta_agreements WHERE id = $1`, [
        res.body.id,
      ]);
    });

    it("PATCH /lta-agreements/:id (ADMIN) — 200: KUSUR 3 düzeltildi (UPDATE/lta_agreements izinli). Bu DTO tarih alanı GÖNDERMİYOR → Kusur 4'ün kod yoluna hiç girmiyor, doğrudan UPDATE'e düşüyor VE agreement.rates DOLU olduğu için cascade UPDATE/lta_rates'e de düşüyor (S3 tur 25'in asıl ölçtüğü yol)", async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/lta-agreements/${probeAgreementId}`)
        .set(admin.authHeader())
        .send({ notes: 'T-271 probe update' });

      expect(res.status).toBe(200);
      expect(res.body.notes).toBe('T-271 probe update');
      // Cascade UPDATE'in GERÇEKTEN çalıştığının kanıtı (yalnız 200'ün
      // değil): rate satırı hâlâ dönüyor, kaybolmadı/hata vermedi.
      expect(res.body.rates).toHaveLength(1);
      expect(res.body.rates[0].id).toBe(probeRateId);
    });

    it("POST /lta-agreements/:id/activate (ADMIN) — 204: KUSUR 4 düzeltildi (activateAgreement'ın validateNoOverlappingAgreements'ı artık düşmüyor), KUSUR 3 düzeltildi (UPDATE/lta_agreements + cascade UPDATE/lta_rates izinli)", async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/lta-agreements/${probeAgreementId}/activate`)
        .set(admin.authHeader());

      expect(res.status).toBe(204);

      const rows = await dataSource.query(
        `SELECT status FROM main.lta_agreements WHERE id = $1`,
        [probeAgreementId],
      );
      expect(rows[0].status).toBe('active');
    });

    it('POST /lta-agreements/:id/terminate (ADMIN) — 204: KUSUR 3 düzeltildi (validateNoOverlappingAgreements HİÇ ÇAĞRILMIYOR — doğrudan UPDATE/lta_agreements + cascade UPDATE/lta_rates, ikisi de artık izinli)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/lta-agreements/${probeAgreementId}/terminate`)
        .set(admin.authHeader())
        .send({ reason: 'T-271 probe terminate' });

      expect(res.status).toBe(204);

      const rows = await dataSource.query(
        `SELECT status, notes FROM main.lta_agreements WHERE id = $1`,
        [probeAgreementId],
      );
      expect(rows[0].status).toBe('terminated');
      expect(rows[0].notes).toContain('T-271 probe terminate');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // [[T-271]] — `findOverlappingAgreements` bugüne kadar Kusur 4 yüzünden
  // hiç ateşlemiyordu, yani doğruluğu BİLİNMİYORDU (CLAUDE.md: "bir
  // kuralın doğru olduğunu kırmızıya dönmemesinden çıkarma"). İki-girdili
  // sınav: en az bir GERÇEK çakışma ve bir çakışmayan vaka.
  // ────────────────────────────────────────────────────────────────────
  describe('findOverlappingAgreements — iki-girdili sınav (Kusur 4 düzeltmesi, [[T-271]])', () => {
    let baseAgreementId: string;
    const createdIds: string[] = [];

    beforeAll(async () => {
      const admin = await getAdminDataSource();
      const rows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_agreements
           (tenant_id, cpl_id, agreement_name, agreement_code, effective_date, expiry_date, status)
         VALUES ($1, $2, 'T-271 overlap base', $3, '2027-03-01', '2027-06-30', 'active')
         RETURNING id`,
        [fixture.tenantId, fixture.cplId, `T271_OVR_BASE_${Date.now()}`],
      );
      baseAgreementId = rows[0].id;
    });

    afterAll(async () => {
      const admin = await getAdminDataSource();
      await admin.query(
        `DELETE FROM main.lta_agreements WHERE id = ANY($1::uuid[])`,
        [[baseAgreementId, ...createdIds]],
      );
    });

    async function attemptCreate(
      effectiveDate: string,
      expiryDate?: string,
    ): Promise<number> {
      const admin = await loginAs(app, 'ADMIN');
      // `agreementCode` `@Matches(/^[A-Z0-9_]+$/)` ile sınırlı (DTO) —
      // `Math.random().toString(36)` KÜÇÜK harf üretir ve 400 Bad Request
      // verir (bu regex'in kendisi ilk yazımda ölçülmeden atlandı, sonra
      // canlı koşumda yakalandı: dört test de 409/201 yerine 400 aldı).
      const code = `T271_OVR_ATTEMPT_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const res = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          cplId: fixture.cplId,
          agreementName: 'T-271 overlap attempt',
          agreementCode: code,
          effectiveDate,
          ...(expiryDate ? { expiryDate } : {}),
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: 1,
              offInvoicePercentage: 1,
            },
          ],
        });

      if (res.status === 201) {
        createdIds.push(res.body.id);
      }
      return res.status;
    }

    it('ÇAKIŞAN (tarihli, base aralığın İÇİNE düşüyor) — 409 Conflict, 500 DEĞİL', async () => {
      const status = await attemptCreate('2027-04-01', '2027-05-01');
      expect(status).toBe(409);
    });

    it('ÇAKIŞAN (expiryDate YOK — açık uçlu, effective base aralığın içinde) — 409 Conflict, 500 DEĞİL', async () => {
      const status = await attemptCreate('2027-04-01');
      expect(status).toBe(409);
    });

    it('ÇAKIŞMAYAN (tarihli, base aralıktan SONRA) — 201 Created', async () => {
      const status = await attemptCreate('2027-07-01', '2027-09-30');
      expect(status).toBe(201);
    });

    it('ÇAKIŞMAYAN (expiryDate YOK — açık uçlu, effective base aralıktan SONRA) — 201 Created', async () => {
      const status = await attemptCreate('2027-10-01');
      expect(status).toBe(201);
    });
  });
});
