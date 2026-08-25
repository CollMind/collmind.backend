/**
 * shared-write-w4b-boundary.e2e-spec.ts
 *
 * `B3 W4b` göçü — `SHARED_WRITE`'ın SEKİZ rotası `Z36` eksenine (SoD +
 * sahiplik) göre üçe bölündü:
 *
 *   SINIF A  SHARED_POLICY_WRITE    {ADMIN}          PATCH approval-policies/:id
 *   SINIF B  SHARED_ENVELOPE_WRITE  {ADMIN,FINANCE}  POST budget/envelopes[,/:id/split]
 *   SINIF C  SHARED_SPEND_WRITE     {ADMIN,PLANNER}  POST spend-calculation/distribute/…
 *                                                     · recalculate-on-volume-change/…
 *
 * + hesap-okuma üçlüsü (`Z36 §5`, yazma yüzeyi ÖLÇÜLDÜ 0) `SHARED_READ`'e
 * (5/5) göçtü:
 *
 *   POST lta-agreements/context/rates · calculate/base-spend · calculate/planned-spend
 *
 * `CLAUDE.md §2.7 #6` — İKİ GİRDİ / İKİ ÇIKTI: SINIF A/B/C hücrelerinin
 * NEGATİF YARISI VAR (`docs/process/B3B1_DALGA_PLANI_ONERI.md` `PİN ZORUNLU`
 * bölümü) — izinli rol `403` ALMAZ, izinsiz rol `403` ALIR, bu ayırt eder.
 * `SHARED_READ` (calc üçlüsü) `5/5` — negatif yarı YOK, pin bu üçte
 * `route-scope.sh`'ın FILTRESIZ ölçümünü DOĞRULAMAZ (`W4a`'nın dersi); yine
 * de BEŞ ROLÜN BEŞİNİN DE aynı (403 dışı) sonucu aldığı burada pinlenir.
 *
 * Yan etkili beş rota (SINIF A/B/C) `tenant-capability-boundary` numarasıyla
 * yazıldı: izinli rol için de gövde/hedef KASTEN geçersiz — guard geçsin,
 * servis/ValidationPipe reddetsin, DB'ye HİÇBİR SATIR YAZILMASIN.
 *
 *   PATCH approval-policies/:id                          → nonexistent UUID, geçerli DTO → ADMIN 404
 *   POST  budget/envelopes                                → geçersiz DTO (zorunlu alan eksik) → ADMIN 400
 *   POST  budget/envelopes/:id/split                      → nonexistent UUID, geçerli body → ADMIN 404
 *   POST  spend-calculation/distribute/:planFuId/:mechanicId    → nonexistent UUID'ler → ADMIN 404
 *   POST  spend-calculation/recalculate-on-volume-change/:skuId → nonexistent UUID → ADMIN 204 (boş breakdown, satır YOK)
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis 404 üretir (rotaya göre). Hiçbir satır yazılmaz/silinmez.
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W4b — SHARED_WRITE bölünmesi (Z36) + hesap-okuma üçlüsü', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let finance: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    planner = await loginAs(app, 'PLANNER');
    finance = await loginAs(app, 'FINANCE');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  // ── SINIF A — SHARED_POLICY_WRITE {ADMIN} ──────────────────────────────
  describe('PATCH /approval-policies/:id (SHARED_POLICY_WRITE {ADMIN})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['PLANNER', () => planner],
      ['FINANCE', () => finance],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];
    const VALID_BODY = { template: 'STANDARD' };

    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/approval-policies/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send(VALID_BODY);
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (SHARED_POLICY_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/approval-policies/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader())
          .send(VALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  // ── SINIF B — SHARED_ENVELOPE_WRITE {ADMIN,FINANCE} ────────────────────
  describe('POST /budget/envelopes (SHARED_ENVELOPE_WRITE {ADMIN,FINANCE})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['PLANNER', () => planner],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];
    // Zorunlu alanlar (fiscalYear/period/allocatedAmount) BİLEREK eksik —
    // guard geçsin, ValidationPipe reddetsin, DB'ye satır YAZILMASIN.
    const INVALID_BODY = {};

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/budget/envelopes')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it('FINANCE → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/budget/envelopes')
        .set(finance.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (SHARED_ENVELOPE_WRITE yalnız ADMIN/FINANCE)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/budget/envelopes')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /budget/envelopes/:id/split (SHARED_ENVELOPE_WRITE {ADMIN,FINANCE})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['PLANNER', () => planner],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];
    // Zarf yok — servis 404 üretir (validasyon 200'e ULAŞAMAZ, satır YOK).
    const VALID_BODY = { onInvoiceAllocated: 1, offInvoiceAllocated: 1 };

    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/budget/envelopes/${NONEXISTENT_UUID}/split`)
        .set(admin.authHeader())
        .send(VALID_BODY);
      expect(res.status).toBe(404);
    });

    it('FINANCE → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/budget/envelopes/${NONEXISTENT_UUID}/split`)
        .set(finance.authHeader())
        .send(VALID_BODY);
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (SHARED_ENVELOPE_WRITE yalnız ADMIN/FINANCE)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/budget/envelopes/${NONEXISTENT_UUID}/split`)
          .set(getUser().authHeader())
          .send(VALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  // ── SINIF C — SHARED_SPEND_WRITE {ADMIN,PLANNER} ───────────────────────
  describe('POST /spend-calculation/distribute/:planFuId/:mechanicId (SHARED_SPEND_WRITE {ADMIN,PLANNER})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['FINANCE', () => finance],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];

    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/spend-calculation/distribute/${NONEXISTENT_UUID}/${NONEXISTENT_UUID}`,
        )
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it('PLANNER → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/spend-calculation/distribute/${NONEXISTENT_UUID}/${NONEXISTENT_UUID}`,
        )
        .set(planner.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (SHARED_SPEND_WRITE yalnız ADMIN/PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(
            `/spend-calculation/distribute/${NONEXISTENT_UUID}/${NONEXISTENT_UUID}`,
          )
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /spend-calculation/recalculate-on-volume-change/:skuId (SHARED_SPEND_WRITE {ADMIN,PLANNER})', () => {
    const OTHER_ROLES: Array<[string, () => LoginResult]> = [
      ['FINANCE', () => finance],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['READONLY', () => readonly],
    ];
    // skuId yok → breakdowns boş dizi → döngü hiçbir şey yapmaz → 204,
    // hiçbir satır yazılmaz/silinmez (spend-distribution.service.ts).
    const BODY = { newVolume: 100 };

    it('ADMIN → 204 (POZ.KONTROL — guard geçti, boş breakdown)', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/spend-calculation/recalculate-on-volume-change/${NONEXISTENT_UUID}`,
        )
        .set(admin.authHeader())
        .send(BODY);
      expect(res.status).toBe(204);
    });

    it('PLANNER → 204 (POZ.KONTROL — guard geçti, boş breakdown)', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/spend-calculation/recalculate-on-volume-change/${NONEXISTENT_UUID}`,
        )
        .set(planner.authHeader())
        .send(BODY);
      expect(res.status).toBe(204);
    });

    it.each(OTHER_ROLES)(
      '%s → 403 (SHARED_SPEND_WRITE yalnız ADMIN/PLANNER)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(
            `/spend-calculation/recalculate-on-volume-change/${NONEXISTENT_UUID}`,
          )
          .set(getUser().authHeader())
          .send(BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  // ── Hesap-okuma üçlüsü — SHARED_READ (5/5, negatif yarı YOK) ───────────
  // `CLAUDE.md §2.7 #6` uyarısı burada da geçerli: 5/5 hücrede pin
  // "guard takılı" ile "guard yok"u AYIRT EDEMEZ (`W4a`'nın dersi). Asıl
  // ayırt edici `route-scope.sh`'ın FILTRESIZ ölçümü (bu turda 0). Bu blok
  // yalnız BEŞ ROLÜN BEŞİNİN DE aynı davrandığını (403 dışı) pinler.
  describe('LTA hesap-okuma üçlüsü (SHARED_READ, 5/5)', () => {
    const ALL_FIVE: Array<[string, () => LoginResult]> = [
      ['ADMIN', () => admin],
      ['CATEGORY_MANAGER', () => categoryManager],
      ['FINANCE', () => finance],
      ['PLANNER', () => planner],
      ['READONLY', () => readonly],
    ];

    function pinAllFive(
      label: string,
      buildRequest: (
        agent: request.SuperTest<request.Test>,
        user: LoginResult,
      ) => request.Test,
    ) {
      it(`${label} — BEŞ ROL de AYNI durumu döndürür (403 DEĞİL)`, async () => {
        const statuses: Record<string, number> = {};
        for (const [roleLabel, getUser] of ALL_FIVE) {
          const res = await buildRequest(
            request(
              app.getHttpServer(),
            ) as unknown as request.SuperTest<request.Test>,
            getUser(),
          );
          statuses[roleLabel] = res.status;
        }
        const first = Object.values(statuses)[0];
        for (const status of Object.values(statuses)) {
          expect(status).not.toBe(403);
          expect(status).toBe(first);
        }
      });
    }

    // `PlanContextDto`'nun TÜM alanları opsiyonel (channelCode/channelId/
    // categoryCode/categoryId/cplId/cplCodes) — geçerli-ama-boş bir gövde
    // `whitelist`/`forbidNonWhitelisted`'ı (main.ts) geçer.
    const EMPTY_PLAN_CONTEXT = {};

    pinAllFive('POST lta-agreements/context/rates', (agent, user) =>
      agent
        .post('/lta-agreements/context/rates')
        .set(user.authHeader())
        .send(EMPTY_PLAN_CONTEXT),
    );

    pinAllFive('POST lta-agreements/calculate/base-spend', (agent, user) =>
      agent
        .post('/lta-agreements/calculate/base-spend')
        .set(user.authHeader())
        .send({
          planId: NONEXISTENT_UUID,
          skuId: NONEXISTENT_UUID,
          planContext: EMPTY_PLAN_CONTEXT,
        }),
    );

    pinAllFive('POST lta-agreements/calculate/planned-spend', (agent, user) =>
      agent
        .post('/lta-agreements/calculate/planned-spend')
        .set(user.authHeader())
        .send({
          planId: NONEXISTENT_UUID,
          skuId: NONEXISTENT_UUID,
          planContext: EMPTY_PLAN_CONTEXT,
        }),
    );
  });
});
