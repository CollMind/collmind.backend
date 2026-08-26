/**
 * master-data-capability-boundary.e2e-spec.ts
 *
 * `B3 W7` göçü (2026-08-26) — `master-data` katalog dalgası: 9 controller
 * (`brand · category · channel · cpl · forecasting-unit · generic-unit ·
 * region · sku · tactic`) × 5 rota = 45 rota `@Roles` → `@RequireCapability`
 * göçürüldü. TEK DESEN, TEKRARLI:
 *
 *   POST/PATCH/DELETE  `@Roles(ADMIN)`                                        → `MASTER_DATA_WRITE` ({ADMIN})
 *   GET (liste + :id)  `@Roles(ADMIN,PLANNER,CATEGORY_MANAGER,FINANCE,READONLY)` → `MASTER_DATA_READ` (5/5)
 *
 * `ROLE_CAPABILITIES`'te ikisi de göç öncesi @Roles kümesiyle BİREBİR —
 * davranış KORUNUYOR. `MASTER_DATA_MANAGE` bu göçe DAHİL DEĞİLDİ.
 * ⚠️ GÜNCELLENDİ (code-reviewer S3, 2026-08-26): "`W8`'in işi" yazıyordu;
 * `W8` KAPANDI ve hücre `H3` ile DÜŞTÜ (sıfır rota). Artık bir İŞ değil, bir
 * KAPANMIŞ KARAR — geri gelmesi `Z20` biçimi ister (yazılı kural + üretici
 * dalı + rota), ve `G8` kendiliğinden eklenmesini ENGELLER.
 *
 * `docs/process/B3B1_DALGA_PLANI_ONERI.md` `W5`–`W8` YÜRÜYÜŞ NOTU — pin
 * hücreyi ölçer, rotayı değil: 45 rota için 45 ayrı test YAZILMADI. Bir
 * TEMSİL yeterli — üç controller'dan (`brand · sku · tactic`) yazma + okuma
 * örnekleri.
 *
 * `CLAUDE.md §2.7 #6` — İKİ GİRDİ / İKİ ÇIKTI:
 *   `MASTER_DATA_WRITE` {ADMIN}  → NEGATİF YARI VAR  → pin gerçek ayırt edici
 *     (ADMIN izinli-yol sonucu alır, diğer DÖRDÜ 403 alır).
 *   `MASTER_DATA_READ` 5/5      → NEGATİF YARI YOK  → pin YAPISAL OLARAK
 *     KÖR; dedektör `route-scope.sh` FILTRESIZ kovasıdır (CAPABILITY
 *     kovasına yazar) — burada "tetiklenmiyor, çünkü negatif yarı mevcut
 *     değil" ölçülür, "geçerli değil" değil.
 *
 * Yan etkili yazma rotaları `customer-capability-boundary` numarasıyla
 * yazıldı: izinli rol (ADMIN) için de gövde/hedef KASTEN geçersiz — guard
 * geçsin, ValidationPipe/servis reddetsin, DB'ye HİÇBİR SATIR YAZILMASIN.
 *
 * ⛔ ÖRNEKLEME NEDEN YETERLİ — ve NEYE KOŞULLU (code-reviewer Nit 3, ÖLÇÜLDÜ):
 *   pin  →  yetenek ÜYELİĞİNİ tutar (global; bu yüzden örnekleme yeter)
 *   G6   →  rota→hücre ATAMASINI tutar (45 rotanın HEPSİNDE)
 *
 * Ölçüldü: örneklenmemiş bir controller'da hücre kaydırması yapıldığında
 * (`cpl` READ→WRITE) pin YEŞİL kaldı, `G6` rotayı ADIYLA yakaladı.
 * ⇒ Örnekleme yeterlidir AMA `G6`'nın tüm-rota kapsamına KOŞULLU.
 * `G6` daralırsa altı controller SESSİZCE korumasız kalır.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 W7 — master-data katalog controller yetenek sınırı', () => {
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

  // ── MASTER_DATA_READ — 5/5, negatif yarı YOK ───────────────────────────
  describe('GET /master-data/brands (MASTER_DATA_READ 5/5 — negatif yarı yok)', () => {
    it.each(ALL_ROLES)(
      '%s → 403 ALMAZ (route-scope.sh FILTRESIZ değil, CAPABILITY kovasında)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .get('/master-data/brands')
          .set(getUser().authHeader());
        expect(res.status).not.toBe(403);
      },
    );
  });

  describe('GET /master-data/skus/:id (MASTER_DATA_READ 5/5 — negatif yarı yok)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/skus/${NONEXISTENT_UUID}`)
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  describe('GET /master-data/tactics (MASTER_DATA_READ 5/5 — negatif yarı yok)', () => {
    it.each(ALL_ROLES)('%s → 403 ALMAZ', async (_l, getUser) => {
      const res = await request(app.getHttpServer())
        .get('/master-data/tactics')
        .set(getUser().authHeader());
      expect(res.status).not.toBe(403);
    });
  });

  // ── MASTER_DATA_WRITE — {ADMIN}, negatif yarı VAR ──────────────────────
  describe('POST /master-data/brands (MASTER_DATA_WRITE {ADMIN})', () => {
    const INVALID_BODY = { name: 'x' }; // code zorunlu (MinLength/IsNotEmpty) — eksik

    it('ADMIN → 400 (POZ.KONTROL — guard geçti, ValidationPipe reddetti)', async () => {
      const res = await request(app.getHttpServer())
        .post('/master-data/brands')
        .set(admin.authHeader())
        .send(INVALID_BODY);
      expect(res.status).toBe(400);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .post('/master-data/brands')
          .set(getUser().authHeader())
          .send(INVALID_BODY);
        expect(res.status).toBe(403);
      },
    );
  });

  describe('PATCH /master-data/skus/:id (MASTER_DATA_WRITE {ADMIN})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/master-data/skus/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .send({ name: 'Nonexistent Update' });
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .patch(`/master-data/skus/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader())
          .send({ name: 'Nonexistent Update' });
        expect(res.status).toBe(403);
      },
    );
  });

  describe('DELETE /master-data/tactics/:id (MASTER_DATA_WRITE {ADMIN})', () => {
    it('ADMIN → 404 (POZ.KONTROL — guard geçti, servis 404 üretti)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/master-data/tactics/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(404);
    });

    it.each(WRITE_OTHER_ROLES)(
      '%s → 403 (MASTER_DATA_WRITE yalnız ADMIN)',
      async (_l, getUser) => {
        const res = await request(app.getHttpServer())
          .delete(`/master-data/tactics/${NONEXISTENT_UUID}`)
          .set(getUser().authHeader());
        expect(res.status).toBe(403);
      },
    );
  });
});
