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
 * ── ⚠️ İKİ YENİ BULUNAN KUSUR (bu turun kapsamı DIŞINDA, DÜZELTİLMEDİ) ──
 *
 * Bunlar T-269 görev dosyasının tanımladığı Kusur 1/Kusur 2'den TAMAMEN
 * AYRI iki bulgu — CLAUDE.md DUR listesi: "Dört canlı uçtan birinde YENİ
 * bir kusur bulursan (ölçümü tamamla, raporla, düzeltme kapsamını kendin
 * genişletme)". Aşağıdaki dört test bu iki YENİ, DÜZELTİLMEMİŞ gerçeği
 * kaydeder (T-249'un `plan.startDate.toISOString` bulgusuyla AYNI desen).
 *
 * KUSUR 3 — `app_runtime`, `main.lta_agreements` VE `main.lta_rates`
 * üzerinde SIFIR INSERT/UPDATE ayrıcalığına sahip (yalnız SELECT —
 * `02-runtime-grants.sql` tur 10/11). Ölçüldü:
 *   SET ROLE app_runtime;
 *   INSERT INTO main.lta_agreements (...) VALUES (...);
 *     → ERROR: permission denied for table lta_agreements
 *   UPDATE main.lta_agreements SET notes = 'x' WHERE id = '<var olan satır>';
 *     → ERROR: permission denied for table lta_agreements
 *
 * KUSUR 4 — `findOverlappingAgreements`'in (`lta-agreement.repository.ts`)
 * raw SQL fragment'i `:expiryDate`'i AYNI positional parametrede (`$5`)
 * üç farklı bağlamda kullanıyor, ve ilk kullanımı (`$5 IS NOT NULL`) tip
 * ipucu VERMİYOR — Postgres extended query protocol'ünde bu, DEĞERDEN
 * BAĞIMSIZ olarak "could not determine data type of parameter $5" ile
 * HER ZAMAN düşüyor. Ölçüldü — hem `expiryDate` GÖNDERİLMEDEN (`undefined`)
 * hem GERÇEK bir tarihle (`"2026-12-31"`) aynı hata, aynı satır:
 *   error: could not determine data type of parameter $5
 * (tam SQL + PARAMETERS task raporunda). Yani bu kusur GRANT'ten TAMAMEN
 * BAĞIMSIZ — Kusur 3'ün INSERT/UPDATE grant'i verilse bile bu metodu
 * çağıran uçlar YİNE 500 verir.
 *
 * ── PER-UÇ ATIF (ölçülmüş, tahmin değil) ─────────────────────────────
 *   createAgreement    → KUSUR 4 (`validateNoOverlappingAgreements` HER
 *                         ZAMAN çağrılır, INSERT'e hiç ULAŞILMIYOR —
 *                         Kusur 3'ü MASKELİYOR)
 *   activateAgreement  → KUSUR 4 (aynı çağrı, UPDATE'e hiç ULAŞILMIYOR —
 *                         Kusur 3'ü MASKELİYOR)
 *   updateAgreement    → KUSUR 3 (bu testin DTO'su `effectiveDate`/
 *                         `expiryDate` GÖNDERMİYOR → Kusur 4'ün olduğu
 *                         kod yolu hiç ÇALIŞMIYOR, doğrudan UPDATE'e düşer
 *                         — tarih alanı gönderen bir PATCH Kusur 4'e de
 *                         çarpar, bu dosyada ÖLÇÜLMEDİ)
 *   terminateAgreement → KUSUR 3 (`validateNoOverlappingAgreements`'ı
 *                         HİÇ ÇAĞIRMIYOR, doğrudan UPDATE'e düşer)
 *
 * `createAgreement`'ın "yaz-sonra-oku" tehlikesi (görev dosyasının
 * endişesi) bu yüzden MATERYALİZE OLMUYOR: hiçbir satır yazılmıyor —
 * ölçüldü (`SELECT ... WHERE agreement_code = ...` → 0 satır, hem
 * `expiryDate`'siz hem `expiryDate`'li `POST /lta-agreements` `500`
 * sonrası).
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
  // ⚠️ YENİ BULUNAN KUSUR (Kusur 3, bu turda DÜZELTİLMEDİ) — dört canlı
  // ADMIN ucu, `lta_agreements`/`lta_rates` üzerinde app_runtime'ın
  // SIFIR INSERT/UPDATE ayrıcalığı yüzünden AYRI bir sebeple 500 veriyor.
  // Bu testler CLAUDE.md DUR maddesinin gereği: "ölçümü tamamla, raporla,
  // düzeltme kapsamını kendin genişletme" — mevcut (kırmızı) gerçeği
  // kaydeder, gizlemez.
  // ────────────────────────────────────────────────────────────────────
  describe('Dört canlı @Roles(ADMIN) ucu — Kusur 1/2 DIŞINDA, AYRI bir izin boşluğu (raporlandı, düzeltilmedi)', () => {
    let probeAgreementId: string;

    beforeAll(async () => {
      const admin = await getAdminDataSource();
      const rows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.lta_agreements
           (tenant_id, cpl_id, agreement_name, agreement_code, effective_date, status)
         VALUES ($1, $2, 'T-269 probe (write-path)', $3, '2026-01-01', 'draft')
         RETURNING id`,
        [fixture.tenantId, fixture.cplId, `T269_PROBE_${Date.now()}`],
      );
      probeAgreementId = rows[0].id;
    });

    afterAll(async () => {
      const admin = await getAdminDataSource();
      await admin.query(`DELETE FROM main.lta_agreements WHERE id = $1`, [
        probeAgreementId,
      ]);
    });

    it("POST /lta-agreements (ADMIN) — HÂLÂ 500: KUSUR 4 (validateNoOverlappingAgreements HER ZAMAN düşer — INSERT/lta_agreements KUSUR 3'e hiç ULAŞILMIYOR, satır YAZILMIYOR, yaz-sonra-oku tehlikesi MATERYALİZE OLMUYOR)", async () => {
      const admin = await loginAs(app, 'ADMIN');
      const code = `T269_CREATE_PROBE_${Date.now()}`;

      const res = await request(app.getHttpServer())
        .post('/lta-agreements')
        .set(admin.authHeader())
        .send({
          cplId: fixture.cplId,
          agreementName: 'T-269 create probe',
          agreementCode: code,
          effectiveDate: '2026-09-01',
          rates: [
            {
              channel: 'ALL',
              category: 'ALL',
              onInvoicePercentage: 5,
              offInvoicePercentage: 3,
            },
          ],
        });

      expect(res.status).toBe(500);

      // Poz. kontrol: satır gerçekten hiç yazılmadı (Kusur 4'ün SELECT'i
      // INSERT'ten ÖNCE düşer, hangi nedenle olursa olsun).
      const rows = await dataSource.query(
        `SELECT id FROM main.lta_agreements WHERE agreement_code = $1`,
        [code],
      );
      expect(rows).toHaveLength(0);
    });

    it("PATCH /lta-agreements/:id (ADMIN) — HÂLÂ 500: KUSUR 3 (findById Kusur 1 ile düzeltildi, BAŞARILI; bu DTO tarih alanı GÖNDERMEDİĞİ için Kusur 4'ün kod yoluna hiç girmiyor, doğrudan UPDATE main.lta_agreements'a düşüyor ve app_runtime izni olmadığı için düşüyor)", async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/lta-agreements/${probeAgreementId}`)
        .set(admin.authHeader())
        .send({ notes: 'T-269 probe update' });

      expect(res.status).toBe(500);
    });

    it("POST /lta-agreements/:id/activate (ADMIN) — HÂLÂ 500: KUSUR 4 (activateAgreement de validateNoOverlappingAgreements çağırıyor — UPDATE/KUSUR 3'e hiç ULAŞILMIYOR)", async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/lta-agreements/${probeAgreementId}/activate`)
        .set(admin.authHeader());

      expect(res.status).toBe(500);
    });

    it('POST /lta-agreements/:id/terminate (ADMIN) — HÂLÂ 500: KUSUR 3 (validateNoOverlappingAgreements HİÇ ÇAĞRILMIYOR — doğrudan UPDATE main.lta_agreements, app_runtime izni yok)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post(`/lta-agreements/${probeAgreementId}/terminate`)
        .set(admin.authHeader())
        .send({ reason: 'T-269 probe terminate' });

      expect(res.status).toBe(500);
    });
  });
});
