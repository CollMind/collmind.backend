/**
 * t249-app-runtime-live-route-grants.e2e-spec.ts
 *
 * [[T-249]] — `app_runtime`'ın SIFIR ayrıcalığı olduğu sekiz `main`
 * tablodan ÜÇÜNÜN canlı rotası vardı ve hepsi 500 dönüyordu
 * (`permission denied for table ...`). Bu dosya o üç canlı rota
 * ailesini HTTP seviyesinde kanıtlar:
 *
 *   - `notifications`               → `/notifications` (3 rota)
 *   - `brands`                      → `/master-data/brands` (5 rota)
 *   - `mechanic_spend_breakdown`    → `/spend-calculation/*` (bkz. ⚠️ altta)
 *
 * ⚠️ DÜZELTME (görev dosyasının ölçümüne göre): görev dosyası
 * `mechanic_spend_breakdown`'ın canlı rotasını `/finance-reporting`'e
 * (7+ rota) atfediyordu. Ölçüldü ve YANLIŞ çıktı — `finance-reporting.
 * service.ts`'in `mechanicSpendBreakdownRepository`'si İNJECT EDİLİYOR
 * ama HİÇBİR metodda KULLANILMIYOR (ölü injection, `grep -n
 * "mechanicSpendBreakdownRepository\."` → yalnız constructor satırı).
 * `spend-calculation.service.ts`'teki enjeksiyon da aynı şekilde ölü.
 * TEK canlı tüketici `spend-distribution.service.ts`
 * (`SpendDistributionService`), ve onun TEK controller'ı
 * `spend-calculation.controller.ts` (`/spend-calculation/*`,
 * `SpendCalculationModule`). Bu dosya O rotaları hedefler.
 *
 * ⚠️ İKİNCİ BULGU (T-249 ilk turunda kapsam DIŞI bırakılmış, DUR ile
 * raporlanmış, ürün sahibi kararıyla İKİNCİ bir turda KAPANDI —
 * 2026-08-20): `spend-calculation.controller.ts`'in HİÇBİR rotasında
 * `@Roles` yoktu (`grep -c '@Roles'` → 0) — görev dosyasının ilk §3'ü
 * yalnız `brands`/`finance-reporting`'i saymıştı, çünkü canlı rota atfı
 * o ana kadar `finance-reporting`'e yapılmıştı. Ürün sahibi: "GRANT
 * verildiği turda @Roles de eklenir" (T-249'un `notifications`
 * kararıyla AYNI mantık — `0074 §B1`'in "yazma yapan rol-kısıtsız uçlar,
 * hesaplama tetikleyenler" sınıfı). Rol seti `spend-calculation.
 * controller.ts`'in kendi başlığında ölçülüp gerekçelendirildi (3 grup:
 * yazma/okuma-detay/okuma-bütçe — tek liste kopyalanmadı).
 *
 * ── FİİL ÖLÇÜMÜ (K-2.6.13f, "tahmin etme, ölç") ─────────────────────────
 * Kod okuması + `NODE_ENV=development` SQL logu (task raporunda tam
 * transkript) ile üç tablo için gerçekten üretilen ifadeler:
 *
 *   notifications              SELECT, UPDATE           (INSERT YOK —
 *     `createNotification` hiçbir üretim çağıranı olmayan ÖLÜ KOD;
 *     `grep -rn "createNotification" src` → yalnız tanım, `NotificationModule`
 *     yalnız kendi controller'ına inject ediliyor. İlke 1: bugün
 *     ihtiyacı olmayan izin verilmez.)
 *   brands                     SELECT, INSERT, UPDATE   (hard DELETE YOK —
 *     `remove()` → `softRemove()` → UPDATE `deleted_at`)
 *   mechanic_spend_breakdown   SELECT, INSERT, DELETE   (UPDATE YOK —
 *     `saveBreakdowns()` her zaman `delete()` + yeni entity `save()`,
 *     var olan satırı ASLA `save()` ile güncellemiyor)
 *
 * ── KIRMIZI KANIT ────────────────────────────────────────────────────
 * Bu dosya GRANT UYGULANMADAN ÖNCE bir kez koşturuldu — üçü de
 * `permission denied for table {notifications,brands,
 * mechanic_spend_breakdown}` ile 500 döndü (task raporunda tam çıktı).
 * Bu dosyanın PERSISTE EDİLEN hâli GRANT SONRASI (yeşil) durumu
 * doğrular — kalıcı bir test dosyasının "önce kırmızı" adımını kendi
 * içinde tekrar tekrar simüle etmesi anlamsız olurdu (CLAUDE.md
 * §2.6/§2.7 ölçüm disiplini "bir kez ölç, kaydet" ilkesiyle tutarlı —
 * bkz. `optimistic-locking.e2e-spec.ts`'in mutation-proof notu, aynı
 * desen).
 *
 * ── TEMİZLİK ─────────────────────────────────────────────────────────
 * `test/helpers/e2e-row-count.js` HER `main.*` tablosunun suite
 * öncesi/sonrası satır sayısını karşılaştırır. `mechanic_spend_breakdown`
 * için ayrı bir DELETE YAZILMADI — FK'leri `ON DELETE CASCADE`
 * (`plan_sku_id` VE `plan_mechanic_value_id`, ölçüldü: `\d main.
 * mechanic_spend_breakdown`), `cleanupTestPlans`'ın `plan_mechanic_values`/
 * `plan_skus` DELETE'i onları otomatik siler.
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

describe('T-249 — app_runtime canlı rota GRANT kapsaması', () => {
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
  // notifications
  // ────────────────────────────────────────────────────────────────────
  describe('/notifications — SELECT, UPDATE', () => {
    const insertedNotificationIds: string[] = [];

    afterAll(async () => {
      if (insertedNotificationIds.length === 0) return;
      const admin = await getAdminDataSource();
      await admin.query(
        `DELETE FROM main.notifications WHERE id = ANY($1::uuid[])`,
        [insertedNotificationIds],
      );
    });

    async function insertNotification(
      recipientId: string,
      status: 'PENDING' | 'READ' = 'PENDING',
    ): Promise<string> {
      const admin = await getAdminDataSource();
      const rows: Array<{ id: string }> = await admin.query(
        `INSERT INTO main.notifications
           (tenant_id, type, recipient_id, recipient_email, recipient_name,
            channel, priority, status, subject, body)
         VALUES ($1, 'APPROVAL_REQUESTED', $2, 'e2e-t249@wella.com',
                 'T-249 e2e', 'IN_APP', 'MEDIUM', $3,
                 'T-249 e2e subject', 'T-249 e2e body')
         RETURNING id`,
        [fixture.tenantId, recipientId, status],
      );
      const id = rows[0].id;
      insertedNotificationIds.push(id);
      return id;
    }

    it('GET /notifications — 200, app_runtime SELECT ile okuyabiliyor (önceden 500)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const notifId = await insertNotification(planner.userId);

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(res.body.map((n: { id: string }) => n.id)).toContain(notifId);
    });

    it('GET /notifications/unread — 200, PENDING satır listede', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const notifId = await insertNotification(planner.userId, 'PENDING');

      const res = await request(app.getHttpServer())
        .get('/notifications/unread')
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(res.body.map((n: { id: string }) => n.id)).toContain(notifId);
    });

    it('POST /notifications/:id/read — 200, UPDATE ile status READ olur (DB satırı doğrulanır)', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const notifId = await insertNotification(planner.userId, 'PENDING');

      const res = await request(app.getHttpServer())
        .post(`/notifications/${notifId}/read`)
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READ');

      const rows: Array<{ status: string; read_at: Date | null }> =
        await dataSource.query(
          `SELECT status, read_at FROM main.notifications WHERE id = $1`,
          [notifId],
        );
      expect(rows[0].status).toBe('READ');
      expect(rows[0].read_at).not.toBeNull();
    });

    it('@Roles: FINANCE de erişebiliyor (kapsam kişiye özel veri, bir iş fonksiyonu kapısı değil — dashboard.controller.ts emsali)', async () => {
      const finance = await loginAs(app, 'FINANCE');

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(finance.authHeader());

      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // brands
  // ────────────────────────────────────────────────────────────────────
  describe('/master-data/brands — SELECT, INSERT, UPDATE', () => {
    let scratchBrandId: string | undefined;
    const scratchCode = `E2E-T249-BRAND-${Date.now()}`;

    afterAll(async () => {
      const admin = await getAdminDataSource();
      await admin.query(`DELETE FROM main.brands WHERE code = $1`, [
        scratchCode,
      ]);
    });

    it('GET /master-data/brands — 200, SEED "WELLA" listede (önceden 500)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get('/master-data/brands')
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(res.body.map((b: { code: string }) => b.code)).toContain('WELLA');
    });

    it('GET /master-data/brands/:id — 200', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const wellaId = await resolveIdByCode(
        app,
        fixture.tenantId,
        'brands',
        'WELLA',
      );

      const res = await request(app.getHttpServer())
        .get(`/master-data/brands/${wellaId}`)
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(res.body.code).toBe('WELLA');
    });

    it('POST /master-data/brands (ADMIN) — 201, INSERT ile yeni satır oluşur', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .post('/master-data/brands')
        .set(admin.authHeader())
        .send({ code: scratchCode, name: 'T-249 e2e brand' });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(scratchCode);
      scratchBrandId = res.body.id;

      const rows = await dataSource.query(
        `SELECT id FROM main.brands WHERE code = $1`,
        [scratchCode],
      );
      expect(rows).toHaveLength(1);
    });

    it('PATCH /master-data/brands/:id (ADMIN) — 200, UPDATE ile isim değişir', async () => {
      const admin = await loginAs(app, 'ADMIN');
      expect(scratchBrandId).toBeDefined();

      const res = await request(app.getHttpServer())
        .patch(`/master-data/brands/${scratchBrandId}`)
        .set(admin.authHeader())
        .send({ name: 'T-249 e2e brand — updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('T-249 e2e brand — updated');
    });

    it('DELETE /master-data/brands/:id (ADMIN) — 204, soft-delete (UPDATE deleted_at, hard DELETE değil)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      expect(scratchBrandId).toBeDefined();

      const res = await request(app.getHttpServer())
        .delete(`/master-data/brands/${scratchBrandId}`)
        .set(admin.authHeader());

      expect(res.status).toBe(204);

      const rows: Array<{ deleted_at: Date | null }> = await dataSource.query(
        `SELECT deleted_at FROM main.brands WHERE id = $1`,
        [scratchBrandId],
      );
      expect(rows).toHaveLength(1); // hâlâ orada — hard DELETE değil
      expect(rows[0].deleted_at).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // mechanic_spend_breakdown (via /spend-calculation/*)
  // ────────────────────────────────────────────────────────────────────
  describe('/spend-calculation/* — SELECT, INSERT, DELETE (mechanic_spend_breakdown)', () => {
    let CHANNEL_NKA: string;
    let CATEGORY_SAC_BOYASI: string;
    let FU_TUP_BOYA: string;
    let MECHANIC_DISCOUNT: string;
    // RBAC pozitif kontrolü İÇİN AYRI bir mekanik (bkz. aşağıdaki RBAC
    // testinin yorumu — MEC-DISCOUNT üzerinde İKİNCİ bir `distribute`
    // çağrısı ayrı, kapsam dışı bir kusura çarpıyor).
    let MECHANIC_VIS_LS: string;
    let planId: string;
    let planFuId: string;

    beforeAll(async () => {
      [
        CHANNEL_NKA,
        CATEGORY_SAC_BOYASI,
        FU_TUP_BOYA,
        MECHANIC_DISCOUNT,
        MECHANIC_VIS_LS,
      ] = await Promise.all([
        resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
        resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-SAC-BOYASI'),
        resolveIdByCode(
          app,
          fixture.tenantId,
          'forecasting_units',
          'FU-TUP-BOYA',
        ),
        resolveIdByCode(app, fixture.tenantId, 'mechanics', 'MEC-DISCOUNT'),
        resolveIdByCode(app, fixture.tenantId, 'mechanics', 'VIS_LS'),
      ]);

      const planner = await loginAs(app, 'PLANNER');
      const planRes = await request(app.getHttpServer())
        .post('/plans')
        .set(planner.authHeader())
        .send({
          planName: `E2E-T249-SPEND-${Date.now()}`,
          cplId: fixture.cplId,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        })
        .expect(201);
      planId = planRes.body.id;

      const fuRes = await request(app.getHttpServer())
        .post(`/plans/${planId}/fus`)
        .set(planner.authHeader())
        .send({ fuId: FU_TUP_BOYA, planVersion: 1 })
        .expect(201);
      planFuId = fuRes.body.id;
    });

    afterAll(async () => {
      // `plan_mechanic_values`/`plan_skus` DELETE'i main.
      // mechanic_spend_breakdown'ı ON DELETE CASCADE ile temizler
      // (bkz. dosya başlığı — FK'leri ölçüldü).
      await cleanupTestPlans(app, fixture.tenantId, 'E2E-T249-');
    });

    it('GET /spend-calculation/breakdown/:planFuId — 200, SELECT (LEFT JOIN mechanic_spend_breakdown) çalışıyor (önceden 500)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .get(`/spend-calculation/breakdown/${planFuId}`)
        .set(planner.authHeader());

      expect(res.status).toBe(200);
    });

    it("POST /spend-calculation/distribute/:planFuId/:mechanicId (entered=0) — 200, DELETE mechanic_spend_breakdown'a ulaşıyor (önceden 500)", async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post(`/spend-calculation/distribute/${planFuId}/${MECHANIC_DISCOUNT}`)
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success'); // DistributionStatus enum — küçük harf
      expect(res.body.totalSpend).toBe(0);
    });

    /**
     * ⚠️ AYRI BULGU (T-249 kapsamı DIŞINDA, Team Lead'e raporlandı,
     * DÜZELTİLMEDİ): `saveBreakdowns()` (spend-distribution.service.ts)
     * her SKU dağıtımı için `planSkuId: dist.skuId` yazıyor —
     * `distributeByPercentage`/`distributeByPerUnit`/`distributeByLumpsum`
     * `dist.skuId`'yi `planSku.skuId` (KATALOG `skus.id`) olarak
     * dolduruyor, `planSku.id` (plan_skus SATIRININ KENDİ PK'sı) DEĞİL.
     * `mechanic_spend_breakdown.plan_sku_id` FK'si `main.plan_skus(id)`'e
     * işaret ediyor (`FK_54dbfe9df242d1aada3b456eb95`) — yani ENTERED
     * DEĞER > 0 olan HER `distributeMechanicSpend`/
     * `recalculateDistributionOnVolumeChange` çağrısı bu FK'yi ihlal
     * ediyor. Ölçüldü (bu dosyanın ilk koşumu, GRANT SONRASI):
     *   `QueryFailedError: insert or update on table
     *   "mechanic_spend_breakdown" violates foreign key constraint
     *   "FK_54dbfe9df242d1aada3b456eb95"`
     * — GRANT'ten TAMAMEN BAĞIMSIZ bir uygulama kusuru (izin katmanını
     * geçti, FK katmanında düştü). T-249'un kapsamı GRANT'tir, bu bug'ı
     * SESSİZCE DÜZELTMEK "bir düzeltme de bir iddiadır" kuralını ihlal
     * ederdi — bu yüzden aşağıdaki test GERÇEK `distribute` uç noktasını
     * DEĞİL, `app_runtime`'ın kendi `dataSource` bağlantısı üzerinden
     * DOĞRUDAN bir INSERT'i kullanarak yalnız İZİN katmanını (GRANT'in
     * konusu) ölçüyor — geçerli bir `plan_sku_id` (gerçek plan_skus
     * satırının PK'sı) ile.
     */
    it("app_runtime INSERT INTO mechanic_spend_breakdown — GEÇERLİ plan_sku_id ile (permission katmanı ölçülüyor, uygulama bug'ından İZOLE)", async () => {
      // Önceki test bu (planFuId, mechanicId) çifti için bir
      // plan_mechanic_values satırı yarattı (id biliniyor değil — DB'den
      // okunuyor).
      const pmvRows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM main.plan_mechanic_values
          WHERE plan_fu_id = $1 AND mechanic_id = $2`,
        [planFuId, MECHANIC_DISCOUNT],
      );
      expect(pmvRows).toHaveLength(1);
      const planMechanicValueId = pmvRows[0].id;

      const planSkuRows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM main.plan_skus WHERE plan_fu_id = $1 LIMIT 1`,
        [planFuId],
      );
      expect(planSkuRows.length).toBeGreaterThan(0);
      const validPlanSkuId = planSkuRows[0].id;

      // `dataSource` burada `app.get<DataSource>(getDataSourceToken())`
      // — yani NestJS uygulamasının KENDİ (app_runtime) bağlantısı. Bu
      // gerçek bir üretim yolu DEĞİL (test-özel bir INSERT), ama GRANT'in
      // ölçtüğü tam soruyu ölçüyor: "app_runtime bu tabloya INSERT
      // yapabiliyor mu?" — buggy `saveBreakdowns()`'un yanlış FK
      // değerinden bağımsız.
      const insertRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO main.mechanic_spend_breakdown
           (tenant_id, plan_sku_id, mechanic_id, plan_mechanic_value_id,
            calculated_amount, distribution_basis)
         VALUES ($1, $2, $3, $4, 123.45, 'base_volume_ratio')
         RETURNING id`,
        [
          fixture.tenantId,
          validPlanSkuId,
          MECHANIC_DISCOUNT,
          planMechanicValueId,
        ],
      );
      expect(insertRows).toHaveLength(1);

      const rows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM main.mechanic_spend_breakdown WHERE id = $1`,
        [insertRows[0].id],
      );
      expect(rows).toHaveLength(1);
    });

    /**
     * `@Roles` kanıtı (T-249 devam turu, ürün sahibi kararı 2026-08-20):
     * `spend-calculation.controller.ts`'in 8 rotasının HİÇBİRİNDE
     * `@Roles` yoktu — bu turda eklendi. Tek başına yeşil suite yeterli
     * değil (CLAUDE.md §2.7 #9) — kapsam DIŞI bir rolle çağrılıp 403,
     * kapsam İÇİ bir rolle çağrılıp 200 alındığı AYRICA gösterilir.
     *
     * `SPEND_WRITE_ROLES = [ADMIN, PLANNER]` — READONLY DIŞARIDA
     *   (finance-reporting'de bu ayrım yok, emsal plan.controller.ts'in
     *   yazma rotaları — bkz. controller dosyasının başlığı).
     */
    it('RBAC — POST /spend-calculation/distribute: READONLY → 403 (SPEND_WRITE_ROLES dışında)', async () => {
      const readonly = await loginAs(app, 'READONLY');

      const res = await request(app.getHttpServer())
        .post(`/spend-calculation/distribute/${planFuId}/${MECHANIC_DISCOUNT}`)
        .set(readonly.authHeader());

      expect(res.status).toBe(403);
    });

    /**
     * ⚠️ Pozitif kontrol AYNI (planFuId, MECHANIC_DISCOUNT) çiftini
     * KULLANMIYOR — bilerek FARKLI bir mekanik (`MECHANIC_VIS_LS`).
     * Ölçüldü: bu dosyanın önceki bir testi `MECHANIC_DISCOUNT` için zaten
     * BİR `plan_mechanic_values` satırı yarattı (entered_rate_pct=0,
     * `.create()` ile JS number `0`). O SATIRA İKİNCİ bir `distribute`
     * çağrısı yapılırsa satır artık `findOne` ile DB'DEN OKUNUYOR — ve
     * `entered_rate_pct` (transformer'sız decimal, `plan-mechanic-value.
     * entity.ts`'in kendi yorumu: "Transformer YOK — kasıtlı") `pg`
     * sürücüsünden STRING döner (`"0.0000"`). `spend-distribution.
     * service.ts`'in `enteredValue === 0` karşılaştırması STRICT —
     * `"0.0000" === 0` FALSE — yani "hiçbir şey girilmedi" satırı YANLIŞLIKLA
     * "girildi" sanılıp `saveBreakdowns()`'a düşüyor ve [[T-251]]'in FK
     * kusuruna çarpıyor (`FK_54dbfe9df242d1aada3b456eb95`).
     *
     * ⛔ BU AYRI, YENİ BİR BULGU — T-249/T-251'in kapsamı DIŞINDA,
     * DÜZELTİLMEDİ (bu turun sınırı: "servis mantığına dokunma"). Team
     * Lead'e raporlandı. Sınıf: `enteredValue === 0` katı karşılaştırması
     * ile decimal sütununun (`entered_rate_pct`) transformer'sız string
     * dönüşü arasındaki tip uyuşmazlığı — `§7.1`'in "v !== 0 tip
     * uyuşmazlığı" ailesinin YENİ bir vakası, `spend-validation.service.ts`
     * DIŞINDA (`spend-distribution.service.ts`'te).
     *
     * Pozitif kontrolün TEMİZ kalması için FARKLI bir mekanik kullanılıyor
     * — bu (planFuId, MECHANIC_VIS_LS) çifti İLK KEZ `distribute` ediliyor,
     * yani `planMechanicValue` `.create()` ile bellekte yaratılıyor (JS
     * number `0`), erken-dönüş (DELETE) yoluna giriyor — bu bug'a hiç
     * çarpmıyor.
     */
    it('RBAC POZİTİF KONTROL — aynı rota (FARKLI mekanik, VIS_LS) PLANNER ile 200 (SPEND_WRITE_ROLES içinde — 403 rol filtresinden, başka bir şeyden değil)', async () => {
      const planner = await loginAs(app, 'PLANNER');

      const res = await request(app.getHttpServer())
        .post(`/spend-calculation/distribute/${planFuId}/${MECHANIC_VIS_LS}`)
        .set(planner.authHeader());

      expect(res.status).toBe(200);
    });

    /**
     * `SPEND_BUDGET_CHECK_ROLES = [ADMIN, PLANNER, CATEGORY_MANAGER,
     * READONLY]` — FINANCE BİLEREK DIŞARIDA (emsal `finance-reporting`in
     * tenant-çapındaki `budget-at-risk`i DEĞİL — granülerlik farklı; emsal
     * `plan.controller.ts`'in KENDİ `GET /plans/:id/budget-check` rotası,
     * o da FINANCE'ı dışarıda bırakıyor — bkz. controller dosyasının
     * başlığı, bu tek route'ta diğer okuma grubundan BİLEREK sapıldı).
     */
    it('RBAC — GET /spend-calculation/validate-budget/:planId: FINANCE → 403 (SPEND_BUDGET_CHECK_ROLES dışında)', async () => {
      const finance = await loginAs(app, 'FINANCE');

      const res = await request(app.getHttpServer())
        .get(`/spend-calculation/validate-budget/${planId}`)
        .set(finance.authHeader());

      expect(res.status).toBe(403);
    });

    /**
     * ⚠️ Bu pozitif kontrol TEMİZ bir 200 ALAMIYOR — ölçüldü, ve sebebi
     * `@Roles`'la İLGİSİZ, ÜÇÜNCÜ bir yeni bulgu: `spend-validation.
     * service.ts:544` `validateBudgetImpact` içinde
     * `plan.startDate.toISOString()` çağırıyor — ama `Plan.startDate`
     * `@Column({ type: 'date' })` (`plan.entity.ts:68`), ve TypeORM/`pg`
     * bu tipi transformer'sız STRING olarak döndürür (`Date` DEĞİL).
     * Sonuç HER planda, HER rolde: `TypeError: plan.startDate.toISOString
     * is not a function`. Bu, `mechanic_spend_breakdown`'ın FK kusurundan
     * ([[T-251]]) TAMAMEN AYRI bir kusur, aynı serviste.
     *
     * ⛔ DÜZELTİLMEDİ — bu turun sınırı "yalnız @Roles ekle, servis
     * mantığına dokunma". Team Lead'e raporlandı (yeni task adayı).
     *
     * Pozitif kontrolün ANLAMI korunuyor: izinli bir rol GUARD'DAN GEÇİYOR
     * mu (403 ALMIYOR mu)? Guard geçildiğinde hata artık SERVİSİN İÇİNDEN
     * geliyor (500, `TypeError`) — `RolesGuard` değil. Bu, `FINANCE`'ın
     * 403'ünün sebebinin GERÇEKTEN rol filtresi olduğunu, kırık bir rota
     * olmadığını AYIRT EDİYOR: rol filtresi 403 ÜRETİYOR, servis kusuru
     * 500 ÜRETİYOR — ikisi karışmıyor.
     */
    it('RBAC POZİTİF KONTROL — aynı çağrı ADMIN ile 403 ALMIYOR (guard geçildi — SPEND_BUDGET_CHECK_ROLES içinde); 500 AYRI bir servis kusuru ([[T-251]] dışı, kapsam dışı)', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .get(`/spend-calculation/validate-budget/${planId}`)
        .set(admin.authHeader());

      expect(res.status).not.toBe(403);
      // Servis kusuru ölçüldü: bugün 500 (TypeError, plan.startDate.
      // toISOString) — ama bu testin İDDİASI yalnız "403 değil" (guard
      // geçildi). Kusur düzeltilirse bu satır hâlâ geçer, 200'e de.
    });
  });
});
