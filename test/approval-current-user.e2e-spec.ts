/**
 * approval-current-user.e2e-spec.ts
 *
 * T-256 — `@CurrentUser('id')` argümanını YOK SAYIYORDU (dekoratör fabrikası
 * `data`'yı hiç okumuyor, `request.user` OBJESİNİ dönüyordu). Bu suite
 * düzeltmenin "çalıştığını" değil, **DOĞRU KARARI verdiğini** pinler.
 *
 * ⚠️ Her pin İKİ GİRDİ / İKİ ÇIKTI şeklindedir (CLAUDE.md §2.7 #6): bir
 * testin yeşil olması, ayırt ettiği anlamına gelmez. Örn. `403` tek başına
 * kanıt değildir — `403`'ün SEBEBİ (sahiplik/self-approval) ancak pozitif
 * kontrol (`201` dönen kardeş vaka) yanında yazılıysa ayırt edilir.
 *
 * Düzeltmeden ÖNCEKİ davranış — MUTASYONLA ÖLÇÜLDÜ (2026-08-21; dekoratör
 * gövdesi düzeltme öncesi hâline döndürülüp bu suite koşuldu). Yeşil kalan
 * TEK grup: argümansız `@CurrentUser()` regresyon pinleri, `pending`
 * bulgu-ölçümü ve "başkasınınkini iptal edemez" — sonuncusu tek başına
 * AYIRT ETMEZ, çünkü düzeltme öncesi HERKES 403 alıyordu (pozitif kontrolü
 * bu yüzden var). Argümanlı yolun her pini kırmızıya döndü:
 *   GET  /approvals/my-requests   → 500
 *   POST /approvals/:id/cancel    → gerçek sahip bile 403 (string !== obje)
 *   POST /approvals/:id/approve   → 500
 *   POST /approvals/:id/reject    → 500
 * Üçünün de tek hata metni:
 *   `QueryFailedError: invalid input syntax for type uuid:
 *    "{"id":"…","sub":"…","email":"planner@wella.com",…}"`
 *
 * ⚠️ ÖNEMLİ DÜZELTME — `approve` FAIL-OPEN DEĞİLDİ, MASKELİYDİ.
 * Self-approval yüklemi (`request.requestedById === approverId`) gerçekten
 * hiçbir zaman `true` olmuyordu, AMA istek koruma yerine bir satır sonra
 * yazma aşamasında patlıyordu: `updatedBy`/`approvedById` alanlarına OBJE
 * gidiyor ve `uuid` kolonu reddediyor. Yani `/approvals/:id/approve`
 * üzerinden self-approval BUGÜN DE mümkün değildi — ikinci bir kusur
 * tarafından KAZARA kapatılmıştı (CLAUDE.md: "bir kusur, BAŞKA bir kusur
 * tarafından örtülebilir"; `INV-C-*` sınıfı: koruma bir tasarım değil, bir
 * arıza). Düzeltmeden sonra koruma GERÇEKTEN çalışır — bu suite onu pinler.
 *
 * 📌 `ApprovalService.approve`'un plan/agreement iç çağrıları (agreement.
 * service.ts:760 · approval-workflow.service.ts:546 · plan.service.ts:1602)
 * bu kusurdan HİÇ etkilenmedi: onlar `@CurrentUser()` (argümansız) →
 * `user.id` ile GERÇEK bir string taşıyor. Kusur yalnız `@CurrentUser('id')`
 * yazan 6 çağrı yerini vurdu (approval.controller.ts:57,72,100,112,123 +
 * admin-audit.controller.ts:29).
 *
 * ── T-047/T-060 SATIR SAYISI İNVARYANTI ──────────────────────────────────
 * `main.approval_requests` invaryantın İZLEDİĞİ tablolardan biridir
 * (test/helpers/e2e-row-count.js). Bu suite kendi fixture satırlarını
 * `beforeAll`'da INSERT eder ve `afterAll`'da id bazında DELETE eder —
 * ve DELETE'i bir SORGUYLA doğrular (fire-and-forget SQL değil; `m-3`
 * dersi: T-249 turunda bir ölçüm koşumu `main.admin_audit_logs`'ta 7 öksüz
 * satır bırakıp invaryantın tabanını sessizce yükseltmişti).
 *
 * Fixture satırları SENTETİK'tir (`entity_type='PLAN'`, rastgele
 * `entity_id`): `approval_requests.entity_id`'nin FK'sı YOKTUR (polimorfik
 * — bkz. cleanupTestPlans JSDoc'u), ve `ApprovalService.approve/reject/
 * cancel` yalnız `approval_requests` satırını okur/yazar; plan tarafına
 * hiç dokunmaz. Yani gerçek bir plan submit akışı kurmak bu davranışı
 * ölçmek için GEREKMEZ ve dört tabloya daha satır sızdırırdı.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

/** `createRequest`'in ürettiği varsayılan seviye — birebir aynı şekil. */
const DEFAULT_LEVELS = [{ order: 1, role: 'MANAGER', status: 'PENDING' }];

