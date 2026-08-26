/**
 * master-data-kpi-mechanic-capability-boundary.e2e-spec.ts
 *
 * `B3 W8` göçü (2026-08-26) — `master-data` `kpi` + `mechanic` dalgası
 * (SON DALGA): 19 rotanın 17'si `@Roles` → `@RequireCapability` göçürüldü.
 *
 *   kpi        POST/PATCH/DELETE/seed-defaults  `@Roles(ADMIN)`             → `MASTER_DATA_WRITE` ({ADMIN})
 *              GET (liste·grid/:planId·grid·calculable·:id)                → `MASTER_DATA_READ` (5/5)
 *   mechanic   POST/PATCH/DELETE/:id/clone      `@Roles(ADMIN)`             → `MASTER_DATA_WRITE` ({ADMIN})
 *              GET (liste·:id)                                             → `MASTER_DATA_READ` (5/5)
 *
 * ⚠️ HÜCRE DEĞİŞİKLİĞİ (dekoratör göçü DEĞİL, `Z36 §5`, 2026-08-26 KABUL):
 *   POST mechanics/applicable         → `MASTER_DATA_READ` (mekanik POST→WRITE
 *   POST mechanics/check-combination    kuralının TÜRETECEĞİ hücre DEĞİL — override,
 *                                        route-cell-map.py MASTER_DATA_CALC_READ_ROUTES)
 * İkisi de göç öncesi @Roles kümesiyle BİREBİR (5/5) — davranış KORUNUYOR.
 *
 * ⛔ KARAR-BEKLER, GÖÇ YOK (`Z36 §5`) — `@Roles(ADMIN)` AYNEN kalır:
 *   POST kpis/validate-formula
 *   POST mechanics/validate-formula
 *
 * `CLAUDE.md §2.7 #6` — İKİ GİRDİ / İKİ ÇIKTI:
 *   `MASTER_DATA_WRITE` {ADMIN}  → NEGATİF YARI VAR  → pin gerçek ayırt edici.
 *   `MASTER_DATA_READ` 5/5      → NEGATİF YARI YOK  → pin YAPISAL OLARAK KÖR
 *     (dekoratör düşmesine); `it.each(BEŞ ROL)` şekli seçildi ki ÜYELİK
 *     DARALTMASI mutasyonunu (bir rolün ROLE_CAPABILITIES'ten çıkarılması)
 *     GÖRSÜN — `W7` review'ının ölçtüğü incelik: `5/5` körlüğü mutasyon
 *     TÜRÜNE göre ayrışıyor (dekoratör düşmesi ↔ üyelik daraltması).
 *
 * Örnekleme: 45 rotalık `W7`'nin aksine `W8` yalnız 19 rota ve İKİ farklı
 * controller — örnekleme YOK, HER GÖÇEN ROTA ayrı test taşıyor. `G6` (tüm-rota
 * atama mutabakatı) ve pin (üyelik) birlikte kapsıyor.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W8 — master-data kpi+mechanic controller yetenek sınırı', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let planner: LoginResult;
  let categoryManager: LoginResult;
  let finance: LoginResult;
  let readonly: LoginResult;

  const ALL_ROLES: Array<[string, () => LoginResult]> = [
    ['ADMIN', () => admin],
    ['PLANNER', () => planner],
    ['CATEGORY_MANAGER', () => categoryManager],
    ['FINANCE', () => finance],
    ['READONLY', () => readonly],
  ];

  const WRITE_OTHER_ROLES: Array<[string, () => LoginResult]> = [
    ['PLANNER', () => planner],
    ['CATEGORY_MANAGER', () => categoryManager],
    ['FINANCE', () => finance],
    ['READONLY', () => readonly],
  ];

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    planner = await loginAs(app, 'PLANNER');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    finance = await loginAs(app, 'FINANCE');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  // ── MASTER_DATA_READ — kpi GET uçları (5/5, negatif yarı YOK) ──────────
  describe('GET /master-data/kpis (MASTER_DATA_READ 5/5 — negatif yarı yok)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get('/master-data/kpis')
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /master-data/kpis/:id (MASTER_DATA_READ 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/kpis/${NONEXISTENT_UUID}`)
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /master-data/kpis/grid (MASTER_DATA_READ 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get('/master-data/kpis/grid')
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /master-data/kpis/calculable (MASTER_DATA_READ 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get('/master-data/kpis/calculable')
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /master-data/kpis/grid/:planId (MASTER_DATA_READ 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/kpis/grid/${NONEXISTENT_UUID}`)
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  // ── MASTER_DATA_WRITE — kpi POST/PATCH/DELETE (ADMIN, negatif yarı VAR) ─
  describe('POST /master-data/kpis (MASTER_DATA_WRITE {ADMIN})', () => {
    const INVALID_BODY = { kpiCode: 'x' }; // zorunlu alanlar eksik

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/master-data/kpis')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/master-data/kpis')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /master-data/kpis/:id (MASTER_DATA_WRITE {ADMIN})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/master-data/kpis/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send({ kpiName: 'Nonexistent Update' });
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/master-data/kpis/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader())
          .send({ kpiName: 'Nonexistent Update' });
        expect(res.status).toBe(403);
      },
    );
  });

  describe('DELETE /master-data/kpis/:id (MASTER_DATA_WRITE {ADMIN})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/master-data/kpis/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .delete(`/master-data/kpis/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /master-data/kpis/seed-defaults (MASTER_DATA_WRITE {ADMIN})', () => {
    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/master-data/kpis/seed-defaults')
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
    // ADMIN pozitif kontrolü BİLEREK yok: seedDefaults yan-etkili (varsayılan
    // KPI setini DB'ye yazar) ve idempotent DEĞİL — tekrarlı koşumlarda
    // fixture kirliliği üretir. Negatif yarı (dört rol → 403) ayırt edicinin
    // tamamı; ADMIN pozitif kontrolü kardeş rotalarda (POST/PATCH/DELETE)
    // zaten örneklendi.
  });

  // ── MASTER_DATA_READ — mechanic GET uçları (5/5, negatif yarı YOK) ──────
  describe('GET /master-data/mechanics (MASTER_DATA_READ 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get('/master-data/mechanics')
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /master-data/mechanics/:id (MASTER_DATA_READ 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/mechanics/${NONEXISTENT_UUID}`)
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  // ── MASTER_DATA_WRITE — mechanic POST/PATCH/DELETE/clone (ADMIN) ───────
  describe('POST /master-data/mechanics (MASTER_DATA_WRITE {ADMIN})', () => {
    const INVALID_BODY = { code: 'X' }; // zorunlu alanlar eksik

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/master-data/mechanics')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/master-data/mechanics')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /master-data/mechanics/:id (MASTER_DATA_WRITE {ADMIN})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/master-data/mechanics/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send({ name: 'Nonexistent Update' });
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/master-data/mechanics/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader())
          .send({ name: 'Nonexistent Update' });
        expect(res.status).toBe(403);
      },
    );
  });

  describe('DELETE /master-data/mechanics/:id (MASTER_DATA_WRITE {ADMIN})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/master-data/mechanics/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .delete(`/master-data/mechanics/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });

  describe('POST /master-data/mechanics/:id/clone (MASTER_DATA_WRITE {ADMIN})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/master-data/mechanics/${NONEXISTENT_UUID}/clone`)
        .set(admin.authHeader())
        .send({});
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post(`/master-data/mechanics/${NONEXISTENT_UUID}/clone`)
          .set(getUser().authHeader())
          .send({});
        expect(res.status).toBe(403);
      },
    );
  });

  // ── ÖZEL DÖRTLÜ: applicable/check-combination → MASTER_DATA_READ (Z36 §5 override) ─
  describe('POST /master-data/mechanics/applicable (MASTER_DATA_READ override — 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .post('/master-data/mechanics/applicable')
        .set(getUser().authHeader())
        .send({});
      expect(res.status).not.toBe(403);
    });
  });

  describe('POST /master-data/mechanics/check-combination (MASTER_DATA_READ override — 5/5)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .post('/master-data/mechanics/check-combination')
        .set(getUser().authHeader())
        .send({ mechanicCodes: [] });
      expect(res.status).not.toBe(403);
    });
  });

  // ── KARAR-BEKLER (Z36 §5) — @Roles(ADMIN) AYNEN, göç YOK ────────────────
  describe('POST /master-data/kpis/validate-formula (KARAR-BEKLER — @Roles(ADMIN) korunuyor)', () => {
    it('ADMIN → 403 ALMAZ', async () => {
      const res = await request(app.getHttpServer())
        .post('/master-data/kpis/validate-formula')
        .set(admin.authHeader())
        .send({ formula: '1+1', formulaType: 'ARITHMETIC' });
      expect(res.status).not.toBe(403);
    });

    it.each(WRITE_OTHER_ROLES)('%s → 403', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .post('/master-data/kpis/validate-formula')
        .set(getUser().authHeader())
        .send({ formula: '1+1', formulaType: 'ARITHMETIC' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /master-data/mechanics/validate-formula (KARAR-BEKLER — @Roles(ADMIN) korunuyor)', () => {
    it('ADMIN → 403 ALMAZ', async () => {
      const res = await request(app.getHttpServer())
        .post('/master-data/mechanics/validate-formula')
        .set(admin.authHeader())
        .send({ formula: '1+1' });
      expect(res.status).not.toBe(403);
    });

    it.each(WRITE_OTHER_ROLES)('%s → 403', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .post('/master-data/mechanics/validate-formula')
        .set(getUser().authHeader())
        .send({ formula: '1+1' });
      expect(res.status).toBe(403);
    });
  });
});
