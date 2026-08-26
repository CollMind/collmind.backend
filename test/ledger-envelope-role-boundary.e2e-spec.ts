/**
 * ledger-envelope-role-boundary.e2e-spec.ts
 *
 * `B3` kaza-dalgası `K2` — ledger-üçlüsü hizalaması (normalizasyon, kayıtsız
 * fark). `ledger.controller.ts`'te `GET ledger/envelope/:envelopeId` ve
 * `GET ledger/envelope/:envelopeId/consumed` `{ADMIN,FINANCE}` taşıyordu;
 * kardeş rotalar (`GET ledger`, `GET ledger/:id`,
 * `GET ledger/agreement/:agreementId(/consumed)`) hepsi `{ADMIN,FINANCE,
 * PLANNER}`. `ledger.repository.ts`: `findByEnvelopeId` (`:49-57`) ve
 * `findAll`'un `budgetEnvelopeId` filtresi (`:77-81`) AYNI yüklemi taşıyor —
 * yani PLANNER bu veriye `GET /ledger?budgetEnvelopeId=X` üzerinden zaten
 * erişebiliyordu; `envelope/:envelopeId` kısıtı fiilen bir BYPASS'tı.
 *
 * Kayıt taraması (`git log -S 'envelope/:envelopeId' -- ledger.controller.ts`):
 * dosyayı yaratan tek commit (`e9308da`, "added planner module") — küme
 * doğuşundan beri böyle, gerekçeli bir istisna kaydı YOK. ⇒ hizalama meşru,
 * kayıtlı bir farkın üstüne yazılmıyor.
 *
 * ⛔ YÖN: GENİŞLEME. `PLANNER` bugün `403` → bu değişiklikle `200`.
 *
 * ── PİN ŞEKLİ — İKİ GİRDİ / İKİ ÇIKTI (`CLAUDE.md §2.7 #6`) ─────────────────
 *
 *   1. PLANNER → 200                    (hedef genişliyor)
 *   2. CATEGORY_MANAGER → 403           (dışarıda kalan rol HÂLÂ kapalı —
 *                                         genişleme yalnız hedefte, "herkese
 *                                         aç" kazası değil)
 *
 * ADMIN/FINANCE zaten `200`; ayrıca ölçülür ki değişiklik onları bozmasın.
 *
 * ⛔ GÜNCELLEME (`Z43 §2`, `B3` istisna-dalgası `Faz-B`, 2026-08-27):
 * `MODES_LEDGER_READ` hücresi ayrıca `+READONLY` aldı ({A,F,P} → {A,F,P,RO}).
 * `READONLY` bu dosyada eskiden 403 bekleniyordu, şimdi `200` — pinler
 * aşağıda güncellendi (CATEGORY_MANAGER hâlâ 403, tek dışarıda kalan rol).
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

// Var olmayan ama biçimsel olarak geçerli bir UUID — ParseUUIDPipe'ı geçer,
// servis boş dizi / consumed:0 döner (NotFoundException atmıyor). Salt-okunur
// rota, hiçbir satır yazılmaz/silinmez.
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

describe('B3 K2 — ledger-üçlüsü hizalaması: envelope/* {ADMIN,FINANCE} → {ADMIN,FINANCE,PLANNER} [GENİŞLEME]', () => {
  let app: INestApplication;
  let admin: LoginResult;
  let finance: LoginResult;
  let planner: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    admin = await loginAs(app, 'ADMIN');
    finance = await loginAs(app, 'FINANCE');
    planner = await loginAs(app, 'PLANNER');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    readonly = await loginAs(app, 'READONLY');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  describe('GET /ledger/envelope/:envelopeId', () => {
    it('ADMIN → 200 (POZ.KONTROL — genişleme mevcut erişimi bozmuyor)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}`)
        .set(admin.authHeader());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('FINANCE → 200 (POZ.KONTROL — genişleme mevcut erişimi bozmuyor)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}`)
        .set(finance.authHeader());
      expect(res.status).toBe(200);
    });

    it('PLANNER → 200 (HEDEF — hizalama burada ölçülür)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}`)
        .set(planner.authHeader());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('CATEGORY_MANAGER → 403 (değişmedi — MODES_LEDGER_READ hücresinin üyesi değil)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}`)
        .set(categoryManager.authHeader());
      expect(res.status).toBe(403);
    });

    // ⛔ `Z43 §2` (`B3` istisna-dalgası `Faz-B`, 2026-08-27) — `MODES_LEDGER_READ`
    // `+READONLY` aldı ({A,F,P} → {A,F,P,RO}, `K-2.6.4c`: "İZLEYİCİ bir İZLEME
    // YETENEKLERİ SETİDİR"). Eski beklenti (403) `git log`'da izlenebilir; bu
    // pin YENİ davranışı sınar — izleme genişliyor, yazma genişlemiyor.
    it('READONLY → 200 (Z43 §2 genişlemesi — GET izleme yeteneği)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}`)
        .set(readonly.authHeader());
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /ledger/envelope/:envelopeId/consumed', () => {
    it('ADMIN → 200 (POZ.KONTROL)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}/consumed`)
        .set(admin.authHeader());
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('consumed');
    });

    it('FINANCE → 200 (POZ.KONTROL)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}/consumed`)
        .set(finance.authHeader());
      expect(res.status).toBe(200);
    });

    it('PLANNER → 200 (HEDEF — hizalama burada ölçülür)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}/consumed`)
        .set(planner.authHeader());
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('consumed');
    });

    it('CATEGORY_MANAGER → 403 (değişmedi — MODES_LEDGER_READ hücresinin üyesi değil)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}/consumed`)
        .set(categoryManager.authHeader());
      expect(res.status).toBe(403);
    });

    // `Z43 §2` — bkz. yukarıdaki `/ledger/envelope/:envelopeId` yorumu, aynı gerekçe.
    it('READONLY → 200 (Z43 §2 genişlemesi — GET izleme yeteneği)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ledger/envelope/${NONEXISTENT_UUID}/consumed`)
        .set(readonly.authHeader());
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('consumed');
    });
  });
});