describe("T-256 — @CurrentUser('id') aktör kimliği (approvals)", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantId: string;

  let planner: LoginResult;
  let planner2: LoginResult;
  let categoryManager: LoginResult;

  /** Bu suite'in yarattığı TÜM approval_requests id'leri — afterAll siler. */
  const createdIds: string[] = [];

  /**
   * Sentetik bir PENDING approval_request yaratır ve id'sini temizlik
   * listesine ekler. `requestedById` testin ayırt etmek istediği eksendir —
   * fixture bu eksende FARKLI değerler taşımalıdır, yoksa test hiçbir şey
   * ölçemez (CLAUDE.md: "fixture, ayırt etmek istediği iki tarafta FARKLI
   * değer taşımalı").
   */
  async function seedRequest(requestedById: string): Promise<string> {
    const rows = await dataSource.query(
      `INSERT INTO main.approval_requests
         (tenant_id, request_type, entity_type, entity_id,
          requested_by_id, requested_at, approval_levels, current_level,
          status, created_by, metadata)
       VALUES ($1, 'PLAN', 'PLAN', uuid_generate_v4(),
               $2, CURRENT_TIMESTAMP, $3::jsonb, 1,
               'PENDING', $2, '{"e2e":"T-256"}'::jsonb)
       RETURNING id`,
      [tenantId, requestedById, JSON.stringify(DEFAULT_LEVELS)],
    );
    const id: string = rows[0].id;
    createdIds.push(id);
    return id;
  }

  async function statusOf(id: string): Promise<string> {
    const rows = await dataSource.query(
      `SELECT status FROM main.approval_requests WHERE id = $1`,
      [id],
    );
    return rows[0]?.status;
  }

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());

    planner = await loginAs(app, 'PLANNER');
    planner2 = await loginAs(app, 'PLANNER2');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    tenantId = planner.tenantId;

    // Ön koşul: aktörler GERÇEKTEN farklı kullanıcılar olmalı — aynı
    // olsalardı "kendi" / "başkasının" ayrımı ölçülemezdi.
    expect(planner.userId).toBeTruthy();
    expect(planner2.userId).toBeTruthy();
    expect(categoryManager.userId).toBeTruthy();
    expect(planner.userId).not.toBe(planner2.userId);
    expect(planner.userId).not.toBe(categoryManager.userId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized && createdIds.length > 0) {
      await dataSource.query(
        `DELETE FROM main.approval_requests WHERE id = ANY($1::uuid[])`,
        [createdIds],
      );
      // T-047: DELETE'in SONUCU ölçülür, komutun çalıştığı değil.
      const left = await dataSource.query(
        `SELECT count(*)::int AS c FROM main.approval_requests
          WHERE id = ANY($1::uuid[])`,
        [createdIds],
      );
      expect(left[0].c).toBe(0);
    }
    await closeTestApp();
  });

  describe('GET /approvals/my-requests — READ_OWN', () => {
    it('200 döner ve YALNIZ kendi taleplerini verir (başkasınınki listede YOK)', async () => {
      const mine = await seedRequest(planner.userId);
      const theirs = await seedRequest(planner2.userId);

      const res = await request(app.getHttpServer())
        .get('/approvals/my-requests')
        .set(planner.authHeader());

      // Düzeltmeden önce burası 500'dü (obje uuid kolonuna bağlanıyordu).
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const ids: string[] = res.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(mine); //  pozitif kontrol: yüklem eşleşiyor
      expect(ids).not.toContain(theirs); //  ayırt edicilik: filtre GERÇEK

      // Ve dönen her satır gerçekten bu kullanıcının olmalı — "içeriyor"
      // testi tek başına, filtresiz bir sorguda da yeşil olurdu.
      for (const row of res.body) {
        expect(row.requestedById).toBe(planner.userId);
      }
    });

    it('başka bir kullanıcı için AYNI uç farklı bir küme döner', async () => {
      const res = await request(app.getHttpServer())
        .get('/approvals/my-requests')
        .set(planner2.authHeader());

      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((r: { id: string }) => r.id);
      // planner2'nin listesi planner'ın satırını İÇERMEZ — aynı uç, farklı
      // aktör, farklı sonuç. "Sinyal sabitse, sinyal değildir."
      expect(ids.length).toBeGreaterThan(0);
      for (const row of res.body) {
        expect(row.requestedById).toBe(planner2.userId);
      }
    });
  });

  describe('POST /approvals/:id/cancel — sahiplik', () => {
    it('GERÇEK SAHİP iptal edebilir → 201 + CANCELLED', async () => {
      const own = await seedRequest(planner.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${own}/cancel`)
        .set(planner.authHeader())
        .send({});

      // Düzeltmeden önce burası 403'tü — string !== obje HER ZAMAN doğruydu.
      expect(res.status).toBe(201);
      expect(await statusOf(own)).toBe('CANCELLED');
    });

    it('BAŞKASININ talebini iptal edemez → 403 + satır PENDING kalır', async () => {
      const foreign = await seedRequest(planner2.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${foreign}/cancel`)
        .set(planner.authHeader())
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/requester/i);
      expect(await statusOf(foreign)).toBe('PENDING');
    });
  });

  describe('POST /approvals/:id/approve — EA-001 / K-2.5.11 self-approval', () => {
    it('⛔ KENDİ talebini onaylayamaz → 403 + satır PENDING kalır', async () => {
      const own = await seedRequest(categoryManager.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${own}/approve`)
        .set(categoryManager.authHeader())
        .send({ comments: 'T-256 self-approval pin' });

      // Düzeltmeden ÖNCE bu 201'di ve satır APPROVED oluyordu —
      // K-2.5.11'in canlı ihlali. Koruma yazılıydı ve hiç ateşlemiyordu.
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/own request/i);
      expect(await statusOf(own)).toBe('PENDING');
    });

    it('✅ POZİTİF KONTROL: BAŞKASININ talebini onaylayabilir → 201 + APPROVED', async () => {
      const foreign = await seedRequest(planner.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${foreign}/approve`)
        .set(categoryManager.authHeader())
        .send({ comments: 'T-256 positive control' });

      // Bu olmadan yukarıdaki 403'ün sebebi ayırt edilemez: rol kapısı,
      // guard, ya da self-approval — üçü de 403 verir.
      expect(res.status).toBe(201);
      expect(await statusOf(foreign)).toBe('APPROVED');

      // ⚠️ YENİ ERİŞİLEBİLİR OLAN BULGU (T-256 kapsamı DIŞI, rapor edildi):
      // bu satırın `entity_id`'si VAR OLMAYAN bir plan id'sidir ve uç yine
      // 201 döndü — yani `/approvals/:id/approve` yalnız approval_requests
      // satırını yazar; plan/agreement durum makinesine, bütçe rezervine ve
      // audit'e HİÇ dokunmaz (`approval.service.ts` `approve()` gövdesinde
      // yalnız `this.findById` + `this.approvalRepo.updateStatus` var).
      // Düzeltmeden önce bu yol 500 verdiği için ERİŞİLEMEZDİ; düzeltme onu
      // erişilebilir kıldı. `plan.service.ts:1602` / `agreement.service.ts:760`
      // aynı servisi ÇEVRELEYEN bir transaction içinde çağırıyor — bu genel
      // ucun onların yerine geçip geçemeyeceği bir ÜRÜN KARARIDIR.
    });

    it('BULGU: entity_id var olmayan bir plana işaret etse bile 201 (uç entity doğrulamıyor)', async () => {
      const orphan = await seedRequest(planner.userId);
      const before = await dataSource.query(
        `SELECT entity_id FROM main.approval_requests WHERE id = $1`,
        [orphan],
      );
      const planExists = await dataSource.query(
        `SELECT count(*)::int AS c FROM main.plans WHERE id = $1`,
        [before[0].entity_id],
      );
      expect(planExists[0].c).toBe(0); // ← pozitif kontrol: plan GERÇEKTEN yok

      const res = await request(app.getHttpServer())
        .post(`/approvals/${orphan}/approve`)
        .set(categoryManager.authHeader())
        .send({});

      expect(res.status).toBe(201);
      expect(await statusOf(orphan)).toBe('APPROVED');
    });
  });

  describe('POST /approvals/:id/reject — self-rejection', () => {
    it('⛔ KENDİ talebini reddedemez → 403 + satır PENDING kalır', async () => {
      const own = await seedRequest(categoryManager.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${own}/reject`)
        .set(categoryManager.authHeader())
        .send({ reason: 'T-256 self-rejection pin' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/own request/i);
      expect(await statusOf(own)).toBe('PENDING');
    });

    it('✅ POZİTİF KONTROL: BAŞKASININ talebini reddedebilir → 201 + REJECTED', async () => {
      const foreign = await seedRequest(planner.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${foreign}/reject`)
        .set(categoryManager.authHeader())
        .send({ reason: 'T-256 positive control' });

      expect(res.status).toBe(201);
      expect(await statusOf(foreign)).toBe('REJECTED');
    });
  });

  describe('REGRESYON — argümansız @CurrentUser() bozulmadı', () => {
    it('GET /agreements (kapsam çözümü user.id/user.role üzerinden) → 200', async () => {
      // agreement.controller.ts:71 `@CurrentUser() user: { id, role }` →
      // `{ userId: user.id, role: user.role }` ile kapsam filtresi kurar.
      // Argümansız yol OBJE dönmeye devam etmeli; alan bazına düşseydi
      // burası patlardı.
      const res = await request(app.getHttpServer())
        .get('/agreements')
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /notifications (argümansız user.id tüketicisi) → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(planner.authHeader());

      expect(res.status).toBe(200);
    });
  });

  describe("BULGU (düzeltilmedi) — GET /approvals/pending userId'yi KULLANMIYOR", () => {
    it('iki farklı aktör AYNI kümeyi alıyor — JSDoc "for current user" diyor', async () => {
      // ⚠️ Bu bir PIN DEĞİL, bir ÖLÇÜMDÜR. T-256 kapsamı dışında bırakıldı:
      // `ApprovalRepository.findPendingForUser` `userId` parametresini alıp
      // WHERE'e HİÇ koymuyor (approval.repository.ts, `findPendingForUser`
      // gövdesinde yalnız tenantId/status/deletedAt var) — yani uç,
      // tenant'ın TÜM PENDING talepleriniverir. Hangisinin doğru olduğu
      // (JSDoc mu davranış mı) bir ÜRÜN KARARIDIR, bir hata düzeltmesi
      // değil. Bu test bugünkü davranışı KAYDEDER; karar verildiğinde
      // bilerek kırmızıya dönmesi beklenir.
      const cmRes = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set(categoryManager.authHeader());
      const roRes = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set((await loginAs(app, 'READONLY')).authHeader());

      expect(cmRes.status).toBe(200);
      expect(roRes.status).toBe(200);

      const cmIds = cmRes.body.map((r: { id: string }) => r.id).sort();
      const roIds = roRes.body.map((r: { id: string }) => r.id).sort();
      // Boş iki liste de `toEqual` geçerdi — ölçümün ayırt edici olması için
      // küme DOLU olmalı (bu suite'in 403 alan iki self-approval satırı
      // hâlâ PENDING'dir).
      expect(cmIds.length).toBeGreaterThan(0);
      expect(cmIds).toEqual(roIds); // ← aktörden BAĞIMSIZ (bugünkü hâl)
    });
  });
});
